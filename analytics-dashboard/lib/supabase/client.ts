import { createClient } from '@supabase/supabase-js'

// Lazy initialization to avoid errors during build
let supabaseClientInstance: ReturnType<typeof createClient> | null = null

export function getSupabaseClient() {
  if (typeof window === 'undefined') {
    throw new Error('Supabase client should only be used on the client side')
  }

  if (!supabaseClientInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }

    supabaseClientInstance = createClient(supabaseUrl, supabaseAnonKey)
  }
  return supabaseClientInstance
}

// Export for convenience (will throw if called during SSR, use getSupabaseClient() in components)
export const supabase = typeof window !== 'undefined' ? getSupabaseClient() : null as any

