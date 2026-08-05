'use client'

/**
 * app/shop/page.tsx
 * -----------------
 * Tourist Shop & Marketplace — Daris International Hotel
 *
 * Features:
 *  - Full-screen cinematic hero banner with animated text
 *  - Floating "Inquire" request drawer / toast
 *  - Real-time search + category filter (client-side, instant)
 *  - Responsive masonry-style grid with premium card design
 *  - Fetches from GET /shop/ FastAPI endpoint
 *  - All styling via inline styles + injected CSS (no extra file needed)
 */

import { useState, useEffect, useRef } from 'react'
import { getShopItems, type ShopItem } from '../../services/api'

// ─── Category metadata ────────────────────────────────────────────────────────
const CATEGORY_META: Record<string, { icon: string; color: string; glow: string }> = {
  'Cultural Clothes': { icon: '👗', color: '#E8B86D', glow: 'rgba(232,184,109,0.25)' },
  'Souvenirs':        { icon: '🏺', color: '#A78BFA', glow: 'rgba(167,139,250,0.25)' },
  'Car Rental':       { icon: '🚗', color: '#38BDF8', glow: 'rgba(56,189,248,0.25)'  },
  'Experiences':      { icon: '🌍', color: '#4ADE80', glow: 'rgba(74,222,128,0.25)'  },
}

function getCatMeta(cat: string) {
  return CATEGORY_META[cat] ?? { icon: '✦', color: '#C8921A', glow: 'rgba(200,146,26,0.2)' }
}

// ─── Price formatter ──────────────────────────────────────────────────────────
function fmtPrice(n: number) {
  return `Br ${n.toLocaleString('en-ET', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ─── Request basket types ─────────────────────────────────────────────────────
type RequestEntry = { item: ShopItem; note: string }

// =============================================================================
export default function ShopPage() {
  // ── data
  const [items,   setItems]   = useState<ShopItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  // ── filters
  const [search,    setSearch]    = useState('')
  const [catFilter, setCatFilter] = useState('ALL')

  // ── request drawer
  const [basket,       setBasket]       = useState<RequestEntry[]>([])
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [noteItem,     setNoteItem]     = useState<ShopItem | null>(null)
  const [noteText,     setNoteText]     = useState('')
  const [submitted,    setSubmitted]    = useState(false)

  // ── scroll
  const [scrolled, setScrolled] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  // ── fetch
  useEffect(() => {
    async function load() {
      setLoading(true); setError('')
      try {
        const data = await getShopItems()
        setItems(data)
      } catch {
        setError('Could not load items. Please ensure the API server is running.')
      } finally { setLoading(false) }
    }
    load()
  }, [])

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])

  // ── derived filter list
  const categories = ['ALL', ...Array.from(new Set(items.map(i => i.category))).sort()]

  const displayed = items.filter(item => {
    const matchCat = catFilter === 'ALL' || item.category === catFilter
    const q = search.trim().toLowerCase()
    const matchSearch = !q ||
      item.name.toLowerCase().includes(q) ||
      (item.description ?? '').toLowerCase().includes(q) ||
      item.category.toLowerCase().includes(q)
    return matchCat && matchSearch
  })

  // ── basket actions
  function addToRequest(item: ShopItem) {
    setNoteItem(item); setNoteText(''); setSubmitted(false)
  }
  function confirmRequest() {
    if (!noteItem) return
    setBasket(prev => {
      const exists = prev.find(e => e.item.id === noteItem.id)
      if (exists) return prev.map(e => e.item.id === noteItem.id ? { ...e, note: noteText } : e)
      return [...prev, { item: noteItem, note: noteText }]
    })
    setNoteItem(null)
    setDrawerOpen(true)
  }
  function removeFromBasket(id: string) { setBasket(prev => prev.filter(e => e.item.id !== id)) }
  function submitRequest() { setSubmitted(true); setTimeout(() => { setBasket([]); setDrawerOpen(false); setSubmitted(false) }, 2200) }

  const totalItems = basket.length

  return (
    <div style={{ minHeight: '100vh', background: '#080808', color: 'white', fontFamily: "'Montserrat', system-ui, sans-serif", overflowX: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: SHOP_CSS }} />

      {/* ── AMBIENT GLOWS ──────────────────────────────────────────────────── */}
      <div className="shop-glow-tl" />
      <div className="shop-glow-br" />
      <div className="shop-glow-center" />

      {/* ── STICKY NAV ─────────────────────────────────────────────────────── */}
      <nav className={`shop-nav ${scrolled ? 'shop-nav-scrolled' : ''}`}>
        <div className="shop-nav-inner">
          <a href="/" className="shop-logo">
            <div className="shop-logo-icon">D</div>
            <div>
              <p className="shop-logo-name">DARIS</p>
              <p className="shop-logo-sub">International Hotel</p>
            </div>
          </a>

          <div className="shop-nav-links">
            {[
              { label: 'Home',    href: '/'      },
              { label: 'Menu',    href: '/menu'  },
              { label: 'Rooms',   href: '/rooms' },
              { label: 'Shop',    href: '/shop'  },
            ].map(l => (
              <a key={l.label} href={l.href} className={`shop-nav-link ${l.label === 'Shop' ? 'shop-nav-link-active' : ''}`}>
                {l.label}
              </a>
            ))}
          </div>

          {/* Basket button */}
          <button className="shop-basket-btn" onClick={() => setDrawerOpen(true)}>
            🛍 Request List
            {totalItems > 0 && <span className="shop-basket-count">{totalItems}</span>}
          </button>
        </div>
      </nav>

      {/* ── HERO BANNER ────────────────────────────────────────────────────── */}
      <section className="shop-hero">
        {/* Background mosaic */}
        <div className="shop-hero-bg" />
        <div className="shop-hero-veil" />

        <div className="shop-hero-content">
          <p className="shop-hero-eyebrow">✦ Curated for Discerning Travellers ✦</p>
          <h1 className="shop-hero-title">
            Discover<br />
            <span className="shop-hero-title-gold">Ethiopia</span>
          </h1>
          <p className="shop-hero-subtitle">
            Authentic cultural treasures, artisan souvenirs, premium experiences
            and curated transport — all arranged by our concierge team.
          </p>
          <div className="shop-hero-actions">
            <button
              className="shop-hero-cta"
              onClick={() => gridRef.current?.scrollIntoView({ behavior: 'smooth' })}
            >
              Explore the Collection ↓
            </button>
            <a href="/" className="shop-hero-secondary">Back to Hotel</a>
          </div>

          {/* Stat chips */}
          <div className="shop-hero-stats">
            {[
              { v: items.length || '—', l: 'Curated Items' },
              { v: '4',                 l: 'Categories'    },
              { v: '24/7',              l: 'Concierge'     },
              { v: '100%',              l: 'Authentic'     },
            ].map(s => (
              <div key={s.l} className="shop-hero-stat">
                <span className="shop-hero-stat-value">{s.v}</span>
                <span className="shop-hero-stat-label">{s.l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="shop-scroll-indicator">
          <div className="shop-scroll-dot" />
        </div>
      </section>

      {/* ── CATEGORY SHOWCASE ──────────────────────────────────────────────── */}
      <section className="shop-cat-showcase">
        <div className="shop-section-inner">
          <p className="shop-section-eyebrow">What We Offer</p>
          <h2 className="shop-section-title">Four Pillars of Ethiopian Experience</h2>
          <div className="shop-pillars">
            {Object.entries(CATEGORY_META).map(([cat, meta]) => (
              <button
                key={cat}
                className="shop-pillar"
                style={{ '--pillar-color': meta.color, '--pillar-glow': meta.glow } as React.CSSProperties}
                onClick={() => { setCatFilter(cat); gridRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
              >
                <span className="shop-pillar-icon">{meta.icon}</span>
                <span className="shop-pillar-name">{cat}</span>
                <span className="shop-pillar-count">
                  {items.filter(i => i.category === cat).length} item{items.filter(i => i.category === cat).length !== 1 ? 's' : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── MAIN CATALOG ───────────────────────────────────────────────────── */}
      <section ref={gridRef} className="shop-catalog">
        <div className="shop-section-inner">

          <div className="shop-catalog-header">
            <div>
              <p className="shop-section-eyebrow">Full Collection</p>
              <h2 className="shop-section-title" style={{ marginBottom: 0 }}>Shop & Experiences</h2>
            </div>
            {totalItems > 0 && (
              <button className="shop-open-basket-btn" onClick={() => setDrawerOpen(true)}>
                🛍 View Request List ({totalItems})
              </button>
            )}
          </div>

          {/* Search + Filter Controls */}
          <div className="shop-controls">
            {/* Search */}
            <div className="shop-search-wrap">
              <span className="shop-search-icon">🔍</span>
              <input
                id="shop-search-input"
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search items, experiences, souvenirs…"
                className="shop-search-input"
                autoComplete="off"
              />
              {search && (
                <button className="shop-search-clear" onClick={() => setSearch('')}>✕</button>
              )}
            </div>

            {/* Category pills */}
            <div className="shop-filter-pills">
              {categories.map(cat => {
                const meta = cat === 'ALL' ? null : getCatMeta(cat)
                const active = catFilter === cat
                return (
                  <button
                    key={cat}
                    id={`shop-cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                    className={`shop-pill ${active ? 'shop-pill-active' : ''}`}
                    style={active && meta ? {
                      borderColor: meta.color,
                      color: meta.color,
                      background: meta.glow,
                      boxShadow: `0 0 16px ${meta.glow}`,
                    } : {}}
                    onClick={() => setCatFilter(cat)}
                  >
                    {cat !== 'ALL' && meta && <span>{meta.icon} </span>}
                    {cat === 'ALL' ? 'All Items' : cat}
                  </button>
                )
              })}

              {/* Result count */}
              {(search || catFilter !== 'ALL') && (
                <span className="shop-result-count">
                  {displayed.length} result{displayed.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>

          {/* ── Loading ── */}
          {loading && (
            <div className="shop-grid">
              {[1,2,3,4,5,6].map(n => (
                <div key={n} className="shop-card-skeleton" />
              ))}
            </div>
          )}

          {/* ── Error ── */}
          {!loading && error && (
            <div className="shop-error">
              <span style={{ fontSize: 32 }}>⚠️</span>
              <p>{error}</p>
              <button className="shop-hero-cta" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
                Retry
              </button>
            </div>
          )}

          {/* ── Empty ── */}
          {!loading && !error && displayed.length === 0 && (
            <div className="shop-empty">
              <span style={{ fontSize: 48 }}>🏺</span>
              <h3>No items found</h3>
              <p>Try adjusting your search or selecting a different category.</p>
              <button
                className="shop-hero-secondary"
                style={{ marginTop: 20 }}
                onClick={() => { setSearch(''); setCatFilter('ALL') }}
              >Clear Filters</button>
            </div>
          )}

          {/* ── Grid ── */}
          {!loading && !error && displayed.length > 0 && (
            <div className="shop-grid">
              {displayed.map(item => {
                const meta   = getCatMeta(item.category)
                const inList = basket.some(e => e.item.id === item.id)
                return (
                  <div key={item.id} className="shop-card" style={{ '--card-glow': meta.glow } as React.CSSProperties}>

                    {/* Image */}
                    <div className="shop-card-img-wrap">
                      {item.image_url ? (
                        <img
                          src={item.image_url}
                          alt={item.name}
                          className="shop-card-img"
                          loading="lazy"
                        />
                      ) : (
                        <div className="shop-card-img-placeholder">
                          <span style={{ fontSize: 48 }}>{meta.icon}</span>
                        </div>
                      )}
                      {/* Category tag */}
                      <div
                        className="shop-card-cat-tag"
                        style={{ background: meta.glow, borderColor: meta.color, color: meta.color }}
                      >
                        {meta.icon} {item.category}
                      </div>
                      {/* Price badge */}
                      <div className="shop-card-price-badge">
                        {fmtPrice(item.price)}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="shop-card-body">
                      <h3 className="shop-card-title">{item.name}</h3>
                      <p className="shop-card-desc">
                        {item.description
                          ? item.description.length > 130
                            ? item.description.slice(0, 130) + '…'
                            : item.description
                          : 'Contact reception for more details.'}
                      </p>

                      {/* Footer */}
                      <div className="shop-card-footer">
                        <div className="shop-card-price">{fmtPrice(item.price)}</div>
                        <button
                          className={`shop-inquire-btn ${inList ? 'shop-inquire-btn-added' : ''}`}
                          style={inList ? {} : { '--btn-color': meta.color, '--btn-glow': meta.glow } as React.CSSProperties}
                          onClick={() => inList ? setDrawerOpen(true) : addToRequest(item)}
                        >
                          {inList ? '✓ In Request List' : 'Inquire at Reception →'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {/* ── FOOTER STRIP ───────────────────────────────────────────────────── */}
      <footer className="shop-footer">
        <div className="shop-footer-inner">
          <div className="shop-footer-logo">
            <span style={{ fontSize: 28, fontFamily: 'Lora, Georgia, serif', color: '#C8921A', fontWeight: 700 }}>DARIS</span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>International Hotel</span>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textAlign: 'center' }}>
            All items and experiences are arranged through our concierge team. Prices in Ethiopian Birr (ETB). © 2025 Daris Hotel.
          </p>
          <div className="shop-footer-links">
            {['Home', 'Menu', 'Rooms', 'Shop'].map(l => (
              <a key={l} href={l === 'Home' ? '/' : `/${l.toLowerCase()}`} style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{l}</a>
            ))}
          </div>
        </div>
      </footer>

      {/* ── NOTE MODAL ─────────────────────────────────────────────────────── */}
      {noteItem && (
        <div className="shop-overlay" onClick={() => setNoteItem(null)}>
          <div className="shop-modal" onClick={e => e.stopPropagation()}>
            <button className="shop-modal-close" onClick={() => setNoteItem(null)}>✕</button>
            <p className="shop-modal-eyebrow">Inquire at Reception</p>
            <h3 className="shop-modal-title">{noteItem.name}</h3>
            <p className="shop-modal-price">{fmtPrice(noteItem.price)}</p>
            <div
              className="shop-modal-cat"
              style={{ color: getCatMeta(noteItem.category).color }}
            >
              {getCatMeta(noteItem.category).icon} {noteItem.category}
            </div>
            <label className="shop-modal-label">Special notes or questions (optional)</label>
            <textarea
              className="shop-modal-textarea"
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              placeholder="E.g. Preferred date, size, group size, custom requirements…"
              rows={3}
            />
            <div className="shop-modal-actions">
              <button className="shop-modal-cancel" onClick={() => setNoteItem(null)}>Cancel</button>
              <button
                className="shop-modal-confirm"
                style={{ background: getCatMeta(noteItem.category).color, color: '#080808' }}
                onClick={confirmRequest}
              >
                Add to Request List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── REQUEST DRAWER ─────────────────────────────────────────────────── */}
      <div className={`shop-drawer ${drawerOpen ? 'shop-drawer-open' : ''}`}>
        <div className="shop-drawer-header">
          <div>
            <p className="shop-drawer-eyebrow">Concierge Request</p>
            <h3 className="shop-drawer-title">Your Request List</h3>
          </div>
          <button className="shop-modal-close" onClick={() => setDrawerOpen(false)}>✕</button>
        </div>

        {submitted ? (
          <div className="shop-drawer-success">
            <span style={{ fontSize: 48 }}>✅</span>
            <h3>Request Sent!</h3>
            <p>Our concierge team has been notified. Please visit the reception or wait for a call to your room.</p>
          </div>
        ) : basket.length === 0 ? (
          <div className="shop-drawer-empty">
            <span style={{ fontSize: 40 }}>🛍</span>
            <p>Your request list is empty.</p>
            <button className="shop-hero-secondary" style={{ marginTop: 12 }} onClick={() => setDrawerOpen(false)}>
              Browse Collection
            </button>
          </div>
        ) : (
          <>
            <div className="shop-drawer-items">
              {basket.map(({ item, note }) => {
                const meta = getCatMeta(item.category)
                return (
                  <div key={item.id} className="shop-drawer-item">
                    <div className="shop-drawer-item-icon" style={{ background: meta.glow, borderColor: meta.color }}>
                      {meta.icon}
                    </div>
                    <div className="shop-drawer-item-info">
                      <p className="shop-drawer-item-name">{item.name}</p>
                      <p className="shop-drawer-item-price" style={{ color: meta.color }}>{fmtPrice(item.price)}</p>
                      {note && <p className="shop-drawer-item-note">&ldquo;{note}&rdquo;</p>}
                    </div>
                    <button className="shop-drawer-remove" onClick={() => removeFromBasket(item.id)}>✕</button>
                  </div>
                )
              })}
            </div>

            <div className="shop-drawer-footer">
              <div className="shop-drawer-total">
                <span>Total Interest</span>
                <span style={{ color: '#C8921A', fontWeight: 700 }}>
                  {fmtPrice(basket.reduce((s, e) => s + e.item.price, 0))}
                </span>
              </div>
              <p className="shop-drawer-disclaimer">
                Prices are indicative. Final pricing confirmed by concierge. No payment required now.
              </p>
              <button className="shop-submit-btn" onClick={submitRequest}>
                📩 Submit to Concierge
              </button>
            </div>
          </>
        )}
      </div>

      {/* Drawer backdrop */}
      {drawerOpen && <div className="shop-drawer-backdrop" onClick={() => setDrawerOpen(false)} />}
    </div>
  )
}

// =============================================================================
// STYLESHEET
// =============================================================================
const SHOP_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Lora:ital,wght@0,400;0,600;0,700;1,400&family=Montserrat:wght@300;400;500;600;700;800;900&display=swap');

/* ── Ambient glows ─────────────────────────────────────────────────────────── */
.shop-glow-tl {
  position: fixed; top: -200px; left: -200px; width: 600px; height: 600px;
  background: radial-gradient(circle, rgba(200,146,26,0.07) 0%, transparent 70%);
  pointer-events: none; z-index: 0; border-radius: 50%;
}
.shop-glow-br {
  position: fixed; bottom: -200px; right: -200px; width: 700px; height: 700px;
  background: radial-gradient(circle, rgba(74,222,128,0.04) 0%, transparent 70%);
  pointer-events: none; z-index: 0; border-radius: 50%;
}
.shop-glow-center {
  position: fixed; top: 40%; left: 30%; width: 800px; height: 400px;
  background: radial-gradient(ellipse, rgba(167,139,250,0.03) 0%, transparent 70%);
  pointer-events: none; z-index: 0;
}

/* ── Navbar ─────────────────────────────────────────────────────────────────── */
.shop-nav {
  position: fixed; top: 0; left: 0; right: 0; z-index: 100;
  transition: all 0.3s ease;
  background: transparent;
  padding: 0;
}
.shop-nav-scrolled {
  background: rgba(8,8,8,0.92);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid rgba(200,146,26,0.12);
  box-shadow: 0 4px 40px rgba(0,0,0,0.5);
}
.shop-nav-inner {
  max-width: 1280px; margin: 0 auto; padding: 18px 32px;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
}
.shop-logo { display: flex; align-items: center; gap: 12px; text-decoration: none; }
.shop-logo-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(135deg, #C8921A, #96700F);
  display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 18px; color: #080808;
}
.shop-logo-name { font-size: 13px; font-weight: 800; letter-spacing: 0.25em; color: #C8921A; font-family: 'Lora', serif; line-height: 1; }
.shop-logo-sub  { font-size: 8px; letter-spacing: 0.2em; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-top: 3px; }
.shop-nav-links { display: flex; gap: 32px; }
.shop-nav-link  { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.65); text-decoration: none; transition: color 0.2s; }
.shop-nav-link:hover { color: #C8921A; }
.shop-nav-link-active { color: #C8921A !important; }
.shop-basket-btn {
  position: relative; display: flex; align-items: center; gap: 8px;
  background: rgba(200,146,26,0.12); border: 1px solid rgba(200,146,26,0.35);
  color: #C8921A; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  padding: 8px 18px; border-radius: 6px; cursor: pointer; transition: all 0.2s;
}
.shop-basket-btn:hover { background: rgba(200,146,26,0.22); border-color: #C8921A; }
.shop-basket-count {
  position: absolute; top: -8px; right: -8px;
  background: #ef4444; color: white; font-size: 10px; font-weight: 800;
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}

/* ── Hero ───────────────────────────────────────────────────────────────────── */
.shop-hero {
  position: relative; min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.shop-hero-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to bottom right, rgba(8,8,8,0.7) 0%, rgba(8,8,8,0.4) 50%, rgba(8,8,8,0.8) 100%),
    url('https://images.unsplash.com/photo-1523805009345-7448845a9e53?q=80&w=2000');
  background-size: cover; background-position: center 30%;
  animation: heroZoom 20s ease-in-out infinite alternate;
}
@keyframes heroZoom { from { transform: scale(1); } to { transform: scale(1.06); } }
.shop-hero-veil {
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(8,8,8,0.3) 0%,
    rgba(8,8,8,0.1) 40%,
    rgba(8,8,8,0.7) 80%,
    rgba(8,8,8,1) 100%
  );
}
.shop-hero-content {
  position: relative; z-index: 2; text-align: center;
  max-width: 800px; padding: 120px 32px 80px;
}
.shop-hero-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.25em;
  text-transform: uppercase; color: #C8921A;
  margin-bottom: 24px; opacity: 0.9;
}
.shop-hero-title {
  font-family: 'Lora', Georgia, serif;
  font-size: clamp(52px, 10vw, 100px);
  font-weight: 700; line-height: 0.95;
  color: white; letter-spacing: -0.02em; margin-bottom: 24px;
}
.shop-hero-title-gold {
  background: linear-gradient(135deg, #F0C060 0%, #C8921A 40%, #96700F 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; display: block;
}
.shop-hero-subtitle {
  font-size: 16px; font-weight: 300; line-height: 1.7;
  color: rgba(255,255,255,0.7); max-width: 560px; margin: 0 auto 40px;
}
.shop-hero-actions { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 60px; }
.shop-hero-cta {
  padding: 16px 36px; font-size: 12px; font-weight: 800;
  letter-spacing: 0.1em; text-transform: uppercase; border: none; cursor: pointer;
  border-radius: 6px; transition: all 0.25s;
  background: linear-gradient(135deg, #C8921A, #96700F);
  color: #080808;
}
.shop-hero-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(200,146,26,0.4); }
.shop-hero-secondary {
  padding: 15px 32px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.8);
  border-radius: 6px; cursor: pointer; transition: all 0.2s;
  text-decoration: none; display: inline-block;
  background: transparent;
}
.shop-hero-secondary:hover { border-color: white; color: white; background: rgba(255,255,255,0.05); }
.shop-hero-stats {
  display: flex; gap: 32px; justify-content: center; flex-wrap: wrap;
}
.shop-hero-stat {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.shop-hero-stat-value {
  font-family: 'Lora', serif; font-size: 28px; font-weight: 700; color: #C8921A; line-height: 1;
}
.shop-hero-stat-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
  text-transform: uppercase; color: rgba(255,255,255,0.4);
}
.shop-scroll-indicator {
  position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.shop-scroll-dot {
  width: 6px; height: 6px; border-radius: 50%; background: rgba(200,146,26,0.6);
  animation: scrollBounce 1.8s ease-in-out infinite;
}
@keyframes scrollBounce { 0%,100% { transform: translateY(0); opacity: 0.6; } 50% { transform: translateY(10px); opacity: 1; } }

/* ── Section helpers ────────────────────────────────────────────────────────── */
.shop-section-inner { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
.shop-section-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
  color: #C8921A; margin-bottom: 10px;
}
.shop-section-title {
  font-family: 'Lora', Georgia, serif;
  font-size: clamp(26px, 4vw, 42px); font-weight: 700;
  color: white; letter-spacing: -0.01em; margin-bottom: 48px; line-height: 1.15;
}

/* ── Category Pillars ───────────────────────────────────────────────────────── */
.shop-cat-showcase {
  padding: 100px 0; border-top: 1px solid rgba(255,255,255,0.04);
  background: linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(20,15,10,0.6) 100%);
}
.shop-pillars {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;
}
.shop-pillar {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px; padding: 36px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  cursor: pointer; transition: all 0.3s ease; text-align: center;
}
.shop-pillar:hover {
  background: var(--pillar-glow);
  border-color: var(--pillar-color);
  transform: translateY(-6px);
  box-shadow: 0 20px 60px var(--pillar-glow);
}
.shop-pillar-icon { font-size: 40px; line-height: 1; }
.shop-pillar-name {
  font-size: 14px; font-weight: 700; color: white;
  font-family: 'Lora', serif; letter-spacing: 0.02em;
}
.shop-pillar-count {
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.35);
  letter-spacing: 0.08em; text-transform: uppercase;
}

/* ── Catalog section ────────────────────────────────────────────────────────── */
.shop-catalog {
  padding: 100px 0 120px;
  background: linear-gradient(180deg, rgba(20,15,10,0.4) 0%, rgba(8,8,8,0) 100%);
}
.shop-catalog-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  flex-wrap: wrap; gap: 16px; margin-bottom: 32px;
}
.shop-open-basket-btn {
  padding: 10px 22px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  background: rgba(200,146,26,0.1); border: 1px solid rgba(200,146,26,0.4);
  color: #C8921A; border-radius: 8px; cursor: pointer; transition: all 0.2s;
  white-space: nowrap;
}
.shop-open-basket-btn:hover { background: rgba(200,146,26,0.2); }

/* Controls */
.shop-controls { display: flex; flex-direction: column; gap: 14px; margin-bottom: 40px; }
.shop-search-wrap {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px; padding: 13px 18px; transition: border-color 0.2s, box-shadow 0.2s;
}
.shop-search-wrap:focus-within {
  border-color: rgba(200,146,26,0.5);
  box-shadow: 0 0 0 3px rgba(200,146,26,0.07);
}
.shop-search-icon { font-size: 16px; opacity: 0.5; flex-shrink: 0; }
.shop-search-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 14px; color: white;
  font-family: 'Montserrat', system-ui, sans-serif;
}
.shop-search-input::placeholder { color: rgba(255,255,255,0.3); }
.shop-search-clear {
  background: rgba(255,255,255,0.08); border: none;
  color: rgba(255,255,255,0.4); font-size: 11px; cursor: pointer;
  border-radius: 50%; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.15s;
}
.shop-search-clear:hover { background: rgba(255,255,255,0.15); color: white; }
.shop-filter-pills { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.shop-pill {
  padding: 8px 20px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.12); background: transparent;
  color: rgba(255,255,255,0.5); cursor: pointer; transition: all 0.2s;
}
.shop-pill:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.8); }
.shop-pill-active {
  border-color: #C8921A; color: #C8921A;
  background: rgba(200,146,26,0.1);
}
.shop-result-count {
  font-size: 10px; font-weight: 700;
  color: rgba(200,146,26,0.7); background: rgba(200,146,26,0.07);
  border: 1px solid rgba(200,146,26,0.2); border-radius: 6px;
  padding: 5px 12px; letter-spacing: 0.06em; white-space: nowrap;
}

/* Grid */
.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

/* Card */
.shop-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px; overflow: hidden;
  transition: all 0.35s cubic-bezier(0.23, 1, 0.32, 1);
  display: flex; flex-direction: column;
}
.shop-card:hover {
  transform: translateY(-8px);
  border-color: rgba(255,255,255,0.14);
  box-shadow: 0 30px 80px var(--card-glow, rgba(200,146,26,0.15)),
              0 0 0 1px rgba(255,255,255,0.08);
}
.shop-card-img-wrap { position: relative; aspect-ratio: 16/10; overflow: hidden; }
.shop-card-img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 0.6s ease;
}
.shop-card:hover .shop-card-img { transform: scale(1.06); }
.shop-card-img-placeholder {
  width: 100%; height: 100%;
  background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center;
}
.shop-card-cat-tag {
  position: absolute; top: 12px; left: 12px;
  font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 5px 11px; border-radius: 20px; border: 1px solid;
  backdrop-filter: blur(8px);
}
.shop-card-price-badge {
  position: absolute; bottom: 12px; right: 12px;
  background: rgba(8,8,8,0.85); backdrop-filter: blur(8px);
  border: 1px solid rgba(200,146,26,0.35); color: #C8921A;
  font-size: 12px; font-weight: 800; padding: 5px 12px; border-radius: 6px;
  font-family: 'Montserrat', sans-serif;
}
.shop-card-body {
  padding: 22px; display: flex; flex-direction: column; gap: 12px; flex: 1;
}
.shop-card-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 18px; font-weight: 700; color: white;
  line-height: 1.3; letter-spacing: 0.01em;
}
.shop-card-desc {
  font-size: 12px; line-height: 1.7; color: rgba(255,255,255,0.5);
  flex: 1;
}
.shop-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; flex-wrap: wrap; }
.shop-card-price {
  font-size: 17px; font-weight: 800; color: #C8921A;
  font-family: 'Montserrat', sans-serif;
}
.shop-inquire-btn {
  padding: 9px 18px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;
  border: 1px solid var(--btn-color, rgba(200,146,26,0.6));
  background: var(--btn-glow, rgba(200,146,26,0.08));
  color: var(--btn-color, #C8921A);
  border-radius: 7px; transition: all 0.22s; white-space: nowrap;
}
.shop-inquire-btn:hover { transform: scale(1.03); box-shadow: 0 6px 24px var(--btn-glow, rgba(200,146,26,0.2)); }
.shop-inquire-btn-added {
  border-color: rgba(74,222,128,0.6) !important;
  background: rgba(74,222,128,0.08) !important;
  color: #4ade80 !important;
}

/* Loading skeleton */
.shop-card-skeleton {
  height: 380px; border-radius: 16px;
  background: linear-gradient(90deg,
    rgba(255,255,255,0.03) 25%,
    rgba(255,255,255,0.06) 50%,
    rgba(255,255,255,0.03) 75%
  );
  background-size: 400% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

/* Empty / Error */
.shop-empty, .shop-error {
  text-align: center; padding: 80px 32px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: rgba(255,255,255,0.4);
}
.shop-empty h3, .shop-error h3 { font-size: 20px; color: rgba(255,255,255,0.6); font-family: 'Lora', serif; }
.shop-empty p, .shop-error p { font-size: 13px; max-width: 380px; line-height: 1.6; }

/* ── Modal ──────────────────────────────────────────────────────────────────── */
.shop-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(12px);
  z-index: 200; display: flex; align-items: center; justify-content: center; padding: 24px;
}
.shop-modal {
  background: rgba(18,14,10,0.98); border: 1px solid rgba(200,146,26,0.2);
  border-radius: 18px; padding: 36px; max-width: 480px; width: 100%;
  position: relative; box-shadow: 0 40px 120px rgba(0,0,0,0.8);
}
.shop-modal-close {
  position: absolute; top: 16px; right: 16px;
  background: rgba(255,255,255,0.06); border: none; color: rgba(255,255,255,0.4);
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.shop-modal-close:hover { background: rgba(255,255,255,0.12); color: white; }
.shop-modal-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #C8921A; margin-bottom: 8px; }
.shop-modal-title { font-family: 'Lora', serif; font-size: 22px; font-weight: 700; color: white; margin-bottom: 6px; }
.shop-modal-price { font-size: 18px; font-weight: 800; color: #C8921A; margin-bottom: 8px; }
.shop-modal-cat { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 24px; }
.shop-modal-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.4); margin-bottom: 8px; display: block; }
.shop-modal-textarea {
  width: 100%; box-sizing: border-box;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; color: white; font-size: 13px; padding: 12px;
  resize: vertical; outline: none; font-family: 'Montserrat', sans-serif;
  transition: border-color 0.2s; margin-bottom: 20px;
}
.shop-modal-textarea:focus { border-color: rgba(200,146,26,0.5); }
.shop-modal-textarea::placeholder { color: rgba(255,255,255,0.25); }
.shop-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.shop-modal-cancel { padding: 10px 22px; font-size: 11px; font-weight: 700; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); border-radius: 7px; cursor: pointer; letter-spacing: 0.07em; transition: all 0.15s; }
.shop-modal-cancel:hover { border-color: rgba(255,255,255,0.3); color: white; }
.shop-modal-confirm { padding: 10px 24px; font-size: 11px; font-weight: 800; border: none; border-radius: 7px; cursor: pointer; letter-spacing: 0.07em; text-transform: uppercase; transition: all 0.2s; }
.shop-modal-confirm:hover { transform: scale(1.03); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }

/* ── Drawer ─────────────────────────────────────────────────────────────────── */
.shop-drawer {
  position: fixed; top: 0; right: -480px; bottom: 0; width: 460px;
  background: rgba(12,9,6,0.98); backdrop-filter: blur(24px);
  border-left: 1px solid rgba(200,146,26,0.15);
  z-index: 300; transition: right 0.35s cubic-bezier(0.23,1,0.32,1);
  display: flex; flex-direction: column;
  box-shadow: -20px 0 80px rgba(0,0,0,0.6);
}
.shop-drawer-open { right: 0; }
.shop-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 299; backdrop-filter: blur(4px);
}
.shop-drawer-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 28px 28px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.shop-drawer-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #C8921A; margin-bottom: 4px; }
.shop-drawer-title { font-family: 'Lora', serif; font-size: 22px; font-weight: 700; color: white; }
.shop-drawer-items { flex: 1; overflow-y: auto; padding: 20px 28px; display: flex; flex-direction: column; gap: 12px; }
.shop-drawer-item {
  display: flex; gap: 14px; align-items: flex-start;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; padding: 14px;
}
.shop-drawer-item-icon {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; border: 1px solid;
}
.shop-drawer-item-info { flex: 1; min-width: 0; }
.shop-drawer-item-name { font-size: 13px; font-weight: 600; color: white; margin-bottom: 3px; line-height: 1.3; }
.shop-drawer-item-price { font-size: 12px; font-weight: 800; margin-bottom: 4px; }
.shop-drawer-item-note { font-size: 11px; color: rgba(255,255,255,0.4); font-style: italic; line-height: 1.4; }
.shop-drawer-remove { background: transparent; border: none; color: rgba(255,255,255,0.25); cursor: pointer; font-size: 13px; padding: 2px; flex-shrink: 0; transition: color 0.15s; }
.shop-drawer-remove:hover { color: #ef4444; }
.shop-drawer-footer { padding: 20px 28px; border-top: 1px solid rgba(255,255,255,0.06); }
.shop-drawer-total {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 10px; font-weight: 600;
}
.shop-drawer-disclaimer { font-size: 10px; color: rgba(255,255,255,0.25); line-height: 1.5; margin-bottom: 16px; }
.shop-submit-btn {
  width: 100%; padding: 15px; font-size: 12px; font-weight: 800;
  letter-spacing: 0.1em; text-transform: uppercase; border: none; cursor: pointer;
  border-radius: 10px; transition: all 0.25s;
  background: linear-gradient(135deg, #C8921A, #96700F); color: #080808;
}
.shop-submit-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(200,146,26,0.35); }
.shop-drawer-empty, .shop-drawer-success {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; padding: 40px; text-align: center;
  color: rgba(255,255,255,0.4);
}
.shop-drawer-success h3 { color: #4ade80; font-size: 20px; font-family: 'Lora', serif; }
.shop-drawer-success p { font-size: 13px; line-height: 1.6; max-width: 280px; }

/* ── Footer ─────────────────────────────────────────────────────────────────── */
.shop-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  background: rgba(8,8,8,0.9); padding: 48px 32px;
}
.shop-footer-inner {
  max-width: 1280px; margin: 0 auto;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
}
.shop-footer-logo { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.shop-footer-links { display: flex; gap: 32px; flex-wrap: wrap; justify-content: center; }

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .shop-nav-links { display: none; }
  .shop-hero-title { font-size: clamp(40px, 12vw, 72px); }
  .shop-pillars { grid-template-columns: repeat(2, 1fr); }
  .shop-grid { grid-template-columns: 1fr; }
  .shop-drawer { width: 100%; right: -100%; }
}
`


}
.shop-nav-inner {
  max-width: 1280px; margin: 0 auto; padding: 18px 32px;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
}
.shop-logo { display: flex; align-items: center; gap: 12px; text-decoration: none; }
.shop-logo-icon {
  width: 40px; height: 40px; border-radius: 50%;
  background: linear-gradient(135deg, #C5A880, #a07840);
  display: flex; align-items: center; justify-content: center;
  font-weight: 900; font-size: 18px; color: #080808;
}
.shop-logo-name { font-size: 13px; font-weight: 800; letter-spacing: 0.25em; color: #C5A880; font-family: 'Lora', serif; line-height: 1; }
.shop-logo-sub  { font-size: 8px; letter-spacing: 0.2em; color: rgba(255,255,255,0.4); text-transform: uppercase; margin-top: 3px; }
.shop-nav-links { display: flex; gap: 32px; }
.shop-nav-link  { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.65); text-decoration: none; transition: color 0.2s; }
.shop-nav-link:hover { color: #C5A880; }
.shop-nav-link-active { color: #C5A880 !important; }
.shop-basket-btn {
  position: relative; display: flex; align-items: center; gap: 8px;
  background: rgba(197,168,128,0.12); border: 1px solid rgba(197,168,128,0.35);
  color: #C5A880; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  padding: 8px 18px; border-radius: 6px; cursor: pointer; transition: all 0.2s;
}
.shop-basket-btn:hover { background: rgba(197,168,128,0.22); border-color: #C5A880; }
.shop-basket-count {
  position: absolute; top: -8px; right: -8px;
  background: #ef4444; color: white; font-size: 10px; font-weight: 800;
  width: 18px; height: 18px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}

/* ── Hero ───────────────────────────────────────────────────────────────────── */
.shop-hero {
  position: relative; min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.shop-hero-bg {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(to bottom right, rgba(8,8,8,0.7) 0%, rgba(8,8,8,0.4) 50%, rgba(8,8,8,0.8) 100%),
    url('https://images.unsplash.com/photo-1523805009345-7448845a9e53?q=80&w=2000');
  background-size: cover; background-position: center 30%;
  animation: heroZoom 20s ease-in-out infinite alternate;
}
@keyframes heroZoom { from { transform: scale(1); } to { transform: scale(1.06); } }
.shop-hero-veil {
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    rgba(8,8,8,0.3) 0%,
    rgba(8,8,8,0.1) 40%,
    rgba(8,8,8,0.7) 80%,
    rgba(8,8,8,1) 100%
  );
}
.shop-hero-content {
  position: relative; z-index: 2; text-align: center;
  max-width: 800px; padding: 120px 32px 80px;
}
.shop-hero-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.25em;
  text-transform: uppercase; color: #C5A880;
  margin-bottom: 24px; opacity: 0.9;
}
.shop-hero-title {
  font-family: 'Lora', Georgia, serif;
  font-size: clamp(52px, 10vw, 100px);
  font-weight: 700; line-height: 0.95;
  color: white; letter-spacing: -0.02em; margin-bottom: 24px;
}
.shop-hero-title-gold {
  background: linear-gradient(135deg, #F5D98B 0%, #C5A880 40%, #a07840 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text; display: block;
}
.shop-hero-subtitle {
  font-size: 16px; font-weight: 300; line-height: 1.7;
  color: rgba(255,255,255,0.7); max-width: 560px; margin: 0 auto 40px;
}
.shop-hero-actions { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; margin-bottom: 60px; }
.shop-hero-cta {
  padding: 16px 36px; font-size: 12px; font-weight: 800;
  letter-spacing: 0.1em; text-transform: uppercase; border: none; cursor: pointer;
  border-radius: 6px; transition: all 0.25s;
  background: linear-gradient(135deg, #C5A880, #a07840);
  color: #080808;
}
.shop-hero-cta:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(197,168,128,0.4); }
.shop-hero-secondary {
  padding: 15px 32px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.8);
  border-radius: 6px; cursor: pointer; transition: all 0.2s;
  text-decoration: none; display: inline-block;
  background: transparent;
}
.shop-hero-secondary:hover { border-color: white; color: white; background: rgba(255,255,255,0.05); }
.shop-hero-stats {
  display: flex; gap: 32px; justify-content: center; flex-wrap: wrap;
}
.shop-hero-stat {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
.shop-hero-stat-value {
  font-family: 'Lora', serif; font-size: 28px; font-weight: 700; color: #C5A880; line-height: 1;
}
.shop-hero-stat-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.15em;
  text-transform: uppercase; color: rgba(255,255,255,0.4);
}
.shop-scroll-indicator {
  position: absolute; bottom: 32px; left: 50%; transform: translateX(-50%);
  display: flex; flex-direction: column; align-items: center; gap: 8px;
}
.shop-scroll-dot {
  width: 6px; height: 6px; border-radius: 50%; background: rgba(197,168,128,0.6);
  animation: scrollBounce 1.8s ease-in-out infinite;
}
@keyframes scrollBounce { 0%,100% { transform: translateY(0); opacity: 0.6; } 50% { transform: translateY(10px); opacity: 1; } }

/* ── Section helpers ────────────────────────────────────────────────────────── */
.shop-section-inner { max-width: 1280px; margin: 0 auto; padding: 0 32px; }
.shop-section-eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
  color: #C5A880; margin-bottom: 10px;
}
.shop-section-title {
  font-family: 'Lora', Georgia, serif;
  font-size: clamp(26px, 4vw, 42px); font-weight: 700;
  color: white; letter-spacing: -0.01em; margin-bottom: 48px; line-height: 1.15;
}

/* ── Category Pillars ───────────────────────────────────────────────────────── */
.shop-cat-showcase {
  padding: 100px 0; border-top: 1px solid rgba(255,255,255,0.04);
  background: linear-gradient(180deg, rgba(8,8,8,0) 0%, rgba(20,15,10,0.6) 100%);
}
.shop-pillars {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;
}
.shop-pillar {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px; padding: 36px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  cursor: pointer; transition: all 0.3s ease; text-align: center;
}
.shop-pillar:hover {
  background: var(--pillar-glow);
  border-color: var(--pillar-color);
  transform: translateY(-6px);
  box-shadow: 0 20px 60px var(--pillar-glow);
}
.shop-pillar-icon { font-size: 40px; line-height: 1; }
.shop-pillar-name {
  font-size: 14px; font-weight: 700; color: white;
  font-family: 'Lora', serif; letter-spacing: 0.02em;
}
.shop-pillar-count {
  font-size: 10px; font-weight: 600; color: rgba(255,255,255,0.35);
  letter-spacing: 0.08em; text-transform: uppercase;
}

/* ── Catalog section ────────────────────────────────────────────────────────── */
.shop-catalog {
  padding: 100px 0 120px;
  background: linear-gradient(180deg, rgba(20,15,10,0.4) 0%, rgba(8,8,8,0) 100%);
}
.shop-catalog-header {
  display: flex; align-items: flex-end; justify-content: space-between;
  flex-wrap: wrap; gap: 16px; margin-bottom: 32px;
}
.shop-open-basket-btn {
  padding: 10px 22px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  background: rgba(197,168,128,0.1); border: 1px solid rgba(197,168,128,0.4);
  color: #C5A880; border-radius: 8px; cursor: pointer; transition: all 0.2s;
  white-space: nowrap;
}
.shop-open-basket-btn:hover { background: rgba(197,168,128,0.2); }

/* Controls */
.shop-controls { display: flex; flex-direction: column; gap: 14px; margin-bottom: 40px; }
.shop-search-wrap {
  display: flex; align-items: center; gap: 12px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 10px; padding: 13px 18px; transition: border-color 0.2s, box-shadow 0.2s;
}
.shop-search-wrap:focus-within {
  border-color: rgba(197,168,128,0.5);
  box-shadow: 0 0 0 3px rgba(197,168,128,0.07);
}
.shop-search-icon { font-size: 16px; opacity: 0.5; flex-shrink: 0; }
.shop-search-input {
  flex: 1; background: transparent; border: none; outline: none;
  font-size: 14px; color: white;
  font-family: 'Montserrat', system-ui, sans-serif;
}
.shop-search-input::placeholder { color: rgba(255,255,255,0.3); }
.shop-search-clear {
  background: rgba(255,255,255,0.08); border: none;
  color: rgba(255,255,255,0.4); font-size: 11px; cursor: pointer;
  border-radius: 50%; width: 22px; height: 22px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: all 0.15s;
}
.shop-search-clear:hover { background: rgba(255,255,255,0.15); color: white; }
.shop-filter-pills { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.shop-pill {
  padding: 8px 20px; font-size: 11px; font-weight: 700;
  letter-spacing: 0.07em; text-transform: uppercase; border-radius: 24px;
  border: 1px solid rgba(255,255,255,0.12); background: transparent;
  color: rgba(255,255,255,0.5); cursor: pointer; transition: all 0.2s;
}
.shop-pill:hover { border-color: rgba(255,255,255,0.3); color: rgba(255,255,255,0.8); }
.shop-pill-active {
  border-color: #C5A880; color: #C5A880;
  background: rgba(197,168,128,0.1);
}
.shop-result-count {
  font-size: 10px; font-weight: 700;
  color: rgba(197,168,128,0.7); background: rgba(197,168,128,0.07);
  border: 1px solid rgba(197,168,128,0.2); border-radius: 6px;
  padding: 5px 12px; letter-spacing: 0.06em; white-space: nowrap;
}

/* Grid */
.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

/* Card */
.shop-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 16px; overflow: hidden;
  transition: all 0.35s cubic-bezier(0.23, 1, 0.32, 1);
  display: flex; flex-direction: column;
}
.shop-card:hover {
  transform: translateY(-8px);
  border-color: rgba(255,255,255,0.14);
  box-shadow: 0 30px 80px var(--card-glow, rgba(197,168,128,0.15)),
              0 0 0 1px rgba(255,255,255,0.08);
}
.shop-card-img-wrap { position: relative; aspect-ratio: 16/10; overflow: hidden; }
.shop-card-img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform 0.6s ease;
}
.shop-card:hover .shop-card-img { transform: scale(1.06); }
.shop-card-img-placeholder {
  width: 100%; height: 100%;
  background: rgba(255,255,255,0.04);
  display: flex; align-items: center; justify-content: center;
}
.shop-card-cat-tag {
  position: absolute; top: 12px; left: 12px;
  font-size: 9px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 5px 11px; border-radius: 20px; border: 1px solid;
  backdrop-filter: blur(8px);
}
.shop-card-price-badge {
  position: absolute; bottom: 12px; right: 12px;
  background: rgba(8,8,8,0.85); backdrop-filter: blur(8px);
  border: 1px solid rgba(197,168,128,0.35); color: #C5A880;
  font-size: 12px; font-weight: 800; padding: 5px 12px; border-radius: 6px;
  font-family: 'Montserrat', sans-serif;
}
.shop-card-body {
  padding: 22px; display: flex; flex-direction: column; gap: 12px; flex: 1;
}
.shop-card-title {
  font-family: 'Lora', Georgia, serif;
  font-size: 18px; font-weight: 700; color: white;
  line-height: 1.3; letter-spacing: 0.01em;
}
.shop-card-desc {
  font-size: 12px; line-height: 1.7; color: rgba(255,255,255,0.5);
  flex: 1;
}
.shop-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto; flex-wrap: wrap; }
.shop-card-price {
  font-size: 17px; font-weight: 800; color: #C5A880;
  font-family: 'Montserrat', sans-serif;
}
.shop-inquire-btn {
  padding: 9px 18px; font-size: 10px; font-weight: 800;
  letter-spacing: 0.06em; text-transform: uppercase; cursor: pointer;
  border: 1px solid var(--btn-color, rgba(197,168,128,0.6));
  background: var(--btn-glow, rgba(197,168,128,0.08));
  color: var(--btn-color, #C5A880);
  border-radius: 7px; transition: all 0.22s; white-space: nowrap;
}
.shop-inquire-btn:hover { transform: scale(1.03); box-shadow: 0 6px 24px var(--btn-glow, rgba(197,168,128,0.2)); }
.shop-inquire-btn-added {
  border-color: rgba(74,222,128,0.6) !important;
  background: rgba(74,222,128,0.08) !important;
  color: #4ade80 !important;
}

/* Loading skeleton */
.shop-card-skeleton {
  height: 380px; border-radius: 16px;
  background: linear-gradient(90deg,
    rgba(255,255,255,0.03) 25%,
    rgba(255,255,255,0.06) 50%,
    rgba(255,255,255,0.03) 75%
  );
  background-size: 400% 100%;
  animation: shimmer 1.5s infinite;
}
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }

/* Empty / Error */
.shop-empty, .shop-error {
  text-align: center; padding: 80px 32px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
  color: rgba(255,255,255,0.4);
}
.shop-empty h3, .shop-error h3 { font-size: 20px; color: rgba(255,255,255,0.6); font-family: 'Lora', serif; }
.shop-empty p, .shop-error p { font-size: 13px; max-width: 380px; line-height: 1.6; }

/* ── Modal ──────────────────────────────────────────────────────────────────── */
.shop-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.8); backdrop-filter: blur(12px);
  z-index: 200; display: flex; align-items: center; justify-content: center; padding: 24px;
}
.shop-modal {
  background: rgba(18,14,10,0.98); border: 1px solid rgba(197,168,128,0.2);
  border-radius: 18px; padding: 36px; max-width: 480px; width: 100%;
  position: relative; box-shadow: 0 40px 120px rgba(0,0,0,0.8);
}
.shop-modal-close {
  position: absolute; top: 16px; right: 16px;
  background: rgba(255,255,255,0.06); border: none; color: rgba(255,255,255,0.4);
  width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
  font-size: 13px; display: flex; align-items: center; justify-content: center;
  transition: all 0.15s;
}
.shop-modal-close:hover { background: rgba(255,255,255,0.12); color: white; }
.shop-modal-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase; color: #C5A880; margin-bottom: 8px; }
.shop-modal-title { font-family: 'Lora', serif; font-size: 22px; font-weight: 700; color: white; margin-bottom: 6px; }
.shop-modal-price { font-size: 18px; font-weight: 800; color: #C5A880; margin-bottom: 8px; }
.shop-modal-cat { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 24px; }
.shop-modal-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.4); margin-bottom: 8px; display: block; }
.shop-modal-textarea {
  width: 100%; box-sizing: border-box;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px; color: white; font-size: 13px; padding: 12px;
  resize: vertical; outline: none; font-family: 'Montserrat', sans-serif;
  transition: border-color 0.2s; margin-bottom: 20px;
}
.shop-modal-textarea:focus { border-color: rgba(197,168,128,0.5); }
.shop-modal-textarea::placeholder { color: rgba(255,255,255,0.25); }
.shop-modal-actions { display: flex; gap: 10px; justify-content: flex-end; }
.shop-modal-cancel { padding: 10px 22px; font-size: 11px; font-weight: 700; background: transparent; border: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.5); border-radius: 7px; cursor: pointer; letter-spacing: 0.07em; transition: all 0.15s; }
.shop-modal-cancel:hover { border-color: rgba(255,255,255,0.3); color: white; }
.shop-modal-confirm { padding: 10px 24px; font-size: 11px; font-weight: 800; border: none; border-radius: 7px; cursor: pointer; letter-spacing: 0.07em; text-transform: uppercase; transition: all 0.2s; }
.shop-modal-confirm:hover { transform: scale(1.03); box-shadow: 0 6px 24px rgba(0,0,0,0.3); }

/* ── Drawer ─────────────────────────────────────────────────────────────────── */
.shop-drawer {
  position: fixed; top: 0; right: -480px; bottom: 0; width: 460px;
  background: rgba(12,9,6,0.98); backdrop-filter: blur(24px);
  border-left: 1px solid rgba(197,168,128,0.15);
  z-index: 300; transition: right 0.35s cubic-bezier(0.23,1,0.32,1);
  display: flex; flex-direction: column;
  box-shadow: -20px 0 80px rgba(0,0,0,0.6);
}
.shop-drawer-open { right: 0; }
.shop-drawer-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  z-index: 299; backdrop-filter: blur(4px);
}
.shop-drawer-header {
  display: flex; justify-content: space-between; align-items: flex-start;
  padding: 28px 28px 20px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.shop-drawer-eyebrow { font-size: 9px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #C5A880; margin-bottom: 4px; }
.shop-drawer-title { font-family: 'Lora', serif; font-size: 22px; font-weight: 700; color: white; }
.shop-drawer-items { flex: 1; overflow-y: auto; padding: 20px 28px; display: flex; flex-direction: column; gap: 12px; }
.shop-drawer-item {
  display: flex; gap: 14px; align-items: flex-start;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 10px; padding: 14px;
}
.shop-drawer-item-icon {
  width: 40px; height: 40px; border-radius: 8px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; border: 1px solid;
}
.shop-drawer-item-info { flex: 1; min-width: 0; }
.shop-drawer-item-name { font-size: 13px; font-weight: 600; color: white; margin-bottom: 3px; line-height: 1.3; }
.shop-drawer-item-price { font-size: 12px; font-weight: 800; margin-bottom: 4px; }
.shop-drawer-item-note { font-size: 11px; color: rgba(255,255,255,0.4); font-style: italic; line-height: 1.4; }
.shop-drawer-remove { background: transparent; border: none; color: rgba(255,255,255,0.25); cursor: pointer; font-size: 13px; padding: 2px; flex-shrink: 0; transition: color 0.15s; }
.shop-drawer-remove:hover { color: #ef4444; }
.shop-drawer-footer { padding: 20px 28px; border-top: 1px solid rgba(255,255,255,0.06); }
.shop-drawer-total {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 13px; color: rgba(255,255,255,0.6); margin-bottom: 10px; font-weight: 600;
}
.shop-drawer-disclaimer { font-size: 10px; color: rgba(255,255,255,0.25); line-height: 1.5; margin-bottom: 16px; }
.shop-submit-btn {
  width: 100%; padding: 15px; font-size: 12px; font-weight: 800;
  letter-spacing: 0.1em; text-transform: uppercase; border: none; cursor: pointer;
  border-radius: 10px; transition: all 0.25s;
  background: linear-gradient(135deg, #C5A880, #a07840); color: #080808;
}
.shop-submit-btn:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(197,168,128,0.35); }
.shop-drawer-empty, .shop-drawer-success {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; padding: 40px; text-align: center;
  color: rgba(255,255,255,0.4);
}
.shop-drawer-success h3 { color: #4ade80; font-size: 20px; font-family: 'Lora', serif; }
.shop-drawer-success p { font-size: 13px; line-height: 1.6; max-width: 280px; }

/* ── Footer ─────────────────────────────────────────────────────────────────── */
.shop-footer {
  border-top: 1px solid rgba(255,255,255,0.06);
  background: rgba(8,8,8,0.9); padding: 48px 32px;
}
.shop-footer-inner {
  max-width: 1280px; margin: 0 auto;
  display: flex; flex-direction: column; align-items: center; gap: 20px;
}
.shop-footer-logo { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.shop-footer-links { display: flex; gap: 32px; flex-wrap: wrap; justify-content: center; }

/* ── Responsive ─────────────────────────────────────────────────────────────── */
@media (max-width: 768px) {
  .shop-nav-links { display: none; }
  .shop-hero-title { font-size: clamp(40px, 12vw, 72px); }
  .shop-pillars { grid-template-columns: repeat(2, 1fr); }
  .shop-grid { grid-template-columns: 1fr; }
  .shop-drawer { width: 100%; right: -100%; }
  .shop-hero-stats { gap: 20px; }
  .shop-catalog-header { flex-direction: column; align-items: flex-start; }
}
`
