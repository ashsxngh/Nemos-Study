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
  Undo2,
  Pencil,
  Trash2,
  History,
  RefreshCw,
  Focus,
  X,
} from 'lucide-react'
import { useStudyStore } from '@/store/useStudyStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useTrashStore } from '@/store/useTrashStore'
import { useExamStore } from '@/store/useExamStore'
import { useAppStore } from '@/store/useAppStore'
import { getWeakestCards } from '@/lib/examScheduler'
import { useSettingsStore } from '@/store/useSettingsStore'
import { ReviewCard } from '@/components/study/ReviewCard'
import { ConfidenceRating } from '@/components/study/ConfidenceRating'
import { Progress } from '@/components/ui/Progress'
import { Dialog } from '@/components/ui/Dialog'
import { CardEditor } from '@/components/library/CardEditor'
import { cn, formatDuration } from '@/lib/utils'
import type { Card, Difficulty } from '@/lib/types'

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
  const examId = searchParams.get('examId') ?? undefined
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
    reorderQueue,
  } = useStudyStore()

  const {
    getDueCards,
    getNewCards,
    getReviewsDue,
    reviewCard,
    decks,
    folders,
    fsrsData,
    srsData,
    reviewLogs,
    deleteCard,
    resetCardSRS,
    cards: allCards,
  } = useLibraryStore()

  const { exams } = useExamStore()

  const { studyShortcuts, algorithm, showSessionProgress, dailyCardTarget } = useSettingsStore()

  const cardShownAtRef = useRef<number>(Date.now())
  // Tracks the persisted ReviewSession record (useLibraryStore.sessions) for
  // this study session — separate from useStudyStore's local sessionId.
  const librarySessionIdRef = useRef<string | null>(null)

  const startLibrarySession = useCallback(() => {
    const session = useLibraryStore.getState().startSession(deckId)
    librarySessionIdRef.current = session.id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId])

  const endLibrarySession = useCallback(() => {
    const sessionId = librarySessionIdRef.current
    if (!sessionId) return
    const sessionLogs = useStudyStore.getState().logs
    const cardsReviewed = sessionLogs.length
    const cardsCorrect = sessionLogs.filter((l) => l.rating >= 3).length
    useLibraryStore.getState().endSession(sessionId, cardsReviewed, cardsCorrect)
    librarySessionIdRef.current = null
  }, [])

  // Tracks the most recent "D" quick-delete so Ctrl+D can restore it from trash
  const lastQuickDeletedRef = useRef<{ card: Card; index: number } | null>(null)

  // History for ← back navigation
  const [history, setHistory] = useState<number[]>([])
  const [showMoreRatings, setShowMoreRatings] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Progress tracking (reviews only — new cards excluded)
  const [initialQueueLength, setInitialQueueLength] = useState(0)
  const [rememberedCount, setRememberedCount] = useState(0)
  const [forgottenReviewCount, setForgottenReviewCount] = useState(0)
  const [newCardReviewedCount, setNewCardReviewedCount] = useState(0)
  const [newCardCorrectCount, setNewCardCorrectCount] = useState(0)

  // Card swipe animation
  const [animatingOut, setAnimatingOut] = useState<'left' | 'right' | null>(null)
  // Blocks any second call to handleRate until the first fully completes
  const ratingInFlightRef = useRef(false)

  // Zen mode — distraction-free fullscreen session
  const [zenMode, setZenMode] = useState(false)

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
    if (modeParam === 'weakest') return 'cram' as const
    return 'standard' as const
  })()

  /* Resolve deck name */
  const deckName = examId
    ? (exams.find((e) => e.id === examId)?.name ?? 'Exam Study')
    : deckId
    ? (decks.find((d) => d.id === deckId)?.name ?? 'Deck')
    : 'All cards'

  /* ── Card loading logic ── */
  const buildQueue = useCallback(() => {
    // Exam "Study Weakest" mode: cards sorted ascending by FSRS retrievability
    if (examId) {
      const lib = useLibraryStore.getState()
      const examObj = useExamStore.getState().exams.find((e) => e.id === examId)
      if (!examObj) return []
      return getWeakestCards(examObj, lib.decks, lib.cards, lib.folders, lib.fsrsData, 50)
    }

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
  }, [deckId, examId, resolvedMode])

  /* ── Load cards on mount ── */
  useEffect(() => {
    const sessionCards = buildQueue()
    startSession(sessionCards, resolvedMode)
    startLibrarySession()
    setHistory([])
    setLoaded(true)
    // Progress bar denominator = review cards only; new cards tracked separately
    const lib = useLibraryStore.getState()
    const reviewCount = sessionCards.filter((c) =>
      algorithm === 'fsrs'
        ? (lib.fsrsData[c.id]?.state ?? 'new') !== 'new'
        : (lib.srsData[c.id]?.repetitions ?? 0) > 0
    ).length
    setInitialQueueLength(reviewCount)
    setRememberedCount(0)
    setForgottenReviewCount(0)
    setNewCardReviewedCount(0)
    setNewCardCorrectCount(0)
    // End the persisted session record if the user navigates away/closes the tab
    // mid-session, rather than via the Exit/Back-to-Study buttons.
    return () => endLibrarySession()
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

  /* Name of the deck the current card actually belongs to — matters when the
     queue mixes decks (All cards, exam mode), where it can differ from the
     session-level deckName shown in the top bar. */
  const currentCardDeckName = currentCard
    ? (decks.find((d) => d.id === currentCard.deckId)?.name ?? deckName)
    : deckName

  /* Helper: is the current card "new" (never reviewed)? */
  const isCurrentCardNew = (() => {
    if (!currentCard) return false
    if (algorithm === 'fsrs') return (fsrsData[currentCard.id]?.state ?? 'new') === 'new'
    return (srsData[currentCard.id]?.repetitions ?? 0) === 0
  })()

  /* Card metadata — last seen + difficulty, derived from SRS data */
  const cardMeta = (() => {
    if (!currentCard) return null
    const lastReviewedAt = algorithm === 'fsrs'
      ? fsrsData[currentCard.id]?.lastReviewedAt
      : srsData[currentCard.id]?.lastReviewedAt
    if (!lastReviewedAt) return null

    const days = Math.floor((Date.now() - new Date(lastReviewedAt).getTime()) / 86400000)
    const lastSeen = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`

    let difficulty: 'Easy' | 'Medium' | 'Hard'
    if (algorithm === 'fsrs') {
      const d = fsrsData[currentCard.id]?.difficulty ?? 0
      difficulty = d > 7 ? 'Hard' : d > 4.5 ? 'Medium' : 'Easy'
    } else {
      const ef = srsData[currentCard.id]?.easeFactor ?? 2.5
      difficulty = ef < 2.0 ? 'Hard' : ef < 2.4 ? 'Medium' : 'Easy'
    }
    return { lastSeen, difficulty }
  })()

  /* Daily progress — today's reviews vs daily card target */
  const todayStr = new Date().toISOString().slice(0, 10)
  const todayReviewCount = reviewLogs.filter((l) => l.reviewedAt.slice(0, 10) === todayStr).length
  const dailyPct = Math.min(100, Math.round((todayReviewCount / Math.max(dailyCardTarget, 1)) * 100))

  /* ── Rate a card ── */
  const handleRate = useCallback(
    (rating: Difficulty) => {
      if (ratingInFlightRef.current) return
      const card = queue[currentIndex]
      if (!card || animatingOut) return
      ratingInFlightRef.current = true

      const isNew = algorithm === 'fsrs'
        ? (useLibraryStore.getState().fsrsData[card.id]?.state ?? 'new') === 'new'
        : (useLibraryStore.getState().srsData[card.id]?.repetitions ?? 0) === 0

      // New card: only Good (3) or Easy (4) graduates; Again (1) or Hard (2) re-queues
      if (isNew && rating <= 2) {
        setAnimatingOut('left')
        setTimeout(() => {
          setAnimatingOut(null)
          requeueCurrentCard()
          setHistory((h) => [...h, currentIndex])
          ratingInFlightRef.current = false
        }, 120)
        return
      }

      const responseMs = Date.now() - cardShownAtRef.current
      const libState = useLibraryStore.getState()
      const prevSRS = libState.srsData[card.id]
      const prevFSRS = libState.fsrsData[card.id]
      const prevMastery = deckId ? libState.getDeckMastery(deckId) : null

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

      // Update progress bar counters (new cards excluded from review metrics)
      if (isNew) {
        setNewCardReviewedCount((c) => c + 1)
        if (rating >= 3) setNewCardCorrectCount((c) => c + 1)
      } else if (rating >= 3) {
        setRememberedCount((c) => c + 1)
      } else {
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
            confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ['#818cf8', '#4ade80', '#f59e0b'] })
          }).catch(() => {})
        }
      }

      if (prevSRS) pushUndo(card.id, prevSRS, logId, prevFSRS)
      setHistory((h) => [...h, currentIndex])

      // Animate then advance
      setAnimatingOut(rating === 1 ? 'left' : 'right')
      setTimeout(() => {
        setAnimatingOut(null)
        nextCard()
        ratingInFlightRef.current = false
      }, 180)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queue, currentIndex, deckId, animatingOut, algorithm]
  )

  /* ── Undo last review ── */
  const handleUndo = useCallback(() => {
    const entry = popUndo()
    if (!entry) return
    const lib = useLibraryStore.getState()
    lib.setSRSData(entry.cardId, entry.prevSRS)
    if (entry.prevFSRS) lib.setFSRSData(entry.cardId, entry.prevFSRS)
    lib.removeLastLog()
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
    reorderQueue(newQueue, 0)
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
    reorderQueue(shuffled, 0)
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

  /* ── D shortcut: instantly trash the current card, no confirm ── */
  function handleQuickDelete() {
    const card = queue[currentIndex]
    if (!card) return
    lastQuickDeletedRef.current = { card, index: currentIndex }
    deleteCard(card.id)
    removeCurrentCard()
    useAppStore.getState().addToast({ type: 'info', message: 'Card sent to trash — Ctrl+D to undo', duration: 2500 })
  }

  /* ── Ctrl+D: restore the last "D"-trashed card from trash, back into the queue ── */
  function handleUndoQuickDelete() {
    const pending = lastQuickDeletedRef.current
    if (!pending) return
    const entry = useTrashStore.getState().items.find((i) => i.id === pending.card.id && i.type === 'card')
    useLibraryStore.setState((s) => ({
      cards: [...s.cards, entry?.card ?? pending.card],
      srsData: entry?.cardSRS ? { ...s.srsData, [pending.card.id]: entry.cardSRS } : s.srsData,
      fsrsData: entry?.cardFSRS ? { ...s.fsrsData, [pending.card.id]: entry.cardFSRS } : s.fsrsData,
      pendingDeletes: {
        ...s.pendingDeletes,
        cards: s.pendingDeletes.cards.filter((id) => id !== pending.card.id),
      },
    }))
    if (entry) useTrashStore.getState().remove(entry.id)

    const newQueue = [...queue]
    const insertAt = Math.min(pending.index, newQueue.length)
    newQueue.splice(insertAt, 0, pending.card)
    reorderQueue(newQueue, insertAt)

    lastQuickDeletedRef.current = null
    useAppStore.getState().addToast({ type: 'info', message: 'Card restored', duration: 2000 })
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
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      // Block all session shortcuts while any dialog is open — otherwise keys
      // typed inside the dialog (on non-input elements) fall through and
      // rate/flip/undo the card sitting behind it.
      if (showEditDialog || showHistoryDialog || showDeleteConfirm) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        handleUndo()
        return
      }

      // Ctrl/Cmd+D — restore the card that was just sent to trash via "D"
      if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        handleUndoQuickDelete()
        return
      }

      if (e.key === 'Escape') {
        setZenMode(false)
        return
      }

      if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) {
        setZenMode((v) => !v)
        return
      }

      // E = edit current card (works before and after flip)
      if (e.key === 'e' || e.key === 'E') {
        setShowEditDialog(true)
        return
      }

      // D = instantly send current card to trash (works before and after flip)
      if (e.key === 'd' || e.key === 'D') {
        handleQuickDelete()
        return
      }

      const k = e.key

      // Space or ↓ = flip (before answer) or Remember (after answer)
      if (e.code === 'Space' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (!showAnswer) flipCard()
        else handleRate(4)
        return
      }

      if (showAnswer) {
        // R = Remember
        if (k === 'r' || k === 'R') { handleRate(4); return }

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

      // S = skip (works before and after flip)
      if (k === 's' || k === 'S') { handleSkip(); return }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer, currentIndex, queue, history, handleUndo, studyShortcuts, showEditDialog, showHistoryDialog, showDeleteConfirm])

  const isComplete = loaded && queue.length > 0 && currentIndex >= queue.length
  const isLoading = !loaded
  const hasNoCards = loaded && queue.length === 0

  // Close out the persisted ReviewSession record as soon as the session finishes
  useEffect(() => {
    if (isComplete) endLibrarySession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isComplete])

  // Progress bar: green = remembered, red = forgotten reviews
  const total = Math.max(initialQueueLength, 1)
  const rawGreenPct = (rememberedCount / total) * 100
  const greenPct = Math.min(100, rawGreenPct)
  const redPct = Math.min(100 - greenPct, (forgottenReviewCount / total) * 100)

  /* ════════════════════════════════════════════════════════════
     SESSION COMPLETE
  ════════════════════════════════════════════════════════════ */
  if (isComplete) {
    const totalLogged = logs.length - newCardReviewedCount
    const correct = logs.filter((l) => l.rating >= 3).length - newCardCorrectCount
    const accuracy = totalLogged > 0 ? Math.round((correct / totalLogged) * 100) : 0
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0

    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-sm animate-fade-in space-y-5">
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div className="p-6 text-center space-y-1">
              <div className="text-3xl mb-3">🎉</div>
              <h1 className="text-lg font-semibold" style={{ color: '#e8e8ea' }}>Session Complete</h1>
              <p className="text-sm" style={{ color: '#6b6b72' }}>Great work!</p>
            </div>
            <div className="border-t grid grid-cols-2" style={{ borderColor: 'var(--border)' }}>
              {[
                { label: 'Reviewed', value: totalLogged },
                { label: 'Correct', value: correct },
                { label: 'Accuracy', value: `${accuracy}%` },
                { label: 'Time', value: formatDuration(elapsed) },
              ].map(({ label, value }, i) => (
                <div key={label} className={cn('p-4', i % 2 === 0 ? 'border-r' : '', i < 2 ? 'border-b' : '')} style={{ borderColor: 'var(--border)' }}>
                  <p className="text-xl font-bold" style={{ color: '#e8e8ea' }}>{value}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#6b6b72' }}>{label}</p>
                </div>
              ))}
            </div>
            <div className="p-4 border-t" style={{ borderColor: 'var(--border)' }}>
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
                startLibrarySession()
                setHistory([])
                setLoaded(true)
                const lib = useLibraryStore.getState()
                const reviewCount = cards.filter((c) =>
                  algorithm === 'fsrs'
                    ? (lib.fsrsData[c.id]?.state ?? 'new') !== 'new'
                    : (lib.srsData[c.id]?.repetitions ?? 0) > 0
                ).length
                setInitialQueueLength(reviewCount)
                setRememberedCount(0)
                setForgottenReviewCount(0)
                setNewCardReviewedCount(0)
                setNewCardCorrectCount(0)
              }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              <RotateCcw size={14} />
              Review Again
            </button>
            <button
              onClick={() => { endLibrarySession(); reset(); router.push('/study') }}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: '#6b6b72' }}
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
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: 'var(--bg-base)' }}>
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="skeleton w-48 h-4 mx-auto rounded" />
            <div className="skeleton w-32 h-4 mx-auto rounded" />
          </div>
        ) : (
          <div className="w-full max-w-sm rounded-xl overflow-hidden animate-fade-in" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
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
    <div
      className={cn('flex flex-col', zenMode ? 'fixed inset-0 z-50' : 'h-full')}
      style={{ background: 'var(--bg-base)' }}
    >
      {/* ── Progress bar ── */}
      {showSessionProgress && !zenMode && (
        <div className="h-[3px] w-full shrink-0 flex" style={{ background: 'var(--border)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${greenPct}%`, background: '#4ade80' }}
          />
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${redPct}%`, background: '#f87171' }}
          />
        </div>
      )}

      {/* ── Top bar ── */}
      {!zenMode && (
      <div
        className="flex items-center h-11 px-4 gap-3 shrink-0"
        style={{ background: 'var(--bg-base)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={() => { endLibrarySession(); reset(); router.push('/study') }}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--bg-surface)]"
          style={{ color: '#6b6b72' }}
          title="Exit session"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="text-sm font-medium" style={{ color: '#e8e8ea' }}>
          {deckName}
        </span>

        {isCurrentCardNew && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{ background: '#1c1c2e', color: '#818cf8', border: '1px solid #2a2a50' }}
          >
            NEW
          </span>
        )}

        <div className="flex-1" />

        {/* Daily progress */}
        <div
          className="hidden md:flex items-center gap-2 mr-1"
          title={`${todayReviewCount} of ${dailyCardTarget} cards reviewed today`}
        >
          <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#6b6b72' }}>
            Today
          </span>
          <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${dailyPct}%`, background: '#818cf8' }}
            />
          </div>
          <span className="text-[10px] tabular-nums font-semibold" style={{ color: '#818cf8' }}>
            {dailyPct}%
          </span>
        </div>

        <button
          onClick={() => setZenMode(true)}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--bg-surface)]"
          style={{ color: '#6b6b72' }}
          title="Zen mode (Z)"
        >
          <Focus size={14} />
        </button>

        <button
          onClick={handleShuffle}
          className="flex items-center justify-center w-7 h-7 rounded-md transition-colors hover:bg-[var(--bg-surface)]"
          style={{ color: '#6b6b72' }}
          title="Shuffle remaining"
        >
          <Shuffle size={14} />
        </button>

        {deckId && (
          <span className="text-xs tabular-nums font-medium" style={{ color: '#6b6b72' }}>
            {currentIndex + 1} / {queue.length}
          </span>
        )}
      </div>
      )}

      {/* ── Zen mode exit button ── */}
      {zenMode && (
        <button
          onClick={() => setZenMode(false)}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: '#6b6b72' }}
          title="Exit Zen mode (Esc)"
        >
          <X size={12} />
          Exit Zen
        </button>
      )}

      {/* ── Scrollable card area ── */}
      <div className="flex-1 px-4 py-6 overflow-y-auto">
        <div className={cn('w-full max-w-2xl mx-auto', zenMode ? 'pt-12' : 'pt-6')}>

          {/* Zen mode header — deck chip + counter */}
          {zenMode && (
            <div className="flex flex-col items-center gap-2 mb-8 animate-fade-in">
              <span
                className="text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full"
                style={{ background: '#1c1c2e', color: '#818cf8', border: '1px solid #2a2a50' }}
              >
                {deckName}
              </span>
              {deckId && (
                <span className="text-xs tabular-nums" style={{ color: '#6b6b72' }}>
                  Card {currentIndex + 1} of {queue.length}
                </span>
              )}
            </div>
          )}

          {/* Card with swipe animation */}
          <div
            className={cn(
              animatingOut === 'left' && 'animate-swipe-left',
              animatingOut === 'right' && 'animate-swipe-right'
            )}
          >
            <div
              className="relative rounded-xl overflow-hidden w-full"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)',
              }}
            >
              {/* Subtle deck name — corner of the card, not the page chrome */}
              <span
                className="absolute top-2.5 right-3.5 text-[10px] font-medium truncate max-w-[40%] pointer-events-none select-none"
                style={{ color: '#6b6b72', opacity: 0.7 }}
              >
                {currentCardDeckName}
              </span>

              <ReviewCard card={currentCard} showAnswer={showAnswer} onTypedCheck={flipCard} />

              {/* Card meta — last seen + difficulty */}
              {cardMeta && (
                <div
                  className="flex items-center justify-between px-4 py-2 border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-[11px]" style={{ color: '#6b6b72' }}>
                    Last seen {cardMeta.lastSeen}
                  </span>
                  <span className="text-[11px]" style={{ color: '#6b6b72' }}>
                    Difficulty:{' '}
                    <span
                      className="font-medium"
                      style={{
                        color:
                          cardMeta.difficulty === 'Hard'
                            ? '#f87171'
                            : cardMeta.difficulty === 'Medium'
                              ? '#fbbf24'
                              : '#4ade80',
                      }}
                    >
                      {cardMeta.difficulty}
                    </span>
                  </span>
                </div>
              )}

              {!showAnswer && currentCard.type !== 'typed' && currentCard.type !== 'cloze' && (
                <button
                  onClick={flipCard}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-t hover:brightness-110 select-none"
                  style={{ background: '#1e1e20', borderColor: 'var(--border)', color: '#6b6b72' }}
                >
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>↓</span>
                  Show Answer
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#0f0f11', border: '1px solid var(--border)', color: '#6b6b72' }}>
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
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors hover:bg-[var(--bg-surface)] mx-auto"
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
        style={{ background: 'var(--bg-base)', borderTop: '1px solid var(--border)' }}
      >
        {/* ← Back */}
        {!zenMode && (
        <button
          onClick={handleBack}
          disabled={!canGoBack}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            color: canGoBack ? '#e8e8ea' : '#3a3a42',
            cursor: canGoBack ? 'pointer' : 'not-allowed',
          }}
          title="Previous card"
        >
          <ArrowLeft size={15} />
        </button>
        )}

        {/* ↩ Undo */}
        {undoStack.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: '#a0a0b0' }}
            title="Undo last review (Ctrl+Z)"
          >
            <Undo2 size={12} />
            Undo
          </button>
        )}

        {/* → Skip */}
        {!zenMode && (
        <button
          onClick={handleSkip}
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: '#6b6b72' }}
          title="Skip card"
        >
          <ArrowRight size={15} />
        </button>
        )}

        <div className="flex-1" />

        {/* × Forgot */}
        <button
          onClick={() => answerReady && !isAnimating && handleRate(1)}
          disabled={!answerReady || isAnimating}
          className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all select-none"
          style={{
            background: answerReady ? '#2a1515' : 'var(--bg-surface)',
            border: `1px solid ${answerReady ? '#5a2020' : 'var(--border)'}`,
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
            background: answerReady ? '#0a2a15' : 'var(--bg-surface)',
            border: `1px solid ${answerReady ? '#1a5a30' : 'var(--border)'}`,
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
        <div className={cn('relative', zenMode && 'hidden')}>
          <button
            ref={optionsButtonRef}
            onClick={() => setShowOptionsMenu((v) => !v)}
            className="flex items-center justify-center w-9 h-9 rounded-lg transition-colors hover:bg-[var(--bg-surface)]"
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
                background: 'var(--bg-surface)',
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
                <tr className="border-b" style={{ borderColor: '#333338', background: 'var(--bg-surface)' }}>
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
        <div className="flex min-h-full items-center justify-center" style={{ background: 'var(--bg-base)' }}>
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
