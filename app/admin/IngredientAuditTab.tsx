'use client'
/**
 * IngredientAuditTab.tsx
 * ----------------------
 * Displays the full inventory audit trail sourced from the `inventory_logs`
 * table via the `v_inventory_audit` Supabase view.
 *
 * Props
 * -----
 * filterReason  – when provided, only rows with this reason are shown.
 *                 Pass `null` to show all reasons (Activity Log mode).
 * showAllReasons – when true, shows the Reason column in the table.
 *
 * Features
 * --------
 *  - Auto-loads on mount; manual Refresh button
 *  - Search/filter by ingredient name or menu item
 *  - Colour-coded change_amount (red for deductions, green for restocks)
 *  - Paginated: loads 200 rows at a time with a "Load More" button
 *  - Matches the existing dark/gold DARIS design system
 */

import { useEffect, useState } from 'react'
import { getIngredientAudit, type InventoryLog } from '../../services/api'

interface Props {
  /** Only show rows matching this reason code. undefined = ORDER_DEDUCTION only. null = all. */
  filterReason?: string | null
  showAllReasons?: boolean
}

export default function IngredientAuditTab({
  filterReason,
  showAllReasons = false,
}: Props) {
  const [logs,      setLogs]      = useState<InventoryLog[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState('')
  const [search,    setSearch]    = useState('')
  const [page,      setPage]      = useState(0)
  const [hasMore,   setHasMore]   = useState(false)
  const [refreshed, setRefreshed] = useState<Date | null>(null)

  const PAGE = 200

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------
  async function fetchLogs(reset = false) {
    setLoading(true); setError('')
    const offset = reset ? 0 : page * PAGE
    try {
      const data = await getIngredientAudit(PAGE, offset)
      setLogs(prev => reset ? data : [...prev, ...data])
      setHasMore(data.length === PAGE)
      if (!reset) setPage(p => p + 1)
      setRefreshed(new Date())
    } catch {
      setError('Could not load audit logs. Is the FastAPI server running?')
    } finally {
      setLoading(false)
    }
  }

  function handleRefresh() { setPage(0); setLogs([]); fetchLogs(true) }

  useEffect(() => { fetchLogs(true) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Filter
  // ---------------------------------------------------------------------------
  const reasonFilter = filterReason === undefined ? 'ORDER_DEDUCTION' : filterReason

  const filtered = logs.filter(log => {
    // Reason filter
    if (reasonFilter !== null && log.reason !== reasonFilter) return false
    // Search
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      log.ingredient_name.toLowerCase().includes(q) ||
      (log.menu_item_name ?? '').toLowerCase().includes(q) ||
      log.reason.toLowerCase().includes(q)
    )
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function fmtDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString([], { month:'short', day:'numeric', year:'2-digit' })
      + ' · '
      + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
  }

  function fmtAmount(amount: number, unit: string) {
    const sign = amount >= 0 ? '+' : ''
    return `${sign}${Number(amount.toFixed(4))} ${unit}`
  }

  const reasonBadge: Record<string, { bg: string; color: string; label: string }> = {
    ORDER_DEDUCTION: { bg:'rgba(239,68,68,0.1)',   color:'#fca5a5', label:'Order' },
    MANUAL_RESTOCK:  { bg:'rgba(74,222,128,0.1)',  color:'#4ade80', label:'Restock' },
    WASTE_WRITE_OFF: { bg:'rgba(251,191,36,0.1)',  color:'#fbbf24', label:'Waste' },
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="animate-fadeIn">

      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ fontSize:20, fontWeight:700, fontFamily:'Lora,Georgia,serif', color:'white', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>
            {showAllReasons ? '📋 Activity Log' : '🔍 Ingredient Audit'}
          </h2>
          <p style={{ fontSize:11, color:'rgba(255,255,255,0.35)', letterSpacing:'0.04em' }}>
            {showAllReasons
              ? 'All stock change events — deductions, restocks, and write-offs.'
              : 'Every stock deduction made by order placement, newest first.'}
          </p>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          {refreshed && (
            <span style={{ fontSize:9, color:'rgba(255,255,255,0.25)', letterSpacing:'0.05em' }}>
              Updated {refreshed.toLocaleTimeString()}
            </span>
          )}
          <button
            className="premium-add-btn"
            style={{ padding:'8px 16px', fontSize:10 }}
            onClick={handleRefresh}
            disabled={loading}
          >
            {loading
              ? <span style={{ display:'flex', alignItems:'center', gap:6 }}><span className="premium-spinner-sm" /> Loading…</span>
              : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="premium-alert animate-fadeIn"
          style={{ borderColor:'rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.06)', marginBottom:20 }}>
          <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', color:'#fca5a5', marginRight:10 }}>Error:</span>
          <span style={{ fontSize:13, color:'rgba(255,255,255,0.7)' }}>{error}</span>
          <button style={{ marginLeft:'auto', color:'#fca5a5', fontWeight:700, fontSize:11, background:'transparent', border:'none', cursor:'pointer' }}
            onClick={handleRefresh}>↺ Retry</button>
        </div>
      )}

      {/* Summary chips */}
      {!loading && logs.length > 0 && (
        <div style={{ display:'flex', gap:10, marginBottom:20, flexWrap:'wrap' }}>
          {[
            { label:'Total Events',    value: filtered.length,                                            color:'#C5A880' },
            { label:'Deductions',      value: filtered.filter(l => l.change_amount < 0).length,           color:'#fca5a5' },
            { label:'Restocks',        value: filtered.filter(l => l.change_amount > 0).length,           color:'#4ade80' },
          ].map(chip => (
            <div key={chip.label} style={{
              background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:8, padding:'8px 14px', display:'flex', flexDirection:'column', gap:2,
            }}>
              <span style={{ fontSize:8, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'rgba(255,255,255,0.35)' }}>
                {chip.label}
              </span>
              <span style={{ fontSize:18, fontWeight:700, color: chip.color, fontFamily:'Lora,Georgia,serif' }}>
                {chip.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom:16 }}>
        <input
          className="form-input"
          style={{ width:'100%', boxSizing:'border-box' }}
          placeholder="🔎  Search by ingredient, dish, or reason…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      {loading && logs.length === 0 ? (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {[1,2,3,4,5,6].map(n => (
            <div key={n} style={{ height:44, borderRadius:6, background:'rgba(255,255,255,0.04)', opacity:0.6 }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', border:'1px dashed rgba(197,168,128,0.2)', borderRadius:16, background:'rgba(255,255,255,0.015)' }}>
          <span style={{ fontSize:36, display:'block', marginBottom:12 }}>📭</span>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.35)' }}>
            {search ? 'No results match your search.' : 'No audit events found yet.'}
          </p>
          {search && (
            <button
              style={{ marginTop:12, background:'transparent', border:'1px solid rgba(197,168,128,0.3)', color:'#C5A880', borderRadius:6, padding:'6px 16px', fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em' }}
              onClick={() => setSearch('')}
            >Clear Search</button>
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
                  const badge = reasonBadge[log.reason] ?? {
                    bg: 'rgba(255,255,255,0.06)', color:'rgba(255,255,255,0.5)', label: log.reason,
                  }
                  return (
                    <tr key={log.log_id ?? idx}>
                      {/* Timestamp */}
                      <td style={{ whiteSpace:'nowrap', fontSize:11, color:'rgba(255,255,255,0.45)' }}>
                        {fmtDate(log.created_at)}
                      </td>

                      {/* Ingredient */}
                      <td>
                        <span className="inv-name">{log.ingredient_name}</span>
                        <span className="inv-unit" style={{ marginLeft:6 }}>{log.unit}</span>
                      </td>

                      {/* Change amount — negative = red, positive = green */}
                      <td>
                        <span style={{
                          fontWeight: 700,
                          fontFamily: 'Lora,Georgia,serif',
                          fontSize: 13,
                          color: isDeduction ? '#fca5a5' : '#4ade80',
                        }}>
                          {fmtAmount(log.change_amount, log.unit)}
                        </span>
                      </td>

                      {/* Stock level after the change */}
                      <td style={{ color:'rgba(255,255,255,0.6)', fontSize:12 }}>
                        {log.current_stock} {log.unit}
                      </td>

                      {/* Reason badge — only shown in Activity Log mode */}
                      {showAllReasons && (
                        <td>
                          <span style={{
                            fontSize:9, fontWeight:700, padding:'3px 8px', borderRadius:4,
                            textTransform:'uppercase', letterSpacing:'0.06em',
                            background: badge.bg, color: badge.color,
                            border: `1px solid ${badge.color}33`,
                          }}>
                            {badge.label}
                          </span>
                        </td>
                      )}

                      {/* Menu item that triggered it */}
                      <td style={{ fontSize:12, color:'rgba(255,255,255,0.55)' }}>
                        {log.menu_item_name
                          ? <>
                              <span style={{ color:'white', fontWeight:600 }}>{log.menu_item_name}</span>
                              {log.order_quantity != null && (
                                <span style={{ fontSize:10, color:'rgba(255,255,255,0.3)', marginLeft:6 }}>×{log.order_quantity}</span>
                              )}
                            </>
                          : <span style={{ color:'rgba(255,255,255,0.25)' }}>—</span>
                        }
                      </td>

                      {/* Short order ID */}
                      <td>
                        {log.order_id
                          ? <span style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', color:'rgba(197,168,128,0.7)', fontFamily:'monospace' }}>
                              #{log.order_id.slice(0,8).toUpperCase()}
                            </span>
                          : <span style={{ color:'rgba(255,255,255,0.2)', fontSize:11 }}>—</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load more */}
          {hasMore && (
            <div style={{ textAlign:'center', marginTop:20 }}>
              <button
                style={{
                  background:'transparent', border:'1px solid rgba(197,168,128,0.3)',
                  color:'#C5A880', borderRadius:8, padding:'10px 28px',
                  fontSize:10, fontWeight:700, cursor:'pointer',
                  textTransform:'uppercase', letterSpacing:'0.1em',
                  transition:'all 0.2s ease',
                }}
                onClick={() => fetchLogs(false)}
                disabled={loading}
              >
                {loading
                  ? <span style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'center' }}>
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
