'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar, CheckSquare, Timer, ChevronLeft, ChevronRight, ChevronDown,
  Plus, X, BookOpen, Folder, AlertTriangle, Target, Settings, Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useShallow } from 'zustand/react/shallow'
import { cn, formatDate } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import {
  computeExamRetentionStats,
  computePerTopicBreakdown,
  getExamCards,
  getExamDeckIds,
} from '@/lib/examScheduler'
import type { Exam, Folder as FolderModel, Deck as DeckModel } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface PlannerPageProps {
  addingExam?: boolean
  onExamAdded?: () => void
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(dateStr + 'T00:00').getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

// ── Small components ───────────────────────────────────────────────────────────

function ReadinessRing({ pct }: { pct: number }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - Math.min(100, Math.max(0, pct)) / 100)
  const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--warning)' : 'var(--danger)'

  return (
    <svg width="88" height="88" viewBox="0 0 88 88" className="shrink-0">
      <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--bg-active)" strokeWidth="7" />
      <circle
        cx="44" cy="44" r={radius}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 44 44)"
        style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.4s ease' }}
      />
      <text x="44" y="41" textAnchor="middle" dominantBaseline="middle" fontSize="15" fontWeight="800" fill={color}>
        {pct}%
      </text>
      <text x="44" y="56" textAnchor="middle" dominantBaseline="middle" fontSize="9" fill="var(--text-muted)">
        ready
      </text>
    </svg>
  )
}

function StarRatingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="text-2xl leading-none transition-colors"
          style={{ color: star <= (hovered || value) ? 'var(--warning)' : 'var(--border-strong)' }}
        >
          ★
        </button>
      ))}
    </div>
  )
}

// ── Folder tree browser ────────────────────────────────────────────────────────

interface FolderTreeRowProps {
  folder: FolderModel
  allFolders: FolderModel[]
  allDecks: DeckModel[]
  linkedFolderIds: string[]
  onAdd: (id: string) => void
  onRemove: (id: string) => void
  depth: number
}

function FolderTreeRow({
  folder, allFolders, allDecks, linkedFolderIds, onAdd, onRemove, depth,
}: FolderTreeRowProps) {
  const [expanded, setExpanded] = useState(true)
  const children = allFolders
    .filter((f) => f.parentId === folder.id && !f.isArchived)
    .sort((a, b) => a.order - b.order)
  const directDeckCount = allDecks.filter((d) => d.folderId === folder.id && !d.isArchived).length
  const isLinked = linkedFolderIds.includes(folder.id)

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1.5 rounded-[var(--radius-sm)] py-1 transition-colors',
          isLinked ? 'bg-[var(--accent)]/10' : 'hover:bg-[var(--bg-hover)]',
        )}
        style={{ paddingLeft: `${4 + depth * 14}px`, paddingRight: '4px' }}
      >
        {/* Expand/collapse toggle */}
        {children.length > 0 ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="w-[10px] shrink-0" />
        )}

        <Folder
          size={10}
          className={cn('shrink-0', isLinked ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]')}
        />

        <span
          className={cn(
            'text-xs flex-1 truncate',
            isLinked ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]',
          )}
        >
          {folder.name}
        </span>

        {directDeckCount > 0 && (
          <span className="text-[9px] text-[var(--text-muted)] shrink-0">
            {directDeckCount}d
          </span>
        )}

        {isLinked ? (
          <button
            onClick={() => onRemove(folder.id)}
            className="ml-1 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors shrink-0"
            title="Remove folder from exam"
          >
            <X size={11} />
          </button>
        ) : (
          <button
            onClick={() => onAdd(folder.id)}
            className="ml-1 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors shrink-0"
            title="Add folder and all nested decks to exam"
          >
            <Plus size={11} />
          </button>
        )}
      </div>

      {expanded &&
        children.map((child) => (
          <FolderTreeRow
            key={child.id}
            folder={child}
            allFolders={allFolders}
            allDecks={allDecks}
            linkedFolderIds={linkedFolderIds}
            onAdd={onAdd}
            onRemove={onRemove}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

// ── Exam edit panel ────────────────────────────────────────────────────────────

function ExamEditPanel({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const {
    deleteExam, addDeckToExam, removeDeckFromExam,
    addFolderToExam, removeFolderFromExam, setTargetRetention,
  } = useExamStore(
    useShallow((s) => ({
      deleteExam: s.deleteExam,
      addDeckToExam: s.addDeckToExam,
      removeDeckFromExam: s.removeDeckFromExam,
      addFolderToExam: s.addFolderToExam,
      removeFolderFromExam: s.removeFolderFromExam,
      setTargetRetention: s.setTargetRetention,
    }))
  )
  const { decks, folders } = useLibraryStore(useShallow((s) => ({ decks: s.decks, folders: s.folders })))

  const examDeckIds = getExamDeckIds(exam, decks, folders)
  // Individually-linked decks (not covered via a folder)
  const linkedDecks = decks.filter((d) => exam.deckIds.includes(d.id))
  // Decks not yet covered by any linked folder or direct link
  const unlinkedDecks = decks.filter((d) => !examDeckIds.includes(d.id) && !d.isArchived)
  // Root-level folders for tree rendering
  const rootFolders = folders
    .filter((f) => f.parentId === null && !f.isArchived)
    .sort((a, b) => a.order - b.order)

  return (
    <div className="bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)]">
        <p className="text-xs font-semibold text-[var(--text-secondary)]">Edit Exam</p>
        <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          <X size={13} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Target retention */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Target size={11} className="text-[var(--text-muted)]" />
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Target Retention</p>
            <span className="ml-auto text-xs font-bold text-[var(--text-primary)]">
              {Math.round((exam.targetRetention ?? 0.90) * 100)}%
            </span>
          </div>
          <input
            type="range" min={0.5} max={0.99} step={0.05}
            value={exam.targetRetention ?? 0.90}
            onChange={(e) => setTargetRetention(exam.id, parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] h-1.5"
          />
          <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
            <span>50%</span><span>75%</span><span>99%</span>
          </div>
        </div>

        {/* Folder tree browser */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Folders</p>
          {rootFolders.length > 0 ? (
            <div className="rounded-[var(--radius-sm)] border border-[var(--border)] overflow-hidden overflow-y-auto max-h-52 bg-[var(--bg-surface)]">
              {rootFolders.map((f) => (
                <FolderTreeRow
                  key={f.id}
                  folder={f}
                  allFolders={folders}
                  allDecks={decks}
                  linkedFolderIds={exam.folderIds ?? []}
                  onAdd={(id) => addFolderToExam(exam.id, id)}
                  onRemove={(id) => removeFolderFromExam(exam.id, id)}
                  depth={0}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-muted)]">
              No folders in your library yet.
            </p>
          )}
        </div>

        {/* Individual decks */}
        <div>
          <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1.5">Individual Decks</p>

          {/* Already-linked individual decks */}
          {linkedDecks.length > 0 && (
            <div className="space-y-1 mb-2">
              {linkedDecks.map((d) => (
                <div key={d.id} className="flex items-center gap-2 py-0.5">
                  <BookOpen size={10} className="text-[var(--accent)] shrink-0" />
                  <span className="text-xs text-[var(--text-primary)] flex-1 truncate">{d.name}</span>
                  <button
                    onClick={() => removeDeckFromExam(exam.id, d.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors shrink-0"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add unlinked deck */}
          {unlinkedDecks.length > 0 ? (
            <select
              className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              value=""
              onChange={(e) => { if (e.target.value) addDeckToExam(exam.id, e.target.value) }}
            >
              <option value="">+ Add deck…</option>
              {unlinkedDecks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          ) : linkedDecks.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No decks available.</p>
          ) : null}
        </div>

        <button
          onClick={() => { deleteExam(exam.id); onClose() }}
          className="w-full text-xs text-[var(--danger)] hover:bg-[var(--danger-subtle)] py-1.5 rounded-[var(--radius-sm)] transition-colors"
        >
          Delete exam
        </button>
      </div>
    </div>
  )
}

// ── Exam card ─────────────────────────────────────────────────────────────────

function ExamCard({ exam, isEditOpen, onToggleEdit }: {
  exam: Exam
  isEditOpen: boolean
  onToggleEdit: () => void
}) {
  const router = useRouter()
  const { decks, folders, cards, fsrsData } = useLibraryStore(
    useShallow((s) => ({ decks: s.decks, folders: s.folders, cards: s.cards, fsrsData: s.fsrsData }))
  )
  const rateExam = useExamStore((s) => s.rateExam)

  const days = daysUntil(exam.date)
  const isPast = days < 0
  const examCards = getExamCards(exam, decks, cards, folders)
  const stats = computeExamRetentionStats(exam, examCards, fsrsData)
  const breakdown = computePerTopicBreakdown(exam, decks, cards, folders, fsrsData)
  const retPct = Math.round(stats.avgRetention * 100)
  const targetPct = Math.round((exam.targetRetention ?? 0.90) * 100)
  const behind = stats.reviewedCards > 0 && stats.avgRetention < (exam.targetRetention ?? 0.90)
  const pulse = !isPast && days <= 7 && behind

  const [pendingRating, setPendingRating] = useState(0)

  const dateLabel = formatDate(exam.date + 'T00:00')

  // ── Past: unrated → rating UI ──────────────────────────────────────────────
  if (isPast && !exam.rating) {
    return (
      <div className="card-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--text-primary)]">{exam.name}</p>
            <p className="text-[10px] text-[var(--text-muted)]">{exam.subject} · {dateLabel} · Past</p>
          </div>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm font-medium text-[var(--text-primary)]">How did it go?</p>
          <StarRatingInput value={pendingRating} onChange={setPendingRating} />
          <p className="text-[10px] text-[var(--text-muted)]">
            Nemos predicted {retPct > 0 ? `${retPct}% retention` : 'no data (no cards linked)'} for this exam
          </p>
          <button
            disabled={pendingRating === 0}
            onClick={() => rateExam(exam.id, pendingRating, stats.avgRetention)}
            className={cn(
              'px-4 py-1.5 text-xs font-semibold rounded-[var(--radius-sm)] transition-colors',
              pendingRating > 0
                ? 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90'
                : 'bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed'
            )}
          >
            Save Rating
          </button>
        </div>
      </div>
    )
  }

  // ── Past: rated → compact summary ─────────────────────────────────────────
  if (isPast && exam.rating) {
    const predictedPct = exam.predictedRetentionAtExam !== undefined
      ? Math.round(exam.predictedRetentionAtExam * 100)
      : retPct
    return (
      <div className="card-surface px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">{exam.name}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{exam.subject} · {dateLabel}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-[var(--text-muted)]">Predicted {predictedPct}%</span>
          <div className="flex">
            {[1, 2, 3, 4, 5].map((s) => (
              <span key={s} className="text-base leading-none" style={{ color: s <= (exam.rating ?? 0) ? 'var(--warning)' : 'var(--border-strong)' }}>
                ★
              </span>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Upcoming: mission-control card ────────────────────────────────────────
  return (
    <div className="card-surface overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="min-w-0">
          <p className="text-base font-semibold text-[var(--text-primary)] truncate">{exam.name}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{exam.subject} · {dateLabel}</p>
        </div>
        <button
          onClick={onToggleEdit}
          className={cn(
            'ml-3 p-1.5 rounded-[var(--radius-sm)] transition-colors shrink-0',
            isEditOpen
              ? 'bg-[var(--accent)]/20 text-[var(--accent)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
          )}
          title="Edit exam settings"
        >
          <Settings size={13} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4">
        {/* Ring + Countdown */}
        <div className="flex items-center gap-5 mb-4">
          {stats.totalCards > 0 ? (
            <ReadinessRing pct={retPct} />
          ) : (
            <div
              className="w-[88px] h-[88px] rounded-full border-[7px] flex items-center justify-center shrink-0"
              style={{ borderColor: 'var(--bg-active)' }}
            >
              <span className="text-[9px] text-[var(--text-muted)] text-center leading-tight">No<br />cards</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Countdown pulse */}
            <div className={cn('mb-2', pulse && 'animate-pulse')}>
              <span
                className="font-mono text-4xl font-bold tabular-nums leading-none"
                style={{
                  color: days <= 7 ? 'var(--danger)' : days <= 14 ? 'var(--warning)' : 'var(--text-primary)',
                }}
              >
                {days}
              </span>
              <span className="meta-label text-[var(--text-muted)] ml-1.5">days left</span>
            </div>

            {/* Target + status badge */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Target size={10} className="text-[var(--text-muted)]" />
              <span className="font-mono text-[10px] text-[var(--text-muted)]">Target {targetPct}%</span>
              {stats.reviewedCards > 0 && behind && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--danger-subtle)] text-[var(--danger)]">
                  Behind
                </span>
              )}
              {stats.reviewedCards > 0 && !behind && (
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full text-[var(--success)]" style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)' }}>
                  On track
                </span>
              )}
            </div>

            {/* Extra load warning */}
            {stats.pulledForwardCount > 0 && (
              <div className="flex items-center gap-1 mt-1.5">
                <AlertTriangle size={9} className="text-[var(--warning)] shrink-0" />
                <span className="text-[9px] text-[var(--warning)]">
                  {stats.dailyLoadNeeded} extra reviews/day to stay on track
                </span>
              </div>
            )}

            {/* New cards notice */}
            {stats.newCards > 0 && (
              <p className="text-[9px] text-[var(--text-muted)] mt-1">
                {stats.newCards} unseen card{stats.newCards !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* Per-topic breakdown */}
        {breakdown.length > 0 && (
          <div className="space-y-2.5 mb-4">
            {breakdown.map((t) => {
              const barColor = t.readiness >= 80
                ? 'var(--success)'
                : t.readiness >= 60
                ? 'var(--warning)'
                : 'var(--danger)'
              return (
                <div key={t.id}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {t.type === 'folder'
                        ? <Folder size={9} className="text-[var(--text-muted)] shrink-0" />
                        : <BookOpen size={9} className="text-[var(--text-muted)] shrink-0" />
                      }
                      <span className="text-[10px] text-[var(--text-secondary)] truncate">{t.name}</span>
                    </div>
                    <span className="font-mono text-[10px] font-semibold shrink-0 ml-2" style={{ color: barColor }}>
                      {t.cardCount > 0 ? `${t.readiness}%` : '—'}
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg-active)' }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${t.readiness}%`, background: barColor }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* No linked content */}
        {stats.totalCards === 0 && (
          <p className="text-[10px] text-[var(--text-muted)] mb-4">
            Link decks or folders to track readiness. Click <Settings size={9} className="inline" /> to add them.
          </p>
        )}

        {/* Study Weakest button */}
        <button
          onClick={() => router.push(`/study/session?examId=${exam.id}&mode=weakest`)}
          disabled={stats.totalCards === 0}
          className={cn(
            'w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-[var(--radius-sm)] transition-all',
            stats.totalCards > 0
              ? 'bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 active:scale-[0.98]'
              : 'bg-[var(--bg-hover)] text-[var(--text-muted)] cursor-not-allowed'
          )}
        >
          <Zap size={11} />
          Study Weakest
        </button>
      </div>
    </div>
  )
}

// ── Main planner ──────────────────────────────────────────────────────────────

export function PlannerPage({ addingExam = false, onExamAdded }: PlannerPageProps) {
  const { exams, addExam } = useExamStore(useShallow((s) => ({ exams: s.exams, addExam: s.addExam })))
  const folders = useLibraryStore((s) => s.folders)

  const [showExamForm, setShowExamForm] = useState(false)
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null)
  const [examName, setExamName] = useState('')
  const [examSubject, setExamSubject] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examPriority, setExamPriority] = useState<Exam['priority']>('medium')

  useEffect(() => { if (addingExam) setShowExamForm(true) }, [addingExam])

  const handleExamSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!examName.trim() || !examSubject.trim() || !examDate) return
    addExam(examName.trim(), examSubject.trim(), examDate, examPriority)
    setExamName(''); setExamSubject(''); setExamDate(''); setExamPriority('medium')
    setShowExamForm(false)
    onExamAdded?.()
  }

  const today = new Date()
  const [currentMonth, setCurrentMonth] = useState(today)
  const [pomodoroRunning, setPomodoroRunning] = useState(false)
  const [pomodoroTime, setPomodoroTime] = useState(25 * 60)
  const [pomodoroMode, setPomodoroMode] = useState<'work' | 'break'>('work')
  const { plannerTasks: tasks, addPlannerTask, togglePlannerTask } = useAppStore(
    useShallow((s) => ({
      plannerTasks: s.plannerTasks,
      addPlannerTask: s.addPlannerTask,
      togglePlannerTask: s.togglePlannerTask,
    }))
  )
  const [newTask, setNewTask] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (pomodoroRunning) {
      intervalRef.current = setInterval(() => {
        setPomodoroTime((t) => {
          if (t <= 1) {
            setPomodoroRunning(false)
            const next = pomodoroMode === 'work' ? 'break' : 'work'
            setPomodoroMode(next)
            return next === 'break' ? 5 * 60 : 25 * 60
          }
          return t - 1
        })
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [pomodoroRunning, pomodoroMode])

  const addTask = () => {
    if (!newTask.trim()) return
    addPlannerTask(newTask.trim())
    setNewTask('')
  }

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()

  const upcomingExams = [...exams]
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // Past exams: unrated ones first (need attention), then rated (most recent first)
  const pastExams = [...exams]
    .filter((e) => daysUntil(e.date) < 0)
    .sort((a, b) => {
      if (!a.rating && b.rating) return -1
      if (a.rating && !b.rating) return 1
      return new Date(b.date).getTime() - new Date(a.date).getTime()
    })

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Suppress unused import warnings — folders used by ExamEditPanel indirectly
  void folders

  return (
    <div className="max-w-[1200px] mx-auto space-y-6">
      {/* Add exam form */}
      {showExamForm && (
        <div className="bg-[var(--bg-surface)] border border-[var(--accent)] rounded-[var(--radius)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">New Exam</h3>
            <button onClick={() => { setShowExamForm(false); onExamAdded?.() }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={14} />
            </button>
          </div>
          <form onSubmit={handleExamSubmit} className="grid grid-cols-2 gap-3">
            <input placeholder="Exam name *" value={examName} onChange={(e) => setExamName(e.target.value)} required autoFocus
              className="col-span-2 text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
            <input placeholder="Subject *" value={examSubject} onChange={(e) => setExamSubject(e.target.value)} required
              className="text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
            <input type="date" value={examDate} onChange={(e) => setExamDate(e.target.value)} required min={new Date().toISOString().slice(0, 10)}
              className="text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            <select value={examPriority} onChange={(e) => setExamPriority(e.target.value as Exam['priority'])}
              className="text-sm bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
              <option value="low">Low priority</option>
              <option value="medium">Medium priority</option>
              <option value="high">High priority</option>
            </select>
            <div className="flex gap-2">
              <button type="submit" className="flex-1 text-sm font-medium py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 transition-opacity">
                Save Exam
              </button>
              <button type="button" onClick={() => { setShowExamForm(false); onExamAdded?.() }}
                className="px-3 py-2 text-sm rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: calendar + exam cards */}
        <div className="lg:col-span-2 space-y-5">
          {/* Calendar */}
          <div className="card-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">
                {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="w-7 px-0">
                  <ChevronLeft size={14} />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="w-7 px-0">
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {DAYS.map((d) => (
                <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: firstDay }, (_, i) => <div key={`e-${i}`} className="h-8" />)}
              {Array.from({ length: daysInMonth }, (_, i) => {
                const day = i + 1
                const isToday = day === today.getDate() && currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear()
                const dayExams = exams.filter((e) => {
                  const d = new Date(e.date + 'T00:00')
                  return d.getDate() === day && d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear()
                })
                return (
                  <button key={day}
                    className={cn('h-8 w-full flex flex-col items-center justify-center rounded-[var(--radius-sm)] text-xs transition-colors relative',
                      isToday ? 'bg-[var(--accent)] text-[var(--accent-fg)] font-semibold' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}
                    onClick={() => dayExams.length > 0 ? setSelectedExamId(dayExams[0].id) : undefined}
                  >
                    {day}
                    {dayExams.length > 0 && !isToday && (
                      <span className="absolute bottom-0.5 w-1 h-1 bg-[var(--danger)] rounded-full" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Upcoming exam cards */}
          {upcomingExams.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Calendar size={12} className="text-[var(--text-muted)]" />
                <h3 className="meta-label text-[var(--text-secondary)]">Upcoming Exams</h3>
              </div>
              {upcomingExams.map((exam) => (
                <div key={exam.id} className="space-y-2">
                  <ExamCard
                    exam={exam}
                    isEditOpen={selectedExamId === exam.id}
                    onToggleEdit={() => setSelectedExamId(selectedExamId === exam.id ? null : exam.id)}
                  />
                  {selectedExamId === exam.id && (
                    <ExamEditPanel exam={exam} onClose={() => setSelectedExamId(null)} />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Past exam cards */}
          {pastExams.length > 0 && (
            <div className="space-y-3">
              <h3 className="meta-label text-[var(--text-muted)]">Past Exams</h3>
              {pastExams.map((exam) => (
                <ExamCard key={exam.id} exam={exam} isEditOpen={false} onToggleEdit={() => {}} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {upcomingExams.length === 0 && pastExams.length === 0 && (
            <div className="card-surface p-8 text-center space-y-2">
              <p className="text-sm text-[var(--text-muted)]">No exams yet.</p>
              <button onClick={() => setShowExamForm(true)} className="text-xs text-[var(--accent)] hover:underline">
                Add your first exam →
              </button>
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Pomodoro */}
          <div className="card-surface p-5 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Timer size={13} className="text-[var(--text-muted)]" />
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Pomodoro</h3>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] mb-3 capitalize">{pomodoroMode} session</p>
            <div className="text-4xl font-mono font-bold text-[var(--text-primary)] mb-4 tabular-nums">
              {formatTime(pomodoroTime)}
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button variant={pomodoroRunning ? 'danger' : 'primary'} size="sm" onClick={() => setPomodoroRunning(!pomodoroRunning)}>
                {pomodoroRunning ? 'Pause' : 'Start'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setPomodoroRunning(false); setPomodoroMode('work'); setPomodoroTime(25 * 60) }}>
                Reset
              </Button>
            </div>
          </div>

          {/* Tasks */}
          <div className="card-surface overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <CheckSquare size={13} className="text-[var(--text-muted)]" />
              <h3 className="text-base font-semibold text-[var(--text-primary)]">Today&apos;s Tasks</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {tasks.map((task) => (
                <button key={task.id} onClick={() => togglePlannerTask(task.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0',
                    task.done ? 'bg-[var(--success)] border-[var(--success)]' : 'border-[var(--border-strong)]')}>
                    {task.done && (
                      <svg className="w-2.5 h-2.5 text-[var(--accent-fg)]" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    )}
                  </div>
                  <span className={cn('flex-1 text-xs', task.done ? 'text-[var(--text-muted)] line-through' : 'text-[var(--text-primary)]')}>
                    {task.label}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--border)]">
              <input value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()}
                placeholder="Add a task…" className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
              <button onClick={addTask} className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
                <Plus size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
