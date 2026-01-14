export class InputValidationError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'InputValidationError'
  }
}

export class ContentFilterError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'ContentFilterError'
  }
}

export class SQLValidationError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'SQLValidationError'
  }
}

export class SQLExecutionError extends Error {
  constructor(message: string, public code?: string) {
    super(message)
    this.name = 'SQLExecutionError'
  }
}

export class EmptyResultsError extends Error {
  constructor(message: string = 'Query returned no results') {
    super(message)
    this.name = 'EmptyResultsError'
  }
}

export class InsightGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsightGenerationError'
  }
}

/**
 * Get HTTP status code for error
 */
export function getStatusCodeForError(error: Error): number {
  if (error instanceof InputValidationError || error instanceof ContentFilterError) {
    return 400
  }
  if (error instanceof SQLValidationError) {
    return 422
  }
  if (error instanceof EmptyResultsError) {
    return 404
  }
  if (error instanceof SQLExecutionError || error instanceof InsightGenerationError) {
    return 500
  }
  return 500
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: Error): string {
  if (error instanceof InputValidationError) {
    return error.message
  }
  if (error instanceof ContentFilterError) {
    return error.message
  }
  if (error instanceof SQLValidationError) {
    return "I couldn't understand your request. Please try rephrasing your question."
  }
  if (error instanceof EmptyResultsError) {
    return "I couldn't find any data matching your request. Try adjusting your search criteria or asking a different question."
  }
  if (error instanceof SQLExecutionError) {
    return "I encountered an issue processing your request. Please try again or rephrase your question."
  }
  if (error instanceof InsightGenerationError) {
    return 'Failed to generate insight. The chart will still be displayed.'
  }
  return 'An unexpected error occurred. Please try again.'
}

