"""
routers/recipes.py
------------------
CRUD endpoints for the ``recipes`` table.

Each recipe row links one menu_item to one ingredient with a
``quantity_needed`` value that the ``place_order`` RPC uses to calculate
stock deductions when an order is placed.

Routes
------
GET    /recipes/              -> list all recipe lines (optionally filter by menu_item_id)
POST   /recipes/              -> create a new recipe line
DELETE /recipes/{recipe_id}   -> delete a recipe line by UUID
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from database import get_db
from schemas import DeleteResponse, RecipeLineCreate, RecipeLineResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recipes", tags=["Recipes"])

# Type alias for the injected Supabase client
DB = Annotated[object, Depends(get_db)]


# ---------------------------------------------------------------------------
# GET /recipes/
# ---------------------------------------------------------------------------

@router.get(
    "/",
    response_model=list[RecipeLineResponse],
    summary="List recipe lines",
    description=(
        "Returns all rows from the ``recipes`` table. "
        "Pass ``menu_item_id`` to filter the ingredients for a specific dish."
    ),
)
def list_recipes(
    db: DB,
    menu_item_id: str | None = Query(
        None,
        description="Optional UUID — return only recipe lines for this menu item.",
    ),
) -> list[RecipeLineResponse]:
    """
    Fetches recipe lines joined with ``store_inventory`` so each row includes
    ``ingredient_name`` and ``unit`` without an extra round-trip to the database.
    """
    query = (
        db.table("recipes")
        .select(
            "id, menu_item_id, ingredient_id, quantity_needed, "
            "store_inventory(name, unit)"
        )
        .order("menu_item_id")
    )

    if menu_item_id:
        query = query.eq("menu_item_id", menu_item_id)

    response = query.execute()
    rows = response.data or []

    result: list[RecipeLineResponse] = []
    for row in rows:
        # Flatten the joined store_inventory sub-object into top-level fields
        inventory = row.pop("store_inventory", None) or {}
        result.append(
            RecipeLineResponse(
                id=row["id"],
                menu_item_id=row["menu_item_id"],
                ingredient_id=row["ingredient_id"],
                quantity_needed=row["quantity_needed"],
                ingredient_name=inventory.get("name"),
                unit=inventory.get("unit"),
            )
        )
    return result


# ---------------------------------------------------------------------------
# POST /recipes/
# ---------------------------------------------------------------------------

@router.post(
    "/",
    response_model=RecipeLineResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new recipe line",
    description=(
        "Links a ``menu_item_id`` to an ``ingredient_id`` (from ``store_inventory``) "
        "with a ``quantity_needed`` per single serving. "
        "The pair ``(menu_item_id, ingredient_id)`` must be unique."
    ),
)
def create_recipe(
    body: RecipeLineCreate,
    db: DB,
) -> RecipeLineResponse:
    """
    Inserts a new row into the ``recipes`` table.

    - ``menu_item_id``    — must exist in ``menu_items``.
    - ``ingredient_id``   — must exist in ``store_inventory``.
    - ``quantity_needed`` — amount consumed per single serving (must be > 0).

    Returns the created row with HTTP 201.
    Raises **409 Conflict** if the ``(menu_item_id, ingredient_id)`` pair already exists.
    """
    try:
        response = (
            db.table("recipes")
            .insert(body.model_dump())
            .execute()
        )
    except Exception as exc:
        exc_str = str(exc)
        # Supabase/PostgREST surfaces UNIQUE violations as PostgreSQL error code 23505
        if "23505" in exc_str or "duplicate" in exc_str.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"A recipe line for menu_item_id='{body.menu_item_id}' and "
                    f"ingredient_id='{body.ingredient_id}' already exists."
                ),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to create recipe line: {exc_str}",
        ) from exc

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Recipe line could not be created. "
                "Verify that menu_item_id and ingredient_id both exist."
            ),
        )

    row = response.data[0]
    return RecipeLineResponse(
        id=row["id"],
        menu_item_id=row["menu_item_id"],
        ingredient_id=row["ingredient_id"],
        quantity_needed=row["quantity_needed"],
    )


# ---------------------------------------------------------------------------
# DELETE /recipes/{recipe_id}
# ---------------------------------------------------------------------------

@router.delete(
    "/{recipe_id}",
    response_model=DeleteResponse,
    summary="Delete a recipe line",
    description=(
        "Permanently removes a single recipe line by its UUID. "
        "Does **not** cascade to orders — existing order history is unaffected."
    ),
)
def delete_recipe(recipe_id: str, db: DB) -> DeleteResponse:
    """
    Deletes the recipe line identified by ``recipe_id``.
    Returns **404 Not Found** if the ID does not exist.
    """
    response = (
        db.table("recipes")
        .delete()
        .eq("id", recipe_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Recipe line '{recipe_id}' not found.",
        )

    logger.info("Deleted recipe line %s", recipe_id)
    return DeleteResponse(
        message="Recipe line deleted successfully.",
        deleted_id=recipe_id,
    )
