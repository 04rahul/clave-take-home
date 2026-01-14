import type { ValidationResult } from '@/lib/types'
import type { ChartDataMapping, ChartType } from '@/lib/types'

export interface SQLResultRow {
  [key: string]: any
}

export async function validateQueryResults(
  results: SQLResultRow[],
  mapping: ChartDataMapping,
  chartType?: ChartType
): Promise<ValidationResult> {
  if (!results || results.length === 0) {
    return {
      valid: false,
      reason: "I couldn't find any data matching your request. Try adjusting your search criteria or asking a different question.",
    }
  }

  // Check result size (should be reasonable)
  if (results.length > 1000) {
    return {
      valid: false,
      reason: `Query returned too many results (${results.length}). Maximum allowed: 1000`,
    }
  }

  // Validate that mapping keys exist in results
  const firstRow = results[0]
  if (!firstRow) {
    return {
      valid: false,
      reason: 'Query returned empty result set.',
    }
  }

  const availableKeys = Object.keys(firstRow)
  const availableKeysLower = availableKeys.map(k => k.toLowerCase())

  // Log for debugging
  console.log(`\n🔍 Result Validator:`)
  console.log(`   Expected category key: "${mapping.categoryKey}"`)
  console.log(`   Expected value key: "${mapping.valueKey}"`)
  console.log(`   Available columns: ${availableKeys.join(', ')}`)
  console.log(`   First row:`, JSON.stringify(firstRow, null, 2))

  if (!availableKeysLower.includes(mapping.categoryKey.toLowerCase())) {
    // Try case-insensitive match and suggest corrections
    const similarCategoryKey = availableKeys.find(k => k.toLowerCase() === mapping.categoryKey.toLowerCase())
    if (similarCategoryKey) {
      console.log(`     Category key case mismatch: expected "${mapping.categoryKey}", found "${similarCategoryKey}"`)
    }
    return {
      valid: false,
      reason: `Category key "${mapping.categoryKey}" not found in query results. Available columns: ${availableKeys.join(', ')}`,
    }
  }

  if (!availableKeysLower.includes(mapping.valueKey.toLowerCase())) {
    return {
      valid: false,
      reason: `Value key "${mapping.valueKey}" not found in query results. Available columns: ${availableKeys.join(', ')}`,
    }
  }

  // Validate secondary value key if present (for dual-metric charts)
  if (mapping.secondaryValueKey) {
    if (!availableKeysLower.includes(mapping.secondaryValueKey.toLowerCase())) {
      return {
        valid: false,
        reason: `Secondary value key "${mapping.secondaryValueKey}" not found in query results. Available columns: ${availableKeys.join(', ')}`,
      }
    }
  }

  // Validate data types (value should be numeric) - skip for tables
  if (chartType !== 'table') {
    const valueKeyLower = mapping.valueKey.toLowerCase()
    const numericValueKey = availableKeys.find(k => k.toLowerCase() === valueKeyLower) || mapping.valueKey

    for (const row of results.slice(0, 10)) {
      // Sample first 10 rows
      const value = row[numericValueKey] ?? row[mapping.valueKey]
      if (value !== null && value !== undefined) {
        const numValue = typeof value === 'number' ? value : parseFloat(value)
        if (isNaN(numValue)) {
          return {
            valid: false,
            reason: `Value column "${mapping.valueKey}" contains non-numeric data: ${value}`,
          }
        }
      }
    }
  }

  return { valid: true }
}

