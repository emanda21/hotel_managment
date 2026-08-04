"""
routers/inventory.py
--------------------
Full CRUD endpoints for the `store_inventory` table.

Routes
------
GET    /inventory/             → list all ingredients (with optional low-stock filter)
GET    /inventory/low-stock    → list only ingredients below their threshold
GET    /inventory/audit        → full audit trail from v_inventory_audit view
GET    /inventory/{id}         → get a single ingredient
POST   /inventory/             → create a new ingredient
PUT    /inventory/{id}         → update an ingredient (partial update supported)
DELETE /inventory/{id}         → delete an ingredient
"""


from __future__ import annotations

from datetime import date, timedelta
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from database import get_db
from schemas import (
    DeleteResponse,
    InventoryDeduction,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
    InventoryRestock,
)

router = APIRouter(prefix="/inventory", tags=["Store Inventory"])

# Type alias for the injected Supabase client
DB = Annotated[object, Depends(get_db)]


# ---------------------------------------------------------------------------
# GET /inventory/low-stock  — must be declared BEFORE /{id} to avoid
# FastAPI treating "low-stock" as a UUID path parameter.
# ---------------------------------------------------------------------------

@router.get(
    "/low-stock",
    response_model=list[InventoryItemResponse],
    summary="List ingredients below their low-stock threshold",
)
def list_low_stock_items(db: DB) -> list[InventoryItemResponse]:
    """
    Returns all store_inventory rows where ``stock_level < low_stock_threshold``.
    Used by the admin dashboard to surface reorder alerts.
    Customers must NEVER see this endpoint or its data.
    """
    response = db.table("store_inventory").select("*").execute()
    rows = response.data or []

    low_stock = [
        InventoryItemResponse.from_row(r)
        for r in rows
        if r["stock_level"] < r["low_stock_threshold"]
    ]
    return low_stock


# ---------------------------------------------------------------------------
# GET /inventory/audit  — must be declared BEFORE /{id}
# Returns the full v_inventory_audit view (audit trail of all stock changes).
# ---------------------------------------------------------------------------

@router.get(
    "/audit",
    summary="Full inventory audit trail (v_inventory_audit view)",
    description=(
        "Returns every row from the ``v_inventory_audit`` view, ordered newest-first. "
        "Each row represents one stock change event (order deduction, manual restock, "
        "waste write-off, etc.) and is joined with ingredient name, order details, "
        "and the menu item that triggered the change."
    ),
)
def list_inventory_audit(
    db: DB,
    skip:       int           = Query(0,    ge=0,         description="Pagination offset."),
    limit:      int           = Query(200,  ge=1, le=1000, description="Max records to return."),
    start_date: Optional[date] = Query(None, description="Filter from this date (inclusive), format YYYY-MM-DD."),
    end_date:   Optional[date] = Query(None, description="Filter up to this date (inclusive), format YYYY-MM-DD."),
) -> list[dict]:
    """
    Query the ``v_inventory_audit`` convenience view defined in the migration.

    The view joins::

        inventory_logs → store_inventory → orders → menu_items

    and returns rows ordered ``created_at DESC``.

    Optional date filters:
      - ``start_date`` — only return rows with ``created_at >= start_date``
      - ``end_date``   — only return rows with ``created_at <  end_date + 1 day``
                         (i.e. end_date is inclusive)
    """
    query = (
        db.table("v_inventory_audit")
        .select("*")
        .order("created_at", desc=True)
    )
    if start_date:
        query = query.gte("created_at", start_date.isoformat())
    if end_date:
        query = query.lt("created_at", (end_date + timedelta(days=1)).isoformat())

    query = query.range(skip, skip + limit - 1)
    response = query.execute()
    return response.data or []


# ---------------------------------------------------------------------------
# GET /inventory/
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=list[InventoryItemResponse],
    summary="List all inventory items",
)
def list_inventory(
    db: DB,
    skip: int = Query(0, ge=0, description="Number of records to skip (pagination)."),
    limit: int = Query(100, ge=1, le=500, description="Max records to return."),
) -> list[InventoryItemResponse]:
    """
    Retrieve all ingredients from the store, ordered by name.
    Supports basic offset pagination via ``skip`` and ``limit``.
    """
    response = (
        db.table("store_inventory")
        .select("*")
        .order("name")
        .range(skip, skip + limit - 1)
        .execute()
    )
    return [InventoryItemResponse.from_row(r) for r in (response.data or [])]


# ---------------------------------------------------------------------------
# GET /inventory/{id}
# ---------------------------------------------------------------------------

@router.get(
    "/{item_id}",
    response_model=InventoryItemResponse,
    summary="Get a single inventory item by ID",
)
def get_inventory_item(item_id: str, db: DB) -> InventoryItemResponse:
    """Fetch a single ingredient row by its UUID."""
    response = (
        db.table("store_inventory")
        .select("*")
        .eq("id", item_id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Inventory item '{item_id}' not found.",
        )
    return InventoryItemResponse.from_row(response.data)


# ---------------------------------------------------------------------------
# POST /inventory/
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=InventoryItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a new ingredient to the store inventory",
)
def create_inventory_item(
    body: InventoryItemCreate,
    db: DB,
) -> InventoryItemResponse:
    """
    Insert a new ingredient record.
    Returns the created row including its generated UUID and ``created_at``.

    If ``body.added_by`` is provided, an INITIAL_STOCK audit row is written
    to ``inventory_logs`` so the addition appears in the Activity Log.
    """
    # Separate added_by before inserting — it's not a store_inventory column.
    added_by = body.added_by
    insert_data = body.model_dump(exclude={"added_by"})

    response = (
        db.table("store_inventory")
        .insert(insert_data)
        .execute()
    )
    created = response.data[0]

    # Write an audit log entry so the addition shows in the Activity Log.
    if body.stock_level and body.stock_level > 0:
        log_payload: dict = {
            "inventory_id":  created["id"],
            "change_amount": body.stock_level,
            "reason":        "MANUAL_RESTOCK",
        }
        if added_by:
            log_payload["added_by"] = added_by
        db.table("inventory_logs").insert(log_payload).execute()

    return InventoryItemResponse.from_row(created)


# ---------------------------------------------------------------------------
# PUT /inventory/{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{item_id}",
    response_model=InventoryItemResponse,
    summary="Update an inventory item",
)
def update_inventory_item(
    item_id: str,
    body: InventoryItemUpdate,
    db: DB,
) -> InventoryItemResponse:
    """
    Partially update an inventory item.
    Only fields present in the request body are updated (None fields are ignored).
    """
    # Build the patch dict — exclude fields the caller did not send.
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Request body must contain at least one field to update.",
        )

    response = (
        db.table("store_inventory")
        .update(patch)
        .eq("id", item_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Inventory item '{item_id}' not found.",
        )
    return InventoryItemResponse.from_row(response.data[0])



# ---------------------------------------------------------------------------
# POST /inventory/{id}/restock
# ---------------------------------------------------------------------------

@router.post(
    "/{item_id}/restock",
    response_model=InventoryItemResponse,
    summary="Restock an inventory item (adds stock + writes audit log)",
)
def restock_inventory_item(
    item_id: str,
    body: InventoryRestock,
    db: DB,
) -> InventoryItemResponse:
    """
    Add stock to an existing ingredient and write a ``MANUAL_RESTOCK`` audit row.

    Steps
    -----
    1. Fetch the current ``stock_level`` for the ingredient.
    2. Compute ``new_level = stock_level + body.quantity``.
    3. UPDATE ``store_inventory`` with the new level.
    4. INSERT a row into ``inventory_logs`` with:
       - ``change_amount = +body.quantity``
       - ``reason = 'MANUAL_RESTOCK'``
       - ``added_by = body.added_by``

    The new log row will appear in the Activity Log immediately.
    """
    # 1. Fetch current item
    fetch_resp = (
        db.table("store_inventory")
        .select("*")
        .eq("id", item_id)
        .maybe_single()
        .execute()
    )
    if not fetch_resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Inventory item '{item_id}' not found.",
        )
    current = fetch_resp.data
    new_level = round(float(current["stock_level"]) + body.quantity, 4)

    # 2. Update stock level
    update_resp = (
        db.table("store_inventory")
        .update({"stock_level": new_level})
        .eq("id", item_id)
        .execute()
    )
    if not update_resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update stock level.",
        )

    # 3. Write audit log
    log_payload: dict = {
        "inventory_id":  item_id,
        "change_amount": body.quantity,
        "reason":        "MANUAL_RESTOCK",
        "added_by":      body.added_by,
    }
    db.table("inventory_logs").insert(log_payload).execute()

    return InventoryItemResponse.from_row(update_resp.data[0])


# ---------------------------------------------------------------------------
# POST /inventory/{id}/deduct
# ---------------------------------------------------------------------------

@router.post(
    "/{item_id}/deduct",
    response_model=InventoryItemResponse,
    summary="Manually deduct stock from an inventory item (writes audit log)",
)
def deduct_inventory_item(
    item_id: str,
    body: InventoryDeduction,
    db: DB,
) -> InventoryItemResponse:
    """
    Manually remove stock from an ingredient and write a ``MANUAL_DEDUCTION`` audit row.

    Steps
    -----
    1. Fetch the current ``stock_level`` for the ingredient.
    2. Validate that sufficient stock exists (cannot go below zero).
    3. Compute ``new_level = stock_level - body.quantity``.
    4. UPDATE ``store_inventory`` with the new level.
    5. INSERT a row into ``inventory_logs`` with:
       - ``change_amount = -body.quantity``  (negative = deduction)
       - ``reason = body.reason``
       - ``deducted_by = body.deducted_by``

    The new log row will appear in the Activity Log immediately.
    """
    # 1. Fetch current item
    fetch_resp = (
        db.table("store_inventory")
        .select("*")
        .eq("id", item_id)
        .maybe_single()
        .execute()
    )
    if not fetch_resp.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Inventory item '{item_id}' not found.",
        )
    current = fetch_resp.data
    current_stock = float(current["stock_level"])

    # 2. Validate sufficient stock
    if body.quantity > current_stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot deduct {body.quantity} {current['unit']} from '{current['name']}'. "
                f"Current stock is only {current_stock} {current['unit']}."
            ),
        )

    new_level = round(current_stock - body.quantity, 4)

    # 3. Update stock level
    update_resp = (
        db.table("store_inventory")
        .update({"stock_level": new_level})
        .eq("id", item_id)
        .execute()
    )
    if not update_resp.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update stock level.",
        )

    # 4. Write audit log (negative change_amount = deduction)
    log_payload: dict = {
        "inventory_id":  item_id,
        "change_amount": -body.quantity,      # negative so audit shows it as a deduction
        "reason":        "MANUAL_DEDUCTION",
        "deducted_by":   body.deducted_by,
        "added_by":      None,                # not a restock; keep added_by NULL
    }
    db.table("inventory_logs").insert(log_payload).execute()

    return InventoryItemResponse.from_row(update_resp.data[0])



# ---------------------------------------------------------------------------
# DELETE /inventory/{id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{item_id}",
    response_model=DeleteResponse,
    summary="Delete an inventory item",
)
def delete_inventory_item(item_id: str, db: DB) -> DeleteResponse:
    """
    Permanently delete an ingredient.

    .. warning::
        This will also cascade-delete any recipe lines that reference this
        ingredient (as defined by ON DELETE CASCADE in the schema).
    """
    response = (
        db.table("store_inventory")
        .delete()
        .eq("id", item_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Inventory item '{item_id}' not found.",
        )
    return DeleteResponse(
        message="Inventory item deleted successfully.",
        deleted_id=item_id,
    )
