"""
Process raw data and load directly into PostgreSQL database
Combines data cleaning and database loading into a single operation.
"""

import json
import re
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Tuple, Any, Optional
from thefuzz import process, fuzz
import os
import sys
import pytz
from sqlalchemy import func, text
import psycopg2
from uuid import UUID
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    # Also try .env in scripts directory
    load_dotenv(Path(__file__).parent / '.env')

# Import from consolidated models module
from models import (
    # Enums
    OrderType, SourceSystem, OrderStatus, ProductCategory,
    # Database connection
    get_db_session, DATABASE_URL,
    # Models
    Location, Order, Product, OrderItem, Base,
    # Model Registry
    ModelRegistry,
   
)

# ============================================
# CONFIGURATION
# ============================================

DATA_DIR = Path(__file__).parent.parent / "data" / "sources"
OUTPUT_DIR = Path(__file__).parent.parent / "data" / "processed"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Use the consolidated schema file (includes all tables, views, and latest changes)
SCHEMA_FILE = Path(__file__).parent / "create_database_schema.sql"
TIMEZONE_FILE = OUTPUT_DIR / "location_timezones.json"

# Regex patterns
EMOJI_PATTERN = re.compile(r'[^\x00-\x7F]+')  # Remove emojis and non-ASCII
QTY_PATTERN = re.compile(r'(.*?)(\d+)\s*(?:pc|pcs|piece|pieces|ct|count|pack)\b', re.IGNORECASE)
CLEANUP_PATTERN = re.compile(r'\s+')  # Multiple spaces

# Typo corrections (manual fixes for known typos)
# Applied after emoji removal and lowercase conversion
TYPO_CORRECTIONS = {
    "griled chiken": "grilled chicken",
    "griled chicken": "grilled chicken",
    "griled chicken sandwhich": "grilled chicken sandwich",
    "sandwhich": "sandwich",  # Standalone typo (e.g., "Griled Chicken Sandwhich")
    "expresso": "espresso",
    "coffe": "coffee",
    "appitizers": "appetizers",
    "hashbrowns": "hash browns",
    "churos": "churros",  # Catches "churos 6pc" -> "churros 6pc"
    # Note: Quantity extraction happens after typo correction
    # So "churos 6pc" -> "churros" (qty 6) will work correctly
}

# ============================================
# HELPER FUNCTIONS
# ============================================

def clean_text(text: str) -> str:
    """Remove emojis, normalize whitespace, convert to lowercase, fix typos."""
    if not isinstance(text, str) or not text.strip():
        return "unknown"
    
    # Remove emojis and non-ASCII characters
    cleaned = EMOJI_PATTERN.sub('', text)
    
    # Normalize whitespace
    cleaned = CLEANUP_PATTERN.sub(' ', cleaned).strip()
    
    # Convert to lowercase
    cleaned = cleaned.lower()
    
    # Apply typo corrections
    for typo, correction in TYPO_CORRECTIONS.items():
        if typo in cleaned:
            cleaned = cleaned.replace(typo, correction)
    
    return cleaned


def extract_baked_quantity(raw_name: str, original_qty: int) -> Tuple[str, int]:
    """
    Extract quantity baked into name (e.g., "Churros 12pcs" qty 1 -> "churros" qty 12).
    Returns: (clean_name, adjusted_quantity)
    """
    match = QTY_PATTERN.search(raw_name)
    if match:
        name_part = match.group(1).strip()
        baked_qty = int(match.group(2))
        return clean_text(name_part), original_qty * baked_qty
    return clean_text(raw_name), original_qty


def to_cents(value: Any) -> int:
    """Convert currency value to integer cents."""
    if pd.isna(value) or value is None:
        return 0
    
    if isinstance(value, int):
        return value  # Already in cents (assumed)
    
    if isinstance(value, float):
        return int(round(value * 100)) if value >= 0 else int(round(value * 100))
    
    if isinstance(value, str):
        # Remove currency symbols and extract number
        clean_val = re.sub(r'[^\d.-]', '', value)
        if not clean_val:
            return 0
        try:
            # If it looks like dollars (has decimal), multiply by 100
            if '.' in clean_val:
                return int(round(float(clean_val) * 100))
            else:
                # Assume it's already in cents
                return int(clean_val)
        except (ValueError, TypeError):
            return 0
    
    # Try to convert to float then cents
    try:
        return int(round(float(value) * 100))
    except (ValueError, TypeError):
        return 0


def normalize_timestamp(ts_str: str, source: str = "UTC") -> datetime:
    """Normalize timestamp to UTC."""
    if not ts_str:
        return datetime.now(timezone.utc)
    
    try:
        # Parse with UTC recognition for "Z" suffix
        # utc=True ensures pandas recognizes "Z" as UTC timezone
        dt = pd.to_datetime(ts_str, utc=True)
        # Convert pandas Timestamp to Python datetime
        if isinstance(dt, pd.Timestamp):
            dt = dt.to_pydatetime()
        
        # CRITICAL: Ensure we use Python's standard timezone.utc
        # pandas might return a different UTC timezone object that's incompatible with pytz
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            # Convert to naive first, then add standard UTC timezone
            # This ensures compatibility with pytz
            dt = dt.replace(tzinfo=None)
            dt = dt.replace(tzinfo=timezone.utc)
        
        return dt
    except (ValueError, TypeError) as e:
        return datetime.now(timezone.utc)


# ============================================
# ENTITY RESOLUTION (Fuzzy Matching)
# ============================================

def _create_products_from_order_items(registry: ModelRegistry) -> None:
    """Create Products from OrderItems' final canonical names and set relationships."""
    # Clear any existing products (they were created with old names)
    registry.products.clear()
    
    # Create products from final canonical names
    for item in registry.order_items:
        # Get or create product with the final (resolved) canonical_name
        product = registry.get_or_create_product(item.canonical_name, item.category)
        # Set the relationship
        item.product = product


def _models_to_orders_dataframe(registry: ModelRegistry) -> pd.DataFrame:
    """Convert Order model instances to DataFrame."""
    orders_data = []
    for order in registry.orders:
        orders_data.append({
            'order_id': order.order_id,
            'source_system': order.source_system.value if hasattr(order.source_system, 'value') else str(order.source_system),
            'location_name': order.location.canonical_name if order.location else None,
            'location_id_source': None,  # Not stored in model
            'external_order_id': order.external_order_id,
            'timestamp_utc': order.timestamp_utc,
            'business_date': order.business_date,
            'order_type': order.order_type,
            'subtotal_cents': order.subtotal_amount_cents,
            'tax_cents': order.tax_amount_cents,
            'tip_cents': order.tip_amount_cents,
            'total_cents': order.total_amount_cents,
            'net_revenue_cents': order.net_revenue_cents,
            'fee_cents': order.fee_amount_cents or 0,
            'payment_method': order.payment_method,
            'card_brand': order.card_brand,
            'status': order.status,
        })
    return pd.DataFrame(orders_data)


def _models_to_items_dataframe(registry: ModelRegistry) -> pd.DataFrame:
    """Convert OrderItem model instances to DataFrame."""
    items_data = []
    for item in registry.order_items:
        items_data.append({
            'order_id': item.order.order_id if item.order else None,
            'item_name': item.item_name,
            'canonical_name': item.canonical_name,
            'category': item.category.value if hasattr(item.category, 'value') else str(item.category),
            'quantity': item.quantity,
            'unit_price_cents': item.unit_price_cents,
            'total_price_cents': item.total_price_cents,
        })
    return pd.DataFrame(items_data)


def perform_entity_resolution_on_models(registry: ModelRegistry) -> None:
    """Perform fuzzy matching to collapse similar product names in model instances."""
    # Extract product names and categories from OrderItems
    product_data = []
    for item in registry.order_items:
        category_val = item.category.value if isinstance(item.category, ProductCategory) else str(item.category)
        product_data.append({
            'canonical_name': item.canonical_name,
            'category': category_val
        })
    
    if not product_data:
        return
    
    # Create DataFrame for analysis
    df_items = pd.DataFrame(product_data)
    
    # Count occurrences of each product
    product_counts = df_items.groupby(['canonical_name', 'category']).size().reset_index(name='count')
    product_counts = product_counts.sort_values('count', ascending=False)
    
    canonical_map = {}
    processed = set()
    
    # Process products sorted by frequency (most common becomes anchor)
    for idx, row in product_counts.iterrows():
        name = row['canonical_name']
        category = row['category']
        key = (name, category)
        
        if key in processed:
            continue
            
        # This name becomes the canonical anchor
        canonical_map[key] = name
        processed.add(key)
        
        # Find similar names in the same category
        same_category = product_counts[product_counts['category'] == category]
        
        for idx2, row2 in same_category.iterrows():
            name2 = row2['canonical_name']
            key2 = (name2, category)
            
            if key2 in processed:
                continue
            
            # Calculate similarity score
            score = fuzz.token_sort_ratio(name, name2)
            
            # Threshold: 88 catches "hash browns" vs "hashbrowns" but avoids "burger" vs "cheeseburger"
            if score > 88:
                canonical_map[key2] = name
                processed.add(key2)
    
    # Apply the mapping to OrderItems (only update canonical_name)
    original_names = set()
    final_names = set()
    
    for item in registry.order_items:
        category_val = item.category.value if isinstance(item.category, ProductCategory) else str(item.category)
        key = (item.canonical_name, category_val)
        original_names.add(item.canonical_name)
        
        if key in canonical_map and canonical_map[key] != item.canonical_name:
            new_name = canonical_map[key]
            # Update item canonical_name
            item.canonical_name = new_name
            final_names.add(new_name)
        else:
            final_names.add(item.canonical_name)
    
    original_count = len(original_names)
    final_count = len(final_names)


def resolve_category_conflicts(registry: ModelRegistry) -> None:
    """
    Resolve category conflicts for burger items.
    Force all burger items to use 'burgers' category instead of 'entrees'.
    """
    for item in registry.order_items:
        canonical_name_lower = item.canonical_name.lower()
        category_val = item.category.value if isinstance(item.category, ProductCategory) else str(item.category)
        
        # If product name contains "burger" and category is not "burgers", fix it
        if 'burger' in canonical_name_lower and category_val != 'burgers':
            try:
                item.category = ProductCategory.BURGERS
            except ValueError:
                pass


# ============================================
# DATA PROCESSING
# ============================================

def process_and_clean_data(export_csv: bool = True) -> ModelRegistry:
    """
    Process raw data sources and return model instances.
    
    Args:
        export_csv: If True, export to CSV files. If False, skip CSV export.
    
    Returns:
        ModelRegistry with all model instances
    """
    from toast_transformer import process_toast
    from doordash_transformer import process_doordash
    from square_transformer import process_square
    
    # Initialize model registry
    registry = ModelRegistry()
    
    # Process all data sources
    process_toast(DATA_DIR / 'toast_pos_export.json', registry)
    process_doordash(DATA_DIR / 'doordash_orders.json', registry)
    process_square(
        DATA_DIR / 'square' / 'orders.json',
        DATA_DIR / 'square' / 'catalog.json',
        DATA_DIR / 'square' / 'locations.json',
        DATA_DIR / 'square' / 'payments.json',
        registry
    )
    
    # Perform entity resolution
    perform_entity_resolution_on_models(registry)
    
    # Resolve category conflicts (e.g., burger items should be in 'burgers' category)
    resolve_category_conflicts(registry)
    
    # Create Products from final canonical names and set relationships
    _create_products_from_order_items(registry)
    
    # Export to CSV if requested
    if export_csv:
        # Convert model instances to DataFrames for CSV export
        df_orders = _models_to_orders_dataframe(registry)
        df_items = _models_to_items_dataframe(registry)
        
        df_orders.to_csv(OUTPUT_DIR / 'cleaned_orders.csv', index=False)
        df_items.to_csv(OUTPUT_DIR / 'cleaned_order_items.csv', index=False)
    
    # Export location timezone mapping (always export for reference)
    location_timezone_map = registry.get_location_timezone_map()
    if location_timezone_map:
        timezone_file = OUTPUT_DIR / 'location_timezones.json'
        with open(timezone_file, 'w', encoding='utf-8') as f:
            json.dump(location_timezone_map, f, indent=2)
    
    return registry


# ============================================
# DATABASE LOADING
# ============================================

def get_db_connection():
    """Get database connection (for create_schema which uses raw SQL)."""
    try:
        if DATABASE_URL.startswith('postgresql://') or DATABASE_URL.startswith('postgres://'):
            conn = psycopg2.connect(DATABASE_URL)
        else:
            conn = psycopg2.connect(
                host=os.getenv('DB_HOST', 'localhost'),
                port=os.getenv('DB_PORT', '5432'),
                database=os.getenv('DB_NAME', 'clave_assessment'),
                user=os.getenv('DB_USER', 'postgres'),
                password=os.getenv('DB_PASSWORD', 'postgres')
            )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        print(f"Connection string format: postgresql://user:password@host:port/database")
        if DATABASE_URL:
            safe_url = DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL[:50]
            print(f"Attempted connection to: ...@{safe_url}")
        print("\nPlease set DATABASE_URL or POSTGRES_URL environment variable.")
        sys.exit(1)


def create_schema(conn):
    """Create database schema from SQL file."""
    try:
        with open(SCHEMA_FILE, 'r') as f:
            schema_sql = f.read()
        
        with conn.cursor() as cur:
            cur.execute(schema_sql)
        conn.commit()
    except Exception as e:
        conn.rollback()
        # Try to continue anyway - tables might already exist
        pass


def load_models_to_database(session, registry: ModelRegistry):
    """Load model instances directly to database."""
    # Step 1: Load Locations (no dependencies)
    locations = list(registry.locations.values())
    location_id_map = {}  # canonical_name -> database_id
    
    for location in locations:
        # Check if location already exists
        existing = session.query(Location).filter_by(canonical_name=location.canonical_name).first()
        if existing:
            # Update existing location
            existing.toast_id = location.toast_id or existing.toast_id
            existing.doordash_id = location.doordash_id or existing.doordash_id
            existing.square_id = location.square_id or existing.square_id
            existing.timezone = location.timezone or existing.timezone
            existing.address_line_1 = location.address_line_1 or existing.address_line_1
            existing.city = location.city or existing.city
            existing.state = location.state or existing.state
            existing.zip_code = location.zip_code or existing.zip_code
            existing.country = location.country or existing.country
            location_id_map[location.canonical_name] = str(existing.id)
        else:
            # Add new location
            session.add(location)
            session.flush()  # Get ID
            location_id_map[location.canonical_name] = str(location.id)
    
    session.commit()
    
    # Step 2: Load Products (no dependencies)
    products = list(registry.products.values())
    product_id_map = {}  # (canonical_name, category) -> database_id
    
    for product in products:
        # Check if product already exists
        existing = session.query(Product).filter_by(
            canonical_name=product.canonical_name,
            category=product.category
        ).first()
        if existing:
            product_id_map[(product.canonical_name, product.category)] = str(existing.id)
        else:
            # Add and commit individually to ensure TypeDecorator runs for each product
            session.add(product)
            session.flush()  # Get ID - this should trigger TypeDecorator
            session.commit()  # Commit immediately to ensure TypeDecorator processes the enum
            product_id_map[(product.canonical_name, product.category)] = str(product.id)
    
    # Step 3: Load Orders (depends on Locations)
    orders = registry.orders
    order_id_map = {}  # order_id -> database_id
    
    for order in orders:
        # Ensure location is attached (should already be from relationships)
        if order.location and order.location.id is None:
            # Location not yet persisted, get from database
            location = session.query(Location).filter_by(
                canonical_name=order.location.canonical_name
            ).first()
            if location:
                order.location = location
        
        # Check if order already exists
        existing = session.query(Order).filter_by(order_id=order.order_id).first()
        if existing:
            order_id_map[order.order_id] = str(existing.id)
            # Update existing order (optional - skip for now to avoid overwriting)
        else:
            session.add(order)
            session.flush()  # Get ID
            order_id_map[order.order_id] = str(order.id)
    
    session.commit()
    
    # Step 4: Load OrderItems (depends on Orders and Products)
    order_items = registry.order_items
    
    for item in order_items:
        # Ensure order is attached
        if item.order and item.order.id is None:
            order_id = order_id_map.get(item.order.order_id)
            if order_id:
                item.order = session.query(Order).filter_by(id=order_id).first()
        
        # Ensure product is attached
        if item.product and item.product.id is None:
            product_key = (item.product.canonical_name, item.product.category)
            product_id = product_id_map.get(product_key)
            if product_id:
                item.product = session.query(Product).filter_by(id=product_id).first()
        
        # Check if order item already exists (by order_id + item_name + canonical_name)
        existing = session.query(OrderItem).filter_by(
            order_id=item.order.id if item.order else None,
            item_name=item.item_name,
            canonical_name=item.canonical_name
        ).first()
        if not existing:
            session.add(item)
    
    session.commit()


def create_views_if_not_exist(session):
    """Create database views if they don't already exist."""
    views_sql = """
-- Drop and recreate views (necessary when changing column structure)
DROP VIEW IF EXISTS top_products_revenue CASCADE;
DROP VIEW IF EXISTS daily_sales_summary CASCADE;

-- Daily Sales Summary by Location (with hour_of_day for hourly analysis)
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

-- Drop sales_by_order_type view (no longer needed)
DROP VIEW IF EXISTS sales_by_order_type CASCADE;

-- Grant permissions to app_user (if it exists)
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        -- Grant read-only access to views
        GRANT SELECT ON TABLE daily_sales_summary TO app_user;
        GRANT SELECT ON TABLE top_products_revenue TO app_user;
        RAISE NOTICE 'Permissions granted to app_user for views';
    ELSE
        RAISE NOTICE 'app_user role does not exist, skipping permission grants';
    END IF;
END
$$;
"""
    
    try:
        # Use raw SQL execution for views (SQLAlchemy doesn't handle CREATE VIEW well)
        # Execute directly - session already manages the transaction
        conn = session.connection()
        # Execute without begin() since session already has a transaction
        conn.execute(text(views_sql))
        # Commit the view creation (this commits the current transaction)
        session.commit()
    except Exception as e:
        # Don't rollback here - let the outer exception handler manage it
        # Try to continue anyway
        pass


def load_data_to_database(registry: ModelRegistry):
    """
    Load data into PostgreSQL database.
    
    Args:
        registry: ModelRegistry with model instances.
    """
    # Create schema using raw psycopg2 (for SQL file execution)
    conn = get_db_connection()
    create_schema(conn)
    conn.close()
    
    # Connect using SQLAlchemy
    session = get_db_session()
    
    try:
        # Load data using model instances
        load_models_to_database(session, registry)
        
        # Create/update views
        create_views_if_not_exist(session)
    
    except Exception as e:
        session.rollback()
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        session.close()


# ============================================
# MAIN EXECUTION
# ============================================

def main(load_to_db: bool = True, export_csv: bool = False):
    """
    Process raw data and optionally load to database.
    
    Args:
        load_to_db: If True, load data to database. If False, only export CSV files.
        export_csv: If True, export cleaned data to CSV files.
    """
    try:
        # Step 1: Process and clean data
        registry = process_and_clean_data(export_csv=export_csv)
        
        # Step 2: Load to database (if requested)
        if load_to_db:
            load_data_to_database(registry=registry)
            
            print("\n" + "=" * 60)
            print("✅ Complete! Data processed and loaded to database.")
            print("=" * 60)
        else:
            print("\n" + "=" * 60)
            print("✅ Complete! Data processed and exported to CSV.")
            print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description='Process restaurant data and load to database')
    parser.add_argument('--no-load-db', action='store_true', 
                       help='Skip database loading, only export CSV files')
    parser.add_argument('--export-csv', action='store_true',
                       help='Export cleaned data to CSV files (in addition to verification CSV)')
    args = parser.parse_args()
    
    main(load_to_db=not args.no_load_db, export_csv=args.export_csv)

