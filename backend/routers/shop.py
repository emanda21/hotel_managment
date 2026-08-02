"""
routers/shop.py
---------------
Tourist Shop & Marketplace endpoints.

Routes
------
GET  /shop/            → list all active shop items (public, no auth)
GET  /shop/categories  → list all unique categories (for filter pills)
GET  /shop/{id}        → get a single item
POST /shop/            → create an item  (service-role / admin only)
PUT  /shop/{id}        → update an item  (service-role / admin only)
DELETE /shop/{id}      → soft-delete (sets is_active=False)
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from database import get_db
from schemas import (
    DeleteResponse,
    ShopItemCreate,
    ShopItemResponse,
    ShopItemUpdate,
)

router = APIRouter(prefix="/shop", tags=["Tourist Shop"])

DB = Annotated[object, Depends(get_db)]


# ---------------------------------------------------------------------------
# GET /shop/ — public: list active items (with optional category filter)
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=list[ShopItemResponse],
    summary="List all active shop items",
)
def list_shop_items(
    db: DB,
    category: Optional[str] = Query(None, description="Filter by category"),
) -> list[ShopItemResponse]:
    """
    Returns all active shop items ordered by category then name.
    Optionally filter by `?category=Car+Rental`.
    No authentication required — this is the public tourist-facing endpoint.
    """
    query = db.table("shop_items").select("*").eq("is_active", True).order("category").order("name")
    if category:
        query = query.eq("category", category)

    rows = query.execute().data or []
    return [ShopItemResponse(**row) for row in rows]


# ---------------------------------------------------------------------------
# GET /shop/categories — list distinct categories (must be before /{id})
# ---------------------------------------------------------------------------

@router.get(
    "/categories",
    response_model=list[str],
    summary="List all distinct shop categories",
)
def list_categories(db: DB) -> list[str]:
    """Returns a sorted list of all category names that have at least one active item."""
    rows = db.table("shop_items").select("category").eq("is_active", True).execute().data or []
    cats = sorted({r["category"] for r in rows})
    return cats


# ---------------------------------------------------------------------------
# GET /shop/{id}
# ---------------------------------------------------------------------------

@router.get(
    "/{item_id}",
    response_model=ShopItemResponse,
    summary="Get a single shop item",
)
def get_shop_item(item_id: str, db: DB) -> ShopItemResponse:
    rows = db.table("shop_items").select("*").eq("id", item_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shop item not found.")
    return ShopItemResponse(**rows[0])


# ---------------------------------------------------------------------------
# POST /shop/ — admin: create
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=ShopItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new shop item (admin)",
)
def create_shop_item(body: ShopItemCreate, db: DB) -> ShopItemResponse:
    payload = body.model_dump()
    row = db.table("shop_items").insert(payload).execute().data
    if not row:
        raise HTTPException(status_code=500, detail="Insert failed.")
    return ShopItemResponse(**row[0])


# ---------------------------------------------------------------------------
# PUT /shop/{id} — admin: update
# ---------------------------------------------------------------------------

@router.put(
    "/{item_id}",
    response_model=ShopItemResponse,
    summary="Update a shop item (admin)",
)
def update_shop_item(item_id: str, body: ShopItemUpdate, db: DB) -> ShopItemResponse:
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    rows = db.table("shop_items").update(payload).eq("id", item_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Shop item not found.")
    return ShopItemResponse(**rows[0])


# ---------------------------------------------------------------------------
# DELETE /shop/{id} — admin: hard delete
# ---------------------------------------------------------------------------

@router.delete(
    "/{item_id}",
    response_model=DeleteResponse,
    summary="Delete a shop item (admin)",
)
def delete_shop_item(item_id: str, db: DB) -> DeleteResponse:
    rows = db.table("shop_items").delete().eq("id", item_id).execute().data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Shop item not found.")
    return DeleteResponse(message="Shop item deleted.", deleted_id=item_id)
