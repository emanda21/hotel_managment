"""
database.py
-----------
Supabase client bootstrap and FastAPI dependency for the
Daris Hotel Inventory & Menu Management System.

Design
------
- A single Supabase Client instance is created at application startup
  via the FastAPI lifespan hook in main.py and stored on ``app.state.db``.
- Route handlers receive the client through the ``get_db`` FastAPI dependency,
  which simply reads it from ``app.state``.  This avoids reconnecting on
  every request.
- Lower-level helpers (fetch_recipe, deduct_stock, etc.) used by the
  /place_order business-logic endpoint are also defined here.
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from fastapi import Request
from supabase import Client, create_client

# ---------------------------------------------------------------------------
# Environment bootstrap
# ---------------------------------------------------------------------------

# Load .env when running locally; in production, variables are injected
# directly by the hosting platform (Railway, Render, etc.).
load_dotenv()

SUPABASE_URL: str = os.environ["SUPABASE_URL"]

# Use the SERVICE ROLE key on the server — it bypasses RLS so all tables
# are accessible regardless of which policies are configured.
# NEVER expose this key to the browser / front-end.
SUPABASE_KEY: str = os.environ["SUPABASE_KEY"]


# ---------------------------------------------------------------------------
# Client factory
# ---------------------------------------------------------------------------

def get_supabase_client() -> Client:
    """
    Create and return a new Supabase client.

    Called once at startup (see the ``lifespan`` context in main.py) and
    the result is cached on ``app.state.db`` for the lifetime of the process.
    """
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

def get_db(request: Request) -> Client:
    """
    FastAPI dependency that returns the shared Supabase client.

    Usage in a route:
        from database import get_db
        from fastapi import Depends
        from typing import Annotated

        DB = Annotated[Client, Depends(get_db)]

        @router.get("/")
        def my_route(db: DB): ...
    """
    return request.app.state.db


# =============================================================================
# Business-logic helpers  (used by the /place_order endpoint)
# =============================================================================

def fetch_recipe(client: Client, menu_item_id: str) -> list[dict[str, Any]]:
    """
    Return every recipe line for *menu_item_id*, joined with the matching
    ingredient's live stock data from store_inventory.

    Raises ValueError if the menu item has no recipe configured.
    """
    response = (
        client.table("recipes")
        .select("ingredient_id, quantity_needed, store_inventory(name, unit, stock_level)")
        .eq("menu_item_id", menu_item_id)
        .execute()
    )

    rows = response.data
    if not rows:
        raise ValueError(
            f"No recipe found for menu_item_id '{menu_item_id}'. "
            "Ensure the item exists and has a recipe configured."
        )

    # Flatten the nested store_inventory object for easier downstream use.
    return [
        {
            "ingredient_id": row["ingredient_id"],
            "ingredient_name": row["store_inventory"]["name"],
            "unit": row["store_inventory"]["unit"],
            "quantity_needed": float(row["quantity_needed"]),
            "stock_level": float(row["store_inventory"]["stock_level"]),
        }
        for row in rows
    ]


def fetch_menu_item(client: Client, menu_item_id: str) -> dict[str, Any]:
    """
    Return the menu_item row for *menu_item_id*.
    Raises ValueError if not found.
    """
    response = (
        client.table("menu_items")
        .select("id, name, price")
        .eq("id", menu_item_id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise ValueError(f"Menu item '{menu_item_id}' not found.")
    return response.data


def check_stock_sufficiency(
    recipe_lines: list[dict[str, Any]],
    quantity: int,
) -> list[dict[str, Any]]:
    """
    Verify every ingredient has sufficient stock for *quantity* servings.

    Returns enriched recipe lines (with ``total_required`` added).
    Raises InsufficientStockError listing ALL short ingredients at once.
    """
    enriched: list[dict[str, Any]] = []
    shortages: list[dict[str, Any]] = []

    for line in recipe_lines:
        total_required = line["quantity_needed"] * quantity
        sufficient = line["stock_level"] >= total_required

        enriched.append({**line, "total_required": total_required})

        if not sufficient:
            shortages.append(
                {
                    "ingredient_id": line["ingredient_id"],
                    "ingredient_name": line["ingredient_name"],
                    "unit": line["unit"],
                    "stock_level": line["stock_level"],
                    "required": total_required,
                    "shortfall": round(total_required - line["stock_level"], 4),
                }
            )

    if shortages:
        raise InsufficientStockError(shortages)

    return enriched


def deduct_stock(client: Client, recipe_lines: list[dict[str, Any]]) -> None:
    """
    Deduct ``total_required`` from ``stock_level`` for each ingredient.

    .. note::
        Each update is row-level atomic but the loop is not wrapped in a
        single DB transaction. For high-concurrency production use, consider
        replacing this with a Supabase RPC (stored procedure) that executes
        all deductions inside one PostgreSQL transaction.
    """
    for line in recipe_lines:
        new_level = round(line["stock_level"] - line["total_required"], 4)
        client.table("store_inventory").update({"stock_level": new_level}).eq(
            "id", line["ingredient_id"]
        ).execute()


def record_order(
    client: Client,
    menu_item_id: str,
    quantity: int,
) -> dict[str, Any]:
    """Insert a new order row and return the created record."""
    response = (
        client.table("orders")
        .insert({"menu_item_id": menu_item_id, "quantity": quantity})
        .execute()
    )
    return response.data[0]


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------

class InsufficientStockError(Exception):
    """
    Raised when one or more ingredients lack sufficient stock.

    Attributes
    ----------
    shortages:
        Structured list of ingredient shortfall details, forwarded
        directly into the HTTP 400 response body.
    """

    def __init__(self, shortages: list[dict[str, Any]]) -> None:
        self.shortages = shortages
        names = ", ".join(s["ingredient_name"] for s in shortages)
        super().__init__(f"Insufficient stock for: {names}")
