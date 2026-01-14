import { validateContentWithLLM } from '@/lib/guardrails/llm-content-filter'
import { validateSQLQuery } from '@/lib/guardrails/sql-validator'
import { validateInsight } from '@/lib/guardrails/insight-validator'
import { validateQueryResults } from '@/lib/guardrails/result-validator'
import { executeSQLQuery } from '@/lib/utils/execute-sql'
import { transformResults, transformDualMetricResults, toChartData, toTableChartData } from '@/lib/utils/transform-results'
import { formatDataForAnalysis } from '@/lib/utils/format-data-for-analysis'
import { getUserFriendlyMessage, getStatusCodeForError } from '@/lib/errors'
import { getProgressMessage, PROGRESS_STEP_NAMES, type ProgressStep } from '@/lib/constants/progress-steps'
import { generateSQLQuery } from '@/lib/services/sql-generator'
import { analyzeData, analyzeDataStream } from '@/lib/services/data-analyzer'
import { logInteraction } from '@/lib/utils/log-interaction'
import type { QueryGenerationResult, ChartData } from '@/lib/types'

/**
 * Regenerate and validate SQL query with error context
 * Returns the new toolOutput or throws an error
 */
async function regenerateSQLWithErrorContext(
  prompt: string,
  errorMsg: string,
  previousSQL: string,
  attempt: number,
  controller: ReadableStreamDefaultController
): Promise<QueryGenerationResult> {
  streamProgress(controller, 'sql_generating', 'Finding another way to do this...')
  
  // Enhanced retry prompt with error message, previous SQL, and attempt number
  const retryPrompt = `${prompt}

Previous SQL query (attempt ${attempt}) failed with error: ${errorMsg}

Previous SQL query that failed:
\`\`\`sql
${previousSQL}
\`\`\`

Please generate a corrected SQL query that addresses this error.`
  
  const newToolOutput = await generateSQLQuery(retryPrompt)
  
  streamProgress(controller, 'validating_sql', 'Validating the new approach...')
  const sqlValidation = await validateSQLQuery(newToolOutput.sqlQuery)
  
  if (!sqlValidation.valid) {
    throw new Error(`SQL validation failed: ${sqlValidation.reason}`)
  }
  
  console.log(`✅ Retry SQL validation passed`)
  return newToolOutput
}

/**
 * Stream progress update to client
 */
function streamProgress(controller: ReadableStreamDefaultController, step: ProgressStep, message: string) {
  const data = JSON.stringify({ type: 'progress', step, message }) + '\n'
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
  } catch (error) {
    console.error('Error streaming progress:', error)
  }
}

/**
 * Format error message for user display
 * Detects common error patterns and provides user-friendly messages
 */
function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const errorMessage = error.message.toLowerCase()
    const errorString = String(error).toLowerCase()
    
    // Check for API key errors - comprehensive pattern matching
    if (errorMessage.includes('openai') && (errorMessage.includes('api key') || errorMessage.includes('api_key'))) {
      return 'OpenAI API key is missing or invalid. Please add OPENAI_MYAPI_KEY to your .env file and restart the server.'
    }
    
    if (errorMessage.includes('openai_myapi_key') || errorMessage.includes('openai_api_key')) {
      return 'OpenAI API key is missing or invalid. Please add OPENAI_MYAPI_KEY to your .env file and restart the server.'
    }
    
    if (errorMessage.includes('environment variable is required') && errorMessage.includes('openai')) {
      return 'OpenAI API key is missing. Please add OPENAI_MYAPI_KEY to your .env file and restart the server.'
    }
    
    // Check for authentication errors (401, unauthorized, invalid key)
    if (errorMessage.includes('401') || 
        errorMessage.includes('unauthorized') || 
        errorMessage.includes('invalid api key') ||
        errorMessage.includes('incorrect api key') ||
        errorString.includes('401') ||
        (errorMessage.includes('authentication') && errorMessage.includes('failed'))) {
      return 'Invalid OpenAI API key. Please check your OPENAI_MYAPI_KEY in the .env file and restart the server.'
    }
    
    // Check for rate limiting
    if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
      return 'Rate limit exceeded. Please wait a moment and try again.'
    }
    
    // Return user-friendly message or original message if already friendly
    return getUserFriendlyMessage(error)
  }
  
  if (typeof error === 'string') {
    const errorStr = error.toLowerCase()
    // Check for API key errors in string errors too
    if (errorStr.includes('openai') && (errorStr.includes('api key') || errorStr.includes('api_key'))) {
      return 'OpenAI API key is missing or invalid. Please add OPENAI_MYAPI_KEY to your .env file and restart the server.'
    }
    if (errorStr.includes('401') || errorStr.includes('unauthorized')) {
      return 'Invalid OpenAI API key. Please check your OPENAI_MYAPI_KEY in the .env file and restart the server.'
    }
    return error
  }
  
  return 'An unexpected error occurred. Please try again.'
}

/**
 * Stream error to client
 */
function streamError(controller: ReadableStreamDefaultController, error: string | unknown) {
  const errorMessage = typeof error === 'string' ? error : formatErrorMessage(error)
  const data = JSON.stringify({ type: 'error', error: errorMessage }) + '\n'
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
    controller.close()
  } catch (err) {
    console.error('Error streaming error:', err)
    controller.close()
  }
}

/**
 * Stream insight text chunk to client
 */
function streamInsightChunk(controller: ReadableStreamDefaultController, chunk: string) {
  const data = JSON.stringify({ type: 'insight_chunk', chunk }) + '\n'
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
  } catch (error) {
    console.error('Error streaming insight chunk:', error)
  }
}

/**
 * Stream a normal message (without chart) to client
 * Used for guardrail failures that should appear as normal messages, not errors
 */
function streamMessage(controller: ReadableStreamDefaultController, message: string) {
  const data = JSON.stringify({ type: 'result', message, chart: null }) + '\n'
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
    controller.close()
  } catch (error) {
    console.error('Error streaming message:', error)
    controller.close()
  }
}

/**
 * Stream final result to client
 */
function streamResult(controller: ReadableStreamDefaultController, result: any) {
  const data = JSON.stringify({ type: 'result', ...result }) + '\n'
  try {
    controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`))
    controller.close()
  } catch (error) {
    console.error('Error streaming result:', error)
    controller.close()
  }
}

export async function POST(req: Request) {
  // Parse request body first
  let prompt: string
  try {
    const body = await req.json()
    prompt = body.prompt

    if (!prompt || typeof prompt !== 'string') {
      return Response.json(
        { error: 'Invalid request. Please provide a prompt.' },
        { status: 400 }
      )
    }
  } catch (error) {
    return Response.json(
      { error: 'Invalid request body.' },
      { status: 400 }
    )
  }

  // Start timer for logging
  const startTime = Date.now()

  // Create streaming response
  const stream = new ReadableStream({
    async start(controller) {
      let stepFailed: string | undefined
      let errorDetails: string | undefined
      let llmResponse: string | undefined
      let agentAnswered = false
      let toolOutput: QueryGenerationResult | undefined

      try {

        // === STEP 1: Basic Input Validation ===
        streamProgress(controller, 'validating', getProgressMessage('validating'))
        
        // Quick length check (5-500 characters)
        if (prompt.length < 5) {
          const errorMsg = 'Query is too short. Minimum length is 5 characters.'
          stepFailed = 'input_validation'
          errorDetails = errorMsg
          streamMessage(controller, errorMsg)
        
          return
        }
        
        if (prompt.length > 500) {
          const errorMsg = 'Query is too long. Maximum length is 500 characters.'
          stepFailed = 'input_validation'
          errorDetails = errorMsg
          streamMessage(controller, errorMsg)
         
          return
        }

      
        streamProgress(controller, 'analyzing', getProgressMessage('analyzing'))
        
        let contentFilterPromise: Promise<any>
        let sqlGenerationPromise: Promise<QueryGenerationResult> | null = null
        let guardrailPassed = false
        
        // Start both LLM calls in parallel
        try {
          // LLM Content Filter (checks if query is restaurant-related)
          contentFilterPromise = validateContentWithLLM(prompt)
          
          // SQL Generation (generate SQL query using direct OpenAI API)
          streamProgress(controller, 'sql_generating', getProgressMessage('sql_generating'))
          sqlGenerationPromise = generateSQLQuery(prompt)
          
          // Wait for content filter first (faster, can cancel SQL generation if it fails)
          const contentValidation = await contentFilterPromise
          
          if (!contentValidation.valid) {
            // Content filter blocked - guardrail protection (not a failure, but intentional blocking)
            const errorMsg = contentValidation.reason || 'Query is not related to restaurant analytics.'
            stepFailed = 'guardrail_blocked'
            errorDetails = errorMsg
            
            // Prevent SQL generation from causing unhandled rejections
            // Silently catch any errors from the SQL generation promise
            if (sqlGenerationPromise) {
              sqlGenerationPromise.catch((error) => {
                console.log('SQL generation promise rejected (guardrail blocked query):', error.message)
              })
            }
            
            streamMessage(controller, errorMsg)
            await logInteraction({
              userPrompt: prompt,
              successStatus: false,
              agentAnswered: false,
              stepFailed: 'guardrail_blocked',
              errorDetails: errorMsg,
              responseTimeMs: Date.now() - startTime,
            })
            return
          }
          
          // Guardrail passed - mark it so we know it's safe to proceed
          guardrailPassed = true
        } catch (error) {
          // Also catch SQL generation promise rejection here if guardrail itself fails
          if (sqlGenerationPromise) {
            sqlGenerationPromise.catch(() => {
              console.log('SQL generation promise rejected (guardrail execution failed)')
            })
          }
          console.error('Error in parallel guardrail execution:', error)
          stepFailed = 'guardrail_execution'
          errorDetails = error instanceof Error ? error.message : String(error)
          streamError(controller, error)
          await logInteraction({
            userPrompt: prompt,
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'guardrail_execution',
            errorDetails: errorDetails,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }

        // Only proceed with SQL generation if guardrail passed
        if (!guardrailPassed || !sqlGenerationPromise) {
          return
        }

        // Wait for SQL generation to complete
        try {
          toolOutput = await sqlGenerationPromise
          
        
          
          if (!toolOutput || !toolOutput.sqlQuery || !toolOutput.chartType) {
           
            const errorMsg = 'Failed to generate valid SQL query. Please try rephrasing your request.'
            stepFailed = 'sql_generation'
            errorDetails = errorMsg
            streamMessage(controller, errorMsg)
            await logInteraction({
              userPrompt: prompt,
              llmResponse: toolOutput ? JSON.stringify(toolOutput) : undefined,
              successStatus: false,
              agentAnswered: false,
              stepFailed: 'sql_generation',
              errorDetails: errorMsg,
              responseTimeMs: Date.now() - startTime,
            })
            return
          }
        } catch (error) {
          console.error('Error generating SQL query:', error)
          const errorMsg = formatErrorMessage(error) || 'Failed to generate SQL query. Please try rephrasing your request.'
          stepFailed = 'sql_generation'
          errorDetails = errorMsg
          streamError(controller, errorMsg)
          await logInteraction({
            userPrompt: prompt,
            llmResponse: toolOutput ? JSON.stringify(toolOutput) : undefined,
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'sql_generation',
            errorDetails: errorMsg,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }

        // === STEP 3: Validate SQL Query ===
        streamProgress(controller, 'validating_sql', getProgressMessage('validating_sql'))
        console.log(`\n🔍 About to validate SQL query: "${toolOutput.sqlQuery}" (length: ${toolOutput.sqlQuery.length})`)
        const sqlValidation = await validateSQLQuery(toolOutput.sqlQuery)
        if (!sqlValidation.valid) {
          console.error(`❌ SQL validation failed: ${sqlValidation.reason}`)
          const errorMsg = `Invalid SQL query: ${sqlValidation.reason}`
          stepFailed = 'sql_validation'
          errorDetails = errorMsg
          streamMessage(controller, errorMsg)
          await logInteraction({
            userPrompt: prompt,
            llmResponse: JSON.stringify(toolOutput),
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'sql_validation',
            errorDetails: errorMsg,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }
        console.log(`✅ SQL validation passed`)

        // === STEP 4: Execute SQL Query (with retry logic for SQL generation) ===
        streamProgress(controller, 'executing_sql', getProgressMessage('executing_sql'))
        console.log(`\n🚀 About to execute SQL query: "${toolOutput.sqlQuery}" (length: ${toolOutput.sqlQuery.length})`)
        let queryResults: any[] = []
        let sqlExecutionAttempts = 0
        const maxSQLRetries = 2 // Retry SQL generation up to 2 times if execution fails
        
        // Track retry metrics
        let networkRetries = 0
        let sqlRegenerationRetries = 0
        const retryDetails: Array<{ type: 'network' | 'sql_regeneration', attempt: number, error?: string, timestamp: string, llmResponse?: string }> = []
        
        // Callback to stream retry messages for network errors
        const onSQLRetry = (attempt: number, maxRetries: number, error: string) => {
          networkRetries++
          retryDetails.push({
            type: 'network',
            attempt: attempt + 1,
            error: error.substring(0, 200), // Truncate long errors
            timestamp: new Date().toISOString()
          })
          streamProgress(
            controller,
            'executing_sql',
            'Trying a different approach...'
          )
        }
        
        while (sqlExecutionAttempts <= maxSQLRetries) {
          try {
            queryResults = await executeSQLQuery(toolOutput.sqlQuery)
            break // Success, exit retry loop
          } catch (error) {
            sqlExecutionAttempts++
            const errorMsg = error instanceof Error ? error.message : String(error)
            console.error(`Error executing SQL query (attempt ${sqlExecutionAttempts}/${maxSQLRetries + 1}):`, error)
            
            // Check if this is a SQL syntax/validation error that we should retry with new SQL generation
            const isSQLError = errorMsg.includes('syntax error') || 
                              errorMsg.includes('Table or view not found') ||
                              (errorMsg.includes('column') && errorMsg.includes('does not exist')) ||
                              errorMsg.includes('invalid') ||
                              errorMsg.includes('SQL')
            
            // Simple check: should we retry?
            const shouldRetry = isSQLError && sqlExecutionAttempts <= maxSQLRetries
            
            if (!shouldRetry) {
              // Not retryable SQL error, or max retries reached - fail
              stepFailed = 'sql_execution'
              errorDetails = errorMsg
              streamError(controller, error)
              const totalRetries = networkRetries + sqlRegenerationRetries
              await logInteraction({
                userPrompt: prompt,
                llmResponse: JSON.stringify(toolOutput),
                successStatus: false,
                agentAnswered: false,
                stepFailed: 'sql_execution',
                errorDetails: errorMsg,
                responseTimeMs: Date.now() - startTime,
                retryMetrics: totalRetries > 0 ? {
                  networkRetries,
                  sqlRegenerationRetries,
                  totalRetries,
                  retryDetails: retryDetails.length > 0 ? retryDetails : undefined
                } : undefined,
              })
              return
            }
            
            // Should retry: capture failed attempt and regenerate SQL
            const failedAttempt = {
              type: 'sql_regeneration' as const,
              attempt: sqlExecutionAttempts,
              error: errorMsg.substring(0, 200),
              timestamp: new Date().toISOString(),
              llmResponse: JSON.stringify(toolOutput)
            }
            sqlRegenerationRetries++
            retryDetails.push(failedAttempt)
            console.log(`\n🔄 SQL execution failed with error: "${errorMsg}"`)
            console.log(`   Retrying SQL generation with error context (attempt ${sqlExecutionAttempts}/${maxSQLRetries + 1})...`)
            
            // Regenerate SQL with error context (no nested try-catch!)
            // If regeneration fails, we'll handle it in the next iteration or fail if max retries reached
            try {
              toolOutput = await regenerateSQLWithErrorContext(prompt, errorMsg, toolOutput.sqlQuery, sqlExecutionAttempts, controller)
              streamProgress(controller, 'executing_sql', 'Executing the new approach...')
              // Continue loop - next iteration will try executing the new SQL
              continue
            } catch (regenerationError) {
              console.error('Error regenerating SQL query:', regenerationError)
              
              // If we've exhausted retries, fail
              if (sqlExecutionAttempts >= maxSQLRetries) {
                const regenerationErrorMsg = regenerationError instanceof Error ? regenerationError.message : String(regenerationError)
                stepFailed = 'sql_execution'
                errorDetails = `Failed to generate valid SQL after ${maxSQLRetries + 1} attempts. Last error: ${errorMsg}. Regeneration error: ${regenerationErrorMsg}`
                streamError(controller, errorDetails)
                const totalRetries = networkRetries + sqlRegenerationRetries
                await logInteraction({
                  userPrompt: prompt,
                  llmResponse: JSON.stringify(toolOutput),
                  successStatus: false,
                  agentAnswered: false,
                  stepFailed: 'sql_execution',
                  errorDetails: errorDetails,
                  responseTimeMs: Date.now() - startTime,
                  retryMetrics: totalRetries > 0 ? {
                    networkRetries,
                    sqlRegenerationRetries,
                    totalRetries,
                    retryDetails: retryDetails.length > 0 ? retryDetails : undefined
                  } : undefined,
                })
                return
              }
              
              // Regeneration failed but we can still retry - continue loop
              streamProgress(controller, 'sql_generating', 'Trying a different approach...')
              continue
            }
          }
        }

        if (!queryResults || queryResults.length === 0) {
          // User-friendly message without technical details
          const errorMsg = "I couldn't find any data matching your request. Try adjusting your search criteria or asking a different question."
          stepFailed = 'sql_execution'
          errorDetails = 'Query returned no results'
          streamError(controller, errorMsg)
          await logInteraction({
            userPrompt: prompt,
            llmResponse: JSON.stringify(toolOutput),
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'sql_execution',
            errorDetails: errorDetails,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }

        // === STEP 5: Validate Query Results ===
        streamProgress(controller, 'validating_results', getProgressMessage('validating_results'))
        const resultValidation = await validateQueryResults(queryResults, toolOutput.dataMapping, toolOutput.chartType)
        if (!resultValidation.valid) {
          // Use user-friendly message from validator, or provide a generic one
          const errorMsg = resultValidation.reason || "I couldn't process the data. Please try rephrasing your question."
          stepFailed = 'result_validation'
          errorDetails = resultValidation.reason || 'Query returned invalid results'
          streamError(controller, errorMsg)
          await logInteraction({
            userPrompt: prompt,
            llmResponse: JSON.stringify(toolOutput),
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'result_validation',
            errorDetails: errorMsg,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }

        // === STEP 6: Transform Results to Chart Data ===
        streamProgress(controller, 'transforming', getProgressMessage('transforming'))
        
        // For tables, skip transformation and use raw data; for charts, transform to category/value
        const isTable = toolOutput.chartType === 'table'
        const isDualMetric = toolOutput.chartType === 'combo' || toolOutput.chartType === 'grouped_bar'
        const hasSecondaryKey = toolOutput.dataMapping.secondaryValueKey != null && toolOutput.dataMapping.secondaryValueKey !== ''
        
        let transformedData: Array<{ category: string; value: number; secondaryValue?: number }> = []
        
        if (isTable) {
          transformedData = []
        } else if (isDualMetric && hasSecondaryKey) {
          // Transform for dual-metric charts
          const dualData = transformDualMetricResults(queryResults, toolOutput.dataMapping)
          transformedData = dualData.map(item => ({
            category: item.category,
            value: item.value,
            secondaryValue: item.secondaryValue,
          }))
        } else {
          // Standard single-metric transformation
          transformedData = transformResults(queryResults, toolOutput.dataMapping).map(item => ({
            category: item.category,
            value: item.value,
          }))
        }
        
        if (!isTable && transformedData.length === 0) {
          const errorMsg = 'Query returned no valid data points.'
          stepFailed = 'transformation'
          errorDetails = errorMsg
          streamMessage(controller, errorMsg)
          await logInteraction({
            userPrompt: prompt,
            llmResponse: JSON.stringify(toolOutput),
            successStatus: false,
            agentAnswered: false,
            stepFailed: 'transformation',
            errorDetails: errorMsg,
            responseTimeMs: Date.now() - startTime,
          })
          return
        }

        // === STEP 7: Generate Insight via Data Analysis ===
        streamProgress(controller, 'analyzing_data', getProgressMessage('analyzing_data'))
        let insight: string
        try {
          if (isTable) {
            // For tables, generate a simple insight without value calculations
            insight = `Displaying ${queryResults.length} ${queryResults.length === 1 ? 'item' : 'items'} from ${toolOutput.title}.`
          } else {
            const dataSummary = formatDataForAnalysis(transformedData, toolOutput)
            
            // Stream insight chunks as they arrive
            insight = ''
            for await (const chunk of analyzeDataStream(prompt, toolOutput.chartType, toolOutput.title, dataSummary)) {
              insight += chunk
              streamInsightChunk(controller, chunk)
            }

            const insightValidation = await validateInsight(insight)
            if (!insightValidation.valid) {
              const total = transformedData.reduce((sum, d) => sum + d.value, 0)
              insight = `Analysis of ${transformedData.length} data points for ${toolOutput.title}. Total value: ${total}.`
            }
          }
        } catch (error) {
          console.error('Error generating insight:', error)
          if (isTable) {
            insight = `Displaying ${queryResults.length} ${queryResults.length === 1 ? 'item' : 'items'} from ${toolOutput.title}.`
          } else {
            const total = transformedData.reduce((sum, d) => sum + d.value, 0)
            insight = `Analysis of ${transformedData.length} data points for ${toolOutput.title}. Total value: ${total}.`
          }
        }

        // === STEP 8: Create Chart Data ===
        streamProgress(controller, 'finalizing', getProgressMessage('finalizing'))
        
        // Show both table and chart when LLM chose dual-metric visualization
        // This relies on the LLM's decision via dataMapping.secondaryValueKey and chartType,
        // not on inspecting column names or user query text
        const shouldShowBoth = isDualMetric && hasSecondaryKey && !isTable
        
        let chartData: ChartData
        let tableData: ChartData | undefined
        
        if (isTable) {
          chartData = toTableChartData(queryResults, toolOutput)
        } else if (shouldShowBoth) {
          // For dual-metric charts: create both table and chart
          // 1. Create table with all relevant columns
          tableData = toTableChartData(queryResults, {
            ...toolOutput,
            title: `${toolOutput.title} - Detailed Data`,
            description: 'Complete data showing all relevant metrics',
          })
          
          // 2. Create chart (combo or grouped_bar) for visualization
          // Since shouldShowBoth is true, we know isDualMetric && hasSecondaryKey is true
          chartData = {
            id: Date.now().toString(),
            title: toolOutput.title,
            description: toolOutput.description,
            type: toolOutput.chartType,
            data: transformedData.map(item => ({
              category: item.category,
              value: item.value,
              secondaryValue: item.secondaryValue || 0,
            })),
            dataKey: 'value',
            categoryKey: 'category',
            secondaryDataKey: 'secondaryValue',
            primaryLabel: toolOutput.dataMapping.valueKey,
            secondaryLabel: toolOutput.dataMapping.secondaryValueKey || '',
            xAxisLabel: toolOutput.xAxisLabel,
            yAxisLabel: toolOutput.yAxisLabel,
            gridSize: '1x1',
          }
        } else if (isDualMetric && hasSecondaryKey) {
          // For dual-metric charts, create chart data with both primary and secondary values
          // transformedData already includes secondaryValue from transformDualMetricResults
          chartData = {
            id: Date.now().toString(),
            title: toolOutput.title,
            description: toolOutput.description,
            type: toolOutput.chartType,
            data: transformedData.map(item => ({
              category: item.category,
              value: item.value,
              secondaryValue: item.secondaryValue || 0, // Ensure secondaryValue is included
            })),
            dataKey: 'value',
            categoryKey: 'category',
            secondaryDataKey: 'secondaryValue',
            primaryLabel: toolOutput.dataMapping.valueKey,
            secondaryLabel: toolOutput.dataMapping.secondaryValueKey || '',
            xAxisLabel: toolOutput.xAxisLabel,
            yAxisLabel: toolOutput.yAxisLabel,
            gridSize: '1x1',
          }
        } else {
          chartData = toChartData(transformedData, toolOutput)
        }

        // === STEP 9: Stream Final Result ===
        streamResult(controller, {
          message: insight,
          chart: chartData,
          table: tableData, // Include table when showing both
        })

        // Log successful interaction
        llmResponse = JSON.stringify({
          sqlQuery: toolOutput.sqlQuery,
          chartType: toolOutput.chartType,
          title: toolOutput.title,
          description: toolOutput.description,
          xAxisLabel: toolOutput.xAxisLabel,
          yAxisLabel: toolOutput.yAxisLabel,
          dataMapping: toolOutput.dataMapping,
          insight: insight,
        })
        agentAnswered = true
        
        // Calculate total retries
        const totalRetries = networkRetries + sqlRegenerationRetries
        
        await logInteraction({
          userPrompt: prompt,
          llmResponse: llmResponse,
          successStatus: true,
          agentAnswered: true,
          responseTimeMs: Date.now() - startTime,
          retryMetrics: totalRetries > 0 ? {
            networkRetries,
            sqlRegenerationRetries,
            totalRetries,
            retryDetails: retryDetails.length > 0 ? retryDetails : undefined
          } : undefined,
        })
      } catch (error) {
        console.error('Error generating chart:', error)
        const errorMsg = error instanceof Error ? error.message : String(error)
        stepFailed = stepFailed || 'unknown'
        errorDetails = errorDetails || errorMsg
        streamError(controller, error)
        await logInteraction({
          userPrompt: prompt,
          successStatus: false,
          agentAnswered: false,
          stepFailed: stepFailed,
          errorDetails: errorDetails,
          responseTimeMs: Date.now() - startTime,
        })
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
