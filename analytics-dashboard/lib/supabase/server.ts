import { createClient } from '@supabase/supabase-js'

// Lazy initialization to avoid errors during build
let supabaseServerInstance: ReturnType<typeof createClient> | null = null

export function getSupabaseServer() {
  if (!supabaseServerInstance) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    // Use service role key for server-side if available, otherwise use anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY')
    }

    // Server-side client with service role key (bypasses RLS) or anon key
    supabaseServerInstance = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  }
  return supabaseServerInstance
}

// Don't export instance - use getSupabaseServer() instead to avoid build-time errors

