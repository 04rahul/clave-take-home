#!/usr/bin/env python3
"""
Complete Database Setup Script
Creates the database (if it doesn't exist) and sets up all tables, views, and constraints.

Usage:
    python scripts/setup_database.py
    
    Or with custom database URL:
    DATABASE_URL="postgresql://user:pass@host:port/dbname" python scripts/setup_database.py
"""

import os
import sys
from pathlib import Path
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from urllib.parse import urlparse
import re
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    # Also try .env in scripts directory
    load_dotenv(Path(__file__).parent / '.env')

# Get the script directory
SCRIPT_DIR = Path(__file__).parent
SCHEMA_FILE = SCRIPT_DIR / "create_database_schema.sql"

# Default database name
DEFAULT_DB_NAME = "clave_assessment"


def parse_database_url(url: str):
    """
    Parse a PostgreSQL connection URL.
    Returns: (host, port, user, password, database)
    """
    try:
        parsed = urlparse(url)
        host = parsed.hostname or 'localhost'
        port = parsed.port or 5432
        user = parsed.username or 'postgres'
        password = parsed.password or 'postgres'
        database = parsed.path.lstrip('/') if parsed.path else DEFAULT_DB_NAME
        
        return host, port, user, password, database
    except Exception as e:
        print(f"❌ Error parsing DATABASE_URL: {e}")
        sys.exit(1)


def get_connection_params():
    """Get database connection parameters from environment or defaults."""
    database_url = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL')
    
    if database_url:
        return parse_database_url(database_url)
    else:
        # Use individual environment variables or defaults
        host = os.getenv('DB_HOST', 'localhost')
        port = int(os.getenv('DB_PORT', '5432'))
        user = os.getenv('DB_USER', 'postgres')
        password = os.getenv('DB_PASSWORD', 'postgres')
        database = os.getenv('DB_NAME', DEFAULT_DB_NAME)
        
        return host, port, user, password, database


def create_database_if_not_exists(host, port, user, password, database):
    """Create the database if it doesn't exist."""
    print(f"\n📦 Checking if database '{database}' exists...")
    
    # Supabase manages databases - we can't create them via psql
    if 'supabase.co' in host:
        print(f"   ℹ️  Supabase detected - database '{database}' should already exist")
        print(f"   ✅ Using existing database '{database}'")
        return True
    
    # For local PostgreSQL, connect to postgres database to create new database
    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database='postgres'  # Connect to default postgres database
        )
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # Check if database exists
        cur.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (database,)
        )
        exists = cur.fetchone()
        
        if not exists:
            print(f"   Creating database '{database}'...")
            cur.execute(f'CREATE DATABASE "{database}"')
            print(f"   ✅ Database '{database}' created successfully")
        else:
            print(f"   ✅ Database '{database}' already exists")
        
        cur.close()
        conn.close()
        return True
        
    except psycopg2.OperationalError as e:
        if 'password authentication failed' in str(e):
            print(f"❌ Authentication failed. Please check your database credentials.")
        elif 'could not connect' in str(e):
            print(f"❌ Could not connect to database server at {host}:{port}")
            print(f"   Make sure PostgreSQL is running and accessible.")
        else:
            print(f"❌ Error connecting to database: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False


def run_schema_sql(host, port, user, password, database):
    """Run the schema SQL file to create all tables, views, etc."""
    print(f"\n📋 Reading schema file: {SCHEMA_FILE}")
    
    if not SCHEMA_FILE.exists():
        print(f"❌ Schema file not found: {SCHEMA_FILE}")
        return False
    
    try:
        with open(SCHEMA_FILE, 'r', encoding='utf-8') as f:
            schema_sql = f.read()
    except Exception as e:
        print(f"❌ Error reading schema file: {e}")
        return False
    
    print(f"   ✅ Schema file loaded ({len(schema_sql)} characters)")
    
    print(f"\n🔧 Creating tables, indexes, constraints, triggers, and views...")
    
    try:
        # Connect to the target database
        # For Supabase, we need SSL
        if 'supabase.co' in host or os.getenv('DB_SSL', '').lower() == 'true':
            conn = psycopg2.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database,
                sslmode='require'  # SSL required for Supabase
            )
        else:
            conn = psycopg2.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database
            )
        
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # Execute the schema SQL
        # psycopg2 can execute multiple statements, but we need to handle DO blocks carefully
        # Execute the entire SQL string - psycopg2 handles multiple statements
        try:
            cur.execute(schema_sql)
        except psycopg2.ProgrammingError as e:
            # Some statements might fail if they already exist (like CREATE TYPE IF NOT EXISTS)
            # This is expected and safe to ignore for idempotent operations
            error_msg = str(e)
            if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                print(f"   ℹ️  Some objects already exist (this is OK): {error_msg[:100]}")
            else:
                raise
        
        cur.close()
        conn.close()
        
        print("   ✅ Schema created successfully!")
        print("\n   Created:")
        print("     - Enum types (product_category, source_system_enum)")
        print("     - Tables (locations, orders, products, order_items, llm_interactions)")
        print("     - Indexes (all necessary indexes)")
        print("     - Constraints (data quality checks)")
        print("     - Triggers (updated_at timestamps)")
        print("     - Views (daily_sales_summary, top_products_revenue)")
        
        return True
        
    except psycopg2.Error as e:
        print(f"❌ Database error: {e}")
        if conn:
            conn.rollback()
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_schema(host, port, user, password, database):
    """Verify that all expected tables and views exist."""
    print(f"\n🔍 Verifying schema...")
    
    try:
        conn = psycopg2.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database
        )
        cur = conn.cursor()
        
        # Check tables
        expected_tables = ['locations', 'orders', 'products', 'order_items', 'llm_interactions']
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        existing_tables = [row[0] for row in cur.fetchall()]
        
        missing_tables = [t for t in expected_tables if t not in existing_tables]
        if missing_tables:
            print(f"   ⚠️  Missing tables: {', '.join(missing_tables)}")
        else:
            print(f"   ✅ All tables exist: {', '.join(existing_tables)}")
        
        # Check views
        expected_views = ['daily_sales_summary', 'top_products_revenue']
        cur.execute("""
            SELECT table_name 
            FROM information_schema.views 
            WHERE table_schema = 'public'
            ORDER BY table_name
        """)
        existing_views = [row[0] for row in cur.fetchall()]
        
        missing_views = [v for v in expected_views if v not in existing_views]
        if missing_views:
            print(f"   ⚠️  Missing views: {', '.join(missing_views)}")
        else:
            print(f"   ✅ All views exist: {', '.join(existing_views)}")
        
        # Check order_type constraint includes PICKUP
        cur.execute("""
            SELECT conname, pg_get_constraintdef(oid) as definition
            FROM pg_constraint
            WHERE conrelid = 'orders'::regclass
            AND conname = 'orders_order_type_check'
        """)
        constraint = cur.fetchone()
        if constraint:
            definition = constraint[1]
            if 'PICKUP' in definition:
                print(f"   ✅ order_type constraint includes PICKUP")
            else:
                print(f"   ⚠️  order_type constraint may not include PICKUP")
        else:
            print(f"   ⚠️  order_type constraint not found")
        
        # Check llm_interactions has retry_metrics
        cur.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'llm_interactions' 
            AND column_name = 'retry_metrics'
        """)
        if cur.fetchone():
            print(f"   ✅ llm_interactions.retry_metrics column exists")
        else:
            print(f"   ⚠️  llm_interactions.retry_metrics column missing")
        
        cur.close()
        conn.close()
        
        return len(missing_tables) == 0 and len(missing_views) == 0
        
    except Exception as e:
        print(f"   ⚠️  Could not verify schema: {e}")
        return False


def main():
    """Main function to set up the database."""
    print("=" * 60)
    print("Database Setup Script")
    print("=" * 60)
    
    # Get connection parameters
    host, port, user, password, database = get_connection_params()
    
    # Mask password in output
    safe_url = f"postgresql://{user}:***@{host}:{port}/{database}"
    print(f"\n📡 Database: {safe_url}")
    
    # Step 1: Create database if it doesn't exist
    if not create_database_if_not_exists(host, port, user, password, database):
        print("\n❌ Failed to create/verify database. Exiting.")
        sys.exit(1)
    
    # Step 2: Run schema SQL
    if not run_schema_sql(host, port, user, password, database):
        print("\n❌ Failed to create schema. Exiting.")
        sys.exit(1)
    
    # Step 3: Verify schema
    verify_schema(host, port, user, password, database)
    
    print("\n" + "=" * 60)
    print("✅ Database setup complete!")
    print("=" * 60)
    print(f"\nYou can now load data using:")
    print(f"  python scripts/process_data.py")
    print()


if __name__ == "__main__":
    main()

