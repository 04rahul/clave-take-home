export type ChartType = "bar" | "line" | "area" | "pie" | "table" | "combo" | "grouped_bar"

export type ChartSize = "small" | "medium" | "large"

export type DashboardLayout =
  | "auto" // Auto-arrange based on chart count
  | "grid-2" // 2 columns
  | "grid-3" // 3 columns
  | "featured" // 1 large + rest small
  | "split" // 2 large side by side
  | "focus" // 1 full width + grid below

export interface LayoutTemplate {
  id: DashboardLayout
  name: string
  description: string
  minCharts: number
  icon: string
}

export interface ChartPosition {
  x: number
  y: number
}

export type ChartGridSize = "1x1" | "2x1" | "1x2" | "2x2"

export interface ChartData {
  id: string
  title: string
  description: string
  type: ChartType
  data: Array<Record<string, string | number>>
  dataKey: string
  categoryKey: string
  color?: string
  gridSize?: ChartGridSize
  // For dual-metric charts (combo, grouped_bar)
  secondaryDataKey?: string
  secondaryLabel?: string
  primaryLabel?: string
  // Axis labels
  xAxisLabel?: string
  yAxisLabel?: string
  // Bar chart configuration
  barCategoryGap?: string
  barGap?: number
  barSize?: number
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  chart?: ChartData
  table?: ChartData // For ambiguity cases: table with all relevant data
  isError?: boolean
  isStreaming?: boolean // Indicates if the message is currently streaming
}

export interface ChatSession {
  id: string
  title: string
  timestamp: Date
  messages: Message[]
}

// Query Generation Types
export interface QueryGenerationResult {
  sqlQuery: string
  chartType: ChartType
  title: string
  description: string
  xAxisLabel: string
  yAxisLabel: string
  dataMapping: {
    categoryKey: string
    valueKey: string
    secondaryValueKey: string | null // For dual-metric charts (nullable from zod schema)
  }
}

export interface ChartDataMapping {
  categoryKey: string
  valueKey: string
  secondaryValueKey?: string | null // For dual-metric charts (combo, grouped_bar)
}

// Guardrail Types
export interface ValidationResult {
  valid: boolean
  reason?: string
  code?: string
}

// export interface ContentFilterResult extends ValidationResult {
//   code: 'DOMAIN_CHECK_FAILED' | 'INVALID_LENGTH' | 'INAPPROPRIATE_CONTENT' | 'SQL_INJECTION_DETECTED' | 'PASSED'
// }

export interface SQLValidationResult extends ValidationResult {
  code: 'NOT_READ_ONLY' | 'INVALID_TABLE' | 'DANGEROUS_FUNCTION' | 'SQL_INJECTION_PATTERN' | 'NO_LIMIT' | 'TOO_COMPLEX' | 'INVALID_SQL' | 'PASSED'
}
