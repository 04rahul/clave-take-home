# Scripts Documentation

Complete guide for setting up the database, processing data, and managing the restaurant analytics system.

## Table of Contents

- [Quick Start](#quick-start)
- [Database Setup](#database-setup)
- [Data Processing](#data-processing)
## Quick Start

### For Supabase (Recommended)

```bash
# 1. Set your Supabase connection string
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# 2. Process and load data (creates schema automatically)
cd scripts
python process_data.py
```

### For Local PostgreSQL

```bash
# 1. Set connection string (optional, uses defaults if not set)
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/clave_assessment"

# 2. Create database and schema
python setup_database.py

# 3. Process and load data
python process_data.py
```

## Database Setup

### Option 1: Using Python Script (Recommended)

The `setup_database.py` script creates the database (if needed) and sets up all tables, views, indexes, and constraints:

```bash
# With default settings (local PostgreSQL)
python scripts/setup_database.py

# With custom database URL
DATABASE_URL="postgresql://user:password@host:port/database" python scripts/setup_database.py

# With individual environment variables
DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=clave_assessment python scripts/setup_database.py
```

### Option 2: Using SQL Directly

```bash
# First, create the database (if it doesn't exist)
createdb clave_assessment

# Then run the schema
psql -U postgres -d clave_assessment -f scripts/create_database_schema.sql
```

### What Gets Created

The schema includes:

- **Enum types**: `product_category`, `source_system_enum`
- **Tables**: 
  - `locations` - Restaurant locations
  - `orders` - Order records
  - `products` - Product catalog
  - `order_items` - Order line items
  - `llm_interactions` - LLM interaction logs (with `retry_metrics`)
- **Indexes**: All necessary indexes for performance
- **Constraints**: Data quality checks (positive amounts, valid order types, etc.)
- **Triggers**: Auto-update `updated_at` timestamps
- **Views**: 
  - `daily_sales_summary` - Daily sales analytics
  - `top_products_revenue` - Top products by revenue
- **Roles**: `app_user` role with restricted permissions (password: `Pass@Clave`)

### Schema Features

- ✅ **Order types**: `DINE_IN`, `TAKE_OUT`, `DELIVERY`, `PICKUP`
- ✅ **llm_interactions table**: Complete with `retry_metrics` JSONB column
- ✅ **All views**: Pre-configured analytics views
- ✅ **All indexes**: Optimized for common queries
- ✅ **Data quality constraints**: Ensures data integrity
- ✅ **app_user role**: Read-only access to main tables, full access to `llm_interactions`

### Compatibility

- ✅ **Local PostgreSQL** (13+)
- ✅ **Supabase** (PostgreSQL with additional services)
- ✅ **AWS RDS PostgreSQL**
- ✅ **Any PostgreSQL 13+ database**

## Data Processing

### Main Processing Script

The `process_data.py` script processes all source data files and loads them into the database:

```bash
# Process and load data (default behavior)
python scripts/process_data.py

# Export CSV files as well
python scripts/process_data.py --export-csv

# Process without loading to database (CSV only)
python scripts/process_data.py --no-load-db

# Process without loading, but export cleaned CSV files
python scripts/process_data.py --no-load-db --export-csv
```

### What It Does

1. **Processes source files**:
   - Toast POS data (`data/sources/toast_pos_export.json`)
   - DoorDash data (`data/sources/doordash_orders.json`)
   - Square POS data (`data/sources/square/*.json`)

2. **Data transformations**:
   - Normalizes timestamps and timezones
   - Applies order type mappings
   - Performs entity resolution (fuzzy matching for products)
   - Cleans product names (removes emojis, fixes typos)
   - Extracts quantities from product names

3. **Database operations**:
   - Creates schema automatically (if not exists)
   - Loads locations, products, orders, and order items
   - Creates/updates database views
   - Handles conflicts gracefully (ON CONFLICT DO UPDATE)

4. **Output files** (optional):
   - `data/processed/hour_of_day_verification.csv` - Verification data
   - `data/processed/cleaned_orders.csv` - Cleaned orders (if `--export-csv`)
   - `data/processed/cleaned_order_items.csv` - Cleaned items (if `--export-csv`)
   - `data/processed/location_timezones.json` - Timezone mapping

### Reprocessing Data

To reprocess data after making changes:

```bash
# 1. Clear existing data (optional - WARNING: deletes all data!)
psql -U postgres -d clave_assessment -c "TRUNCATE TABLE order_items, orders, products, locations CASCADE;"

# Or for Supabase, run in SQL Editor:
# TRUNCATE TABLE order_items, orders, products, locations CASCADE;

# 2. Reprocess and load data
python scripts/process_data.py
```

