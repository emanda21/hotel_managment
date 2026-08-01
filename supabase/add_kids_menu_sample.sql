-- =============================================================================
-- Daris Hotel — Kids Menu Sample Data
-- =============================================================================
-- Optional seed script: run this in the Supabase SQL Editor to populate
-- the Kids Menu category so it shows up immediately on the customer menu page.
--
-- The `category` column on menu_items is a free-text TEXT field with no
-- check constraint, so no schema migration is required — just insert rows.
-- =============================================================================

-- ── Kids Menu dishes ─────────────────────────────────────────────────────────

INSERT INTO public.menu_items (name, description, price, category)
VALUES
  (
    'Mini Cheese Burger',
    'A small, juicy beef patty topped with melted cheddar, fresh lettuce, and a soft sesame bun. Perfect for little ones.',
    6.50,
    'Kids Menu'
  ),
  (
    'Chicken Nuggets & Fries',
    'Crispy golden chicken nuggets served alongside lightly salted French fries. A kids'' classic favourite.',
    7.00,
    'Kids Menu'
  ),
  (
    'Macaroni & Cheese',
    'Creamy elbow macaroni baked with a smooth cheddar sauce. Comfort food crafted specially for younger guests.',
    5.50,
    'Kids Menu'
  ),
  (
    'Mini Margherita Pizza',
    'A petite, thin-crust pizza loaded with tomato sauce and mozzarella cheese. Simple, fresh, and delicious.',
    6.00,
    'Kids Menu'
  ),
  (
    'Fruit Cup & Yoghurt',
    'Seasonal fresh-cut fruit served alongside a smooth vanilla yoghurt dip. A healthy and colourful treat.',
    4.00,
    'Kids Menu'
  );

-- ── Verification ─────────────────────────────────────────────────────────────
-- After running this script, confirm with:
--   SELECT name, price, category FROM public.menu_items WHERE category = 'Kids Menu';
