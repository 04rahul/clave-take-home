-- ============================================
-- COMPLETE DATABASE SCHEMA
-- ============================================
-- This is a consolidated schema file that includes:
-- - All enum types
-- - All tables (locations, orders, products, order_items, llm_interactions)
-- - All indexes
-- - All constraints
-- - All triggers
-- - All views
--
-- COMPATIBILITY: Works with both local PostgreSQL and Supabase
-- PostgreSQL 13+ required
--
-- Usage:
--   psql -U postgres -d database_name -f scripts/create_database_schema.sql
--   OR use the Python script: python scripts/setup_database.py
-- ============================================

-- ============================================
-- 0. ENUM TYPES
-- ============================================
-- Create enum types if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_category') THEN
        CREATE TYPE product_category AS ENUM (
            'burgers',
            'sandwiches',
            'sides',
            'appetizers',
            'beverages',
            'breakfast',
            'entrees',
            'salads',
            'desserts',
            'alcohol',
            'unknown'
        );
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_system_enum') THEN
        CREATE TYPE source_system_enum AS ENUM (
            'Toast',
            'DoorDash',
            'Square'
        );
    END IF;
END$$;

-- ============================================
-- 1. LOCATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(100) NOT NULL UNIQUE, -- "Downtown", "Airport", "Mall Location", "University"
    toast_id VARCHAR(50), -- "loc_downtown_001", etc.
    doordash_id VARCHAR(50), -- "str_downtown_001", etc.
    square_id VARCHAR(50), -- "LCN001DOWNTOWN", etc.
    address_line_1 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(50),
    zip_code VARCHAR(20),
    country VARCHAR(2) DEFAULT 'US',
    timezone VARCHAR(50) DEFAULT 'America/New_York',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_locations_canonical_name ON locations(canonical_name);
CREATE INDEX IF NOT EXISTS idx_locations_toast_id ON locations(toast_id) WHERE toast_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_doordash_id ON locations(doordash_id) WHERE doordash_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_locations_square_id ON locations(square_id) WHERE square_id IS NOT NULL;

-- ============================================
-- 2. ORDERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id VARCHAR(100) NOT NULL UNIQUE, -- Composite ID like "TOAST_ord_...", "DD_D-...", "SQ_ord_..."
    source_system source_system_enum NOT NULL, -- 'Toast', 'DoorDash', 'Square'
    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    external_order_id VARCHAR(100), -- Original order ID from source system
    timestamp_utc TIMESTAMPTZ NOT NULL,
    business_date DATE NOT NULL, -- Business date (may differ from timestamp)
    hour_of_day INTEGER, -- 0-23, extracted from timestamp for analytics
    day_of_week INTEGER, -- 0=Sunday, 6=Saturday, extracted from timestamp for analytics
    order_type VARCHAR(20) NOT NULL, -- 'DINE_IN', 'TAKE_OUT', 'DELIVERY', 'PICKUP'
    total_amount_cents INTEGER NOT NULL DEFAULT 0,
    subtotal_amount_cents INTEGER NOT NULL DEFAULT 0,
    tax_amount_cents INTEGER NOT NULL DEFAULT 0,
    tip_amount_cents INTEGER NOT NULL DEFAULT 0,
    net_revenue_cents INTEGER NOT NULL DEFAULT 0, -- Total minus tax, tip, fees
    fee_amount_cents INTEGER DEFAULT 0, -- Platform fees (DoorDash commission, etc.)
    payment_method VARCHAR(50), -- 'CREDIT', 'CASH', 'WALLET', etc.
    card_brand VARCHAR(50), -- 'VISA', 'MASTERCARD', 'AMEX', etc.
    status VARCHAR(50) DEFAULT 'COMPLETED', -- 'COMPLETED', 'CANCELLED', 'REFUNDED', etc.
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add order_type constraint (includes PICKUP)
DO $$
BEGIN
    -- Drop existing constraint if it exists
    ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
    -- Add updated constraint with PICKUP
    ALTER TABLE orders ADD CONSTRAINT orders_order_type_check 
        CHECK (order_type IN ('DINE_IN', 'TAKE_OUT', 'DELIVERY', 'PICKUP'));
END$$;

CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_location_id ON orders(location_id);
CREATE INDEX IF NOT EXISTS idx_orders_timestamp_utc ON orders(timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_orders_business_date ON orders(business_date);
CREATE INDEX IF NOT EXISTS idx_orders_source_system ON orders(source_system);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders(order_type);
CREATE INDEX IF NOT EXISTS idx_orders_source_location_date ON orders(source_system, location_id, business_date);
CREATE INDEX IF NOT EXISTS idx_orders_hour_of_day ON orders(hour_of_day);
CREATE INDEX IF NOT EXISTS idx_orders_day_of_week ON orders(day_of_week);

-- ============================================
-- 3. PRODUCTS TABLE (Master Catalog)
-- ============================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    canonical_name VARCHAR(200) NOT NULL, -- Normalized product name after entity resolution
    category product_category NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(canonical_name, category) -- Same name can exist in different categories
);

CREATE INDEX IF NOT EXISTS idx_products_canonical_name ON products(canonical_name);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

-- ============================================
-- 4. ORDER ITEMS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL, -- Link to canonical product
    item_name VARCHAR(200) NOT NULL, -- Raw item name from source (for audit)
    canonical_name VARCHAR(200) NOT NULL, -- Cleaned normalized name
    category product_category NOT NULL, -- Normalized category
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price_cents INTEGER NOT NULL DEFAULT 0,
    total_price_cents INTEGER NOT NULL DEFAULT 0, -- unit_price * quantity
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_items_canonical_name ON order_items(canonical_name);
CREATE INDEX IF NOT EXISTS idx_order_items_category ON order_items(category);

-- ============================================
-- 5. LLM INTERACTIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS llm_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_prompt TEXT NOT NULL,
    llm_response TEXT, -- JSON string of LLM response
    error_details TEXT,
    success_status BOOLEAN NOT NULL,
    agent_answered BOOLEAN NOT NULL,
    step_failed VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    response_time_ms INTEGER,
    retry_metrics JSONB DEFAULT NULL -- Tracks retry attempts for analytics
);

CREATE INDEX IF NOT EXISTS idx_llm_interactions_created_at ON llm_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_interactions_success_status ON llm_interactions(success_status);
CREATE INDEX IF NOT EXISTS idx_llm_interactions_agent_answered ON llm_interactions(agent_answered);
CREATE INDEX IF NOT EXISTS idx_llm_interactions_retry_metrics ON llm_interactions USING GIN (retry_metrics);

-- Add comment for documentation
COMMENT ON COLUMN llm_interactions.retry_metrics IS 
'JSON object storing retry metrics: { network_retries: number, sql_regeneration_retries: number, total_retries: number, retry_details: array }';

-- ============================================
-- 6. HELPER FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_locations_updated_at ON locations;
CREATE TRIGGER update_locations_updated_at BEFORE UPDATE ON locations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_products_updated_at ON products;
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. CONSTRAINTS FOR DATA QUALITY
-- ============================================

-- Ensure positive amounts
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_total_orders') THEN
        ALTER TABLE orders ADD CONSTRAINT check_positive_total_orders CHECK (total_amount_cents >= 0);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_total_items') THEN
        ALTER TABLE order_items ADD CONSTRAINT check_positive_total_items CHECK (total_price_cents >= 0);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_positive_quantity') THEN
        ALTER TABLE order_items ADD CONSTRAINT check_positive_quantity CHECK (quantity > 0);
    END IF;
END $$;

-- ============================================
-- 8. VIEWS FOR COMMON ANALYTICS QUERIES
-- ============================================

-- Daily Sales Summary by Location (with hour_of_day for hourly analysis)
DROP VIEW IF EXISTS daily_sales_summary CASCADE;
CREATE VIEW daily_sales_summary AS
SELECT 
    l.canonical_name AS location_name,
    o.business_date,
    o.hour_of_day,
    o.source_system,
    o.order_type,
    COUNT(DISTINCT o.id) AS order_count,
    ROUND(SUM(o.total_amount_cents) / 100.0, 2) AS total_revenue,
    ROUND(SUM(o.net_revenue_cents) / 100.0, 2) AS net_revenue,
    ROUND(SUM(o.tax_amount_cents) / 100.0, 2) AS total_tax,
    ROUND(SUM(o.tip_amount_cents) / 100.0, 2) AS total_tips,
    ROUND(AVG(o.total_amount_cents) / 100.0, 2) AS avg_order_value
FROM orders o
JOIN locations l ON o.location_id = l.id
WHERE o.status = 'COMPLETED'
GROUP BY l.canonical_name, o.business_date, o.hour_of_day, o.source_system, o.order_type
ORDER BY o.business_date DESC, o.hour_of_day, l.canonical_name, o.order_type;

-- Top Products by Revenue (with location)
DROP VIEW IF EXISTS top_products_revenue CASCADE;
CREATE VIEW top_products_revenue AS
SELECT 
    l.canonical_name AS location_name,
    oi.canonical_name AS product_name,
    oi.category,
    COUNT(DISTINCT oi.order_id) AS order_count,
    SUM(oi.quantity) AS total_quantity_sold,
    ROUND(SUM(oi.total_price_cents) / 100.0, 2) AS total_revenue,
    ROUND(AVG(oi.unit_price_cents) / 100.0, 2) AS avg_unit_price
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN locations l ON o.location_id = l.id
WHERE o.status = 'COMPLETED'
GROUP BY l.canonical_name, oi.canonical_name, oi.category
ORDER BY total_revenue DESC;

-- ============================================
-- 9. CREATE app_user ROLE (if needed)
-- ============================================
-- Create app_user role with restricted permissions for the Next.js application
-- This role provides read-only access to main tables and full access to llm_interactions
-- Python scripts continue using the postgres user for full access

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user WITH LOGIN;
        RAISE NOTICE 'Role app_user created successfully';
    ELSE
        RAISE NOTICE 'Role app_user already exists';
    END IF;
END
$$;

-- Set password for app_user
ALTER ROLE app_user WITH PASSWORD 'Pass@Clave';

-- ============================================
-- 10. GRANT PERMISSIONS TO app_user
-- ============================================
-- Grant permissions to app_user role for the analytics dashboard
-- This allows the Next.js application to access tables and views
-- while maintaining security separation between admin (postgres) and app (app_user) users

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        -- Grant schema usage
        GRANT USAGE ON SCHEMA public TO app_user;
        
        -- Grant read-only access to main tables
        GRANT SELECT ON TABLE locations TO app_user;
        GRANT SELECT ON TABLE orders TO app_user;
        GRANT SELECT ON TABLE products TO app_user;
        GRANT SELECT ON TABLE order_items TO app_user;
        
        -- Grant read-only access to views
        GRANT SELECT ON TABLE daily_sales_summary TO app_user;
        GRANT SELECT ON TABLE top_products_revenue TO app_user;
        
        -- Grant full access to llm_interactions (for analytics dashboard logging)
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE llm_interactions TO app_user;
        
        -- Grant usage on sequences (for UUID generation if needed)
        GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        
        RAISE NOTICE 'Permissions granted to app_user';
    ELSE
        RAISE NOTICE 'app_user role does not exist, skipping permission grants';
    END IF;
END
$$;

-- ============================================
-- SCHEMA CREATION COMPLETE
-- ============================================
-- All tables, indexes, constraints, triggers, views, roles, and permissions have been created.
-- The schema is now ready for data loading.
-- 
-- app_user role password: Pass@Clave
-- ============================================

