'use client'
/**
 * app/kitchen/page.tsx
 * --------------------
 * Kitchen Display System (KDS) — /kitchen
 *
 * Full-screen, high-contrast Kanban board designed to be read at distance
 * in a busy, noisy kitchen environment.
 *
 * Columns
 * ───────
 *  🔴  NEW ORDERS   — Incoming; alarm plays until every card is accepted.
 *  🟡  PREPARING    — Accepted by a chef; actively being cooked.
 *  🟢  SERVED       — Delivered; display-only, no buttons.
 *
 * Behaviour
 * ─────────
 *  • Polls GET /orders/ every 5 s, client-side filters is_kitchen_cleared=false.
 *  • HTML5 Audio alarm loops while any "new" order exists.
 *  • Accept  → PATCH kitchen_status = 'preparing'   (silences alarm for that ticket)
 *  • Finish  → PATCH kitchen_status = 'served'
 *  • Clear Board → POST /orders/clear-kitchen        (soft-hides today's served)
 *  • Alarm auto-stops the moment the New column is empty.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearKitchen,
  getKitchenOrders,
  updateKitchenStatus,
  type OrderRecord,
} from '../../services/api'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const POLL_MS = 5_000

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1)  return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.floor(diffMin / 60)
  return `${h}h ${diffMin % 60}m ago`
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function shortId(id: string): string {
  return `#${id.slice(0, 6).toUpperCase()}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Global CSS (injected once — no external stylesheet dependency)
// ─────────────────────────────────────────────────────────────────────────────
const KDS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body { height: 100%; }

  .kds-root {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    min-height: 100vh;
    background: #090909;
    color: #fff;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Pulsing glow on new-order cards */
  @keyframes kds-pulse {
    0%, 100% { box-shadow: 0 0 18px #ef444430; }
    50%       { box-shadow: 0 0 42px #ef444490; }
  }

  /* Alarm badge pulse */
  @keyframes alarm-pulse {
    0%, 100% { background: #7f1d1d; opacity: 1; }
    50%       { background: #dc2626; opacity: 0.9; }
  }

  /* Spinner */
  @keyframes kds-spin {
    to { transform: rotate(360deg); }
  }

  .kds-spinner {
    width: 18px; height: 18px;
    border: 3px solid rgba(255,255,255,0.15);
    border-top-color: #C5A880;
    border-radius: 50%;
    animation: kds-spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  /* Page-level spinner (loading state) */
  .kds-page-spinner {
    width: 52px; height: 52px;
    border: 5px solid #1f1f1f;
    border-top-color: #ef4444;
    border-radius: 50%;
    animation: kds-spin 0.85s linear infinite;
  }

  /* Card slide-in */
  @keyframes kds-slide-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .kds-card-enter {
    animation: kds-slide-in 0.25s ease forwards;
  }

  /* Scrollbar (column bodies) */
  .kds-col-body::-webkit-scrollbar        { width: 4px; }
  .kds-col-body::-webkit-scrollbar-track  { background: transparent; }
  .kds-col-body::-webkit-scrollbar-thumb  { background: #333; border-radius: 4px; }
`

// ─────────────────────────────────────────────────────────────────────────────
// OrderCard
// ─────────────────────────────────────────────────────────────────────────────
interface OrderCardProps {
  order:     OrderRecord
  onAccept?: () => void
  onFinish?: () => void
  busy?:     boolean
}

function OrderCard({ order, onAccept, onFinish, busy }: OrderCardProps) {
  const isNew       = order.kitchen_status === 'new'
  const isPreparing = order.kitchen_status === 'preparing'

  const borderCol = isNew ? '#ef4444' : isPreparing ? '#f59e0b' : '#22c55e'
  const accentCol = isNew ? '#fca5a5' : isPreparing ? '#fde68a' : '#86efac'

  return (
    <div
      className="kds-card-enter"
      style={{
        background:    '#151515',
        border:        `2px solid ${borderCol}`,
        borderRadius:  14,
        padding:       '18px 20px',
        display:       'flex',
        flexDirection: 'column',
        gap:           14,
        animation:     isNew ? 'kds-pulse 2s ease-in-out infinite' : undefined,
        transition:    'border-color 0.3s ease',
      }}
    >
      {/* ── Header row ─────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#666', letterSpacing: '0.08em' }}>
          {shortId(order.id)}
        </span>
        {order.table_number != null && (
          <span style={{
            background: '#1f1f1f', border: '1px solid #333', borderRadius: 6,
            padding: '3px 10px', fontSize: 13, fontWeight: 800, color: '#ddd', letterSpacing: '0.06em',
          }}>
            TABLE {order.table_number}
          </span>
        )}
      </div>

      {/* ── Dish name + qty ────────────────────────── */}
      <div>
        <p style={{ fontSize: 28, fontWeight: 900, color: '#fff', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          {order.menu_items?.name ?? '—'}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 38, fontWeight: 900, color: accentCol, lineHeight: 1 }}>
          × {order.quantity}
        </p>
      </div>

      {/* ── Timing ─────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
          {order.kitchen_status === 'served'
            ? `Served at ${fmtTime(order.created_at)}`
            : `Ordered ${timeAgo(order.created_at)}`}
        </span>
        <span style={{ fontSize: 11, color: '#444' }}>{fmtTime(order.created_at)}</span>
      </div>

      {/* ── Action buttons ─────────────────────────── */}
      {(onAccept || onFinish) && (
        <div>
          {onAccept && (
            <button
              id={`kds-accept-${order.id}`}
              onClick={onAccept}
              disabled={busy}
              style={{
                width: '100%', padding: '15px 0',
                background: busy ? '#1a1a1a' : '#15803d',
                color: busy ? '#555' : '#fff',
                border: `2px solid ${busy ? '#333' : '#16a34a'}`,
                borderRadius: 9, fontSize: 17, fontWeight: 900,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {busy ? <><span className="kds-spinner" /> Accepting…</> : '✓  Accept Order'}
            </button>
          )}
          {onFinish && (
            <button
              id={`kds-finish-${order.id}`}
              onClick={onFinish}
              disabled={busy}
              style={{
                width: '100%', padding: '15px 0',
                background: busy ? '#1a1a1a' : '#b45309',
                color: busy ? '#555' : '#fff',
                border: `2px solid ${busy ? '#333' : '#d97706'}`,
                borderRadius: 9, fontSize: 17, fontWeight: 900,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}
            >
              {busy ? <><span className="kds-spinner" /> Finishing…</> : '🍽  Mark as Served'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// KanbanColumn
// ─────────────────────────────────────────────────────────────────────────────
interface ColProps {
  title:    string
  emoji:    string
  count:    number
  color:    string
  children: React.ReactNode
}

function KanbanColumn({ title, emoji, count, color, children }: ColProps) {
  return (
    <div style={{
      flex: '1 1 0', minWidth: 280, maxWidth: 500,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        background: '#111',
        border: `2px solid ${color}`,
        borderBottom: `1px solid ${color}55`,
        borderRadius: '14px 14px 0 0',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          fontSize: 14, fontWeight: 900, color,
          textTransform: 'uppercase', letterSpacing: '0.12em',
        }}>
          {emoji}  {title}
        </span>
        <span style={{
          background: color, color: '#000',
          borderRadius: '50%', width: 34, height: 34,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 900, flexShrink: 0,
        }}>
          {count}
        </span>
      </div>

      {/* Body */}
      <div
        className="kds-col-body"
        style={{
          flex: 1,
          background: '#0d0d0d',
          border: `2px solid ${color}`,
          borderTop: 'none',
          borderRadius: '0 0 14px 14px',
          padding: 12,
          display: 'flex', flexDirection: 'column', gap: 12,
          minHeight: 220, maxHeight: 'calc(100vh - 210px)',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty-state placeholder
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '48px 0', gap: 10,
    }}>
      <span style={{ fontSize: 44 }}>{icon}</span>
      <p style={{
        color: '#333', fontSize: 12, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em',
      }}>{label}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main KDS Page
// ─────────────────────────────────────────────────────────────────────────────
export default function KitchenPage() {
  const [orders,        setOrders]        = useState<OrderRecord[]>([])
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState('')
  const [busyIds,       setBusyIds]       = useState<Set<string>>(new Set())
  const [clearing,      setClearing]      = useState(false)
  const [lastUpdated,   setLastUpdated]   = useState<Date | null>(null)
  const [alarmEnabled,  setAlarmEnabled]  = useState(true)
  const [clearMsg,      setClearMsg]      = useState('')
  const [errorMsg,      setErrorMsg]      = useState('')

  const audioRef     = useRef<HTMLAudioElement | null>(null)
  const alarmActive  = useRef(false)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Audio setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio('/alarm.mp3')
    audio.loop   = true
    audio.volume = 0.7
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
    }
  }, [])

  const startAlarm = useCallback(() => {
    if (alarmActive.current || !audioRef.current || !alarmEnabled) return
    audioRef.current.play().catch(() => { /* autoplay blocked — retried on next tick */ })
    alarmActive.current = true
  }, [alarmEnabled])

  const stopAlarm = useCallback(() => {
    if (!alarmActive.current || !audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    alarmActive.current = false
  }, [])

  // ── Data fetching ────────────────────────────────────────────────────────
  const fetchOrders = useCallback(async () => {
    try {
      const data = await getKitchenOrders()
      setOrders(data)
      setLastUpdated(new Date())
      setError('')
    } catch {
      setError('Cannot reach the kitchen server. Retrying…')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => { fetchOrders() }, [fetchOrders])

  // Polling loop
  useEffect(() => {
    pollRef.current = setInterval(fetchOrders, POLL_MS)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchOrders])

  // ── Alarm gate (reacts whenever orders or alarmEnabled changes) ──────────
  const newOrders       = orders.filter(o => o.kitchen_status === 'new')
  const preparingOrders = orders.filter(o => o.kitchen_status === 'preparing')
  const servedOrders    = orders.filter(o => o.kitchen_status === 'served')

  useEffect(() => {
    if (newOrders.length > 0 && alarmEnabled) {
      startAlarm()
    } else {
      stopAlarm()
    }
  }, [newOrders.length, alarmEnabled, startAlarm, stopAlarm])

  // Also react immediately when alarm toggle changes
  useEffect(() => {
    if (!alarmEnabled) stopAlarm()
  }, [alarmEnabled, stopAlarm])

  // ── Chef actions ─────────────────────────────────────────────────────────
  async function handleAccept(orderId: string) {
    setBusyIds(prev => new Set(prev).add(orderId))
    try {
      await updateKitchenStatus(orderId, 'preparing')
      await fetchOrders()
    } catch {
      setErrorMsg(`Failed to accept order ${shortId(orderId)}. Please try again.`)
      setTimeout(() => setErrorMsg(''), 5_000)
    } finally {
      setBusyIds(prev => { const s = new Set(prev); s.delete(orderId); return s })
    }
  }

  async function handleFinish(orderId: string) {
    setBusyIds(prev => new Set(prev).add(orderId))
    try {
      await updateKitchenStatus(orderId, 'served')
      await fetchOrders()
    } catch {
      setErrorMsg(`Failed to mark ${shortId(orderId)} as served. Please try again.`)
      setTimeout(() => setErrorMsg(''), 5_000)
    } finally {
      setBusyIds(prev => { const s = new Set(prev); s.delete(orderId); return s })
    }
  }

  async function handleClearBoard() {
    if (!confirm(
      "Clear today's served orders from the KDS board?\n\n" +
      "This is a soft-hide — no records are deleted.\n" +
      "All inventory deductions and financial data are preserved."
    )) return
    setClearing(true)
    try {
      const res = await clearKitchen()
      setClearMsg(res.message)
      await fetchOrders()
      setTimeout(() => setClearMsg(''), 6_000)
    } catch {
      setErrorMsg('Failed to clear the board. Is the backend running?')
      setTimeout(() => setErrorMsg(''), 5_000)
    } finally {
      setClearing(false)
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KDS_CSS }} />

      <div className="kds-root">

        {/* ══════════════════════════════════════════ TOP BAR */}
        <header style={{
          background: '#0f0f0f',
          borderBottom: '2px solid #1a1a1a',
          padding: '0 20px',
          height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: 16, flexWrap: 'wrap',
        }}>

          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 30 }}>👨‍🍳</span>
            <div>
              <p style={{ fontSize: 17, fontWeight: 900, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                Kitchen Display
              </p>
              <p style={{ fontSize: 9, color: '#444', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 3 }}>
                Daris Hotel · KDS
              </p>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>

            {/* Alarm indicator — pulses when new orders exist */}
            {newOrders.length > 0 && alarmEnabled && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: '2px solid #ef4444', borderRadius: 9,
                padding: '6px 14px',
                animation: 'alarm-pulse 1.1s ease-in-out infinite',
              }}>
                <span style={{ fontSize: 17 }}>🔔</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#fca5a5', letterSpacing: '0.06em' }}>
                  {newOrders.length} NEW ORDER{newOrders.length !== 1 ? 'S' : ''}
                </span>
              </div>
            )}

            {/* Last updated */}
            {lastUpdated && !loading && (
              <span style={{ fontSize: 10, color: '#333', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}

            {/* Alarm toggle */}
            <button
              id="kds-alarm-toggle"
              onClick={() => setAlarmEnabled(v => !v)}
              style={{
                background: alarmEnabled ? 'rgba(239,68,68,0.08)' : '#111',
                border: `2px solid ${alarmEnabled ? '#ef4444' : '#333'}`,
                color: alarmEnabled ? '#fca5a5' : '#555',
                borderRadius: 8, padding: '7px 14px',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
                letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
              }}
            >
              {alarmEnabled ? '🔔 Alarm ON' : '🔕 Alarm OFF'}
            </button>

            {/* Clear board */}
            <button
              id="kds-clear-board"
              onClick={handleClearBoard}
              disabled={clearing || servedOrders.length === 0}
              style={{
                background: servedOrders.length === 0 ? '#111' : 'rgba(34,197,94,0.07)',
                border: `2px solid ${servedOrders.length === 0 ? '#222' : '#22c55e'}`,
                color: servedOrders.length === 0 ? '#333' : '#86efac',
                borderRadius: 8, padding: '7px 14px',
                fontSize: 12, fontWeight: 700,
                cursor: servedOrders.length === 0 || clearing ? 'not-allowed' : 'pointer',
                letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {clearing
                ? <><span className="kds-spinner" /> Clearing…</>
                : `🧹 Clear (${servedOrders.length})`}
            </button>

            {/* Back to site */}
            <a
              href="/"
              style={{
                background: '#111', border: '1px solid #2a2a2a',
                color: '#555', borderRadius: 8, padding: '7px 14px',
                fontSize: 11, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase', textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              ← Home
            </a>
          </div>
        </header>

        {/* ══════════════════════════════════════════ BANNERS */}
        {error && (
          <div style={{
            background: '#1a0808', borderBottom: '2px solid #ef4444',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', flex: 1 }}>
              ⚠  {error}
            </span>
            <button onClick={() => setError('')}
              style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 20, cursor: 'pointer' }}>
              ×
            </button>
          </div>
        )}

        {errorMsg && (
          <div style={{
            background: '#1a0808', borderBottom: '2px solid #ef4444',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', flex: 1 }}>
              ✗  {errorMsg}
            </span>
            <button onClick={() => setErrorMsg('')}
              style={{ background: 'none', border: 'none', color: '#fca5a5', fontSize: 20, cursor: 'pointer' }}>
              ×
            </button>
          </div>
        )}

        {clearMsg && (
          <div style={{
            background: '#051a0a', borderBottom: '2px solid #22c55e',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#86efac', flex: 1 }}>
              ✓  {clearMsg}
            </span>
            <button onClick={() => setClearMsg('')}
              style={{ background: 'none', border: 'none', color: '#86efac', fontSize: 20, cursor: 'pointer' }}>
              ×
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════ LOADING */}
        {loading && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 20,
          }}>
            <div className="kds-page-spinner" />
            <p style={{ color: '#444', fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Loading kitchen orders…
            </p>
          </div>
        )}

        {/* ══════════════════════════════════════════ KANBAN BOARD */}
        {!loading && (
          <main style={{
            flex: 1,
            display: 'flex', gap: 16, padding: '16px 16px',
            alignItems: 'flex-start', overflowY: 'auto',
          }}>

            {/* ─────────── 🔴 NEW ORDERS ─────────── */}
            <KanbanColumn title="New Orders" emoji="🔴" count={newOrders.length} color="#ef4444">
              {newOrders.length === 0
                ? <EmptyState icon="✅" label="All clear" />
                : newOrders.map(o => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onAccept={() => handleAccept(o.id)}
                      busy={busyIds.has(o.id)}
                    />
                  ))
              }
            </KanbanColumn>

            {/* ─────────── 🟡 PREPARING ─────────── */}
            <KanbanColumn title="Preparing" emoji="🟡" count={preparingOrders.length} color="#f59e0b">
              {preparingOrders.length === 0
                ? <EmptyState icon="🍳" label="Nothing cooking" />
                : preparingOrders.map(o => (
                    <OrderCard
                      key={o.id}
                      order={o}
                      onFinish={() => handleFinish(o.id)}
                      busy={busyIds.has(o.id)}
                    />
                  ))
              }
            </KanbanColumn>

            {/* ─────────── 🟢 SERVED ─────────── */}
            <KanbanColumn title="Served" emoji="🟢" count={servedOrders.length} color="#22c55e">
              {servedOrders.length === 0
                ? <EmptyState icon="🍽️" label="No completed orders" />
                : servedOrders.map(o => (
                    <OrderCard key={o.id} order={o} />
                  ))
              }
            </KanbanColumn>

          </main>
        )}

        {/* ══════════════════════════════════════════ FOOTER STRIP */}
        <footer style={{
          background: '#0f0f0f', borderTop: '1px solid #1a1a1a',
          padding: '8px 20px',
          display: 'flex', alignItems: 'center', gap: 28,
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          {[
            { label: 'New',       value: newOrders.length,       color: '#ef4444' },
            { label: 'Preparing', value: preparingOrders.length, color: '#f59e0b' },
            { label: 'Served',    value: servedOrders.length,    color: '#22c55e' },
            { label: 'Active',    value: orders.length,          color: '#555'    },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 9, color: '#333', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {s.label}
              </span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#252525', letterSpacing: '0.08em' }}>
            Auto-refresh every {POLL_MS / 1000}s
          </span>
        </footer>

      </div>
    </>
  )
}
