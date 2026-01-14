import { Parser } from 'node-sql-parser'
import type { SQLValidationResult } from '@/lib/types'
import sqlGenerationPrompt from '@/prompts/sql-generation.json'

// Get allowed tables/views from schema (single source of truth)
const schema = sqlGenerationPrompt.schema
const ALLOWED_TABLES = Object.keys(schema.tables)
const ALLOWED_VIEWS = Object.keys(schema.views)
const ALLOWED_OBJECTS = [...ALLOWED_TABLES, ...ALLOWED_VIEWS]

// Dangerous functions (can appear in SELECT statements, so we need to check)
const DANGEROUS_FUNCTIONS = [
  'pg_read_file', 'pg_write_file', 'pg_ls_dir', 'COPY FROM', 'COPY TO',
  'pg_execute', 'lo_import', 'lo_export', 'pg_send_query',
]

const SQL_INJECTION_PATTERNS = [
  /(;\s*(DROP|DELETE|INSERT|UPDATE|TRUNCATE|CREATE|ALTER))/i,
  /(UNION.*SELECT)/i,
  /(OR\s+1\s*=\s*1)/i,
  /(--|#|\/\*|\*\/)/,
  /(xp_cmdshell|sp_executesql)/i,
  /(INTO\s+(OUTFILE|DUMPFILE))/i,
]

// Initialize SQL parser for PostgreSQL
const parser = new Parser()
const opt = {
  database: 'PostgreSQL',
}

/**
 * Extract table/view names from tableList
 */
function extractTableNames(tableList: string[]): string[] {
  // tableList format: ["select::null::table_name", "select::null::other_table"]
  const tableNames = tableList
    .map(tableRef => {
      const parts = tableRef.split('::')
      return parts[parts.length - 1].toLowerCase() // Get last part (table name)
    })
    .filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
  return tableNames
}

/**
 * Extract column names from columnList
 */
function extractColumnNames(columnList: string[]): string[] {
  // columnList format: ["select::table_name::column_name", "select::table_name::other_column"]
  const columnNames = columnList
    .map(columnRef => {
      const parts = columnRef.split('::')
      return parts[parts.length - 1].toLowerCase() // Get last part (column name)
    })
    .filter((name, index, self) => self.indexOf(name) === index) // Remove duplicates
  return columnNames
}

/**
 * Extract CTE names from AST (Common Table Expressions from WITH clauses)
 */
function extractCTENames(ast: any): string[] {
  const cteNames: string[] = []
  
  if (!ast) return cteNames
  
  // Check if AST has 'with' property (CTEs)
  if (ast.with) {
    const withClause = Array.isArray(ast.with) ? ast.with : [ast.with]
    for (const cte of withClause) {
      if (cte.name) {
        cteNames.push(cte.name.toLowerCase())
      }
      // Recursively check nested CTEs
      if (cte.stmt && cte.stmt.with) {
        cteNames.push(...extractCTENames(cte.stmt))
      }
    }
  }
  
  // Also check nested SELECTs for CTEs
  for (const key in ast) {
    if (ast[key] && typeof ast[key] === 'object') {
      if (Array.isArray(ast[key])) {
        for (const item of ast[key]) {
          cteNames.push(...extractCTENames(item))
        }
      } else {
        cteNames.push(...extractCTENames(ast[key]))
      }
    }
  }
  
  return [...new Set(cteNames)] // Remove duplicates
}

export async function validateSQLQuery(sql: string): Promise<SQLValidationResult> {
  // Trust the parser - use parse() to get AST, tableList, and columnList
  const parseResult = parser.parse(sql, opt) as { ast: any; tableList: string[]; columnList: string[] }
  const { ast: rawAst, tableList, columnList } = parseResult

  let ast: any = rawAst

  // 1. Handle array of statements (should be single statement)
  if (Array.isArray(ast)) {
    if (ast.length > 1) {
      return {
        valid: false,
        reason: 'Multiple SQL statements are not allowed.',
        code: 'NOT_READ_ONLY',
      }
    }
    ast = ast[0]
  }

  // 2. Check query type - must be SELECT (WITH clauses are still SELECT queries)
  // This automatically catches INSERT, UPDATE, DELETE, DROP, etc. (ast.type would be 'insert', 'update', etc.)
  if (ast.type !== 'select') {
    return {
      valid: false,
      reason: `Only SELECT queries are allowed (read-only). Found: ${ast.type}`,
      code: 'NOT_READ_ONLY',
    }
  }

  // 3. Extract CTE names (Common Table Expressions) - these are NOT tables/views
  const cteNames = extractCTENames(ast)

  // 4. Extract and validate table/view names from tableList (excluding CTEs)
  const tableNames = extractTableNames(tableList)
  
  // Filter out CTE names from table names (CTEs are temporary, not actual tables)
  const actualTableNames = tableNames.filter(name => !cteNames.includes(name))
  
  for (const tableName of actualTableNames) {
    if (!ALLOWED_OBJECTS.includes(tableName)) {
      return {
        valid: false,
        reason: `Query references unauthorized table/view: ${tableName}. Allowed: ${ALLOWED_OBJECTS.join(', ')}`,
        code: 'INVALID_TABLE',
      }
    }
  }

  // 4. Extract column names (for logging/debugging - optional for future validation)
  const columnNames = extractColumnNames(columnList)
  // You can add column validation here if needed in the future

  // 5. Check for dangerous functions (these can appear in SELECT statements)
  const sqlLower = sql.toLowerCase()
  for (const func of DANGEROUS_FUNCTIONS) {
    if (sqlLower.includes(func.toLowerCase())) {
      return {
        valid: false,
        reason: `Query contains forbidden function: ${func}`,
        code: 'DANGEROUS_FUNCTION',
      }
    }
  }

  // 6. SQL injection pattern detection
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(sql)) {
      return {
        valid: false,
        reason: 'Query contains SQL injection patterns.',
        code: 'SQL_INJECTION_PATTERN',
      }
    }
  }

  // 7. Check LIMIT clause from AST
  function findLimit(node: any): number | null {
    if (!node) return null
    
    if (node.limit) {
      if (node.limit.value !== undefined) {
        const limitValue = typeof node.limit.value === 'number'
          ? node.limit.value
          : parseInt(String(node.limit.value), 10)
        if (!isNaN(limitValue)) {
          return limitValue
        }
      }
      if (node.limit.separation) {
        const limitValue = parseInt(String(node.limit.separation), 10)
        if (!isNaN(limitValue)) {
          return limitValue
        }
      }
    }

    // Traverse children recursively
    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        const result = Array.isArray(node[key])
          ? node[key].map(findLimit).find((v: any) => v !== null && v !== undefined && !isNaN(v))
          : findLimit(node[key])
        if (result !== null && result !== undefined && typeof result === 'number' && !isNaN(result)) return result
      }
    }
    return null
  }

  const limitValue = findLimit(ast)
  if (limitValue !== null) {
    if (limitValue > 1000) {
      return {
        valid: false,
        reason: `LIMIT value (${limitValue}) exceeds maximum allowed (1000)`,
        code: 'TOO_COMPLEX',
      }
    }
  }

  // 8. Complexity limits - count JOINs from AST
  function countJoins(node: any): number {
    if (!node) return 0
    
    let count = 0
    
    // Count join clauses
    if (node.join) {
      count += Array.isArray(node.join) ? node.join.length : 1
    }

    // Traverse children
    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          count += node[key].reduce((sum: number, n: any) => sum + countJoins(n), 0)
        } else {
          count += countJoins(node[key])
        }
      }
    }
    return count
  }

  const joinCount = countJoins(ast)
  if (joinCount > 5) {
    return {
      valid: false,
      reason: `Query has too many JOINs (${joinCount}). Maximum allowed: 5`,
      code: 'TOO_COMPLEX',
    }
  }

  // 9. Count subqueries from AST
  function countSubqueries(node: any, isRoot: boolean = true): number {
    if (!node) return 0
    
    let count = 0
    
    // Count SELECT statements (subqueries are nested SELECTs)
    if (node.type === 'select' && !isRoot) {
      count++
    }

    // Traverse children
    for (const key in node) {
      if (node[key] && typeof node[key] === 'object') {
        if (Array.isArray(node[key])) {
          count += node[key].reduce((sum: number, n: any) => sum + countSubqueries(n, false), 0)
        } else {
          count += countSubqueries(node[key], false)
        }
      }
    }
    return count
  }

  const subqueryCount = countSubqueries(ast, true)
  if (subqueryCount > 3) {
    return {
      valid: false,
      reason: `Query has too many subqueries (${subqueryCount}). Maximum allowed: 3`,
      code: 'TOO_COMPLEX',
    }
  }

  return { valid: true, code: 'PASSED' }
}
