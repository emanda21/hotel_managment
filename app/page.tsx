'use client'
import { useState, useEffect } from 'react'

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-stone-950 text-white premium-font-sans relative overflow-x-hidden">
      <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />

      {/* ── GLOBAL KITCHEN BACKGROUND ── */}
      {/* Full-page kitchen image locked behind all content at very low opacity */}
      <div
        className="kitchen-bg-global"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=1800')`,
        }}
      />
      {/* Gradient veil over kitchen bg so text stays readable */}
      <div className="kitchen-bg-veil" />

      {/* Ambient color glows — sit above kitchen bg, below content */}
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#6D0B2F]/12 rounded-full blur-[120px] pointer-events-none z-[2]"></div>
      <div className="absolute top-1/3 left-0 w-[500px] h-[500px] bg-[#C5A880]/6 rounded-full blur-[120px] pointer-events-none z-[2]"></div>

      {/* ── NAVBAR ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${scrolled ? 'premium-navbar-scrolled' : 'premium-navbar'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg logo-icon shadow-lg">
              D
            </div>
            <div>
              <p className="font-bold text-sm tracking-widest uppercase leading-none text-[#C5A880] premium-font-serif">DARIS</p>
              <p className="text-[9px] tracking-widest uppercase text-white/50 font-bold mt-1">International Hotel</p>
            </div>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-10">
            {[
              { label: 'Home', href: '#home' },
              { label: 'Menu', href: '/menu' },
              { label: 'About', href: '#about' },
              { label: 'Contact', href: '#contact' },
              { label: 'Admin', href: '/admin' },
            ].map((item) => (
              <a key={item.label} href={item.href}
                className={`text-xs uppercase tracking-widest transition-colors duration-300 font-semibold hover:text-[#C5A880] ${
                  item.label === 'Home' ? 'text-[#C5A880] active-nav-link' : 'text-white/80'
                }`}>
                {item.label}
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="hidden md:flex items-center gap-3">
            <a href="/menu" className="px-7 py-3 text-xs font-bold uppercase tracking-widest transition-all duration-300 hover:scale-105 active:scale-95 rounded-md premium-btn-gold">
              Order Now
            </a>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden text-white text-2xl focus:outline-none" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden px-6 py-6 flex flex-col gap-5 mobile-menu-dropdown animate-fadeIn">
            {['Home', 'Menu', 'About', 'Contact', 'Admin'].map((item) => (
              <a key={item}
                 href={item === 'Menu' ? '/menu' : item === 'Admin' ? '/admin' : `#${item.toLowerCase()}`}
                 className="text-xs uppercase tracking-widest text-white/90 hover:text-[#C5A880] transition-colors"
                 onClick={() => setMenuOpen(false)}>
                {item}
              </a>
            ))}
            <a href="/menu" className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-center rounded-md premium-btn-gold mt-2" onClick={() => setMenuOpen(false)}>
              Order Now
            </a>
          </div>
        )}
      </nav>

      {/* ── HERO SECTION ── */}
      <section id="home" className="relative min-h-screen flex items-center pt-20 overflow-hidden">

        {/* Hero-specific kitchen close-up — richer opacity than the global bg */}
        <div
          className="hero-kitchen-layer"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=1800')`,
          }}
        />
        <div className="hero-kitchen-gradient" />

        {/* Left text content */}
        <div className="relative z-10 max-w-7xl mx-auto px-6 py-20 w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          <div className="animate-fadeIn">
            <p className="text-xs font-bold uppercase tracking-[0.3em] mb-4 text-[#C5A880]">
              ✦ &nbsp; Fine Dining Experience
            </p>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6 premium-font-serif text-white">
              Delicious &<br />
              <span className="text-[#C5A880]">Mouth Watering</span><br />
              Cuisine
            </h1>
            <p className="text-white/60 text-sm md:text-base leading-relaxed mb-10 max-w-md font-light">
              Experience world-class culinary art at <span className="text-[#C5A880] font-semibold">Daris International Hotel</span>.
              Our passionate chefs combine fresh ingredients with gourmet creativity to satisfy your finest cravings.
            </p>

            <div className="flex flex-col sm:flex-row gap-4">
              <a href="/menu" className="px-8 py-4 text-xs font-bold uppercase tracking-widest text-center rounded-md transition-all duration-300 hover:scale-105 active:scale-95 premium-btn-gold shadow-lg shadow-[#C5A880]/10">
                ✦ &nbsp; View Our Menu
              </a>
              <a href="#about" className="px-8 py-4 text-xs font-bold uppercase tracking-widest text-center rounded-md border border-[#C5A880]/30 text-white/80 transition-all duration-300 hover:border-[#C5A880] hover:text-[#C5A880]">
                Learn More
              </a>
            </div>

            {/* Stats */}
            <div className="flex gap-10 mt-14 pt-8 border-t border-white/10 max-w-md">
              {[{ num: '50+', label: 'Delicacies' }, { num: '10+', label: 'Tables' }, { num: '100%', label: 'Fresh Daily' }].map((s) => (
                <div key={s.label}>
                  <p className="text-2xl md:text-3xl font-bold text-[#C5A880] premium-font-serif">{s.num}</p>
                  <p className="text-[9px] uppercase tracking-widest text-white/40 mt-1 font-bold">{s.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Right Side Luxury Showcase */}
          <div className="flex items-center justify-center lg:justify-end animate-fadeIn relative z-10" style={{ animationDelay: '0.2s' }}>
            <div className="relative w-[340px] h-[340px] md:w-[440px] md:h-[440px] flex items-center justify-center">

              <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-[#6D0B2F]/30 via-transparent to-[#C5A880]/20 blur-2xl animate-spin-slow"></div>

              <div className="absolute inset-4 rounded-full border border-[#C5A880]/30"></div>
              <div className="absolute inset-8 rounded-full border border-dashed border-[#C5A880]/15 animate-spin-reverse"></div>

              <div className="absolute inset-12 rounded-full overflow-hidden border border-[#C5A880]/30 shadow-2xl">
                <img
                  src="https://images.unsplash.com/photo-1544025162-d76694265947?q=80&w=800"
                  alt="Daris Fine Dining"
                  className="w-full h-full object-cover hover:scale-110 transition-transform duration-700"
                />
              </div>

              <div className="absolute top-1/4 right-0 md:-right-4 px-5 py-3 rounded-md text-center shadow-2xl animate-bounce-slow floating-badge">
                <p className="text-[9px] font-bold uppercase tracking-widest text-[#C5A880]">Chef's Special</p>
                <p className="text-sm font-bold text-white premium-font-serif mt-0.5">RIBEYE STEAK</p>
              </div>
            </div>
          </div>

        </div>
      </section>

      {/* ── FEATURES SECTION ── */}
      <section id="about" className="py-28 px-6 relative z-10 border-y border-white/5">
        {/* Subtle kitchen image behind features */}
        <div className="section-kitchen-layer" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1590846406792-0adc7f938f1d?q=80&w=1600')` }} />
        <div className="section-kitchen-veil" />

        <div className="max-w-6xl mx-auto text-center relative z-10">
          <p className="text-xs tracking-[0.4em] uppercase mb-3 text-[#C5A880]">✦ &nbsp; Why Choose Us &nbsp; ✦</p>
          <h2 className="text-3xl md:text-4xl font-bold mb-2 premium-font-serif text-white">Exceptional Dining</h2>
          <div className="w-16 h-0.5 mx-auto mb-16 bg-[#C5A880]"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: '🍽️', title: 'Gourmet Cuisine', desc: 'Savor premium grain-fed meats, fresh organic greens, and artisanal desserts curated by international culinary professionals.' },
              { icon: '📱', title: 'Seamless Ordering', desc: 'Scan the QR code at your hotel table, browse our dynamic digital menu, customize your order, and submit in seconds.' },
              { icon: '⚡', title: 'Express Service', desc: 'Your selections route instantly to our kitchen consoles, minimizing wait time so you can enjoy your dining experience.' },
            ].map((f) => (
              <div key={f.title} className="flex flex-col items-center p-8 rounded-xl border premium-feature-card transition-all duration-300">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl mb-6 feature-icon-wrapper">
                  {f.icon}
                </div>
                <h3 className="font-bold uppercase tracking-widest text-xs mb-3 text-white">{f.title}</h3>
                <p className="text-white/60 text-xs leading-relaxed text-center font-light">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── POPULAR DISHES ── */}
      <section className="py-28 px-6 relative z-10">
        <div className="max-w-6xl mx-auto text-center">
          <p className="text-xs tracking-[0.4em] uppercase mb-3 text-[#C5A880]">✦ &nbsp; Our Specialties &nbsp; ✦</p>
          <h2 className="text-3xl md:text-4xl font-bold mb-2 premium-font-serif text-white">Popular Delicacies</h2>
          <div className="w-16 h-0.5 mx-auto mb-16 bg-[#C5A880]"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=400', name: 'Margherita Pizza', desc: 'Fresh local tomato sauce, premium bufala mozzarella, fresh basil leaves, and raw olive oil glaze.', price: '$12.50', cat: 'Mains' },
              { image: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=400', name: 'Caesar Salad', desc: 'Crispy Romaine lettuce, aged Parmigiano, garlic toasted croutons, tossed in a chef-special dressing.', price: '$9.00', cat: 'Starters' },
              { image: 'https://images.unsplash.com/photo-1577968897966-3d4325b36b61?q=80&w=400', name: 'Cappuccino', desc: 'Double espresso shot of organic coffee beans topped with velvety smooth hot milk microfoam.', price: '$4.50', cat: 'Hot Drinks' },
            ].map((dish) => (
              <div key={dish.name} className="rounded-xl overflow-hidden border premium-dish-card transition-all duration-300">
                <div className="h-52 overflow-hidden relative">
                  <img src={dish.image} alt={dish.name} className="w-full h-full object-cover dish-image" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#111]/80 via-transparent to-transparent"></div>
                  <span className="absolute top-4 left-4 text-[9px] uppercase tracking-widest font-bold px-3 py-1 rounded bg-[#6D0B2F] text-white border border-white/10">{dish.cat}</span>
                </div>
                <div className="p-6 text-left">
                  <h3 className="text-base font-bold mb-2 text-white premium-font-serif">{dish.name}</h3>
                  <p className="text-white/50 text-xs mb-5 font-light leading-relaxed min-h-[36px]">{dish.desc}</p>
                  <div className="flex items-center justify-between pt-4 border-t border-white/5">
                    <span className="text-base font-bold text-[#C5A880] premium-font-serif">{dish.price}</span>
                    <a href="/menu" className="px-5 py-2 text-[10px] font-bold uppercase tracking-widest rounded premium-btn-gold">Order</a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <a href="/menu" className="inline-block mt-16 px-8 py-3.5 text-xs font-bold uppercase tracking-widest rounded-md border border-[#C5A880] text-[#C5A880] hover:bg-[#C5A880]/10 transition-all duration-300">
            View Full Menu &nbsp; →
          </a>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section id="contact" className="py-24 text-center px-6 relative z-10 border-t border-white/5 overflow-hidden" style={{ background: 'linear-gradient(135deg, #1c020b, #0a0a0a)' }}>
        {/* Kitchen image behind CTA */}
        <div className="cta-kitchen-layer" style={{ backgroundImage: `url('https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?q=80&w=1800')` }} />
        <div className="cta-kitchen-veil" />

        <div className="max-w-xl mx-auto relative z-10">
          <p className="text-xs tracking-[0.4em] uppercase mb-4 text-[#C5A880]">✦ &nbsp; Ready to Order? &nbsp; ✦</p>
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 premium-font-serif">Gourmet Dining Awaits</h2>
          <p className="text-white/60 text-xs md:text-sm mb-10 leading-relaxed font-light">Scan the QR code located on your dining table or click the link below to browse our full menu and send your request straight to the chef.</p>
          <a href="/menu" className="inline-block px-10 py-4 text-xs font-bold uppercase tracking-widest rounded-md transition-all duration-300 hover:scale-105 active:scale-95 premium-btn-gold shadow-lg shadow-[#C5A880]/10">
            ✦ &nbsp; Start Ordering Now &nbsp; ✦
          </a>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-12 text-center px-6 bg-black relative z-10 border-t border-white/15">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="h-px w-10 bg-[#C5A880]/30"></div>
          <span className="text-[#C5A880]/50 text-xs">✦</span>
          <div className="h-px w-10 bg-[#C5A880]/30"></div>
        </div>
        <p className="text-[10px] tracking-widest uppercase text-white/40 font-semibold">
          © 2026 Daris International Hotel — All Rights Reserved
        </p>
        {/* Discreet admin link in footer */}
        <a
          href="/admin"
          className="inline-block mt-4 text-[9px] tracking-widest uppercase text-white/15 hover:text-[#C5A880]/50 transition-colors duration-300"
        >
          Staff Console
        </a>
      </footer>

    </div>
  )
}

const STYLESHEET = [
  "@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Lora:ital,wght@0,400;0,500;1,400&family=Montserrat:wght@300;400;500;600;700;800&display=swap');",
  "",
  ".premium-font-serif { font-family: 'Lora', Georgia, serif; }",
  ".premium-font-sans  { font-family: 'Montserrat', system-ui, -apple-system, sans-serif; }",
  "",
  "/* ── GLOBAL KITCHEN BACKGROUND ─────────────────────────── */",
  "/* Fixed behind everything — creates a through-line atmosphere across all sections */",
  ".kitchen-bg-global {",
  "  position: fixed;",
  "  inset: 0;",
  "  z-index: 0;",
  "  background-size: cover;",
  "  background-position: center;",
  "  background-attachment: fixed;",
  "  opacity: 0.04;",
  "  pointer-events: none;",
  "}",
  "",
  ".kitchen-bg-veil {",
  "  position: fixed;",
  "  inset: 0;",
  "  z-index: 1;",
  "  background: radial-gradient(ellipse at 60% 0%, rgba(109,11,47,0.08) 0%, transparent 60%),",
  "              radial-gradient(ellipse at 0% 100%, rgba(197,168,128,0.05) 0%, transparent 60%);",
  "  pointer-events: none;",
  "}",
  "",
  "/* ── HERO KITCHEN LAYER ──────────────────────────────────── */",
  "/* Stronger kitchen presence just in the hero — letterboxed left side */",
  ".hero-kitchen-layer {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 1;",
  "  background-size: cover;",
  "  background-position: center right;",
  "  opacity: 0.10;",
  "  pointer-events: none;",
  "}",
  "",
  ".hero-kitchen-gradient {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 2;",
  "  background: linear-gradient(to right, rgba(12,10,9,0.98) 35%, rgba(12,10,9,0.5) 65%, transparent 100%),",
  "              linear-gradient(to top, rgba(12,10,9,0.9) 0%, transparent 40%);",
  "  pointer-events: none;",
  "}",
  "",
  "/* ── SECTION KITCHEN LAYERS ──────────────────────────────── */",
  ".section-kitchen-layer {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 0;",
  "  background-size: cover;",
  "  background-position: center;",
  "  opacity: 0.06;",
  "  pointer-events: none;",
  "}",
  "",
  ".section-kitchen-veil {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 1;",
  "  background: rgba(10,8,7,0.75);",
  "  pointer-events: none;",
  "}",
  "",
  ".cta-kitchen-layer {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 0;",
  "  background-size: cover;",
  "  background-position: center;",
  "  opacity: 0.08;",
  "  pointer-events: none;",
  "}",
  "",
  ".cta-kitchen-veil {",
  "  position: absolute;",
  "  inset: 0;",
  "  z-index: 1;",
  "  background: linear-gradient(135deg, rgba(28,2,11,0.88), rgba(10,10,10,0.88));",
  "  pointer-events: none;",
  "}",
  "",
  "/* ── ADMIN NAV LINK ─────────────────────────────────────── */",
  ".admin-nav-link {",
  "  width: 32px; height: 32px;",
  "  display: flex; align-items: center; justify-content: center;",
  "  border-radius: 6px;",
  "  border: 1px solid rgba(255,255,255,0.08);",
  "  color: rgba(255,255,255,0.25);",
  "  font-size: 14px;",
  "  transition: all 0.2s ease;",
  "  text-decoration: none;",
  "}",
  ".admin-nav-link:hover {",
  "  border-color: rgba(197,168,128,0.35);",
  "  color: #C5A880;",
  "  background: rgba(197,168,128,0.06);",
  "}",
  ".admin-nav-icon { line-height: 1; }",
  "",
  "/* ── NAVBAR ────────────────────────────────────────────── */",
  ".premium-navbar {",
  "  background-color: rgba(10, 10, 10, 0.4);",
  "  backdrop-filter: blur(5px);",
  "  border-bottom: 1px solid rgba(255, 255, 255, 0.05);",
  "}",
  ".premium-navbar-scrolled {",
  "  background-color: rgba(10, 10, 10, 0.9);",
  "  backdrop-filter: blur(10px);",
  "  border-bottom: 1px solid rgba(197, 168, 128, 0.15);",
  "  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);",
  "}",
  ".logo-icon { background-color: #C5A880; color: #111111; }",
  ".active-nav-link { position: relative; }",
  ".active-nav-link::after { content:'';position:absolute;bottom:-6px;left:0;right:0;height:2px;background-color:#C5A880;border-radius:2px; }",
  ".premium-btn-gold { background-color:#C5A880;color:#111111 !important;border:none;cursor:pointer;transition:all 0.3s ease; }",
  ".premium-btn-gold:hover { background-color:#b0936b; }",
  ".mobile-menu-dropdown { background-color:rgba(10,10,10,0.98);backdrop-filter:blur(10px);border-bottom:1px solid rgba(197,168,128,0.15); }",
  "",
  "/* ── FLOATING BADGE ────────────────────────────────────── */",
  ".floating-badge { background:rgba(10,10,10,0.85);backdrop-filter:blur(8px);border:1px solid rgba(197,168,128,0.3); }",
  "",
  "/* ── FEATURE CARDS ─────────────────────────────────────── */",
  ".premium-feature-card { background:rgba(255,255,255,0.02);border-color:rgba(255,255,255,0.06); }",
  ".premium-feature-card:hover { background:rgba(255,255,255,0.04);border-color:rgba(197,168,128,0.25);transform:translateY(-4px);box-shadow:0 15px 30px rgba(0,0,0,0.4); }",
  ".feature-icon-wrapper { background:rgba(197,168,128,0.08);border:1px solid rgba(197,168,128,0.2);color:#C5A880; }",
  "",
  "/* ── DISH CARDS ─────────────────────────────────────────── */",
  ".premium-dish-card { background:rgba(255,255,255,0.02);border-color:rgba(255,255,255,0.06); }",
  ".premium-dish-card:hover { background:rgba(255,255,255,0.04);border-color:rgba(197,168,128,0.3);transform:translateY(-4px);box-shadow:0 15px 30px rgba(0,0,0,0.4); }",
  ".dish-image { transition:transform 0.6s ease; }",
  ".premium-dish-card:hover .dish-image { transform:scale(1.08); }",
  "",
  "/* ── ANIMATIONS ─────────────────────────────────────────── */",
  "@keyframes fadeIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }",
  ".animate-fadeIn { animation:fadeIn 0.8s cubic-bezier(0.16,1,0.3,1) forwards; }",
  "@keyframes spinSlow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }",
  "@keyframes spinReverse { from{transform:rotate(360deg)} to{transform:rotate(0deg)} }",
  "@keyframes bounceSlow { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }",
  ".animate-spin-slow { animation:spinSlow 20s infinite linear; }",
  ".animate-spin-reverse { animation:spinReverse 15s infinite linear; }",
  ".animate-bounce-slow { animation:bounceSlow 4s infinite ease-in-out; }",
].join("\n")