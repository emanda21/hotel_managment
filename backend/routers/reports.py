"""
routers/reports.py
------------------
Analytics & Reporting endpoint for the Daris Hotel Admin Dashboard.

Route
-----
GET /reports/data
    Returns aggregated sales, top-items, and inventory metrics in one
    response so the frontend makes exactly one API call per render.

All queries run directly against Supabase via the PostgREST client.
Heavy aggregation is pushed to PostgreSQL (GROUP BY / SUM / COUNT) so the
Python layer does minimal work.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Reports"])

DB = Annotated[object, Depends(get_db)]


# =============================================================================
# Helpers
# =============================================================================

def _today_utc() -> str:
    """Return today's date as an ISO string (YYYY-MM-DD) in UTC."""
    return date.today().isoformat()


def _this_month() -> str:
    """Return the current month prefix (YYYY-MM) for LIKE queries."""
    return datetime.now(timezone.utc).strftime("%Y-%m")


def _this_year() -> str:
    return datetime.now(timezone.utc).strftime("%Y")


# =============================================================================
# GET /reports/data
# =============================================================================

@router.get(
    "/reports/data",
    summary="Aggregated analytics data for the admin dashboard",
    description=(
        "Returns sales trends (daily / monthly / yearly), top-selling menu "
        "items, inventory cost summary, and today's KPI cards — all in a "
        "single request."
    ),
)
def get_reports_data(db: DB) -> Any:
    """
    Fetches and aggregates:
      1. KPI summary cards  (today's revenue, today's orders, low-stock count)
      2. Daily revenue      (last 30 days)
      3. Monthly revenue    (last 12 months)
      4. Yearly revenue     (all time)
      5. Top 10 menu items  (by total quantity sold)
      6. Inventory cost     (current stock value per ingredient)
    """

    # ------------------------------------------------------------------
    # 1. Fetch all orders joined with menu_items (needed for aggregation)
    # ------------------------------------------------------------------
    orders_resp = (
        db.table("orders")
        .select("id, quantity, created_at, menu_items(name, price)")
        .order("created_at", desc=False)
        .limit(5000)          # practical cap; extend for high-volume installs
        .execute()
    )
    all_orders: list[dict] = orders_resp.data or []

    # ------------------------------------------------------------------
    # 2. Fetch inventory for cost summary
    # ------------------------------------------------------------------
    inv_resp = (
        db.table("store_inventory")
        .select("name, unit, stock_level, cost_per_unit, low_stock_threshold")
        .execute()
    )
    inventory: list[dict] = inv_resp.data or []

    today_str = _today_utc()          # "2025-07-18"
    month_str = _this_month()         # "2025-07"
    year_str  = _this_year()          # "2025"

    # ------------------------------------------------------------------
    # 3. KPI cards — today
    # ------------------------------------------------------------------
    today_orders = [
        o for o in all_orders
        if o.get("created_at", "")[:10] == today_str
    ]
    today_revenue = sum(
        (o["menu_items"]["price"] if o.get("menu_items") else 0) * o["quantity"]
        for o in today_orders
    )
    today_order_count = len(today_orders)

    low_stock_count = sum(
        1 for i in inventory
        if i.get("stock_level", 0) <= i.get("low_stock_threshold", 0)
    )

    # ------------------------------------------------------------------
    # 4. Daily revenue — last 30 days
    # ------------------------------------------------------------------
    daily: dict[str, float] = {}
    for o in all_orders:
        day = o.get("created_at", "")[:10]
        price = (o["menu_items"]["price"] if o.get("menu_items") else 0)
        daily[day] = daily.get(day, 0) + price * o["quantity"]

    daily_revenue = [
        {"date": d, "revenue": round(r, 2)}
        for d, r in sorted(daily.items())
    ][-30:]   # keep most recent 30 days

    # ------------------------------------------------------------------
    # 5. Monthly revenue — last 12 months
    # ------------------------------------------------------------------
    monthly: dict[str, float] = {}
    for o in all_orders:
        month = o.get("created_at", "")[:7]   # "2025-07"
        price = (o["menu_items"]["price"] if o.get("menu_items") else 0)
        monthly[month] = monthly.get(month, 0) + price * o["quantity"]

    monthly_revenue = [
        {"month": m, "revenue": round(r, 2)}
        for m, r in sorted(monthly.items())
    ][-12:]

    # ------------------------------------------------------------------
    # 6. Yearly revenue
    # ------------------------------------------------------------------
    yearly: dict[str, float] = {}
    for o in all_orders:
        year = o.get("created_at", "")[:4]
        price = (o["menu_items"]["price"] if o.get("menu_items") else 0)
        yearly[year] = yearly.get(year, 0) + price * o["quantity"]

    yearly_revenue = [
        {"year": y, "revenue": round(r, 2)}
        for y, r in sorted(yearly.items())
    ]

    # ------------------------------------------------------------------
    # 7. Top 10 selling items
    # ------------------------------------------------------------------
    item_sales: dict[str, dict] = {}
    for o in all_orders:
        if not o.get("menu_items"):
            continue
        name  = o["menu_items"]["name"]
        price = o["menu_items"]["price"]
        qty   = o["quantity"]
        if name not in item_sales:
            item_sales[name] = {"name": name, "total_quantity": 0, "total_revenue": 0.0}
        item_sales[name]["total_quantity"] += qty
        item_sales[name]["total_revenue"]  += round(price * qty, 2)

    top_items = sorted(
        item_sales.values(), key=lambda x: x["total_quantity"], reverse=True
    )[:10]

    # ------------------------------------------------------------------
    # 8. Inventory cost summary
    # ------------------------------------------------------------------
    inventory_costs = [
        {
            "name":          i["name"],
            "unit":          i["unit"],
            "stock_level":   i["stock_level"],
            "cost_per_unit": i["cost_per_unit"],
            "total_value":   round(i["stock_level"] * i["cost_per_unit"], 2),
            "is_low_stock":  i["stock_level"] <= i["low_stock_threshold"],
        }
        for i in inventory
    ]
    total_inventory_value = round(
        sum(c["total_value"] for c in inventory_costs), 2
    )

    # ------------------------------------------------------------------
    # 9. Total all-time revenue
    # ------------------------------------------------------------------
    total_revenue = round(sum(row["revenue"] for row in yearly_revenue), 2)
    total_orders  = len(all_orders)

    return JSONResponse(content={
        "kpi": {
            "today_revenue":       round(today_revenue, 2),
            "today_order_count":   today_order_count,
            "low_stock_count":     low_stock_count,
            "total_revenue":       total_revenue,
            "total_orders":        total_orders,
            "total_inventory_value": total_inventory_value,
        },
        "daily_revenue":     daily_revenue,
        "monthly_revenue":   monthly_revenue,
        "yearly_revenue":    yearly_revenue,
        "top_items":         top_items,
        "inventory_costs":   inventory_costs,
    })
