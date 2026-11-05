import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

// The anon/publishable key is safe in the browser; Row-Level Security enforces access.
// PKCE keeps sign-in tokens out of the URL hash, which matters on a static host.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anonKey!, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    })
  : null

export function client(): SupabaseClient {
  if (!supabase) throw new Error('The app is not connected to its backend yet.')
  return supabase
}

/** Where sign-in emails and Google should send people back to. */
export function appUrl(path = ''): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`
}
