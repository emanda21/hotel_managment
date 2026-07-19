"""
routers/orders.py
-----------------
Order placement endpoint for the Daris Hotel Kitchen Inventory ERP.

Routes
------
POST /place_order
    Atomically validates stock, deducts ingredients, and records the order
    by calling the `place_order` PostgreSQL function via Supabase RPC.
    The entire operation runs inside a single PostgreSQL transaction —
    if anything fails, everything is rolled back.

GET /orders/
    List all historical orders (admin view).
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

from database import get_db
from schemas import (
    InsufficientStockResponse,
    LowStockAlert,
    PlaceOrderRequest,
    PlaceOrderResponse,
    StockDeduction,
    StockShortage,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Orders"])

# Type alias for the injected Supabase client
DB = Annotated[object, Depends(get_db)]


# =============================================================================
# Helpers
# =============================================================================

def _print_low_stock_alerts(alerts: list[dict[str, Any]]) -> None:
    """
    Print a formatted alert to the server console for every ingredient whose
    stock dropped to or below its low_stock_threshold after an order.

    These alerts are ONLY for kitchen/admin staff — customers never see them.
    """
    for alert in alerts:
        message = (
            f"\n{'='*60}\n"
            f"  ⚠️  LOW STOCK ALERT\n"
            f"  Ingredient : {alert['ingredient_name']}\n"
            f"  Current Stock: {alert['new_stock_level']} {alert['unit']}\n"
            f"  Threshold  : {alert['low_stock_threshold']} {alert['unit']}\n"
            f"{'='*60}"
        )
        # Log at WARNING level so it stands out in production log streams.
        logger.warning(message)
        # Also print directly so it's always visible in dev server output.
        print(message, flush=True)


def _parse_rpc_error(error_message: str) -> tuple[int, str, list[dict]]:
    """
    Parse the PostgreSQL error message raised by the place_order function
    and return (http_status_code, error_type, shortages_list).

    The function encodes shortage data as JSON in the error message string.
    """
    if "INSUFFICIENT_STOCK:" in error_message:
        # Extract the JSON payload after the "INSUFFICIENT_STOCK:" prefix.
        try:
            json_part = error_message.split("INSUFFICIENT_STOCK:", 1)[1].strip()
            shortages = json.loads(json_part)
        except (IndexError, json.JSONDecodeError):
            shortages = []
        return status.HTTP_400_BAD_REQUEST, "INSUFFICIENT_STOCK", shortages

    if "MENU_ITEM_NOT_FOUND:" in error_message:
        return status.HTTP_404_NOT_FOUND, "MENU_ITEM_NOT_FOUND", []

    if "NO_RECIPE_FOUND:" in error_message:
        return status.HTTP_404_NOT_FOUND, "NO_RECIPE_FOUND", []

    # Unknown / unexpected DB error
    return status.HTTP_500_INTERNAL_SERVER_ERROR, "DATABASE_ERROR", []


# =============================================================================
# POST /place_order
# =============================================================================

@router.post(
    "/place_order",
    response_model=PlaceOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Place an order (atomic stock validation + deduction)",
    description=(
        "Places an order for a menu item using a single PostgreSQL transaction "
        "(via Supabase RPC). If any ingredient is short the entire operation "
        "is rolled back and a structured 400 error is returned.\n\n"
        "**Low-stock alerts** are printed to the server console after a "
        "successful order if any ingredient drops to or below its threshold."
    ),
    responses={
        400: {
            "description": "One or more ingredients are out of stock.",
            "model": InsufficientStockResponse,
        },
        404: {"description": "Menu item or recipe not found."},
    },
)
def place_order(body: PlaceOrderRequest, db: DB) -> Any:
    """
    Atomic order-placement workflow (all steps run in one DB transaction):

    1. **Validate** the menu item UUID exists.
    2. **Validate** a recipe is configured for it.
    3. **Lock** all related `store_inventory` rows (FOR UPDATE) to prevent races.
    4. **Check** `stock_level >= quantity_needed * quantity` for every ingredient.
       - Any shortage → abort transaction → HTTP 400 with shortage details.
    5. **Deduct** `quantity_needed * quantity` from each ingredient's `stock_level`.
    6. **Insert** a row into `orders`.
    7. **Alert** the server console for any ingredient now at/below its threshold.
    8. **Return** HTTP 201 with the full order summary.
    """
    try:
        response = db.rpc(
            "place_order",
            {
                "p_menu_item_id":  body.menu_item_id,
                "p_quantity":      body.quantity,
                "p_table_number": body.table_number,   # None if not provided
            },
        ).execute()

    except Exception as exc:
        # Supabase-py raises an exception when the RPC function raises.
        # The exception message contains the PostgreSQL error string.
        error_str = str(exc)
        http_status, error_type, shortages = _parse_rpc_error(error_str)

        if error_type == "INSUFFICIENT_STOCK":
            # Return a rich 400 with per-ingredient shortage details.
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={
                    "error":    "INSUFFICIENT_STOCK",
                    "message":  "One or more ingredients have insufficient stock to fulfil this order.",
                    "shortages": shortages,
                },
            )

        # 404 variants (item not found, no recipe)
        if http_status == status.HTTP_404_NOT_FOUND:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=error_str,
            ) from exc

        # Re-raise everything else as a 500, but include the raw DB message
        # so developers can see exactly what went wrong.
        logger.error("Unexpected DB error in place_order RPC: %s", error_str)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database error: {error_str}",
        ) from exc

    # ----------------------------------------------------------------
    # RPC succeeded — unpack the JSONB payload
    # ----------------------------------------------------------------
    payload: dict[str, Any] = response.data

    # Print low-stock alerts to the server console
    alerts: list[dict] = payload.get("low_stock_alerts", [])
    if alerts:
        _print_low_stock_alerts(alerts)

    # Build and return the typed response
    return PlaceOrderResponse(
        order_id=payload["order_id"],
        menu_item_id=str(payload["menu_item_id"]),
        menu_item_name=payload["menu_item_name"],
        quantity=payload["quantity"],
        table_number=payload.get("table_number"),
        created_at=str(payload["created_at"]),
        deductions=[
            StockDeduction(
                ingredient_id=d["ingredient_id"],
                ingredient_name=d["ingredient_name"],
                unit=d["unit"],
                deducted=d["deducted"],
                remaining_stock=d["remaining_stock"],
            )
            for d in payload.get("deductions", [])
        ],
        low_stock_alerts=[
            LowStockAlert(
                ingredient_name=a["ingredient_name"],
                unit=a["unit"],
                new_stock_level=a["new_stock_level"],
                low_stock_threshold=a["low_stock_threshold"],
            )
            for a in alerts
        ],
    )


# =============================================================================
# GET /orders/
# =============================================================================

@router.get(
    "/orders/",
    tags=["Orders"],
    summary="List all historical orders (admin / kitchen dashboard)",
)
def list_orders(
    db: DB,
    skip:  int = Query(0,   ge=0,           description="Pagination offset."),
    limit: int = Query(100, ge=1, le=500,   description="Max records to return."),
) -> list[dict]:
    """
    Return orders newest-first, joined with the menu item name and price.
    Includes table_number so the kitchen dashboard can display where to serve.
    """
    response = (
        db.table("orders")
        .select("id, quantity, table_number, created_at, menu_items(name, price)")
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return response.data or []
