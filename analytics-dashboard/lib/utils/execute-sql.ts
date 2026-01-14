import { Pool, QueryResult } from 'pg'

export interface SQLResult {
  [key: string]: any
}

// Create a connection pool (singleton pattern)
let pool: Pool | null = null

/**
 * Get or create PostgreSQL connection pool
 * Uses Supabase connection string for direct PostgreSQL access
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL

    if (!connectionString) {
      throw new Error(
        'Missing DATABASE_URL or POSTGRES_URL environment variable. ' +
        'Get your connection string from Supabase settings (Settings > Database > Connection string > URI). ' +
        'Format: postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres'
      )
    }

    pool = new Pool({
      connectionString,
      // Connection pool settings
      max: 5, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // SSL is required for Supabase connections
      ssl: {
        rejectUnauthorized: false, // Supabase uses SSL but may not have proper certificates
      },
    })

    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle PostgreSQL client', err)
    })
  }

  return pool
}

/**
 * Execute a raw SQL query using pg (node-postgres) library.
 * 
 * This uses the standard PostgreSQL connection (Option B - Professional approach).
 * Supabase is just a Postgres database, so we connect directly using the connection string.
 * 
 * Reference: https://node-postgres.com/
 * 
 * Environment variable required:
 * - DATABASE_URL or POSTGRES_URL: PostgreSQL connection string from Supabase
 *   Format: postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
 * 
 * Get it from: Supabase Dashboard > Settings > Database > Connection string > URI
 */
export async function executeSQLQuery(sql: string): Promise<SQLResult[]> {
  const client = getPool()
  
  try {
    // Ensure LIMIT clause exists (add if missing)
    const upperSQL = sql.trim().toUpperCase()
    const hasLimit = /LIMIT\s+\d+/.test(upperSQL)
    
    let finalSQL = sql.trim()
    if (!hasLimit) {
      // Remove trailing semicolon if present before adding LIMIT
      finalSQL = finalSQL.replace(/;\s*$/, '')
      // Add LIMIT 1000 if not present
      finalSQL = `${finalSQL} LIMIT 1000`
    } else {
      // Ensure LIMIT is reasonable (max 1000)
      const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
      if (limitMatch) {
        const limitValue = parseInt(limitMatch[1], 10)
        if (limitValue > 1000) {
          finalSQL = sql.replace(/LIMIT\s+\d+/i, 'LIMIT 1000')
        }
      }
    }

    // Execute the query using pg
    const result: QueryResult = await client.query(finalSQL)
    
    // Convert rows to array of objects
    const rows = result.rows || []
    
    // Ensure we return an array
    if (!Array.isArray(rows)) {
      return rows && typeof rows === 'object' ? [rows] : []
    }
    
    return rows
  } catch (error) {
    console.error('Error executing SQL query:', error)
    
    // Provide user-friendly error messages
    if (error instanceof Error) {
      // Handle common PostgreSQL errors
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        throw new Error(`Table or view not found. ${error.message}`)
      }
      if (error.message.includes('syntax error')) {
        throw new Error(`SQL syntax error: ${error.message}`)
      }
      if (error.message.includes('permission denied')) {
        throw new Error(`Permission denied: ${error.message}`)
      }
      throw new Error(`Failed to execute SQL query: ${error.message}`)
    }
    
    throw new Error(`Failed to execute SQL query: Unknown error`)
  }
}

/**
 * Close the connection pool (useful for cleanup)
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

