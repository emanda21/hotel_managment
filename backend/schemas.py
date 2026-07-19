"""
schemas.py
----------
All Pydantic v2 models (request bodies, response shapes) for the
Daris Hotel Inventory & Menu Management System.

Naming convention:
  <Resource>Create   – fields required when creating a new record (POST)
  <Resource>Update   – all fields optional (PUT / PATCH)
  <Resource>Response – what the API returns (includes id, created_at, etc.)
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# =============================================================================
# store_inventory
# =============================================================================

class InventoryItemCreate(BaseModel):
    """Request body for creating a new inventory item (POST /inventory/)."""

    name: str = Field(..., min_length=1, description="Ingredient name.", examples=["Chicken Breast"])
    unit: str = Field(..., min_length=1, description="Unit of measurement (KG, Liter, Gram, Pcs, …).", examples=["KG"])
    stock_level: float = Field(..., ge=0, description="Current available stock.", examples=[10.0])
    low_stock_threshold: float = Field(..., ge=0, description="Alert threshold for admin dashboard.", examples=[2.0])
    cost_per_unit: float = Field(..., ge=0, description="Purchase cost per unit (for financial reports).", examples=[8.50])


class InventoryItemUpdate(BaseModel):
    """Request body for updating an inventory item (PUT /inventory/{id}).
    All fields are optional — send only the ones you want to change."""

    name: Optional[str] = Field(None, min_length=1)
    unit: Optional[str] = Field(None, min_length=1)
    stock_level: Optional[float] = Field(None, ge=0)
    low_stock_threshold: Optional[float] = Field(None, ge=0)
    cost_per_unit: Optional[float] = Field(None, ge=0)


class InventoryItemResponse(BaseModel):
    """Full inventory item representation returned by the API."""

    id: str
    name: str
    unit: str
    stock_level: float
    low_stock_threshold: float
    cost_per_unit: float
    created_at: datetime
    # Convenience flag — True when stock is below the threshold.
    is_low_stock: bool = Field(False, description="True when stock_level < low_stock_threshold.")

    @classmethod
    def from_row(cls, row: dict) -> "InventoryItemResponse":
        """Build from a raw Supabase row dict."""
        return cls(
            **row,
            is_low_stock=row["stock_level"] < row["low_stock_threshold"],
        )


# =============================================================================
# menu_items
# =============================================================================

class MenuItemCreate(BaseModel):
    """Request body for creating a new menu item (POST /menu-items/)."""

    name: str = Field(..., min_length=1, description="Dish or beverage name.", examples=["Grilled Chicken"])
    description: str = Field("", description="Customer-facing description.")
    price: float = Field(..., ge=0, description="Selling price.", examples=[18.50])
    category: str = Field(..., min_length=1, description="e.g. Starters, Mains, Drinks, Desserts.", examples=["Mains"])
    image_url: Optional[str] = Field(None, description="Optional Supabase Storage URL for the dish image.")


class MenuItemUpdate(BaseModel):
    """Request body for updating a menu item (PUT /menu-items/{id}).
    All fields are optional — send only the ones you want to change."""

    name: Optional[str] = Field(None, min_length=1)
    description: Optional[str] = None
    price: Optional[float] = Field(None, ge=0)
    category: Optional[str] = Field(None, min_length=1)
    image_url: Optional[str] = None


class MenuItemResponse(BaseModel):
    """Full menu item representation returned by the API."""

    id: str
    name: str
    description: str
    price: float
    category: str
    image_url: Optional[str]
    created_at: datetime


# =============================================================================
# recipes
# =============================================================================

class RecipeLineCreate(BaseModel):
    """Request body for adding a recipe line (POST /recipes/)."""

    menu_item_id: str = Field(..., description="UUID of the parent menu item.")
    ingredient_id: str = Field(..., description="UUID of the ingredient from store_inventory.")
    quantity_needed: float = Field(..., gt=0, description="Amount of the ingredient per single serving.")


class RecipeLineResponse(BaseModel):
    """Full recipe line representation returned by the API."""

    id: str
    menu_item_id: str
    ingredient_id: str
    quantity_needed: float
    # Joined fields (populated when ?expand=true is supported)
    ingredient_name: Optional[str] = None
    unit: Optional[str] = None


# =============================================================================
# Shared / generic
# =============================================================================

class DeleteResponse(BaseModel):
    """Standard response body for successful DELETE operations."""

    message: str
    deleted_id: str


class ErrorResponse(BaseModel):
    """Standard error envelope."""

    error: str
    detail: str


# =============================================================================
# orders / place_order
# =============================================================================

class PlaceOrderRequest(BaseModel):
    """Request body for POST /place_order."""

    menu_item_id: str = Field(
        ...,
        description="UUID of the menu item to order.",
        examples=["3fa85f64-5717-4562-b3fc-2c963f66afa6"],
    )
    quantity: int = Field(
        ...,
        ge=1,
        description="Number of servings (must be >= 1).",
        examples=[2],
    )
    table_number: Optional[int] = Field(
        None,
        ge=1,
        description="Table number where the order originates. Optional but strongly encouraged.",
        examples=[5],
    )


class StockDeduction(BaseModel):
    """Per-ingredient stock deduction recorded by the atomic RPC."""

    ingredient_id: str
    ingredient_name: str
    unit: str
    deducted: float
    remaining_stock: float


class LowStockAlert(BaseModel):
    """Ingredient that dropped to or below its low_stock_threshold."""

    ingredient_name: str
    unit: str
    new_stock_level: float
    low_stock_threshold: float


class PlaceOrderResponse(BaseModel):
    """Success payload returned by POST /place_order (HTTP 201)."""

    order_id: str
    menu_item_id: str
    menu_item_name: str
    quantity: int
    table_number: Optional[int] = None
    created_at: str
    deductions: list[StockDeduction]
    low_stock_alerts: list[LowStockAlert] = []


class StockShortage(BaseModel):
    """Details of one ingredient that has insufficient stock."""

    ingredient_id: str
    ingredient_name: str
    unit: str
    stock_level: float
    required: float
    shortfall: float


class InsufficientStockResponse(BaseModel):
    """Error payload returned when one or more ingredients are short (HTTP 400)."""

    error: str = "INSUFFICIENT_STOCK"
    message: str
    shortages: list[StockShortage]
