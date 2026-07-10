'use client'

import { useState } from 'react'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } },
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
              We sent a confirmation link to
            </p>
            <p className="text-xs font-medium text-[var(--text-primary)] mb-4">{email}</p>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              Click it to activate your account.
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
          <h1 className="text-base font-semibold text-[var(--text-primary)] mb-1">Create your account</h1>
          <p className="text-xs text-[var(--text-muted)] mb-5">Start studying smarter &mdash; it&apos;s free</p>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <div>
              <label className="meta-label text-[var(--text-secondary)] block mb-1.5">Name</label>
              <Input
                placeholder="Your name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
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
            <div>
              <label className="meta-label text-[var(--text-secondary)] block mb-1.5">Password</label>
              <Input
                type="password"
                placeholder="Min. 8 characters"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-xs text-[var(--danger)]">{error}</p>
            )}
            <Button type="submit" variant="primary" size="md" className="w-full" loading={loading}>
              Create account
            </Button>
          </form>

          <div className="mt-4 text-center">
            <span className="text-xs text-[var(--text-muted)]">Already have an account? </span>
            <Link href="/login" className="text-xs text-[var(--accent)] hover:underline">Sign in</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
