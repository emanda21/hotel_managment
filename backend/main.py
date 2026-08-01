"""
main.py
-------
FastAPI application entry point for the Daris Hotel Kitchen Inventory
and Menu Management System (ERP Backend v2).

Architecture
------------
All domain logic lives in focused routers:
  /inventory/   → routers/inventory.py   (store_inventory CRUD)
  /menu-items/  → routers/menu_items.py  (menu_items CRUD)
  /place_order  → routers/orders.py      (atomic order placement via RPC)
  /orders/      → routers/orders.py      (order history)

Interactive API docs: http://localhost:8000/docs
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_supabase_client
from routers import inventory, menu_items, orders, recipes, reports

# ---------------------------------------------------------------------------
# Logging — makes low-stock alerts visible with a clear prefix
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


# =============================================================================
# Cache helpers
# =============================================================================

def _warm_menu_cache(app: FastAPI) -> None:
    """
    Fetch all menu items + categories from Supabase and store them in
    app.state.menu_cache so the first customer request is instant.
    Called at startup AND by the background refresh thread every 30 s.
    """
    try:
        db = app.state.db
        rows = db.table("menu_items").select("*").order("category").order("name").execute().data or []
        cats = sorted({r["category"] for r in rows})
        app.state.menu_cache = {"items": rows, "categories": cats}
        logger.info("Menu cache warmed — %d items across %d categories.", len(rows), len(cats))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Menu cache warm failed (will retry): %s", exc)


def _start_cache_refresh(app: FastAPI, interval: int = 30) -> None:
    """
    Daemon thread that silently refreshes the menu cache every `interval`
    seconds so admins' menu edits appear to customers within half a minute
    without any customer-facing latency.
    """
    def _loop() -> None:
        while True:
            time.sleep(interval)
            _warm_menu_cache(app)

    t = threading.Thread(target=_loop, daemon=True, name="menu-cache-refresh")
    t.start()
    logger.info("Menu cache refresh thread started (every %ds).", interval)


# =============================================================================
# Lifespan — startup / shutdown
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    1. Create the shared Supabase client (unchanged from before).
    2. Pre-fetch and cache all menu items at startup → first request is instant.
    3. Launch a background thread to keep the cache fresh every 30 s.
    """
    logger.info("Starting Daris Hotel API — connecting to Supabase...")
    app.state.db = get_supabase_client()
    logger.info("Supabase client ready. API is live.")

    # Warm the menu cache immediately so the very first customer request
    # returns without hitting Supabase.
    app.state.menu_cache = {"items": [], "categories": []}  # safe default
    _warm_menu_cache(app)
    _start_cache_refresh(app, interval=30)

    yield
    logger.info("Shutting down Daris Hotel API.")


# =============================================================================
# App
# =============================================================================

app = FastAPI(
    title="Daris Hotel — Kitchen Inventory & Menu API",
    description=(
        "ERP backend for managing kitchen inventory (`store_inventory`), "
        "the customer-facing menu (`menu_items`), recipes, and atomic order "
        "processing.\n\n"
        "**Admin endpoints** require the Supabase service-role key. "
        "**Customer read endpoints** (`GET /menu-items/`) are publicly readable."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS — allow the Next.js front-end (Vercel & Localhost) to call this API.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://hotel-managment-black.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(inventory.router)
app.include_router(menu_items.router)
app.include_router(orders.router)
app.include_router(recipes.router)
app.include_router(reports.router)


# =============================================================================
# System routes
# =============================================================================

@app.get("/health", tags=["System"], summary="Liveness probe")
async def health_check() -> dict[str, str]:
    """Returns 200 OK when the service is running."""
    return {"status": "ok", "version": "2.0.0"}


# =============================================================================
# Dev entry point
# =============================================================================

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )
    