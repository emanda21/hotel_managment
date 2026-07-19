'use client'
import { useEffect, useState } from 'react'

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: 'Georgia, serif' }}>

      {/* ── NAVBAR ── */}
      <nav
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled ? 'shadow-lg' : ''
        }`}
        style={{ backgroundColor: '#6D0B2F' }}
      >
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold"
              style={{ backgroundColor: '#FFD700', color: '#6D0B2F' }}
            >
              D
            </div>
            <div>
              <p className="text-xs tracking-widest uppercase" style={{ color: '#FFD700' }}>
                DARIS INTERNATIONAL
              </p>
              <p className="text-white text-xs tracking-widest uppercase opacity-70">HOTEL</p>
            </div>
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-8">
            {['Home', 'Menu', 'About', 'Contact'].map((item) => (
              <a
                key={item}
                href={item === 'Menu' ? '/menu' : '#'}
                className="text-sm uppercase tracking-widest transition-colors hover:opacity-80"
                style={{ color: item === 'Home' ? '#FFD700' : 'white' }}
              >
                {item}
              </a>
            ))}
          </div>

          {/* CTA button */}
          <a
            href="/menu"
            className="px-5 py-2 text-sm font-bold uppercase tracking-widest transition-all hover:opacity-90"
            style={{ backgroundColor: '#FFD700', color: '#6D0B2F' }}
          >
            Order Now
          </a>
        </div>
      </nav>

      {/* ── HERO SECTION ── */}
      <section
        className="min-h-screen flex items-center pt-20"
        style={{
          background: 'linear-gradient(135deg, #1a0008 0%, #6D0B2F 50%, #3d0618 100%)',
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-20 flex flex-col md:flex-row items-center gap-12">

          {/* Left text */}
          <div className="flex-1 text-center md:text-left">
            <p
              className="text-xs tracking-[0.4em] uppercase mb-4"
              style={{ color: '#FFD700' }}
            >
              ✦ &nbsp; Welcome to Fine Dining &nbsp; ✦
            </p>
            <h1
              className="text-5xl md:text-6xl font-bold uppercase leading-tight mb-4"
              style={{ color: '#FFD700', letterSpacing: '0.05em' }}
            >
              DARIS
            </h1>
            <h2
              className="text-3xl md:text-4xl font-bold uppercase mb-2"
              style={{ color: 'white', letterSpacing: '0.1em' }}
            >
              INTERNATIONAL
            </h2>
            <h3
              className="text-xl uppercase tracking-[0.4em] mb-8"
              style={{ color: '#FFD700', opacity: 0.8 }}
            >
              HOTEL
            </h3>

            <div className="flex items-center gap-3 mb-8 justify-center md:justify-start">
              <div className="h-px w-12" style={{ backgroundColor: '#FFD700' }}></div>
              <span style={{ color: '#FFD700' }}>✦</span>
              <div className="h-px w-12" style={{ backgroundColor: '#FFD700' }}></div>
            </div>

            <p className="text-gray-300 text-base leading-relaxed mb-10 max-w-md mx-auto md:mx-0">
              Experience world-class dining from the comfort of your table.
              Browse our curated menu of fine foods and premium beverages,
              and order with a single tap.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
              <a
                href="/menu"
                className="px-8 py-4 text-sm font-bold uppercase tracking-widest text-center transition-all hover:opacity-90 shadow-xl"
                style={{ backgroundColor: '#FFD700', color: '#6D0B2F' }}
              >
                ✦ &nbsp; View Our Menu
              </a>
              <a
                href="/menu"
                className="px-8 py-4 text-sm font-bold uppercase tracking-widest text-center border-2 transition-all hover:bg-white/10"
                style={{ borderColor: '#FFD700', color: '#FFD700' }}
              >
                Order Now
              </a>
            </div>
          </div>

          {/* Right — phone mockup */}
          <div className="flex-1 flex justify-center">
            <div className="relative">
              {/* Glow effect */}
              <div
                className="absolute inset-0 rounded-3xl blur-3xl opacity-30"
                style={{ backgroundColor: '#FFD700' }}
              ></div>

              {/* Phone frame */}
              <div
                className="relative w-64 rounded-[40px] p-3 shadow-2xl"
                style={{ backgroundColor: '#111', border: '2px solid #FFD700' }}
              >
                {/* Phone notch */}
                <div className="w-20 h-5 rounded-full mx-auto mb-2" style={{ backgroundColor: '#222' }}></div>

                {/* Phone screen */}
                <div className="rounded-[28px] overflow-hidden" style={{ backgroundColor: '#1a0008' }}>
                  {/* Mock menu header */}
                  <div className="py-3 px-4 text-center" style={{ backgroundColor: '#6D0B2F' }}>
                    <p className="text-xs font-bold tracking-widest uppercase" style={{ color: '#FFD700' }}>
                      DARIS HOTEL
                    </p>
                  </div>

                  {/* Mock menu items */}
                  {[
                    { name: 'Grilled Salmon', price: '$18.00', emoji: '🐟' },
                    { name: 'Beef Tenderloin', price: '$24.00', emoji: '🥩' },
                    { name: 'Caesar Salad', price: '$9.00', emoji: '🥗' },
                    { name: 'Cappuccino', price: '$4.50', emoji: '☕' },
                  ].map((item, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between px-3 py-2.5 border-b"
                      style={{ borderColor: '#2a0010' }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{item.emoji}</span>
                        <div>
                          <p className="text-white text-xs font-semibold">{item.name}</p>
                          <p className="text-xs" style={{ color: '#FFD700' }}>{item.price}</p>
                        </div>
                      </div>
                      <div
                        className="text-xs px-2 py-1 rounded-full font-bold"
                        style={{ backgroundColor: '#FFD700', color: '#6D0B2F' }}
                      >
                        Add
                      </div>
                    </div>
                  ))}

                  {/* Mock order bar */}
                  <div className="px-3 py-3 text-center" style={{ backgroundColor: '#FFD700' }}>
                    <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#6D0B2F' }}>
                      Place Order — 2 items
                    </p>
                  </div>
                </div>

                {/* Phone home bar */}
                <div className="w-16 h-1 rounded-full mx-auto mt-2" style={{ backgroundColor: '#333' }}></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES SECTION ── */}
      <section className="py-20 bg-white">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs tracking-[0.4em] uppercase mb-3" style={{ color: '#B8860B' }}>
            ✦ &nbsp; Why Choose Us &nbsp; ✦
          </p>
          <h2 className="text-3xl font-bold uppercase mb-2" style={{ color: '#6D0B2F' }}>
            Exceptional Experience
          </h2>
          <div className="w-16 h-0.5 mx-auto mb-12" style={{ backgroundColor: '#B8860B' }}></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {[
              { icon: '🍽️', title: 'Fine Cuisine', desc: 'Expertly crafted dishes using the finest ingredients from around the world.' },
              { icon: '📱', title: 'Easy Ordering', desc: 'Scan, browse, and order from your table in seconds. No waiting, no hassle.' },
              { icon: '⚡', title: 'Fast Service', desc: 'Your order goes directly to our kitchen for the fastest possible service.' },
            ].map((f, i) => (
              <div key={i} className="flex flex-col items-center">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-2xl mb-4"
                  style={{ backgroundColor: '#FFF8E7', border: '2px solid #B8860B' }}
                >
                  {f.icon}
                </div>
                <h3 className="font-bold uppercase tracking-widest text-sm mb-2" style={{ color: '#6D0B2F' }}>
                  {f.title}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ── */}
      <section className="py-16 text-center" style={{ backgroundColor: '#6D0B2F' }}>
        <p className="text-xs tracking-[0.4em] uppercase mb-4" style={{ color: '#FFD700' }}>
          ✦ &nbsp; Ready to Order? &nbsp; ✦
        </p>
        <h2 className="text-3xl font-bold uppercase mb-6 text-white">
          Start Your Dining Experience
        </h2>
        <a
          href="/menu"
          className="inline-block px-10 py-4 text-sm font-bold uppercase tracking-widest transition-all hover:opacity-90"
          style={{ backgroundColor: '#FFD700', color: '#6D0B2F' }}
        >
          ✦ &nbsp; Open the Menu &nbsp; ✦
        </a>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-8 text-center" style={{ backgroundColor: '#1a0008' }}>
        <p className="text-xs tracking-widest uppercase" style={{ color: '#FFD700' }}>
          © 2024 Daris International Hotel — All Rights Reserved
        </p>
      </footer>

    </div>
  )
}