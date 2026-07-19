'use client'
export const dynamic = 'force-dynamic'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabaseClient'

type MenuItem = { id: number; name: string }
type OrderItem = { id: number; order_id: number; quantity: number; menu_item_id: number }
type Order = { id: number; table_number: number; status: string; created_at: string }
type Tab = 'new' | 'preparing' | 'served'

export default function Dashboard() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('new')
  const [newCardIds, setNewCardIds] = useState<Set<number>>(new Set())

  // Track which order IDs we've already seen so we can animate only truly new ones
  const knownIds = useRef<Set<number>>(new Set())

  // Debounce timer for realtime — batch rapid incoming events into one fetch
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Login state
  const [loggedIn, setLoggedIn] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')

  const VALID_USERNAME = 'kitchen'
  const VALID_PASSWORD = 'daris2026'

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('daris_kitchen_session') : null
    if (saved === '1') setLoggedIn(true)
    setAuthChecked(true)
  }, [])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (username === VALID_USERNAME && password === VALID_PASSWORD) {
      window.localStorage.setItem('daris_kitchen_session', '1')
      setLoggedIn(true)
      setLoginError('')
    } else {
      setLoginError('Incorrect username or password.')
    }
  }

  function handleLogout() {
    window.localStorage.removeItem('daris_kitchen_session')
    setLoggedIn(false)
  }

  // Full fetch — only called on mount and on error recovery
  async function fetchAll() {
    const { data: ordersData } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })

    const { data: itemsData } = await supabase.from('order_items').select('*')
    const { data: menuData } = await supabase.from('order_menu').select('*')

    const incoming = (ordersData || []) as Order[]

    // Find truly new IDs (not seen before) to animate only them
    const brandNew = new Set<number>()
    incoming.forEach((o) => {
      if (!knownIds.current.has(o.id)) {
        brandNew.add(o.id)
        knownIds.current.add(o.id)
      }
    })

    if (brandNew.size > 0) {
      setNewCardIds(brandNew)
      // Clear the "new" flag after animation completes (500ms)
      setTimeout(() => setNewCardIds(new Set()), 500)
    }

    setOrders(incoming)
    setOrderItems((itemsData || []) as OrderItem[])
    setMenuItems((menuData || []) as MenuItem[])
    setLoading(false)
  }

  // Handle a single order update from realtime — merge into state without full re-fetch
  function mergeOrderUpdate(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
    if (payload.eventType === 'UPDATE') {
      const updated = payload.new as Order
      setOrders((prev) =>
        prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o))
      )
    } else if (payload.eventType === 'INSERT') {
      const inserted = payload.new as Order
      setOrders((prev) => {
        if (prev.find((o) => o.id === inserted.id)) return prev
        // Insert at top (newest first)
        const next = [inserted, ...prev]
        knownIds.current.add(inserted.id)
        setNewCardIds(new Set([inserted.id]))
        setTimeout(() => setNewCardIds(new Set()), 500)
        return next
      })
    } else if (payload.eventType === 'DELETE') {
      const deleted = payload.old as { id: number }
      setOrders((prev) => prev.filter((o) => o.id !== deleted.id))
    } else {
      // Unknown event — debounced full re-fetch as safety net
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
      realtimeTimer.current = setTimeout(fetchAll, 300)
    }
  }

  // Handle a single order_item update from realtime — merge into state without full re-fetch.
  // This is the piece that was missing: order_items were only ever loaded once on mount,
  // so items belonging to orders created after that point never showed up ("No items registered").
  function mergeOrderItemUpdate(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
    if (payload.eventType === 'INSERT') {
      const inserted = payload.new as OrderItem
      setOrderItems((prev) => {
        if (prev.find((oi) => oi.id === inserted.id)) return prev
        return [...prev, inserted]
      })
    } else if (payload.eventType === 'UPDATE') {
      const updated = payload.new as OrderItem
      setOrderItems((prev) =>
        prev.map((oi) => (oi.id === updated.id ? { ...oi, ...updated } : oi))
      )
    } else if (payload.eventType === 'DELETE') {
      const deleted = payload.old as { id: number }
      setOrderItems((prev) => prev.filter((oi) => oi.id !== deleted.id))
    } else {
      // Unknown event — debounced full re-fetch as safety net
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
      realtimeTimer.current = setTimeout(fetchAll, 300)
    }
  }

  // Handle a single menu item update from realtime — merge into state without full re-fetch.
  // The dashboard only fetched order_menu once on login, so any item added or renamed in
  // the admin panel after that point was invisible here, showing "Item #<id>" instead of
  // the real dish name on order cards. Subscribing keeps menu names always in sync.
  function mergeMenuItemUpdate(payload: { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }) {
    if (payload.eventType === 'INSERT') {
      const inserted = payload.new as MenuItem
      setMenuItems((prev) => {
        if (prev.find((m) => m.id === inserted.id)) return prev
        return [...prev, inserted]
      })
    } else if (payload.eventType === 'UPDATE') {
      const updated = payload.new as MenuItem
      setMenuItems((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
      )
    } else if (payload.eventType === 'DELETE') {
      const deleted = payload.old as { id: number }
      setMenuItems((prev) => prev.filter((m) => m.id !== deleted.id))
    } else {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
      realtimeTimer.current = setTimeout(fetchAll, 300)
    }
  }

  useEffect(() => {
    if (!loggedIn) return

    fetchAll()

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          // For INSERT/UPDATE/DELETE we merge locally — no re-fetch, no blink
          mergeOrderUpdate(payload as Parameters<typeof mergeOrderUpdate>[0])
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        (payload) => {
          mergeOrderItemUpdate(payload as Parameters<typeof mergeOrderItemUpdate>[0])
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_menu' },
        (payload) => {
          mergeMenuItemUpdate(payload as Parameters<typeof mergeMenuItemUpdate>[0])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    }
  }, [loggedIn])

  // Optimistic status update — instant local state change, no flicker
  async function updateStatus(orderId: number, newStatus: string) {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
    )

    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus })
      .eq('id', orderId)

    if (error) {
      console.error(error)
      fetchAll() // revert on failure
    }
    // No fetchAll() on success — realtime merge handles it smoothly
  }

  function getMenuName(menuItemId: number) {
    const found = menuItems.find((m) => String(m.id) === String(menuItemId))
    return found ? found.name : `Item #${menuItemId}`
  }

  // Sorted newest first within each status
  const newOrders = orders.filter((o) => o.status === 'new')
  const preparingOrders = orders.filter((o) => o.status === 'preparing')
  const servedOrders = orders.filter((o) => o.status === 'served')

  function OrderCard({ order }: { order: Order }) {
    const itemsForOrder = orderItems.filter((oi) => oi.order_id === order.id)
    const time = new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const isNew = newCardIds.has(order.id)

    return (
      <div className={`premium-order-card${isNew ? ' card-slide-in' : ''}`}>
        <div className="card-header">
          <h3 className="table-title premium-font-serif">Table {order.table_number}</h3>
          <span className="order-time">{time}</span>
        </div>
        <p className="order-number">Order Ref: #{order.id}</p>

        <ul className="order-items-list">
          {itemsForOrder.map((oi) => (
            <li key={oi.id} className="item-row">
              <span className="item-qty">{oi.quantity}×</span>
              <span className="item-name">{getMenuName(oi.menu_item_id)}</span>
            </li>
          ))}
          {itemsForOrder.length === 0 && <li className="item-row-empty">No items registered</li>}
        </ul>

        <div className="card-actions">
          {order.status === 'new' && (
            <button className="action-btn-prepare" onClick={() => updateStatus(order.id, 'preparing')}>
              🔥 Start Preparing
            </button>
          )}
          {order.status === 'preparing' && (
            <button className="action-btn-serve" onClick={() => updateStatus(order.id, 'served')}>
              ✅ Serve Order
            </button>
          )}
          {order.status === 'served' && (
            <div className="status-badge-delivered">
              <span className="dot"></span> Delivered to Table
            </div>
          )}
        </div>
      </div>
    )
  }

  const tabConfig: Record<Tab, { label: string; dotClass: string; pillClass: string; list: Order[]; emptyEmoji: string; emptyText: string }> = {
    new: { label: 'New Orders', dotClass: 'status-new-dot', pillClass: 'pill-new', list: newOrders, emptyEmoji: '🛎️', emptyText: 'All caught up. No new orders.' },
    preparing: { label: 'Preparing', dotClass: 'status-prep-dot', pillClass: 'pill-prep', list: preparingOrders, emptyEmoji: '🍳', emptyText: 'Kitchen is quiet. Nothing cooking.' },
    served: { label: 'Served', dotClass: 'status-served-dot', pillClass: 'pill-served', list: servedOrders, emptyEmoji: '🍽️', emptyText: 'No orders served in this session.' },
  }

  const current = tabConfig[activeTab]

  if (!authChecked) return null

  if (!loggedIn) {
    return (
      <div className="min-h-screen text-white premium-font-sans relative overflow-x-hidden flex items-center justify-center">
        <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />
        <div className="kitchen-bg"></div>
        <div className="login-card">
          <div className="login-logo premium-font-serif">DARIS</div>
          <div className="login-sublabel">Kitchen Dashboard Access</div>
          <form onSubmit={handleLogin}>
            <div className="login-field">
              <label className="login-label" htmlFor="username">Username</label>
              <input id="username" className="login-input" type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div className="login-field">
              <label className="login-label" htmlFor="password">Password</label>
              <input id="password" className="login-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            {loginError && <div className="login-error">{loginError}</div>}
            <button className="login-submit" type="submit">Enter Kitchen</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-white pb-20 premium-font-sans relative overflow-x-hidden">
      <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />
      <div className="kitchen-bg"></div>
      <div className="absolute top-0 left-1/3 w-[500px] h-[500px] bg-[#C5A880]/5 rounded-full blur-[120px] pointer-events-none z-0"></div>

      <header className="premium-admin-header sticky top-0 z-20">
        <div className="premium-admin-header-container max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="flex flex-col">
            <span className="premium-logo-text">DARIS</span>
            <span className="premium-sublabel-text">Kitchen Dashboard</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="realtime-badge">
              <span className="pulse-dot"></span> Live Sync Active
            </div>
            <div className="total-badge">
              <span className="badge-count">{newOrders.length}</span> New Requests
            </div>
            <button className="logout-btn" onClick={handleLogout}>Log Out</button>
          </div>
        </div>
      </header>

      {/* Tab Selector */}
      <div className="max-w-6xl mx-auto px-6 pt-8 relative z-10">
        <div className="tab-selector">
          {(Object.keys(tabConfig) as Tab[]).map((tabKey) => {
            const cfg = tabConfig[tabKey]
            return (
              <button
                key={tabKey}
                className={`tab-btn${activeTab === tabKey ? ' tab-btn-active' : ''}`}
                onClick={() => setActiveTab(tabKey)}
              >
                <span className={`status-dot ${cfg.dotClass}`}></span>
                {cfg.label}
                <span className={`count-pill ${cfg.pillClass}`}>{cfg.list.length}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Active Tab Content */}
      <div className="max-w-6xl mx-auto px-6 pt-8 relative z-10">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-40 gap-4">
            <div className="premium-spinner"></div>
            <p className="text-stone-400 text-[10px] uppercase tracking-widest font-bold">Connecting to order database...</p>
          </div>
        ) : (
          <div className="column-section">
            <div className="column-header mb-6">
              <span className={`status-dot ${current.dotClass}`}></span>
              <h2 className="column-title premium-font-serif">{current.label}</h2>
              <span className={`count-pill ${current.pillClass}`}>{current.list.length}</span>
            </div>
            <div className="cards-grid">
              {current.list.length === 0 && (
                <div className="empty-column-placeholder">
                  <span className="emoji">{current.emptyEmoji}</span>
                  <p className="text">{current.emptyText}</p>
                </div>
              )}
              {current.list.map((order) => (
                <OrderCard key={order.id} order={order} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const STYLESHEET = `
@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Lora:ital,wght@0,400;0,500;1,400&family=Montserrat:wght@300;400;500;600;700;800&display=swap');

.premium-font-serif { font-family: 'Lora', Georgia, serif; }
.premium-font-sans { font-family: 'Montserrat', system-ui, -apple-system, sans-serif; }

.kitchen-bg {
  position: fixed; inset: 0; z-index: -1;
  background-image:
    linear-gradient(180deg, rgba(8,8,8,0.88) 0%, rgba(8,8,8,0.93) 50%, rgba(8,8,8,0.97) 100%),
    url('https://images.unsplash.com/photo-1556910103-1c02745aae4d?q=80&w=1920&auto=format&fit=crop');
  background-size: cover; background-position: center; background-attachment: fixed;
}

/* LOGIN */
.login-card { position: relative; z-index: 10; width: 100%; max-width: 380px; background: rgba(10,10,10,0.72); backdrop-filter: blur(16px); border: 1px solid rgba(197,168,128,0.2); border-radius: 16px; padding: 40px 32px; box-shadow: 0 30px 60px rgba(0,0,0,0.5); }
.login-logo { font-size: 30px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.18em; color: #C5A880; text-align: center; }
.login-sublabel { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.25em; color: rgba(255,255,255,0.4); text-align: center; margin-top: 4px; margin-bottom: 32px; }
.login-field { margin-bottom: 16px; }
.login-label { display: block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); margin-bottom: 6px; }
.login-input { width: 100%; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 12px 14px; font-size: 14px; color: white; font-family: 'Montserrat', system-ui, sans-serif; outline: none; transition: border-color 0.2s ease; }
.login-input:focus { border-color: #C5A880; background: rgba(255,255,255,0.06); }
.login-error { color: #ef4444; font-size: 12px; font-weight: 600; margin-bottom: 14px; text-align: center; }
.login-submit { width: 100%; background: #C5A880; color: #0a0a0a; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; padding: 13px; border-radius: 8px; border: none; cursor: pointer; margin-top: 8px; transition: all 0.2s ease; }
.login-submit:hover { background: #d9bd92; box-shadow: 0 6px 18px rgba(197,168,128,0.3); }

/* HEADER */
.premium-admin-header { width: 100%; border-bottom: 1px solid rgba(197,168,128,0.15); background-color: rgba(10,10,10,0.85); backdrop-filter: blur(10px); }
.premium-admin-header-container { padding: 18px 24px; }
.premium-logo-text { font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.15em; color: #C5A880; font-family: 'Lora', Georgia, serif; }
.premium-sublabel-text { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.25em; color: rgba(255,255,255,0.45); margin-top: 1px; }
.realtime-badge { display: flex; align-items: center; gap: 8px; background: rgba(197,168,128,0.08); border: 1px solid rgba(197,168,128,0.2); color: #C5A880; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; padding: 8px 14px; border-radius: 6px; }
.pulse-dot { width: 6px; height: 6px; background: #C5A880; border-radius: 50%; animation: pulseDot 1.8s infinite; }
@keyframes pulseDot { 0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(197,168,128,0.5); } 70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(197,168,128,0); } 100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(197,168,128,0); } }
.total-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: white; display: flex; align-items: center; gap: 8px; }
.badge-count { background: #c2410c; color: white; font-size: 11px; font-weight: 800; padding: 2px 8px; border-radius: 20px; }
.logout-btn { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.5); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); padding: 8px 14px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; }
.logout-btn:hover { color: white; border-color: rgba(239,68,68,0.4); background: rgba(239,68,68,0.08); }

/* TABS */
.tab-selector { display: flex; gap: 10px; flex-wrap: wrap; }
.tab-btn { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; padding: 12px 18px; border-radius: 10px; cursor: pointer; transition: all 0.2s ease; font-family: 'Montserrat', system-ui, sans-serif; }
.tab-btn:hover { color: white; background: rgba(255,255,255,0.05); border-color: rgba(197,168,128,0.2); }
.tab-btn-active { color: white; background: rgba(197,168,128,0.12); border-color: rgba(197,168,128,0.4); box-shadow: 0 4px 14px rgba(197,168,128,0.15); }

/* SPINNER */
.premium-spinner { width: 32px; height: 32px; border: 2px solid rgba(197,168,128,0.15); border-top-color: #C5A880; border-radius: 50%; animation: spinner 0.8s linear infinite; }
@keyframes spinner { to { transform: rotate(360deg); } }

/* COLUMN */
.column-section { display: flex; flex-direction: column; }
.column-header { display: flex; align-items: center; gap: 10px; border-bottom: 2px solid rgba(255,255,255,0.04); padding-bottom: 12px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-new-dot { background: #ef4444; box-shadow: 0 0 10px rgba(239,68,68,0.45); }
.status-prep-dot { background: #f59e0b; box-shadow: 0 0 10px rgba(245,158,11,0.45); }
.status-served-dot { background: #10b981; box-shadow: 0 0 10px rgba(16,185,129,0.45); }
.column-title { font-size: 16px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: white; }
.count-pill { font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 12px; margin-left: auto; }
.pill-new { background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); color: #ef4444; }
.pill-prep { background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.25); color: #f59e0b; }
.pill-served { background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.25); color: #10b981; }

/* CARDS GRID — multiple orders fill row-by-row, newest first */
.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; align-items: start; }

.empty-column-placeholder { text-align: center; padding: 60px 16px; border: 1px dashed rgba(255,255,255,0.06); border-radius: 12px; background: rgba(255,255,255,0.01); grid-column: 1 / -1; }
.empty-column-placeholder .emoji { font-size: 28px; display: block; margin-bottom: 10px; opacity: 0.45; }
.empty-column-placeholder .text { font-size: 12px; color: rgba(255,255,255,0.35); font-weight: 500; }

/* ORDER CARD — no animation class by default, only new cards get card-slide-in */
.premium-order-card { background: rgba(255,255,255,0.03); backdrop-filter: blur(10px); border: 1px solid rgba(197,168,128,0.15); border-radius: 12px; padding: 18px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); transition: background 0.3s ease, border-color 0.3s ease, transform 0.3s ease; }
.premium-order-card:hover { background: rgba(255,255,255,0.05); border-color: rgba(197,168,128,0.3); transform: translateY(-1px); }
.card-slide-in { animation: slideIn 0.35s cubic-bezier(0.16,1,0.3,1) forwards; }
@keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.table-title { font-size: 16px; font-weight: 700; color: white; }
.order-time { font-size: 11px; font-weight: 700; color: #C5A880; font-family: 'Lora', Georgia, serif; }
.order-number { font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: rgba(255,255,255,0.35); margin-bottom: 14px; }
.order-items-list { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid rgba(255,255,255,0.06); border-bottom: 1px solid rgba(255,255,255,0.06); padding: 12px 0; margin-bottom: 14px; }
.item-row { display: flex; gap: 8px; font-size: 13px; color: rgba(255,255,255,0.8); align-items: baseline; }
.item-qty { color: #C5A880; font-weight: 700; font-size: 12px; }
.item-name { font-weight: 500; }
.item-row-empty { font-size: 12px; font-style: italic; color: rgba(255,255,255,0.3); }
.card-actions { display: flex; gap: 8px; }
.action-btn-prepare, .action-btn-serve { flex: 1; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 10px; border-radius: 6px; cursor: pointer; transition: all 0.2s ease; border: none; }
.action-btn-prepare { background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); color: #f59e0b; }
.action-btn-prepare:hover { background: #f59e0b; color: black; box-shadow: 0 4px 12px rgba(245,158,11,0.25); }
.action-btn-serve { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: #10b981; }
.action-btn-serve:hover { background: #10b981; color: white; box-shadow: 0 4px 12px rgba(16,185,129,0.25); }
.status-badge-delivered { display: flex; align-items: center; gap: 6px; color: #10b981; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 4px auto 0; }
.status-badge-delivered .dot { width: 5px; height: 5px; background: #10b981; border-radius: 50%; }
`