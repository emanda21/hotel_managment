'use client'
/**
 * IngredientAuditTab.tsx
 * ----------------------
 * Shared component for both "Ingredient Audit" and "Activity Log" admin tabs.
 *
 * Features
 * --------
 *  - Type-filter tabs: All | Deductions | Restocks
 *  - Quick date pills: Today | 1 Week | 1 Month | All Time
 *  - Custom From / To date pickers (triggers API refetch with server-side filter)
 *  - Summary stat cards: Total Events, Total Deductions, Total Restocks
 *  - Text search by ingredient, dish, or reason
 *  - Paginated: 500 rows per fetch, Load More button
 *
 * Props
 * -----
 *  filterReason   – undefined = show only deduction reasons (Ingredient Audit mode)
 *                   null      = show all reasons (Activity Log mode)
 *  showAllReasons – when true, shows the Reason column (Activity Log mode)
 */

import { useCallback, useEffect, useState } from 'react'
import { getIngredientAudit, type InventoryLog } from '../../services/api'

interface Props {
  filterReason?: string | null
  showAllReasons?: boolean
}

type QuickFilter  = 'today' | 'week' | 'month' | 'all'
type TypeFilter   = 'all' | 'deductions' | 'restocks'

// Reason codes that count as an "order deduction"
const DEDUCTION_REASONS = ['ORDER_DEDUCTION', 'ORDER_SERVED_DEDUCTION']

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------
function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function todayYMD(): string { return toYMD(new Date()) }

function quickToDates(q: QuickFilter): { from: string; to: string } {
  const to = todayYMD()
  if (q === 'today') return { from: to, to }
  if (q === 'week')  return { from: toYMD(new Date(Date.now() - 7  * 86_400_000)), to }
  if (q === 'month') return { from: toYMD(new Date(Date.now() - 30 * 86_400_000)), to }
  return { from: '', to: '' }   // 'all' → no date filter
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' }) +
    ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  )
}

function fmtAmount(amount: number, unit: string) {
  const sign = amount >= 0 ? '+' : ''
  return `${sign}${Number(amount.toFixed(4))} ${unit}`
}

// --------------------------------------------------------------------------
// Badge map — catches unknown reason codes gracefully
// --------------------------------------------------------------------------
const REASON_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  ORDER_DEDUCTION:        { bg: 'rgba(239,68,68,0.1)',  color: '#fca5a5', label: 'Order (legacy)' },
  ORDER_SERVED_DEDUCTION: { bg: 'rgba(239,68,68,0.12)', color: '#fca5a5', label: 'Order Served' },
  MANUAL_RESTOCK:         { bg: 'rgba(74,222,128,0.1)', color: '#4ade80', label: 'Restock' },
  INITIAL_STOCK:          { bg: 'rgba(74,222,128,0.1)', color: '#4ade80', label: 'Initial Stock' },
  WASTE_WRITE_OFF:        { bg: 'rgba(251,191,36,0.1)', color: '#fbbf24', label: 'Waste' },
}

const PAGE = 500

// ==========================================================================
export default function IngredientAuditTab({
  filterReason,
  showAllReasons = false,
}: Props) {
  // ── data ────────────────────────────────────────────────────────────────
  const [logs,      setLogs]      = useState<InventoryLog[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [hasMore,   setHasMore]   = useState(false)
  const [page,      setPage]      = useState(0)
  const [refreshed, setRefreshed] = useState<Date | null>(null)

  // ── filters ─────────────────────────────────────────────────────────────
  const [typeFilter,  setTypeFilter]  = useState<TypeFilter>('all')
  const [search,      setSearch]      = useState('')
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all')
  const [fromDate,    setFromDate]    = useState('')   // YYYY-MM-DD
  const [toDate,      setToDate]      = useState('')   // YYYY-MM-DD

  // ── fetch ────────────────────────────────────────────────────────────────
  const fetchLogs = useCallback(async (reset: boolean, from: string, to: string) => {
    setLoading(true)
    setError('')
    const offset = reset ? 0 : page * PAGE
    try {
      const data = await getIngredientAudit({
        limit:      PAGE,
        skip:       offset,
        start_date: from || null,
        end_date:   to   || null,
      })
      setLogs(prev => reset ? data : [...prev, ...data])
      setHasMore(data.length === PAGE)
      if (!reset) setPage(p => p + 1)
      setRefreshed(new Date())
    } catch {
      setError('Could not load audit logs. Is the FastAPI server running?')
    } finally {
      setLoading(false)
    }
  }, [page])

  // initial load
  useEffect(() => { fetchLogs(true, fromDate, toDate) }, []) // eslint-disable-line

  // re-fetch when date range changes
  useEffect(() => {
    setPage(0)
    setLogs([])
    fetchLogs(true, fromDate, toDate)
  }, [fromDate, toDate]) // eslint-disable-line

  // ── quick filter handler ─────────────────────────────────────────────────
  function applyQuick(q: QuickFilter) {
    setQuickFilter(q)
    const { from, to } = quickToDates(q)
    setFromDate(from)
    setToDate(to)
  }

  // ── custom date picker handler ────────────────────────────────────────────
  function handleFromDate(val: string) {
    setQuickFilter('all')   // custom date clears quick pill
    setFromDate(val)
  }
  function handleToDate(val: string) {
    setQuickFilter('all')
    setToDate(val)
  }

  function handleRefresh() {
    setPage(0); setLogs([])
    fetchLogs(true, fromDate, toDate)
  }

  // ── reason filter (Ingredient Audit vs Activity Log mode) ────────────────
  // undefined → Ingredient Audit: show only deduction reasons
  // null      → Activity Log: show all
  const reasonAllowList: string[] | null =
    filterReason === undefined ? DEDUCTION_REASONS : null

  // ── client-side filtering ────────────────────────────────────────────────
  const filtered = logs.filter(log => {
    // reason allow-list (Ingredient Audit vs Activity Log)
    if (reasonAllowList && !reasonAllowList.includes(log.reason)) return false

    // type filter (All / Deductions / Restocks)
    if (typeFilter === 'deductions' && log.change_amount >= 0) return false
    if (typeFilter === 'restocks'   && log.change_amount <= 0) return false

    // text search
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      log.ingredient_name.toLowerCase().includes(q) ||
      (log.menu_item_name ?? '').toLowerCase().includes(q) ||
      log.reason.toLowerCase().includes(q)
    )
  })

  // ── summary metrics — computed from the SAME filtered array the table shows ──
  // This means: search + date + type filter ALL affect these numbers simultaneously.
  const totalEvents       = filtered.length
  const deductionRows     = filtered.filter(l => l.change_amount < 0)
  const restockRows       = filtered.filter(l => l.change_amount > 0)
  const totalDeductions   = deductionRows.length
  const totalRestocks     = restockRows.length
  const volDeducted       = deductionRows.reduce((s, l) => s + Math.abs(l.change_amount), 0)
  const volRestocked      = restockRows.reduce((s, l) => s + l.change_amount, 0)

  // ── styles (inline — no extra CSS file needed) ───────────────────────────
  const sectionTitle: React.CSSProperties = {
    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.12em', color: 'rgba(255,255,255,0.3)',
    marginBottom: 8,
  }

  const dateInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(197,168,128,0.2)',
    borderRadius: 7,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    colorScheme: 'dark',
    cursor: 'pointer',
    minWidth: 130,
  }

  const typeTabBtn = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(197,168,128,0.15)' : 'transparent',
    border: `1px solid ${active ? 'rgba(197,168,128,0.5)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: 7,
    color: active ? '#C5A880' : 'rgba(255,255,255,0.4)',
    fontSize: 10, fontWeight: 700,
    padding: '6px 14px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    transition: 'all 0.18s',
  })

  const quickBtn = (active: boolean): React.CSSProperties => ({
    background: active ? 'rgba(197,168,128,0.12)' : 'transparent',
    border: `1px solid ${active ? 'rgba(197,168,128,0.4)' : 'rgba(255,255,255,0.07)'}`,
    borderRadius: 5,
    color: active ? '#C5A880' : 'rgba(255,255,255,0.35)',
    fontSize: 10, fontWeight: 600,
    padding: '4px 11px',
    cursor: 'pointer',
    transition: 'all 0.15s',
  })

  // --------------------------------------------------------------------------
  return (
    <div className="animate-fadeIn">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Lora,Georgia,serif', color: 'white', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            {showAllReasons ? '📋 Activity Log' : '🔍 Ingredient Audit'}
          </h2>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>
            {showAllReasons
              ? 'All stock change events — deductions, restocks, and write-offs.'
              : 'Every stock deduction made when orders are served.'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {refreshed && (
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.05em' }}>
              Updated {refreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            className="premium-add-btn"
            style={{ padding: '8px 16px', fontSize: 10 }}
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading
              ? <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="premium-spinner-sm" /> Loading…</span>
              : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {error && (
        <div className="premium-alert animate-fadeIn"
          style={{ borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)', marginBottom: 20 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#fca5a5', marginRight: 10 }}>Error:</span>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{error}</span>
          <button style={{ marginLeft: 'auto', color: '#fca5a5', fontWeight: 700, fontSize: 11, background: 'transparent', border: 'none', cursor: 'pointer' }}
            onClick={handleRefresh}>↺ Retry</button>
        </div>
      )}

      {/* ── Search-context badge (shows when a text search is active) ──── */}
      {search.trim() && (
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          background: 'rgba(197,168,128,0.08)',
          border: '1px solid rgba(197,168,128,0.25)',
          borderRadius: 7, padding: '6px 14px', marginBottom: 14,
        }}>
          <span style={{ fontSize: 13 }}>🔎</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>
            Stats filtered for:{' '}
            <strong style={{ color: '#C5A880', fontWeight: 700 }}>&ldquo;{search.trim()}&rdquo;</strong>
          </span>
          <button
            onClick={() => setSearch('')}
            style={{ background: 'transparent', border: 'none', color: 'rgba(197,168,128,0.6)', fontSize: 12, cursor: 'pointer', padding: 0, marginLeft: 4 }}
            title="Clear search"
          >✕</button>
        </div>
      )}

      {/* ── Summary Cards ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Total Events */}
        <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 110 }}>
          <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>
            Total Events
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#C5A880', fontFamily: 'Lora,Georgia,serif', lineHeight: 1.1 }}>
            {totalEvents}
          </span>
        </div>

        {/* Deductions */}
        <div style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
          <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>
            ▼ Deductions
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#fca5a5', fontFamily: 'Lora,Georgia,serif', lineHeight: 1.1 }}>
            {totalDeductions}
          </span>
          {volDeducted > 0 && (
            <span style={{ fontSize: 10, color: 'rgba(252,165,165,0.6)', fontWeight: 600, marginTop: 1 }}>
              −{Number(volDeducted.toFixed(3))} units total
            </span>
          )}
        </div>

        {/* Restocks */}
        <div style={{ background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.15)', borderRadius: 8, padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130 }}>
          <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>
            ▲ Restocks
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, color: '#4ade80', fontFamily: 'Lora,Georgia,serif', lineHeight: 1.1 }}>
            {totalRestocks}
          </span>
          {volRestocked > 0 && (
            <span style={{ fontSize: 10, color: 'rgba(74,222,128,0.6)', fontWeight: 600, marginTop: 1 }}>
              +{Number(volRestocked.toFixed(3))} units total
            </span>
          )}
        </div>

        {/* Net Change — only show when both exist */}
        {(volDeducted > 0 || volRestocked > 0) && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '10px 18px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 130,
          }}>
            <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.35)' }}>
              Net Change
            </span>
            <span style={{
              fontSize: 26, fontWeight: 700,
              color: volRestocked - volDeducted >= 0 ? '#4ade80' : '#fca5a5',
              fontFamily: 'Lora,Georgia,serif', lineHeight: 1.1,
            }}>
              {volRestocked - volDeducted >= 0 ? '+' : ''}{Number((volRestocked - volDeducted).toFixed(3))}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', fontWeight: 600, marginTop: 1 }}>units</span>
          </div>
        )}
      </div>

      {/* ── Type Filter Tabs ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <p style={sectionTitle}>Filter by Type</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([
            { key: 'all',        label: '⬡ All Events' },
            { key: 'deductions', label: '▼ Deductions' },
            { key: 'restocks',   label: '▲ Restocks' },
          ] as { key: TypeFilter; label: string }[]).map(t => (
            <button
              key={t.key}
              id={`audit-type-${t.key}`}
              style={typeTabBtn(typeFilter === t.key)}
              onClick={() => setTypeFilter(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Date Controls Row ─────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>

        {/* Quick pills */}
        <div>
          <p style={sectionTitle}>Quick Range</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              { key: 'today', label: '🗓 Today' },
              { key: 'week',  label: '1 Week' },
              { key: 'month', label: '1 Month' },
              { key: 'all',   label: 'All Time' },
            ] as { key: QuickFilter; label: string }[]).map(f => (
              <button
                key={f.key}
                id={`audit-quick-${f.key}`}
                style={quickBtn(quickFilter === f.key && !fromDate && !toDate
                  ? true
                  : quickFilter === f.key && (fromDate !== '' || toDate !== '')
                    ? false
                    : quickFilter === f.key)}
                onClick={() => applyQuick(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 36, background: 'rgba(255,255,255,0.08)', alignSelf: 'flex-end' }} />

        {/* Custom date pickers */}
        <div>
          <p style={sectionTitle}>Custom Range</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>From</label>
              <input
                id="audit-date-from"
                type="date"
                value={fromDate}
                onChange={e => handleFromDate(e.target.value)}
                style={dateInput}
                max={toDate || todayYMD()}
              />
            </div>
            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, alignSelf: 'flex-end', paddingBottom: 7 }}>→</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <label style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase' }}>To</label>
              <input
                id="audit-date-to"
                type="date"
                value={toDate}
                onChange={e => handleToDate(e.target.value)}
                style={dateInput}
                min={fromDate || undefined}
                max={todayYMD()}
              />
            </div>
            {(fromDate || toDate) && (
              <button
                style={{ alignSelf: 'flex-end', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.35)', fontSize: 10, padding: '7px 10px', cursor: 'pointer', marginBottom: 0 }}
                onClick={() => { setFromDate(''); setToDate(''); setQuickFilter('all') }}
                title="Clear date range"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        {/* Active range label */}
        {(fromDate || toDate) && (
          <div style={{ alignSelf: 'flex-end', paddingBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 600,
              color: 'rgba(197,168,128,0.7)',
              background: 'rgba(197,168,128,0.07)',
              border: '1px solid rgba(197,168,128,0.2)',
              borderRadius: 5, padding: '4px 10px', letterSpacing: '0.05em',
            }}>
              {fromDate && toDate
                ? `${fromDate} → ${toDate}`
                : fromDate
                ? `From ${fromDate}`
                : `Until ${toDate}`}
              {' · '}{filtered.length} event{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── Text Search ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <input
          className="form-input"
          style={{ width: '100%', boxSizing: 'border-box' }}
          placeholder="🔎  Search by ingredient, dish, or reason…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Table / Empty State ────────────────────────────────────────── */}
      {loading && logs.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3, 4, 5, 6].map(n => (
            <div key={n} style={{ height: 44, borderRadius: 6, background: 'rgba(255,255,255,0.04)', opacity: 0.6 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', border: '1px dashed rgba(197,168,128,0.2)', borderRadius: 16, background: 'rgba(255,255,255,0.015)' }}>
          <span style={{ fontSize: 36, display: 'block', marginBottom: 12 }}>📭</span>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            {search ? 'No results match your search.' : 'No audit events found for this range.'}
          </p>
          {(search || fromDate || toDate) && (
            <button
              style={{ marginTop: 12, background: 'transparent', border: '1px solid rgba(197,168,128,0.3)', color: '#C5A880', borderRadius: 6, padding: '6px 16px', fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}
              onClick={() => { setSearch(''); setFromDate(''); setToDate(''); setTypeFilter('all'); setQuickFilter('all') }}
            >
              Clear All Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="inv-table-wrapper">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Ingredient</th>
                  <th>Change</th>
                  <th>Stock After</th>
                  {showAllReasons && <th>Type</th>}
                  <th>Triggered By</th>
                  <th>Order ID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((log, idx) => {
                  const isDeduction = log.change_amount < 0
                  const badge = REASON_BADGE[log.reason] ?? {
                    bg: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', label: log.reason,
                  }
                  return (
                    <tr key={log.log_id ?? idx}>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 11, color: 'rgba(255,255,255,0.45)' }}>
                        {fmtDate(log.created_at)}
                      </td>
                      <td>
                        <span className="inv-name">{log.ingredient_name}</span>
                        <span className="inv-unit" style={{ marginLeft: 6 }}>{log.unit}</span>
                      </td>
                      <td>
                        <span style={{ fontWeight: 700, fontFamily: 'Lora,Georgia,serif', fontSize: 13, color: isDeduction ? '#fca5a5' : '#4ade80' }}>
                          {fmtAmount(log.change_amount, log.unit)}
                        </span>
                      </td>
                      <td style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                        {log.current_stock} {log.unit}
                      </td>
                      {showAllReasons && (
                        <td>
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                            textTransform: 'uppercase', letterSpacing: '0.06em',
                            background: badge.bg, color: badge.color,
                            border: `1px solid ${badge.color}33`,
                          }}>
                            {badge.label}
                          </span>
                        </td>
                      )}
                      <td style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
                        {/* For restock rows, show the Added By name */}
                        {(log.reason === 'MANUAL_RESTOCK' || log.reason === 'INITIAL_STOCK')
                          ? (
                            log.added_by
                              ? <span style={{ color: '#4ade80', fontWeight: 600 }}>Added by: {log.added_by}</span>
                              : <span style={{ color: 'rgba(255,255,255,0.25)' }}>—</span>
                          )
                          : log.menu_item_name
                          ? <>
                              <span style={{ color: 'white', fontWeight: 600 }}>{log.menu_item_name}</span>
                              {log.order_quantity != null && (
                                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>×{log.order_quantity}</span>
                              )}
                            </>
                          : <span style={{ color: 'rgba(255,255,255,0.25)' }}>—</span>}
                      </td>
                      <td>
                        {log.order_id
                          ? <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(197,168,128,0.7)', fontFamily: 'monospace' }}>
                              #{log.order_id.slice(0, 8).toUpperCase()}
                            </span>
                          : <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button
                style={{
                  background: 'transparent', border: '1px solid rgba(197,168,128,0.3)',
                  color: '#C5A880', borderRadius: 8, padding: '10px 28px',
                  fontSize: 10, fontWeight: 700, cursor: 'pointer',
                  textTransform: 'uppercase', letterSpacing: '0.1em',
                  transition: 'all 0.2s ease',
                }}
                onClick={() => fetchLogs(false, fromDate, toDate)}
                disabled={loading}
              >
                {loading
                  ? <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                      <span className="premium-spinner-sm" /> Loading…
                    </span>
                  : `Load More (${PAGE} rows)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
