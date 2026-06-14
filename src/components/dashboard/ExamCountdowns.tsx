'use client'

import { useState } from 'react'
import { Calendar, Plus, X, ChevronDown, ChevronUp, ChevronRight, BookOpen, Folder, AlertTriangle, Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Progress } from '@/components/ui/Progress'
import { cn } from '@/lib/utils'
import { useExamStore } from '@/store/useExamStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { computeExamRetentionStats, getExamCards, getExamDeckIds } from '@/lib/examScheduler'
import type { Exam, Deck, Folder as FolderType } from '@/lib/types'

function daysUntil(dateStr: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((new Date(dateStr + 'T00:00').getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

const urgencyColor = (days: number) =>
  days <= 7 ? 'text-[var(--danger)]' : days <= 14 ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]'
const urgencyBg = (days: number) =>
  days <= 7 ? 'bg-[var(--danger-subtle)]' : days <= 14 ? 'bg-[var(--warning-subtle)]' : 'bg-[var(--bg-active)]'

function retentionColor(r: number) {
  if (r >= 0.85) return 'success' as const
  if (r >= 0.65) return 'accent' as const
  return 'danger' as const
}

function DeckFolderTree({ exam, decks, folders, examDeckIds }: {
  exam: Exam
  decks: Deck[]
  folders: FolderType[]
  examDeckIds: string[]
}) {
  const { addDeckToExam, removeDeckFromExam, addFolderToExam, removeFolderFromExam } = useExamStore()
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  const toggleFolder = (id: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const isFolderLinked = (id: string) => (exam.folderIds ?? []).includes(id)
  const isDeckLinked = (id: string) => examDeckIds.includes(id)

  const rootFolders = folders.filter((f) => !f.parentId && !f.isArchived)
  const rootDecks   = decks.filter((d) => !d.folderId && !d.isArchived)

  return (
    <div className="space-y-0.5">
      {rootFolders.map((folder) => {
        const isExpanded = expandedFolders.has(folder.id)
        const linked = isFolderLinked(folder.id)
        const childDecks = decks.filter((d) => d.folderId === folder.id && !d.isArchived)
        return (
          <div key={folder.id}>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => toggleFolder(folder.id)}
                className="p-0.5 text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0"
              >
                <ChevronRight size={11} className={cn('transition-transform duration-150', isExpanded && 'rotate-90')} />
              </button>
              <button
                onClick={() =>
                  linked ? removeFolderFromExam(exam.id, folder.id) : addFolderToExam(exam.id, folder.id)
                }
                className={cn(
                  'flex-1 flex items-center gap-1.5 text-[10px] px-1.5 py-1 rounded-[var(--radius-sm)] transition-colors',
                  linked
                    ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-active)]'
                )}
              >
                <Folder size={11} className="shrink-0" />
                <span className="flex-1 text-left truncate">{folder.name}</span>
                {linked && <Check size={10} className="shrink-0" />}
              </button>
            </div>
            {isExpanded && childDecks.map((deck) => {
              const deckLinked = isDeckLinked(deck.id)
              return (
                <button
                  key={deck.id}
                  onClick={() =>
                    deckLinked ? removeDeckFromExam(exam.id, deck.id) : addDeckToExam(exam.id, deck.id)
                  }
                  className={cn(
                    'w-full flex items-center gap-1.5 text-[10px] pl-8 pr-2 py-1 rounded-[var(--radius-sm)] transition-colors',
                    deckLinked
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-active)]'
                  )}
                >
                  <BookOpen size={10} className="shrink-0" />
                  <span className="flex-1 text-left truncate">{deck.name}</span>
                  {deckLinked && <Check size={10} className="shrink-0" />}
                </button>
              )
            })}
          </div>
        )
      })}
      {rootDecks.map((deck) => {
        const linked = isDeckLinked(deck.id)
        return (
          <button
            key={deck.id}
            onClick={() =>
              linked ? removeDeckFromExam(exam.id, deck.id) : addDeckToExam(exam.id, deck.id)
            }
            className={cn(
              'w-full flex items-center gap-1.5 text-[10px] px-1.5 py-1 rounded-[var(--radius-sm)] transition-colors',
              linked
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-active)]'
            )}
          >
            <ChevronRight size={11} className="shrink-0 text-transparent" />
            <BookOpen size={11} className="shrink-0" />
            <span className="flex-1 text-left truncate">{deck.name}</span>
            {linked && <Check size={10} className="shrink-0 ml-auto" />}
          </button>
        )
      })}
      {rootFolders.length === 0 && rootDecks.length === 0 && (
        <p className="text-[10px] text-[var(--text-muted)] px-2 py-1">No decks or folders yet</p>
      )}
    </div>
  )
}

function ExamRow({ exam }: { exam: Exam }) {
  const { deleteExam, setTargetRetention } = useExamStore()
  const { decks, folders, cards, fsrsData } = useLibraryStore()
  const [expanded, setExpanded] = useState(false)

  const days = daysUntil(exam.date)
  const examCards = getExamCards(exam, decks, cards, folders)
  const stats = computeExamRetentionStats(exam, examCards, fsrsData)
  const examDeckIds = getExamDeckIds(exam, decks, folders)

  const retPct = Math.round(stats.avgRetention * 100)

  return (
    <div className="border-b border-[var(--border)] last:border-0">
      <div className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-hover)] transition-colors group">
        {/* Countdown */}
        <div className={cn('w-9 h-9 rounded-[var(--radius-sm)] flex flex-col items-center justify-center shrink-0', urgencyBg(days))}>
          <span className={cn('text-sm font-bold leading-none', urgencyColor(days))}>{days}</span>
          <span className="text-[9px] text-[var(--text-muted)] mt-0.5">days</span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <p className="text-xs font-medium text-[var(--text-primary)] truncate">{exam.name}</p>
            {stats.pulledForwardCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-[var(--warning)] shrink-0">
                <AlertTriangle size={9} />
                {stats.pulledForwardCount} early
              </span>
            )}
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mb-1">{exam.subject}</p>

          {/* Retention bar */}
          {stats.reviewedCards > 0 && (
            <div className="flex items-center gap-2">
              <Progress value={retPct} max={100} size="sm" className="w-20" color={retentionColor(stats.avgRetention)} />
              <span className="text-[9px] text-[var(--text-muted)]">{retPct}% on exam day</span>
              {stats.atRisk > 0 && (
                <span className="text-[9px] text-[var(--danger)]">{stats.atRisk} at risk</span>
              )}
            </div>
          )}
          {stats.totalCards === 0 && (
            <p className="text-[10px] text-[var(--text-muted)]">No decks linked yet</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="opacity-0 group-hover:opacity-100 transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={() => deleteExam(exam.id)}
            className="opacity-0 group-hover:opacity-100 transition-colors text-[var(--text-muted)] hover:text-[var(--danger)] p-0.5"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Expanded panel */}
      {expanded && (
        <div className="px-4 pb-4 bg-[var(--bg-hover)] space-y-3">
          {/* Stats row */}
          {stats.totalCards > 0 && (
            <div className="grid grid-cols-4 gap-2 pt-2">
              {[
                { label: 'Total', value: stats.totalCards },
                { label: 'On target', value: stats.onTarget, color: 'text-[var(--success)]' },
                { label: 'At risk', value: stats.atRisk, color: 'text-[var(--danger)]' },
                { label: 'New', value: stats.newCards, color: 'text-[var(--text-muted)]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="text-center">
                  <p className={cn('text-sm font-bold', color ?? 'text-[var(--text-primary)]')}>{value}</p>
                  <p className="text-[9px] text-[var(--text-muted)]">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Target retention slider */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[var(--text-muted)] shrink-0">Target retention</span>
            <input
              type="range" min={0.5} max={0.99} step={0.05}
              value={exam.targetRetention ?? 0.85}
              onChange={(e) => setTargetRetention(exam.id, parseFloat(e.target.value))}
              className="flex-1 accent-[var(--accent)] h-1"
            />
            <span className="text-[10px] font-medium text-[var(--text-primary)] w-8 text-right">
              {Math.round((exam.targetRetention ?? 0.85) * 100)}%
            </span>
          </div>

          {/* Deck/folder tree — click to link or unlink */}
          <div>
            <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-1">Link decks &amp; folders</p>
            <DeckFolderTree
              exam={exam}
              decks={decks}
              folders={folders}
              examDeckIds={examDeckIds}
            />
          </div>
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
    setName(''); setSubject(''); setDate(''); setPriority('medium')
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
          <input placeholder="Exam name *" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
            className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
          <input placeholder="Subject *" value={subject} onChange={(e) => setSubject(e.target.value)} required
            className="w-full text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} required
              className="flex-1 text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]" />
            <select value={priority} onChange={(e) => setPriority(e.target.value as Exam['priority'])}
              className="text-xs bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="flex-1 text-xs font-medium py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
              Save Exam
            </button>
            <button type="button" onClick={() => setShowForm(false)}
              className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-active)] transition-colors">
              Cancel
            </button>
          </div>
        </form>
      )}

      {sorted.length === 0 && !showForm ? (
        <div className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          No exams — click Add to start tracking
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
