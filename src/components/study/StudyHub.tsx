'use client'

import { useState, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Zap, RotateCcw, Shuffle, Play, Search, ChevronRight,
  Inbox, Sparkles, RefreshCw, Target, Flame, BookOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { Input } from '@/components/ui/Input'
import Link from 'next/link'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { cn } from '@/lib/utils'
import { toLocalDateStr } from '@/lib/formatDate'

export function StudyHub() {
  const { decks, cards, fsrsData, getNewCards, getReviewsDue, getDeckMastery } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      cards: s.cards,
      fsrsData: s.fsrsData,
      getNewCards: s.getNewCards,
      getReviewsDue: s.getReviewsDue,
      getDeckMastery: s.getDeckMastery,
    }))
  )
  const { reviewLogs, sessions } = useHistoryStore(
    useShallow((s) => ({ reviewLogs: s.reviewLogs, sessions: s.sessions }))
  )
  const newCardsPerDay = useSettingsStore((s) => s.newCardsPerDay)
  const [search, setSearch] = useState('')
  const [goalTargets, setGoalTargets] = useState({ cards: 50, minutes: 30, accuracy: 85 })
  const [editingGoals, setEditingGoals] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('nemos-study-goals-targets')
    if (saved) { try { setGoalTargets(JSON.parse(saved)) } catch {} }
  }, [])

  const todayStr = toLocalDateStr(new Date())
  const todayLogs = reviewLogs.filter((l) => toLocalDateStr(new Date(l.reviewedAt)) === todayStr)
  const todaySessions = sessions.filter((s) => s.endedAt && toLocalDateStr(new Date(s.startedAt)) === todayStr)
  const todayMinutes = Math.round(
    todaySessions.reduce((sum, s) => {
      if (!s.endedAt) return sum
      return sum + (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 60000
    }, 0)
  )
  const todayReviewLogs = todayLogs.filter((l) => !l.wasNew)
  const todayAccuracy = todayReviewLogs.length > 0
    ? Math.round((todayReviewLogs.filter((l) => l.rating >= 2).length / todayReviewLogs.length) * 100)
    : 0

  const allNewCards = useMemo(
    () => getNewCards(),
    [cards, decks, fsrsData, reviewLogs, newCardsPerDay, getNewCards]
  )
  const allReviews = useMemo(
    () => getReviewsDue(),
    [cards, decks, fsrsData, getReviewsDue]
  )
  const inboxTotal = allNewCards.length + allReviews.length

  const deckData = useMemo(
    () =>
      decks
        .filter((d) => !d.isArchived)
        .map((deck) => ({
          deck,
          newCount: getNewCards(deck.id).length,
          reviewCount: getReviewsDue(deck.id).length,
          totalCards: cards.filter((c) => c.deckId === deck.id).length,
          mastery: getDeckMastery(deck.id),
        }))
        .filter((d) => d.totalCards > 0),
    [decks, cards, fsrsData, reviewLogs, newCardsPerDay, getNewCards, getReviewsDue, getDeckMastery]
  )

  const filtered = deckData.filter((d) =>
    d.deck.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-4xl mx-auto space-y-8">

      {/* ── Today's Queue ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="meta-label text-[var(--text-secondary)]">Today&apos;s Queue</h2>
          {inboxTotal > 0 && (
            <span className="font-mono text-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] font-bold rounded-full px-2 py-0.5">
              {inboxTotal} cards
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {/* Inbox */}
          <Link href="/study/inbox" className="group">
            <div className={cn(
              'rounded-[var(--radius-lg)] p-6 border transition-all duration-200 h-full flex flex-col cursor-pointer',
              'bg-[var(--bg-surface)] border-[var(--border)]',
              inboxTotal > 0
                ? 'hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]'
                : 'hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
            )}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className={cn(
                  'w-12 h-12 rounded-[var(--radius)] flex items-center justify-center shrink-0',
                  inboxTotal > 0 ? 'bg-[var(--accent-subtle)]' : 'bg-[var(--bg-hover)]'
                )}>
                  <Inbox size={20} className={inboxTotal > 0 ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                </div>
                <span className="text-[17px] font-semibold text-[var(--text-primary)]">Inbox</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4 flex-1">Today&apos;s blend of new cards and due reviews</p>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  {allNewCards.length > 0 && <span className="text-[var(--accent)]">{allNewCards.length} new</span>}
                  {allNewCards.length > 0 && allReviews.length > 0 && <span>·</span>}
                  {allReviews.length > 0 && <span>{allReviews.length} due</span>}
                  {inboxTotal === 0 && <span className="text-[var(--success)]">All done</span>}
                </div>
                {inboxTotal > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play size={9} /> Start
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* New Cards */}
          <Link href="/study/new" className="group">
            <div className="rounded-[var(--radius-lg)] p-6 border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all duration-200 h-full flex flex-col cursor-pointer">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-12 h-12 rounded-[var(--radius)] bg-[var(--accent-subtle)] flex items-center justify-center shrink-0">
                  <Sparkles size={20} className="text-[var(--accent)]" />
                </div>
                <span className="text-[17px] font-semibold text-[var(--text-primary)]">New Cards</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4 flex-1">Cards to learn for the first time</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">{allNewCards.length} / {newCardsPerDay} today</span>
                {allNewCards.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                    <Play size={9} /> Learn
                  </span>
                )}
              </div>
            </div>
          </Link>

          {/* Reviews */}
          <Link href="/study/reviews" className="group">
            <div className="rounded-[var(--radius-lg)] p-6 border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all duration-200 h-full flex flex-col cursor-pointer">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-12 h-12 rounded-[var(--radius)] bg-[var(--success-subtle)] flex items-center justify-center shrink-0">
                  <RefreshCw size={20} className="text-[var(--success)]" />
                </div>
                <span className="text-[17px] font-semibold text-[var(--text-primary)]">Reviews</span>
              </div>
              <p className="text-sm text-[var(--text-secondary)] mb-4 flex-1">Learned cards due for review today</p>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">{allReviews.length} due</span>
                {allReviews.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
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
        <h2 className="meta-label text-[var(--text-secondary)] mb-4">Other Modes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <Link href="/study/session?mode=cram">
            <div className="rounded-[var(--radius-lg)] p-6 border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all duration-200 cursor-pointer h-full">
              <div className="w-12 h-12 rounded-[var(--radius)] bg-[var(--warning-subtle)] flex items-center justify-center mb-4">
                <Zap size={20} className="text-[var(--warning)]" />
              </div>
              <p className="text-[17px] font-semibold text-[var(--text-primary)] mb-1">Exam Cram</p>
              <p className="text-sm text-[var(--text-secondary)]">Review everything regardless of due date</p>
            </div>
          </Link>
          <Link href="/study/session?mode=failed">
            <div className="rounded-[var(--radius-lg)] p-6 border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all duration-200 cursor-pointer h-full">
              <div className="w-12 h-12 rounded-[var(--radius)] bg-[var(--danger-subtle)] flex items-center justify-center mb-4">
                <RotateCcw size={20} className="text-[var(--danger)]" />
              </div>
              <p className="text-[17px] font-semibold text-[var(--text-primary)] mb-1">Failed Cards</p>
              <p className="text-sm text-[var(--text-secondary)]">Only cards you got wrong recently</p>
            </div>
          </Link>
          <Link href="/study/session?mode=random">
            <div className="rounded-[var(--radius-lg)] p-6 border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] transition-all duration-200 cursor-pointer h-full">
              <div className="w-12 h-12 rounded-[var(--radius)] bg-[var(--success-subtle)] flex items-center justify-center mb-4">
                <Shuffle size={20} className="text-[var(--success)]" />
              </div>
              <p className="text-[17px] font-semibold text-[var(--text-primary)] mb-1">Random Mix</p>
              <p className="text-sm text-[var(--text-secondary)]">Shuffled cards from all decks</p>
            </div>
          </Link>
        </div>
      </section>

      {/* ── Study by Deck ─────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="meta-label text-[var(--text-secondary)]">Study by Deck</h2>
          <Input placeholder="Search decks…" value={search} onChange={(e) => setSearch(e.target.value)} icon={<Search size={12} />} className="w-56 !h-9" />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-10 text-sm text-[var(--text-muted)]">
            {search ? `No decks matching "${search}"` : 'No decks yet — create one in the Library.'}
          </div>
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] divide-y divide-[var(--border)] overflow-hidden">
            {filtered.map(({ deck, newCount, reviewCount, totalCards, mastery }) => {
              const dueTotal = newCount + reviewCount
              return (
                <div key={deck.id} className="flex items-center gap-4 px-6 py-4 hover:bg-[var(--bg-hover)] transition-colors group">
                  <div className="w-10 h-10 rounded-[var(--radius)] bg-[var(--bg-active)] flex items-center justify-center shrink-0">
                    <BookOpen size={16} className="text-[var(--text-muted)]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[15px] font-medium text-[var(--text-primary)] truncate">{deck.name}</span>
                      {newCount > 0 && (
                        <span className="font-mono text-[10px] bg-[var(--accent-subtle)] text-[var(--accent)] font-bold rounded-[var(--radius-sm)] px-1.5 py-0.5 shrink-0">{newCount} new</span>
                      )}
                      {reviewCount > 0 && (
                        <span className="font-mono text-[10px] bg-[var(--success-subtle)] text-[var(--success)] font-bold rounded-[var(--radius-sm)] px-1.5 py-0.5 shrink-0">{reviewCount} due</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <Progress value={mastery} size="sm" className="w-20" color={mastery >= 70 ? 'success' : mastery >= 40 ? 'accent' : 'danger'} />
                      <span className="text-xs text-[var(--text-muted)]">{mastery}%</span>
                      <span className="text-xs text-[var(--text-muted)]">{totalCards} cards</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {dueTotal > 0 ? (
                      <Link href={`/study/session?deck=${deck.id}`}>
                        <Button variant="primary" size="sm" icon={<Play size={11} />}>Study ({dueTotal})</Button>
                      </Link>
                    ) : (
                      <Link href={`/study/session?deck=${deck.id}&mode=cram`}>
                        <Button variant="ghost" size="sm" icon={<Play size={11} />}>Cram</Button>
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="meta-label text-[var(--text-secondary)]">Today&apos;s Goals</h2>
          <Button variant="ghost" size="xs" onClick={() => setEditingGoals(!editingGoals)}>
            {editingGoals ? 'Done' : 'Edit'}
          </Button>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--bg-surface)] p-8">
          <div className="grid grid-cols-3 gap-6">
            {[
              // Deliberately counts all cards studied today (new + reviews) —
              // it's a daily volume goal, so the label says "studied", not
              // "reviewed" (which elsewhere means repeat reviews only).
              { label: 'Cards studied', current: todayLogs.length, target: goalTargets.cards, unit: 'cards', key: 'cards' as const, icon: Target },
              { label: 'Study time',     current: todayMinutes,     target: goalTargets.minutes, unit: 'min', key: 'minutes' as const, icon: Flame },
              { label: 'Accuracy',       current: todayAccuracy,    target: goalTargets.accuracy, unit: '%', key: 'accuracy' as const, icon: Sparkles },
            ].map(({ label, current, target, unit, key, icon: Icon }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Icon size={11} className="text-[var(--text-muted)]" />
                    <span className="text-xs text-[var(--text-muted)]">{label}</span>
                  </div>
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
                    <span className="text-xs font-semibold text-[var(--text-primary)]">{current}/{target} {unit}</span>
                  )}
                </div>
                <Progress value={current} max={target} size="sm" color={current >= target ? 'success' : 'accent'} />
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  )
}
