'use client'

import { useState, useEffect } from 'react'
import { BookOpen, Zap, RotateCcw, Shuffle, Play, Search, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { Input } from '@/components/ui/Input'
import Link from 'next/link'
import { useLibraryStore } from '@/store/useLibraryStore'

const studyModes = [
  {
    id: 'standard',
    label: 'Standard Review',
    description: 'Due cards using spaced repetition',
    icon: BookOpen,
    color: 'text-[var(--accent)]',
    bg: 'bg-[var(--accent-subtle)]',
    href: '/study/session',
  },
  {
    id: 'cram',
    label: 'Exam Cram',
    description: 'Review everything regardless of due date',
    icon: Zap,
    color: 'text-yellow-400',
    bg: 'bg-yellow-950/30',
    href: '/study/session?mode=cram',
  },
  {
    id: 'failed',
    label: 'Failed Cards',
    description: 'Only cards you got wrong recently',
    icon: RotateCcw,
    color: 'text-[var(--danger)]',
    bg: 'bg-[var(--danger-subtle)]',
    href: '/study/session?mode=failed',
  },
  {
    id: 'random',
    label: 'Random Mix',
    description: 'Shuffled cards from all decks',
    icon: Shuffle,
    color: 'text-emerald-400',
    bg: 'bg-emerald-950/30',
    href: '/study/session?mode=random',
  },
]

export function StudyHub() {
  const { decks, cards, getDueCards, getDeckMastery } = useLibraryStore()
  const [search, setSearch] = useState('')
  const [goalTargets, setGoalTargets] = useState({ cards: 50, minutes: 30, accuracy: 85 })
  const [editingGoals, setEditingGoals] = useState(false)
  const { reviewLogs, sessions } = useLibraryStore()

  useEffect(() => {
    const saved = localStorage.getItem('nemos-study-goals-targets')
    if (saved) {
      try { setGoalTargets(JSON.parse(saved)) } catch {}
    }
  }, [])

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayLogs = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === todayStr)
  const todaySessions = sessions.filter((s) => s.endedAt && s.startedAt.slice(0, 10) === todayStr)
  const todayMinutes = Math.round(
    todaySessions.reduce((sum, s) => {
      if (!s.endedAt) return sum
      return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000
    }, 0)
  )
  const todayAccuracy =
    todayLogs.length > 0
      ? Math.round((todayLogs.filter((l) => l.rating >= 3).length / todayLogs.length) * 100)
      : 0

  const allDue = getDueCards().length

  // Decks with data
  const deckData = decks
    .filter((d) => !d.isArchived)
    .map((deck) => ({
      deck,
      dueCount: getDueCards(deck.id).length,
      totalCards: cards.filter((c) => c.deckId === deck.id).length,
      mastery: getDeckMastery(deck.id),
    }))
    .filter((d) => d.totalCards > 0)

  const filtered = deckData.filter((d) =>
    d.deck.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* Study modes */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
          Study Mode
          {allDue > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--accent)]">{allDue} cards due</span>
          )}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {studyModes.map(({ id, label, description, icon: Icon, color, bg, href }) => (
            <Link key={id} href={href}>
              <div className="text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] transition-colors cursor-pointer group h-full">
                <div className={`w-8 h-8 ${bg} rounded-[var(--radius-sm)] flex items-center justify-center mb-3`}>
                  <Icon size={15} className={color} />
                </div>
                <p className="text-sm font-medium text-[var(--text-primary)] mb-1">{label}</p>
                <p className="text-xs text-[var(--text-muted)]">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Deck picker */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Study by Deck</h2>
          <Input
            placeholder="Search decks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={12} />}
            className="w-44 h-7"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--text-muted)]">
            {search ? `No decks matching "${search}"` : 'No decks yet — create one in the Library.'}
          </div>
        ) : (
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
            {filtered.map(({ deck, dueCount, totalCards, mastery }) => (
              <div
                key={deck.id}
                className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group"
              >
                {/* Deck info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {deck.name}
                    </span>
                    {dueCount > 0 && (
                      <span className="text-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                        {dueCount} due
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Progress value={mastery} size="sm" className="w-24"
                      color={mastery >= 70 ? 'success' : mastery >= 40 ? 'accent' : 'danger'}
                    />
                    <span className="text-xs text-[var(--text-muted)]">{mastery}% mastery</span>
                    <span className="text-xs text-[var(--text-muted)]">{totalCards} cards</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {dueCount > 0 ? (
                    <Link href={`/study/session?deck=${deck.id}`}>
                      <Button variant="primary" size="sm" icon={<Play size={11} />}>
                        Review ({dueCount})
                      </Button>
                    </Link>
                  ) : (
                    <Link href={`/study/session?deck=${deck.id}&mode=cram`}>
                      <Button variant="ghost" size="sm" icon={<Play size={11} />}>
                        Cram
                      </Button>
                    </Link>
                  )}
                  <Link href="/library">
                    <button className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                      <ChevronRight size={14} />
                    </button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Goals */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Today&apos;s Goals</h2>
          <Button variant="ghost" size="xs" onClick={() => setEditingGoals(!editingGoals)}>
            {editingGoals ? 'Done' : 'Edit'}
          </Button>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
          <div className="grid grid-cols-3 gap-6">
            {[
              { label: 'Cards reviewed', current: todayLogs.length, target: goalTargets.cards, unit: 'cards', key: 'cards' as const },
              { label: 'Study time', current: todayMinutes, target: goalTargets.minutes, unit: 'min', key: 'minutes' as const },
              { label: 'Accuracy', current: todayAccuracy, target: goalTargets.accuracy, unit: '%', key: 'accuracy' as const },
            ].map(({ label, current, target, unit, key }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[var(--text-muted)]">{label}</span>
                  {editingGoals ? (
                    <input
                      type="number"
                      value={target}
                      onChange={(e) => {
                        const updated = { ...goalTargets, [key]: Number(e.target.value) }
                        setGoalTargets(updated)
                        localStorage.setItem('nemos-study-goals-targets', JSON.stringify(updated))
                      }}
                      className="w-14 text-xs text-right bg-[var(--bg-active)] border border-[var(--border)] rounded px-1 py-0.5 text-[var(--text-primary)] outline-none"
                    />
                  ) : (
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {current}/{target} {unit}
                    </span>
                  )}
                </div>
                <Progress
                  value={current}
                  max={target}
                  size="sm"
                  color={current >= target ? 'success' : 'accent'}
                />
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
