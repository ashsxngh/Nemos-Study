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
  ChevronRight,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStudyStore } from '@/store/useStudyStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useExamStore } from '@/store/useExamStore'
import { useAppStore } from '@/store/useAppStore'
import { getWeakestCards } from '@/lib/examScheduler'
import { useSettingsStore } from '@/store/useSettingsStore'
import { ReviewCard } from '@/components/study/ReviewCard'
import { ConfidenceRating } from '@/components/study/ConfidenceRating'
import { Progress } from '@/components/ui/Progress'
import { Dialog } from '@/components/ui/Dialog'
import { CardEditor } from '@/components/library/CardEditor'
import { fsrsRetrievability } from '@/lib/srs'
import { restoreCardsFromTrash, createUndoTracker } from '@/lib/deleteUndo'
import { cn, formatDuration, formatDate, generateId } from '@/lib/utils'
import { toLocalDateStr } from '@/lib/formatDate'
import type { Card, Difficulty } from '@/lib/types'

// ── Session abandonment recovery ──────────────────────────────────────────────
// Snapshotted to sessionStorage on every queue/log change so a closed tab or
// mid-session navigation can be resumed on next load of this page.

const RECOVERY_KEY = 'nemos-session-recovery'

interface RecoverySnapshot {
  sessionId: string
  queue: Card[]
  currentIndex: number
  logs: ReturnType<typeof useStudyStore.getState>['logs']
  undoStack: ReturnType<typeof useStudyStore.getState>['undoStack']
  mode: ReturnType<typeof useStudyStore.getState>['mode']
  deckId?: string
  examId?: string
}

function saveRecovery(snapshot: RecoverySnapshot): void {
  try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(snapshot)) } catch { /* storage unavailable */ }
}

function loadRecovery(): RecoverySnapshot | null {
  try {
    const raw = sessionStorage.getItem(RECOVERY_KEY)
    return raw ? (JSON.parse(raw) as RecoverySnapshot) : null
  } catch {
    return null
  }
}

function clearRecovery(): void {
  try { sessionStorage.removeItem(RECOVERY_KEY) } catch { /* storage unavailable */ }
}

function formatKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'ArrowLeft') return '←'
  if (key === 'ArrowRight') return '→'
  if (key.length === 1) return key.toUpperCase()
  return key
}

const RATING_LABELS: Record<number, string> = { 1: 'Missed', 2: 'Hard', 3: 'Good', 4: 'Easy' }
const RATING_COLORS: Record<number, string> = {
  1: 'var(--text-muted)', 2: 'var(--warning)', 3: 'var(--accent)', 4: 'var(--success)',
}

function SessionContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const deckId = searchParams.get('deck') ?? undefined
  const examId = searchParams.get('examId') ?? undefined
  const modeParam = searchParams.get('mode')
  const deckNewCount = (() => { const v = parseInt(searchParams.get('newCount') ?? ''); return isNaN(v) ? null : v })()

  const {
    sessionId,
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
    getDeckReviewsAll,
    getDeckNewAll,
    getDeckBoth,
    reviewCard,
    decks,
    fsrsData,
    deleteCard,
    resetCardSRS,
    cards: allCards,
  } = useLibraryStore(
    useShallow((s) => ({
      getDueCards: s.getDueCards,
      getNewCards: s.getNewCards,
      getReviewsDue: s.getReviewsDue,
      getDeckReviewsAll: s.getDeckReviewsAll,
      getDeckNewAll: s.getDeckNewAll,
      getDeckBoth: s.getDeckBoth,
      reviewCard: s.reviewCard,
      decks: s.decks,
      fsrsData: s.fsrsData,
      deleteCard: s.deleteCard,
      resetCardSRS: s.resetCardSRS,
      cards: s.cards,
    }))
  )

  const reviewLogs = useHistoryStore((s) => s.reviewLogs)

  const exams = useExamStore((s) => s.exams)

  const { studyShortcuts, showSessionProgress, dailyCardTarget, sessionLength } = useSettingsStore(
    useShallow((s) => ({
      studyShortcuts: s.studyShortcuts,
      showSessionProgress: s.showSessionProgress,
      dailyCardTarget: s.dailyCardTarget,
      sessionLength: s.sessionLength,
    }))
  )

  const cardShownAtRef = useRef<number>(Date.now())
  // Tracks the persisted ReviewSession record (useHistoryStore.sessions) for
  // this study session — separate from useStudyStore's local sessionId.
  const librarySessionIdRef = useRef<string | null>(null)

  /* Resolve mode */
  const resolvedMode = (() => {
    if (modeParam === 'cram') return 'cram' as const
    if (modeParam === 'random') return 'random' as const
    if (modeParam === 'failed') return 'failed-only' as const
    if (modeParam === 'new') return 'new-only' as const
    if (modeParam === 'reviews') return 'reviews-only' as const
    if (modeParam === 'weakest') return 'cram' as const
    // Manual "Study" from a specific deck — every card in that deck, ignoring
    // due dates and the daily new-card limit. Distinct from 'standard' (the
    // due-date-driven inbox session) so stats/wasNew tracking stay separate.
    if (modeParam === 'deck-all') return 'deck-all' as const
    // Deck Study popup — three deck-scoped modes (see StudyModePopup).
    if (modeParam === 'deck-reviews') return 'deck-reviews' as const
    if (modeParam === 'deck-new') return 'deck-new' as const
    if (modeParam === 'deck-both') return 'deck-both' as const
    return 'standard' as const
  })()

  const startLibrarySession = useCallback(() => {
    const session = useHistoryStore.getState().startSession(deckId, resolvedMode)
    librarySessionIdRef.current = session.id
  }, [deckId, resolvedMode])

  const endLibrarySession = useCallback(() => {
    const sessionId = librarySessionIdRef.current
    if (!sessionId) return
    // Reviews only — wasNew graduations are new cards being learned, not
    // reviews, so they don't count toward the session's reviewed/accuracy
    // numbers (shown in RecentActivity).
    const sessionLogs = useStudyStore.getState().logs.filter((l) => !l.wasNew)
    const cardsReviewed = sessionLogs.length
    const cardsCorrect = sessionLogs.filter((l) => l.rating >= 2).length
    useHistoryStore.getState().endSession(sessionId, cardsReviewed, cardsCorrect)
    librarySessionIdRef.current = null
  }, [])

  // Tracks the most recent "D" quick-delete so Ctrl+Z/Ctrl+D can restore it from trash
  const quickDeleteTrackerRef = useRef(createUndoTracker<{ card: Card; index: number }>())

  // History for ← back navigation
  const [history, setHistory] = useState<number[]>([])
  const [showMoreRatings, setShowMoreRatings] = useState(false)
  const [showCardDetailsEnabled, setShowCardDetailsEnabled] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // Cards the user has dismissed the "struggle" prompt for, this session only.
  const [dismissedStruggleIds, setDismissedStruggleIds] = useState<Set<string>>(new Set())

  // Tracks whether the burnout check has run yet this session — it should
  // only fire once, at session start.
  const burnoutCheckedRef = useRef(false)

  // Burnout detection — gentle one-time nudge when rolling 3-day retention
  // drops well below the user's own historical baseline. Shown at session
  // start only, never mid-session.
  const [showBurnoutNudge, setShowBurnoutNudge] = useState(false)

  // Session abandonment recovery
  const [pendingRecovery, setPendingRecovery] = useState<RecoverySnapshot | null>(null)

  // Progress tracking (reviews only — new cards excluded)
  const [initialQueueLength, setInitialQueueLength] = useState(0)
  const [rememberedCount, setRememberedCount] = useState(0)
  const [forgottenReviewCount, setForgottenReviewCount] = useState(0)
  const [newCardReviewedCount, setNewCardReviewedCount] = useState(0)
  const [newCardCorrectCount, setNewCardCorrectCount] = useState(0)

  // Missed (rating 1, non-new) counter for badge and progress segment
  const [missedReviewCount, setMissedReviewCount] = useState(0)
  // Two-stage session end: 'first' = first pass in progress/done, 'retry' = reviewing missed cards
  const [sessionPhase, setSessionPhase] = useState<'first' | 'retry'>('first')

  // Card swipe animation
  const [animatingOut, setAnimatingOut] = useState<'left' | 'right' | 'delete' | null>(null)
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

  // Set just before reset()+router.push() on exit — reset() empties the queue
  // synchronously, which would otherwise make this component re-render with
  // an empty queue and flash "All caught up!" for the instant before the
  // navigation to /study actually completes.
  const isExitingRef = useRef(false)

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

    const { cards: rawCards, fsrsData: rawFsrs } = useLibraryStore.getState()
    const pool = (deckId
      ? rawCards.filter((c) => c.deckId === deckId)
      : rawCards
    ).filter((c) => !c.isArchived)

    if (resolvedMode === 'cram') return [...pool]
    // Manual deck Study button — all cards in the deck, no due-date filter,
    // no daily new-card cap, no sessionLength truncation.
    if (resolvedMode === 'deck-all') return [...pool]
    if (resolvedMode === 'random') return [...pool].sort(() => Math.random() - 0.5)
    if (resolvedMode === 'failed-only') {
      // Lapsed at least once, or current retrievability below 30% (new cards
      // score 0, so never-studied cards are included — same as before).
      return pool.filter((c) => {
        const fs = rawFsrs[c.id]
        return fs && (fs.lapses > 0 || fsrsRetrievability(fs) < 0.3)
      })
    }
    if (resolvedMode === 'new-only') return getNewCards(deckId)
    if (resolvedMode === 'reviews-only') return getReviewsDue(deckId)
    // Deck Study popup modes — deck-scoped, ignore the inbox entirely.
    if (resolvedMode === 'deck-reviews') return deckId ? getDeckReviewsAll(deckId) : []
    if (resolvedMode === 'deck-new') {
      if (!deckId) return []
      const all = getDeckNewAll(deckId)
      return deckNewCount != null ? all.slice(0, deckNewCount) : all
    }
    if (resolvedMode === 'deck-both') {
      if (!deckId) return []
      const reviews = getDeckReviewsAll(deckId)
      const allNew = getDeckNewAll(deckId)
      const newCards = deckNewCount != null ? allNew.slice(0, deckNewCount) : allNew
      const result: Card[] = []
      const max = Math.max(reviews.length, newCards.length)
      for (let i = 0; i < max; i++) {
        if (i < reviews.length) result.push(reviews[i])
        if (i < newCards.length) result.push(newCards[i])
      }
      return result
    }
    // Standard/inbox session — cap to the user's session length. The queue is
    // already ordered (due date + deck interleave + warmup), so truncating
    // here just drops the lowest-priority tail.
    return getDueCards(deckId).slice(0, sessionLength)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, examId, resolvedMode, sessionLength, deckNewCount])

  const checkBurnoutAndMaybeNudge = useCallback((): void => {
    const { lastBurnoutNudgeAt, setLastBurnoutNudgeAt } = useAppStore.getState()
    if (lastBurnoutNudgeAt && Date.now() - new Date(lastBurnoutNudgeAt).getTime() < 7 * 86400000) {
      return
    }
    const { reviewLogs: logs } = useHistoryStore.getState()
    const now = Date.now()
    const real = logs.filter((l) => !l.wasNew)
    const recent = real.filter((l) => now - new Date(l.reviewedAt).getTime() <= 3 * 86400000)
    const baseline = real.filter((l) => now - new Date(l.reviewedAt).getTime() > 3 * 86400000)
    // Require enough data in both windows — otherwise the comparison is noise.
    if (recent.length < 5 || baseline.length < 10) return
    const recentRetention = (recent.filter((l) => l.rating >= 3).length / recent.length) * 100
    const baselineRetention = (baseline.filter((l) => l.rating >= 3).length / baseline.length) * 100
    if (baselineRetention - recentRetention > 15) {
      setShowBurnoutNudge(true)
      setLastBurnoutNudgeAt(new Date().toISOString())
    }
  }, [])

  /* Starts a brand-new session — used on first load (no recovery offered/
     accepted) and when the user declines a resume prompt. */
  const beginFreshSession = useCallback(() => {
    const sessionCards = buildQueue()
    startSession(sessionCards, resolvedMode)
    startLibrarySession()
    setHistory([])
    setLoaded(true)
    // Progress bar denominator = review cards only; new cards tracked separately
    const lib = useLibraryStore.getState()
    const reviewCount = sessionCards.filter(
      (c) => (lib.fsrsData[c.id]?.state ?? 'new') !== 'new'
    ).length
    setInitialQueueLength(reviewCount)
    setRememberedCount(0)
    setForgottenReviewCount(0)
    setNewCardReviewedCount(0)
    setNewCardCorrectCount(0)
    setMissedReviewCount(0)
    setSessionPhase('first')
    if (!burnoutCheckedRef.current && sessionCards.length > 0) {
      burnoutCheckedRef.current = true
      checkBurnoutAndMaybeNudge()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildQueue, resolvedMode])

  const handleResumeSession = useCallback(() => {
    if (!pendingRecovery) return
    useStudyStore.setState({
      sessionId: pendingRecovery.sessionId,
      queue: pendingRecovery.queue,
      currentIndex: pendingRecovery.currentIndex,
      logs: pendingRecovery.logs,
      undoStack: pendingRecovery.undoStack,
      showAnswer: false,
      startedAt: new Date(),
      mode: pendingRecovery.mode,
    })
    startLibrarySession()
    setHistory([])
    setLoaded(true)
    const lib = useLibraryStore.getState()
    const reviewCount = pendingRecovery.queue.filter(
      (c) => (lib.fsrsData[c.id]?.state ?? 'new') !== 'new'
    ).length
    setInitialQueueLength(reviewCount)
    setRememberedCount(pendingRecovery.logs.filter((l) => !l.wasNew && l.rating >= 3).length)
    setForgottenReviewCount(pendingRecovery.logs.filter((l) => !l.wasNew && l.rating < 3).length)
    setNewCardReviewedCount(pendingRecovery.logs.filter((l) => l.wasNew).length)
    setNewCardCorrectCount(pendingRecovery.logs.filter((l) => l.wasNew && l.rating >= 3).length)
    setMissedReviewCount(pendingRecovery.logs.filter((l) => !l.wasNew && l.rating === 1).length)
    setSessionPhase('first')
    setPendingRecovery(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRecovery])

  const handleDiscardRecovery = useCallback(() => {
    clearRecovery()
    setPendingRecovery(null)
    beginFreshSession()
  }, [beginFreshSession])

  /* ── Load cards on mount — check for an abandoned session first ── */
  useEffect(() => {
    const saved = loadRecovery()
    const matches = saved
      && saved.queue.length > 0
      && saved.currentIndex < saved.queue.length
      && saved.deckId === deckId
      && saved.examId === examId
      && saved.mode === resolvedMode
    if (matches) {
      setPendingRecovery(saved)
    } else {
      if (saved) clearRecovery() // stale/mismatched snapshot — drop it
      beginFreshSession()
    }
    // End the persisted session record if the user navigates away/closes the tab
    // mid-session, rather than via the Exit/Back-to-Study buttons.
    return () => endLibrarySession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* Persist an in-progress session snapshot on every change so it can be
     recovered if the tab closes or the user navigates away mid-session. */
  useEffect(() => {
    if (!loaded || !sessionId || pendingRecovery) return
    if (currentIndex >= queue.length) {
      clearRecovery()
      return
    }
    saveRecovery({ sessionId, queue, currentIndex, logs, undoStack, mode, deckId, examId })
  }, [loaded, sessionId, queue, currentIndex, logs, undoStack, mode, deckId, examId, pendingRecovery])

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
  const isCurrentCardNew =
    !!currentCard && (fsrsData[currentCard.id]?.state ?? 'new') === 'new'

  /* Card metadata — last seen, derived from FSRS data */
  const cardMeta = (() => {
    if (!currentCard) return null
    const lastReviewedAt = fsrsData[currentCard.id]?.lastReviewedAt
    if (!lastReviewedAt) return null

    const days = Math.floor((Date.now() - new Date(lastReviewedAt).getTime()) / 86400000)
    const lastSeen = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
    return { lastSeen }
  })()

  /* Retention transparency — raw scheduling numbers behind the rating, shown
     collapsed by default. */
  const retentionInfo = (() => {
    if (!currentCard) return null
    const fs = fsrsData[currentCard.id]
    if (!fs) return null
    const due = new Date(fs.dueDate)
    const daysDiff = Math.round((due.getTime() - Date.now()) / 86400000)
    return {
      stability: fs.stability,
      retrievability: Math.round(fsrsRetrievability(fs) * 100),
      daysDiff,
      state: fs.state,
    }
  })()

  /* Struggle acknowledgment — card failed (rating 1) 3+ times across its
     full history. Surfaced as a dismissible, non-blocking prompt; never
     interrupts rating/flipping. */
  const struggleCount = currentCard
    ? reviewLogs.filter((l) => l.cardId === currentCard.id && l.rating === 1).length
    : 0
  const showStrugglePrompt =
    !!currentCard && struggleCount >= 3 && !dismissedStruggleIds.has(currentCard.id)

  /* Daily progress — today's reviews vs daily card target */
  const todayStr = toLocalDateStr(new Date())
  const todayReviewCount = reviewLogs.filter((l) => toLocalDateStr(new Date(l.reviewedAt)) === todayStr).length
  const dailyPct = Math.min(100, Math.round((todayReviewCount / Math.max(dailyCardTarget, 1)) * 100))

  /* ── Rate a card ── */
  const handleRate = useCallback(
    (rating: Difficulty) => {
      if (ratingInFlightRef.current) return
      const card = queue[currentIndex]
      if (!card || animatingOut) return
      ratingInFlightRef.current = true

      const isNew = (useLibraryStore.getState().fsrsData[card.id]?.state ?? 'new') === 'new'

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
      const prevFSRS = useLibraryStore.getState().fsrsData[card.id]

      const logId = generateId()
      addLog({
        cardId: card.id,
        userId: card.userId,
        rating,
        responseMs,
        reviewedAt: new Date().toISOString(),
        scheduledInterval: 0,
        ease: 0,
        wasNew: isNew,
      })

      reviewCard(card.id, rating, responseMs)

      // Update progress bar counters (new cards excluded from review metrics)
      if (isNew) {
        setNewCardReviewedCount((c) => c + 1)
        if (rating >= 3) setNewCardCorrectCount((c) => c + 1)
      } else if (rating >= 3) {
        setRememberedCount((c) => c + 1)
      } else {
        setForgottenReviewCount((c) => c + 1)
        if (rating === 1) setMissedReviewCount((c) => c + 1)
      }

      if (prevFSRS) pushUndo(card.id, prevFSRS, logId, isNew, rating)
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
    [queue, currentIndex, deckId, animatingOut]
  )

  /* ── Undo last review ── */
  const handleUndo = useCallback(() => {
    const entry = popUndo()
    if (!entry) return
    // Guard against a pre-FSRS-only recovery snapshot missing the field
    if (entry.prevFSRS) useLibraryStore.getState().setFSRSData(entry.cardId, entry.prevFSRS)
    useHistoryStore.getState().removeLastLog()
    decrementIndex()
    if (entry.isNew) {
      setNewCardReviewedCount((c) => Math.max(0, c - 1))
      if (entry.rating >= 3) setNewCardCorrectCount((c) => Math.max(0, c - 1))
    } else if (entry.rating >= 3) {
      setRememberedCount((c) => Math.max(0, c - 1))
    } else {
      setForgottenReviewCount((c) => Math.max(0, c - 1))
      if (entry.rating === 1) setMissedReviewCount((c) => Math.max(0, c - 1))
    }
    useAppStore.getState().addToast({ type: 'info', message: 'Undid last review', duration: 2000 })
  }, [popUndo, decrementIndex])

  /* ── Go back one card in history ── */
  function handleBack() {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory((h) => h.slice(0, -1))
    // Only move the cursor back — never truncate the queue. Slicing the
    // queue here used to be able to shrink it to zero-length in edge cases
    // (e.g. stepping back right as the last card completed the session),
    // which made the "All caught up" empty-inbox screen flash instead of
    // the normal card view.
    reorderQueue(queue, prev)
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
    if (!card || animatingOut) return
    setShowOptionsMenu(false)
    setShowDeleteConfirm(false)
    setAnimatingOut('delete')
    setTimeout(() => {
      setAnimatingOut(null)
      deleteCard(card.id)
      removeCurrentCard()
      useAppStore.getState().addToast({ type: 'info', message: 'Card deleted', duration: 2000 })
    }, 160)
  }

  /* ── D shortcut: instantly trash the current card, no confirm ── */
  function handleQuickDelete() {
    const card = queue[currentIndex]
    if (!card || animatingOut) return
    quickDeleteTrackerRef.current.track({ card, index: currentIndex })
    setAnimatingOut('delete')
    setTimeout(() => {
      setAnimatingOut(null)
      deleteCard(card.id)
      removeCurrentCard()
      useAppStore.getState().addToast({
        type: 'info',
        message: 'Card deleted — Undo?',
        duration: 5000,
        action: { label: 'Undo', onClick: () => handleUndoQuickDelete() },
      })
    }, 160)
  }

  /* ── Ctrl+Z/Ctrl+D: restore the last "D"-trashed card from trash, back into the queue ── */
  function handleUndoQuickDelete() {
    const pending = quickDeleteTrackerRef.current.consume()
    if (!pending) {
      useAppStore.getState().addToast({ type: 'info', message: 'Nothing to undo', duration: 2000 })
      return
    }
    restoreCardsFromTrash([pending.card.id], new Map([[pending.card.id, pending.card]]))

    const newQueue = [...queue]
    const insertAt = Math.min(pending.index, newQueue.length)
    newQueue.splice(insertAt, 0, pending.card)
    reorderQueue(newQueue, insertAt)

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
      if (showEditDialog || showHistoryDialog || showDeleteConfirm || showBurnoutNudge) return

      // Ctrl/Cmd+Z — if a "D" quick-delete toast is still active (within its
      // 5s undo window), undo that delete first; otherwise undo the last
      // rating. Mirrors clicking the toast's own Undo button.
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        if (quickDeleteTrackerRef.current.peek()) handleUndoQuickDelete()
        else handleUndo()
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
  }, [showAnswer, currentIndex, queue, history, handleUndo, studyShortcuts, showEditDialog, showHistoryDialog, showDeleteConfirm, showBurnoutNudge])

  const isFirstPassDone = loaded && queue.length > 0 && currentIndex >= queue.length && sessionPhase === 'first'
  const isSessionDone = loaded && queue.length > 0 && currentIndex >= queue.length && sessionPhase === 'retry'
  const isComplete = isFirstPassDone || isSessionDone
  const isLoading = !loaded
  const hasNoCards = loaded && queue.length === 0

  // Missed cards from first pass (for intermediate screen and retry queue)
  const firstPassMissedCards: Card[] = isFirstPassDone ? (() => {
    const lastRatings = new Map<string, number>()
    for (const log of logs) lastRatings.set(log.cardId, log.rating)
    const missedIds = new Set([...lastRatings.entries()].filter(([, r]) => r === 1).map(([id]) => id))
    return queue.filter((c) => missedIds.has(c.id))
  })() : []
  const showIntermediate = isFirstPassDone && firstPassMissedCards.length > 0
  const showCompletion = isSessionDone || (isFirstPassDone && firstPassMissedCards.length === 0)

  // Close out the persisted ReviewSession record only on true completion
  useEffect(() => {
    if (showCompletion) endLibrarySession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCompletion])

  /* ════════════════════════════════════════════════════════════
     SESSION RECOVERY PROMPT — shown before anything else loads
  ════════════════════════════════════════════════════════════ */
  if (pendingRecovery) {
    const remaining = pendingRecovery.queue.length - pendingRecovery.currentIndex
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-sm rounded-xl overflow-hidden animate-fade-in" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="p-6 text-center space-y-2">
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Resume your session?</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              You left off with {remaining} {remaining === 1 ? 'card' : 'cards'} still to go.
            </p>
          </div>
          <div className="flex border-t" style={{ borderColor: 'var(--border)' }}>
            <button
              onClick={handleDiscardRecovery}
              className="flex-1 py-3 text-sm font-medium border-r transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Start fresh
            </button>
            <button
              onClick={handleResumeSession}
              className="flex-1 py-3 text-sm font-medium transition-colors hover:brightness-110"
              style={{ color: 'var(--accent)' }}
            >
              Resume
            </button>
          </div>
        </div>
      </div>
    )
  }

  const total = Math.max(initialQueueLength, 1)
  const rawGreenPct = (rememberedCount / total) * 100
  const greenPct = Math.min(100, rawGreenPct)
  const missPct = Math.min(100 - greenPct, (missedReviewCount / total) * 100)

  // Mid-exit — render a loading skeleton instead of letting the now-empty
  // queue fall through to the "All caught up!" empty-inbox screen below.
  if (isExitingRef.current) {
    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6" style={{ background: 'var(--bg-base)' }}>
        <div className="space-y-3 animate-pulse">
          <div className="skeleton w-48 h-4 mx-auto rounded" />
          <div className="skeleton w-32 h-4 mx-auto rounded" />
        </div>
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════
     INTERMEDIATE SCREEN — first pass done, missed cards remain
  ════════════════════════════════════════════════════════════ */
  if (showIntermediate) {
    const reviewedNonNew = rememberedCount + forgottenReviewCount
    const rememberedPct = reviewedNonNew > 0 ? Math.round((rememberedCount / reviewedNonNew) * 100) : 0
    const missedN = firstPassMissedCards.length

    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6 focus-gradient">
        <div className="w-full max-w-[560px] animate-fade-in space-y-6">
          <div className="text-center space-y-2">
            <p className="meta-label text-[var(--text-muted)]">Session Checkpoint</p>
            <p className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              You remembered <span style={{ color: 'var(--accent)' }}>{rememberedPct}%</span> of cards.
            </p>
            <p className="text-[15px]" style={{ color: 'var(--text-secondary)' }}>
              Review the cards you missed again while the concepts are fresh.
            </p>
          </div>
          <button
            onClick={() => {
              reorderQueue(firstPassMissedCards, 0)
              setSessionPhase('retry')
              setMissedReviewCount(0)
            }}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-[var(--radius-lg)] text-[15px] font-bold active:scale-[0.98] transition-transform"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            <RotateCcw size={16} />
            Review missed cards ({missedN})
          </button>
          <button
            onClick={() => setSessionPhase('retry')}
            className="w-full text-center text-[15px] py-4 rounded-[var(--radius-lg)] transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)', cursor: 'pointer' }}
          >
            Skip and finish
          </button>
        </div>
      </div>
    )
  }

  /* ════════════════════════════════════════════════════════════
     SESSION COMPLETE
  ════════════════════════════════════════════════════════════ */
  if (showCompletion) {
    const totalLogged = logs.length - newCardReviewedCount
    const correct = logs.filter((l) => l.rating >= 3).length - newCardCorrectCount
    const accuracy = totalLogged > 0 ? Math.round((correct / totalLogged) * 100) : 0
    const elapsed = startedAt ? Math.round((Date.now() - startedAt.getTime()) / 1000) : 0

    return (
      <div className="flex flex-col items-center justify-center flex-1 p-6 focus-gradient">
        <div className="w-full max-w-[640px] animate-fade-in space-y-6">
          {/* Header — Stitch session summary */}
          <div className="text-center space-y-2">
            <p className="meta-label text-[var(--text-muted)]">Session Summary</p>
            <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              You&apos;ve completed your review{deckName && deckName !== 'All cards' ? ' of ' : '.'}
              {deckName && deckName !== 'All cards' && <span style={{ color: 'var(--accent)' }}>{deckName}</span>}
            </h1>
          </div>

          {/* Stat tiles — mono labels, display numbers */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Accuracy', value: `${accuracy}%`, accent: true },
              { label: 'Cards', value: String(totalLogged), sub: `${formatDuration(elapsed)} elapsed` },
              { label: 'Correct', value: String(correct) },
            ].map(({ label, value, sub, accent }) => (
              <div key={label} className="card-surface p-6 text-center">
                <p className="meta-label text-[var(--text-secondary)] mb-3">{label}</p>
                <p className="text-[2.25rem] font-semibold tracking-tight leading-none" style={{ color: accent ? 'var(--accent)' : 'var(--text-primary)' }}>
                  {value}
                </p>
                {sub && <p className="font-mono text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
              </div>
            ))}
          </div>

          {/* Recall breakdown bar */}
          <div className="card-surface p-6">
            <div className="flex justify-between mb-3">
              <span className="font-mono text-[13px]" style={{ color: 'var(--text-secondary)' }}>Recall Breakdown</span>
              <span className="font-mono text-[13px]" style={{ color: totalLogged - correct > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                {totalLogged - correct} {totalLogged - correct === 1 ? 'card' : 'cards'} missed
              </span>
            </div>
            <Progress value={accuracy} max={100} size="lg" color={accuracy >= 80 ? 'success' : accuracy >= 60 ? 'accent' : 'danger'} />
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                const cards = buildQueue()
                startSession(cards, resolvedMode)
                startLibrarySession()
                setHistory([])
                setLoaded(true)
                const lib = useLibraryStore.getState()
                const reviewCount = cards.filter(
                  (c) => (lib.fsrsData[c.id]?.state ?? 'new') !== 'new'
                ).length
                setInitialQueueLength(reviewCount)
                setRememberedCount(0)
                setForgottenReviewCount(0)
                setNewCardReviewedCount(0)
                setNewCardCorrectCount(0)
                setMissedReviewCount(0)
                setSessionPhase('first')
              }}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-[var(--radius-lg)] text-[15px] font-bold active:scale-[0.98] transition-transform"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              <RotateCcw size={16} />
              Review Again
            </button>
            <button
              onClick={() => { isExitingRef.current = true; clearRecovery(); endLibrarySession(); reset(); router.push('/study') }}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-[var(--radius-lg)] text-[15px] transition-colors hover:bg-[var(--bg-hover)]"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <ArrowLeft size={16} />
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
              <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>All caught up!</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No cards due. Come back later.</p>
              <Link href="/study">
                <button
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
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

  // Queue progress for the Stitch top-right ring — same position data as the
  // old "N / M" counter, expressed as a percentage.
  const queuePct = queue.length > 0 ? Math.round((currentIndex / queue.length) * 100) : 0

  return (
    <div
      className={cn('flex flex-col focus-gradient relative', zenMode ? 'fixed inset-0 z-50' : 'h-full')}
    >
      {/* ── Atmosphere glows (Stitch session backdrop) ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-1/4 -right-20 w-96 h-96 rounded-full" style={{ background: 'color-mix(in srgb, var(--accent) 5%, transparent)', filter: 'blur(120px)' }} />
        <div className="absolute bottom-1/4 -left-20 w-96 h-96 rounded-full" style={{ background: 'color-mix(in srgb, var(--warning) 5%, transparent)', filter: 'blur(120px)' }} />
      </div>

      {/* ── Progress bar ── */}
      {showSessionProgress && !zenMode && (
        <div className="h-[3px] w-full shrink-0 flex relative z-10" style={{ background: 'var(--border)' }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${greenPct}%`, background: 'var(--success)' }}
          />
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${missPct}%`, background: 'color-mix(in srgb, var(--danger) 45%, var(--bg-base))' }}
          />
        </div>
      )}

      {/* ── Top bar — Stitch: h-16 borderless translucent, breadcrumb left,
             Focus Mode center, Session Progress ring right ── */}
      {!zenMode && (
      <div className="flex items-center h-16 px-6 gap-4 shrink-0 relative z-10 bg-[var(--bg-base)]/80 backdrop-blur-md">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <button
            onClick={() => { isExitingRef.current = true; clearRecovery(); endLibrarySession(); reset(); router.push('/study') }}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-colors hover:bg-[var(--bg-active)] active:scale-95 duration-150 shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="Exit session"
          >
            <ArrowLeft size={19} />
          </button>
          <span className="font-mono text-[13px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
            {deckName}
          </span>

          {isCurrentCardNew && (
            <>
              <ChevronRight size={14} className="shrink-0" style={{ color: 'var(--text-muted)' }} />
              <span
                className="font-mono text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full shrink-0"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
              >
                New
              </span>
            </>
          )}
        </div>

        {/* Center: Focus Mode + shuffle */}
        <div className="flex items-center gap-1 justify-center">
          <button
            onClick={() => setZenMode(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors hover:bg-[var(--bg-hover)] group"
            style={{ color: 'var(--text-secondary)' }}
            title="Zen mode (Z)"
          >
            <Focus size={17} className="group-hover:text-[var(--accent)] transition-colors" />
            <span className="font-mono text-[11px] font-medium">Focus Mode</span>
          </button>
          <button
            onClick={handleShuffle}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
            title="Shuffle remaining"
          >
            <Shuffle size={16} />
          </button>
        </div>

        <div className="flex items-center gap-4 flex-1 justify-end min-w-0">
          {/* Mistake counter badge — hidden until first miss */}
          {missedReviewCount > 0 && (
            <span
              className="font-mono text-[11px] font-semibold tabular-nums px-2 py-1 rounded-[var(--radius-sm)]"
              style={{ background: 'var(--danger-subtle)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}
            >
              ✕ {missedReviewCount}
            </span>
          )}

          {/* Daily progress */}
          <div
            className="hidden md:flex items-center gap-2"
            title={`${todayReviewCount} of ${dailyCardTarget} cards studied today`}
          >
            <span className="font-mono text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
              Today
            </span>
            <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${dailyPct}%`, background: 'var(--accent)' }}
              />
            </div>
            <span className="font-mono text-[10px] tabular-nums font-semibold" style={{ color: 'var(--accent)' }}>
              {dailyPct}%
            </span>
          </div>

          {/* Session Progress — mono label + % + ring (Stitch top-right cluster) */}
          {deckId && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex flex-col items-end">
                <span className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Session Progress
                </span>
                <span className="font-mono text-lg font-semibold leading-none mt-0.5" style={{ color: 'var(--accent)' }}>
                  {queuePct}%
                </span>
              </div>
              <div className="relative flex items-center justify-center w-10 h-10">
                <svg className="w-full h-full" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" strokeWidth="3" stroke="var(--bg-active)"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" strokeWidth="3" stroke="var(--accent)" strokeLinecap="round"
                    strokeDasharray={`${queuePct}, 100`}
                    style={{ transition: 'stroke-dasharray 0.35s' }}
                  />
                </svg>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Zen mode exit button ── */}
      {zenMode && (
        <button
          onClick={() => setZenMode(false)}
          className="absolute top-4 right-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          title="Exit Zen mode (Esc)"
        >
          <X size={12} />
          Exit Zen
        </button>
      )}

      {/* ── Scrollable card area ── Stitch: card floats centered in a vast focus space */}
      <div className="flex-1 px-6 py-6 overflow-y-auto flex flex-col items-center justify-center relative z-10">
        <div className={cn('w-full max-w-[720px] mx-auto', zenMode && 'pt-12')}>

          {/* Zen mode header — deck chip + counter */}
          {zenMode && (
            <div className="flex flex-col items-center gap-2 mb-8 animate-fade-in">
              <span
                className="font-mono text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}
              >
                {deckName}
              </span>
              {deckId && (
                <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  Card {currentIndex + 1} of {queue.length}
                </span>
              )}
            </div>
          )}

          {/* Struggle acknowledgment — subtle, dismissible, never blocks the flow */}
          {showStrugglePrompt && (
            <div
              className="flex items-center gap-2.5 mb-3 px-3.5 py-2.5 rounded-lg animate-fade-in"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
            >
              <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
                This one keeps coming back — want to edit the card or add a hint?
              </span>
              <button
                onClick={() => setShowEditDialog(true)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md font-medium transition-colors hover:brightness-110"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                <Pencil size={11} />
                Edit
              </button>
              <button
                onClick={() => setDismissedStruggleIds((s) => new Set(s).add(currentCard!.id))}
                className="text-xs px-2 py-1 rounded-md transition-colors hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-muted)' }}
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Card with swipe animation */}
          <div
            className={cn(
              animatingOut === 'left' && 'animate-swipe-left',
              animatingOut === 'right' && 'animate-swipe-right',
              animatingOut === 'delete' && 'animate-delete-out'
            )}
          >
            <div
              className="relative glass rounded-[var(--radius-lg)] overflow-hidden w-full shadow-lg"
            >
              {/* Subtle deck name — corner of the card, not the page chrome */}
              <span
                className="absolute top-2.5 right-3.5 font-mono text-[10px] uppercase tracking-wider truncate max-w-[40%] pointer-events-none select-none"
                style={{ color: 'var(--text-muted)', opacity: 0.7 }}
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
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    Last seen {cardMeta.lastSeen}
                  </span>
                </div>
              )}

              {/* Retention transparency panel — shown when "Show card details" is on */}
              {showCardDetailsEnabled && retentionInfo && (
                <div className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <div className="grid grid-cols-4 gap-2 px-4 py-2.5">
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Stability</p>
                      <p className="font-mono text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{retentionInfo.stability.toFixed(1)}d</p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Retrievability</p>
                      <p className="font-mono text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{retentionInfo.retrievability}%</p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                        {retentionInfo.daysDiff <= 0 ? 'Overdue' : 'Due in'}
                      </p>
                      <p className="font-mono text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {retentionInfo.daysDiff === 0 ? 'Today' : `${Math.abs(retentionInfo.daysDiff)}d`}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>State</p>
                      <p className="font-mono text-xs font-medium capitalize" style={{ color: 'var(--text-secondary)' }}>{retentionInfo.state}</p>
                    </div>
                  </div>
                </div>
              )}

              {!showAnswer && currentCard.type !== 'typed' && currentCard.type !== 'cloze' && (
                <button
                  onClick={flipCard}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-t hover:brightness-110 select-none"
                  style={{ background: 'var(--bg-surface)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                >
                  <span style={{ fontSize: '1rem', lineHeight: 1 }}>↓</span>
                  Show Answer
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
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
                style={{ color: 'var(--text-muted)' }}
              >
                <MoreHorizontal size={12} />
                {showMoreRatings ? 'Fewer options' : 'More rating options'}
              </button>
              {showMoreRatings && (
                <div className="mt-3 animate-fade-in">
                  <ConfidenceRating onRate={handleRate} fsrs={fsrsData[currentCard.id]} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom rating bar — Stitch: h-24 surface-container-low, borderless,
             undo/nav left · big binary buttons center · More right ── */}
      <div
        className="flex items-center px-6 h-24 gap-4 shrink-0 relative z-10"
        style={{ background: zenMode ? 'transparent' : 'var(--bg-inset)' }}
      >
        <div className="flex-1 flex items-center gap-2 min-w-0">
          {/* ↩ Undo */}
          {undoStack.length > 0 && (
            <button
              onClick={handleUndo}
              className="flex items-center justify-center w-12 h-12 rounded-lg transition-colors hover:bg-[var(--bg-active)] active:scale-90 shrink-0"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              title="Undo last review (Ctrl+Z)"
            >
              <Undo2 size={18} />
            </button>
          )}

          {!zenMode && undoStack.length > 0 && (
            <div className="h-6 w-px mx-2 shrink-0" style={{ background: 'var(--border)' }} />
          )}

          {/* ← Back */}
          {!zenMode && (
          <button
            onClick={handleBack}
            disabled={!canGoBack}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-colors hover:bg-[var(--bg-active)] shrink-0"
            style={{
              color: canGoBack ? 'var(--text-secondary)' : 'var(--border-strong)',
              cursor: canGoBack ? 'pointer' : 'not-allowed',
            }}
            title="Previous card"
          >
            <ArrowLeft size={18} />
          </button>
          )}

          {/* → Skip */}
          {!zenMode && (
          <button
            onClick={handleSkip}
            className="flex items-center justify-center w-10 h-10 rounded-full transition-colors hover:bg-[var(--bg-active)] shrink-0"
            style={{ color: 'var(--text-secondary)' }}
            title="Skip card"
          >
            <ArrowRight size={18} />
          </button>
          )}
        </div>

        {/* Binary rating — Stitch: big two-line buttons, min-w 180 */}
        <div className="flex justify-center gap-4 shrink-0">
          {/* ✕ Missed (rating 1) — ghost with red border */}
          <button
            onClick={() => answerReady && !isAnimating && handleRate(1)}
            disabled={!answerReady || isAnimating}
            className="group flex items-center justify-center gap-3.5 px-8 py-3 rounded-[var(--radius-lg)] min-w-[180px] transition-all duration-200 select-none active:scale-95"
            style={{
              background: answerReady ? 'var(--bg-surface)' : 'transparent',
              border: `1px solid ${answerReady ? 'color-mix(in srgb, var(--danger) 40%, transparent)' : 'var(--border)'}`,
              cursor: answerReady && !isAnimating ? 'pointer' : 'not-allowed',
            }}
            title={`Missed (${formatKey(studyShortcuts.forgot)})`}
          >
            <span className="text-lg leading-none" style={{ color: answerReady ? 'var(--danger)' : 'var(--border-strong)' }}>✕</span>
            <span className="flex flex-col items-start">
              <span className="text-[17px] font-medium leading-none" style={{ color: answerReady ? 'var(--text-primary)' : 'var(--border-strong)' }}>
                Missed
              </span>
              {answerReady && (
                <span className="font-mono text-[10px] mt-1 leading-none opacity-70" style={{ color: 'var(--danger)' }}>
                  {formatKey(studyShortcuts.forgot)}
                </span>
              )}
            </span>
          </button>

          {/* ✓ Remembered — periwinkle fill, dark indigo text */}
          <button
            onClick={() => answerReady && !isAnimating && handleRate(4)}
            disabled={!answerReady || isAnimating}
            className="group flex items-center justify-center gap-3.5 px-8 py-3 rounded-[var(--radius-lg)] min-w-[180px] transition-all duration-200 select-none active:scale-95"
            style={{
              background: answerReady ? 'var(--accent)' : 'var(--bg-surface)',
              border: `1px solid ${answerReady ? 'var(--accent)' : 'var(--border)'}`,
              cursor: answerReady && !isAnimating ? 'pointer' : 'not-allowed',
            }}
            title={`Remembered (${formatKey(studyShortcuts.remembered)})`}
          >
            <span className="text-lg leading-none" style={{ color: answerReady ? 'var(--accent-fg)' : 'var(--border-strong)' }}>✓</span>
            <span className="flex flex-col items-start">
              <span className="text-[17px] font-medium leading-none" style={{ color: answerReady ? 'var(--accent-fg)' : 'var(--border-strong)' }}>
                Remembered
              </span>
              {answerReady && (
                <span className="font-mono text-[10px] mt-1 leading-none opacity-70" style={{ color: 'var(--accent-fg)' }}>
                  {formatKey(studyShortcuts.remembered)}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* … Options */}
        <div className={cn('flex-1 flex justify-end', zenMode && 'invisible')}>
        <div className="relative">
          <button
            ref={optionsButtonRef}
            onClick={() => setShowOptionsMenu((v) => !v)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg transition-colors hover:bg-[var(--bg-active)]"
            style={{ color: showOptionsMenu ? 'var(--accent)' : 'var(--text-secondary)' }}
            title="Options"
          >
            <span className="font-mono text-[13px] font-medium">More</span>
            <MoreHorizontal size={18} />
          </button>

          {showOptionsMenu && (
            <div
              ref={optionsMenuRef}
              className="absolute bottom-12 right-0 w-52 rounded-xl overflow-hidden animate-scale-in"
              style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-strong)',
                boxShadow: '0 8px 24px -4px rgba(0,0,0,0.5)',
                zIndex: 10,
              }}
            >
              <button
                onClick={() => { setShowOptionsMenu(false); setShowEditDialog(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
              >
                <Pencil size={13} style={{ color: 'var(--text-secondary)' }} />
                Edit card
              </button>
              <button
                onClick={handleResetSRS}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
              >
                <RefreshCw size={13} style={{ color: 'var(--text-secondary)' }} />
                Reset review history
              </button>
              <button
                onClick={() => { setShowOptionsMenu(false); setShowHistoryDialog(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[var(--bg-hover)] transition-colors"
                style={{ color: 'var(--text-primary)' }}
              >
                <History size={13} style={{ color: 'var(--text-secondary)' }} />
                Review history
              </button>
              <div className="border-t mx-3" style={{ borderColor: 'var(--border-strong)' }} />
              <div className="w-full flex items-center justify-between gap-2.5 px-3 py-2.5 text-xs">
                <span style={{ color: 'var(--text-primary)' }}>Show card details</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showCardDetailsEnabled}
                  onClick={() => setShowCardDetailsEnabled((v) => !v)}
                  className="w-8 h-[18px] rounded-full relative transition-colors duration-150 shrink-0"
                  style={{ background: showCardDetailsEnabled ? 'var(--accent)' : 'var(--border-strong)' }}
                >
                  <div
                    className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-transform duration-150"
                    style={{ background: '#fff', transform: showCardDetailsEnabled ? 'translateX(16px)' : 'translateX(2px)' }}
                  />
                </button>
              </div>
              <div className="border-t mx-3" style={{ borderColor: 'var(--border-strong)' }} />
              <button
                onClick={() => { setShowOptionsMenu(false); setShowDeleteConfirm(true) }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-left hover:bg-[var(--danger-subtle)] transition-colors"
                style={{ color: 'var(--danger)' }}
              >
                <Trash2 size={13} />
                Delete card
              </button>
            </div>
          )}
        </div>
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
            <div className="p-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              No review history yet.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b" style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-surface)' }}>
                  <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>Date</th>
                  <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>Rating</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>Response</th>
                  <th className="text-right px-4 py-2.5 font-medium" style={{ color: 'var(--text-secondary)' }}>Interval</th>
                </tr>
              </thead>
              <tbody>
                {cardLogs.map((log, i) => (
                  <tr
                    key={log.id ?? i}
                    className="border-b last:border-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <td className="px-4 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(log.reviewedAt)}
                    </td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: RATING_COLORS[log.rating] }}>
                      {RATING_LABELS[log.rating] ?? log.rating}
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {log.responseMs > 0 ? `${(log.responseMs / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {log.scheduledInterval > 0 ? `${log.scheduledInterval}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Dialog>

      {/* ── Burnout nudge — gentle, one-time, shown only at session start ── */}
      <Dialog
        open={showBurnoutNudge}
        onClose={() => setShowBurnoutNudge(false)}
        title="Just so you know"
        size="sm"
      >
        <div className="p-4 space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Your retention is lower than usual — a shorter session today is totally fine.
          </p>
          <div className="flex justify-end">
            <button
              onClick={() => setShowBurnoutNudge(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:brightness-110"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              Got it
            </button>
          </div>
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
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteCard}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: 'var(--danger-subtle)', border: '1px solid color-mix(in srgb, var(--danger) 35%, transparent)', color: 'var(--danger)' }}
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
