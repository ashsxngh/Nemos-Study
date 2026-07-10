'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    } else {
      setSuccess(true)
    }
  }

  if (success) {
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

          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-8 text-center">
            <h1 className="text-base font-semibold text-[var(--text-primary)] mb-2">Check your email!</h1>
            <p className="text-xs text-[var(--text-muted)] mb-1">
              If an account exists for
            </p>
            <p className="text-xs font-medium text-[var(--text-primary)] mb-4">{email}</p>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              we sent a link to reset your password.
            </p>
            <Link href="/login" className="text-xs text-[var(--accent)] hover:underline">
              Back to login
            </Link>
          </div>
        </div>
      </div>
    )
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
          <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">Reset your password</h1>
          <p className="text-xs text-[var(--text-muted)] mb-5">
            Enter your email and we&apos;ll send you a link to reset it
          </p>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="meta-label text-[var(--text-secondary)] block mb-1.5">Email</label>
              <Input
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-xs text-[var(--danger)]">{error}</p>
            )}
            <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
              Send reset link
            </Button>
          </form>

          <div className="mt-4 text-center">
            <Link href="/login" className="text-xs text-[var(--accent)] hover:underline">Back to login</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
