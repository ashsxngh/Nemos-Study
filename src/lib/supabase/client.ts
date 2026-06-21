'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !!(url && key && url.startsWith('https://') && !url.includes('your_supabase'))
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// ── Cached auth user id ─────────────────────────────────────────────────────
// auth.getUser() makes a network round-trip to the Supabase Auth server on
// every call (it revalidates the JWT server-side). The sync hook used to call
// it once per push — and a push fires on every debounced store change (every
// card review, every edit) — which was generating thousands of redundant auth
// requests per day. auth.getSession() reads the session from local storage
// instead (no network call, except a transparent refresh near token expiry),
// which is fine here since we're only reading our own already-trusted local
// session to attach a user_id, not authorizing a request from someone else.
let cachedUserId: string | null | undefined // undefined = not yet resolved
let authListenerAttached = false

export async function getCachedUserId(supabase: SupabaseClient): Promise<string | null> {
  if (!authListenerAttached) {
    authListenerAttached = true
    supabase.auth.onAuthStateChange((_event, session) => {
      cachedUserId = session?.user?.id ?? null
    })
  }
  if (cachedUserId === undefined) {
    const { data: { session } } = await supabase.auth.getSession()
    cachedUserId = session?.user?.id ?? null
  }
  return cachedUserId
}
