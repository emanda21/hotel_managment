'use client'
/**
 * app/kitchen/page.tsx
 * --------------------
 * Kitchen Display System (KDS) — /kitchen
 *
 * Columns
 * ───────
 *  🔴  NEW ORDERS   — Incoming; new-order alarm plays until every card is accepted.
 *  🟡  PREPARING    — Accepted by a chef; active countdown shows remaining time.
 *                     Overdue alarm plays if deadline is exceeded.
 *  🟢  SERVED       — Delivered; display-only, no buttons.
 *
 * Infinite-loop prevention
 * ─────────────────────────
 *  overdueIds is NOT React state. It is computed DURING render from `preparingOrders`
 *  and `nowMs` (derived from `tickCount` state). This means:
 *    • No setOverdueIds() call inside any interval → no render triggered by overdue check
 *    • The only re-render from the 1-second ticker is `setTickCount(n => n+1)` which is
 *      a stable functional update and NEVER causes a cascade
 *    • All alarm side-effects are handled inside a single useEffect that reads a ref
 *      for overdue state, not React state
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

function fmtCountdown(totalSeconds: number, overdue: boolean): string {
  const abs = Math.abs(Math.floor(totalSeconds))
  const m   = Math.floor(abs / 60)
  const s   = abs % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return overdue ? `+${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Audio — Overdue alarm (Web Audio API, no file needed)
// ─────────────────────────────────────────────────────────────────────────────
let _overdueCtx: AudioContext | null = null
let _overdueTimer: ReturnType<typeof setInterval> | null = null

function _playBurst() {
  try {
    if (!_overdueCtx) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Ctx = window.AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      _overdueCtx = new Ctx()
    }
    const ctx = _overdueCtx
    if (ctx.state === 'suspended') ctx.resume();
    [880, 1046, 1318].forEach((freq, i) => {
      const osc  = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'square'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.13
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.35, t + 0.02)
      gain.gain.setValueAtTime(0.35, t + 0.09)
      gain.gain.linearRampToValueAtTime(0, t + 0.12)
      osc.start(t); osc.stop(t + 0.13)
    })
  } catch { /* silently ignore AudioContext errors */ }
}

function startOverdueAlarm() {
  if (_overdueTimer) return
  _playBurst()
  _overdueTimer = setInterval(_playBurst, 1800)
}

function stopOverdueAlarm() {
  if (_overdueTimer) { clearInterval(_overdueTimer); _overdueTimer = null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Global CSS
// ─────────────────────────────────────────────────────────────────────────────
const KDS_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }

  .kds-root {
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    min-height: 100vh; background: #090909; color: #fff;
    display: flex; flex-direction: column; overflow: hidden;
  }

  @keyframes kds-pulse {
    0%, 100% { box-shadow: 0 0 18px #ef444430; }
    50%       { box-shadow: 0 0 42px #ef444490; }
  }
  @keyframes kds-overdue-flash {
    0%, 100% { border-color: #ef4444; box-shadow: 0 0 18px #ef444440; }
    50%       { border-color: #ff0000; box-shadow: 0 0 52px #ef4444cc; }
  }
  @keyframes alarm-pulse {
    0%, 100% { background: #7f1d1d; opacity: 1; }
    50%       { background: #dc2626; opacity: 0.9; }
  }
  @keyframes overdue-badge-pulse {
    0%, 100% { background: #991b1b; transform: scale(1); }
    50%       { background: #ef4444; transform: scale(1.06); }
  }
  @keyframes countdown-tick {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.7; }
  }
  @keyframes kds-spin { to { transform: rotate(360deg); } }
  @keyframes kds-slide-in {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .kds-spinner {
    width: 18px; height: 18px;
    border: 3px solid rgba(255,255,255,0.15);
    border-top-color: #C5A880; border-radius: 50%;
    animation: kds-spin 0.75s linear infinite; flex-shrink: 0;
  }
  .kds-page-spinner {
    width: 52px; height: 52px;
    border: 5px solid #1f1f1f; border-top-color: #ef4444;
    border-radius: 50%; animation: kds-spin 0.85s linear infinite;
  }
  .kds-card-enter { animation: kds-slide-in 0.25s ease forwards; }
  .kds-col-body::-webkit-scrollbar        { width: 4px; }
  .kds-col-body::-webkit-scrollbar-track  { background: transparent; }
  .kds-col-body::-webkit-scrollbar-thumb  { background: #333; border-radius: 4px; }

  .prep-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.75);
    display: flex; align-items: center; justify-content: center;
    z-index: 9999; backdrop-filter: blur(4px);
  }
  .prep-modal-box {
    background: #161616; border: 2px solid #f59e0b; border-radius: 18px;
    padding: 28px 32px; width: 360px; max-width: 95vw;
    display: flex; flex-direction: column; gap: 18px;
    box-shadow: 0 0 60px #f59e0b30; animation: kds-slide-in 0.2s ease forwards;
  }
`

// ─────────────────────────────────────────────────────────────────────────────
// PrepTimeModal
// ─────────────────────────────────────────────────────────────────────────────
interface PrepTimeModalProps {
  orderId:   string
  orderName: string
  onConfirm: (orderId: string, minutes: number | null) => void
  onCancel:  () => void
}

function PrepTimeModal({ orderId, orderName, onConfirm, onCancel }: PrepTimeModalProps) {
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseInt(inputVal.trim(), 10)
    const minutes = (!isNaN(parsed) && parsed >= 1 && parsed <= 480) ? parsed : null
    onConfirm(orderId, minutes)
  }

  return (
    <div className="prep-modal-overlay" onClick={onCancel}
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}>
      <div className="prep-modal-box" onClick={e => e.stopPropagation()}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase',
            letterSpacing: '0.14em', color: '#f59e0b', marginBottom: 6 }}>
            ⏱️  Set Prep Timer
          </p>
          <p style={{ fontSize: 18, fontWeight: 900, color: '#fff', lineHeight: 1.3 }}>{orderName}</p>
          <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{shortId(orderId)}</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#888',
              textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: 8 }}>
              Estimated Prep Time (minutes)
            </label>
            <input
              ref={inputRef}
              id="prep-time-input"
              type="number"
              min={1} max={480}
              placeholder="e.g. 15"
              value={inputVal}
              onChange={e => setInputVal(e.target.value)}
              style={{
                width: '100%', background: '#111', border: '2px solid #333',
                borderRadius: 9, padding: '12px 14px', color: '#fff',
                fontSize: 22, fontWeight: 900, outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={e  => { e.currentTarget.style.borderColor = '#f59e0b' }}
              onBlur={e   => { e.currentTarget.style.borderColor = '#333' }}
            />
            <p style={{ fontSize: 11, color: '#555', marginTop: 6 }}>
              Leave blank to accept without a timer.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onCancel}
              style={{ flex: 1, padding: '12px 0', background: 'transparent',
                border: '2px solid #333', borderRadius: 9, color: '#666', fontSize: 14,
                fontWeight: 700, cursor: 'pointer', letterSpacing: '0.06em',
                textTransform: 'uppercase' }}>
              Cancel
            </button>
            <button id="prep-modal-confirm" type="submit"
              style={{ flex: 2, padding: '12px 0', background: '#15803d',
                border: '2px solid #16a34a', borderRadius: 9, color: '#fff', fontSize: 14,
                fontWeight: 900, cursor: 'pointer', letterSpacing: '0.06em',
                textTransform: 'uppercase' }}>
              ✓  Accept Order
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CountdownDisplay — self-contained, owns its own 1-second timer.
// Lives entirely within the child; parent is NOT involved in its ticking.
// ─────────────────────────────────────────────────────────────────────────────
interface CountdownDisplayProps {
  targetServeTime: string | null
}

function CountdownDisplay({ targetServeTime }: CountdownDisplayProps) {
  const [secsLeft, setSecsLeft] = useState<number | null>(null)

  useEffect(() => {
    if (!targetServeTime) { setSecsLeft(null); return }
    const target = new Date(targetServeTime).getTime()
    const tick = () => setSecsLeft(Math.floor((target - Date.now()) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [targetServeTime])

  if (secsLeft === null) return null

  const overdue = secsLeft < 0
  const color   = overdue ? '#ef4444' : secsLeft < 120 ? '#f59e0b' : '#22c55e'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      borderRadius: 8, padding: '8px 12px',
      background: overdue ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.08)',
      border: `1.5px solid ${overdue ? '#ef4444' : '#22c55e'}44`,
      animation: overdue ? 'overdue-badge-pulse 0.9s ease-in-out infinite' : undefined,
    }}>
      <span style={{ fontSize: 15 }}>{overdue ? '🚨' : '⏱️'}</span>
      <div>
        <p style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: overdue ? '#fca5a5' : '#86efac', marginBottom: 2 }}>
          {overdue ? 'OVERDUE' : 'REMAINING'}
        </p>
        <p style={{ fontSize: 20, fontWeight: 900, color, fontVariantNumeric: 'tabular-nums',
          lineHeight: 1, letterSpacing: '0.04em',
          animation: overdue ? undefined : 'countdown-tick 1s ease infinite' }}>
          {fmtCountdown(secsLeft, overdue)}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// OrderCard
// ─────────────────────────────────────────────────────────────────────────────
interface OrderCardProps {
  order:    OrderRecord
  onAccept?: () => void
  onFinish?: () => void
  busy?:    boolean
  overdue?: boolean
}

function OrderCard({ order, onAccept, onFinish, busy, overdue }: OrderCardProps) {
  const isNew       = order.kitchen_status === 'new'
  const isPreparing = order.kitchen_status === 'preparing'

  const borderCol = overdue ? '#ef4444' : isNew ? '#ef4444' : isPreparing ? '#f59e0b' : '#22c55e'
  const accentCol = isNew ? '#fca5a5' : isPreparing ? '#fde68a' : '#86efac'

  const cardAnimation = overdue
    ? 'kds-overdue-flash 0.8s ease-in-out infinite'
    : isNew
      ? 'kds-pulse 2s ease-in-out infinite'
      : undefined

  return (
    <div className="kds-card-enter" style={{
      background: '#151515', border: `2px solid ${borderCol}`,
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 14,
      animation: cardAnimation, transition: 'border-color 0.3s ease',
    }}>

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
          color: '#666', letterSpacing: '0.08em' }}>
          {shortId(order.id)}
        </span>
        {order.room_number != null ? (
          <span style={{ background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.45)', borderRadius: 6,
            padding: '3px 10px', fontSize: 13, fontWeight: 800,
            color: '#a5b4fc', letterSpacing: '0.06em' }}>
            🏨 ROOM {order.room_number}
          </span>
        ) : order.table_number != null ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ background: '#1f1f1f', border: '1px solid #333',
              borderRadius: 6, padding: '3px 10px', fontSize: 13,
              fontWeight: 800, color: '#ddd', letterSpacing: '0.06em' }}>
              TABLE {order.table_number}
            </span>
            {order.waiter_id && (
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888',
                letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                👤 {order.waiter_id}
              </span>
            )}
          </div>
        ) : null}
      </div>

      {/* Special instructions */}
      {order.special_instructions && (
        <div style={{ background: 'rgba(251,191,36,0.12)',
          border: '1px solid rgba(251,191,36,0.45)', borderRadius: 8,
          padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1.3 }}>⚠️</span>
          <div>
            <p style={{ fontSize: 9, fontWeight: 900, textTransform: 'uppercase',
              letterSpacing: '0.14em', color: '#fbbf24', marginBottom: 4 }}>Chef Note</p>
            <p style={{ fontSize: 13, color: '#fde68a', lineHeight: 1.5, fontWeight: 600 }}>
              {order.special_instructions}
            </p>
          </div>
        </div>
      )}

      {/* Dish name + qty */}
      <div>
        <p style={{ fontSize: 28, fontWeight: 900, color: '#fff',
          lineHeight: 1.15, letterSpacing: '-0.02em' }}>
          {order.menu_items?.name ?? '—'}
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 38, fontWeight: 900,
          color: accentCol, lineHeight: 1 }}>
          × {order.quantity}
        </p>
      </div>

      {/* Countdown Timer (PREPARING only) */}
      {isPreparing && order.target_serve_time && (
        <CountdownDisplay targetServeTime={order.target_serve_time} />
      )}

      {/* Timestamp */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
          {order.kitchen_status === 'served'
            ? `Served at ${fmtTime(order.created_at)}`
            : `Ordered ${timeAgo(order.created_at)}`}
        </span>
        <span style={{ fontSize: 11, color: '#444' }}>{fmtTime(order.created_at)}</span>
      </div>

      {/* Action buttons */}
      {(onAccept || onFinish) && (
        <div>
          {onAccept && (
            <button id={`kds-accept-${order.id}`} onClick={onAccept} disabled={busy}
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
              }}>
              {busy ? <><span className="kds-spinner" /> Accepting…</> : '✓  Accept Order'}
            </button>
          )}
          {onFinish && (
            <button id={`kds-finish-${order.id}`} onClick={onFinish} disabled={busy}
              style={{
                width: '100%', padding: '15px 0',
                background: busy ? '#1a1a1a' : overdue ? '#7f1d1d' : '#b45309',
                color: busy ? '#555' : '#fff',
                border: `2px solid ${busy ? '#333' : overdue ? '#ef4444' : '#d97706'}`,
                borderRadius: 9, fontSize: 17, fontWeight: 900,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                cursor: busy ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s ease',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              }}>
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
  title: string; emoji: string; count: number; color: string; children: React.ReactNode
}

function KanbanColumn({ title, emoji, count, color, children }: ColProps) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 280, maxWidth: 500,
      display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: '#111', border: `2px solid ${color}`,
        borderBottom: `1px solid ${color}55`, borderRadius: '14px 14px 0 0',
        padding: '14px 18px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between' }}>
        <span style={{ fontSize: 14, fontWeight: 900, color,
          textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {emoji}  {title}
        </span>
        <span style={{ background: color, color: '#000', borderRadius: '50%',
          width: 34, height: 34, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 15, fontWeight: 900, flexShrink: 0 }}>
          {count}
        </span>
      </div>
      <div className="kds-col-body" style={{
        flex: 1, background: '#0d0d0d',
        border: `2px solid ${color}`, borderTop: 'none',
        borderRadius: '0 0 14px 14px', padding: 12,
        display: 'flex', flexDirection: 'column', gap: 12,
        minHeight: 220, maxHeight: 'calc(100vh - 210px)', overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  )
}

function EmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 10 }}>
      <span style={{ fontSize: 44 }}>{icon}</span>
      <p style={{ color: '#333', fontSize: 12, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main KDS Page
// ─────────────────────────────────────────────────────────────────────────────
export default function KitchenPage() {
  const [orders,       setOrders]       = useState<OrderRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState('')
  const [busyIds,      setBusyIds]      = useState<Set<string>>(new Set())
  const [clearing,     setClearing]     = useState(false)
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null)
  const [alarmEnabled, setAlarmEnabled] = useState(true)
  const [clearMsg,     setClearMsg]     = useState('')
  const [errorMsg,     setErrorMsg]     = useState('')
  const [prepModal,    setPrepModal]    = useState<{ orderId: string; orderName: string } | null>(null)

  // ── 1-second clock tick — the ONLY purpose is to force re-renders so that
  //    computed values (overdueIds, timeAgo) stay fresh.
  //    setTickCount uses a functional update → React never sees a "new" value
  //    chain; this tick CANNOT cause an infinite loop.
  const [nowMs, setNowMs] = useState(() => Date.now())

  // Refs for audio / alarm state — never cause re-renders
  const audioRef       = useRef<HTMLAudioElement | null>(null)
  const alarmActive    = useRef(false)
  const overdueAlarmOn = useRef(false)

  // ── Audio setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const audio = new Audio('/alarm.mp3')
    audio.loop = true; audio.volume = 0.7
    audioRef.current = audio
    return () => { audio.pause(); audio.src = '' }
  }, [])

  // ── 1-second clock — runs once, never re-subscribes ───────────────────────
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // ── Data fetching ──────────────────────────────────────────────────────────
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

  useEffect(() => { fetchOrders() }, [fetchOrders])

  useEffect(() => {
    const id = setInterval(fetchOrders, POLL_MS)
    return () => clearInterval(id)
  }, [fetchOrders])

  // ── Derived order lists ────────────────────────────────────────────────────
  const newOrders       = orders.filter(o => o.kitchen_status === 'new')
  const preparingOrders = orders.filter(o => o.kitchen_status === 'preparing')
  const servedOrders    = orders.filter(o => o.kitchen_status === 'served')

  // ── overdueIds — computed during render, NOT state. ───────────────────────
  //
  //  WHY THIS ELIMINATES THE INFINITE LOOP:
  //  Using state for overdueIds created this chain:
  //    setOverdueIds(new Set) → re-render → new preparingOrders ref →
  //    useEffect([preparingOrders]) re-runs → setOverdueIds(new Set) → ∞
  //
  //  Now: overdueIds is just a local variable computed from `nowMs` (which
  //  comes from setNowMs inside a [] effect) and `preparingOrders`.
  //  No setState call → no re-render triggered by overdue computation.
  //  The only re-render is from setNowMs(Date.now()) every 1 second, which
  //  is a stable update that cannot loop.
  //
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const overdueIds = useMemo(() => {
    const ids = new Set<string>()
    for (const o of preparingOrders) {
      if (o.target_serve_time && new Date(o.target_serve_time).getTime() < nowMs) {
        ids.add(o.id)
      }
    }
    return ids
  // preparingOrders changes when `orders` changes (every 5s poll).
  // nowMs changes every 1s. Both are fine dependencies — no loop possible
  // because neither overdueIds nor this useMemo call setState.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preparingOrders.map(o => o.id).join(','), nowMs])

  const overdueCount = overdueIds.size

  // ── Alarm side-effects ────────────────────────────────────────────────────
  //   Runs whenever alarmEnabled or overdueCount changes.
  //   Does NOT set any state, so no re-render cascade possible.
  useEffect(() => {
    // New-order alarm
    if (newOrders.length > 0 && alarmEnabled) {
      if (!alarmActive.current && audioRef.current) {
        audioRef.current.play().catch(() => { /* autoplay blocked */ })
        alarmActive.current = true
      }
    } else {
      if (alarmActive.current && audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
        alarmActive.current = false
      }
    }

    // Overdue alarm
    if (overdueCount > 0 && alarmEnabled) {
      if (!overdueAlarmOn.current) {
        startOverdueAlarm()
        overdueAlarmOn.current = true
      }
    } else {
      if (overdueAlarmOn.current) {
        stopOverdueAlarm()
        overdueAlarmOn.current = false
      }
    }
  }, [newOrders.length, overdueCount, alarmEnabled])

  // ── Chef actions ───────────────────────────────────────────────────────────
  function handleAcceptClick(orderId: string, orderName: string) {
    setPrepModal({ orderId, orderName })
  }

  async function handleAcceptConfirm(orderId: string, prepTimeMinutes: number | null) {
    setPrepModal(null)
    setBusyIds(prev => new Set(prev).add(orderId))
    try {
      await updateKitchenStatus(orderId, 'preparing', prepTimeMinutes ?? undefined)
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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: KDS_CSS }} />

      {prepModal && (
        <PrepTimeModal
          orderId={prepModal.orderId}
          orderName={prepModal.orderName}
          onConfirm={handleAcceptConfirm}
          onCancel={() => setPrepModal(null)}
        />
      )}

      <div className="kds-root">

        {/* ══ TOP BAR ══════════════════════════════════════════════════════ */}
        <header style={{
          background: '#0f0f0f', borderBottom: '2px solid #1a1a1a',
          padding: '0 20px', height: 64,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: 16, flexWrap: 'wrap',
        }}>
          {/* Brand */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 30 }}>👨‍🍳</span>
            <div>
              <p style={{ fontSize: 17, fontWeight: 900, color: '#fff',
                letterSpacing: '-0.02em', lineHeight: 1 }}>Kitchen Display</p>
              <p style={{ fontSize: 9, color: '#444', letterSpacing: '0.14em',
                textTransform: 'uppercase', marginTop: 3 }}>Daris Hotel · KDS</p>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>

            {/* New-order alarm badge */}
            {newOrders.length > 0 && alarmEnabled && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: '2px solid #ef4444', borderRadius: 9, padding: '6px 14px',
                animation: 'alarm-pulse 1.1s ease-in-out infinite',
              }}>
                <span style={{ fontSize: 17 }}>🔔</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#fca5a5',
                  letterSpacing: '0.06em' }}>
                  {newOrders.length} NEW ORDER{newOrders.length !== 1 ? 'S' : ''}
                </span>
              </div>
            )}

            {/* Overdue badge */}
            {overdueCount > 0 && alarmEnabled && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: '2px solid #ef4444', borderRadius: 9, padding: '6px 14px',
                animation: 'overdue-badge-pulse 0.8s ease-in-out infinite',
              }}>
                <span style={{ fontSize: 17 }}>🚨</span>
                <span style={{ fontSize: 13, fontWeight: 900, color: '#fca5a5',
                  letterSpacing: '0.06em' }}>
                  {overdueCount} OVERDUE
                </span>
              </div>
            )}

            {/* Last updated */}
            {lastUpdated && !loading && (
              <span style={{ fontSize: 10, color: '#333', letterSpacing: '0.06em',
                whiteSpace: 'nowrap' }}>
                Updated {lastUpdated.toLocaleTimeString()}
              </span>
            )}

            {/* Alarm toggle */}
            <button id="kds-alarm-toggle" onClick={() => setAlarmEnabled(v => !v)}
              style={{
                background: alarmEnabled ? 'rgba(239,68,68,0.08)' : '#111',
                border: `2px solid ${alarmEnabled ? '#ef4444' : '#333'}`,
                color: alarmEnabled ? '#fca5a5' : '#555',
                borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700,
                cursor: 'pointer', letterSpacing: '0.06em', textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}>
              {alarmEnabled ? '🔔 Alarm ON' : '🔕 Alarm OFF'}
            </button>

            {/* Clear board */}
            <button id="kds-clear-board" onClick={handleClearBoard}
              disabled={clearing || servedOrders.length === 0}
              style={{
                background: servedOrders.length === 0 ? '#111' : 'rgba(34,197,94,0.07)',
                border: `2px solid ${servedOrders.length === 0 ? '#222' : '#22c55e'}`,
                color: servedOrders.length === 0 ? '#333' : '#86efac',
                borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 700,
                cursor: servedOrders.length === 0 || clearing ? 'not-allowed' : 'pointer',
                letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {clearing
                ? <><span className="kds-spinner" /> Clearing…</>
                : `🧹 Clear (${servedOrders.length})`}
            </button>

            {/* Back home */}
            <a href="/" style={{
              background: '#111', border: '1px solid #2a2a2a', color: '#555',
              borderRadius: 8, padding: '7px 14px', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              textDecoration: 'none', whiteSpace: 'nowrap',
            }}>← Home</a>
          </div>
        </header>

        {/* ══ BANNERS ══════════════════════════════════════════════════════ */}
        {error && (
          <div style={{ background: '#1a0808', borderBottom: '2px solid #ef4444',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', flex: 1 }}>
              ⚠  {error}
            </span>
            <button onClick={() => setError('')}
              style={{ background: 'none', border: 'none', color: '#fca5a5',
                fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
        )}
        {errorMsg && (
          <div style={{ background: '#1a0808', borderBottom: '2px solid #ef4444',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fca5a5', flex: 1 }}>
              ✗  {errorMsg}
            </span>
            <button onClick={() => setErrorMsg('')}
              style={{ background: 'none', border: 'none', color: '#fca5a5',
                fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
        )}
        {clearMsg && (
          <div style={{ background: '#051a0a', borderBottom: '2px solid #22c55e',
            padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#86efac', flex: 1 }}>
              ✓  {clearMsg}
            </span>
            <button onClick={() => setClearMsg('')}
              style={{ background: 'none', border: 'none', color: '#86efac',
                fontSize: 20, cursor: 'pointer' }}>×</button>
          </div>
        )}

        {/* ══ LOADING ══════════════════════════════════════════════════════ */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div className="kds-page-spinner" />
            <p style={{ color: '#444', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Loading kitchen orders…
            </p>
          </div>
        )}

        {/* ══ KANBAN BOARD ═════════════════════════════════════════════════ */}
        {!loading && (
          <main style={{ flex: 1, display: 'flex', gap: 16, padding: '16px',
            alignItems: 'flex-start', overflowY: 'auto' }}>

            {/* 🔴 NEW */}
            <KanbanColumn title="New Orders" emoji="🔴"
              count={newOrders.length} color="#ef4444">
              {newOrders.length === 0
                ? <EmptyState icon="✅" label="All clear" />
                : newOrders.map(o => (
                    <OrderCard
                      key={o.id} order={o}
                      onAccept={() => handleAcceptClick(o.id, o.menu_items?.name ?? 'Order')}
                      busy={busyIds.has(o.id)}
                    />
                  ))
              }
            </KanbanColumn>

            {/* 🟡 PREPARING */}
            <KanbanColumn title="Preparing" emoji="🟡"
              count={preparingOrders.length} color="#f59e0b">
              {preparingOrders.length === 0
                ? <EmptyState icon="🍳" label="Nothing cooking" />
                : preparingOrders.map(o => (
                    <OrderCard
                      key={o.id} order={o}
                      onFinish={() => handleFinish(o.id)}
                      busy={busyIds.has(o.id)}
                      overdue={overdueIds.has(o.id)}
                    />
                  ))
              }
            </KanbanColumn>

            {/* 🟢 SERVED */}
            <KanbanColumn title="Served" emoji="🟢"
              count={servedOrders.length} color="#22c55e">
              {servedOrders.length === 0
                ? <EmptyState icon="🍽️" label="No completed orders" />
                : servedOrders.map(o => (
                    <OrderCard key={o.id} order={o} />
                  ))
              }
            </KanbanColumn>

          </main>
        )}

        {/* ══ FOOTER ═══════════════════════════════════════════════════════ */}
        <footer style={{
          background: '#0f0f0f', borderTop: '1px solid #1a1a1a',
          padding: '8px 20px', display: 'flex', alignItems: 'center',
          gap: 28, flexShrink: 0, flexWrap: 'wrap',
        }}>
          {[
            { label: 'New',       value: newOrders.length,       color: '#ef4444' },
            { label: 'Preparing', value: preparingOrders.length, color: '#f59e0b' },
            { label: 'Overdue',   value: overdueCount,           color: overdueCount > 0 ? '#ef4444' : '#333' },
            { label: 'Served',    value: servedOrders.length,    color: '#22c55e' },
            { label: 'Active',    value: orders.length,          color: '#555'    },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
              <span style={{ fontSize: 22, fontWeight: 900, color: s.color }}>{s.value}</span>
              <span style={{ fontSize: 9, color: '#333', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.label}</span>
            </div>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#252525',
            letterSpacing: '0.08em' }}>
            Auto-refresh every {POLL_MS / 1000}s
          </span>
        </footer>

      </div>
    </>
  )
}
