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
  Pencil,
  Trash2,
  History,
  RefreshCw,
} from 'lucide-react'
import { useStudyStore } from '@/store/useStudyStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { ReviewCard } from '@/components/study/ReviewCard'
import { ConfidenceRating } from '@/components/study/ConfidenceRating'
import { Progress } from '@/components/ui/Progress'
import { Dialog } from '@/components/ui/Dialog'
import { CardEditor } from '@/components/library/CardEditor'
import { cn, formatDuration } from '@/lib/utils'
import type { Difficulty } from '@/lib/types'

function formatKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'ArrowLeft') return '←'
  if (key === 'ArrowRight') return '→'
  if (key.length === 1) return key.toUpperCase()
  return key
}

const RATING_LABELS: Record<number, string> = { 1: 'Forgot', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const RATING_COLORS: Record<number, string> = {
  1: '#f87171', 2: '#fbbf24', 3: '#818cf8', 4: '#4ade80',
}

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
    requeueCurrentCard,
    removeCurrentCard,
  } = useStudyStore()

  const {
    getDueCards,
    getNewCards,
    getReviewsDue,
    reviewCard,
    decks,
    fsrsData,
    srsData,
    reviewLogs,
    deleteCard,
    resetCardSRS,
    cards: allCards,
  } = useLibraryStore()

  const { studyShortcuts, algorithm } = useSettingsStore()

  const cardShownAtRef = useRef<number>(Date.now())

  // History for ← back navigation
  const [history, setHistory] = useState<number[]>([])
  const [showMoreRatings, setShowMoreRatings] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Progress tracking
  const [initialQueueLength, setInitialQueueLength] = useState(0)
  const [rememberedCount, setRememberedCount] = useState(0)
  const [forgottenReviewCount, setForgottenReviewCount] = useState(0)

  // Card swipe animation
  const [animatingOut, setAnimatingOut] = useState<'left' | 'right' | null>(null)

  // Options menu
  const [showOptionsMenu, setShowOptionsMenu] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showHistoryDialog, setShowHistoryDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const optionsMenuRef = useRef<HTMLDivElement>(null)
  const optionsButtonRef = useRef<HTMLButtonElement>(null)

  /* Resolve mode */
  const resolvedMode = (() => {
    if (modeParam === 'cram') return 'cram' as const
    if (modeParam === 'random') return 'random' as const
    if (modeParam === 'failed') return 'failed-only' as const
    if (modeParam === 'new') return 'new-only' as const
    if (modeParam === 'reviews') return 'reviews-only' as const
    return 'standard' as const
  })()

  /* Resolve deck name */
  const deckName = deckId
    ? (decks.find((d) => d.id === deckId)?.name ?? 'Deck')
    : 'All cards'

  /* ── Card loading logic ── */
  const buildQueue = useCallback(() => {
    const { cards: rawCards, srsData: rawSrs } = useLibraryStore.getState()
    const pool = (deckId
      ? rawCards.filter((c) => c.deckId === deckId)
      : rawCards
    ).filter((c) => !c.isArchived)

    if (resolvedMode === 'cram') return [...pool]
    if (resolvedMode === 'random') return [...pool].sort(() => Math.random() - 0.5)
    if (resolvedMode === 'failed-only') {
      return pool.filter((c) => {
        const srs = rawSrs[c.id]
        return srs && (srs.lapses > 0 || srs.masteryPercent < 30)
      })
    }
    if (resolvedMode === 'new-only') return getNewCards(deckId)
    if (resolvedMode === 'reviews-only') return getReviewsDue(deckId)
    return getDueCards(deckId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, resolvedMode])

  /* ── Load cards on mount ── */
  useEffect(() => {
    const sessionCards = buildQueue()
    startSession(sessionCards, resolvedMode)
    setHistory([])
    setLoaded(true)
    setInitialQueueLength(sessionCards.length)
    setRememberedCount(0)
    setForgottenReviewCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Reset timer & UI when card changes */
  useEffect(() => {
    cardShownAtRef.current = Date.now()
    setShowMoreRatings(false)
  }, [currentIndex])

  /* Close options menu on outside click */
  useEffect(() => {
    if (!showOptionsMenu) return
    const handler = (e: MouseEvent) => {
      if (
        optionsMenuRef.current &&
        !optionsMenuRef.current.contains(e.target as Node) &&
        optionsButtonRef.current &&
        !optionsButtonRef.current.contains(e.target as Node)
      ) {
        setShowOptionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showOptionsMenu])

  /* Derive the live card from the library store (so edits are reflected) */
  const queueEntry = queue[currentIndex]
  const currentCard = queueEntry
    ? (allCards.find((c) => c.id === queueEntry.id) ?? queueEntry)
    : undefined

  /* Helper: is the current card "new" (never reviewed)? */
  const isCurrentCardNew = (() => {
    if (!currentCard) return false
    if (algorithm === 'fsrs') return (fsrsData[currentCard.id]?.repetitions ?? 0) === 0
    return (srsData[currentCard.id]?.repetitions ?? 0) === 0
  })()

  /* ── Rate a card ── */
  const handleRate = useCallback(
    (rating: Difficulty) => {
      const card = queue[currentIndex]
      if (!card || animatingOut) return

      const isNew = algorithm === 'fsrs'
        ? (useLibraryStore.getState().fsrsData[card.id]?.repetitions ?? 0) === 0
        : (useLibraryStore.getState().srsData[card.id]?.repetitions ?? 0) === 0

      // New card forgotten → re-queue without entering SRS
      if (isNew && rating === 1) {
        setAnimatingOut('left')
        setTimeout(() => {
          setAnimatingOut(null)
          requeueCurrentCard()
          setHistory((h) => [...h, currentIndex])
        }, 120)
        return
      }

      const responseMs = Date.now() - cardShownAtRef.current
      const prevSRS = useLibraryStore.getState().srsData[card.id]
      const prevMastery = deckId ? useLibraryStore.getState().getDeckMastery(deckId) : null

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

      // Update progress bar counters
      if (rating >= 3) {
        setRememberedCount((c) => c + 1)
      } else if (!isNew) {
        // Forgotten review card
        setForgottenReviewCount((c) => c + 1)
      }

      // Confetti on mastery milestone
      if (deckId && prevMastery !== null) {
        const newMastery = useLibraryStore.getState().getDeckMastery(deckId)
        const milestones = [50, 75, 90, 100]
        const crossed = milestones.some((m) => prevMastery < m && newMastery >= m)
        if (crossed) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          import('canvas-confetti').then((mod: any) => {
            const confetti = mod.default ?? mod
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ['#22d3ee', '#4ade80', '#f59e0b'] })
          }).catch(() => {})
        }
      }

      if (prevSRS) pushUndo(card.id, prevSRS, logId)
      setHistory((h) => [...h, currentIndex])

      // Animate then advance
      setAnimatingOut(rating === 1 ? 'left' : 'right')
      setTimeout(() => {
        setAnimatingOut(null)
        nextCard()
      }, 180)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, currentIndex, deckId, animatingOut, algorithm]
  )

  /* ── Undo last review ── */
  const handleUndo = useCallback(() => {
    const entry = popUndo()
    if (!entry) return
    useLibraryStore.getState().setSRSData(entry.cardId, entry.prevSRS)
    useLibraryStore.getState().removeLastLog()
    decrementIndex()
    if (rememberedCount > 0) setRememberedCount((c) => c - 1)
    useAppStore.getState().addToast({ type: 'info', message: 'Undid last review', duration: 2000 })
  }, [popUndo, decrementIndex, rememberedCount])

  /* ── Go back one card in history ── */
  function handleBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
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
    const shuffled = [...remaining].sort(() => Math.random() - 0.5)
    startSession(shuffled, mode)
    setHistory([])
  }

  /* ── Delete current card ── */
  function handleDeleteCard() {
    const card = queue[currentIndex]
    if (!card) return
    setShowOptionsMenu(false)
    setShowDeleteConfirm(false)
    deleteCard(card.id)
    removeCurrentCard()
    useAppStore.getState().addToast({ type: 'info', message: 'Card deleted', duration: 2000 })
  }

  /* ── Reset current card SRS ── */
  function handleResetSRS() {
    const card = queue[currentIndex]
    if (!card) return
    setShowOptionsMenu(false)
    resetCardSRS(card.id)
    useAppStore.getState().addToast({ type: 'info', message: 'Review history reset', duration: 2000 })
  }

  /* ── Keyboard shortcuts ── */
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
        return
      }

      const k = e.key

      if (e.code === 'Space') {
        e.preventDefault()
        if (!showAnswer) flipCard()
        else handleRate(4)
        return
      }

      if (showAnswer) {
        if (k === studyShortcuts.forgot || k === studyShortcuts.forgot.toUpperCase()) {
          handleRate(1)
          return
        }
        if (studyShortcuts.remembered !== ' ' && k === studyShortcuts.remembered) {
          handleRate(4)
          return
        }
        if (k === studyShortcuts.skip) { handleSkip(); return }
        if (k === studyShortcuts.back) { handleBack(); return }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer, currentIndex, queue, history, handleUndo, studyShortcuts])

  const isComplete = loaded && queue.length > 0 && currentIndex >= queue.length
  const isLoading = !loaded
  const hasNoCards = loaded && queue.length === 0

  // Progress bar: green = remembered, red = forgotten reviews
  const total = Math.max(initialQueueLength, 1)
  const greenPct = (rememberedCount / total) * 100
  const redPct = (forgottenReviewCount / total) * 100

  /* ════════════════════════════════════════════════════════════
     SESSION COMPLETE
  ════════════════════════════════════════════════════════════ */
  if (isComplete) {
    const correct = logs.filter((l) => l.rating >= 3).length
    const totalLogged = logs.length
    const accuracy = totalLogged > 0 ? Math.round((correct / totalLogged) * 100) : 0
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0

    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: '#1a1a1c' }}>
        <div className="w-full max-w-sm animate-fade-in space-y-5">
          <div className="rounded-xl overflow-hidden" style={{ background: '#222225', border: '1px solid #2a2a30' }}>
            <div className="p-6 text-center space-y-1">
              <div className="text-3xl mb-3">🎉</div>
              <h1 className="text-lg font-semibold" style={{ color: '#e8e8ea' }}>Session Complete</h1>
              <p className="text-sm" style={{ color: '#6b6b72' }}>Great work!</p>
            </div>
            <div className="border-t grid grid-cols-2" style={{ borderColor: '#2a2a30' }}>
              {[
                { label: 'Reviewed', value: totalLogged },
                { label: 'Correct', value: correct },
                { label: 'Accuracy', value: `${accuracy}%` },
                { label: 'Time', value: formatDuration(elapsed) },
              ].map(({ label, value }, i) => (
                <div key={label} className={cn('p-4', i % 2 === 0 ? 'border-r' : '', i < 2 ? 'border-b' : '')} style={{ borderColor: '#2a2a30' }}>
                  <p className="text-xl font-bold" style={{ color: '#e8e8ea' }}>{value}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6b6b72' }}>{label}</p>
                </div>
              ))}
            </div>
            <div className="p-4 border-t" style={{ borderColor: '#2a2a30' }}>
              <div className="flex justify-between mb-1.5">
                <span className="text-xs" style={{ color: '#6b6b72' }}>Accuracy</span>
                <span className="text-xs font-semibold" style={{ color: '#e8e8ea' }}>{accuracy}%</span>
              </div>
              <Progress value={accuracy} max={100} color={accuracy >= 80 ? 'success' : accuracy >= 60 ? 'accent' : 'danger'} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                const cards = buildQueue()
                startSession(cards, resolvedMode)
                setHistory([])
                setLoaded(true)
                setInitialQueueLength(cards.length)
                setRememberedCount(0)
                setForgottenReviewCount(0)
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <RotateCcw size={14} />
              Review Again
            </button>
            <button
              onClick={() => { reset(); router.push('/study') }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: '#222225', border: '1px solid #2a2a30', color: '#6b6b72' }}
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
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: '#1a1a1c' }}>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="skeleton w-48 h-4 mx-auto rounded" />
            <div className="skeleton w-32 h-4 mx-auto rounded" />
          </div>
        ) : (
          <div className="w-full max-w-sm rounded-xl overflow-hidden animate-fade-in" style={{ background: '#222225', border: '1px solid #2a2a30' }}>
            <div className="p-8 text-center space-y-3">
              <p className="text-lg font-semibold" style={{ color: '#e8e8ea' }}>All caught up!</p>
              <p className="text-sm" style={{ color: '#6b6b72' }}>No cards due. Come back later.</p>
              <Link href="/study">
                <button
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--accent)', color: '#fff' }}
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
  const isAnimating = animatingOut !== null

  // Review logs for this card (shown in history dialog)
  const cardLogs = reviewLogs
    .filter((l) => l.cardId === currentCard.id)
    .sort((a, b) => new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime())

  return (
    <div className="flex flex-col h-full" style={{ background: '#1a1a1c' }}>
      {/* ── Progress bar ── */}
      <div className="h-[3px] w-full shrink-0 flex" style={{ background: '#2a2a30' }}>
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${greenPct}%`, background: '#4ade80' }}
        />
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${redPct}%`, background: '#f87171' }}
        />
      </div>

      {/* ── Top bar ── */}
      <div
        className="flex items-center h-11 px-4 gap-3 shrink-0"
        style={{ background: '#1a1a1c', borderBottom: '1px solid #2a2a30' }}
      >
        <button
          onClick={() => { reset(); router.push('/study') }}
          className="flex items-center gap-1.5 text-sm font-medium rounded-md px-2 py-1 transition-colors hover:bg-[#222225]"
          style={{ color: '#e8e8ea' }}
        >
          {deckName}
          <ChevronDown size={13} style={{ color: '#6b6b72' }} />
        </button>

        {isCurrentCardNew && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: '#1c1c2e', color: '#818cf8', border: '1px solid #2a2a50' }}
          >
            NEW
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={handleShuffle}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[#222225]"
          style={{ color: '#6b6b72' }}
          title="Shuffle remaining"
        >
          <Shuffle size={14} />
        </button>

        <span className="text-xs tabular-nums font-medium" style={{ color: '#6b6b72' }}>
          {currentIndex + 1} / {queue.length}
        </span>
      </div>

      {/* ── Scrollable card area ── */}
      <div className="flex-1 px-4 py-6 overflow-y-auto">
        <div className="w-full max-w-2xl mx-auto pt-6">

          {/* Card with swipe animation */}
          <div
            className={cn(
              animatingOut === 'left' && 'animate-swipe-left',
              animatingOut === 'right' && 'animate-swipe-right'
            )}
          >
            <div
              className="rounded-xl overflow-hidden w-full"
              style={{
                background: '#222225',
                border: '1px solid #2a2a30',
                boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)',
              }}
            >
              <ReviewCard card={currentCard} showAnswer={showAnswer} onTypedCheck={flipCard} />

              {!showAnswer && currentCard.type !== 'typed' && (
                <button
                  onClick={flipCard}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-t hover:brightness-110 select-none"
                  style={{ background: '#1e1e20', borderColor: '#2a2a30', color: '#6b6b72' }}
                >
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>↓</span>
                  Next Side
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#0f0f11', border: '1px solid #2a2a30', color: '#6b6b72' }}>
                    SPACE
                  </kbd>
                </button>
              )}
            </div>
          </div>

          {/* More ratings */}
          {showAnswer && (
            <div className="mt-3 animate-fade-in">
              <button
                onClick={() => setShowMoreRatings((v) => !v)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-[#222225] mx-auto"
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
        style={{ background: '#1a1a1c', borderTop: '1px solid #2a2a30' }}
      >
        {/* ← Back */}
        <button
          onClick={handleBack}
          disabled={!canGoBack}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{
            background: '#222225',
            border: '1px solid #2a2a30',
            color: canGoBack ? '#e8e8ea' : '#3a3a42',
            cursor: canGoBack ? 'pointer' : 'not-allowed',
          }}
          title="Previous card"
        >
          <ArrowLeft size={15} />
        </button>

        {/* ↩ Undo */}
        {undoStack.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
            style={{ background: '#222225', border: '1px solid #2a2a30', color: '#a0a0b0' }}
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
          style={{ background: '#222225', border: '1px solid #2a2a30', color: '#6b6b72' }}
          title="Skip card"
        >
          <ArrowRight size={15} />
        </button>

        <div className="flex-1" />

        {/* × Forgot */}
        <button
          onClick={() => answerReady && !isAnimating && handleRate(1)}
          disabled={!answerReady || isAnimating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all select-none"
          style={{
            background: answerReady ? '#2a1515' : '#222225',
            border: `1px solid ${answerReady ? '#5a2020' : '#2a2a30'}`,
            color: answerReady ? '#f87171' : '#3a3a42',
            cursor: answerReady && !isAnimating ? 'pointer' : 'not-allowed',
          }}
          title={`Forgot (${formatKey(studyShortcuts.forgot)})`}
        >
          <span>×</span>
          Forgot
          {answerReady && (
            <kbd className="text-[10px] font-mono opacity-60 ml-0.5">
              {formatKey(studyShortcuts.forgot)}
            </kbd>
          )}
        </button>

        {/* ✓ Remembered */}
        <button
          onClick={() => answerReady && !isAnimating && handleRate(4)}
          disabled={!answerReady || isAnimating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all select-none"
          style={{
            background: answerReady ? '#0a2a15' : '#222225',
            border: `1px solid ${answerReady ? '#1a5a30' : '#2a2a30'}`,
            color: answerReady ? '#4ade80' : '#3a3a42',
            cursor: answerReady && !isAnimating ? 'pointer' : 'not-allowed',
          }}
          title={`Remembered (${formatKey(studyShortcuts.remembered)})`}
        >
          <span>✓</span>
          Remembered
          {answerReady && (
            <kbd className="text-[10px] font-mono opacity-60 ml-0.5">
              {formatKey(studyShortcuts.remembered)}
            </kbd>
          )}
        </button>

        <div className="flex-1" />

        {/* … Options */}
        <div className="relative">
          <button
            ref={optionsButtonRef}
            onClick={() => setShowOptionsMenu((v) => !v)}
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[#222225]"
            style={{ color: showOptionsMenu ? '#818cf8' : '#6b6b72' }}
            title="Options"
          >
            <MoreHorizontal size={16} />
          </button>

          {showOptionsMenu && (
            <div
              ref={optionsMenuRef}
              className="absolute bottom-12 right-0 w-52 rounded-xl overflow-hidden animate-scale-in"
              style={{
                background: '#222225',
                border: '1px solid #333338',
                boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
                zIndex: 10,
              }}
            >
              <button
                onClick={() => { setShowOptionsMenu(false); setShowEditDialog(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[#2a2a2e] transition-colors"
                style={{ color: '#e8e8ea' }}
              >
                <Pencil size={13} style={{ color: '#8e8ea0' }} />
                Edit card
              </button>
              <button
                onClick={handleResetSRS}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[#2a2a2e] transition-colors"
                style={{ color: '#e8e8ea' }}
              >
                <RefreshCw size={13} style={{ color: '#8e8ea0' }} />
                Reset review history
              </button>
              <button
                onClick={() => { setShowOptionsMenu(false); setShowHistoryDialog(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[#2a2a2e] transition-colors"
                style={{ color: '#e8e8ea' }}
              >
                <History size={13} style={{ color: '#8e8ea0' }} />
                Review history
              </button>
              <div className="border-t mx-3" style={{ borderColor: '#333338' }} />
              <button
                onClick={() => { setShowOptionsMenu(false); setShowDeleteConfirm(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[#2d1515] transition-colors"
                style={{ color: '#f87171' }}
              >
                <Trash2 size={13} />
                Delete card
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Edit card dialog ── */}
      <Dialog open={showEditDialog} onClose={() => setShowEditDialog(false)} title="Edit Card" size="lg">
        <div className="p-4">
          {showEditDialog && currentCard && (
            <CardEditor
              deckId={currentCard.deckId}
              card={currentCard}
              onDone={() => setShowEditDialog(false)}
            />
          )}
        </div>
      </Dialog>

      {/* ── Review history dialog ── */}
      <Dialog open={showHistoryDialog} onClose={() => setShowHistoryDialog(false)} title="Review History" size="md">
        <div className="overflow-y-auto max-h-96">
          {cardLogs.length === 0 ? (
            <div className="p-6 text-center text-sm" style={{ color: '#6b6b72' }}>
              No review history yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: '#333338', background: '#222225' }}>
                  <th className="text-left px-4 py-2.5 font-medium" style={{ color: '#8e8ea0' }}>Date</th>
                  <th className="text-left px-4 py-2.5 font-medium" style={{ color: '#8e8ea0' }}>Rating</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: '#8e8ea0' }}>Response</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: '#8e8ea0' }}>Interval</th>
                </tr>
              </thead>
              <tbody>
                {cardLogs.map((log, i) => (
                  <tr
                    key={log.id ?? i}
                    className="border-b last:border-0"
                    style={{ borderColor: '#2a2a2e' }}
                  >
                    <td className="px-4 py-2.5" style={{ color: '#8e8ea0' }}>
                      {new Date(log.reviewedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: RATING_COLORS[log.rating] }}>
                      {RATING_LABELS[log.rating] ?? log.rating}
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: '#8e8ea0' }}>
                      {log.responseMs > 0 ? `${(log.responseMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: '#8e8ea0' }}>
                      {log.scheduledInterval > 0 ? `${log.scheduledInterval}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Dialog>

      {/* ── Delete confirm dialog ── */}
      <Dialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        title="Delete card?"
        description="This will permanently remove the card and its review history."
        size="sm"
      >
        <div className="p-4 flex justify-end gap-2">
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[#2a2a2e]"
            style={{ color: '#8e8ea0' }}
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteCard}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: '#2d1515', border: '1px solid #5a2020', color: '#f87171' }}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  )
}

export default function StudySessionPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-full items-center justify-center" style={{ background: '#1a1a1c' }}>
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
