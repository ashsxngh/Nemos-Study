'use client'

import { BookOpen, Clock } from 'lucide-react'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { formatRelativeTime } from '@/lib/utils'

export function RecentActivity() {
  const decks = useLibraryStore((s) => s.decks)
  const sessions = useHistoryStore((s) => s.sessions)

  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 6)

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
        <Clock size={13} className="text-[var(--text-muted)]" />
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">Recent Activity</h2>
      </div>

      {recentSessions.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          No activity yet — start a study session!
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {recentSessions.map((session) => {
            const deck = decks.find((d) => d.id === session.deckId)
            const accuracy = session.cardsReviewed > 0
              ? Math.round((session.cardsCorrect / session.cardsReviewed) * 100)
              : 0
            return (
              <div key={session.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors">
                <div className="w-6 h-6 bg-[var(--bg-active)] rounded-full flex items-center justify-center shrink-0">
                  <BookOpen size={12} className="text-[var(--text-muted)]" />
                </div>
                <span className="flex-1 text-xs text-[var(--text-secondary)] truncate">
                  Reviewed {session.cardsReviewed} cards{deck ? ` in ${deck.name}` : ''}
                  {session.cardsReviewed > 0 && ` · ${accuracy}% accuracy`}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                  {formatRelativeTime(session.startedAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
