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
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import get_supabase_client
from routers import inventory, menu_items, orders, reports

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
# Lifespan — startup / shutdown
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Create the shared Supabase client on startup and store it on app.state
    so every route receives it via the get_db dependency without reconnecting.
    """
    logger.info("Starting Daris Hotel API — connecting to Supabase...")
    app.state.db = get_supabase_client()
    logger.info("Supabase client ready. API is live.")
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
# CORS — allow the Next.js front-end to call this API.
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "https://your-production-domain.com",
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
