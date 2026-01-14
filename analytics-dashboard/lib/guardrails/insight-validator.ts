import type { ValidationResult } from '@/lib/types'

const INappropriatePatterns = [
  /<script/i,
  /javascript:/i,
  /onerror=/i,
  /onload=/i,
  /<iframe/i,
  /<img[^>]+src\s*=\s*["']?javascript:/i,
]

const GENERIC_PHRASES = [
  /^(the data shows|this chart|the information|as you can see)$/i,
  /^(this is|it is|there are)$/i,
]

export async function validateInsight(insight: string): Promise<ValidationResult> {
  if (!insight || insight.trim().length === 0) {
    return {
      valid: false,
      reason: 'Insight is empty',
    }
  }

  // Length check (2-3 sentences should be reasonable)
  if (insight.length < 20) {
    return {
      valid: false,
      reason: 'Insight is too short. It should be 2-3 sentences.',
    }
  }

  if (insight.length > 500) {
    return {
      valid: false,
      reason: 'Insight is too long. Maximum length is 500 characters.',
    }
  }

  // XSS/Security checks
  for (const pattern of INappropriatePatterns) {
    if (pattern.test(insight)) {
      return {
        valid: false,
        reason: 'Insight contains potentially dangerous content.',
      }
    }
  }

  
  const isTooGeneric = GENERIC_PHRASES.some(pattern => pattern.test(insight.trim()))
  if (isTooGeneric && insight.split(/[.!?]/).length < 2) {
    return {
      valid: false,
      reason: 'Insight is too generic. Please provide more specific analysis.',
    }
  }

  return { valid: true }
}

