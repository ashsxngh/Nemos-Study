'use client'

import { useEffect, useState } from 'react'
import { Bell, Sun, Moon, User, WifiOff, CheckCircle2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/useAppStore'
import { Tooltip } from '@/components/ui/Tooltip'
import { AnchoredMenu } from '@/components/ui/Menu'
import { createClient, isSupabaseConfigured } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface HeaderProps {
  title?: string
  actions?: React.ReactNode
  breadcrumbs?: React.ReactNode
}

export function Header({ title, actions, breadcrumbs }: HeaderProps) {
  const { theme, setTheme, syncError, manualSync } = useAppStore(
    useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme, syncError: s.syncError, manualSync: s.manualSync }))
  )
  const isDark = theme === 'dark'
  const router = useRouter()

  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) return
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserEmail(session?.user?.email ?? null)
    })
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
    <header className="flex items-center h-16 px-6 bg-[var(--bg-base)]/80 backdrop-blur-md shrink-0 gap-4 z-40">
      <div className="flex-1 min-w-0 flex items-center gap-4">
        {breadcrumbs ?? (
          title && (
            <h1 className="text-[24px] leading-tight font-semibold text-[var(--text-primary)] truncate tracking-tight">{title}</h1>
          )
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}

        {syncError && (
          <Tooltip content="Sync failed — click to retry" side="bottom">
            <button onClick={() => manualSync?.()} className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-[var(--danger-subtle)] transition-colors">
              <WifiOff size={16} className="text-[var(--danger)]" aria-label="Sync error" />
            </button>
          </Tooltip>
        )}

        <Tooltip content={isDark ? 'Light mode' : 'Dark mode'} shortcut={['⌘', '⇧', 'L']}>
          <button
            onClick={() => setTheme(isDark ? 'light' : 'dark')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
          >
            {isDark ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          </button>
        </Tooltip>

        {/* Notifications */}
        <AnchoredMenu
          panelClassName="w-72 rounded-[var(--radius-lg)] shadow-xl"
          trigger={({ onClick }) => (
            <Tooltip content="Notifications">
              <button
                onClick={onClick}
                className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors relative"
              >
                <Bell size={17} strokeWidth={1.75} />
                {notifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
                )}
              </button>
            </Tooltip>
          )}
          panel={() => (
            <>
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
            </>
          )}
        />

        {/* Account */}
        <AnchoredMenu
          panelClassName="w-52 rounded-[var(--radius-lg)]"
          trigger={({ onClick }) => (
            <button
              onClick={onClick}
              className="w-9 h-9 rounded-full bg-[var(--bg-active)] border-2 border-[var(--accent-subtle)] flex items-center justify-center hover:border-[var(--accent)] transition-colors"
              aria-label="Account menu"
            >
              <User size={15} className="text-[var(--text-secondary)]" />
            </button>
          )}
          panel={() => (
            <>
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
            </>
          )}
        />
      </div>
    </header>
  )
}
