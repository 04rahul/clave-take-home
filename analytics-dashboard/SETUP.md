# Setup Instructions

## Environment Variables

Create a `.env.local` file in the `analytics-dashboard` directory with the following variables:

```env
# OpenAI Configuration
OPENAI_MYAPI_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-4o

# PostgreSQL Connection (Local or Remote)
# For local PostgreSQL:
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/clave_assessment

# For remote PostgreSQL (Supabase):
# DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
# OR use POSTGRES_URL instead of DATABASE_URL

# Supabase Configuration (Optional - if you want to use Supabase client for other features)
# NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
# NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key-here
```

## Local PostgreSQL Setup

### Connection String Format

For local PostgreSQL, use this format:
```
postgresql://username:password@localhost:5432/database_name
```

Example for database `clave_assessment`:
```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/clave_assessment
```

**Note:** Replace `yourpassword` with your actual PostgreSQL password. If your PostgreSQL user is different from `postgres`, replace that as well.

### Remote PostgreSQL (Supabase)

If using Supabase instead of local PostgreSQL:

#### For Local Development:
1. Go to your Supabase project dashboard
2. Navigate to **Settings** > **Database**
3. Scroll down to **Connection string** section
4. Select **URI** format
5. Copy the connection string (it should look like: `postgresql://postgres:[YOUR-PASSWORD]@db.xxx.supabase.co:5432/postgres`)
6. Replace `[YOUR-PASSWORD]` with your actual database password
7. Set it as `APP_DATABASE_URL` or `DATABASE_URL` in your `.env.local` file

#### For Vercel/Production (IPv4 Required):
**Important:** Vercel uses IPv4, but Supabase's direct connection uses IPv6. You **must** use Supabase's Connection Pooler for Vercel deployments.

1. Go to your Supabase project dashboard
2. Navigate to **Settings** > **Database**
3. Scroll down to **Connection Pooling** section
4. Select **Transaction mode** (recommended for serverless) - uses port `6543`
5. Copy the connection string template from the **Connection string** section
6. The connection string format will be:
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
   ```
7. **For app_user (Next.js application):** Replace `postgres.[PROJECT-REF]` with `app_user.[PROJECT-REF]`
   - Example: `postgresql://app_user.ksllvwzuohgiwprqnvqd:[PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres`
8. **Important:** URL-encode special characters in your password:
   - `@` becomes `%40`
   - `#` becomes `%23`
   - etc.
   - Example: If password is `Pass@Clave`, use `Pass%40Clave`
9. Set it as `APP_DATABASE_URL` in your Vercel environment variables

**Example with app_user and URL-encoded password:**
```
postgresql://app_user.ksllvwzuohgiwprqnvqd:Pass%40Clave@aws-1-us-east-1.pooler.supabase.com:6543/postgres
```

The code automatically detects remote connections (Supabase direct, pooler, or AWS) and uses SSL, while local connections don't require SSL.

## How It Works

This implementation uses **Standard PostgreSQL Connection**:

- Uses the standard `pg` (node-postgres) library for direct PostgreSQL access
- Works with both local PostgreSQL and remote PostgreSQL (Supabase, AWS RDS, etc.)
- Automatically detects remote connections and enables SSL when needed
- Local PostgreSQL connections don't require SSL
- No need for a custom PostgreSQL function - queries are executed directly via `pg`
- Better for dynamic SQL execution as we have full control

## Security Note

The SQL validation guardrails are still in place:
- Only SELECT queries are allowed (enforced by SQL validator)
- Table/view whitelist validation
- SQL injection prevention
- Result size limits (max 1000 rows)

## Running the Application

```bash
# Install dependencies (if not already done)
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Database Setup

The database schema is automatically created when you run the data processing script. However, you can also set it up manually:

### Option 1: Automatic Setup (Recommended)

The schema is created automatically when you run:
```bash
python scripts/process_data.py
```

### Option 2: Manual Setup

#### For Local PostgreSQL:

```bash
# Option A: Use the Python setup script
python scripts/setup_database.py

# Option B: Use SQL directly
psql -U postgres -d clave_assessment -f scripts/create_database_schema.sql
```

#### For Remote PostgreSQL (Supabase):

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the schema file: `scripts/create_database_schema.sql`
4. Copy and paste the contents into the SQL Editor
5. Run the query

**Note:** The schema file includes everything: tables, indexes, views, constraints, triggers, and the `app_user` role with permissions.

