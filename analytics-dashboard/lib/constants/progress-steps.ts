/**
 * Progress step names and messages for the chart generation pipeline
 * Used for streaming progress updates to the frontend
 */

export type ProgressStep =
  | 'validating'
  | 'analyzing'
  | 'sql_generating'
  | 'validating_sql'
  | 'executing_sql'
  | 'validating_results'
  | 'transforming'
  | 'analyzing_data'
  | 'finalizing'

export const PROGRESS_STEP_NAMES: Record<ProgressStep, string> = {
  validating: 'validating',
  analyzing: 'analyzing',
  sql_generating: 'sql_generating',
  validating_sql: 'validating_sql',
  executing_sql: 'executing_sql',
  validating_results: 'validating_results',
  transforming: 'transforming',
  analyzing_data: 'analyzing_data',
  finalizing: 'finalizing',
} as const

export const PROGRESS_MESSAGES: Record<ProgressStep, string> = {
  validating: 'Validating input...',
  analyzing: 'Analyzing query and generating SQL...',
  sql_generating: 'Generating SQL query...',
  validating_sql: 'Validating SQL query...',
  executing_sql: 'Executing query against database...',
  validating_results: 'Validating query results...',
  transforming: 'Transforming data for visualization...',
  analyzing_data: 'Analyzing data and generating insights...',
  finalizing: 'Finalizing chart...',
} as const

/**
 * Get progress message for a given step
 */
export function getProgressMessage(step: ProgressStep): string {
  return PROGRESS_MESSAGES[step] || 'Processing...'
}

