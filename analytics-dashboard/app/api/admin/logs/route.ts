import { NextRequest, NextResponse } from 'next/server'
import { executeSQLQuery } from '@/lib/utils/execute-sql'

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams
    const successFilter = searchParams.get('success_status') // 'true', 'false', or null (all)
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build WHERE clause
    let whereClause = ''
    if (successFilter === 'true') {
      whereClause = 'WHERE success_status = true'
    } else if (successFilter === 'false') {
      whereClause = 'WHERE success_status = false'
    } else if (successFilter === 'blocked') {
      whereClause = "WHERE step_failed = 'guardrail_blocked'"
    }

    // Check if retry_metrics column exists
    let hasRetryMetrics = false
    try {
      const checkColumnQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'llm_interactions' 
        AND column_name = 'retry_metrics'
        LIMIT 1
      `
      const columnCheck = await executeSQLQuery(checkColumnQuery)
      hasRetryMetrics = columnCheck.length > 0
    } catch (error) {
      // If we can't check, assume column doesn't exist
      console.warn('Could not check for retry_metrics column, assuming it does not exist:', error)
      hasRetryMetrics = false
    }

    // Build query - include retry_metrics only if column exists
    const query = hasRetryMetrics
      ? `
        SELECT 
          id,
          user_prompt,
          llm_response,
          error_details,
          success_status,
          agent_answered,
          step_failed,
          created_at,
          response_time_ms,
          retry_metrics
        FROM llm_interactions
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `
      : `
        SELECT 
          id,
          user_prompt,
          llm_response,
          error_details,
          success_status,
          agent_answered,
          step_failed,
          created_at,
          response_time_ms,
          NULL as retry_metrics
        FROM llm_interactions
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

    const rows = await executeSQLQuery(query)

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(*)::int as total
      FROM llm_interactions
      ${whereClause}
    `
    const countRows = await executeSQLQuery(countQuery)
    const total = parseInt(countRows[0]?.total || '0', 10)

    return NextResponse.json({
      logs: rows,
      total,
      limit,
      offset,
    })
  } catch (error) {
    console.error('Error fetching logs:', error)
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('Error details:', {
      message: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    })
    return NextResponse.json(
      { 
        error: 'Failed to fetch logs',
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
      },
      { status: 500 }
    )
  }
}

