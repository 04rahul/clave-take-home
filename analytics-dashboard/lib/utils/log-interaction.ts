import { getPool } from './execute-sql'

export interface RetryMetrics {
  networkRetries?: number
  sqlRegenerationRetries?: number
  totalRetries?: number
  retryDetails?: Array<{
    type: 'network' | 'sql_regeneration'
    attempt: number
    error?: string
    timestamp?: string
    llmResponse?: string  // LLM response (SQL query, chart type, etc.) for this retry attempt
  }>
}

export interface InteractionLogData {
  userPrompt: string
  llmResponse?: string
  errorDetails?: string
  successStatus: boolean
  agentAnswered: boolean
  stepFailed?: string
  responseTimeMs?: number
  retryMetrics?: RetryMetrics
}

/**
 * Log an LLM interaction to PostgreSQL
 * Uses parameterized queries for safety
 */
export async function logInteraction(data: InteractionLogData): Promise<void> {
  try {
    const pool = getPool()

    const query = `
      INSERT INTO llm_interactions (
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
      ) VALUES (
        gen_random_uuid(),
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        NOW(),
        $7,
        $8
      )
    `

    await pool.query(query, [
      data.userPrompt,
      data.llmResponse || null,
      data.errorDetails || null,
      data.successStatus,
      data.agentAnswered,
      data.stepFailed || null,
      data.responseTimeMs ?? null,
      data.retryMetrics ? JSON.stringify(data.retryMetrics) : null,
    ])
  } catch (error) {
    // Log error but don't throw - we don't want logging failures to break the main flow
    console.error('Failed to log interaction:', error)
  }
}

