import OpenAI from 'openai'
import dataAnalysisPrompt from '@/prompts/data-analysis.json'

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
  const { systemInstructions, guidelines, examples } = dataAnalysisPrompt

  const guidelinesText = Array.isArray(guidelines) ? guidelines.join('\n- ') : guidelines

  const examplesText = Array.isArray(examples)
    ? examples
        .map((ex: any) => `Data: ${JSON.stringify(ex.data)}\nGood Insight: "${ex.goodInsight}"\nBad Insight: "${ex.badInsight}"`)
        .join('\n\n')
    : ''

  return `${systemInstructions}

GUIDELINES:
- ${guidelinesText}

EXAMPLES OF GOOD VS BAD INSIGHTS:
${examplesText}

Your task: Analyze the provided restaurant analytics data and generate a specific, data-driven business insight (2-3 sentences) that:
- References actual numbers from the data
- Identifies trends, patterns, or outliers
- Makes comparisons when applicable
- Highlights the most significant finding
- Is professional and business-focused`
}

/**
 * Analyze data and generate insights using OpenAI API
 */
export async function analyzeData(
  userQuery: string,
  chartType: string,
  title: string,
  dataSummary: string
): Promise<string> {
  const client = getOpenAIClient()
  const model = 'gpt-4o' // Using gpt-4o for data analysis

  const analysisPrompt = `Analyze this restaurant analytics data and provide a business insight:

User Query: "${userQuery}"
Chart Type: ${chartType}
Title: ${title}

Data Summary:
${dataSummary}

Provide a specific, data-driven insight (2-3 sentences) highlighting key trends, comparisons, or findings.
Focus on actionable business intelligence.

IMPORTANT: Write in plain text only. Do NOT use markdown formatting such as **bold**, *italic*, or any other markdown syntax. Just write the numbers and text naturally.`

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildSystemInstructions() },
      { role: 'user', content: analysisPrompt },
    ],
    temperature: 0.7,
    // max_tokens: 300,
  })

  const insight = completion.choices[0]?.message?.content || ''
  
  // Log LLM response in a readable format
  const dataSummaryPreview = dataSummary.length > 500 
    ? dataSummary.substring(0, 500) + '... (truncated)'
    : dataSummary

  console.log('\n' + '='.repeat(80))
  console.log('💡 LLM Data Analysis (Summary) Response')
  console.log('='.repeat(80))
  console.log(`📝 User Query: "${userQuery}"`)
  console.log(`📊 Chart Type: ${chartType}`)
  console.log(`📋 Chart Title: "${title}"`)
  console.log(`📊 Data Summary (preview):\n${dataSummaryPreview}`)
  console.log(`💭 Generated Insight: "${insight}"`)
  console.log(`📄 Full Completion Response:`)
  console.log(`   - Model: ${completion.model}`)
  console.log(`   - Finish Reason: ${completion.choices[0]?.finish_reason || 'N/A'}`)
  console.log(`   - Usage:`, {
    prompt_tokens: completion.usage?.prompt_tokens || 'N/A',
    completion_tokens: completion.usage?.completion_tokens || 'N/A',
    total_tokens: completion.usage?.total_tokens || 'N/A',
  })
  if (completion.id) {
    console.log(`🆔 Completion ID: ${completion.id}`)
  }
  console.log('='.repeat(80) + '\n')
  
  if (!insight || insight.trim().length === 0) {
    throw new Error('Empty insight generated from OpenAI')
  }

  return insight.trim()
}

/**
 * Analyze data and generate insights using OpenAI API with streaming
 * Yields text chunks as they arrive
 */
export async function* analyzeDataStream(
  userQuery: string,
  chartType: string,
  title: string,
  dataSummary: string
): AsyncGenerator<string, string, unknown> {
  const client = getOpenAIClient()
  const model = 'gpt-4o' // Using gpt-4o for data analysis

  const analysisPrompt = `Analyze this restaurant analytics data and provide a business insight:

User Query: "${userQuery}"
Chart Type: ${chartType}
Title: ${title}

Data Summary:
${dataSummary}

Provide a specific, data-driven insight (2-3 sentences) highlighting key trends, comparisons, or findings.
Focus on actionable business intelligence.

IMPORTANT: Write in plain text only. Do NOT use markdown formatting such as **bold**, *italic*, or any other markdown syntax. Just write the numbers and text naturally.`

  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: buildSystemInstructions() },
      { role: 'user', content: analysisPrompt },
    ],
    temperature: 0.7,
    // max_tokens: 700,
    stream: true,
  })

  let fullInsight = ''
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || ''
    if (content) {
      fullInsight += content
      yield content
    }
  }

  const trimmedInsight = fullInsight.trim()
  
  if (!trimmedInsight || trimmedInsight.length === 0) {
    throw new Error('Empty insight generated from OpenAI')
  }

  return trimmedInsight
}

