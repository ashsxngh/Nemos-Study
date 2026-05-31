'use client'

import { useEffect, useRef, useState } from 'react'
import { Bell, Sun, Moon, User, RefreshCw, WifiOff, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAppStore } from '@/store/useAppStore'
import { useSync } from '@/hooks/useSync'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface HeaderProps {
  title?: string
  actions?: React.ReactNode
  breadcrumbs?: React.ReactNode
}

export function Header({ title, actions, breadcrumbs }: HeaderProps) {
  const { theme, setTheme, toasts } = useAppStore()
  const { syncing, error: syncError } = useSync()
  const isDark = theme === 'dark'
  const router = useRouter()

  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserEmail(user?.email ?? null)
    })
  }, [])

  // Close dropdowns on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  async function handleSignOut() {
    if (isSupabaseConfigured()) {
      const supabase = createClient()
      await supabase.auth.signOut()
    }
    router.push('/login')
    router.refresh()
  }

  // Placeholder notifications — will be real once Supabase is wired
  const notifications: { id: string; message: string; time: string }[] = []

  return (
    <header className="flex items-center h-11 px-4 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0 gap-3">
      <div className="flex-1 min-w-0">
        {breadcrumbs ?? (
          title && (
            <h1 className="text-sm font-semibold text-[var(--text-primary)] truncate">{title}</h1>
          )
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {actions}

        {syncing && (
          <RefreshCw size={12} className="animate-spin text-[var(--accent)] shrink-0" aria-label="Syncing" />
        )}
        {!syncing && syncError && (
          <Tooltip content="Sync error">
            <WifiOff size={12} className="text-[var(--danger)] shrink-0" aria-label="Sync error" />
          </Tooltip>
        )}

        <Tooltip content={isDark ? 'Light mode' : 'Dark mode'} shortcut={['⌘', '⇧', 'L']}>
          <Button variant="ghost" size="sm" onClick={() => setTheme(isDark ? 'light' : 'dark')} className="w-7 px-0">
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </Button>
        </Tooltip>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <Tooltip content="Notifications">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="w-7 h-7 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors relative"
            >
              <Bell size={14} />
              {notifications.length > 0 && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
              )}
            </button>
          </Tooltip>

          {notifOpen && (
            <div className="absolute right-0 top-9 w-72 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl z-50 overflow-hidden animate-scale-in">
              <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--border)]">
                <span className="text-xs font-semibold text-[var(--text-primary)]">Notifications</span>
                {notifications.length > 0 && (
                  <button className="text-[10px] text-[var(--accent)] hover:underline">Mark all read</button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <CheckCircle2 size={22} className="text-[var(--text-muted)]" />
                  <p className="text-xs text-[var(--text-secondary)] font-medium">You&apos;re all caught up</p>
                  <p className="text-[10px] text-[var(--text-muted)]">No notifications right now</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)] max-h-72 overflow-y-auto">
                  {notifications.map((n) => (
                    <div key={n.id} className="px-3 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                      <p className="text-xs text-[var(--text-primary)]">{n.message}</p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{n.time}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Account */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="w-6 h-6 rounded-full bg-[var(--bg-active)] flex items-center justify-center hover:bg-[var(--border)] transition-colors"
            aria-label="Account menu"
          >
            <User size={12} className="text-[var(--text-secondary)]" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-8 w-52 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-lg z-50 overflow-hidden animate-scale-in">
              {userEmail && (
                <div className="px-3 py-2 border-b border-[var(--border)]">
                  <p className="text-xs text-[var(--text-muted)] truncate">{userEmail}</p>
                </div>
              )}
              <button
                onClick={handleSignOut}
                className={cn(
                  'w-full text-left px-3 py-2 text-xs text-[var(--text-secondary)]',
                  'hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors'
                )}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
