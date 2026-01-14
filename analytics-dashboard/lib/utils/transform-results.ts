import type { ChartData } from '@/lib/types'
import type { ChartDataMapping, QueryGenerationResult } from '@/lib/types'
import type { SQLResult } from './execute-sql'

/**
 * Transform SQL query results to chart data format
 */
export function transformResults(
  results: SQLResult[],
  mapping: ChartDataMapping
): Array<{ category: string; value: number }> {
  if (!results || results.length === 0) {
    return []
  }

  // Find the actual column names (case-insensitive)
  const firstRow = results[0]
  const availableKeys = Object.keys(firstRow)
  
  // Find category key (case-insensitive)
  const categoryKey = availableKeys.find(
    key => key.toLowerCase() === mapping.categoryKey.toLowerCase()
  ) || mapping.categoryKey
  
  // Find value key (case-insensitive)
  const valueKey = availableKeys.find(
    key => key.toLowerCase() === mapping.valueKey.toLowerCase()
  ) || mapping.valueKey

  // Transform results
  return results.map((row, index) => {
    const category = String(row[categoryKey] ?? row[mapping.categoryKey] ?? `Item ${index + 1}`)
    const rawValue = row[valueKey] ?? row[mapping.valueKey] ?? 0
    
    // Ensure value is numeric
    const value = typeof rawValue === 'number' 
      ? rawValue 
      : parseFloat(String(rawValue)) || 0
    
    // Round numeric values to 2 decimal places (for averages, divisions, etc.)
    const roundedValue = isNaN(value) ? 0 : Math.round(value * 100) / 100

    return {
      category: category.trim() || `Item ${index + 1}`,
      value: roundedValue,
    }
  }).filter(item => item.category) // Filter out invalid items
}

/**
 * Transform SQL results for dual-metric charts (combo, grouped_bar)
 */
export function transformDualMetricResults(
  results: SQLResult[],
  mapping: ChartDataMapping & { secondaryValueKey?: string | null }
): Array<{ category: string; value: number; secondaryValue: number }> {
  if (!results || results.length === 0 || !mapping.secondaryValueKey) {
    return []
  }

  const firstRow = results[0]
  const availableKeys = Object.keys(firstRow)
  
  const categoryKey = availableKeys.find(
    key => key.toLowerCase() === mapping.categoryKey.toLowerCase()
  ) || mapping.categoryKey
  
  const valueKey = availableKeys.find(
    key => key.toLowerCase() === mapping.valueKey.toLowerCase()
  ) || mapping.valueKey

  const secondaryValueKey = availableKeys.find(
    key => key.toLowerCase() === mapping.secondaryValueKey!.toLowerCase()
  ) || mapping.secondaryValueKey!

  return results.map((row, index) => {
    const category = String(row[categoryKey] ?? `Item ${index + 1}`)
    const rawValue = row[valueKey] ?? 0
    const rawSecondaryValue = row[secondaryValueKey] ?? 0
    
    const value = typeof rawValue === 'number' ? rawValue : parseFloat(String(rawValue)) || 0
    const secondaryValue = typeof rawSecondaryValue === 'number' ? rawSecondaryValue : parseFloat(String(rawSecondaryValue)) || 0
    
    return {
      category: category.trim() || `Item ${index + 1}`,
      value: Math.round(value * 100) / 100,
      secondaryValue: Math.round(secondaryValue * 100) / 100,
    }
  }).filter(item => item.category)
}

/**
 * Convert transformed data to ChartData format
 */
export function toChartData(
  transformedData: Array<{ category: string; value: number; secondaryValue?: number }>,
  metadata: QueryGenerationResult,
  id?: string
): ChartData {
  // For tables, we need to handle raw data differently
  // This function is called with transformedData for charts, but for tables
  // the route handler should pass raw queryResults directly
  if (metadata.chartType === 'table') {
    // This shouldn't be called for tables, but handle it gracefully
    return {
      id: id || Date.now().toString(),
      title: metadata.title,
      description: metadata.description,
      type: metadata.chartType,
      data: transformedData.map(item => ({
        category: item.category,
        value: item.value,
      })),
      dataKey: 'value',
      categoryKey: 'category',
      xAxisLabel: metadata.xAxisLabel,
      yAxisLabel: metadata.yAxisLabel,
      gridSize: '1x1',
    }
  }

  // Handle dual-metric charts
  const hasSecondaryKey = metadata.dataMapping.secondaryValueKey != null && metadata.dataMapping.secondaryValueKey !== ''
  if ((metadata.chartType === 'combo' || metadata.chartType === 'grouped_bar') && hasSecondaryKey) {
    // For dual-metric charts, include secondaryValue in the data
    return {
      id: id || Date.now().toString(),
      title: metadata.title,
      description: metadata.description,
      type: metadata.chartType,
      data: transformedData.map(item => ({
        category: item.category,
        value: item.value,
        secondaryValue: item.secondaryValue || 0, // Include secondaryValue for dual-metric charts
      })),
      dataKey: 'value',
      categoryKey: 'category',
      secondaryDataKey: 'secondaryValue',
      primaryLabel: metadata.dataMapping.valueKey,
      secondaryLabel: metadata.dataMapping.secondaryValueKey || '',
      xAxisLabel: metadata.xAxisLabel,
      yAxisLabel: metadata.yAxisLabel,
      gridSize: '1x1',
    }
  }

  return {
    id: id || Date.now().toString(),
    title: metadata.title,
    description: metadata.description,
    type: metadata.chartType,
    data: transformedData.map(item => ({
      category: item.category,
      value: item.value,
    })),
    dataKey: 'value',
    categoryKey: 'category',
    xAxisLabel: metadata.xAxisLabel,
    yAxisLabel: metadata.yAxisLabel,
    gridSize: '1x1',
  }
}

/**
 * Convert raw SQL results to ChartData format for tables
 */
export function toTableChartData(
  queryResults: SQLResult[],
  metadata: QueryGenerationResult,
  id?: string
): ChartData {
  return {
    id: id || Date.now().toString(),
    title: metadata.title,
    description: metadata.description,
    type: 'table',
    data: queryResults.map(row => {
      // Preserve all columns from the raw SQL result
      const result: Record<string, string | number> = {}
      Object.keys(row).forEach(key => {
        result[key] = row[key] ?? ''
      })
      return result
    }),
    dataKey: metadata.dataMapping.valueKey || 'value',
    categoryKey: metadata.dataMapping.categoryKey || 'category',
    gridSize: '1x1',
  }
}

