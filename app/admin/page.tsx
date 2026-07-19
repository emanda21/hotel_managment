'use client'
import { useEffect, useState } from 'react'
import {
  getInventory,
  getMenuItems,
  getOrders,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
  createInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  type MenuItem,
  type InventoryItem,
  type MenuItemCreate,
  type OrderRecord,
} from '../../services/api'
import AnalyticsTab from './AnalyticsTab'

export const dynamic = 'force-dynamic'

// ============================================================
//  CREDENTIALS — Change these to your desired name & password
// ============================================================
const ADMIN_USERNAME = 'admin'      // ← Change this to your admin name
const ADMIN_PASSWORD = 'daris2024'  // ← Change this to your password
// ============================================================

const CATEGORIES = ['Starters', 'Mains', 'Desserts', 'Soft Drinks', 'Hot Drinks', 'Juices', 'Drinks']
const UNITS      = ['KG', 'Liter', 'Gram', 'Pcs', 'Spoon', 'Cup', 'ml', 'Bag']

const EMPTY_MENU_FORM: MenuItemCreate = {
  name: '', description: '', price: 0, category: 'Starters', image_url: '',
}

// Inventory form keeps numeric fields as strings while the user types
// so that mid-entry values like "0." or "" are never wiped out.
// Parsing to float happens only on save.
type InvFormState = {
  name:                string
  unit:                string
  stock_level:         string
  low_stock_threshold: string
  cost_per_unit:       string
}

const EMPTY_INV_FORM: InvFormState = {
  name: '', unit: 'KG', stock_level: '', low_stock_threshold: '', cost_per_unit: '',
}

const MAX_SIZE_MB = 2

// ============================================================
//  LOADING SKELETON
// ============================================================
function CardSkeleton() {
  return (
    <div className="premium-admin-card" style={{ opacity: 0.5 }}>
      <div style={{ width: 70, height: 70, borderRadius: 8, background: 'rgba(255,255,255,0.06)' }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ height: 14, width: '60%', borderRadius: 4, background: 'rgba(255,255,255,0.07)' }} />
        <div style={{ height: 10, width: '85%', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ height: 10, width: '30%', borderRadius: 4, background: 'rgba(197,168,128,0.15)' }} />
      </div>
    </div>
  )
}

// ============================================================
//  LOGIN SCREEN
// ============================================================
function LoginScreen({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [loading, setLoading]   = useState(false)

  function handleLogin() {
    if (!username.trim() || !password) { setError('Please enter both fields.'); return }
    setLoading(true); setError('')
    setTimeout(() => {
      if (username.trim() === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        sessionStorage.setItem('daris_admin_auth', 'true'); onLogin()
      } else { setError('Invalid username or password.') }
      setLoading(false)
    }, 600)
  }

  return (
    <div className="min-h-screen bg-stone-950 flex items-center justify-center px-4 premium-font-sans relative overflow-hidden">
      <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#C5A880]/6 rounded-full blur-3xl pointer-events-none" />
      <div className="login-card animate-fadeIn">
        <div className="login-brand">
          <div className="login-logo-ring"><span className="login-logo-inner">D</span></div>
          <h1 className="login-logo-text premium-font-serif">DARIS</h1>
          <p className="login-sublabel">Administration Portal</p>
        </div>
        <div className="login-divider"><div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#C5A880]/30 to-transparent" /></div>
        <div className="login-fields">
          <div className="form-group">
            <label className="form-label">Username</label>
            <input className="form-input" type="text" value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="Enter your username" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="password-wrapper">
              <input className="form-input password-input" type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                placeholder="Enter your password" />
              <button type="button" className="password-toggle" onClick={() => setShowPw(v => !v)}>
                {showPw ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          {error && <div className="login-error animate-fadeIn"><span>⚠</span> {error}</div>}
          <button className="login-btn" onClick={handleLogin} disabled={loading}>
            {loading
              ? <span className="login-btn-loading"><span className="premium-spinner-sm" /> Authenticating…</span>
              : 'Sign In to Console'}
          </button>
        </div>
        <p className="login-footer">DARIS Hotel &middot; Restricted Access</p>
      </div>
    </div>
  )
}

// ============================================================
//  MAIN ADMIN PAGE
// ============================================================
export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'menu' | 'inventory' | 'orders' | 'analytics'>('menu')

  // ── Menu Items state ───────────────────────────────────────
  const [items, setItems]         = useState<MenuItem[]>([])
  const [menuLoading, setMenuLoading]   = useState(true)
  const [menuError, setMenuError]       = useState('')
  const [editingId, setEditingId]       = useState<string | null>(null)
  const [menuForm, setMenuForm]         = useState<MenuItemCreate>(EMPTY_MENU_FORM)
  const [showMenuForm, setShowMenuForm] = useState(false)
  const [menuSaving, setMenuSaving]     = useState(false)
  const [uploading, setUploading]       = useState(false)
  const [menuMsg, setMenuMsg]           = useState('')

  // ── Inventory state ────────────────────────────────────────
  const [inventory, setInventory]       = useState<InventoryItem[]>([])
  const [invLoading, setInvLoading]     = useState(true)
  const [invError, setInvError]         = useState('')
  const [editingInvId, setEditingInvId] = useState<string | null>(null)
  const [invForm, setInvForm]           = useState(EMPTY_INV_FORM)
  const [showInvForm, setShowInvForm]   = useState(false)
  const [invSaving, setInvSaving]       = useState(false)
  const [invMsg, setInvMsg]             = useState('')

  // ── Orders (Live Kitchen Dashboard) state ─────────────────
  const [orders, setOrders]             = useState<OrderRecord[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [ordersError, setOrdersError]   = useState('')
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  // ── Session check ──────────────────────────────────────────
  useEffect(() => {
    setAuthenticated(sessionStorage.getItem('daris_admin_auth') === 'true')
  }, [])

  useEffect(() => {
    if (authenticated) { fetchMenuItems(); fetchInventory() }
  }, [authenticated])

  // Auto-poll orders every 15 s when the orders tab is active
  useEffect(() => {
    if (!authenticated || activeTab !== 'orders') return
    fetchOrders()
    const id = setInterval(fetchOrders, 15_000)
    return () => clearInterval(id)
  }, [authenticated, activeTab])

  function handleLogout() {
    if (!confirm('Sign out of the admin console?')) return
    sessionStorage.removeItem('daris_admin_auth')
    setAuthenticated(false)
  }

  // ============================================================
  //  MENU ITEMS — data fetching
  // ============================================================
  async function fetchMenuItems() {
    setMenuLoading(true); setMenuError('')
    try {
      const data = await getMenuItems()
      setItems(data)
    } catch {
      setMenuError('Could not load menu items. Is the FastAPI server running?')
    } finally {
      setMenuLoading(false)
    }
  }

  // ── Menu form helpers ──────────────────────────────────────
  function startAddMenu()  { setMenuForm(EMPTY_MENU_FORM); setEditingId(null); setShowMenuForm(true) }
  function cancelMenuForm(){ setShowMenuForm(false); setEditingId(null); setMenuForm(EMPTY_MENU_FORM) }

  function startEditMenu(item: MenuItem) {
    setMenuForm({ name: item.name, description: item.description || '', price: item.price, category: item.category, image_url: item.image_url || '' })
    setEditingId(item.id); setShowMenuForm(true)
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return
    const file = e.target.files[0]
    if (!file.type.startsWith('image/')) { setMenuMsg('Please select a valid image file.'); e.target.value = ''; return }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) { setMenuMsg(`Image too large. Max ${MAX_SIZE_MB}MB.`); e.target.value = ''; return }
    setUploading(true); setMenuMsg('')
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Failed to read file'))
        reader.readAsDataURL(file)
      })
      setMenuForm(prev => ({ ...prev, image_url: dataUrl }))
      setMenuMsg('Image attached successfully!')
    } catch (err: unknown) {
      setMenuMsg('Upload error: ' + (err instanceof Error ? err.message : String(err)))
    } finally { setUploading(false); e.target.value = '' }
  }

  async function saveMenuItem() {
    if (!menuForm.name.trim()) { setMenuMsg('Name is required.'); return }
    setMenuSaving(true); setMenuMsg('')
    const payload: MenuItemCreate = {
      name: menuForm.name.trim(),
      description: menuForm.description.trim(),
      price: Number(menuForm.price) || 0,
      category: menuForm.category,
      image_url: menuForm.image_url?.trim() || null,
    }
    try {
      if (editingId) {
        await updateMenuItem(editingId, payload)
        setMenuMsg('Item updated successfully!')
      } else {
        await createMenuItem(payload)
        setMenuMsg('New item added successfully!')
      }
      cancelMenuForm(); fetchMenuItems()
    } catch {
      setMenuMsg('Error saving item. Please check the API server.')
    } finally { setMenuSaving(false) }
  }

  async function handleDeleteMenuItem(id: string) {
    if (!confirm('Delete this menu item permanently?')) return
    try {
      await deleteMenuItem(id)
      setMenuMsg('Item deleted successfully.')
      fetchMenuItems()
    } catch {
      setMenuMsg('Error deleting item.')
    }
  }

  // ============================================================
  //  INVENTORY — data fetching
  // ============================================================
  async function fetchInventory() {
    setInvLoading(true); setInvError('')
    try {
      const data = await getInventory()
      setInventory(data)
    } catch {
      setInvError('Could not load inventory. Is the FastAPI server running?')
    } finally {
      setInvLoading(false)
    }
  }

  // ── Inventory form helpers ─────────────────────────────────
  function startAddInv()  { setInvForm(EMPTY_INV_FORM); setEditingInvId(null); setShowInvForm(true) }
  function cancelInvForm(){ setShowInvForm(false); setEditingInvId(null); setInvForm(EMPTY_INV_FORM) }

  function startEditInv(item: InventoryItem) {
    // Convert numbers back to strings so the input shows the stored value cleanly.
    setInvForm({
      name:                item.name,
      unit:                item.unit,
      stock_level:         String(item.stock_level),
      low_stock_threshold: String(item.low_stock_threshold),
      cost_per_unit:       String(item.cost_per_unit),
    })
    setEditingInvId(item.id); setShowInvForm(true)
  }

  async function saveInventoryItem() {
    if (!invForm.name.trim()) { setInvMsg('Name is required.'); return }

    // Parse strings to floats here — the only place numbers are needed.
    const stockLevel    = parseFloat(invForm.stock_level)
    const threshold     = parseFloat(invForm.low_stock_threshold)
    const costPerUnit   = parseFloat(invForm.cost_per_unit)

    if (isNaN(stockLevel)  || stockLevel  < 0) { setInvMsg('Stock Level must be a valid number ≥ 0.'); return }
    if (isNaN(threshold)   || threshold   < 0) { setInvMsg('Min. Threshold must be a valid number ≥ 0.'); return }
    if (isNaN(costPerUnit) || costPerUnit < 0) { setInvMsg('Cost per Unit must be a valid number ≥ 0.'); return }

    setInvSaving(true); setInvMsg('')
    const payload = {
      name:                invForm.name.trim(),
      unit:                invForm.unit,
      stock_level:         stockLevel,
      low_stock_threshold: threshold,
      cost_per_unit:       costPerUnit,
    }
    try {
      if (editingInvId) { await updateInventoryItem(editingInvId, payload); setInvMsg('Ingredient updated!') }
      else              { await createInventoryItem(payload); setInvMsg('Ingredient added!') }
      cancelInvForm(); fetchInventory()
    } catch {
      setInvMsg('Error saving ingredient. Please check the API server.')
    } finally { setInvSaving(false) }
  }

  async function handleDeleteInventory(id: string) {
    if (!confirm('Delete this ingredient? This will also remove all recipe lines referencing it.')) return
    try {
      await deleteInventoryItem(id); setInvMsg('Ingredient deleted.'); fetchInventory()
    } catch { setInvMsg('Error deleting ingredient.') }
  }

  // ============================================================
  //  ORDERS — data fetching
  // ============================================================
  async function fetchOrders() {
    setOrdersLoading(true); setOrdersError('')
    try {
      const data = await getOrders()
      setOrders(data)
      setLastRefreshed(new Date())
    } catch {
      setOrdersError('Could not load orders. Is the FastAPI server running?')
    } finally {
      setOrdersLoading(false)
    }
  }

  // ── Guard: session loading ─────────────────────────────────
  if (authenticated === null) return null
  if (!authenticated) return <LoginScreen onLogin={() => setAuthenticated(true)} />

  const groupedByCategory = CATEGORIES
    .map(cat => ({ category: cat, items: items.filter(i => i.category === cat) }))
    .filter(g => g.items.length > 0)

  const lowStockCount = inventory.filter(i => i.is_low_stock).length

  // ============================================================
  //  RENDER
  // ============================================================
  return (
    <div className="min-h-screen bg-stone-950 text-white pb-20 premium-font-sans relative overflow-x-hidden">
      <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#C5A880]/5 rounded-full blur-3xl pointer-events-none z-0" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-[#C5A880]/5 rounded-full blur-3xl pointer-events-none z-0" />

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="premium-admin-header sticky top-0 z-20">
        <div className="premium-admin-header-container max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <span className="premium-logo-text">DARIS</span>
            <span className="premium-sublabel-text">Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            {activeTab === 'menu' && (
              <button className="premium-add-btn" onClick={startAddMenu}><span className="mr-1.5">+</span>Add Item</button>
            )}
            {activeTab === 'inventory' && (
              <button className="premium-add-btn" onClick={startAddInv}><span className="mr-1.5">+</span>Add Ingredient</button>
            )}
            {activeTab === 'orders' && (
              <button className="premium-add-btn" onClick={fetchOrders} disabled={ordersLoading}>
                {ordersLoading ? <span style={{ display:'flex', alignItems:'center', gap:6 }}><span className="premium-spinner-sm" /> Refreshing…</span> : '↻ Refresh'}
              </button>
            )}
            <button className="logout-btn" onClick={handleLogout}>↩ Sign Out</button>
          </div>
        </div>

        {/* ── Tab bar ──────────────────────────────────────── */}
        <div className="max-w-5xl mx-auto px-6 flex gap-0 border-t border-white/5">
          <button
            className={`tab-btn ${activeTab === 'menu' ? 'active' : ''}`}
            onClick={() => setActiveTab('menu')}
          >
            🍽️ Menu Items
          </button>
          <button
            className={`tab-btn ${activeTab === 'inventory' ? 'active' : ''}`}
            onClick={() => setActiveTab('inventory')}
          >
            📦 Store Inventory
            {lowStockCount > 0 && (
              <span className="low-stock-badge">{lowStockCount} low</span>
            )}
          </button>
          <button
            className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            🛎️ Live Orders
            {orders.length > 0 && (
              <span className="orders-count-badge">{orders.length}</span>
            )}
          </button>
          <button
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            📈 Analytics
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 pt-8 relative z-10">

        {/* ================================================================
            TAB: MENU ITEMS
        ================================================================ */}
        {activeTab === 'menu' && (
          <>
            {/* Status message */}
            {menuMsg && (
              <div className="premium-alert animate-fadeIn">
                <span className="text-xs font-semibold tracking-wider uppercase text-[#C5A880] mr-2">System:</span>
                <span className="text-sm tracking-wide text-white/90">{menuMsg}</span>
                <button className="text-[#C5A880] hover:text-[#b0936b] ml-auto font-bold text-xs" onClick={() => setMenuMsg('')}>✕</button>
              </div>
            )}

            {/* Error */}
            {menuError && (
              <div className="premium-alert animate-fadeIn" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
                <span className="text-xs font-semibold tracking-wider uppercase text-red-400 mr-2">Error:</span>
                <span className="text-sm text-red-300">{menuError}</span>
                <button className="text-red-400 ml-auto font-bold text-xs" onClick={fetchMenuItems}>↺ Retry</button>
              </div>
            )}

            {/* Loading skeletons */}
            {menuLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map(n => <CardSkeleton key={n} />)}
              </div>
            ) : items.length === 0 && !menuError ? (
              <div className="text-center py-20 border border-dashed border-[#C5A880]/20 rounded-2xl bg-stone-900/30 backdrop-blur-sm">
                <span className="text-4xl block mb-4">📋</span>
                <h3 className="text-lg font-bold premium-font-serif text-white uppercase tracking-wider mb-2">No Menu Items Listed</h3>
                <p className="text-stone-500 text-xs max-w-sm mx-auto mb-6 leading-relaxed">
                  Your digital menu is currently empty. Click "+ Add Item" to add your first dish.
                </p>
                <button className="premium-add-btn mx-auto" onClick={startAddMenu}>+ Add First Item</button>
              </div>
            ) : (
              <div className="space-y-14">
                {groupedByCategory.map(group => (
                  <div key={group.category} className="category-group-section animate-fadeIn">
                    <div className="flex items-center gap-4 mb-6">
                      <h2 className="category-header-title premium-font-serif">{group.category}</h2>
                      <div className="flex-1 h-px bg-gradient-to-r from-[#C5A880]/30 via-[#C5A880]/5 to-transparent" />
                      <span className="text-[10px] text-stone-500 font-semibold uppercase tracking-widest">
                        {group.items.length} item{group.items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {group.items.map(item => (
                        <div key={item.id} className="premium-admin-card">
                          {item.image_url
                            ? <div className="card-image-wrapper"><img src={item.image_url} alt={item.name} className="card-image" /></div>
                            : <div className="card-image-placeholder">🍽️</div>
                          }
                          <div className="card-info">
                            <h3 className="card-name premium-font-serif">{item.name}</h3>
                            <p className="card-desc">{item.description || 'No description.'}</p>
                            <div className="card-price-row">
                              <span className="price-tag">Br {item.price}</span>
                            </div>
                          </div>
                          <div className="card-actions">
                            <button className="action-btn-edit" onClick={() => startEditMenu(item)}>Edit</button>
                            <button className="action-btn-delete" onClick={() => handleDeleteMenuItem(item.id)}>Delete</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ================================================================
            TAB: STORE INVENTORY
        ================================================================ */}
        {activeTab === 'inventory' && (
          <>
            {invMsg && (
              <div className="premium-alert animate-fadeIn">
                <span className="text-xs font-semibold tracking-wider uppercase text-[#C5A880] mr-2">System:</span>
                <span className="text-sm tracking-wide text-white/90">{invMsg}</span>
                <button className="text-[#C5A880] hover:text-[#b0936b] ml-auto font-bold text-xs" onClick={() => setInvMsg('')}>✕</button>
              </div>
            )}

            {invError && (
              <div className="premium-alert animate-fadeIn" style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
                <span className="text-xs font-semibold tracking-wider uppercase text-red-400 mr-2">Error:</span>
                <span className="text-sm text-red-300">{invError}</span>
                <button className="text-red-400 ml-auto font-bold text-xs" onClick={fetchInventory}>↺ Retry</button>
              </div>
            )}

            {/* Low-stock summary banner */}
            {!invLoading && lowStockCount > 0 && (
              <div className="animate-fadeIn" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10, padding: '12px 18px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#fca5a5', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Low Stock Alert
                  </p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                    {lowStockCount} ingredient{lowStockCount > 1 ? 's are' : ' is'} running low and need restocking.
                  </p>
                </div>
              </div>
            )}

            {invLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map(n => <CardSkeleton key={n} />)}
              </div>
            ) : inventory.length === 0 && !invError ? (
              <div className="text-center py-20 border border-dashed border-[#C5A880]/20 rounded-2xl bg-stone-900/30 backdrop-blur-sm">
                <span className="text-4xl block mb-4">📦</span>
                <h3 className="text-lg font-bold premium-font-serif text-white uppercase tracking-wider mb-2">Inventory Empty</h3>
                <p className="text-stone-500 text-xs max-w-sm mx-auto mb-6">No ingredients have been added yet.</p>
                <button className="premium-add-btn mx-auto" onClick={startAddInv}>+ Add First Ingredient</button>
              </div>
            ) : (
              <div className="inv-table-wrapper animate-fadeIn">
                <table className="inv-table">
                  <thead>
                    <tr>
                      <th>Ingredient</th>
                      <th>Unit</th>
                      <th>Stock Level</th>
                      <th>Min. Threshold</th>
                      <th>Cost / Unit</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map(item => (
                      <tr key={item.id} className={item.is_low_stock ? 'low-stock-row' : ''}>
                        <td className="inv-name">{item.name}</td>
                        <td className="inv-unit">{item.unit}</td>
                        <td className={item.is_low_stock ? 'inv-stock-low' : 'inv-stock-ok'}>
                          {item.stock_level}
                        </td>
                        <td className="inv-threshold">{item.low_stock_threshold}</td>
                        <td className="inv-cost">Br {item.cost_per_unit}</td>
                        <td>
                          {item.is_low_stock
                            ? <span className="status-badge low">⚠ Low Stock</span>
                            : <span className="status-badge ok">✓ OK</span>
                          }
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="action-btn-edit" onClick={() => startEditInv(item)}>Edit</button>
                            <button className="action-btn-delete" onClick={() => handleDeleteInventory(item.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ================================================================
            TAB: LIVE ORDERS
        ================================================================ */}
        {activeTab === 'orders' && (
          <>
            {/* Meta row: last refreshed + auto-poll notice */}
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div>
                <p style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'rgba(255,255,255,0.35)' }}>
                  Auto-refreshes every 15 seconds
                </p>
                {lastRefreshed && (
                  <p style={{ fontSize:10, color:'rgba(255,255,255,0.25)', marginTop:2 }}>
                    Last updated: {lastRefreshed.toLocaleTimeString()}
                  </p>
                )}
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#4ade80', boxShadow:'0 0 6px #4ade80', display:'inline-block', animation:'pulse 2s infinite' }} />
                <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#4ade80' }}>Live</span>
              </div>
            </div>

            {/* Error banner */}
            {ordersError && (
              <div className="premium-alert animate-fadeIn" style={{ borderColor:'rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.06)', marginBottom:20 }}>
                <span style={{ fontSize:12, fontWeight:700, textTransform:'uppercase', color:'#fca5a5', marginRight:10 }}>Error:</span>
                <span style={{ fontSize:13, color:'rgba(255,255,255,0.7)' }}>{ordersError}</span>
                <button style={{ marginLeft:'auto', color:'#fca5a5', fontWeight:700, fontSize:11, background:'transparent', border:'none', cursor:'pointer' }} onClick={fetchOrders}>↺ Retry</button>
              </div>
            )}

            {/* Loading skeletons */}
            {ordersLoading && orders.length === 0 ? (
              <div className="space-y-4">
                {[1,2,3,4,5,6].map(n => <CardSkeleton key={n} />)}
              </div>
            ) : orders.length === 0 && !ordersError ? (
              <div className="text-center py-20 border border-dashed border-[#C5A880]/20 rounded-2xl bg-stone-900/30 backdrop-blur-sm">
                <span style={{ fontSize:40, display:'block', marginBottom:16 }}>🛎️</span>
                <h3 className="text-lg font-bold premium-font-serif text-white uppercase tracking-wider" style={{ marginBottom:8 }}>No Orders Yet</h3>
                <p style={{ fontSize:12, color:'rgba(255,255,255,0.4)', maxWidth:320, margin:'0 auto 24px' }}>
                  Orders placed by customers will appear here in real time.
                </p>
                <button className="premium-add-btn" onClick={fetchOrders}>↻ Check Now</button>
              </div>
            ) : (
              <div className="orders-grid animate-fadeIn">
                {orders.map((order, idx) => {
                  const itemName  = order.menu_items?.name  ?? '—'
                  const itemPrice = order.menu_items?.price ?? 0
                  const total     = itemPrice * order.quantity
                  const date      = new Date(order.created_at)
                  const timeStr   = date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
                  const dateStr   = date.toLocaleDateString([], { month:'short', day:'numeric' })
                  const shortId   = order.id.slice(0, 8).toUpperCase()
                  const isRecent  = (Date.now() - date.getTime()) < 2 * 60 * 1000  // within 2 min

                  return (
                    <div key={order.id} className={`order-card animate-fadeIn ${isRecent ? 'order-card-new' : ''}`} style={{ animationDelay:`${idx * 0.04}s` }}>
                      {/* NEW badge */}
                      {isRecent && <span className="order-new-badge">NEW</span>}

                      {/* Order number */}
                      <div className="order-card-top">
                        <span className="order-id-text">#{shortId}</span>
                        <span className="order-time-text">{dateStr} · {timeStr}</span>
                      </div>

                      {/* Item name */}
                      <h3 className="order-item-name premium-font-serif">{itemName}</h3>

                      {/* Details row */}
                      <div className="order-details-row">
                        <div className="order-detail-chip">
                          <span className="order-detail-label">Table</span>
                          <span className="order-detail-value">{order.table_number ?? '—'}</span>
                        </div>
                        <div className="order-detail-chip">
                          <span className="order-detail-label">Qty</span>
                          <span className="order-detail-value">×{order.quantity}</span>
                        </div>
                        <div className="order-detail-chip">
                          <span className="order-detail-label">Total</span>
                          <span className="order-detail-value order-total">Br {total.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* ================================================================
            TAB: ANALYTICS
        ================================================================ */}
        {activeTab === 'analytics' && <AnalyticsTab />}

      </div>

      {/* ================================================================
          MODAL: ADD / EDIT MENU ITEM
      ================================================================ */}
      {showMenuForm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="premium-form-modal max-h-[90vh] overflow-y-auto w-full max-w-md">
            <div className="modal-header-row">
              <h2 className="modal-header-title premium-font-serif">
                {editingId ? '✦ Edit Menu Item' : '✦ Add Menu Item'}
              </h2>
              <button className="modal-close-btn" onClick={cancelMenuForm}>✕</button>
            </div>
            <div className="modal-body-form">
              <div className="form-group">
                <label className="form-label">Dish / Drink Name</label>
                <input className="form-input" value={menuForm.name}
                  onChange={e => setMenuForm({ ...menuForm, name: e.target.value })}
                  placeholder="e.g. Margherita Pizza" />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-textarea" rows={2} value={menuForm.description}
                  onChange={e => setMenuForm({ ...menuForm, description: e.target.value })}
                  placeholder="e.g. Classic tomato, mozzarella, basil" />
              </div>
              <div className="form-row-price-category">
                <div className="form-group flex-1">
                  <label className="form-label">Price (Birr)</label>
                  <input type="number" min={0} className="form-input" value={menuForm.price}
                    onChange={e => setMenuForm({ ...menuForm, price: Number(e.target.value) })} />
                  <span className="price-preview">= Br {Number(menuForm.price) || 0}</span>
                </div>
                <div className="form-group flex-1 flex flex-col">
                  <label className="form-label">Category</label>
                  <select className="form-select" value={menuForm.category}
                    onChange={e => setMenuForm({ ...menuForm, category: e.target.value })}>
                    {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Delicacy Image</label>
                {menuForm.image_url ? (
                  <div className="uploaded-preview-container">
                    <img src={menuForm.image_url} alt="Preview" className="uploaded-preview" />
                    <div className="uploaded-overlay">
                      <button type="button" className="clear-image-btn"
                        onClick={() => setMenuForm(p => ({ ...p, image_url: '' }))}>
                        Remove Image
                      </button>
                    </div>
                  </div>
                ) : (
                  <label className="file-upload-drag-box">
                    <input type="file" accept="image/*" className="hidden-file-input"
                      onChange={handleImageUpload} disabled={uploading} />
                    {uploading
                      ? <div className="flex flex-col items-center gap-2"><div className="premium-spinner-sm" /><span className="upload-text">Uploading…</span></div>
                      : <div className="flex flex-col items-center gap-2"><span className="upload-icon">📸</span><span className="upload-text">Tap to choose image</span><span className="upload-hint">PNG, JPG, WEBP — max {MAX_SIZE_MB}MB</span></div>
                    }
                  </label>
                )}
              </div>
              <div className="modal-footer-actions">
                <button className="modal-btn-cancel" onClick={cancelMenuForm}>Cancel</button>
                <button className="modal-btn-save" onClick={saveMenuItem} disabled={menuSaving || uploading}>
                  {menuSaving ? 'Processing…' : editingId ? 'Save Changes' : 'Add Item'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================
          MODAL: ADD / EDIT INVENTORY ITEM
      ================================================================ */}
      {showInvForm && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="premium-form-modal max-h-[90vh] overflow-y-auto w-full max-w-md">
            <div className="modal-header-row">
              <h2 className="modal-header-title premium-font-serif">
                {editingInvId ? '✦ Edit Ingredient' : '✦ Add Ingredient'}
              </h2>
              <button className="modal-close-btn" onClick={cancelInvForm}>✕</button>
            </div>
            <div className="modal-body-form">
              <div className="form-group">
                <label className="form-label">Ingredient Name</label>
                <input className="form-input" value={invForm.name}
                  onChange={e => setInvForm({ ...invForm, name: e.target.value })}
                  placeholder="e.g. Chicken Breast" />
              </div>
              <div className="form-group">
                <label className="form-label">Unit</label>
                <select className="form-select" value={invForm.unit}
                  onChange={e => setInvForm({ ...invForm, unit: e.target.value })}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div className="form-row-price-category">
                <div className="form-group flex-1">
                  <label className="form-label">Stock Level</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="form-input"
                    value={invForm.stock_level}
                    onChange={e => setInvForm({ ...invForm, stock_level: e.target.value })}
                    placeholder="e.g. 10.5"
                  />
                </div>
                <div className="form-group flex-1">
                  <label className="form-label">Min. Threshold</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className="form-input"
                    value={invForm.low_stock_threshold}
                    onChange={e => setInvForm({ ...invForm, low_stock_threshold: e.target.value })}
                    placeholder="e.g. 2.0"
                  />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Cost per Unit (Br)</label>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="form-input"
                  value={invForm.cost_per_unit}
                  onChange={e => setInvForm({ ...invForm, cost_per_unit: e.target.value })}
                  placeholder="e.g. 8.50"
                />
              </div>
              <div className="modal-footer-actions">
                <button className="modal-btn-cancel" onClick={cancelInvForm}>Cancel</button>
                <button className="modal-btn-save" onClick={saveInventoryItem} disabled={invSaving}>
                  {invSaving ? 'Processing…' : editingInvId ? 'Save Changes' : 'Add Ingredient'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
//  STYLESHEET
// ============================================================
const STYLESHEET = [
  "@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Lora:ital,wght@0,400;0,500;1,400&family=Montserrat:wght@300;400;500;600;700;800&display=swap');",
  ".premium-font-serif { font-family: 'Lora', Georgia, serif; }",
  ".premium-font-sans  { font-family: 'Montserrat', system-ui, -apple-system, sans-serif; }",

  // Login
  ".login-card { width:100%;max-width:400px;background:rgba(18,16,14,0.92);border:1px solid rgba(197,168,128,0.25);border-radius:20px;padding:40px 36px 32px;box-shadow:0 32px 80px rgba(0,0,0,0.7);backdrop-filter:blur(16px);position:relative;z-index:10; }",
  ".login-brand { display:flex;flex-direction:column;align-items:center;gap:10px;margin-bottom:28px; }",
  ".login-logo-ring { width:56px;height:56px;border-radius:50%;border:1.5px solid rgba(197,168,128,0.5);display:flex;align-items:center;justify-content:center;background:rgba(197,168,128,0.07); }",
  ".login-logo-inner { font-family:'Lora',Georgia,serif;font-size:26px;font-weight:700;color:#C5A880;line-height:1; }",
  ".login-logo-text { font-size:22px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em;color:#C5A880; }",
  ".login-sublabel { font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.25em;color:rgba(255,255,255,0.35); }",
  ".login-divider { margin-bottom:28px; }",
  ".login-fields { display:flex;flex-direction:column;gap:18px; }",
  ".login-error { background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:6px;padding:10px 14px;font-size:11px;font-weight:600;color:#fca5a5;letter-spacing:0.02em;display:flex;align-items:center;gap:8px; }",
  ".login-btn { width:100%;padding:13px;background:#C5A880;color:white;border:none;border-radius:8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;cursor:pointer;transition:all 0.25s ease;box-shadow:0 4px 16px rgba(197,168,128,0.2);margin-top:4px; }",
  ".login-btn:hover:not(:disabled) { background:#b0936b;transform:translateY(-1px);box-shadow:0 6px 20px rgba(197,168,128,0.3); }",
  ".login-btn:disabled { opacity:0.6;cursor:not-allowed; }",
  ".login-btn-loading { display:flex;align-items:center;justify-content:center;gap:8px; }",
  ".login-footer { text-align:center;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:0.2em;color:rgba(255,255,255,0.2);margin-top:28px; }",
  ".password-wrapper { position:relative; }",
  ".password-input { width:100%;box-sizing:border-box;padding-right:44px !important; }",
  ".password-toggle { position:absolute;right:12px;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;font-size:14px;opacity:0.5;transition:opacity 0.2s;padding:0;line-height:1; }",
  ".password-toggle:hover { opacity:1; }",
  ".logout-btn { background:transparent;border:1px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.5);border-radius:6px;padding:10px 16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;transition:all 0.2s ease; }",
  ".logout-btn:hover { border-color:rgba(255,255,255,0.35);color:white; }",

  // Header
  ".premium-admin-header { width:100%;border-bottom:1px solid rgba(197,168,128,0.15);background-color:rgba(10,10,10,0.85);backdrop-filter:blur(10px); }",
  ".premium-admin-header-container { padding:18px 24px; }",
  ".premium-logo-text { font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#C5A880;font-family:'Lora',Georgia,serif; }",
  ".premium-sublabel-text { font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.25em;color:rgba(255,255,255,0.45);margin-top:1px; }",
  ".premium-add-btn { background-color:#C5A880;color:white !important;border:none;border-radius:6px;padding:10px 20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;cursor:pointer;box-shadow:0 4px 14px rgba(197,168,128,0.2);transition:all 0.3s ease; }",
  ".premium-add-btn:hover { background-color:#b0936b;transform:translateY(-1px); }",

  // Tabs
  ".tab-btn { padding:12px 20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.4);border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;transition:all 0.2s ease;display:flex;align-items:center;gap:6px; }",
  ".tab-btn.active { color:#C5A880;border-bottom-color:#C5A880; }",
  ".tab-btn:hover:not(.active) { color:rgba(255,255,255,0.7); }",
  ".low-stock-badge { background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);color:#fca5a5;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700; }",

  // Alert
  ".premium-alert { display:flex;align-items:center;background-color:rgba(197,168,128,0.08);border:1px solid rgba(197,168,128,0.25);border-radius:8px;padding:12px 18px;margin-bottom:24px; }",

  // Spinners
  ".premium-spinner { width:32px;height:32px;border:2px solid rgba(197,168,128,0.15);border-top-color:#C5A880;border-radius:50%;animation:spinner 0.8s linear infinite; }",
  ".premium-spinner-sm { width:18px;height:18px;border:2px solid rgba(197,168,128,0.15);border-top-color:#C5A880;border-radius:50%;animation:spinner 0.8s linear infinite;display:inline-block; }",
  "@keyframes spinner { to { transform: rotate(360deg); } }",

  // Category
  ".category-header-title { font-size:18px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:white; }",

  // Cards
  ".premium-admin-card { display:flex;gap:16px;background:rgba(255,255,255,0.03);backdrop-filter:blur(10px);border:1px solid rgba(197,168,128,0.12);border-radius:12px;padding:16px;box-shadow:0 10px 30px rgba(0,0,0,0.15);transition:all 0.3s ease;position:relative;overflow:hidden; }",
  ".premium-admin-card:hover { background:rgba(255,255,255,0.05);border-color:rgba(197,168,128,0.25);transform:translateY(-2px);box-shadow:0 12px 35px rgba(0,0,0,0.25); }",
  ".card-image-wrapper { width:70px;height:70px;border-radius:8px;overflow:hidden;border:1px solid rgba(197,168,128,0.2);flex-shrink:0; }",
  ".card-image { width:100%;height:100%;object-fit:cover;transition:transform 0.5s ease; }",
  ".premium-admin-card:hover .card-image { transform:scale(1.08); }",
  ".card-image-placeholder { width:70px;height:70px;border-radius:8px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0;border:1px dashed rgba(197,168,128,0.2); }",
  ".card-info { flex-grow:1;min-width:0; }",
  ".card-name { font-size:15px;font-weight:700;color:white;margin-bottom:4px; }",
  ".card-desc { font-size:11px;color:rgba(255,255,255,0.45);line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;height:30px; }",
  ".card-price-row { display:flex;align-items:baseline;gap:6px; }",
  ".price-tag { font-size:13px;font-weight:700;color:#C5A880;font-family:'Lora',Georgia,serif; }",
  ".card-actions { display:flex;flex-direction:column;gap:8px;justify-content:center; }",
  ".action-btn-edit,.action-btn-delete { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:6px 12px;border-radius:4px;cursor:pointer;transition:all 0.2s ease;white-space:nowrap; }",
  ".action-btn-edit { border:1px solid rgba(255,255,255,0.25);background:transparent;color:white !important; }",
  ".action-btn-edit:hover { background:white;color:black !important; }",
  ".action-btn-delete { border:1px solid rgba(239,68,68,0.4);background:transparent;color:#ef4444 !important; }",
  ".action-btn-delete:hover { background:rgba(239,68,68,0.15);border-color:#ef4444; }",

  // Inventory table
  ".inv-table-wrapper { overflow-x:auto;border-radius:12px;border:1px solid rgba(197,168,128,0.15); }",
  ".inv-table { width:100%;border-collapse:collapse;font-size:12px; }",
  ".inv-table thead { background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.08); }",
  ".inv-table th { padding:12px 14px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.4); }",
  ".inv-table td { padding:13px 14px;border-bottom:1px solid rgba(255,255,255,0.05);color:rgba(255,255,255,0.8); }",
  ".inv-table tr:last-child td { border-bottom:none; }",
  ".inv-table tr:hover td { background:rgba(255,255,255,0.02); }",
  ".low-stock-row td { background:rgba(239,68,68,0.04); }",
  ".inv-name { font-weight:600;color:white; }",
  ".inv-unit { color:rgba(255,255,255,0.5);font-size:11px; }",
  ".inv-stock-ok { color:#86efac;font-weight:700; }",
  ".inv-stock-low { color:#fca5a5;font-weight:700; }",
  ".inv-threshold { color:rgba(255,255,255,0.4); }",
  ".inv-cost { color:#C5A880; }",
  ".status-badge { font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap; }",
  ".status-badge.ok { background:rgba(134,239,172,0.12);color:#86efac;border:1px solid rgba(134,239,172,0.25); }",
  ".status-badge.low { background:rgba(239,68,68,0.1);color:#fca5a5;border:1px solid rgba(239,68,68,0.3); }",

  // Modal
  ".premium-form-modal { background:#111111;border:1px solid rgba(197,168,128,0.3);border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,0.8);box-sizing:border-box;animation:modalScaleIn 0.3s cubic-bezier(0.16,1,0.3,1) forwards; }",
  "@keyframes modalScaleIn { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }",
  ".modal-header-row { display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.08); }",
  ".modal-header-title { font-size:16px;font-weight:700;color:#C5A880;text-transform:uppercase;letter-spacing:0.08em; }",
  ".modal-close-btn { background:transparent;border:none;color:rgba(255,255,255,0.4);font-size:16px;cursor:pointer;transition:color 0.2s ease; }",
  ".modal-close-btn:hover { color:white; }",
  ".modal-body-form { padding:24px;display:flex;flex-direction:column;gap:16px; }",
  ".form-group { display:flex;flex-direction:column;gap:6px; }",
  ".form-row-price-category { display:flex;gap:16px; }",
  ".form-label { font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.5); }",
  ".form-input,.form-textarea,.form-select { background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:10px 14px;font-size:13px;color:white;outline:none;transition:all 0.2s ease; }",
  ".form-input:focus,.form-textarea:focus,.form-select:focus { border-color:#C5A880;background:rgba(255,255,255,0.06);box-shadow:0 0 0 1px rgba(197,168,128,0.2); }",
  ".form-textarea { resize:vertical; }",
  ".form-select option { background:#111111;color:white; }",
  ".price-preview { font-size:10px;color:#C5A880;font-weight:600;margin-top:1px; }",
  ".modal-footer-actions { display:flex;gap:12px;margin-top:8px; }",
  ".modal-btn-cancel,.modal-btn-save { flex:1;padding:12px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;border-radius:6px;cursor:pointer;transition:all 0.2s ease; }",
  ".modal-btn-cancel { border:1px solid rgba(255,255,255,0.25);background:transparent;color:white; }",
  ".modal-btn-cancel:hover { background:rgba(255,255,255,0.05); }",
  ".modal-btn-save { border:none;background:#C5A880;color:white;box-shadow:0 4px 12px rgba(197,168,128,0.15); }",
  ".modal-btn-save:hover { background:#b0936b;transform:translateY(-1px); }",
  ".modal-btn-save:disabled { opacity:0.5;cursor:not-allowed;transform:none; }",
  ".uploaded-preview-container { width:100%;height:160px;border-radius:8px;overflow:hidden;border:1px solid rgba(197,168,128,0.3);position:relative; }",
  ".uploaded-preview { width:100%;height:100%;object-fit:cover; }",
  ".uploaded-overlay { position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s ease; }",
  ".uploaded-preview-container:hover .uploaded-overlay { opacity:1; }",
  ".clear-image-btn { background:#ef4444;color:white;border:none;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;padding:6px 12px;border-radius:4px;cursor:pointer; }",
  ".file-upload-drag-box { width:100%;height:120px;border:1px dashed rgba(197,168,128,0.3);border-radius:8px;background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all 0.3s ease; }",
  ".file-upload-drag-box:hover { background:rgba(255,255,255,0.04);border-color:#C5A880; }",
  ".hidden-file-input { display:none; }",
  ".upload-icon { font-size:24px; }",
  ".upload-text { font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);letter-spacing:0.02em; }",
  ".upload-hint { font-size:9px;color:rgba(255,255,255,0.35); }",
  "@keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }",
  ".animate-fadeIn { animation:fadeIn 0.4s cubic-bezier(0.16,1,0.3,1) forwards; }",

  // Orders tab badge
  ".orders-count-badge { background:rgba(197,168,128,0.18);border:1px solid rgba(197,168,128,0.4);color:#C5A880;font-size:9px;padding:2px 6px;border-radius:4px;font-weight:700; }",

  // Orders grid
  ".orders-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px; }",

  // Order card
  ".order-card { position:relative;background:rgba(255,255,255,0.03);border:1px solid rgba(197,168,128,0.12);border-radius:14px;padding:18px 20px;backdrop-filter:blur(8px);transition:all 0.25s ease;overflow:hidden; }",
  ".order-card:hover { background:rgba(255,255,255,0.06);border-color:rgba(197,168,128,0.28);transform:translateY(-2px);box-shadow:0 12px 32px rgba(0,0,0,0.25); }",
  ".order-card-new { border-color:rgba(74,222,128,0.35);background:rgba(74,222,128,0.04); }",
  ".order-card-new:hover { border-color:rgba(74,222,128,0.55); }",

  // NEW badge
  ".order-new-badge { position:absolute;top:14px;right:14px;background:rgba(74,222,128,0.15);border:1px solid rgba(74,222,128,0.4);color:#4ade80;font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.12em;padding:3px 7px;border-radius:4px; }",

  // Card top row
  ".order-card-top { display:flex;justify-content:space-between;align-items:center;margin-bottom:10px; }",
  ".order-id-text { font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:rgba(197,168,128,0.8); }",
  ".order-time-text { font-size:9px;font-weight:600;color:rgba(255,255,255,0.3);letter-spacing:0.04em; }",

  // Item name
  ".order-item-name { font-size:17px;font-weight:700;color:white;margin-bottom:14px;line-height:1.25; }",

  // Details chips
  ".order-details-row { display:flex;gap:8px;flex-wrap:wrap; }",
  ".order-detail-chip { background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:2px;min-width:60px; }",
  ".order-detail-label { font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:rgba(255,255,255,0.35); }",
  ".order-detail-value { font-size:13px;font-weight:700;color:white; }",
  ".order-total { color:#C5A880; }",

  // Live pulse animation
  "@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(1.3)} }",
].join("\n")