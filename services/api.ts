/**
 * services/api.ts
 * ---------------
 * Central API service layer for the Daris Hotel system.
 * All FastAPI backend calls go through this file — no component
 * should ever call fetch/axios directly.
 *
 * Base URL is read from the NEXT_PUBLIC_API_URL env variable so
 * you can point it at a deployed backend without code changes.
 */

import axios from 'axios'

// ---------------------------------------------------------------------------
// Axios instance
// ---------------------------------------------------------------------------

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type InventoryItem = {
  id: string
  name: string
  unit: string
  stock_level: number
  low_stock_threshold: number
  cost_per_unit: number
  created_at: string
  is_low_stock: boolean
}

export type MenuItem = {
  id: string
  name: string
  description: string
  price: number
  category: string
  image_url: string | null
  created_at: string
}

export type MenuItemCreate = {
  name: string
  description: string
  price: number
  category: string
  image_url?: string | null
}

export type StockDeduction = {
  ingredient_id: string
  ingredient_name: string
  unit: string
  deducted: number
  remaining_stock: number
}

export type LowStockAlert = {
  ingredient_name: string
  unit: string
  new_stock_level: number
  low_stock_threshold: number
}

export type PlaceOrderResponse = {
  order_id: string
  menu_item_id: string
  menu_item_name: string
  quantity: number
  created_at: string
  deductions: StockDeduction[]
  low_stock_alerts: LowStockAlert[]
}

export type StockShortage = {
  ingredient_id: string
  ingredient_name: string
  unit: string
  stock_level: number
  required: number
  shortfall: number
}

export type InsufficientStockError = {
  error: 'INSUFFICIENT_STOCK'
  message: string
  shortages: StockShortage[]
}

// ---------------------------------------------------------------------------
// store_inventory
// ---------------------------------------------------------------------------

/** GET /inventory/ — Returns all store_inventory items, ordered by name. */
export async function getInventory(): Promise<InventoryItem[]> {
  const { data } = await api.get<InventoryItem[]>('/inventory/')
  return data
}

/** GET /inventory/low-stock — Items below their low_stock_threshold. */
export async function getLowStockItems(): Promise<InventoryItem[]> {
  const { data } = await api.get<InventoryItem[]>('/inventory/low-stock')
  return data
}

/** POST /inventory/ — Create a new inventory item. */
export async function createInventoryItem(
  payload: Omit<InventoryItem, 'id' | 'created_at' | 'is_low_stock'>
): Promise<InventoryItem> {
  const { data } = await api.post<InventoryItem>('/inventory/', payload)
  return data
}

/** PUT /inventory/{id} — Partial update of an inventory item. */
export async function updateInventoryItem(
  id: string,
  payload: Partial<Omit<InventoryItem, 'id' | 'created_at' | 'is_low_stock'>>
): Promise<InventoryItem> {
  const { data } = await api.put<InventoryItem>(`/inventory/${id}`, payload)
  return data
}

/** DELETE /inventory/{id} — Delete an inventory item. */
export async function deleteInventoryItem(id: string): Promise<void> {
  await api.delete(`/inventory/${id}`)
}

// ---------------------------------------------------------------------------
// menu_items
// ---------------------------------------------------------------------------

/**
 * GET /menu-items/ — Returns all menu items.
 * @param category Optional category filter (e.g. "Mains", "Drinks").
 */
export async function getMenuItems(category?: string): Promise<MenuItem[]> {
  const params = category ? { category } : {}
  const { data } = await api.get<MenuItem[]>('/menu-items/', { params })
  return data
}

/** GET /menu-items/categories — Distinct category list. */
export async function getMenuCategories(): Promise<string[]> {
  const { data } = await api.get<string[]>('/menu-items/categories')
  return data
}

/** POST /menu-items/ — Create a new menu item. */
export async function createMenuItem(payload: MenuItemCreate): Promise<MenuItem> {
  const { data } = await api.post<MenuItem>('/menu-items/', payload)
  return data
}

/** PUT /menu-items/{id} — Partial update of a menu item. */
export async function updateMenuItem(
  id: string,
  payload: Partial<MenuItemCreate>
): Promise<MenuItem> {
  const { data } = await api.put<MenuItem>(`/menu-items/${id}`, payload)
  return data
}

/** DELETE /menu-items/{id} — Delete a menu item. */
export async function deleteMenuItem(id: string): Promise<void> {
  await api.delete(`/menu-items/${id}`)
}

// ---------------------------------------------------------------------------
// orders — atomic order placement
// ---------------------------------------------------------------------------

/**
 * POST /place_order — Atomically validate stock, deduct ingredients,
 * and record the order via the Supabase RPC.
 *
 * Throws an `InsufficientStockError`-shaped object (with `error === 'INSUFFICIENT_STOCK'`)
 * when stock is insufficient — callers should catch axios errors and inspect
 * `error.response.data`.
 */
export async function placeOrder(
  menuItemId: string,
  quantity: number,
  tableNumber?: number,
): Promise<PlaceOrderResponse> {
  const { data } = await api.post<PlaceOrderResponse>('/place_order', {
    menu_item_id:  menuItemId,
    quantity,
    table_number: tableNumber ?? null,
  })
  return data
}

// ---------------------------------------------------------------------------
// orders — kitchen dashboard
// ---------------------------------------------------------------------------

export type OrderRecord = {
  id: string
  quantity: number
  table_number: number | null
  created_at: string
  menu_items: {
    name:  string
    price: number
  } | null
}

/**
 * GET /orders/ — Returns all orders newest-first, joined with menu_items.
 * @param limit  Max records (default 100, max 500).
 * @param skip   Pagination offset.
 */
export async function getOrders(limit = 100, skip = 0): Promise<OrderRecord[]> {
  const { data } = await api.get<OrderRecord[]>('/orders/', {
    params: { limit, skip },
  })
  return data
}

// ---------------------------------------------------------------------------
// reports — analytics dashboard
// ---------------------------------------------------------------------------

export type RevenuePoint = { date?: string; month?: string; year?: string; revenue: number }
export type TopItem      = { name: string; total_quantity: number; total_revenue: number }
export type InventoryCostRow = {
  name: string; unit: string; stock_level: number
  cost_per_unit: number; total_value: number; is_low_stock: boolean
}

export type ReportsData = {
  kpi: {
    today_revenue:         number
    today_order_count:     number
    low_stock_count:       number
    total_revenue:         number
    total_orders:          number
    total_inventory_value: number
  }
  daily_revenue:   RevenuePoint[]
  monthly_revenue: RevenuePoint[]
  yearly_revenue:  RevenuePoint[]
  top_items:       TopItem[]
  inventory_costs: InventoryCostRow[]
}

/** GET /reports/data — All analytics aggregates in one call. */
export async function getReportsData(): Promise<ReportsData> {
  const { data } = await api.get<ReportsData>('/reports/data')
  return data
}
