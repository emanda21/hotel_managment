'use client'
/**
 * app/rooms/page.tsx
 * ------------------
 * In-Room Dining — Room Selection Screen
 *
 * Guests land here (e.g. via QR code in their room), tap their room number,
 * and are instantly redirected to the Menu page with their room pre-selected.
 *
 * Flow
 * ────
 *  1. Guest clicks a room card (e.g. "Room 5").
 *  2. We write `selectedRoom = "5"` to localStorage.
 *  3. router.push('/menu') — the Menu page reads localStorage on mount
 *     and pre-fills the Room Number field in the checkout modal.
 */

import { useRouter } from 'next/navigation'

// ─── Configuration ─────────────────────────────────────────────────────────
const TOTAL_ROOMS = 10
const ROOMS = Array.from({ length: TOTAL_ROOMS }, (_, i) => i + 1)

// ─── Inline Styles (CSS-in-JS for zero external dependency) ────────────────
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Lora:wght@400;600;700&family=Montserrat:wght@400;500;600;700;800;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  .rooms-root {
    font-family: 'Montserrat', system-ui, sans-serif;
    min-height: 100vh;
    background: #080808;
    color: #fff;
    display: flex;
    flex-direction: column;
    align-items: center;
    position: relative;
    overflow-x: hidden;
  }

  /* ── Ambient background glow ── */
  .rooms-glow-1 {
    position: fixed; top: -180px; right: -180px;
    width: 600px; height: 600px;
    background: radial-gradient(circle, rgba(200,146,26,0.08) 0%, transparent 70%);
    border-radius: 50%; pointer-events: none; z-index: 0;
  }
  .rooms-glow-2 {
    position: fixed; bottom: -200px; left: -200px;
    width: 700px; height: 700px;
    background: radial-gradient(circle, rgba(109,11,47,0.09) 0%, transparent 70%);
    border-radius: 50%; pointer-events: none; z-index: 0;
  }

  /* ── Navbar ── */
  .rooms-nav {
    width: 100%; padding: 18px 32px;
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(8,8,8,0.85);
    backdrop-filter: blur(12px);
    position: sticky; top: 0; z-index: 50;
  }
  .rooms-nav-logo {
    display: flex; align-items: center; gap: 12px; text-decoration: none;
  }
  .rooms-nav-logo-icon {
    width: 40px; height: 40px; border-radius: 50%;
    background: linear-gradient(135deg, #C8921A, #7A5410);
    display: flex; align-items: center; justify-content: center;
    font-weight: 900; font-size: 16px; color: #fff;
    box-shadow: 0 0 20px rgba(200,146,26,0.3);
  }
  .rooms-nav-brand { line-height: 1; }
  .rooms-nav-brand-name {
    font-family: 'Lora', serif;
    font-size: 14px; font-weight: 700;
    letter-spacing: 0.22em; color: #C8921A;
    text-transform: uppercase;
  }
  .rooms-nav-brand-sub {
    font-size: 9px; letter-spacing: 0.2em;
    color: rgba(255,255,255,0.35); text-transform: uppercase;
    font-weight: 600; margin-top: 3px;
  }
  .rooms-nav-back {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.12em; color: rgba(255,255,255,0.45);
    text-decoration: none;
    border: 1px solid rgba(255,255,255,0.12);
    padding: 8px 16px; border-radius: 6px;
    transition: all 0.2s ease;
  }
  .rooms-nav-back:hover { color: #C8921A; border-color: rgba(200,146,26,0.4); }

  /* ── Hero header ── */
  .rooms-hero {
    position: relative; z-index: 1;
    text-align: center;
    padding: 72px 24px 40px;
  }
  .rooms-hero-eyebrow {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.35em; color: #C8921A;
    margin-bottom: 18px; display: flex; align-items: center;
    justify-content: center; gap: 10px;
  }
  .rooms-hero-eyebrow::before, .rooms-hero-eyebrow::after {
    content: ''; flex: 0 0 32px; height: 1px;
    background: linear-gradient(to right, transparent, rgba(200,146,26,0.5));
  }
  .rooms-hero-eyebrow::after {
    background: linear-gradient(to left, transparent, rgba(200,146,26,0.5));
  }
  .rooms-hero-title {
    font-family: 'Lora', serif;
    font-size: clamp(32px, 5vw, 52px);
    font-weight: 700; color: #fff; line-height: 1.15;
    margin-bottom: 16px; letter-spacing: -0.02em;
  }
  .rooms-hero-title span { color: #C8921A; }
  .rooms-hero-sub {
    font-size: 13px; color: rgba(255,255,255,0.45);
    max-width: 480px; margin: 0 auto; line-height: 1.7; font-weight: 400;
  }

  /* ── Separator ── */
  .rooms-divider {
    width: 60px; height: 2px; margin: 32px auto 48px;
    background: linear-gradient(to right, transparent, #C8921A, transparent);
    position: relative; z-index: 1;
  }

  /* ── Room grid ── */
  .rooms-grid {
    position: relative; z-index: 1;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 18px;
    width: 100%; max-width: 900px;
    padding: 0 24px 80px;
  }

  /* ── Individual room card ── */
  .room-card {
    position: relative;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 18px;
    padding: 32px 20px;
    cursor: pointer;
    text-align: center;
    transition: all 0.25s cubic-bezier(0.34,1.56,0.64,1);
    overflow: hidden;
    user-select: none;
  }
  .room-card::before {
    content: '';
    position: absolute; inset: 0;
    background: radial-gradient(ellipse at 50% 0%, rgba(200,146,26,0.12) 0%, transparent 65%);
    opacity: 0; transition: opacity 0.25s ease; border-radius: 18px;
  }
  .room-card:hover {
    border-color: rgba(200,146,26,0.55);
    transform: translateY(-6px) scale(1.02);
    box-shadow: 0 20px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(200,146,26,0.2);
  }
  .room-card:hover::before { opacity: 1; }
  .room-card:active { transform: translateY(-2px) scale(0.98); }

  .room-card-icon {
    font-size: 36px; display: block; margin-bottom: 14px;
    filter: drop-shadow(0 4px 8px rgba(200,146,26,0.25));
    transition: transform 0.25s ease;
  }
  .room-card:hover .room-card-icon { transform: scale(1.15); }

  .room-card-number {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.18em; color: rgba(255,255,255,0.4);
    margin-bottom: 4px;
  }
  .room-card-label {
    font-family: 'Lora', serif;
    font-size: 26px; font-weight: 700; color: #fff;
    line-height: 1; letter-spacing: -0.01em;
  }
  .room-card-tag {
    margin-top: 10px;
    font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.15em; color: rgba(200,146,26,0.55);
  }

  /* Animated gold border on hover */
  .room-card::after {
    content: '';
    position: absolute;
    inset: -1px; border-radius: 18px;
    background: linear-gradient(135deg, #C8921A, #7A5410, transparent, #C8921A);
    opacity: 0; transition: opacity 0.3s ease;
    z-index: -1;
  }
  .room-card:hover::after { opacity: 0.35; }

  /* ── Bottom tagline ── */
  .rooms-footer-note {
    position: relative; z-index: 1;
    font-size: 10px; color: rgba(255,255,255,0.2);
    text-transform: uppercase; letter-spacing: 0.15em;
    text-align: center; padding-bottom: 40px;
  }

  /* ── Fade-in animation ── */
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .rooms-hero    { animation: fadeInUp 0.5s ease forwards; }
  .rooms-divider { animation: fadeInUp 0.5s 0.1s ease both; }
  .rooms-grid    { animation: fadeInUp 0.5s 0.2s ease both; }

  @media (max-width: 500px) {
    .rooms-grid { grid-template-columns: repeat(2, 1fr); gap: 14px; padding: 0 16px 64px; }
    .rooms-hero { padding: 48px 16px 28px; }
  }
`

// ─── Page Component ─────────────────────────────────────────────────────────
export default function RoomsPage() {
  const router = useRouter()

  function selectRoom(roomNumber: number) {
    // Write to localStorage as a fallback (belt-and-suspenders).
    // The canonical signal is the URL query param ?room=N —
    // the Menu page uses that as the authoritative source of truth.
    localStorage.setItem('selectedRoom', String(roomNumber))
    // Navigate to menu with the room embedded in the URL.
    // This is the strict context signal: if ?room= is present → Room Service.
    router.push(`/menu?room=${roomNumber}`)
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="rooms-root">
        {/* Ambient glows */}
        <div className="rooms-glow-1" />
        <div className="rooms-glow-2" />

        {/* ── Navbar ── */}
        <nav className="rooms-nav">
          <a href="/" className="rooms-nav-logo">
            <div className="rooms-nav-logo-icon">D</div>
            <div className="rooms-nav-brand">
              <p className="rooms-nav-brand-name">Daris</p>
              <p className="rooms-nav-brand-sub">International Hotel</p>
            </div>
          </a>
          <a href="/" className="rooms-nav-back">← Back to Home</a>
        </nav>

        {/* ── Hero Header ── */}
        <section className="rooms-hero">
          <div className="rooms-hero-eyebrow">✦ In-Room Dining</div>
          <h1 className="rooms-hero-title">
            Select Your <span>Room</span>
          </h1>
          <p className="rooms-hero-sub">
            Choose your room number below and we'll bring our full menu
            directly to your door. Fresh, fast, and crafted with care.
          </p>
        </section>

        <div className="rooms-divider" />

        {/* ── Room Grid ── */}
        <div className="rooms-grid">
          {ROOMS.map((n) => (
            <button
              key={n}
              id={`room-card-${n}`}
              className="room-card"
              onClick={() => selectRoom(n)}
              aria-label={`Select Room ${n}`}
            >
              <span className="room-card-icon">🛎️</span>
              <p className="room-card-number">Room</p>
              <p className="room-card-label">{n}</p>
              <p className="room-card-tag">Tap to Order</p>
            </button>
          ))}
        </div>

        <p className="rooms-footer-note">Daris International Hotel · In-Room Dining</p>
      </div>
    </>
  )
}
