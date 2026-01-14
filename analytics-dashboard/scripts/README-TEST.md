# Database Permissions Test Script

This script tests that the `app_user` role has the correct database permissions.

## What It Tests

1. ✅ SELECT queries work on all tables (locations, orders, products, order_items, views)
2. 🚫 INSERT/UPDATE/DELETE fail on main tables (read-only access)
3. ✅ INSERT/UPDATE/DELETE work on llm_interactions (full access)

## Prerequisites

Make sure you have:
1. Created the `app_user` role in your database (see migration `007_create_app_user_role.sql`)
2. Set `APP_DATABASE_URL` in your `.env.local` file

## Running the Test

### Option 1: Using npm script (recommended)

```bash
cd analytics-dashboard
npm run test:db-permissions
```

### Option 2: Using npx tsx directly

```bash
cd analytics-dashboard
npx tsx scripts/test-db-permissions.ts
```

### Option 3: Using Node.js directly (if you compile first)

```bash
cd analytics-dashboard
npx tsc scripts/test-db-permissions.ts --outDir dist --module commonjs --esModuleInterop
node dist/scripts/test-db-permissions.js
```

## Expected Output

You should see:
- ✅ All SELECT queries pass
- ✅ All INSERT/UPDATE/DELETE on main tables are blocked (permission denied)
- ✅ All INSERT/UPDATE/DELETE on llm_interactions pass

## Troubleshooting

If you get "APP_DATABASE_URL environment variable is not set":
1. Make sure you're in the `analytics-dashboard` directory
2. Check that `.env.local` exists and contains `APP_DATABASE_URL`
3. If using npx directly, you may need to load the env file:
   ```bash
   npx dotenv-cli -e .env.local -- npx tsx scripts/test-db-permissions.ts
   ```

If you get permission errors for SELECT queries:
- Verify the migration `007_create_app_user_role.sql` was run successfully
- Check that GRANT statements were executed

