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
    Admin endpoint: marks ALL 'served' orders (no date restriction) as
    is_kitchen_cleared = TRUE so they disappear from the KDS board
    without deleting any financial or audit records.

DELETE /orders/delete-all-served
    Admin endpoint: permanently deletes ALL orders whose
    kitchen_status = 'served' from the database. This is a hard delete
    — records are gone permanently. Audit logs in inventory_logs are
    preserved (foreign key references are nullified or kept by design).
"""

from __future__ import annotations

import json
import logging
import traceback
from datetime import date, datetime, timedelta, timezone
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
    DeleteAllServedResponse,
    DeleteResponse,
    InsufficientStockResponse,
    KITCHEN_STATUSES,
    KitchenStatusResponse,
    KitchenStatusUpdate,
    LowStockAlert,
    MarkOrderServedResponse,
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
                "p_menu_item_id":          body.menu_item_id,
                "p_quantity":              body.quantity,
                "p_table_number":          body.table_number,
                "p_room_number":           body.room_number,
                "p_special_instructions":  body.special_instructions,
                "p_waiter_id":             body.waiter_id,
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
        room_number=payload.get("room_number"),
        special_instructions=payload.get("special_instructions"),
        waiter_id=payload.get("waiter_id"),
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
        "place_order_python | menu_item=%s (%s) qty=%d room=%s",
        menu_item["name"],
        body.menu_item_id,
        body.quantity,
        body.room_number,
    )

    # ----------------------------------------------------------------
    # Step 2 — Record the order (no stock check or deduction)
    # Stock is now deducted atomically when the chef marks served via
    # the mark_order_served RPC (called by PATCH kitchen-status).
    # ----------------------------------------------------------------
    order_row = record_order(
        db,
        menu_item_id=body.menu_item_id,
        quantity=body.quantity,
        table_number=body.table_number,
    )
    order_id: str = order_row["id"]

    logger.info(
        "place_order_python | order created order_id=%s (deduction deferred to serve)",
        order_id,
    )

    # ----------------------------------------------------------------
    # Return the response — deductions and low_stock_alerts are empty
    # until the order is served.
    # ----------------------------------------------------------------
    return PlaceOrderResponse(
        order_id=order_id,
        menu_item_id=body.menu_item_id,
        menu_item_name=menu_item["name"],
        quantity=body.quantity,
        table_number=body.table_number,
        room_number=body.room_number,
        special_instructions=body.special_instructions,
        waiter_id=body.waiter_id,
        created_at=str(order_row["created_at"]),
        deductions=[],
        low_stock_alerts=[],
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
    Includes table_number, room_number, special_instructions, kitchen_status,
    and is_kitchen_cleared so the kitchen dashboard can display delivery
    location, chef notes, and track KDS state.
    """
    response = (
        db.table("orders")
        .select(
            "id, quantity, table_number, room_number, special_instructions, "
            "waiter_id, created_at, kitchen_status, is_kitchen_cleared, "
            "prep_time_minutes, target_serve_time, "
            "menu_items(name, price)"
        )
        .order("created_at", desc=True)
        .range(skip, skip + limit - 1)
        .execute()
    )
    return response.data or []


# =============================================================================
# DELETE /orders/{order_id}
# =============================================================================

@router.delete(
    "/orders/{order_id}",
    response_model=DeleteResponse,
    summary="Permanently delete an order (admin only — no date restriction)",
    description=(
        "Hard-deletes a single order row from the database regardless of its "
        "creation date. Admins can use this to remove orders from any day, "
        "not just today. Related ``inventory_logs`` rows are **not** deleted "
        "so the audit trail remains intact."
    ),
    tags=["Orders"],
)
def delete_order(order_id: str, db: DB) -> DeleteResponse:
    """
    Permanently removes the specified order row.

    - No date filter — works on orders from any day.
    - Returns 404 if the order does not exist.
    - Inventory audit logs referencing this order are preserved.
    """
    response = (
        db.table("orders")
        .delete()
        .eq("id", order_id)
        .execute()
    )
    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order '{order_id}' not found.",
        )
    logger.info("Admin | order_id=%s permanently deleted", order_id)
    return DeleteResponse(
        message="Order deleted successfully.",
        deleted_id=order_id,
    )



@router.patch(
    "/orders/{order_id}/kitchen-status",
    response_model=KitchenStatusResponse,
    summary="Update the KDS lifecycle status of an order",
    description=(
        "Sets the ``kitchen_status`` of the specified order to one of: "
        "``'new'``, ``'preparing'``, or ``'served'``.\n\n"
        "When the status transitions to **``'served'``**, this endpoint calls the "
        "``mark_order_served`` Supabase RPC, which atomically:\n"
        "1. Updates ``kitchen_status`` → ``'served'``.\n"
        "2. Deducts consumed quantities from ``store_inventory``.\n"
        "3. Writes audit rows to ``inventory_logs`` "
        "   (``reason = 'ORDER_SERVED_DEDUCTION'``).\n\n"
        "Transitions to ``'new'`` or ``'preparing'`` use a plain UPDATE "
        "(no stock changes).\n\n"
        "**The financial ``status`` column is never modified by this endpoint.**"
    ),
    tags=["KDS"],
)
def update_kitchen_status(
    order_id: str,
    body: KitchenStatusUpdate,
    db: DB,
) -> KitchenStatusResponse:
    """
    Routes the status transition:

    - 'new' / 'preparing'  → plain UPDATE on orders.kitchen_status (no stock change)
    - 'served'             → calls mark_order_served RPC (atomic status + deduction)

    Returns KitchenStatusResponse on success.
    Raises:
    - **422** for invalid status values.
    - **404** if the order does not exist.
    - **409** if the order is already served.
    - **400** if stock is insufficient to fulfil the deduction (served path only).
    """
    # Validate the value before hitting the DB
    if body.kitchen_status not in KITCHEN_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid kitchen_status '{body.kitchen_status}'. "
                f"Allowed values: {sorted(KITCHEN_STATUSES)}."
            ),
        )

    # ──────────────────────────────────────────────────────────────────
    # 'served' path — call mark_order_served RPC (atomic deduction)
    # ──────────────────────────────────────────────────────────────────
    if body.kitchen_status == "served":
        logger.info(
            "KDS | order_id=%s — calling mark_order_served RPC",
            order_id,
        )
        print(f"[KDS DEBUG] mark_order_served RPC called for order_id={order_id}", flush=True)
        try:
            rpc_response = db.rpc(
                "mark_order_served",
                {"p_order_id": order_id},
            ).execute()

            # ── CRITICAL FIX: Supabase returns RPC results as a list ──────────
            # rpc_response.data is [{ ... }] not { ... }.
            # If we call .get() on a list we get AttributeError which then gets
            # swallowed by the generic except block, making the deduction appear
            # to succeed on the frontend while actually failing silently.
            raw = rpc_response.data
            print(f"[KDS DEBUG] mark_order_served raw response type={type(raw).__name__!r} value={raw!r}", flush=True)
            logger.info("KDS | mark_order_served raw response: %r", raw)

            if isinstance(raw, list):
                payload: dict = raw[0] if raw else {}
            elif isinstance(raw, dict):
                payload = raw
            else:
                payload = {}

        except Exception as exc:
            error_str = str(exc)
            tb_str = traceback.format_exc()

            # Print full traceback so it is visible in server logs
            print(f"[KDS ERROR] mark_order_served EXCEPTION for order_id={order_id}:", flush=True)
            print(tb_str, flush=True)
            logger.error(
                "KDS | mark_order_served EXCEPTION for order_id=%s: %s\n%s",
                order_id, error_str, tb_str,
            )

            if "ORDER_NOT_FOUND" in error_str:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Order '{order_id}' not found.",
                ) from exc

            if "ALREADY_SERVED" in error_str:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Order '{order_id}' has already been marked as served.",
                ) from exc

            if "INSUFFICIENT_STOCK" in error_str:
                # Extract shortage JSON if present
                _, _, shortages = _parse_rpc_error(error_str)
                return JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={
                        "error":    "INSUFFICIENT_STOCK",
                        "message":  "Cannot serve order: insufficient stock for one or more ingredients.",
                        "shortages": shortages,
                    },
                )

            logger.error("Unexpected DB error in mark_order_served RPC: %s", error_str)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Database error: {error_str}",
            ) from exc

        # Log low-stock alerts to the server console
        alerts: list[dict] = payload.get("low_stock_alerts", [])
        if alerts:
            _print_low_stock_alerts(alerts)

        deductions_count = len(payload.get("deductions", []))
        print(f"[KDS DEBUG] mark_order_served SUCCESS — {deductions_count} deduction(s) for order_id={order_id}", flush=True)
        logger.info(
            "KDS | order_id=%s marked as served — %d ingredient(s) deducted",
            order_id,
            deductions_count,
        )

        return KitchenStatusResponse(
            order_id=order_id,
            kitchen_status="served",
            message="Order marked as served. Inventory deducted.",
        )

    # ──────────────────────────────────────────────────────────────────
    # 'new' / 'preparing' path — plain UPDATE, no stock changes
    # ──────────────────────────────────────────────────────────────────
    update_payload: dict[str, Any] = {"kitchen_status": body.kitchen_status}

    # When transitioning to 'preparing', optionally save the chef's
    # estimated prep time and compute the absolute deadline.
    if body.kitchen_status == "preparing" and body.prep_time_minutes is not None:
        target_dt = datetime.now(timezone.utc) + timedelta(minutes=body.prep_time_minutes)
        update_payload["prep_time_minutes"]  = body.prep_time_minutes
        update_payload["target_serve_time"]  = target_dt.isoformat()
        print(
            f"[KDS DEBUG] order_id={order_id} prep_time={body.prep_time_minutes}m "
            f"target_serve_time={target_dt.isoformat()}",
            flush=True,
        )
        logger.info(
            "KDS | order_id=%s prep_time=%dm target_serve_time=%s",
            order_id, body.prep_time_minutes, target_dt.isoformat(),
        )

    response = (
        db.table("orders")
        .update(update_payload)
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
# =============================================================================
# POST /orders/clear-kitchen
# =============================================================================

@router.post(
    "/orders/clear-kitchen",
    response_model=ClearKitchenResponse,
    summary="Clear ALL served orders from the KDS board (no date restriction)",
    description=(
        "Admin endpoint. Marks **every** order whose ``kitchen_status = 'served'`` "
        "as ``is_kitchen_cleared = TRUE``, regardless of creation date.\n\n"
        "This removes them from the active KDS board view **without deleting "
        "any record** — all financial data and audit logs are preserved.\n\n"
        "Operation is idempotent: re-running does not affect already-cleared orders.\n\n"
        "Returns the number of orders that were cleared."
    ),
    tags=["KDS"],
)
def clear_kitchen(db: DB) -> ClearKitchenResponse:
    """
    Bulk-clears ALL 'served' orders from the KDS board — no date restriction.

    Strategy
    --------
    * Filters ``kitchen_status = 'served'`` — only completed orders are hidden.
    * Filters ``is_kitchen_cleared = FALSE`` — idempotent: already-cleared orders
      are unaffected.
    * Updates only ``is_kitchen_cleared``; all other columns are untouched.
    * No date filter — clears served orders from any day.

    Returns
    -------
    The count of rows actually updated.
    """
    response = (
        db.table("orders")
        .update({"is_kitchen_cleared": True})
        .eq("kitchen_status", "served")
        .eq("is_kitchen_cleared", False)
        .execute()
    )

    cleared_rows: list[dict] = response.data or []
    cleared_count = len(cleared_rows)

    cleared_date = date.today().isoformat()
    logger.info(
        "KDS | clear-kitchen (all dates): %d order(s) soft-cleared",
        cleared_count,
    )

    return ClearKitchenResponse(
        message=(
            f"{cleared_count} served order(s) cleared from the KDS board."
            if cleared_count
            else "No uncleared served orders found."
        ),
        cleared_count=cleared_count,
        cleared_date=cleared_date,
    )


# =============================================================================
# DELETE /orders/delete-all-served
# =============================================================================

@router.delete(
    "/orders/delete-all-served",
    response_model=DeleteAllServedResponse,
    summary="Permanently delete ALL served orders (admin only)",
    description=(
        "Hard-deletes **every** order row whose ``kitchen_status = 'served'`` "
        "from the database, regardless of creation date.\n\n"
        "**This is a destructive, permanent action — records cannot be "
        "recovered.** Related ``inventory_logs`` rows are preserved so "
        "the audit trail remains intact.\n\n"
        "Intended for end-of-day or end-of-week cleanup by an admin after "
        "the kitchen board has been reviewed."
    ),
    tags=["KDS"],
)
def delete_all_served_orders(db: DB) -> DeleteAllServedResponse:
    """
    Permanently removes all orders with kitchen_status = 'served'.

    - No date filter — deletes served orders from any day.
    - Returns the count of deleted rows.
    - Inventory audit logs are NOT deleted (audit trail preserved).
    """
    response = (
        db.table("orders")
        .delete()
        .eq("kitchen_status", "served")
        .execute()
    )

    deleted_rows: list[dict] = response.data or []
    deleted_count = len(deleted_rows)

    logger.warning(
        "Admin | delete-all-served: %d order(s) permanently deleted",
        deleted_count,
    )

    return DeleteAllServedResponse(
        message=(
            f"{deleted_count} served order(s) permanently deleted from the database."
            if deleted_count
            else "No served orders found to delete."
        ),
        deleted_count=deleted_count,
    )
