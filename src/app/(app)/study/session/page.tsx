'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Shuffle,
  MoreHorizontal,
  ChevronDown,
  Undo2,
} from 'lucide-react'
import { useStudyStore } from '@/store/useStudyStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import { ReviewCard } from '@/components/study/ReviewCard'
import { ConfidenceRating } from '@/components/study/ConfidenceRating'
import { Progress } from '@/components/ui/Progress'
import { cn, formatDuration } from '@/lib/utils'
import type { Difficulty } from '@/lib/types'

/* ─────────────────────────────────────────────────────────── */
/* Colour tokens for focus-mode dark theme                     */
/* ─────────────────────────────────────────────────────────── */
// bg:        #131315
// card bg:   #1c1c1f
// card btm:  #161618
// border:    #2a2a30
// text:      #e8e8ea
// muted:     #6b6b72

function SessionContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const deckId = searchParams.get('deck') ?? undefined
  const modeParam = searchParams.get('mode')

  const {
    queue,
    currentIndex,
    showAnswer,
    logs,
    startedAt,
    mode,
    startSession,
    flipCard,
    nextCard,
    addLog,
    reset,
    undoStack,
    pushUndo,
    popUndo,
    decrementIndex,
  } = useStudyStore()

  const { getDueCards, reviewCard, decks } = useLibraryStore()

  const cardShownAtRef = useRef<number>(Date.now())

  /* History for ← back navigation */
  const [history, setHistory] = useState<number[]>([])
  const [showMoreRatings, setShowMoreRatings] = useState(false)
  const [loaded, setLoaded] = useState(false)

  /* Resolve mode */
  const resolvedMode = (() => {
    if (modeParam === 'cram') return 'cram' as const
    if (modeParam === 'random') return 'random' as const
    if (modeParam === 'failed') return 'failed-only' as const
    return 'standard' as const
  })()

  /* Resolve deck name */
  const deckName = deckId
    ? (decks.find((d) => d.id === deckId)?.name ?? 'Deck')
    : 'All cards'

  /* ── Card loading logic (reusable) ── */
  const buildQueue = useCallback(() => {
    const { cards: allCards, srsData } = useLibraryStore.getState()
    const pool = (deckId
      ? allCards.filter((c) => c.deckId === deckId)
      : allCards
    ).filter((c) => !c.isArchived)

    if (resolvedMode === 'cram') return [...pool]
    if (resolvedMode === 'random') return [...pool].sort(() => Math.random() - 0.5)
    if (resolvedMode === 'failed-only') {
      return pool.filter((c) => {
        const srs = srsData[c.id]
        return srs && (srs.lapses > 0 || srs.masteryPercent < 30)
      })
    }
    // standard — use getDueCards (respects daily limits)
    return getDueCards(deckId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, resolvedMode])

  /* ── Load cards on mount ── */
  useEffect(() => {
    const sessionCards = buildQueue()
    startSession(sessionCards, resolvedMode)
    setHistory([])
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Reset card-shown timer when currentIndex changes */
  useEffect(() => {
    cardShownAtRef.current = Date.now()
    setShowMoreRatings(false)
  }, [currentIndex])

  /* ── Rate a card ── */
  const handleRate = useCallback(
    (rating: Difficulty) => {
      const card = queue[currentIndex]
      if (!card) return
      const responseMs = Date.now() - cardShownAtRef.current

      // Snapshot SRS before review for undo
      const prevSRS = useLibraryStore.getState().srsData[card.id]

      // Capture mastery before rating for milestone detection
      const prevMastery = deckId
        ? useLibraryStore.getState().getDeckMastery(deckId)
        : null

      const logId = Math.random().toString(36).slice(2)
      addLog({
        cardId: card.id,
        userId: card.userId,
        rating,
        responseMs,
        reviewedAt: new Date().toISOString(),
        scheduledInterval: 0,
        ease: 2.5,
      })

      reviewCard(card.id, rating)

      // Fire confetti if a mastery milestone was crossed
      if (deckId && prevMastery !== null) {
        const newMastery = useLibraryStore.getState().getDeckMastery(deckId)
        const milestones = [50, 75, 90, 100]
        const crossed = milestones.some((m) => prevMastery < m && newMastery >= m)
        if (crossed) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          import('canvas-confetti').then((mod: any) => {
            const confetti = mod.default ?? mod
            confetti({
              particleCount: 80,
              spread: 70,
              origin: { y: 0.6 },
              colors: ['#22d3ee', '#4ade80', '#f59e0b'],
            })
          }).catch(() => {
            // canvas-confetti not available — skip
          })
        }
      }

      if (prevSRS) {
        pushUndo(card.id, prevSRS, logId)
      }

      setHistory((h) => [...h, currentIndex])
      nextCard()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, currentIndex, deckId]
  )

  /* ── Undo last review ── */
  const handleUndo = useCallback(() => {
    const entry = popUndo()
    if (!entry) return
    useLibraryStore.getState().setSRSData(entry.cardId, entry.prevSRS)
    useLibraryStore.getState().removeLastLog()
    decrementIndex()
    useAppStore.getState().addToast({ type: 'info', message: 'Undid last review', duration: 2000 })
  }, [popUndo, decrementIndex])

  /* ── Go back one card in history ── */
  function handleBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    // Re-start session from the previous card index so currentIndex resets to 0
    // pointing at that card. Pop the history entry first.
    const newQueue = queue.slice(prev)
    setHistory((h) => h.slice(0, -1))
    startSession(newQueue, mode)
  }

  /* ── Skip forward without rating ── */
  function handleSkip() {
    const card = queue[currentIndex]
    if (!card) return
    setHistory((h) => [...h, currentIndex])
    nextCard()
  }

  /* ── Shuffle remaining queue ── */
  function handleShuffle() {
    const remaining = queue.slice(currentIndex)
    const reviewed = queue.slice(0, currentIndex)
    const shuffled = [...remaining].sort(() => Math.random() - 0.5)
    startSession([...reviewed, ...shuffled], mode)
    // Restore currentIndex: startSession resets to 0, so re-slice
    // Simplest correct approach: just restart from shuffled remaining
    startSession(shuffled, mode)
    setHistory([])
  }

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      // Undo / Redo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault()
        return
      }

      if (e.code === 'Space') {
        e.preventDefault()
        if (!showAnswer) flipCard()
      }

      if (showAnswer) {
        if (e.key === '1') handleRate(1)
        if (e.key === '4') handleRate(4)
        if (e.key === 'f' || e.key === 'F') handleRate(1)
        if (e.key === 'r' || e.key === 'R') handleRate(4)
        if (e.key === 'ArrowLeft') handleBack()
        if (e.key === 'ArrowRight') handleSkip()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer, currentIndex, queue, history, handleUndo])

  const currentCard = queue[currentIndex]
  const isComplete = loaded && queue.length > 0 && currentIndex >= queue.length
  const isLoading = !loaded
  const hasNoCards = loaded && queue.length === 0

  const progressPct = queue.length > 0 ? (currentIndex / queue.length) * 100 : 0

  /* ════════════════════════════════════════════════════════════
     SESSION COMPLETE
  ════════════════════════════════════════════════════════════ */
  if (isComplete) {
    const correct = logs.filter((l) => l.rating >= 3).length
    const total = logs.length
    const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0
    const elapsed = startedAt
      ? Math.round((Date.now() - startedAt.getTime()) / 1000)
      : 0

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6"
        style={{ background: '#131315' }}
      >
        <div className="w-full max-w-sm animate-fade-in space-y-5">
          {/* Card */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: '#1c1c1f',
              border: '1px solid #2a2a30',
              boxShadow: '0 8px 32px -8px rgba(0,0,0,0.6)',
            }}
          >
            <div className="p-6 text-center space-y-1">
              <div className="text-3xl mb-3">🎉</div>
              <h1 className="text-lg font-semibold" style={{ color: '#e8e8ea' }}>
                Session Complete
              </h1>
              <p className="text-sm" style={{ color: '#6b6b72' }}>
                Great work!
              </p>
            </div>

            {/* Stats */}
            <div
              className="border-t grid grid-cols-2"
              style={{ borderColor: '#2a2a30' }}
            >
              {[
                { label: 'Reviewed', value: total },
                { label: 'Correct', value: correct },
                { label: 'Accuracy', value: `${accuracy}%` },
                { label: 'Time', value: formatDuration(elapsed) },
              ].map(({ label, value }, i) => (
                <div
                  key={label}
                  className={cn(
                    'p-4',
                    i % 2 === 0 ? 'border-r' : '',
                    i < 2 ? 'border-b' : ''
                  )}
                  style={{ borderColor: '#2a2a30' }}
                >
                  <p
                    className="text-xl font-bold"
                    style={{ color: '#e8e8ea' }}
                  >
                    {value}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: '#6b6b72' }}>
                    {label}
                  </p>
                </div>
              ))}
            </div>

            {/* Accuracy bar */}
            <div className="p-4 border-t" style={{ borderColor: '#2a2a30' }}>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs" style={{ color: '#6b6b72' }}>
                  Accuracy
                </span>
                <span
                  className="text-xs font-semibold"
                  style={{ color: '#e8e8ea' }}
                >
                  {accuracy}%
                </span>
              </div>
              <Progress
                value={accuracy}
                max={100}
                color={
                  accuracy >= 80
                    ? 'success'
                    : accuracy >= 60
                    ? 'accent'
                    : 'danger'
                }
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                startSession(buildQueue(), resolvedMode)
                setHistory([])
                setLoaded(true)
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: 'var(--accent)',
                color: '#fff',
              }}
            >
              <RotateCcw size={14} />
              Review Again
            </button>
            <button
              onClick={() => {
                reset()
                router.push('/study')
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: '#1c1c1f',
                border: '1px solid #2a2a30',
                color: '#6b6b72',
              }}
            >
              <ArrowLeft size={14} />
              Back to Study
            </button>
          </div>
        </div>
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════
     NO CARDS / LOADING
  ════════════════════════════════════════════════════════════ */
  if (isLoading || hasNoCards || !currentCard) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6"
        style={{ background: '#131315' }}
      >
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="skeleton w-48 h-4 mx-auto rounded" />
            <div className="skeleton w-32 h-4 mx-auto rounded" />
          </div>
        ) : (
          <div
            className="w-full max-w-sm rounded-xl overflow-hidden animate-fade-in"
            style={{
              background: '#1c1c1f',
              border: '1px solid #2a2a30',
            }}
          >
            <div className="p-8 text-center space-y-3">
              <p className="text-lg font-semibold" style={{ color: '#e8e8ea' }}>
                All caught up!
              </p>
              <p className="text-sm" style={{ color: '#6b6b72' }}>
                No cards due. Come back later.
              </p>
              <Link href="/study">
                <button
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{
                    background: 'var(--accent)',
                    color: '#fff',
                  }}
                >
                  <ArrowLeft size={14} />
                  Back
                </button>
              </Link>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════
     MAIN SESSION UI
  ════════════════════════════════════════════════════════════ */
  const canGoBack = history.length > 0
  const answerReady = showAnswer

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: '#131315' }}
    >
      {/* ── Thin progress bar at very top ── */}
      <div
        className="absolute top-0 left-0 right-0 z-50 h-[3px]"
        style={{ background: '#2a2a30' }}
      >
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${progressPct}%`,
            background: 'var(--accent)',
          }}
        />
      </div>

      {/* ── Top bar ── */}
      <div
        className="flex items-center h-11 px-4 gap-3 shrink-0 mt-[3px]"
        style={{
          background: '#131315',
          borderBottom: '1px solid #2a2a30',
        }}
      >
        {/* Deck name dropdown (placeholder — clicking goes back) */}
        <button
          onClick={() => {
            reset()
            router.push('/study')
          }}
          className="flex items-center gap-1.5 text-sm font-medium rounded-md px-2 py-1 transition-colors hover:bg-[#1c1c1f]"
          style={{ color: '#e8e8ea' }}
        >
          {deckName}
          <ChevronDown size={13} style={{ color: '#6b6b72' }} />
        </button>

        <div className="flex-1" />

        {/* Shuffle */}
        <button
          onClick={handleShuffle}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[#1c1c1f]"
          style={{ color: '#6b6b72' }}
          title="Shuffle remaining"
        >
          <Shuffle size={14} />
        </button>

        {/* Counter */}
        <span
          className="text-xs tabular-nums font-medium"
          style={{ color: '#6b6b72' }}
        >
          {currentIndex + 1} / {queue.length}
        </span>
      </div>

      {/* ── Scrollable card area ── */}
      <div className="flex-1 px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-2xl mx-auto pt-6">

          {/* Card */}
          <div
            className="rounded-xl overflow-hidden w-full"
            style={{
              background: '#1c1c1f',
              border: '1px solid #2a2a30',
              boxShadow: '0 8px 32px -8px rgba(0,0,0,0.5)',
            }}
          >
            {/* Question section inside card */}
            <ReviewCard
              card={currentCard}
              showAnswer={showAnswer}
              onTypedCheck={flipCard}
            />

            {/* "Next Side" button — only when answer is hidden and not typed */}
            {!showAnswer && currentCard.type !== 'typed' && (
              <button
                onClick={flipCard}
                className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-t hover:brightness-110 select-none"
                style={{
                  background: '#161618',
                  borderColor: '#2a2a30',
                  color: '#6b6b72',
                }}
              >
                <span style={{ fontSize: '1rem', lineHeight: 1 }}>↓</span>
                Next Side
                <kbd
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                  style={{
                    background: '#0f0f11',
                    border: '1px solid #2a2a30',
                    color: '#6b6b72',
                  }}
                >
                  SPACE
                </kbd>
              </button>
            )}
          </div>

          {/* "More ratings" expandable section */}
          {showAnswer && (
            <div className="mt-3 animate-fade-in">
              <button
                onClick={() => setShowMoreRatings((v) => !v)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-[#1c1c1f] mx-auto"
                style={{ color: '#6b6b72' }}
              >
                <MoreHorizontal size={12} />
                {showMoreRatings ? 'Fewer options' : 'More rating options'}
              </button>
              {showMoreRatings && (
                <div className="mt-3 animate-fade-in">
                  <ConfidenceRating onRate={handleRate} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div
        className="flex items-center px-6 py-3 gap-3 shrink-0"
        style={{
          background: '#131315',
          borderTop: '1px solid #2a2a30',
        }}
      >
        {/* ← Back */}
        <button
          onClick={handleBack}
          disabled={!canGoBack}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{
            background: '#1c1c1f',
            border: '1px solid #2a2a30',
            color: canGoBack ? '#e8e8ea' : '#3a3a42',
            cursor: canGoBack ? 'pointer' : 'not-allowed',
          }}
          title="Previous card"
        >
          <ArrowLeft size={15} />
        </button>

        {/* ↩ Undo — only visible after at least one review */}
        {undoStack.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
            style={{
              background: '#1c1c1f',
              border: '1px solid #2a2a30',
              color: '#a0a0b0',
            }}
            title="Undo last review (Ctrl+Z)"
          >
            <Undo2 size={12} />
            Undo
          </button>
        )}

        {/* → Skip */}
        <button
          onClick={handleSkip}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:brightness-110"
          style={{
            background: '#1c1c1f',
            border: '1px solid #2a2a30',
            color: '#6b6b72',
          }}
          title="Skip card"
        >
          <ArrowRight size={15} />
        </button>

        <div className="flex-1" />

        {/* × Forgot */}
        <button
          onClick={() => answerReady && handleRate(1)}
          disabled={!answerReady}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all select-none"
          style={{
            background: answerReady ? '#2a1515' : '#1c1c1f',
            border: `1px solid ${answerReady ? '#5a2020' : '#2a2a30'}`,
            color: answerReady ? '#f87171' : '#3a3a42',
            cursor: answerReady ? 'pointer' : 'not-allowed',
          }}
          title="Forgot (1)"
        >
          <span>×</span>
          Forgot
        </button>

        {/* ✓ Remembered */}
        <button
          onClick={() => answerReady && handleRate(4)}
          disabled={!answerReady}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all select-none"
          style={{
            background: answerReady ? '#0a2a15' : '#1c1c1f',
            border: `1px solid ${answerReady ? '#1a5a30' : '#2a2a30'}`,
            color: answerReady ? '#4ade80' : '#3a3a42',
            cursor: answerReady ? 'pointer' : 'not-allowed',
          }}
          title="Remembered (4)"
        >
          <span>✓</span>
          Remembered
        </button>

        <div className="flex-1" />

        {/* … Options */}
        <button
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[#1c1c1f]"
          style={{
            color: '#6b6b72',
          }}
          title="Options"
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  )
}

export default function StudySessionPage() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-full items-center justify-center"
          style={{ background: '#131315' }}
        >
          <div className="space-y-3 text-center">
            <div className="skeleton w-48 h-4 mx-auto rounded" />
            <div className="skeleton w-32 h-4 mx-auto rounded" />
          </div>
        </div>
      }
    >
      <SessionContent />
    </Suspense>
  )
}
