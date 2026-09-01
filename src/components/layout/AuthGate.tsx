'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'

/**
 * Client-side route protection for the authenticated `(app)` routes.
 *
 * This replaces the old `src/proxy.ts` (Next 16's renamed middleware), which
 * gated these routes server-side. GitHub Pages is static hosting — no Node
 * server runs, so a proxy/middleware file is never executed and every route
 * would otherwise be wide open. The auth check has to happen in the browser.
 *
 * Semantics are carried over from that proxy verbatim:
 *  - Supabase not configured  → let everyone through (local-only mode).
 *  - No session               → send to /login.
 *  - Session                  → render the app.
 *
 * The `/login`, `/signup`, `/forgot-password` and `/reset-password` pages live
 * in the separate `(auth)` route group and are not wrapped by this gate, so
 * they stay reachable exactly as they did before.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  // `undefined` = still resolving. Supabase reads the session from localStorage,
  // so this settles without a network round-trip in the common case.
  const [authed, setAuthed] = useState<boolean | undefined>(
    isSupabaseConfigured() ? undefined : true
  )

  useEffect(() => {
    if (!isSupabaseConfigured()) return

    let active = true
    const supabase = createClient()

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!active) return
        if (session) {
          setAuthed(true)
        } else {
          setAuthed(false)
          router.replace('/login')
        }
      })
      .catch(() => {
        // getSession() can reject when a near-expired token refresh fails
        // (offline, Supabase unreachable). Don't lock a local-first user out of
        // their own on-device data over a network blip — fail open, exactly as
        // the rest of the app does when sync is unavailable.
        if (active) setAuthed(true)
      })

    // Keeps the gate live: signing out in this tab (or another one, since
    // Supabase mirrors auth state across tabs via storage events) bounces to
    // /login instead of leaving a stale authenticated shell on screen.
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === 'SIGNED_OUT' || !session) {
        setAuthed(false)
        router.replace('/login')
      } else {
        setAuthed(true)
      }
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [router])

  if (authed === undefined) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center">
        <p className="text-xs text-[var(--text-muted)]">Loading…</p>
      </div>
    )
  }

  // Redirect already dispatched; render nothing rather than flashing the app.
  if (!authed) return null

  return <>{children}</>
}
