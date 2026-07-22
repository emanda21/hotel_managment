"""
routers/orders.py
-----------------
Order placement and Kitchen Display System (KDS) endpoints.

Routes
------
POST /place_order  (RPC path — preferred for high concurrency)
    Atomically validates stock, deducts ingredients, and records the order
    by calling the `place_order` PostgreSQL function via Supabase RPC.
    The entire operation runs inside a single PostgreSQL transaction —
    if anything fails, everything is rolled back.

POST /orders/place  (Python-native path — full business-logic visibility)
    Same guarantees as /place_order but orchestrated in Python:
      1. Fetches the recipe from the `recipes` table (joined with stock data).
      2. Checks `store_inventory` for sufficient quantities across all
         ingredients — collects ALL shortages before aborting.
      3. Records the order row first to obtain a valid order_id.
      4. Deducts stock from `store_inventory` for each ingredient.
      5. Writes one `inventory_logs` audit row per ingredient.
      6. Prints low-stock alerts to the server console.
    Raises HTTP 400 with a structured shortage payload if any ingredient is
    short; rolls back nothing (uses the RPC path for true atomicity).

GET /orders/
    List all historical orders (admin view).

PATCH /orders/{order_id}/kitchen-status
    Update the KDS lifecycle state of a single order.
    Allowed values: 'new' | 'preparing' | 'served'.
    The financial status column is NOT touched.

POST /orders/clear-kitchen
    Admin endpoint: marks all of today's 'served' orders as
    is_kitchen_cleared = TRUE so they disappear from the KDS board
    without deleting any financial or audit records.
"""

from __future__ import annotations

import json
import logging
from datetime import date, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse

from database import (
    InsufficientStockError,
    check_stock_sufficiency,
    fetch_menu_item,
    fetch_recipe,
    get_db,
    record_order,
    deduct_stock,
    write_inventory_log,
)
from schemas import (
    ClearKitchenResponse,
    InsufficientStockResponse,
    KITCHEN_STATUSES,
    KitchenStatusResponse,
    KitchenStatusUpdate,
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
# POST /orders/place  —  Python-native atomic deduction path
# =============================================================================

@router.post(
    "/orders/place",
    response_model=PlaceOrderResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Place an order — Python-native atomic stock deduction",
    description=(
        "Places an order using the Python-native orchestration path.\n\n"
        "**Workflow** (all steps run sequentially):\n"
        "1. Validate the menu item exists.\n"
        "2. Fetch the recipe from `recipes` joined with live `store_inventory` data.\n"
        "3. Check every ingredient for sufficient stock — collects **all** "
        "   shortages before aborting.\n"
        "4. Record the order in `orders` to obtain a stable `order_id`.\n"
        "5. Deduct consumed quantities from `store_inventory`.\n"
        "6. Write one `inventory_logs` audit row per ingredient.\n"
        "7. Emit low-stock alerts to the server console for any ingredient "
        "   that dropped to or below its threshold.\n\n"
        "Returns HTTP 400 with a structured shortage payload if any ingredient "
        "is short. For strict all-or-nothing atomicity across many concurrent "
        "requests use `POST /place_order` (PostgreSQL RPC path) instead."
    ),
    responses={
        400: {
            "description": "One or more ingredients are out of stock.",
            "model": InsufficientStockResponse,
        },
        404: {"description": "Menu item not found or no recipe configured."},
    },
)
def place_order_python(
    body: PlaceOrderRequest,
    db: DB,
) -> Any:
    """
    Python-native atomic order-placement workflow.

    Step 1 — Validate the menu item
    --------------------------------
    Fetch the menu item row by UUID. Raises 404 if not found.

    Step 2 — Fetch recipe lines
    ----------------------------
    Query ``recipes`` joined with ``store_inventory`` to get every ingredient
    needed for one serving, plus the current live stock level.
    Raises 404 if no recipe is configured.

    Step 3 — Stock-sufficiency check
    ---------------------------------
    Multiply each ingredient's ``quantity_needed`` by the requested
    ``quantity``.  ALL shortages are collected before aborting so the
    kitchen manager sees the full picture in one response (not just the
    first failing ingredient).
    Raises 400 with a structured list of shortages if any ingredient is short.

    Step 4 — Record the order
    --------------------------
    Insert the order row first so we have a real ``order_id`` UUID to
    reference in the ``inventory_logs`` FK.

    Step 5 — Deduct stock + write audit logs
    -----------------------------------------
    For each recipe line, UPDATE ``store_inventory`` and INSERT one row into
    ``inventory_logs`` with ``change_amount = -(total_required)`` and
    ``reason = 'ORDER_DEDUCTION'``.

    Step 6 — Low-stock alerts
    --------------------------
    Any ingredient whose new stock level is at or below its threshold is
    logged at WARNING level and printed to stdout.

    Step 7 — Return the response
    -----------------------------
    HTTP 201 with the full order summary including per-ingredient deductions
    and any low-stock alerts.
    """
    # ----------------------------------------------------------------
    # Step 1 — Validate menu item
    # ----------------------------------------------------------------
    try:
        menu_item = fetch_menu_item(db, body.menu_item_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    logger.info(
        "place_order_python | menu_item=%s (%s) qty=%d table=%s",
        menu_item["name"],
        body.menu_item_id,
        body.quantity,
        body.table_number,
    )

    # ----------------------------------------------------------------
    # Step 2 — Fetch recipe lines (with live stock data)
    # ----------------------------------------------------------------
    try:
        recipe_lines = fetch_recipe(db, body.menu_item_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    logger.info(
        "place_order_python | recipe has %d ingredient(s) for '%s'",
        len(recipe_lines),
        menu_item["name"],
    )

    # ----------------------------------------------------------------
    # Step 3 — Check stock sufficiency (collects ALL shortages)
    # ----------------------------------------------------------------
    try:
        enriched_lines = check_stock_sufficiency(recipe_lines, body.quantity)
    except InsufficientStockError as exc:
        logger.warning(
            "place_order_python | INSUFFICIENT_STOCK for '%s': %s",
            menu_item["name"],
            [s["ingredient_name"] for s in exc.shortages],
        )
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={
                "error":    "INSUFFICIENT_STOCK",
                "message":  "One or more ingredients have insufficient stock to fulfil this order.",
                "shortages": exc.shortages,
            },
        )

    # ----------------------------------------------------------------
    # Step 4 — Record the order (obtains a stable order_id for the FK)
    # ----------------------------------------------------------------
    order_row = record_order(
        db,
        menu_item_id=body.menu_item_id,
        quantity=body.quantity,
        table_number=body.table_number,
    )
    order_id: str = order_row["id"]

    logger.info(
        "place_order_python | order created order_id=%s",
        order_id,
    )

    # ----------------------------------------------------------------
    # Step 5 — Deduct stock + write inventory_logs audit rows
    # ----------------------------------------------------------------
    deducted_lines = deduct_stock(db, enriched_lines, order_id)

    logger.info(
        "place_order_python | stock deducted and audit rows written for order_id=%s",
        order_id,
    )

    # ----------------------------------------------------------------
    # Step 6 — Detect and log low-stock alerts
    # ----------------------------------------------------------------
    low_stock_alerts: list[dict] = [
        {
            "ingredient_name":     line["ingredient_name"],
            "unit":                line["unit"],
            "new_stock_level":     line["remaining_stock"],
            "low_stock_threshold": line.get("low_stock_threshold", 0),
        }
        for line in deducted_lines
        # stock_level is the PRE-deduction value; remaining_stock is post-deduction
        if line["remaining_stock"] <= line.get("low_stock_threshold", 0)
    ]
    if low_stock_alerts:
        _print_low_stock_alerts(low_stock_alerts)

    # ----------------------------------------------------------------
    # Step 7 — Build and return the typed HTTP 201 response
    # ----------------------------------------------------------------
    return PlaceOrderResponse(
        order_id=order_id,
        menu_item_id=body.menu_item_id,
        menu_item_name=menu_item["name"],
        quantity=body.quantity,
        table_number=body.table_number,
        created_at=str(order_row["created_at"]),
        deductions=[
            StockDeduction(
                ingredient_id=line["ingredient_id"],
                ingredient_name=line["ingredient_name"],
                unit=line["unit"],
                deducted=line["total_required"],
                remaining_stock=line["remaining_stock"],
            )
            for line in deducted_lines
        ],
        low_stock_alerts=[
            LowStockAlert(
                ingredient_name=a["ingredient_name"],
                unit=a["unit"],
                new_stock_level=a["new_stock_level"],
                low_stock_threshold=a["low_stock_threshold"],
            )
            for a in low_stock_alerts
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
    Includes table_number, kitchen_status, and is_kitchen_cleared so the
    kitchen dashboard can display where to serve and track KDS state.
    """
    response = (
        db.table("orders")
        .select(
            "id, quantity, table_number, created_at, "
            "kitchen_status, is_kitchen_cleared, "
            "menu_items(name, price)"
        )
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return response.data or []


# =============================================================================
# PATCH /orders/{order_id}/kitchen-status
# =============================================================================

@router.patch(
    "/orders/{order_id}/kitchen-status",
    response_model=KitchenStatusResponse,
    summary="Update the KDS lifecycle status of an order",
    description=(
        "Sets the ``kitchen_status`` of the specified order to one of: "
        "``'new'``, ``'preparing'``, or ``'served'``.\n\n"
        "**The financial ``status`` column is never modified by this endpoint.** "
        "Only kitchen-display state is updated."
    ),
    tags=["KDS"],
)
def update_kitchen_status(
    order_id: str,
    body: KitchenStatusUpdate,
    db: DB,
) -> KitchenStatusResponse:
    """
    Validates the requested status value against the allowed set, then issues
    a targeted UPDATE on the ``orders`` table touching **only** the
    ``kitchen_status`` column.

    Returns the updated order_id and new status on success.
    Raises:
    - **422** if the status value is not one of 'new', 'preparing', 'served'.
    - **404** if no order with that UUID exists.
    """
    # Validate the value before hitting the DB (keeps the error user-friendly)
    if body.kitchen_status not in KITCHEN_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid kitchen_status '{body.kitchen_status}'. "
                f"Allowed values: {sorted(KITCHEN_STATUSES)}."
            ),
        )

    response = (
        db.table("orders")
        .update({"kitchen_status": body.kitchen_status})
        .eq("id", order_id)
        .execute()
    )

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' not found.",
        )

    logger.info(
        "KDS | order_id=%s kitchen_status -> '%s'",
        order_id,
        body.kitchen_status,
    )

    return KitchenStatusResponse(
        order_id=order_id,
        kitchen_status=body.kitchen_status,
        message=f"Order status updated to '{body.kitchen_status}'.",
    )


# =============================================================================
# POST /orders/clear-kitchen
# =============================================================================

@router.post(
    "/orders/clear-kitchen",
    response_model=ClearKitchenResponse,
    summary="Clear today's served orders from the KDS board",
    description=(
        "Admin endpoint. Marks every order whose ``kitchen_status = 'served'`` "
        "and ``created_at`` falls on **today** (UTC) as "
        "``is_kitchen_cleared = TRUE``.\n\n"
        "This removes them from the active KDS board view **without deleting "
        "any record** — all financial data and audit logs are preserved.\n\n"
        "Returns the number of orders that were cleared."
    ),
    tags=["KDS"],
)
def clear_kitchen(db: DB) -> ClearKitchenResponse:
    """
    Bulk-clears all 'served' orders from today off the KDS board.

    Strategy
    --------
    * Filters by ``created_at`` date = today (UTC) to avoid accidentally
      clearing orders from a previous shift that were somehow left uncleared.
    * Filters ``kitchen_status = 'served'`` — only completed orders are hidden.
    * Filters ``is_kitchen_cleared = FALSE`` — idempotent: re-running has no
      additional effect on already-cleared orders.
    * Updates only ``is_kitchen_cleared``; all other columns are untouched.

    Returns
    -------
    The count of rows actually updated and the ISO date that was cleared.
    """
    today_str: str = date.today().isoformat()  # "YYYY-MM-DD"

    # Build the ISO-8601 range for today in UTC
    day_start = f"{today_str}T00:00:00+00:00"
    day_end   = f"{today_str}T23:59:59.999999+00:00"

    response = (
        db.table("orders")
        .update({"is_kitchen_cleared": True})
        .eq("kitchen_status", "served")
        .eq("is_kitchen_cleared", False)
        .gte("created_at", day_start)
        .lte("created_at", day_end)
        .execute()
    )

    cleared_rows: list[dict] = response.data or []
    cleared_count = len(cleared_rows)

    logger.info(
        "KDS | clear-kitchen: %d order(s) cleared for date %s",
        cleared_count,
        today_str,
    )

    return ClearKitchenResponse(
        message=(
            f"{cleared_count} served order(s) cleared from the KDS board."
            if cleared_count
            else "No served orders found to clear for today."
        ),
        cleared_count=cleared_count,
        cleared_date=today_str,
    )
