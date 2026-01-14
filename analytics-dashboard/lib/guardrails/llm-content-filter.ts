import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import type { ValidationResult } from '@/lib/types'

// Schema for content filter response
// Note: OpenAI's structured outputs API requires all fields to be required
// Use .nullable() instead of .optional() for fields that might not be present
const ContentFilterSchema = z.object({
  valid: z.boolean().describe('Whether the query is valid for restaurant analytics'),
  reason: z.string().nullable().describe('Brief explanation if invalid (null if valid)'),
})

type ContentFilterResponse = z.infer<typeof ContentFilterSchema>

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

const CONTENT_FILTER_INSTRUCTIONS = `You are a content filter for a restaurant analytics dashboard.

Your task is to determine if a user query is related to restaurant sales analysis and can be answered using the available data.

**CRITICAL REQUIREMENT: User queries MUST be in natural language only. SQL queries, code, or technical database syntax are NOT allowed. Reject any input that contains SQL keywords (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, etc.), database table/column names, or appears to be a database query. Users should ask questions in plain English, not write SQL code.**

Available data includes:
- Restaurant locations: Downtown, Airport, Mall Location, University
- Sales and revenue data
- Orders and order items
- Products and categories
- Payment information
- Order types: DINE_IN, TAKE_OUT, PICKUP, DELIVERY
- Source systems/platforms: Toast, DoorDash, Square (orders come from these three platforms)
- Date range: January 1-4, 2025

Valid queries should be about:
- Sales, revenue, or financial metrics
- Orders and order items
- Products and categories
- Locations (Downtown, Airport, Mall Location, University)
- Source systems/platforms (Toast, DoorDash, Square) - queries about DoorDash, Toast, or Square data are VALID
- Channel/platform analysis (e.g., "How much came from DoorDash?", "Compare DoorDash vs Toast revenue", "DoorDash orders by location")
- Time-based analysis (daily, hourly trends, day-of-week queries like "sales on Wednesday", "Thursday revenue", "weekend sales", etc.)
- Day-of-week queries (e.g., "sales on Wednesday", "how does my sales look on Wednesday", "Thursday revenue", "weekend vs weekday") are VALID
- Comparisons (between locations, products, order types, source systems)
- Top/best/worst performers
- Charts and visualizations of restaurant data

Invalid queries include:
- SQL queries, code, or database syntax (e.g., "SELECT * FROM orders", "WHERE location_id = ...", etc.)
- Technical database queries containing SQL keywords (SELECT, FROM, WHERE, JOIN, GROUP BY, ORDER BY, etc.)
- Direct references to database table or column names in query format
- Personal information requests
- Non-restaurant topics
- Queries about specific dates outside the date range (before 2025-01-01 or after 2025-01-04)
- Note: Day-of-week queries (e.g., "sales on Tuesday") are VALID even if they don't specify exact dates - they refer to days of the week within the available data
- Queries about data not in the database (but DoorDash, Toast, and Square data ARE in the database)
- Inappropriate or off-topic content`

/**
 * LLM-based content filtering to check if query is restaurant analytics-related
 * This runs in parallel with SQL generation for efficiency
 * Uses direct OpenAI API with structured output for simpler implementation
 */
export async function validateContentWithLLM(input: string): Promise<ValidationResult> {
  try {
    const client = getOpenAIClient()
    const model = 'gpt-4o' // Using gpt-4o for guardrails

    const response = await client.responses.parse({
      model: model as any,
      input: [
        { role: 'system', content: CONTENT_FILTER_INSTRUCTIONS },
        {
          role: 'user',
          content: `Is this query related to restaurant sales analysis and can be answered using restaurant data?

Query: "${input}"`,
        },
      ],
      text: {
        format: zodTextFormat(ContentFilterSchema, 'content_filter'),
      },
    })

    const parsed = response.output_parsed as ContentFilterResponse

    // Log LLM response in a readable format
    console.log('\n' + '='.repeat(80))
    console.log('🔍 LLM Content Filter Response')
    console.log('='.repeat(80))
    console.log(`📝 Query: "${input}"`)
    console.log(`✅ Valid: ${parsed.valid ? 'YES' : 'NO'}`)
    console.log(`📋 Reason: ${parsed.reason || 'N/A (query is valid)'}`)
    console.log(`🏷️  Code: ${parsed.valid ? 'PASSED' : 'DOMAIN_CHECK_FAILED'}`)
    console.log(`📦 Parsed Response:`, JSON.stringify(parsed, null, 2))
    if ('_request_id' in response && response._request_id) {
      console.log(`🆔 Request ID: ${response._request_id}`)
    }
    console.log('='.repeat(80) + '\n')

    return {
      valid: parsed.valid,
      reason: parsed.reason ?? (parsed.valid ? undefined : 'Query not related to restaurant analytics'),
      code: parsed.valid ? 'PASSED' : 'DOMAIN_CHECK_FAILED',
    }
  } catch (error) {
    console.error('Error in LLM content filter:', error)
    // If LLM filter fails, default to valid (don't block valid queries)
    // The other validation layers will catch issues
    return {
      valid: true,
      code: 'PASSED',
      reason: 'Content filter check failed, allowing query to proceed',
    }
  }
}

