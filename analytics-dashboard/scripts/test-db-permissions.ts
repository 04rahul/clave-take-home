#!/usr/bin/env node
/**
 * Test script to verify database permissions for app_user role
 * 
 * This script tests that:
 * 1. SELECT queries work on all tables
 * 2. INSERT/UPDATE/DELETE fail on main tables (read-only)
 * 3. INSERT/UPDATE/DELETE work on llm_interactions (full access)
 * 
 * Usage:
 *   npm run test:db-permissions
 *   or
 *   tsx scripts/test-db-permissions.ts
 */

import { Pool } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

// Load environment variables from .env file
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env')
  const envLocalPath = path.join(__dirname, '..', '.env.local')
  
  // Try .env.local first (Next.js convention), then .env
  let filePath: string | null = null
  if (fs.existsSync(envLocalPath)) {
    filePath = envLocalPath
  } else if (fs.existsSync(envPath)) {
    filePath = envPath
  }
  
  if (filePath) {
    const envContent = fs.readFileSync(filePath, 'utf-8')
    const lines = envContent.split('\n')
    
    for (const line of lines) {
      const trimmedLine = line.trim()
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) continue
      
      const equalIndex = trimmedLine.indexOf('=')
      if (equalIndex === -1) continue
      
      const key = trimmedLine.substring(0, equalIndex).trim()
      let value = trimmedLine.substring(equalIndex + 1).trim()
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      
      // Only set if not already in process.env (environment takes precedence)
      if (!process.env[key]) {
        process.env[key] = value
      }
    }
  }
}

// Load .env file
loadEnvFile()

const APP_DATABASE_URL = process.env.APP_DATABASE_URL

if (!APP_DATABASE_URL) {
  console.error('❌ APP_DATABASE_URL environment variable is not set')
  console.error('   Please set it in your .env file')
  console.error('   Example: APP_DATABASE_URL=postgresql://app_user:Pass%40Clave@...')
  process.exit(1)
}

// Create connection pool
const pool = new Pool({
  connectionString: APP_DATABASE_URL,
  ssl: APP_DATABASE_URL.includes('supabase.co') 
    ? { rejectUnauthorized: false }
    : false,
})

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

async function runTest(name: string, query: string, shouldSucceed: boolean): Promise<void> {
  try {
    await pool.query(query)
    if (shouldSucceed) {
      results.push({ name, passed: true })
      console.log(`✅ ${name}`)
    } else {
      results.push({ name, passed: false, error: 'Query succeeded but should have failed' })
      console.log(`❌ ${name} - Query succeeded but should have failed`)
    }
  } catch (error: any) {
    if (!shouldSucceed) {
      // Check if error is permission denied
      if (error.message?.includes('permission denied') || error.message?.includes('permission')) {
        results.push({ name, passed: true })
        console.log(`✅ ${name} - Correctly blocked (permission denied)`)
      } else {
        results.push({ name, passed: false, error: error.message })
        console.log(`❌ ${name} - Failed with unexpected error: ${error.message}`)
      }
    } else {
      results.push({ name, passed: false, error: error.message })
      console.log(`❌ ${name} - Failed: ${error.message}`)
    }
  }
}

async function main() {
  console.log('🧪 Testing Database Permissions for app_user role\n')
  console.log('=' .repeat(60))
  
  // Test 1: SELECT queries (should work)
  console.log('\n📖 Testing SELECT queries (should work):\n')
  await runTest(
    'SELECT from locations',
    'SELECT COUNT(*) FROM locations',
    true
  )
  
  await runTest(
    'SELECT from orders',
    'SELECT COUNT(*) FROM orders LIMIT 1',
    true
  )
  
  await runTest(
    'SELECT from products',
    'SELECT COUNT(*) FROM products LIMIT 1',
    true
  )
  
  await runTest(
    'SELECT from order_items',
    'SELECT COUNT(*) FROM order_items LIMIT 1',
    true
  )
  
  await runTest(
    'SELECT from daily_sales_summary view',
    'SELECT COUNT(*) FROM daily_sales_summary LIMIT 1',
    true
  )
  
  await runTest(
    'SELECT from llm_interactions',
    'SELECT COUNT(*) FROM llm_interactions LIMIT 1',
    true
  )

  // Test 2: INSERT on main tables (should fail)
  console.log('\n🚫 Testing INSERT on main tables (should fail):\n')
  await runTest(
    'INSERT into locations',
    `INSERT INTO locations (canonical_name) VALUES ('Test Location')`,
    false
  )
  
  await runTest(
    'INSERT into orders',
    `INSERT INTO orders (order_id, source_system, location_id, timestamp_utc, business_date, order_type, total_amount_cents, subtotal_amount_cents, tax_amount_cents, tip_amount_cents, net_revenue_cents) 
     SELECT 'TEST_123', 'Toast', id, NOW(), CURRENT_DATE, 'DINE_IN', 1000, 900, 50, 50, 900 FROM locations LIMIT 1`,
    false
  )
  
  await runTest(
    'INSERT into products',
    `INSERT INTO products (canonical_name, category) VALUES ('Test Product', 'burgers')`,
    false
  )
  
  await runTest(
    'INSERT into order_items',
    `INSERT INTO order_items (order_id, item_name, canonical_name, category, quantity, unit_price_cents, total_price_cents) 
     SELECT id, 'Test Item', 'Test Item', 'burgers', 1, 1000, 1000 FROM orders LIMIT 1`,
    false
  )

  // Test 3: UPDATE on main tables (should fail)
  console.log('\n🚫 Testing UPDATE on main tables (should fail):\n')
  await runTest(
    'UPDATE locations',
    `UPDATE locations SET canonical_name = 'Updated Name' WHERE canonical_name = 'Test Location'`,
    false
  )
  
  await runTest(
    'UPDATE orders',
    `UPDATE orders SET total_amount_cents = 2000 WHERE order_id = 'TEST_123'`,
    false
  )

  // Test 4: DELETE on main tables (should fail)
  console.log('\n🚫 Testing DELETE on main tables (should fail):\n')
  await runTest(
    'DELETE from locations',
    `DELETE FROM locations WHERE canonical_name = 'Test Location'`,
    false
  )
  
  await runTest(
    'DELETE from orders',
    `DELETE FROM orders WHERE order_id = 'TEST_123'`,
    false
  )

  // Test 5: INSERT/UPDATE/DELETE on llm_interactions (should work)
  console.log('\n✅ Testing INSERT/UPDATE/DELETE on llm_interactions (should work):\n')
  
  let testId: string | null = null
  
  // Insert
  try {
    const insertResult = await pool.query(
      `INSERT INTO llm_interactions (user_prompt, success_status, agent_answered) 
       VALUES ('Test prompt from permission test', true, true) 
       RETURNING id`
    )
    testId = insertResult.rows[0].id
    results.push({ name: 'INSERT into llm_interactions', passed: true })
    console.log(`✅ INSERT into llm_interactions (created test record with id: ${testId})`)
  } catch (error: any) {
    results.push({ name: 'INSERT into llm_interactions', passed: false, error: error.message })
    console.log(`❌ INSERT into llm_interactions - Failed: ${error.message}`)
  }
  
  // Update (only if insert succeeded)
  if (testId) {
    try {
      await pool.query(
        `UPDATE llm_interactions SET user_prompt = 'Updated test prompt' WHERE id = $1`,
        [testId]
      )
      results.push({ name: 'UPDATE llm_interactions', passed: true })
      console.log(`✅ UPDATE llm_interactions`)
    } catch (error: any) {
      results.push({ name: 'UPDATE llm_interactions', passed: false, error: error.message })
      console.log(`❌ UPDATE llm_interactions - Failed: ${error.message}`)
    }
    
    // Delete
    try {
      await pool.query(
        `DELETE FROM llm_interactions WHERE id = $1`,
        [testId]
      )
      results.push({ name: 'DELETE from llm_interactions', passed: true })
      console.log(`✅ DELETE from llm_interactions`)
    } catch (error: any) {
      results.push({ name: 'DELETE from llm_interactions', passed: false, error: error.message })
      console.log(`❌ DELETE from llm_interactions - Failed: ${error.message}`)
    }
    
    // Clean up - try to delete again (should be safe even if already deleted)
    try {
      await pool.query(`DELETE FROM llm_interactions WHERE id = $1`, [testId])
    } catch {
      // Ignore - record might already be deleted
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 Test Summary:\n')
  
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  const total = results.length
  
  console.log(`Total tests: ${total}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  
  if (failed > 0) {
    console.log('\n❌ Failed tests:')
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error || 'Unknown error'}`)
    })
  }
  
  console.log('\n' + '='.repeat(60))
  
  // Close connection
  await pool.end()
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(error => {
  console.error('❌ Fatal error:', error)
  process.exit(1)
})

