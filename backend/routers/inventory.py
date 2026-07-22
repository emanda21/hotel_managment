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

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from database import get_db
from schemas import (
    DeleteResponse,
    InventoryItemCreate,
    InventoryItemResponse,
    InventoryItemUpdate,
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
    skip:  int = Query(0,   ge=0,         description="Pagination offset."),
    limit: int = Query(200, ge=1, le=1000, description="Max records to return."),
) -> list[dict]:
    """
    Query the ``v_inventory_audit`` convenience view defined in the migration.

    The view joins::

        inventory_logs → store_inventory → orders → menu_items

    and returns rows ordered ``created_at DESC``.
    """
    response = (
        db.table("v_inventory_audit")
        .select("*")
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
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
    """
    response = (
        db.table("store_inventory")
        .insert(body.model_dump())
        .execute()
    )
    return InventoryItemResponse.from_row(response.data[0])


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
