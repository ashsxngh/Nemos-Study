'use client'

import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return !!(url && key && url.startsWith('https://') && !url.includes('your_supabase'))
}

/**
 * Message shown when the app was built without Supabase credentials.
 *
 * These are inlined by Next.js at BUILD time, not read at runtime — so a
 * deployed bundle missing them cannot be repaired from the browser. This is
 * what shipped to GitHub Pages when the Actions workflow had no `env:` block
 * on its build step; `createBrowserClient` threw an opaque library error and
 * callers hung forever awaiting a promise that had already rejected.
 */
export const SUPABASE_NOT_CONFIGURED_MESSAGE =
  'This build has no Supabase credentials, so account features are unavailable. ' +
  'Your data is still saved on this device.'

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE)
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

/**
 * Absolute URL for an in-app path, including the deployment's base path.
 *
 * Needed anywhere a URL leaves the app and comes back — Supabase's
 * `redirectTo`, for instance. `window.location.origin` alone drops the
 * `/Nemos-Study` subpath and lands the user on the GitHub Pages root, which
 * 404s. Next rewrites <Link>/router paths for us, but not strings we hand to
 * third parties.
 */
export function siteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${base}${suffix}`
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      cachedUserId = session?.user?.id ?? null
    } catch (err) {
      // getSession() transparently refreshes a near-expired token; that refresh
      // is a real network call and can fail (offline, Supabase unreachable).
      // Leave cachedUserId as undefined so the next call retries, and treat
      // this call as "not authenticated yet" rather than throwing — callers
      // all already handle a null user id by skipping the push/pull.
      console.error('[SYNC] getCachedUserId: getSession failed', err)
      return null
    }
  }
  return cachedUserId
}
