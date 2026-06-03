'use client'

import { useState, useEffect } from 'react'
import { Zap, RotateCcw, Shuffle, Play, Search, ChevronRight, Inbox, Sparkles, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { Input } from '@/components/ui/Input'
import Link from 'next/link'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'

export function StudyHub() {
  const { decks, cards, getNewCards, getReviewsDue, getDeckMastery } = useLibraryStore()
  const { newCardsPerDay } = useSettingsStore()
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

  const allNewCards = getNewCards()
  const allReviews = getReviewsDue()
  const inboxTotal = allNewCards.length + allReviews.length

  // Decks with data
  const deckData = decks
    .filter((d) => !d.isArchived)
    .map((deck) => ({
      deck,
      newCount: getNewCards(deck.id).length,
      reviewCount: getReviewsDue(deck.id).length,
      totalCards: cards.filter((c) => c.deckId === deck.id).length,
      mastery: getDeckMastery(deck.id),
    }))
    .filter((d) => d.totalCards > 0)

  const filtered = deckData.filter((d) =>
    d.deck.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Today's Queue ─────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Today&apos;s Queue</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">

          {/* Inbox */}
          <Link href="/study/session" className="col-span-1 sm:col-span-1">
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors cursor-pointer group h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-[var(--accent-subtle)] rounded-[var(--radius-sm)] flex items-center justify-center">
                  <Inbox size={15} className="text-[var(--accent)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Inbox</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 flex-1">
                Today&apos;s blend of new cards and due reviews
              </p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  {allNewCards.length > 0 && (
                    <span className="text-[var(--accent)]">{allNewCards.length} new</span>
                  )}
                  {allNewCards.length > 0 && allReviews.length > 0 && (
                    <span>·</span>
                  )}
                  {allReviews.length > 0 && (
                    <span>{allReviews.length} review</span>
                  )}
                  {inboxTotal === 0 && <span>All caught up</span>}
                </div>
                {inboxTotal > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--accent)]">
                    <Play size={9} /> Start
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* New Cards */}
          <Link href="/study/session?mode=new">
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-[var(--accent-subtle)] rounded-[var(--radius-sm)] flex items-center justify-center">
                  <Sparkles size={15} className="text-[var(--accent)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">New Cards</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 flex-1">
                Cards to learn for the first time
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {allNewCards.length} / {newCardsPerDay} today
                </span>
                {allNewCards.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)]">
                    <Play size={9} /> Learn
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Reviews */}
          <Link href="/study/session?mode=reviews">
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer group h-full flex flex-col">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 bg-[var(--success-subtle)] rounded-[var(--radius-sm)] flex items-center justify-center">
                  <RefreshCw size={15} className="text-[var(--success)]" />
                </div>
                <span className="text-sm font-semibold text-[var(--text-primary)]">Reviews</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 flex-1">
                Learned cards due for review today
              </p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">
                  {allReviews.length} due
                </span>
                {allReviews.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-[var(--text-muted)]">
                    <Play size={9} /> Review
                  </span>
                )}
              </div>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Other Modes ───────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Other Modes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link href="/study/session?mode=cram">
            <div className="text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] transition-colors cursor-pointer h-full">
              <div className="w-8 h-8 bg-yellow-950/30 rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                <Zap size={15} className="text-yellow-400" />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Exam Cram</p>
              <p className="text-xs text-[var(--text-muted)]">Review everything regardless of due date</p>
            </div>
          </Link>
          <Link href="/study/session?mode=failed">
            <div className="text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] transition-colors cursor-pointer h-full">
              <div className="w-8 h-8 bg-[var(--danger-subtle)] rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                <RotateCcw size={15} className="text-[var(--danger)]" />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Failed Cards</p>
              <p className="text-xs text-[var(--text-muted)]">Only cards you got wrong recently</p>
            </div>
          </Link>
          <Link href="/study/session?mode=random">
            <div className="text-left bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 hover:border-[var(--border-strong)] transition-colors cursor-pointer h-full">
              <div className="w-8 h-8 bg-emerald-950/30 rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                <Shuffle size={15} className="text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-[var(--text-primary)] mb-1">Random Mix</p>
              <p className="text-xs text-[var(--text-muted)]">Shuffled cards from all decks</p>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Study by Deck ─────────────────────────────────────── */}
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
            {filtered.map(({ deck, newCount, reviewCount, totalCards, mastery }) => {
              const dueTotal = newCount + reviewCount
              return (
                <div
                  key={deck.id}
                  className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {deck.name}
                      </span>
                      {newCount > 0 && (
                        <span className="text-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                          {newCount} new
                        </span>
                      )}
                      {reviewCount > 0 && (
                        <span className="text-[10px] bg-[var(--success-subtle)] text-[var(--success)] font-semibold rounded-full px-1.5 py-0.5 shrink-0">
                          {reviewCount} due
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

                  <div className="flex items-center gap-2 shrink-0">
                    {dueTotal > 0 ? (
                      <Link href={`/study/session?deck=${deck.id}`}>
                        <Button variant="primary" size="sm" icon={<Play size={11} />}>
                          Study ({dueTotal})
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
              )
            })}
          </div>
        )}
      </section>

      {/* ── Today's Goals ─────────────────────────────────────── */}
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
