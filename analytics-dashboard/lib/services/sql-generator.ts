import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import sqlGenerationPrompt from '@/prompts/sql-generation.json'

// Define the schema for structured output
const QueryGenerationSchema = z.object({
  sqlQuery: z.string().min(1, "SQL query cannot be empty").describe("A valid PostgreSQL query to fetch data from Supabase. Must only SELECT from allowed tables. Should include LIMIT clause if appropriate."),
  chartType: z.enum(["bar", "line", "area", "pie", "table", "combo", "grouped_bar"]).describe("The appropriate chart type for visualizing this data. Use 'bar' for comparisons, 'line' for trends over time, 'area' for volume trends, 'pie' for proportions, 'table' for simple lists or informational data, 'combo' for dual-metric charts with different scales (bar + line with dual Y-axis), 'grouped_bar' for comparing two metrics side-by-side with similar scales."),
  title: z.string().min(1, "Title cannot be empty").describe("A concise, descriptive title for the chart (e.g., 'Sales by Location', 'Daily Revenue Trend')"),
  description: z.string().min(1, "Description cannot be empty").describe("A brief description of what the chart shows (e.g., 'Total revenue aggregated by restaurant location')"),
  xAxisLabel: z.string().min(1, "X-axis label cannot be empty").describe("User-friendly label for the X-axis (e.g., 'Location', 'Date', 'Product Name')"),
  yAxisLabel: z.string().min(1, "Y-axis label cannot be empty").describe("User-friendly label for the Y-axis (e.g., 'Revenue ($)', 'Order Count', 'Quantity Sold')"),
  dataMapping: z.object({
    categoryKey: z.string().min(1, "Category key cannot be empty").describe("Column name from SQL result to use as category/label (e.g., 'location_name', 'product_name', 'business_date')"),
    valueKey: z.string().min(1, "Value key cannot be empty").describe("Column name from SQL result to use as primary value (e.g., 'total_revenue', 'order_count', 'quantity_sold')"),
    secondaryValueKey: z.string().nullable().describe("Column name from SQL result to use as secondary value for dual-metric charts (e.g., 'order_count' when primary is 'total_revenue'). Required when chartType is 'combo' or 'grouped_bar', null otherwise."),
  }).describe("How to map SQL result columns to chart data structure. Include secondaryValueKey for dual-metric charts."),
})

export type QueryGenerationResult = z.infer<typeof QueryGenerationSchema>

// Initialize OpenAI client
let openaiClient: OpenAI | null = null

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_MYAPI_KEY
    if (!apiKey) {
      throw new Error('OPENAI_MYAPI_KEY environment variable is required')
    }
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

// Build system instructions from prompt JSON
function buildSystemInstructions(): string {
  const { schema, guidelines, examples, importantRules } = sqlGenerationPrompt as any

  const tablesInfo = Object.entries(schema.tables)
    .map(([name, info]: [string, any]) => {
      const columns = Array.isArray(info.columns) ? info.columns.join(', ') : info.columns
      return `${name}: ${info.description || 'No description'}\n  Columns: ${columns}`
    })
    .join('\n\n')

  const viewsInfo = Object.entries(schema.views)
    .map(([name, info]: [string, any]) => {
      const columns = Array.isArray(info.columns) ? info.columns.join(', ') : info.columns
      return `${name}: ${info.description || 'No description'}\n  Columns: ${columns}`
    })
    .join('\n\n')

  const constraintsInfo = `
Valid locations: ${(schema.constraints.locations || []).join(', ')}
Date range: ${schema.constraints.dateRange.start} to ${schema.constraints.dateRange.end}
Order types: ${(schema.constraints.orderTypes || []).join(', ')}
Source systems: ${(schema.constraints.sourceSystems || []).join(', ')}
Product categories: ${(schema.constraints.productCategories || []).join(', ') || 'N/A'}
`

  const guidelinesText = Array.isArray(guidelines) ? guidelines.join('\n- ') : guidelines

  const examplesText = Array.isArray(examples)
    ? examples.map((ex: any) => `Query: "${ex.query}"\nSQL: ${ex.sql}`).join('\n\n')
    : ''

  const importantRulesText = Array.isArray(importantRules)
    ? importantRules.map((rule: string, index: number) => `${index + 1}. ${rule}`).join('\n')
    : ''

  return `You are a SQL query generator for a restaurant analytics dashboard.

DATABASE SCHEMA:

Tables:
${tablesInfo}

Views (prefer these when possible - they're pre-aggregated):
${viewsInfo}

CONSTRAINTS:
${constraintsInfo}

GUIDELINES:
- ${guidelinesText}

EXAMPLES:
${examplesText}

IMPORTANT RULES:
${importantRulesText}

Generate a SQL query and chart metadata based on the user's natural language query. The SQL query MUST return columns that match the categoryKey, valueKey, and (if applicable) secondaryValueKey specified in dataMapping.`
}

/**
 * Generate SQL query and chart metadata using OpenAI's structured output API
 * This is simpler and more efficient than using Agents SDK with tools
 */
export async function generateSQLQuery(userQuery: string): Promise<QueryGenerationResult> {
  const client = getOpenAIClient()
  const model = 'gpt-5.2' // Using gpt-5.2 for SQL generation

  let response: any
  try {
    response = await client.responses.parse({
      model: model as any,
      input: [
        { role: 'system', content: buildSystemInstructions() },
        { role: 'user', content: userQuery },
      ],
      text: {
        format: zodTextFormat(QueryGenerationSchema, 'query_generation'),
      },
    })
  } catch (error) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ ERROR: Failed to parse LLM response with schema')
    console.error('='.repeat(80))
    console.error(`📝 User Query: "${userQuery}"`)
    console.error(`❌ Error:`, error)
    if (error && typeof error === 'object' && 'message' in error) {
      console.error(`❌ Error Message: ${error.message}`)
    }
    // Log raw response if available
    if (response && 'output_raw' in response) {
      console.error(`📄 Raw output:`, response.output_raw)
    }
    console.error('='.repeat(80) + '\n')
    throw new Error(`Failed to generate SQL query: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  // Debug: Log raw response structure
  if (response && 'output_raw' in response) {
    console.log('\n' + '='.repeat(80))
    console.log('🔍 DEBUG: Raw LLM Response')
    console.log('='.repeat(80))
    console.log(`📄 Raw output:`, response.output_raw)
    console.log('='.repeat(80) + '\n')
  }

  const parsed = response.output_parsed as QueryGenerationResult

  // Debug: Log what we got from parsing
  console.log('\n' + '='.repeat(80))
  console.log('🔍 DEBUG: Parsed Response Structure')
  console.log('='.repeat(80))
  console.log(`📦 Parsed keys:`, Object.keys(parsed))
  console.log(`📦 Has xAxisLabel:`, 'xAxisLabel' in parsed, parsed.xAxisLabel)
  console.log(`📦 Has yAxisLabel:`, 'yAxisLabel' in parsed, parsed.yAxisLabel)
  console.log('='.repeat(80) + '\n')

  // Explicitly validate the parsed response against the schema
  const validationResult = QueryGenerationSchema.safeParse(parsed)
  if (!validationResult.success) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ ERROR: Parsed response does not match schema!')
    console.error('='.repeat(80))
    console.error(`📝 User Query: "${userQuery}"`)
    console.error(`❌ Validation errors:`, JSON.stringify(validationResult.error.errors, null, 2))
    console.error(`📦 Parsed response:`, JSON.stringify(parsed, null, 2))
    console.error('='.repeat(80) + '\n')
    throw new Error(`Schema validation failed: ${validationResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
  }
  
  // Use the validated data
  const validatedParsed = validationResult.data

  // Validate that axis labels are present (using validated data)
  if (!validatedParsed.xAxisLabel || typeof validatedParsed.xAxisLabel !== 'string' || validatedParsed.xAxisLabel.trim().length === 0) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ ERROR: X-axis label is missing or empty!')
    console.error('='.repeat(80))
    console.error(`📝 User Query: "${userQuery}"`)
    console.error(`📦 Full Parsed Response:`, JSON.stringify(validatedParsed, null, 2))
    console.error('='.repeat(80) + '\n')
    throw new Error('X-axis label is missing from LLM response. The LLM must generate a user-friendly xAxisLabel.')
  }

  if (!validatedParsed.yAxisLabel || typeof validatedParsed.yAxisLabel !== 'string' || validatedParsed.yAxisLabel.trim().length === 0) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ ERROR: Y-axis label is missing or empty!')
    console.error('='.repeat(80))
    console.error(`📝 User Query: "${userQuery}"`)
    console.error(`📦 Full Parsed Response:`, JSON.stringify(validatedParsed, null, 2))
    console.error('='.repeat(80) + '\n')
    throw new Error('Y-axis label is missing from LLM response. The LLM must generate a user-friendly yAxisLabel.')
  }

  // Validate that SQL query is not empty
  if (!validatedParsed.sqlQuery || typeof validatedParsed.sqlQuery !== 'string' || validatedParsed.sqlQuery.trim().length === 0) {
    console.error('\n' + '='.repeat(80))
    console.error('❌ ERROR: SQL Query is empty or missing!')
    console.error('='.repeat(80))
    console.error(`📝 User Query: "${userQuery}"`)
    console.error(`🗄️  SQL Query value: "${validatedParsed.sqlQuery}" (type: ${typeof validatedParsed.sqlQuery})`)
    console.error(`🗄️  SQL Query length: ${validatedParsed.sqlQuery?.length || 0}`)
    console.error(`📦 Full Parsed Response:`, JSON.stringify(validatedParsed, null, 2))
    console.error(`🔍 Response structure keys:`, Object.keys(response))
    if ('output_raw' in response) {
      console.error(`📄 Raw output:`, response.output_raw)
    }
    console.error('='.repeat(80) + '\n')
    throw new Error('Generated SQL query is empty. The LLM did not produce a valid SQL query.')
  }

  // Validate that SQL query includes the categoryKey in SELECT clause
  const sqlUpper = validatedParsed.sqlQuery.toUpperCase()
  const selectMatch = sqlUpper.match(/SELECT\s+(.*?)\s+FROM/i)
  if (selectMatch && validatedParsed.dataMapping.categoryKey) {
    const selectClause = selectMatch[1]
    const categoryKeyUpper = validatedParsed.dataMapping.categoryKey.toUpperCase()
    // Check if categoryKey appears in SELECT clause (handle AS aliases)
    const categoryKeyPattern = new RegExp(`\\b${categoryKeyUpper}\\b`, 'i')
    
    if (!categoryKeyPattern.test(selectClause)) {
      console.error('\n' + '='.repeat(80))
      console.error('❌ ERROR: SQL Query does not SELECT the categoryKey!')
      console.error('='.repeat(80))
      console.error(`📝 User Query: "${userQuery}"`)
      console.error(`🗄️  SQL Query: ${validatedParsed.sqlQuery}`)
      console.error(`📊 Expected categoryKey in SELECT: "${validatedParsed.dataMapping.categoryKey}"`)
      console.error(`📊 SELECT clause: ${selectClause}`)
      console.error(`📦 Full Parsed Response:`, JSON.stringify(validatedParsed, null, 2))
      console.error('='.repeat(80) + '\n')
      
      // Try to auto-fix: add categoryKey to SELECT if it's in WHERE clause
      const wherePattern = new RegExp(`WHERE\\s+.*?\\b${categoryKeyUpper}\\b`, 'i')
      const whereMatch = sqlUpper.match(wherePattern)
      if (whereMatch) {
        // Check if it's a simple equality filter like "source_system = 'DoorDash'"
        const whereClause = validatedParsed.sqlQuery.match(/WHERE\s+(.*?)(?:\s+GROUP\s+BY|\s+ORDER\s+BY|\s+LIMIT|$)/i)?.[1] || ''
        const equalityMatch = whereClause.match(new RegExp(`(${validatedParsed.dataMapping.categoryKey})\\s*=\\s*['"]([^'"]+)['"]`, 'i'))
        
        if (equalityMatch) {
          const filterValue = equalityMatch[2]
          // Fix the SQL by adding categoryKey to SELECT
          const fixedSQL = validatedParsed.sqlQuery.replace(
            /(SELECT\s+)(.*?)(\s+FROM)/i,
            `$1${validatedParsed.dataMapping.categoryKey}, $2$3`
          )
          
          // Also add GROUP BY if aggregation is used
          if (sqlUpper.includes('SUM(') || sqlUpper.includes('COUNT(') || sqlUpper.includes('AVG(') || sqlUpper.includes('MAX(') || sqlUpper.includes('MIN(')) {
            if (!sqlUpper.includes('GROUP BY')) {
              // Add GROUP BY before ORDER BY or LIMIT
              const beforeOrderLimit = fixedSQL.match(/^(.*?)(\s+(?:ORDER\s+BY|LIMIT))/i)
              if (beforeOrderLimit) {
                validatedParsed.sqlQuery = beforeOrderLimit[1] + ` GROUP BY ${validatedParsed.dataMapping.categoryKey}` + beforeOrderLimit[2]
              } else {
                validatedParsed.sqlQuery = fixedSQL + ` GROUP BY ${validatedParsed.dataMapping.categoryKey}`
              }
            } else {
              // Add to existing GROUP BY if not already there
              const groupByPattern = new RegExp(`GROUP BY\\s+.*\\b${categoryKeyUpper}\\b`, 'i')
              if (!groupByPattern.test(sqlUpper)) {
                validatedParsed.sqlQuery = fixedSQL.replace(/(GROUP BY\s+)(.*?)(\s+(?:ORDER BY|LIMIT|$))/i, `$1${validatedParsed.dataMapping.categoryKey}, $2$3`)
              } else {
                validatedParsed.sqlQuery = fixedSQL
              }
            }
          } else {
            validatedParsed.sqlQuery = fixedSQL
          }
          
          console.log('✅ Auto-fixed SQL query by adding categoryKey to SELECT:')
          console.log(`   Fixed SQL: ${validatedParsed.sqlQuery}`)
          console.log('='.repeat(80) + '\n')
        } else {
          throw new Error(`SQL query must SELECT the categoryKey column "${validatedParsed.dataMapping.categoryKey}". The generated query does not include this column in the SELECT clause.`)
        }
      } else {
        throw new Error(`SQL query must SELECT the categoryKey column "${validatedParsed.dataMapping.categoryKey}". The generated query does not include this column in the SELECT clause.`)
      }
    }
  }

  // Log LLM response in a readable format
  console.log('\n' + '='.repeat(80))
  console.log('🔧 LLM SQL Query Generator Response')
  console.log('='.repeat(80))
  console.log(`📝 User Query: "${userQuery}"`)
  console.log(`🗄️  SQL Query (length: ${validatedParsed.sqlQuery.length}):\n${validatedParsed.sqlQuery}`)
  console.log(`📊 Chart Type: ${validatedParsed.chartType}`)
  console.log(`📋 Title: "${validatedParsed.title}"`)
  console.log(`📄 Description: "${validatedParsed.description}"`)
  console.log(`📏 Axis Labels:`)
  console.log(`   - X-Axis: "${validatedParsed.xAxisLabel}"`)
  console.log(`   - Y-Axis: "${validatedParsed.yAxisLabel}"`)
  console.log(`🗺️  Data Mapping:`)
  console.log(`   - Category Key: ${validatedParsed.dataMapping.categoryKey}`)
  console.log(`   - Value Key: ${validatedParsed.dataMapping.valueKey}`)
  console.log(`📦 Full Parsed Response:`, JSON.stringify(validatedParsed, null, 2))
  if ('_request_id' in response && response._request_id) {
    console.log(`🆔 Request ID: ${response._request_id}`)
  }
  console.log('='.repeat(80) + '\n')

  return validatedParsed
}
