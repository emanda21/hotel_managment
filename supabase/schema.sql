-- =============================================================================
-- Daris Hotel — Kitchen Inventory & Menu Management System
-- Database Schema v2  (Supabase PostgreSQL)
-- =============================================================================
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- NOTE: This script drops the previous schema tables first. Back up data
--       before running against a production project.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- DROP LEGACY TABLES (v1 schema)
-- =============================================================================
DROP TABLE IF EXISTS public.orders    CASCADE;
DROP TABLE IF EXISTS public.recipes   CASCADE;
DROP TABLE IF EXISTS public.menu_items CASCADE;
DROP TABLE IF EXISTS public.ingredients CASCADE;


-- =============================================================================
-- TABLE 1 — store_inventory
-- Tracks every raw ingredient held in the hotel kitchen.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.store_inventory (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT            NOT NULL,
    unit                TEXT            NOT NULL,           -- e.g. KG, Liter, Gram, Spoon, Cup, Pcs
    stock_level         FLOAT           NOT NULL DEFAULT 0  CHECK (stock_level >= 0),
    low_stock_threshold FLOAT           NOT NULL DEFAULT 0  CHECK (low_stock_threshold >= 0),
    cost_per_unit       FLOAT           NOT NULL DEFAULT 0  CHECK (cost_per_unit >= 0),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.store_inventory                    IS 'Raw kitchen ingredients with live stock levels and cost data.';
COMMENT ON COLUMN public.store_inventory.unit               IS 'Flexible unit string: KG, Liter, Gram, Spoon, Cup, Pcs, etc.';
COMMENT ON COLUMN public.store_inventory.stock_level        IS 'Current available quantity in the kitchen store.';
COMMENT ON COLUMN public.store_inventory.low_stock_threshold IS 'Admin alert threshold — never exposed to customers.';
COMMENT ON COLUMN public.store_inventory.cost_per_unit      IS 'Purchase cost per unit for financial reporting.';


-- =============================================================================
-- TABLE 2 — menu_items
-- Dishes and drinks shown to customers on the hotel menu.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.menu_items (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        TEXT            NOT NULL,
    description TEXT            NOT NULL DEFAULT '',
    price       FLOAT           NOT NULL CHECK (price >= 0),
    category    TEXT            NOT NULL,                   -- e.g. Starters, Mains, Drinks
    image_url   TEXT            NULL,
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.menu_items             IS 'Customer-facing menu dishes and beverages.';
COMMENT ON COLUMN public.menu_items.category    IS 'Display grouping: Starters, Mains, Drinks, Desserts, etc.';
COMMENT ON COLUMN public.menu_items.image_url   IS 'Optional URL to the dish image stored in Supabase Storage.';


-- =============================================================================
-- TABLE 3 — recipes  (bridge / junction table)
-- Maps each menu item to the exact ingredients (and quantities) it consumes.
-- This table drives automatic stock deduction when an order is placed.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.recipes (
    id               UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id     UUID    NOT NULL
                                REFERENCES public.menu_items(id)
                                ON DELETE CASCADE,
    ingredient_id    UUID    NOT NULL
                                REFERENCES public.store_inventory(id)
                                ON DELETE CASCADE,
    quantity_needed  FLOAT   NOT NULL CHECK (quantity_needed > 0),

    -- One menu item cannot reference the same ingredient twice.
    CONSTRAINT recipes_unique_pair UNIQUE (menu_item_id, ingredient_id)
);

COMMENT ON TABLE  public.recipes                 IS 'Recipe lines: ingredient quantities consumed per single serving of a menu item.';
COMMENT ON COLUMN public.recipes.quantity_needed IS 'Amount of the ingredient required per 1 serving, in the ingredient''s own unit.';


-- =============================================================================
-- INDEXES
-- =============================================================================

-- Find ingredients below their low-stock threshold (admin dashboard alert)
CREATE INDEX IF NOT EXISTS idx_store_inventory_low_stock
    ON public.store_inventory(stock_level, low_stock_threshold);

-- Look up all recipe lines for a given menu item
CREATE INDEX IF NOT EXISTS idx_recipes_menu_item_id
    ON public.recipes(menu_item_id);

-- Look up all recipe lines that use a given ingredient
CREATE INDEX IF NOT EXISTS idx_recipes_ingredient_id
    ON public.recipes(ingredient_id);

-- Filter menu items by category (customer-facing browse)
CREATE INDEX IF NOT EXISTS idx_menu_items_category
    ON public.menu_items(category);


-- =============================================================================
-- ROW LEVEL SECURITY (RLS)
-- =============================================================================
-- Strategy: authenticated staff get full CRUD; public (anon) can only
-- read menu_items (customer-facing menu).  store_inventory and recipes
-- are admin-only.
-- =============================================================================

ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes         ENABLE ROW LEVEL SECURITY;

-- ---  store_inventory  (admin staff only) ------------------------------------
CREATE POLICY "Staff can view inventory"
    ON public.store_inventory FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert inventory"
    ON public.store_inventory FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Staff can update inventory"
    ON public.store_inventory FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete inventory"
    ON public.store_inventory FOR DELETE TO authenticated USING (true);

-- ---  menu_items  (public read, staff write) ----------------------------------
-- Customers (anon role) can browse the menu.
CREATE POLICY "Anyone can view menu items"
    ON public.menu_items FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Staff can insert menu items"
    ON public.menu_items FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Staff can update menu items"
    ON public.menu_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete menu items"
    ON public.menu_items FOR DELETE TO authenticated USING (true);

-- ---  recipes  (admin staff only) --------------------------------------------
CREATE POLICY "Staff can view recipes"
    ON public.recipes FOR SELECT TO authenticated USING (true);

CREATE POLICY "Staff can insert recipes"
    ON public.recipes FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Staff can update recipes"
    ON public.recipes FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Staff can delete recipes"
    ON public.recipes FOR DELETE TO authenticated USING (true);


-- =============================================================================
-- SAMPLE DATA  (remove before production)
-- =============================================================================

INSERT INTO public.store_inventory (name, unit, stock_level, low_stock_threshold, cost_per_unit) VALUES
    ('Chicken Breast',   'KG',    10.0,   2.0,   8.50),
    ('Pasta',            'KG',    15.0,   3.0,   1.20),
    ('Tomato Sauce',     'Liter',  8.0,   1.5,   2.00),
    ('Olive Oil',        'Liter',  5.0,   1.0,   6.00),
    ('Parmesan Cheese',  'KG',     3.0,   0.5,  12.00),
    ('Garlic',           'KG',     1.0,   0.2,   4.00),
    ('Basmati Rice',     'KG',    20.0,   5.0,   1.80),
    ('Butter',           'KG',     4.0,   1.0,   7.50),
    ('Salt',             'KG',     5.0,   1.0,   0.50),
    ('Black Pepper',     'KG',     2.0,   0.3,   8.00),
    ('Coca-Cola',        'Pcs',   48.0,  12.0,   0.60),
    ('Orange Juice',     'Liter', 10.0,   2.0,   2.50);

INSERT INTO public.menu_items (name, description, price, category) VALUES
    ('Grilled Chicken',    'Tender grilled chicken breast with herb seasoning and roasted vegetables.', 18.50, 'Mains'),
    ('Pasta Pomodoro',     'Classic Italian pasta with rich tomato sauce, garlic, and fresh basil.',    14.00, 'Mains'),
    ('Chicken Pasta',      'Grilled chicken strips over al-dente pasta in a creamy parmesan sauce.',    20.00, 'Mains'),
    ('Garlic Butter Rice', 'Fluffy basmati rice tossed in garlic butter and seasoned to perfection.',    8.00, 'Starters'),
    ('Coca-Cola',          'Ice-cold Coca-Cola 330ml.',                                                  3.00, 'Drinks'),
    ('Fresh Orange Juice', 'Freshly squeezed orange juice, served chilled.',                             5.50, 'Drinks');

-- Recipes: Grilled Chicken
INSERT INTO public.recipes (menu_item_id, ingredient_id, quantity_needed)
SELECT mi.id, i.id, r.qty
FROM (VALUES
    ('Grilled Chicken', 'Chicken Breast', 0.200),
    ('Grilled Chicken', 'Olive Oil',      0.020),
    ('Grilled Chicken', 'Garlic',         0.010),
    ('Grilled Chicken', 'Salt',           0.005),
    ('Grilled Chicken', 'Black Pepper',   0.003)
) AS r(menu_item, ingredient, qty)
JOIN public.menu_items      mi ON mi.name = r.menu_item
JOIN public.store_inventory i  ON i.name  = r.ingredient;

-- Recipes: Pasta Pomodoro
INSERT INTO public.recipes (menu_item_id, ingredient_id, quantity_needed)
SELECT mi.id, i.id, r.qty
FROM (VALUES
    ('Pasta Pomodoro', 'Pasta',        0.150),
    ('Pasta Pomodoro', 'Tomato Sauce', 0.100),
    ('Pasta Pomodoro', 'Olive Oil',    0.015),
    ('Pasta Pomodoro', 'Garlic',       0.008),
    ('Pasta Pomodoro', 'Salt',         0.003)
) AS r(menu_item, ingredient, qty)
JOIN public.menu_items      mi ON mi.name = r.menu_item
JOIN public.store_inventory i  ON i.name  = r.ingredient;

-- Recipes: Chicken Pasta
INSERT INTO public.recipes (menu_item_id, ingredient_id, quantity_needed)
SELECT mi.id, i.id, r.qty
FROM (VALUES
    ('Chicken Pasta', 'Chicken Breast',  0.150),
    ('Chicken Pasta', 'Pasta',           0.120),
    ('Chicken Pasta', 'Parmesan Cheese', 0.030),
    ('Chicken Pasta', 'Olive Oil',       0.010),
    ('Chicken Pasta', 'Salt',            0.004)
) AS r(menu_item, ingredient, qty)
JOIN public.menu_items      mi ON mi.name = r.menu_item
JOIN public.store_inventory i  ON i.name  = r.ingredient;

-- Recipes: Garlic Butter Rice
INSERT INTO public.recipes (menu_item_id, ingredient_id, quantity_needed)
SELECT mi.id, i.id, r.qty
FROM (VALUES
    ('Garlic Butter Rice', 'Basmati Rice', 0.200),
    ('Garlic Butter Rice', 'Butter',       0.020),
    ('Garlic Butter Rice', 'Garlic',       0.010),
    ('Garlic Butter Rice', 'Salt',         0.003)
) AS r(menu_item, ingredient, qty)
JOIN public.menu_items      mi ON mi.name = r.menu_item
JOIN public.store_inventory i  ON i.name  = r.ingredient;
