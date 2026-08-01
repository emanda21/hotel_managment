'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getMenuItems, placeOrder, type MenuItem as ApiMenuItem } from '../../services/api'

// ==========================================
// CUSTOMIZATION CONFIGURATION
// ==========================================
// 1. To change the Hero Background Photo:
//    - You can paste any online image URL here.
//    - Or, put your image in your project's "public" folder (e.g. public/hero-bg.jpg) 
//      and change this string to: '/hero-bg.jpg'
const HERO_IMAGE_URL = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1600'

// Uses the shared type from the API service (id is a UUID string)
type MenuItem = ApiMenuItem

type CartItem = MenuItem & { quantity: number }

const FOOD_CATEGORIES = ['Starters', 'Mains', 'Desserts']
const DRINK_CATEGORIES = ['Soft Drinks', 'Hot Drinks', 'Juices', 'Drinks']
const KIDS_CATEGORIES = ['Kids Menu']

const FOOD_QUOTES = [
  { quote: "First we eat, then we do everything else.", author: "M.F.K. Fisher" },
  { quote: "People who love to eat are always the best people.", author: "Julia Child" },
  { quote: "To eat is a necessity, but to eat intelligently is an art.", author: "François de La Rochefoucauld" },
  { quote: "There is no love sincerer than the love of food.", author: "George Bernard Shaw" },
  { quote: "One cannot think well, love well, sleep well, if one has not dined well.", author: "Virginia Woolf" }
]

// No hardcoded mock data — all menu items come from the FastAPI backend

// ==========================================
// FIX: TableModal is now defined OUTSIDE MenuPage.
// Previously it was declared inside the component body, so every
// keystroke in the table-number input re-rendered MenuPage, which
// created a brand-new TableModal function each time. React saw that
// as a different component type and unmounted/remounted the modal on
// every keystroke -- which restarted its fade-in animation and caused
// the visible "blink blink" flicker. Defining it outside (as a stable,
// top-level component receiving props) keeps the same component
// identity across re-renders, so it no longer remounts while typing.
// ==========================================
type TableModalProps = {
  isRoomService: boolean
  // Room Service fields
  roomInput: string
  setRoomInput: (v: string) => void
  // Dine-In fields
  tableInput: string
  setTableInput: (v: string) => void
  waiterId: string
  setWaiterId: (v: string) => void
  // Shared
  specialInstructions: string
  setSpecialInstructions: (v: string) => void
  confirmOrder: () => void
  setShowTableModal: (v: boolean) => void
  placing: boolean
  orderErrorMsg: string
  cart: CartItem[]
  total: number
  removeFromCart: (itemId: string) => void
  addToCart: (item: MenuItem) => void
}

function TableModal({
  isRoomService,
  roomInput, setRoomInput,
  tableInput, setTableInput,
  waiterId, setWaiterId,
  specialInstructions, setSpecialInstructions,
  confirmOrder, setShowTableModal,
  placing, orderErrorMsg,
  cart, total, removeFromCart, addToCart,
}: TableModalProps) {
  const MAX_CHARS = 300

  // Confirm is valid when all required fields for the current mode are filled
  const canConfirm = isRoomService
    ? roomInput.trim().length > 0
    : tableInput.trim().length > 0 && waiterId.trim().length > 0

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fadeIn">
      <div className="bg-[#FAF6EE] p-8 w-full max-w-sm text-center shadow-2xl rounded-2xl border border-[#C5A880]/20 premium-font-serif max-h-[90vh] overflow-y-auto">
        {/* ── Ornament ── */}
        <div className="flex items-center gap-2 justify-center mb-4">
          <div className="h-px w-8 bg-[#C5A880]/40"></div>
          <span className="text-[#C5A880] text-xs">✦</span>
          <div className="h-px w-8 bg-[#C5A880]/40"></div>
        </div>

        {/* ── Mode header ── */}
        {isRoomService ? (
          <>
            <div className="text-2xl mb-2">🏨</div>
            <h2 className="text-xl font-bold uppercase tracking-widest mb-1 text-[#111111] menu-item-title">Room Service</h2>
            <p className="text-[#555555] text-xs mb-6 premium-font-sans menu-item-desc">Enter your room number for in-room delivery.</p>

            {/* Room Number */}
            <input
              id="room-number-input"
              type="text"
              value={roomInput}
              onChange={(e) => setRoomInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && confirmOrder()}
              className="border-b-2 bg-transparent w-full text-center py-2 mb-6 text-2xl outline-none border-[#C5A880] text-[#111111] font-bold transition-colors focus:border-black premium-font-sans"
              placeholder="e.g. 201" autoFocus
            />
          </>
        ) : (
          <>
            <div className="text-2xl mb-2">🍽️</div>
            <h2 className="text-xl font-bold uppercase tracking-widest mb-1 text-[#111111] menu-item-title">Table Dining</h2>
            <p className="text-[#555555] text-xs mb-5 premium-font-sans menu-item-desc">Enter your table number and waiter to confirm.</p>

            {/* Table Number */}
            <div className="text-left mb-4 premium-font-sans">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#555555] mb-2">
                Table Number <span className="text-red-400">*</span>
              </p>
              <input
                id="table-number-input"
                type="number"
                min={1}
                value={tableInput}
                onChange={(e) => setTableInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmOrder()}
                className="border-b-2 bg-transparent w-full text-center py-2 text-2xl outline-none border-[#C5A880] text-[#111111] font-bold transition-colors focus:border-black premium-font-sans"
                placeholder="e.g. 5" autoFocus
              />
            </div>

            {/* Waiter ID */}
            <div className="text-left mb-5 premium-font-sans">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#555555] mb-2">
                Waiter ID / Name <span className="text-red-400">*</span>
              </p>
              <input
                id="waiter-id-input"
                type="text"
                value={waiterId}
                onChange={(e) => setWaiterId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmOrder()}
                className="border-b-2 bg-transparent w-full text-center py-2 text-lg outline-none border-[#C5A880] text-[#111111] font-bold transition-colors focus:border-black premium-font-sans"
                placeholder="e.g. Ahmed or W-04"
              />
            </div>
          </>
        )}

        {/* ── Special Instructions (shared) ── */}
        <div className="text-left mb-6 premium-font-sans">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#555555] mb-2">
            Special Instructions <span className="normal-case font-normal text-[#999]">(optional)</span>
          </p>
          <textarea
            id="special-instructions-input"
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value.slice(0, MAX_CHARS))}
            placeholder="e.g. No onions, extra spicy, well done…"
            rows={3}
            className="w-full border border-[#C5A880]/40 bg-white/60 rounded-xl px-3 py-2.5 text-xs text-[#333] outline-none focus:border-[#C5A880] resize-none transition-colors duration-200 premium-font-sans"
          />
          <p className="text-right text-[9px] text-[#bbb] mt-1">{specialInstructions.length}/{MAX_CHARS}</p>
        </div>

        {/* ── Order review ── */}
        <div className="text-left mb-6 premium-font-sans">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#555555] mb-3">Your Order</p>
          <div className="flex flex-col gap-3 max-h-[180px] overflow-y-auto pr-1">
            {cart.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#111111] truncate">{c.name}</p>
                  <p className="text-[10px] text-[#888888]">Br {c.price} each</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex items-center gap-1.5 border border-[#C5A880] rounded-lg px-2 py-1">
                    <button
                      type="button"
                      onClick={() => removeFromCart(c.id)}
                      className="text-[#C5A880] font-bold text-xs w-4"
                    >
                      −
                    </button>
                    <span className="text-xs font-bold text-[#111111] w-4 text-center">{c.quantity}</span>
                    <button
                      type="button"
                      onClick={() => addToCart(c)}
                      className="text-[#C5A880] font-bold text-xs w-4"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-xs font-bold text-[#111111] w-14 text-right">Br {c.price * c.quantity}</span>
                </div>
              </div>
            ))}
            {cart.length === 0 && (
              <p className="text-[11px] text-[#999999] italic text-center py-2">Your cart is empty.</p>
            )}
          </div>
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-[#C5A880]/25">
            <span className="text-[10px] font-bold uppercase tracking-widest text-[#555555]">Total</span>
            <span className="text-sm font-bold text-[#111111]">Br {total}</span>
          </div>
        </div>

        {orderErrorMsg && (
          <p className="text-red-600 text-xs mb-4 -mt-2 premium-font-sans font-semibold whitespace-pre-line">{orderErrorMsg}</p>
        )}
        <div className="flex gap-3 premium-font-sans">
          <button
            className="flex-1 py-3 border border-[#C5A880] text-xs font-semibold uppercase tracking-wider rounded-xl text-[#111111] bg-transparent hover:bg-[#C5A880]/10 transition-colors duration-200"
            onClick={() => setShowTableModal(false)}
          >
            Cancel
          </button>
          <button
            className="flex-1 py-3 text-white text-xs font-semibold uppercase tracking-wider rounded-xl bg-[#C5A880] hover:bg-[#b0936b] transition-colors duration-200 disabled:opacity-40"
            onClick={confirmOrder}
            disabled={!canConfirm || placing || cart.length === 0}
          >
            {placing ? 'Placing...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

// MenuPageInner contains useSearchParams() and all the interactive logic.
// It MUST live inside a <Suspense> boundary (see MenuPage below) so that
// Next.js / Vercel can build the page without failing on the useSearchParams call.
function MenuPageInner() {
  const [items, setItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<CartItem[]>([])
  const [placing, setPlacing] = useState(false)
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [showTableModal, setShowTableModal] = useState(false)
  // ── Order context: detected from localStorage on mount ─────────────────────
  const [isRoomService, setIsRoomService]             = useState(false)
  // Room Service fields
  const [roomInput, setRoomInput]                     = useState('')
  // Dine-In fields
  const [tableInput, setTableInput]                   = useState('')
  const [waiterId, setWaiterId]                       = useState('')
  // Shared
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [orderErrorMsg, setOrderErrorMsg] = useState('')
  const [activeFoodCategory, setActiveFoodCategory] = useState<string>('All')
  const [activeDrinkCategory, setActiveDrinkCategory] = useState<string>('All')
  const [activeKidsCategory, setActiveKidsCategory] = useState<string>('All')
  const [chatOpen, setChatOpen] = useState(false)
  const [chatMessages, setChatMessages] = useState<{ role: string; text: string }[]>([])
  const [chatInput, setChatInput] = useState('')

  // ── NEW: Global search query ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('')

  // Slideshow State (rotates every 5 seconds)
  const [slideshowIndex, setSlideshowIndex] = useState(0)
  // Quotes State (rotates every 10 seconds)
  const [quoteIndex, setQuoteIndex] = useState(0)

  const [menuLoading, setMenuLoading] = useState(true)
  const [menuError,   setMenuError]   = useState('')

  // ── Strict context detection (URL query param is the authority) ───────────
  //
  // HOW IT WORKS:
  //   Room Service:  guest comes from /rooms page via router.push('/menu?room=5')
  //                  → ?room= query param is present → Room Service mode
  //   Dine-In:       waiter/guest opens /menu directly (no ?room= param)
  //                  → ALWAYS Dine-In mode, regardless of any stale localStorage
  //
  // WHY URL OVER localStorage:
  //   localStorage persists across sessions. A waiter opening /menu the day after
  //   a room-service order was cancelled would incorrectly see Room Service mode.
  //   The URL is session-scoped: it is only present when the guest literally just
  //   navigated from /rooms. It cannot be stale.
  //
  // CLEANUP:
  //   Dine-In access actively removes any stale selectedRoom from localStorage
  //   so a future /menu?room=X visit starts clean.
  const searchParams = useSearchParams()

  useEffect(() => {
    const roomParam = searchParams.get('room')

    if (roomParam) {
      // ── Room Service mode ──────────────────────────────────────────────
      // URL param is present → guest came from /rooms. Set strict RS mode.
      setIsRoomService(true)
      setRoomInput(roomParam)
      // Sync localStorage so a same-session refresh still auto-fills correctly
      localStorage.setItem('selectedRoom', roomParam)
    } else {
      // ── Dine-In mode ───────────────────────────────────────────────────
      // No URL param → strict Dine-In. Actively clear any stale room data
      // so this cannot bleed into the current session from a previous visit.
      setIsRoomService(false)
      setRoomInput('')
      localStorage.removeItem('selectedRoom')
    }
  }, [searchParams])

  useEffect(() => {
    async function fetchMenu() {
      setMenuLoading(true)
      setMenuError('')
      try {
        const data = await getMenuItems()
        setItems(data)
      } catch {
        setMenuError('Could not load menu. Please try again later.')
      } finally {
        setMenuLoading(false)
      }
    }
    fetchMenu()
  }, [])

  // All items now come from the API — no mock fallback
  const menuItems = items

  // Slideshow interval (5000ms)
  useEffect(() => {
    if (menuItems.length === 0) return
    const interval = setInterval(() => {
      setSlideshowIndex((prev) => (prev + 1) % menuItems.length)
    }, 5000)
    return () => clearInterval(interval)
  }, [menuItems])

  // Quotes interval (10000ms)
  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % FOOD_QUOTES.length)
    }, 10000)
    return () => clearInterval(interval)
  }, [])

  // Safe fallback: null while loading, first item once data arrives.
  // The slideshow only renders when this is non-null (see JSX guard below).
  const currentSlideshowItem: MenuItem | null = menuItems[slideshowIndex] ?? menuItems[0] ?? null
  const currentQuote = FOOD_QUOTES[quoteIndex]

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id)
      if (existing) return prev.map((c) => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c)
      return [...prev, { ...item, quantity: 1 }]
    })
  }

  function removeFromCart(itemId: string) {
    setCart((prev) =>
      prev.map((c) => c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c)
          .filter((c) => c.quantity > 0)
    )
  }

  const total = cart.reduce((sum, c) => sum + c.price * c.quantity, 0)
  const totalCount = cart.reduce((sum, c) => sum + c.quantity, 0)

  // ============================================================
  //  confirmOrder — calls FastAPI /place_order for each cart item.
  //  The endpoint atomically validates stock and deducts ingredients.
  //  If any item is out of stock the API returns 400 with a detailed
  //  shortage list which we surface verbatim to the customer.
  // ============================================================
  async function confirmOrder() {
    // Validate required fields for the current order context
    if (isRoomService && !roomInput.trim()) return
    if (!isRoomService && (!tableInput.trim() || !waiterId.trim())) return

    setPlacing(true)
    setOrderErrorMsg('')

    const shortageMessages: string[] = []
    let anySuccess = false

    for (const cartItem of cart) {
      try {
        if (isRoomService) {
          // Room Service: pass room_number + special_instructions
          await placeOrder(
            cartItem.id,
            cartItem.quantity,
            undefined,                                  // table_number
            roomInput.trim(),                           // room_number
            specialInstructions.trim() || undefined,    // special_instructions
            undefined,                                  // waiter_id
          )
        } else {
          // Dine-In: pass table_number + waiter_id + special_instructions
          await placeOrder(
            cartItem.id,
            cartItem.quantity,
            Number(tableInput),                         // table_number
            undefined,                                  // room_number
            specialInstructions.trim() || undefined,    // special_instructions
            waiterId.trim(),                            // waiter_id
          )
        }
        anySuccess = true
      } catch (err: unknown) {
        // ── Extract the most descriptive error text available ──────────
        // Axios wraps HTTP errors; the FastAPI detail lives in response.data.
        const axiosErr = err as {
          response?: {
            status?: number
            data?: {
              error?:    string
              message?:  string
              detail?:   unknown   // FastAPI uses this for HTTPException
              shortages?: Array<{ ingredient_name: string; shortfall: number; unit: string }>
            }
          }
          message?: string
        }

        const resp    = axiosErr?.response
        const resData = resp?.data

        let errorText = ''

        if (resData?.error === 'INSUFFICIENT_STOCK' && resData.shortages?.length) {
          // Structured shortage payload from the RPC
          const details = resData.shortages
            .map(s => `${s.ingredient_name} (need ${s.shortfall.toFixed(2)} more ${s.unit})`)
            .join(', ')
          errorText = `Insufficient stock — ${details}`

        } else if (typeof resData?.detail === 'string' && resData.detail) {
          // FastAPI HTTPException with a string detail
          errorText = resData.detail

        } else if (Array.isArray(resData?.detail)) {
          // FastAPI 422 Unprocessable Entity — validation error array
          errorText = (resData!.detail as Array<{ msg: string; loc: string[] }>)
            .map(e => `${e.loc?.join(' → ') ?? 'field'}: ${e.msg}`)
            .join('; ')

        } else if (typeof resData?.message === 'string' && resData.message) {
          // Generic message field
          errorText = resData.message

        } else if (axiosErr?.message) {
          // Network-level error (CORS, no server, timeout)
          errorText = axiosErr.message

        } else {
          errorText = 'Unknown error. Check that the API server is running.'
        }

        shortageMessages.push(`${cartItem.name}: ${errorText}`)
      }
    }

    if (shortageMessages.length === 0) {
      // All items placed successfully — clear cart and reset all fields
      setCart([])
      setOrderPlaced(true)
      setShowTableModal(false)
      setRoomInput('')
      setTableInput('')
      setWaiterId('')
      setSpecialInstructions('')
      // Clear room selection from localStorage (guest has placed the order)
      if (isRoomService) localStorage.removeItem('selectedRoom')
    } else if (anySuccess && shortageMessages.length < cart.length) {
      // Partial success
      setOrderErrorMsg('⚠ Some items could not be placed:\n' + shortageMessages.join('\n'))
    } else {
      // All failed
      setOrderErrorMsg('Order failed:\n' + shortageMessages.join('\n'))
    }

    setPlacing(false)
  }

  function getFaqAnswer(question: string): string {
    const q = question.toLowerCase()
    const matchedItem = menuItems.find((item) => q.includes(item.name.toLowerCase()))
    if (matchedItem) return `${matchedItem.name}: ${matchedItem.description}. Price: Br ${matchedItem.price}.`
    if (q.includes('drink') || q.includes('juice')) {
      const drinks = menuItems.filter((i) => DRINK_CATEGORIES.includes(i.category))
      return drinks.length > 0 ? `Our drinks: ${drinks.map((d) => d.name).join(', ')}.` : "No drinks listed yet."
    }
    if (q.includes('kids') || q.includes('children')) {
      const kids = menuItems.filter((i) => KIDS_CATEGORIES.includes(i.category))
      return kids.length > 0 ? `Kids Menu items: ${kids.map((d) => d.name).join(', ')}.` : 'No kids items listed yet.'
    }
    if (q.includes('starter')) { const s = menuItems.filter((i) => i.category === 'Starters'); return s.length > 0 ? `Starters: ${s.map((d) => d.name).join(', ')}.` : 'No starters listed.' }
    if (q.includes('main')) { const m = menuItems.filter((i) => i.category === 'Mains'); return m.length > 0 ? `Mains: ${m.map((d) => d.name).join(', ')}.` : 'No mains listed.' }
    if (q.includes('dessert')) { const d = menuItems.filter((i) => i.category === 'Desserts'); return d.length > 0 ? `Desserts: ${d.map((d) => d.name).join(', ')}.` : 'No desserts listed.' }
    if (q.includes('price') || q.includes('cost')) {
      return `Prices range from Br ${Math.min(...menuItems.map((i) => i.price))} to Br ${Math.max(...menuItems.map((i) => i.price))}.`
    }
    if (q.includes('menu') || q.includes('what do you have')) return menuItems.length > 0 ? `We have: ${menuItems.map((i) => i.name).join(', ')}.` : "No menu data yet."
    return "Try asking about a specific dish, drinks, starters, mains, desserts, kids menu, or prices!"
  }

  function sendChatMessage() {
    if (!chatInput.trim()) return
    const userMsg = chatInput
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }, { role: 'assistant', text: getFaqAnswer(userMsg) }])
    setChatInput('')
  }

  // ── Derived: is search active? ────────────────────────────────────────────
  const isSearching = searchQuery.trim().length > 0
  const q = searchQuery.trim().toLowerCase()

  // Helper: match an item against the search query (name or description)
  function matchesSearch(item: MenuItem): boolean {
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    )
  }

  // ── Food panel items ──────────────────────────────────────────────────────
  const foodItems = menuItems.filter((item) => FOOD_CATEGORIES.includes(item.category))
  const filteredFoodItems = isSearching
    ? foodItems.filter(matchesSearch)
    : activeFoodCategory === 'All'
      ? foodItems
      : foodItems.filter((item) => item.category === activeFoodCategory)

  // ── Drink panel items ─────────────────────────────────────────────────────
  const drinkItems = menuItems.filter((item) => DRINK_CATEGORIES.includes(item.category))
  const filteredDrinkItems = isSearching
    ? drinkItems.filter(matchesSearch)
    : activeDrinkCategory === 'All'
      ? drinkItems
      : drinkItems.filter((item) => item.category === activeDrinkCategory)

  // ── Kids panel items ──────────────────────────────────────────────────────
  const kidsItems = menuItems.filter((item) => KIDS_CATEGORIES.includes(item.category))
  const filteredKidsItems = isSearching
    ? kidsItems.filter(matchesSearch)
    : activeKidsCategory === 'All'
      ? kidsItems
      : kidsItems.filter((item) => item.category === activeKidsCategory)

  // Order confirmation view
  if (orderPlaced) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#FAF6EE] premium-font-serif">
        <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />
        <div className="text-center p-8 md:p-12 bg-white rounded-3xl shadow-xl max-w-sm w-full border border-[#C5A880]/15 animate-fadeIn">
          <div className="text-5xl mb-4 animate-bounce">🎉</div>
          <h1 className="text-2xl font-bold mb-2 uppercase tracking-wider text-[#111111] menu-item-title">Order Placed!</h1>
          <div className="flex items-center gap-2 justify-center my-4">
            <div className="h-px w-8 bg-[#C5A880]/40"></div>
            <span className="text-[#C5A880] text-xs">✦</span>
            <div className="h-px w-8 bg-[#C5A880]/40"></div>
          </div>
          <p className="text-[#555555] mb-6 text-sm premium-font-sans leading-relaxed menu-item-desc">
            Thank you. The kitchen is preparing your dishes. We will serve you shortly.
          </p>
          <button className="text-sm font-semibold text-[#111111] hover:text-[#C5A880] transition-colors duration-200 underline underline-offset-4 decoration-[#C5A880]/40 premium-font-sans" onClick={() => setOrderPlaced(false)}>
            Place another order
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="full-window-wrapper h-screen w-screen bg-black text-white premium-font-sans relative overflow-hidden flex flex-col justify-between">
      <style dangerouslySetInnerHTML={{ __html: STYLESHEET }} />

      {/* Background Image Layer with Dark Overlay - Customizable URL above */}
      <div 
        className="absolute inset-0 bg-cover bg-center bg-no-repeat bg-hero-pattern animate-zoomBg" 
        style={{ backgroundImage: `url(${HERO_IMAGE_URL})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/85 via-black/75 to-black/95 z-10" />

      {/* Top Header Navbar - Fixed Pure CSS layout (Tailwind-Independent) */}
      <header className="premium-header">
        <div className="premium-header-container">
          {/* Split layout: left links, center logo, right links */}
          <div className="premium-nav-left">
            <a href="/">Home</a>
            <a href="#hero" className="active" onClick={() => { setActiveFoodCategory('All'); setActiveDrinkCategory('All'); setActiveKidsCategory('All'); setSearchQuery('') }}>Menu</a>
            <a href="/rooms">Room Service</a>
          </div>
          
          <span className="premium-logo">
            Daris
          </span>

          <div className="premium-nav-right"></div>
        </div>
      </header>

      {/* ── GLOBAL SEARCH BAR ── */}
      <div className="search-bar-wrapper">
        <div className="search-bar-inner">
          <span className="search-icon">🔍</span>
          <input
            id="menu-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search dishes, drinks, kids menu…"
            className="search-input"
            autoComplete="off"
          />
          {isSearching && (
            <button
              className="search-clear-btn"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        {isSearching && (
          <p className="search-results-label">
            Results for &ldquo;<span style={{ color: '#C5A880' }}>{searchQuery}</span>&rdquo;
            &nbsp;—&nbsp;
            {filteredFoodItems.length + filteredDrinkItems.length + filteredKidsItems.length} item
            {filteredFoodItems.length + filteredDrinkItems.length + filteredKidsItems.length !== 1 ? 's' : ''} found
          </p>
        )}
      </div>

      {/* Hero Interactive Dashboard Layout */}
      <div className="hero-dashboard-container">

        {/* ── Loading overlay while fetching from API ── */}
        {menuLoading && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}>
            <div className="premium-spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
            <p style={{ marginTop: 16, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.5)' }}>Loading Menu…</p>
          </div>
        )}

        {/* ── API error banner ── */}
        {menuError && !menuLoading && (
          <div style={{ position: 'absolute', top: 80, left: '50%', transform: 'translateX(-50%)', zIndex: 50, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '14px 24px', maxWidth: 420, width: 'calc(100% - 3rem)', textAlign: 'center' }}>
            <p style={{ color: '#fca5a5', fontWeight: 700, fontSize: 12, marginBottom: 8 }}>⚠ Could not load menu</p>
            <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>{menuError}</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 12, background: 'rgba(197,168,128,0.15)', border: '1px solid rgba(197,168,128,0.4)', color: '#C5A880', borderRadius: 6, padding: '6px 16px', fontSize: 10, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ↺ Retry
            </button>
          </div>
        )}

        {/* Left Panel: Slideshow & Food Quotes */}
        <div className="hero-left-dashboard animate-fadeIn">
          {/* Square Slideshow Box (5-second duration) */}
          {/* Square Slideshow Box — only rendered once at least one menu item has loaded */}
          {currentSlideshowItem ? (
            <div className="slideshow-square-box" onClick={() => addToCart(currentSlideshowItem)}>
              {currentSlideshowItem.image_url ? (
                <img
                  key={currentSlideshowItem.id}
                  src={currentSlideshowItem.image_url}
                  alt={currentSlideshowItem.name}
                  className="slideshow-img animate-slideshowFade"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#FAF6EE] to-[#E3D4C1] flex items-center justify-center text-4xl text-stone-800">
                  🍽️
                </div>
              )}
              <div className="slideshow-overlay">
                <span className="slideshow-badge">Chef's Special</span>
                <h3 className="slideshow-title">{currentSlideshowItem.name}</h3>
                <p className="slideshow-price">Br {currentSlideshowItem.price}</p>
              </div>
            </div>
          ) : (
            /* Skeleton shown while menu data is loading */
            <div className="slideshow-square-box" style={{ background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'default' }}>
              <div style={{ textAlign: 'center', opacity: 0.4 }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🍽️</div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'white' }}>Loading…</div>
              </div>
            </div>
          )}

          {/* Rotating Quotes Box (10-second duration) */}
          <div className="rotating-quotes-box">
            <p className="quote-text animate-quoteFade" key={quoteIndex}>
              &ldquo;{currentQuote.quote}&rdquo;
            </p>
            <span className="quote-author">— {currentQuote.author}</span>
          </div>
        </div>

        {/* Center Panel: Food Scrolled Menu */}
        <div className="hero-menu-panel animate-fadeIn" style={{ animationDelay: '0.1s' }}>
          <h3 className="scroll-menu-header">Explore Food</h3>
          
          {/* Horizontal Food Categories Filter — hidden while searching */}
          {!isSearching ? (
            <div className="scroll-category-tabs">
              {['All', ...FOOD_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveFoodCategory(cat)}
                  className={`scroll-tab-link ${activeFoodCategory === cat ? 'active' : ''}`}
                >
                  {cat}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-panel-label">
              <span className="search-panel-tag">🔍 Searching</span>
            </div>
          )}

          <div className="scroll-menu-list">
            {filteredFoodItems.map((item) => {
              const inCart = cart.find((c) => c.id === item.id)
              return (
                <div key={item.id} className="scroll-menu-item">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="scroll-item-img" />
                  ) : (
                    <div className="scroll-item-placeholder">🍽️</div>
                  )}
                  <div className="scroll-item-details">
                    <div className="scroll-item-header">
                      <span className="scroll-item-name">{item.name}</span>
                      <span className="scroll-item-dots"></span>
                      <span className="scroll-item-price">Br {item.price}</span>
                    </div>
                    <div className="scroll-item-footer">
                      <p className="scroll-item-desc">{item.category}</p>
                      <div className="scroll-item-action">
                        {inCart ? (
                          <div className="scroll-cart-controls">
                            <button onClick={() => removeFromCart(item.id)}>-</button>
                            <span>{inCart.quantity}</span>
                            <button onClick={() => addToCart(item)}>+</button>
                          </div>
                        ) : (
                          <button onClick={() => addToCart(item)} className="scroll-add-btn">
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredFoodItems.length === 0 && (
              <div className="panel-empty-state">
                <span className="panel-empty-icon">🍽️</span>
                <p className="panel-empty-text">
                  {isSearching
                    ? `No food matches "${searchQuery}"`
                    : 'No food items listed in this section yet.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Center-Right Panel: Drinks Scrolled Menu */}
        <div className="hero-menu-panel animate-fadeIn" style={{ animationDelay: '0.2s' }}>
          <h3 className="scroll-menu-header">Explore Drinks</h3>
          
          {/* Horizontal Drink Categories Filter — hidden while searching */}
          {!isSearching ? (
            <div className="scroll-category-tabs">
              {['All', ...DRINK_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveDrinkCategory(cat)}
                  className={`scroll-tab-link ${activeDrinkCategory === cat ? 'active' : ''}`}
                >
                  {cat === 'Soft Drinks' ? 'Soft' : cat === 'Hot Drinks' ? 'Hot' : cat}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-panel-label">
              <span className="search-panel-tag">🔍 Searching</span>
            </div>
          )}

          <div className="scroll-menu-list">
            {filteredDrinkItems.map((item) => {
              const inCart = cart.find((c) => c.id === item.id)
              return (
                <div key={item.id} className="scroll-menu-item">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="scroll-item-img" />
                  ) : (
                    <div className="scroll-item-placeholder">🍹</div>
                  )}
                  <div className="scroll-item-details">
                    <div className="scroll-item-header">
                      <span className="scroll-item-name">{item.name}</span>
                      <span className="scroll-item-dots"></span>
                      <span className="scroll-item-price">Br {item.price}</span>
                    </div>
                    <div className="scroll-item-footer">
                      <p className="scroll-item-desc">{item.category}</p>
                      <div className="scroll-item-action">
                        {inCart ? (
                          <div className="scroll-cart-controls">
                            <button onClick={() => removeFromCart(item.id)}>-</button>
                            <span>{inCart.quantity}</span>
                            <button onClick={() => addToCart(item)}>+</button>
                          </div>
                        ) : (
                          <button onClick={() => addToCart(item)} className="scroll-add-btn">
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredDrinkItems.length === 0 && (
              <div className="panel-empty-state">
                <span className="panel-empty-icon">🍹</span>
                <p className="panel-empty-text">
                  {isSearching
                    ? `No drinks match "${searchQuery}"`
                    : 'No drinks listed in this section yet.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel: Kids Menu Scrolled Menu */}
        <div className="hero-menu-panel kids-menu-panel animate-fadeIn" style={{ animationDelay: '0.3s' }}>
          <h3 className="scroll-menu-header">
            <span className="kids-panel-icon">🧒</span> Explore Kids
          </h3>
          
          {/* Kids Category Filter — hidden while searching */}
          {!isSearching ? (
            <div className="scroll-category-tabs">
              {['All', ...KIDS_CATEGORIES].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveKidsCategory(cat)}
                  className={`scroll-tab-link ${activeKidsCategory === cat ? 'active' : ''}`}
                >
                  {cat === 'Kids Menu' ? '🍟 Kids' : cat}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-panel-label">
              <span className="search-panel-tag">🔍 Searching</span>
            </div>
          )}

          <div className="scroll-menu-list">
            {filteredKidsItems.map((item) => {
              const inCart = cart.find((c) => c.id === item.id)
              return (
                <div key={item.id} className="scroll-menu-item">
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="scroll-item-img" />
                  ) : (
                    <div className="scroll-item-placeholder">🍟</div>
                  )}
                  <div className="scroll-item-details">
                    <div className="scroll-item-header">
                      <span className="scroll-item-name">{item.name}</span>
                      <span className="scroll-item-dots"></span>
                      <span className="scroll-item-price">Br {item.price}</span>
                    </div>
                    <div className="scroll-item-footer">
                      <p className="scroll-item-desc">{item.category}</p>
                      <div className="scroll-item-action">
                        {inCart ? (
                          <div className="scroll-cart-controls">
                            <button onClick={() => removeFromCart(item.id)}>-</button>
                            <span>{inCart.quantity}</span>
                            <button onClick={() => addToCart(item)}>+</button>
                          </div>
                        ) : (
                          <button onClick={() => addToCart(item)} className="scroll-add-btn">
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            {filteredKidsItems.length === 0 && (
              <div className="panel-empty-state">
                <span className="panel-empty-icon">🧒</span>
                <p className="panel-empty-text">
                  {isSearching
                    ? `No kids items match "${searchQuery}"`
                    : 'No kids items yet. Ask an admin to add some!'}
                </p>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Small spacer to push content */}
      <div className="relative z-10 w-full h-4"></div>

      {/* Floating Cart Panel (when cart contains items) */}
      {cart.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-2xl bg-stone-950/95 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl p-4 flex justify-between items-center z-30 text-white animate-slideUp">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-[#C5A880] font-bold">Total Order</span>
            <span className="text-white font-bold text-base premium-font-serif">
              {totalCount} item{totalCount > 1 ? 's' : ''} · Br {total}
            </span>
          </div>
          <button className="bg-[#C5A880] text-white px-6 py-2.5 rounded font-bold text-xs uppercase tracking-widest hover:bg-[#b0936b] transition-colors duration-200 shadow-md" onClick={() => setShowTableModal(true)}>
            Place Order
          </button>
        </div>
      )}

      {showTableModal && (
        <TableModal
          isRoomService={isRoomService}
          roomInput={roomInput}
          setRoomInput={setRoomInput}
          tableInput={tableInput}
          setTableInput={setTableInput}
          waiterId={waiterId}
          setWaiterId={setWaiterId}
          specialInstructions={specialInstructions}
          setSpecialInstructions={setSpecialInstructions}
          confirmOrder={confirmOrder}
          setShowTableModal={setShowTableModal}
          placing={placing}
          orderErrorMsg={orderErrorMsg}
          cart={cart}
          total={total}
          removeFromCart={removeFromCart}
          addToCart={addToCart}
        />
      )}

      {/* Concierge/Chat Panel Toggle */}
      <button className="fixed bottom-6 right-6 bg-[#C5A880] hover:bg-[#b0936b] text-white rounded-full w-14 h-14 flex items-center justify-center shadow-xl text-xl z-40 transition-all duration-300 hover:scale-105 active:scale-95 border border-white/10 animate-pulse-subtle" onClick={() => setChatOpen(!chatOpen)}>
        {chatOpen ? '✕' : '🛎️'}
      </button>

      {chatOpen && (
        <div className="fixed bottom-24 right-6 w-[calc(100%-3rem)] max-w-[340px] bg-stone-950 border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[420px] z-40 overflow-hidden text-white animate-scaleIn">
          <div className="p-4 bg-gradient-to-r from-stone-900 to-stone-950 text-white flex items-center gap-2 border-b border-white/10">
            <span className="text-lg">🛎️</span>
            <div>
              <p className="font-bold text-xs uppercase tracking-widest text-[#C5A880]">Hotel Concierge</p>
              <p className="text-[9px] text-white/50">Ask about our delicacies</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs min-h-[220px]">
            {chatMessages.length === 0 && (
              <div className="text-center py-6 px-4">
                <span className="text-2xl block mb-2 opacity-50">✨</span>
                <p className="text-white/60 leading-relaxed font-light">
                  Welcome to Daris. Ask me about any dish, ingredients, recommendations, or pricing information!
                </p>
              </div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                <span className={m.role === 'user' 
                  ? 'inline-block bg-[#C5A880] text-white px-3.5 py-2 rounded-xl rounded-tr-sm max-w-[85%] text-left shadow-sm' 
                  : 'inline-block bg-stone-900 text-white border border-white/5 px-3.5 py-2 rounded-xl rounded-bl-sm max-w-[85%] text-left shadow-sm'
                }>
                  {m.text}
                </span>
              </div>
            ))}
          </div>
          <div className="p-3 border-t border-white/10 bg-stone-900/40 flex gap-2">
            <input 
              className="flex-1 bg-stone-900 border border-white/10 rounded px-4 py-2 text-xs outline-none text-white placeholder-white/40 focus:border-[#C5A880]" 
              value={chatInput} 
              onChange={(e) => setChatInput(e.target.value)} 
              onKeyDown={(e) => e.key === 'Enter' && sendChatMessage()} 
              placeholder="e.g. Do you have chocolate desserts?" 
            />
            <button className="bg-[#C5A880] hover:bg-[#b0936b] px-4 py-2 rounded text-xs font-bold text-white transition-colors duration-200" onClick={sendChatMessage}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Suspense boundary wrapper — REQUIRED for Vercel / Next.js builds.
//
// Next.js mandates that any component calling useSearchParams() must be
// rendered inside a <Suspense> boundary, or the build fails with:
//   "useSearchParams() should be wrapped in a suspense boundary at page /menu"
//
// Pattern: MenuPageInner owns all the logic (including useSearchParams).
//          MenuPage (the page-level default export) wraps it in <Suspense>.
//          Zero logic changes — purely structural.
// ─────────────────────────────────────────────────────────────────────────────
export default function MenuPage() {
  return (
    <Suspense
      fallback={
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d0d0d',
          flexDirection: 'column',
          gap: 16,
        }}>
          <div style={{
            width: 40, height: 40,
            border: '3px solid rgba(197,168,128,0.15)',
            borderTopColor: '#C5A880',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: '#C5A880', fontFamily: 'Georgia, serif', fontSize: 14, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Loading Menu…
          </span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      }
    >
      <MenuPageInner />
    </Suspense>
  )
}

// Custom CSS styles, Google Fonts imports, background images, and premium transitions
const STYLESHEET = `
@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Lora:ital,wght@0,400;0,500;1,400&family=Montserrat:wght@300;400;500;600;700;800&display=swap');

.premium-font-serif {
  font-family: 'Lora', Georgia, serif;
}

.premium-font-sans {
  font-family: 'Montserrat', system-ui, -apple-system, sans-serif;
}

/* ========================================================
   ROBUST PURE-CSS HEADER STYLES (Tailwind-Independent)
   ======================================================== */
.premium-header {
  position: relative;
  z-index: 20;
  width: 100%;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background-color: rgba(0, 0, 0, 0.45);
}

.premium-header-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 24px;
  box-sizing: border-box;
}

.premium-logo {
  font-size: 26px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: white !important;
  text-decoration: none;
  font-family: 'Lora', Georgia, serif;
  text-align: center;
  margin: 0 20px;
}

.premium-nav-left, .premium-nav-right {
  display: flex;
  gap: 28px;
  align-items: center;
  flex: 1;
}

.premium-nav-left {
  justify-content: flex-end;
}

.premium-nav-right {
  justify-content: flex-start;
}

.premium-nav-left a, .premium-nav-right a {
  color: rgba(255, 255, 255, 0.8) !important;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  text-decoration: none;
  transition: color 0.3s ease;
  white-space: nowrap;
}

.premium-nav-left a:hover, .premium-nav-right a:hover, 
.premium-nav-left a.active, .premium-nav-right a.active {
  color: #C5A880 !important;
}

.premium-table-btn {
  background-color: #C5A880;
  color: white !important;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  cursor: pointer;
  transition: background-color 0.3s ease;
  margin-left: auto;
}

.premium-table-btn:hover {
  background-color: #b0936b;
}

/* Responsive adjustment for header layout */
@media (max-width: 768px) {
  .premium-header-container {
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }
  .premium-nav-left, .premium-nav-right {
    justify-content: center;
    padding: 0;
    gap: 16px;
    flex: none;
  }
  .premium-table-btn {
    margin: 4px auto 0;
  }
}
/* ======================================================== */

/* ========================================================
   GLOBAL SEARCH BAR
   ======================================================== */
.search-bar-wrapper {
  position: relative;
  z-index: 20;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 24px 6px;
  box-sizing: border-box;
}

.search-bar-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 640px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  padding: 10px 16px;
  box-sizing: border-box;
  transition: border-color 0.25s ease, box-shadow 0.25s ease;
}

.search-bar-inner:focus-within {
  border-color: rgba(197, 168, 128, 0.6);
  box-shadow: 0 0 0 3px rgba(197, 168, 128, 0.08), 0 8px 24px rgba(0,0,0,0.4);
}

.search-icon {
  font-size: 14px;
  flex-shrink: 0;
  opacity: 0.7;
  line-height: 1;
}

.search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: white;
  font-size: 13px;
  font-weight: 400;
  font-family: 'Montserrat', system-ui, sans-serif;
  letter-spacing: 0.02em;
  min-width: 0;
}

.search-input::placeholder {
  color: rgba(255, 255, 255, 0.38);
}

.search-clear-btn {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 50%;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  line-height: 1;
  padding: 0;
}

.search-clear-btn:hover {
  background: rgba(197, 168, 128, 0.25);
  color: #C5A880;
}

.search-results-label {
  margin: 6px 0 0;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgba(255, 255, 255, 0.45);
  font-family: 'Montserrat', sans-serif;
}

/* Shown inside each panel when search is active (replaces category tabs) */
.search-panel-label {
  padding: 8px 0 10px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.search-panel-tag {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #C5A880;
  background: rgba(197, 168, 128, 0.1);
  border-radius: 4px;
  padding: 3px 8px;
}

/* Panel empty state */
.panel-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1;
  gap: 10px;
  padding: 32px 16px;
  text-align: center;
}

.panel-empty-icon {
  font-size: 28px;
  opacity: 0.4;
}

.panel-empty-text {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  font-style: italic;
  margin: 0;
  line-height: 1.5;
}

/* Kids panel accent */
.kids-menu-panel {
  border-color: rgba(197, 168, 128, 0.22) !important;
  background: rgba(10, 6, 3, 0.72) !important;
}

.kids-panel-icon {
  font-size: 14px;
  vertical-align: middle;
  margin-right: 4px;
}

@media (max-width: 640px) {
  .search-bar-wrapper {
    padding: 8px 16px 4px;
  }
}

/* ======================================================== */

/* ========================================================
   HERO INTERACTIVE DASHBOARD STYLES
   ======================================================== */
.hero-dashboard-container {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 1400px;
  width: 100%;
  margin: auto;
  padding: 0 24px;
  box-sizing: border-box;
  gap: 16px;
  z-index: 20;
  position: relative;
  flex: 1;
}

.hero-left-dashboard {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 22%;
  min-width: 240px;
  gap: 20px;
}

.hero-menu-panel {
  width: 26%;
  flex-grow: 1;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 400px;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.4);
}

.scroll-menu-header {
  font-size: 16px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: white !important;
  margin: 0;
  font-family: 'Lora', Georgia, serif;
}

.scroll-category-tabs {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 10px 0 8px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  scrollbar-width: none; /* Firefox */
}

.scroll-category-tabs::-webkit-scrollbar {
  display: none; /* Chrome, Safari, Opera */
}

.scroll-tab-link {
  background: transparent;
  border: none;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 4px 8px;
  color: rgba(255, 255, 255, 0.6) !important;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  border-radius: 4px;
}

.scroll-tab-link:hover,
.scroll-tab-link.active {
  color: #C5A880 !important;
  background: rgba(197, 168, 128, 0.12);
}

.scroll-menu-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-right: 8px;
}

/* Custom scrollbar for scrollable menu */
.scroll-menu-list::-webkit-scrollbar {
  width: 4px;
}
.scroll-menu-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
}
.scroll-menu-list::-webkit-scrollbar-thumb {
  background: rgba(197, 168, 128, 0.45);
  border-radius: 4px;
}
.scroll-menu-list::-webkit-scrollbar-thumb:hover {
  background: rgba(197, 168, 128, 0.7);
}

.scroll-menu-item {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-bottom: 12px;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
}

.scroll-item-img {
  width: 50px;
  height: 50px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.scroll-item-placeholder {
  width: 50px;
  height: 50px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

.scroll-item-details {
  flex: 1;
  min-width: 0;
}

.scroll-item-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.scroll-item-name {
  font-size: 13px;
  font-weight: 700;
  color: white !important;
  font-family: 'Lora', Georgia, serif;
}

.scroll-item-dots {
  flex: 1;
  border-bottom: 1px dotted rgba(255, 255, 255, 0.25);
  margin: 0 8px;
  position: relative;
  top: -3px;
}

.scroll-item-price {
  font-size: 13px;
  font-weight: 700;
  color: #C5A880 !important;
  font-family: 'Lora', Georgia, serif;
}

.scroll-item-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}

.scroll-item-desc {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  margin: 0;
}

.scroll-add-btn {
  font-size: 8px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border: 1px solid #C5A880;
  background: transparent;
  color: #C5A880 !important;
  padding: 3px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.scroll-add-btn:hover {
  background: #C5A880;
  color: white !important;
}

.scroll-cart-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  border: 1px solid #C5A880;
  border-radius: 4px;
  padding: 2px 4px;
  background: rgba(255, 255, 255, 0.08);
}

.scroll-cart-controls button {
  border: none;
  background: transparent;
  color: #C5A880 !important;
  font-weight: bold;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}

.scroll-cart-controls span {
  font-size: 9px;
  font-weight: 700;
  color: white;
}

.slideshow-square-box {
  width: 240px;
  height: 240px;
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  background: #111111;
  cursor: pointer;
}

.slideshow-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.slideshow-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.95) 0%, rgba(0, 0, 0, 0.4) 65%, transparent 100%);
  padding: 20px 16px;
  color: white;
}

.slideshow-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  color: #C5A880;
  letter-spacing: 0.15em;
  display: block;
  margin-bottom: 4px;
}

.slideshow-title {
  font-size: 16px;
  font-weight: 700;
  margin: 0 0 4px 0;
  font-family: 'Lora', Georgia, serif;
  line-height: 1.3;
  color: white !important;
}

.slideshow-price {
  font-size: 14px;
  font-weight: 700;
  color: #C5A880;
  margin: 0;
  font-family: 'Lora', Georgia, serif;
}

.rotating-quotes-box {
  width: 240px;
  text-align: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.7);
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  min-height: 100px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  box-sizing: border-box;
}

.quote-text {
  font-size: 12px;
  font-style: italic;
  color: rgba(255, 255, 255, 0.9) !important;
  line-height: 1.6;
  margin: 0 0 8px 0;
}

.quote-author {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  color: #C5A880;
  letter-spacing: 0.15em;
}

/* ======================================================== */

.premium-hero-hr {
  width: 80px;
  border: 0;
  border-top: 2px solid #C5A880;
  margin: 20px auto;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translate(-50%, 14px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.96); transform-origin: bottom right; }
  to { opacity: 1; transform: scale(1); transform-origin: bottom right; }
}

@keyframes zoomBg {
  from { transform: scale(1.03); }
  to { transform: scale(1.0); }
}

.animate-fadeIn {
  animation: fadeIn 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-slideUp {
  animation: slideUp 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-scaleIn {
  animation: scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.animate-zoomBg {
  animation: zoomBg 8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

/* Custom Slideshow & Quote Animations */
@keyframes slideshowFade {
  0% { opacity: 0.3; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { opacity: 0.3; }
}

@keyframes quoteFade {
  0% { opacity: 0.2; transform: translateY(2px); }
  8% { opacity: 1; transform: translateY(0); }
  92% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0.2; transform: translateY(-2px); }
}

.animate-slideshowFade {
  animation: slideshowFade 5s infinite ease-in-out;
}

.animate-quoteFade {
  animation: quoteFade 10s infinite ease-in-out;
}

.animate-pulse-subtle {
  animation: pulseSubtle 3s infinite ease-in-out;
}

@keyframes pulseSubtle {
  0%, 100% { transform: scale(1); box-shadow: 0 10px 25px rgba(197, 168, 128, 0.2); }
  50% { transform: scale(1.05); box-shadow: 0 10px 30px rgba(197, 168, 128, 0.4); }
}

/* Responsive Viewport Hacks to allow scrolling on mobile */
@media (max-width: 1100px) {
  .full-window-wrapper {
    height: auto !important;
    min-height: 100vh;
    overflow-y: auto !important;
    overflow-x: hidden;
  }
  .hero-dashboard-container {
    flex-direction: column;
    align-items: center;
    gap: 24px;
    margin: 20px auto;
    padding: 0 16px;
    flex: none;
  }
  .hero-menu-panel {
    width: 100% !important;
    max-width: 560px;
    height: 360px;
  }
  .hero-left-dashboard {
    width: 100%;
    max-width: 560px;
    min-width: unset;
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
  }
  .slideshow-square-box {
    width: 220px;
    height: 220px;
  }
  .rotating-quotes-box {
    width: 220px;
  }
}

@media (max-width: 500px) {
  .slideshow-square-box {
    width: 160px;
    height: 160px;
  }
  .rotating-quotes-box {
    width: 160px;
  }
}
`