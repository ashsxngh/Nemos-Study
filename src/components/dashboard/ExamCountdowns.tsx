'use client'

import { useState } from 'react'
import { Calendar, Plus, X, ChevronDown, ChevronUp, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import type { Exam } from '@/lib/types'

const urgencyColor = (days: number) => {
  if (days <= 7) return 'text-[var(--danger)]'
  if (days <= 14) return 'text-[var(--warning)]'
  return 'text-[var(--text-secondary)]'
}
const urgencyBg = (days: number) => {
  if (days <= 7) return 'bg-[var(--danger-subtle)]'
  if (days <= 14) return 'bg-[var(--warning-subtle)]'
  return 'bg-[var(--bg-active)]'
}

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exam = new Date(dateStr + 'T00:00')
  return Math.ceil((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function ExamRow({ exam }: { exam: Exam }) {
  const { deleteExam, addDeckToExam, removeDeckFromExam } = useExamStore()
  const { decks, getDeckMastery } = useLibraryStore()
  const [expanded, setExpanded] = useState(false)
  const days = daysUntil(exam.date)
  const linkedDecks = decks.filter((d) => exam.deckIds.includes(d.id))
  const avgMastery = linkedDecks.length > 0
    ? Math.round(linkedDecks.reduce((s, d) => s + getDeckMastery(d.id), 0) / linkedDecks.length)
    : null

  return (
    <div className="border-b border-[var(--border)] last:border-0">
      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-[var(--bg-hover)] transition-colors group">
        <div className={cn(
          'w-9 h-9 rounded-[var(--radius-sm)] flex flex-col items-center justify-center shrink-0',
          urgencyBg(days)
        )}>
          <span className={cn('text-sm font-bold leading-none', urgencyColor(days))}>{days}</span>
          <span className="text-[9px] text-[var(--text-muted)] mt-0.5">days</span>
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--text-primary)] truncate">{exam.name}</p>
          <p className="text-[10px] text-[var(--text-muted)]">{exam.subject}</p>
          {avgMastery !== null && (
            <div className="flex items-center gap-2 mt-1">
              <Progress value={avgMastery} size="sm" className="w-16"
                color={avgMastery >= 70 ? 'success' : avgMastery >= 40 ? 'accent' : 'danger'}
              />
              <span className="text-[9px] text-[var(--text-muted)]">{avgMastery}% ready</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="opacity-0 group-hover:opacity-100 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
            title="Link decks"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => deleteExam(exam.id)}
            className="opacity-0 group-hover:opacity-100 transition-colors text-[var(--text-muted)] hover:text-[var(--danger)] p-0.5"
            title="Delete"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 bg-[var(--bg-hover)]">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">
            Decks to master by this date
          </p>
          <div className="space-y-1 mb-2">
            {linkedDecks.length === 0 && (
              <p className="text-[10px] text-[var(--text-muted)]">No decks linked yet.</p>
            )}
            {linkedDecks.map((deck) => {
              const m = getDeckMastery(deck.id)
              return (
                <div key={deck.id} className="flex items-center gap-2">
                  <BookOpen size={11} className="text-[var(--accent)] shrink-0" />
                  <span className="text-xs text-[var(--text-primary)] flex-1 truncate">{deck.name}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{m}%</span>
                  <button
                    onClick={() => removeDeckFromExam(exam.id, deck.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    <X size={11} />
                  </button>
                </div>
              )
            })}
          </div>

          <select
            className="w-full text-[10px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            value=""
            onChange={(e) => {
              if (e.target.value) addDeckToExam(exam.id, e.target.value)
            }}
          >
            <option value="">+ Add a deck...</option>
            {decks
              .filter((d) => !exam.deckIds.includes(d.id) && !d.isArchived)
              .map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
          </select>
        </div>
      )}
    </div>
  )
}

export function ExamCountdowns() {
  const { exams, addExam } = useExamStore()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [date, setDate] = useState('')
  const [priority, setPriority] = useState<Exam['priority']>('medium')

  const sorted = [...exams]
    .filter((e) => daysUntil(e.date) >= 0)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !subject.trim() || !date) return
    addExam(name.trim(), subject.trim(), date, priority)
    setName('')
    setSubject('')
    setDate('')
    setPriority('medium')
    setShowForm(false)
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Calendar size={13} className="text-[var(--text-muted)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Exams</h2>
        </div>
        <Button variant="ghost" size="xs" icon={<Plus size={11} />} onClick={() => setShowForm((v) => !v)}>
          Add
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-hover)] flex flex-col gap-2">
          <input
            placeholder="Exam name *"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            required
            autoFocus
          />
          <input
            placeholder="Subject *"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            required
          />
          <div className="flex gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="flex-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              required
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Exam['priority'])}
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 text-xs font-medium py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              Save Exam
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-active)] transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {sorted.length === 0 && !showForm ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          No exams — click Add to start counting down
        </div>
      ) : (
        <div>
          {sorted.map((exam) => (
            <ExamRow key={exam.id} exam={exam} />
          ))}
        </div>
      )}
    </div>
  )
}
