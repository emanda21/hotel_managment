'use client'
/**
 * RecipesTab.tsx
 * --------------
 * Admin tab for managing recipe lines — the mapping between menu items
 * and the store_inventory ingredients they consume.
 *
 * Features:
 *  - Lists all recipe lines grouped by menu item (accordion-style)
 *  - Inline "Add Ingredient" form per menu item using existing inventory list
 *  - Delete a recipe line with a single click
 *  - Matches the existing dark/gold DARIS design system (no new CSS classes)
 */

import { useEffect, useState } from 'react'
import {
  getRecipes,
  createRecipeLine,
  deleteRecipeLine,
  type MenuItem,
  type InventoryItem,
  type RecipeLine,
} from '../../services/api'

// ---------------------------------------------------------------------------
// Props — menu items and inventory are already fetched by the parent page
// so we reuse them here without a double network call.
// ---------------------------------------------------------------------------
interface Props {
  menuItems:  MenuItem[]
  inventory:  InventoryItem[]
}

// ---------------------------------------------------------------------------
// Empty form shape
// ---------------------------------------------------------------------------
const EMPTY_FORM = { ingredient_id: '', quantity_needed: '' }

export default function RecipesTab({ menuItems, inventory }: Props) {
  const [recipes,  setRecipes]  = useState<RecipeLine[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')
  const [msg,      setMsg]      = useState('')

  // Which menu item accordion is open for the "Add" form
  const [openAddFor, setOpenAddFor] = useState<string | null>(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  // Which accordion sections are expanded (show ingredient list)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // ---------------------------------------------------------------------------
  // Data fetch
  // ---------------------------------------------------------------------------
  async function fetchRecipes() {
    setLoading(true); setError('')
    try {
      const data = await getRecipes()
      setRecipes(data)
    } catch {
      setError('Could not load recipes. Is the FastAPI server running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchRecipes() }, [])

  // ---------------------------------------------------------------------------
  // Group recipe lines by menu_item_id
  // ---------------------------------------------------------------------------
  const grouped = menuItems.map(item => ({
    menuItem: item,
    lines: recipes.filter(r => r.menu_item_id === item.id),
  }))

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAdd(menuItemId: string) {
    setOpenAddFor(menuItemId)
    setForm(EMPTY_FORM)
    setExpanded(prev => new Set([...prev, menuItemId]))
  }

  async function handleAdd(menuItemId: string) {
    if (!form.ingredient_id)            { setMsg('Select an ingredient.'); return }
    const qty = parseFloat(form.quantity_needed)
    if (isNaN(qty) || qty <= 0)         { setMsg('Quantity must be > 0.'); return }

    setSaving(true); setMsg('')
    try {
      await createRecipeLine({
        menu_item_id:    menuItemId,
        ingredient_id:   form.ingredient_id,
        quantity_needed: qty,
      })
      setMsg('Recipe line added!')
      setOpenAddFor(null)
      fetchRecipes()
    } catch {
      setMsg('Error adding recipe line. The ingredient may already be linked.')
    } finally { setSaving(false) }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}" from this recipe?`)) return
    try {
      await deleteRecipeLine(id)
      setMsg('Recipe line removed.')
      fetchRecipes()
    } catch {
      setMsg('Error removing recipe line.')
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="animate-fadeIn">

      {/* Status / error banners — reuse existing premium-alert class */}
      {msg && (
        <div className="premium-alert animate-fadeIn">
          <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'#C5A880', marginRight:10 }}>
            System:
          </span>
          <span style={{ fontSize:13, color:'rgba(255,255,255,0.85)' }}>{msg}</span>
          <button
            style={{ marginLeft:'auto', color:'#C5A880', fontWeight:700, fontSize:11, background:'transparent', border:'none', cursor:'pointer' }}
            onClick={() => setMsg('')}
          >✕</button>
        </div>
      )}

      {error && (
        <div className="premium-alert animate-fadeIn"
          style={{ borderColor:'rgba(239,68,68,0.4)', background:'rgba(239,68,68,0.06)' }}>
          <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', color:'#fca5a5', marginRight:10 }}>Error:</span>
          <span style={{ fontSize:13, color:'rgba(255,255,255,0.7)' }}>{error}</span>
          <button style={{ marginLeft:'auto', color:'#fca5a5', fontWeight:700, fontSize:11, background:'transparent', border:'none', cursor:'pointer' }}
            onClick={fetchRecipes}>↺ Retry</button>
        </div>
      )}

      {/* Page heading */}
      <div style={{ marginBottom:28 }}>
        <h2 style={{ fontSize:20, fontWeight:700, fontFamily:'Lora,Georgia,serif', color:'white', textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:6 }}>
          🧪 Recipe Management
        </h2>
        <p style={{ fontSize:11, color:'rgba(255,255,255,0.35)', letterSpacing:'0.04em' }}>
          Link menu items to their required store ingredients. Each line specifies how much of an ingredient is consumed per serving.
        </p>
      </div>

      {loading ? (
        /* Skeleton rows */
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {[1,2,3,4].map(n => (
            <div key={n} style={{ height:56, borderRadius:10, background:'rgba(255,255,255,0.04)', border:'1px solid rgba(197,168,128,0.1)', opacity:0.6 }} />
          ))}
        </div>
      ) : menuItems.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 0', border:'1px dashed rgba(197,168,128,0.2)', borderRadius:16, background:'rgba(255,255,255,0.015)' }}>
          <span style={{ fontSize:36, display:'block', marginBottom:12 }}>🍽️</span>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.4)' }}>No menu items found. Add menu items first.</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {grouped.map(({ menuItem, lines }) => {
            const isOpen = expanded.has(menuItem.id)
            const isAdding = openAddFor === menuItem.id

            return (
              <div key={menuItem.id}
                style={{
                  border: `1px solid ${isOpen ? 'rgba(197,168,128,0.3)' : 'rgba(197,168,128,0.12)'}`,
                  borderRadius: 12,
                  background: isOpen ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
                  overflow: 'hidden',
                  transition: 'all 0.2s ease',
                }}
              >
                {/* Accordion header */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px', cursor: 'pointer', userSelect: 'none',
                  }}
                  onClick={() => toggleExpand(menuItem.id)}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:14 }}>
                    <span style={{ fontSize:16, fontWeight:700, fontFamily:'Lora,Georgia,serif', color:'white' }}>
                      {menuItem.name}
                    </span>
                    <span style={{ fontSize:9, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em', color:'rgba(255,255,255,0.3)' }}>
                      {menuItem.category}
                    </span>
                    <span style={{
                      fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:4,
                      background: lines.length > 0 ? 'rgba(197,168,128,0.15)' : 'rgba(239,68,68,0.1)',
                      border: `1px solid ${lines.length > 0 ? 'rgba(197,168,128,0.35)' : 'rgba(239,68,68,0.3)'}`,
                      color: lines.length > 0 ? '#C5A880' : '#fca5a5',
                    }}>
                      {lines.length} ingredient{lines.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <button
                      className="premium-add-btn"
                      style={{ padding:'6px 14px', fontSize:10 }}
                      onClick={e => { e.stopPropagation(); openAdd(menuItem.id) }}
                    >
                      + Add Ingredient
                    </button>
                    <span style={{ color:'rgba(197,168,128,0.6)', fontSize:14, transform: isOpen ? 'rotate(180deg)' : 'none', transition:'transform 0.2s ease' }}>▾</span>
                  </div>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', padding:'0 20px 16px' }}>

                    {/* Ingredient table */}
                    {lines.length > 0 ? (
                      <div className="inv-table-wrapper" style={{ marginTop:14, marginBottom: isAdding ? 16 : 0 }}>
                        <table className="inv-table">
                          <thead>
                            <tr>
                              <th>Ingredient</th>
                              <th>Unit</th>
                              <th>Qty / Serving</th>
                              <th>Current Stock</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lines.map(line => {
                              const inv = inventory.find(i => i.id === line.ingredient_id)
                              const displayName = line.ingredient_name ?? inv?.name ?? line.ingredient_id.slice(0,8)
                              const displayUnit = line.unit ?? inv?.unit ?? '—'
                              const stock      = inv?.stock_level ?? null
                              const isLow      = inv?.is_low_stock ?? false
                              return (
                                <tr key={line.id}>
                                  <td className="inv-name">{displayName}</td>
                                  <td className="inv-unit">{displayUnit}</td>
                                  <td style={{ fontWeight:700, color:'#C5A880' }}>{line.quantity_needed}</td>
                                  <td className={stock !== null ? (isLow ? 'inv-stock-low' : 'inv-stock-ok') : 'inv-threshold'}>
                                    {stock !== null ? stock : '—'}
                                  </td>
                                  <td>
                                    <button
                                      className="action-btn-delete"
                                      style={{ fontSize:9, padding:'4px 10px' }}
                                      onClick={() => handleDelete(line.id, displayName)}
                                    >Remove</button>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      !isAdding && (
                        <p style={{ fontSize:12, color:'rgba(255,255,255,0.3)', padding:'16px 0 8px', textAlign:'center' }}>
                          No ingredients linked yet. Click "+ Add Ingredient" to configure this recipe.
                        </p>
                      )
                    )}

                    {/* Inline Add form */}
                    {isAdding && (
                      <div
                        className="animate-fadeIn"
                        style={{
                          marginTop: 14,
                          background:'rgba(197,168,128,0.05)',
                          border:'1px solid rgba(197,168,128,0.2)',
                          borderRadius:10,
                          padding:'16px 18px',
                          display:'flex', flexDirection:'column', gap:14,
                        }}
                      >
                        <p style={{ fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.12em', color:'#C5A880', margin:0 }}>
                          ✦ Link New Ingredient
                        </p>
                        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>

                          {/* Ingredient selector */}
                          <div className="form-group" style={{ flex:2, minWidth:180 }}>
                            <label className="form-label">Ingredient</label>
                            <select
                              className="form-select"
                              value={form.ingredient_id}
                              onChange={e => setForm(f => ({ ...f, ingredient_id: e.target.value }))}
                            >
                              <option value="">— Select ingredient —</option>
                              {inventory.map(inv => (
                                <option key={inv.id} value={inv.id}>
                                  {inv.name} ({inv.unit}) · Stock: {inv.stock_level}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Quantity input */}
                          <div className="form-group" style={{ flex:1, minWidth:120 }}>
                            <label className="form-label">Qty / Serving</label>
                            <input
                              type="number"
                              min={0}
                              step="any"
                              className="form-input"
                              placeholder="e.g. 0.200"
                              value={form.quantity_needed}
                              onChange={e => setForm(f => ({ ...f, quantity_needed: e.target.value }))}
                            />
                          </div>
                        </div>

                        <div style={{ display:'flex', gap:10 }}>
                          <button
                            className="modal-btn-cancel"
                            style={{ flex:'0 0 auto', padding:'9px 20px', fontSize:10 }}
                            onClick={() => { setOpenAddFor(null); setForm(EMPTY_FORM) }}
                          >Cancel</button>
                          <button
                            className="modal-btn-save"
                            style={{ flex:'0 0 auto', padding:'9px 20px', fontSize:10 }}
                            onClick={() => handleAdd(menuItem.id)}
                            disabled={saving}
                          >
                            {saving ? 'Saving…' : 'Link Ingredient'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
