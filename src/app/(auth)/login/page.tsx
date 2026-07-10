'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

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
        {/* Logo */}
        <div className="flex flex-col items-center gap-4 mb-8">
          <div className="w-14 h-14 bg-[var(--accent)] rounded-[var(--radius-lg)] flex items-center justify-center shadow-lg shadow-[var(--accent)]/20">
            <BookOpen size={26} className="text-[var(--accent-fg)]" />
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Nemos Study</p>
            <p className="meta-label text-[var(--text-muted)] mt-1">Deep Focus Learning</p>
          </div>
        </div>

        <div className="card-surface rounded-[var(--radius-lg)] p-8">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="meta-label text-[var(--text-secondary)] block mb-1.5">Email Address</label>
              <Input
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="meta-label text-[var(--text-secondary)]">Password</label>
                <Link href="/forgot-password" className="font-mono text-[10px] text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors">
                  Forgot password?
                </Link>
              </div>
              <Input
                type="password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-xs text-[var(--danger)]">{error}</p>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
              Sign in
            </Button>
          </form>
        </div>

        <div className="mt-5 text-center">
          <span className="text-xs text-[var(--text-muted)]">New here? </span>
          <Link href="/signup" className="text-xs font-semibold text-[var(--accent)] hover:underline">Create an account</Link>
        </div>
      </div>
    </div>
  )
}
