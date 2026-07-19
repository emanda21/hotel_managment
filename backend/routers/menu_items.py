"""
routers/menu_items.py
---------------------
Full CRUD endpoints for the `menu_items` table.

Routes
------
GET    /menu-items/              → list all menu items (optional category filter)
GET    /menu-items/categories    → list distinct category names
GET    /menu-items/{id}          → get a single menu item
POST   /menu-items/              → create a new menu item
PUT    /menu-items/{id}          → update a menu item (partial update supported)
DELETE /menu-items/{id}          → delete a menu item
"""

from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from database import get_db
from schemas import (
    DeleteResponse,
    MenuItemCreate,
    MenuItemResponse,
    MenuItemUpdate,
)

router = APIRouter(prefix="/menu-items", tags=["Menu Items"])

# Type alias for the injected Supabase client
DB = Annotated[object, Depends(get_db)]


# ---------------------------------------------------------------------------
# GET /menu-items/categories  — declared before /{id} to avoid path collision
# ---------------------------------------------------------------------------

@router.get(
    "/categories",
    response_model=list[str],
    summary="List all distinct menu categories",
)
def list_categories(db: DB) -> list[str]:
    """
    Returns a sorted list of unique category strings present in the menu.
    Useful for populating filter tabs on the customer-facing menu page.
    """
    response = db.table("menu_items").select("category").execute()
    rows = response.data or []
    categories = sorted({r["category"] for r in rows})
    return categories


# ---------------------------------------------------------------------------
# GET /menu-items/
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=list[MenuItemResponse],
    summary="List all menu items",
)
def list_menu_items(
    db: DB,
    category: Optional[str] = Query(None, description="Filter by category (e.g. Mains, Drinks)."),
    skip: int = Query(0, ge=0, description="Number of records to skip (pagination)."),
    limit: int = Query(100, ge=1, le=500, description="Max records to return."),
) -> list[MenuItemResponse]:
    """
    Retrieve all menu items, ordered by category then name.
    Optionally filter by ``category`` and paginate with ``skip`` / ``limit``.
    """
    query = (
        db.table("menu_items")
        .select("*")
        .order("category")
        .order("name")
        .range(skip, skip + limit - 1)
    )

    if category:
        query = query.eq("category", category)

    response = query.execute()
    return [MenuItemResponse(**r) for r in (response.data or [])]


# ---------------------------------------------------------------------------
# GET /menu-items/{id}
# ---------------------------------------------------------------------------

@router.get(
    "/{item_id}",
    response_model=MenuItemResponse,
    summary="Get a single menu item by ID",
)
def get_menu_item(item_id: str, db: DB) -> MenuItemResponse:
    """Fetch a single menu item by its UUID."""
    response = (
        db.table("menu_items")
        .select("*")
        .eq("id", item_id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Menu item '{item_id}' not found.",
        )
    return MenuItemResponse(**response.data)


# ---------------------------------------------------------------------------
# POST /menu-items/
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=MenuItemResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new menu item",
)
def create_menu_item(
    body: MenuItemCreate,
    db: DB,
) -> MenuItemResponse:
    """
    Insert a new menu item.
    Returns the created row including its generated UUID and ``created_at``.
    """
    response = (
        db.table("menu_items")
        .insert(body.model_dump())
        .execute()
    )
    return MenuItemResponse(**response.data[0])


# ---------------------------------------------------------------------------
# PUT /menu-items/{id}
# ---------------------------------------------------------------------------

@router.put(
    "/{item_id}",
    response_model=MenuItemResponse,
    summary="Update a menu item",
)
def update_menu_item(
    item_id: str,
    body: MenuItemUpdate,
    db: DB,
) -> MenuItemResponse:
    """
    Partially update a menu item.
    Only fields present in the request body are updated (None fields are ignored).
    """
    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Request body must contain at least one field to update.",
        )

    response = (
        db.table("menu_items")
        .update(patch)
        .eq("id", item_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Menu item '{item_id}' not found.",
        )
    return MenuItemResponse(**response.data[0])


# ---------------------------------------------------------------------------
# DELETE /menu-items/{id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{item_id}",
    response_model=DeleteResponse,
    summary="Delete a menu item",
)
def delete_menu_item(item_id: str, db: DB) -> DeleteResponse:
    """
    Permanently delete a menu item.

    .. warning::
        This will also cascade-delete all recipe lines associated with this
        menu item (ON DELETE CASCADE in the schema).
    """
    response = (
        db.table("menu_items")
        .delete()
        .eq("id", item_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Menu item '{item_id}' not found.",
        )
    return DeleteResponse(
        message="Menu item deleted successfully.",
        deleted_id=item_id,
    )
