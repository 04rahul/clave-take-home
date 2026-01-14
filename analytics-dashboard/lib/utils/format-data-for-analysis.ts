import type { ChartData } from '@/lib/types'
import type { QueryGenerationResult } from '@/lib/types'

/**
 * Format chart data for LLM analysis
 */
export function formatDataForAnalysis(
  chartData: Array<{ category: string; value: number }>,
  metadata: QueryGenerationResult
): string {
  if (!chartData || chartData.length === 0) {
    return `No data available for ${metadata.title}`
  }

  // Format data points
  const dataSummary = chartData
    .map(item => `${item.category}: ${item.value}`)
    .join('\n')

  // Calculate statistics
  const values = chartData.map(d => d.value)
  const min = Math.round(Math.min(...values) * 100) / 100
  const max = Math.round(Math.max(...values) * 100) / 100
  const avg = Math.round((values.reduce((sum, val) => sum + val, 0) / values.length) * 100) / 100
  const total = Math.round(values.reduce((sum, val) => sum + val, 0) * 100) / 100

  // Find min and max categories
  const minItem = chartData.find(item => item.value === min)
  const maxItem = chartData.find(item => item.value === max)

  return `
Chart Type: ${metadata.chartType}
Title: ${metadata.title}
Description: ${metadata.description}

Data Points (${chartData.length}):
${dataSummary}

Statistics:
- Minimum: ${min} (${minItem?.category || 'N/A'})
- Maximum: ${max} (${maxItem?.category || 'N/A'})
- Average: ${avg.toFixed(2)}
- Total: ${total.toFixed(2)}
- Range: ${(max - min).toFixed(2)}
${values.length > 1 ? `- Difference (Max - Min): ${((max - min) / min * 100).toFixed(2)}%` : ''}
`
}

