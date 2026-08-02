-- =============================================================================
-- Migration: Tourist Shop & Marketplace
-- Daris Hotel Management System
--
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- =============================================================================

-- 1. Create the shop_items table
CREATE TABLE IF NOT EXISTS public.shop_items (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    price       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    category    TEXT        NOT NULL,   -- e.g. 'Cultural Clothes', 'Souvenirs', 'Car Rental', 'Experiences'
    image_url   TEXT,
    is_active   BOOLEAN     NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.shop_items
  IS 'Tourist Shop & Marketplace — cultural items, souvenirs, car rentals, and tours.';

-- 2. Enable RLS
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;

-- Allow public read of active items (no auth needed for tourists)
CREATE POLICY "Public can view active shop items"
  ON public.shop_items FOR SELECT
  USING (is_active = true);

-- Allow service role full access (for admin management)
CREATE POLICY "Service role full access"
  ON public.shop_items FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Grant SELECT to anon / authenticated roles
GRANT SELECT ON public.shop_items TO anon, authenticated, service_role;

-- =============================================================================
-- 4. Seed data — 10 rich, authentic Ethiopian items
-- =============================================================================

INSERT INTO public.shop_items (name, description, price, category, image_url, is_active) VALUES

-- Cultural Clothes
(
  'Habesha Kemis (White Dress)',
  'A stunning traditional Ethiopian dress handwoven from pure white cotton with intricate Tilet embroidery borders. Worn during ceremonies, festivals, and special occasions. Available in all sizes — custom tailoring available upon request at the reception.',
  3500.00,
  'Cultural Clothes',
  'https://images.unsplash.com/photo-1594938298603-c8148c4b4997?q=80&w=800',
  true
),
(
  'Ethiopian Gabi (Shawl Wrap)',
  'A thick, warm, hand-woven cotton wrap in the classic Ethiopian style — perfect as a shawl, blanket, or decorative piece. Each piece is unique, handcrafted by artisans in the highlands of Amhara. A timeless souvenir with deep cultural significance.',
  1800.00,
  'Cultural Clothes',
  'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?q=80&w=800',
  true
),

-- Souvenirs
(
  'Traditional Coffee Ceremony Set',
  'The complete Ethiopian coffee ceremony experience in a gift box: a hand-painted clay jebena (coffee pot), 6 traditional clay cups (finjal), a wooden tray, and 250g of premium Yirgacheffe green coffee beans. An unforgettable gift that captures the soul of Ethiopia.',
  2200.00,
  'Souvenirs',
  'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?q=80&w=800',
  true
),
(
  'Handcrafted Meskel Cross Necklace',
  'An exquisitely detailed Ethiopian Orthodox cross hand-carved from ethically sourced ebony wood and inlaid with brass. Each piece is unique — no two are alike. Comes in a hand-stitched leather pouch. A deeply meaningful spiritual artifact and collector''s treasure.',
  950.00,
  'Souvenirs',
  'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?q=80&w=800',
  true
),
(
  'Ethiopian Painting — Lalibela Scene',
  'A vibrant, large-format painting (60×80 cm) depicting the rock-hewn churches of Lalibela rendered in the distinctive Ethiopian miniature painting style. Signed by the artist, shipped rolled in a protective tube. A museum-quality piece for discerning collectors.',
  5500.00,
  'Souvenirs',
  'https://images.unsplash.com/photo-1541961017774-22349e4a1262?q=80&w=800',
  true
),

-- Car Rental
(
  'Luxury Toyota Land Cruiser (Full Day)',
  'A fully air-conditioned, premium Toyota Land Cruiser 200 Series with an experienced professional English-speaking driver. Perfect for city exploration or excursions to surrounding highlands. Includes unlimited mileage within Addis Ababa. Fuel and insurance included.',
  8500.00,
  'Car Rental',
  'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?q=80&w=800',
  true
),
(
  'Executive Mercedes-Benz Sprinter',
  'Travel in supreme comfort with our luxury 8-seat Mercedes Sprinter van — ideal for group airport transfers, corporate travel, or scenic day trips. Features leather seats, tinted windows, Wi-Fi, and complimentary bottled water. Professional uniformed driver included.',
  12000.00,
  'Car Rental',
  'https://images.unsplash.com/photo-1558383331-f520f2888351?q=80&w=800',
  true
),

-- Experiences
(
  'Addis Ababa Heritage City Tour',
  'A full-day curated cultural journey through the capital: the National Museum (Lucy''s fossil), Ethnological Museum, Holy Trinity Cathedral, Merkato market, and Mount Entoto. Includes private transport, an expert historian guide, traditional lunch, and entrance fees.',
  4200.00,
  'Experiences',
  'https://images.unsplash.com/photo-1547471080-7cc2caa01a7e?q=80&w=800',
  true
),
(
  'Awash National Park Safari (2 Days)',
  'An extraordinary 2-day safari to Awash National Park: spot Beisa Oryx, Soemmerring''s Gazelles, Hamadryas Baboons, and over 400 bird species. Includes private 4×4 transport, expert wildlife guide, accommodation at Kereyou Lodge, and all meals.',
  28500.00,
  'Experiences',
  'https://images.unsplash.com/photo-1516426122078-c23e76319801?q=80&w=800',
  true
),
(
  'Private Ethiopian Coffee Farm Visit',
  'A half-day immersive journey to a working organic coffee farm just outside the city. Participate in the full coffee process — from cherry picking to wet processing to the traditional ceremony. Includes expert guide, farm-to-cup tasting, and 500g of fresh single-origin beans to take home.',
  3800.00,
  'Experiences',
  'https://images.unsplash.com/photo-1447933601403-0c6688de566e?q=80&w=800',
  true
);

-- =============================================================================
-- Verification
-- =============================================================================
-- SELECT id, name, category, price FROM public.shop_items ORDER BY category, price;
