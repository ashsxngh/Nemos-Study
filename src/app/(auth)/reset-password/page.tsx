'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [validLink, setValidLink] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // The emailed link exchanges its recovery code for a session automatically
  // (createBrowserClient defaults to detectSessionInUrl: true) — by the time
  // this effect runs that exchange has usually already completed, but the
  // PASSWORD_RECOVERY event covers the case where it resolves just after.
  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setValidLink(true)
        setReady(true)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setValidLink(true)
        setReady(true)
      }
    })

    const timeout = setTimeout(() => setReady(true), 2500)

    return () => {
      listener.subscription.unsubscribe()
      clearTimeout(timeout)
    }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.updateUser({ password })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-[var(--accent)] rounded-[var(--radius-lg)] flex items-center justify-center">
            <BookOpen size={22} className="text-[var(--accent-fg)]" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-[var(--text-primary)] tracking-tight">Nemos Study</p>
            <p className="meta-label text-[var(--text-muted)] mt-0.5">Deep Focus Learning</p>
          </div>
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-8">
          {!ready ? (
            <p className="text-xs text-[var(--text-muted)] text-center py-4">Verifying link…</p>
          ) : !validLink ? (
            <div className="text-center space-y-3">
              <h1 className="text-base font-semibold text-[var(--text-primary)]">Link expired</h1>
              <p className="text-xs text-[var(--text-muted)]">
                This password reset link is invalid or has expired.
              </p>
              <Link href="/forgot-password" className="text-xs text-[var(--accent)] hover:underline block">
                Request a new link
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">Set a new password</h1>
              <p className="text-xs text-[var(--text-muted)] mb-5">Choose a new password for your account</p>

              <form className="space-y-3" onSubmit={handleSubmit}>
                <div>
                  <label className="meta-label text-[var(--text-secondary)] block mb-1.5">New password</label>
                  <Input
                    type="password"
                    placeholder="Min. 8 characters"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div>
                  <label className="meta-label text-[var(--text-secondary)] block mb-1.5">Confirm password</label>
                  <Input
                    type="password"
                    placeholder="Re-enter password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-xs text-[var(--danger)]">{error}</p>
                )}
                <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
                  Reset password
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
