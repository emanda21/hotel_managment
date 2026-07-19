'use client'
/**
 * AnalyticsTab.tsx
 * ----------------
 * Self-contained analytics panel rendered inside the Admin Dashboard.
 * Uses Recharts for all charts (install: npm install recharts).
 *
 * Displays:
 *  - 3 KPI summary cards (today revenue, today orders, low-stock count)
 *  - 3 all-time KPI cards (total revenue, total orders, inventory value)
 *  - Line chart: Revenue Trends (Daily / Monthly / Yearly toggle)
 *  - Bar chart:  Top 10 Selling Menu Items
 *  - Table:      Current Inventory Cost Breakdown
 */

import { useEffect, useState, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { getReportsData, type ReportsData, type RevenuePoint } from '../../services/api'

// ─── Daris gold palette for charts ───────────────────────────────────────
const GOLD   = '#C5A880'
const GOLD2  = '#b0936b'
const DARK   = 'rgba(255,255,255,0.04)'
const AXIS   = 'rgba(255,255,255,0.25)'
const GRID   = 'rgba(255,255,255,0.06)'
const TOP_COLORS = [
  '#C5A880','#b0936b','#9c7e56','#876943','#725530',
  '#5d4220','#a08060','#c8aa88','#d4bb99','#deccaa',
]

type TrendView = 'daily' | 'monthly' | 'yearly'

// ─── Custom recharts tooltip ──────────────────────────────────────────────
function DarisTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,8,6,0.95)', border: '1px solid rgba(197,168,128,0.3)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: GOLD, fontWeight: 700, marginBottom: 4 }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: 'white' }}>
          {p.name}: <strong>Br {Number(p.value).toLocaleString()}</strong>
        </p>
      ))}
    </div>
  )
}

function BarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'rgba(10,8,6,0.95)', border: '1px solid rgba(197,168,128,0.3)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ color: GOLD, fontWeight: 700, marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'white' }}>Qty sold: <strong>{payload[0]?.value}</strong></p>
      <p style={{ color: GOLD }}>Revenue: <strong>Br {Number(payload[0]?.payload?.total_revenue).toLocaleString()}</strong></p>
    </div>
  )
}

// ─── KPI card ─────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, accent = false, warn = false }:
  { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <div style={{
      background: accent ? 'rgba(197,168,128,0.08)' : warn ? 'rgba(239,68,68,0.06)' : DARK,
      border: `1px solid ${accent ? 'rgba(197,168,128,0.3)' : warn ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.08)'}`,
      borderRadius: 12, padding: '18px 20px', flex: 1, minWidth: 140,
    }}>
      <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent ? GOLD : warn ? '#fca5a5' : 'white', lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>{sub}</p>}
    </div>
  )
}

// ─── Section heading ──────────────────────────────────────────────────────
function SectionHead({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, marginTop: 36 }}>
      <h2 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'white', whiteSpace: 'nowrap' }}>{title}</h2>
      <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, rgba(197,168,128,0.25), transparent)' }} />
      {right}
    </div>
  )
}

// ─── Toggle button group ──────────────────────────────────────────────────
function ToggleGroup<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 7, padding: 3, gap: 2 }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '5px 14px', borderRadius: 5, border: 'none', cursor: 'pointer',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
            background: value === o.value ? GOLD : 'transparent',
            color:      value === o.value ? 'white' : 'rgba(255,255,255,0.4)',
            transition: 'all 0.2s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────
export default function AnalyticsTab() {
  const [data,    setData]    = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [trend,   setTrend]   = useState<TrendView>('daily')

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      setData(await getReportsData())
    } catch {
      setError('Could not load analytics. Is the FastAPI server running?')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── derive chart data from current trend view ────────────────────────
  const chartData: RevenuePoint[] = data
    ? trend === 'daily'   ? data.daily_revenue
    : trend === 'monthly' ? data.monthly_revenue
    :                       data.yearly_revenue
    : []

  const xKey   = trend === 'daily' ? 'date' : trend === 'monthly' ? 'month' : 'year'
  const xLabel = (v: string) => {
    if (trend === 'daily') {
      const d = new Date(v + 'T00:00:00')
      return `${d.getDate()} ${d.toLocaleString('default',{month:'short'})}`
    }
    if (trend === 'monthly') {
      const [y, m] = v.split('-')
      return `${new Date(Number(y), Number(m)-1).toLocaleString('default',{month:'short'})} '${y.slice(2)}`
    }
    return v
  }

  // ── loading state ─────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:300, gap:16 }}>
      <div style={{ width:36, height:36, border:'2px solid rgba(197,168,128,0.2)', borderTop:'2px solid #C5A880', borderRadius:'50%', animation:'spin 0.8s linear infinite' }} />
      <p style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.18em', color:'rgba(255,255,255,0.35)' }}>Loading Analytics…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )

  if (error) return (
    <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:12, padding:'20px 24px', display:'flex', alignItems:'center', gap:12 }}>
      <span style={{ fontSize:20 }}>⚠️</span>
      <div style={{ flex:1 }}>
        <p style={{ fontSize:12, fontWeight:700, color:'#fca5a5', marginBottom:4 }}>Failed to load analytics</p>
        <p style={{ fontSize:11, color:'rgba(255,255,255,0.5)' }}>{error}</p>
      </div>
      <button onClick={fetchData} style={{ background:'rgba(197,168,128,0.15)', border:'1px solid rgba(197,168,128,0.4)', color:GOLD, borderRadius:6, padding:'7px 16px', fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em' }}>
        ↺ Retry
      </button>
    </div>
  )

  if (!data) return null
  const { kpi } = data

  return (
    <div style={{ fontFamily:"'Montserrat', system-ui, sans-serif" }}>

      {/* ── Refresh row ─────────────────────────────────────────────── */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:4 }}>
        <button onClick={fetchData} style={{ background:'transparent', border:'1px solid rgba(255,255,255,0.15)', color:'rgba(255,255,255,0.4)', borderRadius:6, padding:'6px 14px', fontSize:10, fontWeight:700, cursor:'pointer', textTransform:'uppercase', letterSpacing:'0.08em', transition:'all 0.2s' }}
          onMouseOver={e=>(e.currentTarget.style.color='white')}
          onMouseOut={e=>(e.currentTarget.style.color='rgba(255,255,255,0.4)')}>
          ↻ Refresh
        </button>
      </div>

      {/* ================================================================
          TODAY'S KPI CARDS
      ================================================================ */}
      <SectionHead title="📊 Today's Performance" />
      <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
        <KpiCard accent label="Today's Revenue"
          value={`Br ${kpi.today_revenue.toLocaleString()}`}
          sub="Orders placed today" />
        <KpiCard label="Orders Today"
          value={String(kpi.today_order_count)}
          sub="Individual order items" />
        <KpiCard warn={kpi.low_stock_count > 0} label="Low Stock Alerts"
          value={String(kpi.low_stock_count)}
          sub={kpi.low_stock_count > 0 ? 'Needs restocking' : 'All levels healthy'} />
      </div>

      {/* ── All-time KPIs ─────────────────────────────────────────── */}
      <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginTop:12 }}>
        <KpiCard accent label="All-Time Revenue"
          value={`Br ${kpi.total_revenue.toLocaleString()}`} />
        <KpiCard label="Total Orders Placed"
          value={kpi.total_orders.toLocaleString()} />
        <KpiCard label="Inventory Value"
          value={`Br ${kpi.total_inventory_value.toLocaleString()}`}
          sub="Current stock × cost/unit" />
      </div>

      {/* ================================================================
          REVENUE TREND CHART
      ================================================================ */}
      <SectionHead
        title="📈 Revenue Trend"
        right={
          <ToggleGroup<TrendView>
            options={[
              { label: 'Daily',   value: 'daily'   },
              { label: 'Monthly', value: 'monthly' },
              { label: 'Yearly',  value: 'yearly'  },
            ]}
            value={trend}
            onChange={setTrend}
          />
        }
      />

      {chartData.length === 0 ? (
        <div style={{ height:220, display:'flex', alignItems:'center', justifyContent:'center', border:'1px dashed rgba(197,168,128,0.2)', borderRadius:12, color:'rgba(255,255,255,0.3)', fontSize:12 }}>
          No {trend} data available yet
        </div>
      ) : (
        <div style={{ background:DARK, border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'20px 16px 10px' }}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top:0, right:16, left:0, bottom:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis
                dataKey={xKey}
                tickFormatter={xLabel}
                tick={{ fill: AXIS, fontSize: 10 }}
                axisLine={{ stroke: GRID }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: AXIS, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `Br ${Number(v).toLocaleString()}`}
                width={70}
              />
              <Tooltip content={<DarisTooltip />} />
              <Line
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke={GOLD}
                strokeWidth={2.5}
                dot={{ r: 3, fill: GOLD, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: GOLD2, strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ================================================================
          TOP SELLING ITEMS BAR CHART
      ================================================================ */}
      <SectionHead title="🏆 Top Selling Items" />

      {data.top_items.length === 0 ? (
        <div style={{ height:220, display:'flex', alignItems:'center', justifyContent:'center', border:'1px dashed rgba(197,168,128,0.2)', borderRadius:12, color:'rgba(255,255,255,0.3)', fontSize:12 }}>
          No sales data yet
        </div>
      ) : (
        <div style={{ background:DARK, border:'1px solid rgba(255,255,255,0.07)', borderRadius:14, padding:'20px 16px 10px' }}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={data.top_items}
              layout="vertical"
              margin={{ top:0, right:16, left:0, bottom:0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
              <XAxis
                type="number"
                tick={{ fill: AXIS, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={120}
                tick={{ fill: 'rgba(255,255,255,0.65)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<BarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="total_quantity" name="Qty Sold" radius={[0,4,4,0]}>
                {data.top_items.map((_, i) => (
                  <Cell key={i} fill={TOP_COLORS[i % TOP_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ================================================================
          INVENTORY COST TABLE
      ================================================================ */}
      <SectionHead title="📦 Inventory Cost Breakdown" />

      {data.inventory_costs.length === 0 ? (
        <p style={{ fontSize:12, color:'rgba(255,255,255,0.35)', textAlign:'center', padding:32 }}>No inventory data yet.</p>
      ) : (
        <div style={{ overflowX:'auto', borderRadius:12, border:'1px solid rgba(197,168,128,0.15)' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'rgba(255,255,255,0.04)', borderBottom:'1px solid rgba(255,255,255,0.08)' }}>
                {['Ingredient','Unit','Stock Level','Cost / Unit','Total Value','Status'].map(h => (
                  <th key={h} style={{ padding:'11px 14px', textAlign:'left', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'rgba(255,255,255,0.4)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.inventory_costs.map((row, i) => (
                <tr key={i} style={{ borderBottom:'1px solid rgba(255,255,255,0.05)', background: row.is_low_stock ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
                  <td style={{ padding:'12px 14px', color:'white', fontWeight:600 }}>{row.name}</td>
                  <td style={{ padding:'12px 14px', color:'rgba(255,255,255,0.5)' }}>{row.unit}</td>
                  <td style={{ padding:'12px 14px', color: row.is_low_stock ? '#fca5a5' : '#86efac', fontWeight:700 }}>{row.stock_level}</td>
                  <td style={{ padding:'12px 14px', color:'rgba(255,255,255,0.6)' }}>Br {row.cost_per_unit}</td>
                  <td style={{ padding:'12px 14px', color:GOLD, fontWeight:700 }}>Br {row.total_value.toLocaleString()}</td>
                  <td style={{ padding:'12px 14px' }}>
                    {row.is_low_stock
                      ? <span style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', color:'#fca5a5', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', padding:'3px 8px', borderRadius:4 }}>⚠ Low</span>
                      : <span style={{ background:'rgba(134,239,172,0.1)', border:'1px solid rgba(134,239,172,0.25)', color:'#86efac', fontSize:9, fontWeight:800, textTransform:'uppercase', letterSpacing:'0.08em', padding:'3px 8px', borderRadius:4 }}>✓ OK</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background:'rgba(197,168,128,0.06)', borderTop:'1px solid rgba(197,168,128,0.2)' }}>
                <td colSpan={4} style={{ padding:'12px 14px', fontSize:11, fontWeight:700, color:GOLD, textTransform:'uppercase', letterSpacing:'0.08em' }}>Total Inventory Value</td>
                <td style={{ padding:'12px 14px', fontSize:14, fontWeight:800, color:GOLD }}>Br {kpi.total_inventory_value.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div style={{ height:40 }} />
    </div>
  )
}
