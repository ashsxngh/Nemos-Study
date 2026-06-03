'use client'

import { useState, useEffect, useRef } from 'react'
import {
  Calendar, Clock, CheckSquare, Timer, ChevronLeft, ChevronRight,
  Plus, X, BookOpen, Folder, AlertTriangle, TrendingUp, Target,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import {
  computeExamRetentionStats,
  getExamCards,
  getExamDeckIds,
} from '@/lib/examScheduler'
import type { Exam } from '@/lib/types'

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

const urgencyColor = (d: number) =>
  d <= 7 ? 'text-[var(--danger)]' : d <= 14 ? 'text-[var(--warning)]' : 'text-[var(--accent)]'

// ── Exam detail panel ─────────────────────────────────────────────────────────

function ExamDetail({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const {
    deleteExam, updateExam,
    addDeckToExam, removeDeckFromExam,
    addFolderToExam, removeFolderFromExam,
    setTargetRetention,
  } = useExamStore()
  const { decks, folders, cards, fsrsData } = useLibraryStore()

  const examCards = getExamCards(exam, decks, cards, folders)
  const stats = computeExamRetentionStats(exam, examCards, fsrsData)
  const examDeckIds = getExamDeckIds(exam, decks, folders)
  const linkedDecks = decks.filter((d) => exam.deckIds.includes(d.id))
  const linkedFolders = folders.filter((f) => (exam.folderIds ?? []).includes(f.id))
  const unlinkedDecks = decks.filter((d) => !examDeckIds.includes(d.id) && !d.isArchived)
  const unlinkedFolders = folders.filter((f) => !(exam.folderIds ?? []).includes(f.id) && !f.isArchived)
  const days = daysUntil(exam.date)
  const retPct = Math.round(stats.avgRetention * 100)

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 border-b border-[var(--border)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{exam.name}</h3>
          <p className="text-xs text-[var(--text-muted)]">{exam.subject}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-medium', urgencyColor(days))}>
            {days} days
          </span>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* FSRS retention stats */}
        {stats.totalCards > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={13} className="text-[var(--text-muted)]" />
              <p className="text-xs font-semibold text-[var(--text-secondary)]">Predicted Exam-Day Retention</p>
            </div>

            <div className="flex items-center gap-3">
              <Progress
                value={retPct}
                max={100}
                className="flex-1"
                color={retPct >= 85 ? 'success' : retPct >= 65 ? 'accent' : 'danger'}
              />
              <span className="text-sm font-bold text-[var(--text-primary)] w-12 text-right">
                {retPct}%
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: 'Cards', value: stats.totalCards, sub: 'total' },
                { label: stats.onTarget, value: null, sub: 'on target', color: 'text-[var(--success)]', raw: stats.onTarget },
                { label: stats.atRisk, value: null, sub: 'at risk', color: 'text-[var(--danger)]', raw: stats.atRisk },
                { label: stats.newCards, value: null, sub: 'new', color: 'text-[var(--text-muted)]', raw: stats.newCards },
              ].map((item, i) => (
                <div key={i} className="bg-[var(--bg-hover)] rounded-[var(--radius-sm)] p-2">
                  <p className={cn('text-base font-bold', (item as {color?: string}).color ?? 'text-[var(--text-primary)]')}>
                    {i === 0 ? item.value : (item as {raw: number}).raw}
                  </p>
                  <p className="text-[9px] text-[var(--text-muted)]">{item.sub}</p>
                </div>
              ))}
            </div>

            {stats.pulledForwardCount > 0 && (
              <div className="flex items-start gap-2 p-2.5 rounded-[var(--radius-sm)] bg-[var(--warning-subtle)] border border-[var(--warning)]/30">
                <AlertTriangle size={12} className="text-[var(--warning)] shrink-0 mt-0.5" />
                <div className="text-xs text-[var(--warning)]">
                  <strong>{stats.pulledForwardCount} cards</strong> are scheduled past your exam date.
                  They&apos;ve been pulled into your daily inbox automatically.
                  {stats.dailyLoadNeeded > 0 && (
                    <span className="block mt-0.5 text-[var(--text-muted)]">
                      ~{stats.dailyLoadNeeded} extra reviews/day needed to stay on track.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-4 text-xs text-[var(--text-muted)]">
            Link decks or folders to see retention forecasts.
          </div>
        )}

        {/* Target retention */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Target size={12} className="text-[var(--text-muted)]" />
            <p className="text-xs font-semibold text-[var(--text-secondary)]">Target Retention</p>
            <span className="ml-auto text-xs font-bold text-[var(--text-primary)]">
              {Math.round((exam.targetRetention ?? 0.85) * 100)}%
            </span>
          </div>
          <input
            type="range" min={0.5} max={0.99} step={0.05}
            value={exam.targetRetention ?? 0.85}
            onChange={(e) => setTargetRetention(exam.id, parseFloat(e.target.value))}
            className="w-full accent-[var(--accent)] h-1.5"
          />
          <div className="flex justify-between text-[9px] text-[var(--text-muted)] mt-0.5">
            <span>50%</span><span>75%</span><span>99%</span>
          </div>
        </div>

        {/* Linked content */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--text-secondary)]">Linked Content</p>

          {/* Folders */}
          {linkedFolders.map((f) => (
            <div key={f.id} className="flex items-center gap-2 py-1">
              <Folder size={12} className="text-[var(--accent)] shrink-0" />
              <span className="text-xs text-[var(--text-primary)] flex-1 truncate">{f.name}</span>
              <span className="text-[10px] text-[var(--text-muted)]">folder</span>
              <button onClick={() => removeFolderFromExam(exam.id, f.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                <X size={11} />
              </button>
            </div>
          ))}

          {/* Decks */}
          {linkedDecks.map((d) => (
            <div key={d.id} className="flex items-center gap-2 py-1">
              <BookOpen size={12} className="text-[var(--accent)] shrink-0" />
              <span className="text-xs text-[var(--text-primary)] flex-1 truncate">{d.name}</span>
              <span className="text-[10px] text-[var(--text-muted)]">deck</span>
              <button onClick={() => removeDeckFromExam(exam.id, d.id)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                <X size={11} />
              </button>
            </div>
          ))}

          {linkedFolders.length === 0 && linkedDecks.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">Nothing linked yet.</p>
          )}
        </div>

        {/* Add content */}
        <div className="grid grid-cols-1 gap-2">
          {unlinkedFolders.length > 0 && (
            <select
              className="w-full text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              value=""
              onChange={(e) => { if (e.target.value) addFolderToExam(exam.id, e.target.value) }}
            >
              <option value="">+ Add folder (includes all nested decks)…</option>
              {unlinkedFolders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
          {unlinkedDecks.length > 0 && (
            <select
              className="w-full text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              value=""
              onChange={(e) => { if (e.target.value) addDeckToExam(exam.id, e.target.value) }}
            >
              <option value="">+ Add individual deck…</option>
              {unlinkedDecks.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Delete */}
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

// ── Main planner ──────────────────────────────────────────────────────────────

export function PlannerPage({ addingExam = false, onExamAdded }: PlannerPageProps) {
  const { exams, addExam } = useExamStore()
  const { decks, folders, cards, fsrsData } = useLibraryStore()

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
  const [tasks, setTasks] = useState([
    { id: '1', label: 'Review flashcards', done: false },
    { id: '2', label: 'Read notes', done: false },
  ])
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

  const toggleTask = (id: string) =>
    setTasks((ts) => ts.map((t) => t.id === id ? { ...t, done: !t.done } : t))
  const addTask = () => {
    if (!newTask.trim()) return
    setTasks((ts) => [...ts, { id: Date.now().toString(), label: newTask.trim(), done: false }])
    setNewTask('')
  }

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate()
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay()

  const upcomingExams = [...exams]
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const selectedExam = selectedExamId ? exams.find((e) => e.id === selectedExamId) : null

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Add exam form */}
      {showExamForm && (
        <div className="bg-[var(--bg-surface)] border border-[var(--accent)] rounded-[var(--radius)] p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">New Exam</h3>
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
              <button type="submit" className="flex-1 text-sm font-medium py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
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
        {/* Calendar */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
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
                    className={cn('h-8 w-full flex flex-col items-center justify-center rounded-[var(--radius-sm)] text-xs transition-colors relative', isToday ? 'bg-[var(--accent)] text-white font-semibold' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]')}
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

          {/* Upcoming exams list */}
          {upcomingExams.length > 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">Upcoming Exams</h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {upcomingExams.map((exam) => {
                  const examCards = getExamCards(exam, decks, cards, folders)
                  const stats = computeExamRetentionStats(exam, examCards, fsrsData)
                  const days = daysUntil(exam.date)
                  const retPct = Math.round(stats.avgRetention * 100)
                  return (
                    <button
                      key={exam.id}
                      onClick={() => setSelectedExamId(selectedExamId === exam.id ? null : exam.id)}
                      className={cn('w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors', selectedExamId === exam.id && 'bg-[var(--bg-hover)]')}
                    >
                      <div className={cn('w-8 h-8 rounded-[var(--radius-sm)] flex flex-col items-center justify-center shrink-0 text-center',
                        days <= 7 ? 'bg-[var(--danger-subtle)]' : days <= 14 ? 'bg-[var(--warning-subtle)]' : 'bg-[var(--bg-active)]')}>
                        <span className={cn('text-xs font-bold leading-none', urgencyColor(days))}>{days}</span>
                        <span className="text-[8px] text-[var(--text-muted)]">days</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-[var(--text-primary)] truncate">{exam.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">{exam.subject} · {new Date(exam.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                      </div>
                      {stats.totalCards > 0 && (
                        <div className="flex items-center gap-2 shrink-0">
                          <Progress value={retPct} max={100} size="sm" className="w-16"
                            color={retPct >= 85 ? 'success' : retPct >= 65 ? 'accent' : 'danger'} />
                          <span className="text-[10px] text-[var(--text-muted)] w-8">{retPct}%</span>
                        </div>
                      )}
                      {stats.pulledForwardCount > 0 && (
                        <AlertTriangle size={12} className="text-[var(--warning)] shrink-0" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Selected exam detail */}
          {selectedExam && (
            <ExamDetail exam={selectedExam} onClose={() => setSelectedExamId(null)} />
          )}
        </div>

        {/* Right panel */}
        <div className="space-y-4">
          {/* Pomodoro */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Timer size={13} className="text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pomodoro</h3>
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
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
              <CheckSquare size={13} className="text-[var(--text-muted)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">Today&apos;s Tasks</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {tasks.map((task) => (
                <button key={task.id} onClick={() => toggleTask(task.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left">
                  <div className={cn('w-4 h-4 rounded border-2 flex items-center justify-center shrink-0', task.done ? 'bg-[var(--success)] border-[var(--success)]' : 'border-[var(--border-strong)]')}>
                    {task.done && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
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
                placeholder="Add a task..." className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none" />
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
