'use client'

import { useState, useEffect, useRef } from 'react'
import { Calendar, Clock, CheckSquare, Timer, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import type { Exam } from '@/lib/types'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

interface PlannerPageProps {
  addingExam?: boolean
  onExamAdded?: () => void
}

export function PlannerPage({ addingExam = false, onExamAdded }: PlannerPageProps) {
  const { exams, addExam } = useExamStore()
  const [showExamForm, setShowExamForm] = useState(false)
  const [examName, setExamName] = useState('')
  const [examSubject, setExamSubject] = useState('')
  const [examDate, setExamDate] = useState('')
  const [examPriority, setExamPriority] = useState<Exam['priority']>('medium')

  // Open form when triggered from header button
  useEffect(() => {
    if (addingExam) setShowExamForm(true)
  }, [addingExam])

  const handleExamSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!examName.trim() || !examSubject.trim() || !examDate) return
    addExam(examName.trim(), examSubject.trim(), examDate, examPriority)
    setExamName('')
    setExamSubject('')
    setExamDate('')
    setExamPriority('medium')
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

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // Days with exams marked
  const examDays = new Set(exams.map((e) => new Date(e.date + 'T00:00').getDate()))

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Exam form (shown when header button clicked) */}
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
      <div className="lg:col-span-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={prevMonth} className="w-7 px-0">
              <ChevronLeft size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={nextMonth} className="w-7 px-0">
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAYS.map((d) => (
            <div key={d} className="text-center text-[10px] font-semibold text-[var(--text-muted)] py-1">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: firstDay }, (_, i) => (
            <div key={`empty-${i}`} className="h-8" />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const isToday =
              day === today.getDate() &&
              currentMonth.getMonth() === today.getMonth() &&
              currentMonth.getFullYear() === today.getFullYear()
            const hasExam = exams.some((e) => {
              const d = new Date(e.date + 'T00:00')
              return d.getDate() === day && d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear()
            })

            return (
              <button
                key={day}
                className={cn(
                  'h-8 w-full flex flex-col items-center justify-center rounded-[var(--radius-sm)] text-xs transition-colors relative',
                  isToday
                    ? 'bg-[var(--accent)] text-white font-semibold'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {day}
                {hasExam && !isToday && (
                  <span className="absolute bottom-0.5 w-1 h-1 bg-[var(--danger)] rounded-full" title="Exam" />
                )}
              </button>
            )
          })}
        </div>
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
            <Button
              variant={pomodoroRunning ? 'danger' : 'primary'}
              size="sm"
              onClick={() => setPomodoroRunning(!pomodoroRunning)}
            >
              {pomodoroRunning ? 'Pause' : 'Start'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPomodoroRunning(false)
                setPomodoroMode('work')
                setPomodoroTime(25 * 60)
              }}
            >
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
              <button
                key={task.id}
                onClick={() => toggleTask(task.id)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors text-left"
              >
                <div className={cn(
                  'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0',
                  task.done ? 'bg-[var(--success)] border-[var(--success)]' : 'border-[var(--border-strong)]'
                )}>
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
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTask()}
              placeholder="Add a task..."
              className="flex-1 bg-transparent text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
            />
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
