'use client'

import { useState } from 'react'
import { Check, X, Ban, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/useSettingsStore'
import { fsrsInitCard, fsrsSchedule, DEFAULT_FSRS_PARAMS, type FSRSState } from '@/lib/srs'
import { cn } from '@/lib/utils'

interface Step {
  grade: 1 | 3 // 1 = Forget (Again), 3 = Remember (Good)
  retrievability: number // R at the moment of this review
  intervalDays: number
  state: FSRSState
}

// The simulator only cares about relative day-deltas, never real wall-clock
// time, so every "now" is anchored to this fixed instant rather than
// Date.now() — keeps the component pure and the math fully deterministic.
const ANCHOR_MS = 0

function fmtInterval(days: number): string {
  if (days < 1) {
    const mins = Math.round(days * 1440)
    return mins <= 1 ? '1 min' : `${mins} min`
  }
  if (days < 30) return `${Math.round(days)} days`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return `${(days / 365).toFixed(1)} yr`
}

export function FSRSSimulator() {
  const { fsrsWeights, fsrsTargetRetention, fsrsMaxInterval } = useSettingsStore()
  const params = {
    ...DEFAULT_FSRS_PARAMS,
    weights: fsrsWeights,
    targetRetention: fsrsTargetRetention,
    maximumInterval: fsrsMaxInterval,
    requestRetention: fsrsTargetRetention,
  }

  const [mode, setMode] = useState<'new' | 'manual'>('new')
  const [manualStability, setManualStability] = useState(10)
  const [manualDifficulty, setManualDifficulty] = useState(5)
  const [manualDaysSince, setManualDaysSince] = useState(0)

  const [history, setHistory] = useState<Step[]>([])
  const hasStarted = history.length > 0

  // The state the next button press will act on — either the configured
  // starting point, or the result of the last step.
  function baseState(): FSRSState {
    if (history.length > 0) return history[history.length - 1].state
    if (mode === 'new') return fsrsInitCard('sim', 'sim')
    const lastReviewedAt = new Date(ANCHOR_MS - manualDaysSince * 86400000)
    return {
      cardId: 'sim',
      userId: 'sim',
      stability: manualStability,
      difficulty: manualDifficulty,
      retrievability: Math.pow(1 + manualDaysSince / (9 * manualStability), -1),
      dueDate: lastReviewedAt.toISOString(),
      lastReviewedAt: lastReviewedAt.toISOString(),
      repetitions: 1,
      lapses: 0,
      state: 'review',
    }
  }

  // The point in time the next press simulates reviewing at — the anchor for
  // the first press, otherwise exactly when the card next comes due (the
  // realistic case: you review right on schedule).
  function nextReviewedAt(): Date {
    if (history.length === 0) return new Date(ANCHOR_MS)
    return new Date(history[history.length - 1].state.dueDate)
  }

  const current = baseState()

  function press(grade: 1 | 3) {
    const reviewedAt = nextReviewedAt()
    const result = fsrsSchedule(current, grade, params, reviewedAt)
    const intervalDays =
      (new Date(result.dueDate).getTime() - reviewedAt.getTime()) / 86400000
    setHistory((h) => [...h, { grade, retrievability: result.retrievability, intervalDays, state: result }])
  }

  function reset() {
    setHistory([])
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-muted)]">
        Step through reviews and see how the schedule evolves — using your configured weights,
        target retention, and max interval.
      </p>

      {/* Starting state */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs font-medium text-[var(--text-secondary)]">Starting state</span>
        <div className="flex gap-1.5">
          <button
            onClick={() => { setMode('new'); reset() }}
            disabled={hasStarted}
            className={cn(
              'px-2.5 py-1 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors',
              mode === 'new'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
              hasStarted && 'opacity-50 cursor-not-allowed'
            )}
          >
            New card
          </button>
          <button
            onClick={() => { setMode('manual'); reset() }}
            disabled={hasStarted}
            className={cn(
              'px-2.5 py-1 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors',
              mode === 'manual'
                ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]',
              hasStarted && 'opacity-50 cursor-not-allowed'
            )}
          >
            Manual
          </button>
        </div>

        {mode === 'manual' && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-[var(--text-muted)]">Stability</label>
              <Input
                type="number"
                className="text-right text-xs h-7 w-16"
                value={manualStability}
                disabled={hasStarted}
                onChange={(e) => setManualStability(parseFloat(e.target.value) || 0.1)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-[var(--text-muted)]">Difficulty</label>
              <Input
                type="number"
                className="text-right text-xs h-7 w-14"
                value={manualDifficulty}
                disabled={hasStarted}
                onChange={(e) => setManualDifficulty(Math.min(10, Math.max(1, parseFloat(e.target.value) || 1)))}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[10px] text-[var(--text-muted)]">Days since review</label>
              <Input
                type="number"
                className="text-right text-xs h-7 w-14"
                value={manualDaysSince}
                disabled={hasStarted}
                onChange={(e) => setManualDaysSince(Math.max(0, parseFloat(e.target.value) || 0))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <TimelineBox icon={<Check size={13} />} tone="neutral" />
          <Arrow />
          <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">Added</span>

          {history.map((step, i) => (
            <span key={i} className="flex items-center gap-2">
              <Arrow />
              <TimelineBox
                icon={step.grade === 3 ? <Check size={13} /> : <X size={13} />}
                tone={step.grade === 3 ? 'success' : 'danger'}
                title={`${step.grade === 3 ? 'Remember' : 'Forget'} — S ${step.state.stability.toFixed(1)}d, D ${step.state.difficulty.toFixed(1)}, R ${Math.round(step.retrievability * 100)}%`}
              />
              <Arrow />
              <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">
                {fmtInterval(step.intervalDays)}
              </span>
            </span>
          ))}
        </div>

        {/* Current schedule readout */}
        <div className="flex items-center gap-4 text-xs text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--border)]">
          <span>Stability <span className="text-[var(--text-primary)] font-medium">{current.stability.toFixed(2)}d</span></span>
          <span>Difficulty <span className="text-[var(--text-primary)] font-medium">{current.difficulty.toFixed(2)}</span></span>
          <span>Retrievability <span className="text-[var(--text-primary)] font-medium">
            {Math.round((hasStarted ? history[history.length - 1].retrievability : current.retrievability) * 100)}%
          </span></span>
        </div>
      </div>

      <p className="text-xs text-[var(--text-muted)]">
        Use the buttons below to see how your responses affect the review schedule for a card.
      </p>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" icon={<Check size={13} />} onClick={() => press(3)}>
          Remember
        </Button>
        <Button variant="outline" size="sm" icon={<X size={13} />} onClick={() => press(1)}>
          Forget
        </Button>
        <Button variant="outline" size="sm" icon={<Ban size={13} />} onClick={reset} disabled={!hasStarted}>
          Reset
        </Button>
      </div>
    </div>
  )
}

function Arrow() {
  return <ArrowRight size={13} className="text-[var(--text-muted)] shrink-0" />
}

function TimelineBox({
  icon,
  tone,
  title,
}: {
  icon: React.ReactNode
  tone: 'neutral' | 'success' | 'danger'
  title?: string
}) {
  return (
    <div
      title={title}
      className={cn(
        'w-7 h-7 rounded-[var(--radius-sm)] border flex items-center justify-center shrink-0',
        tone === 'neutral' && 'bg-[var(--bg-active)] border-[var(--border)] text-[var(--text-primary)]',
        tone === 'success' && 'bg-[var(--bg-active)] border-[var(--success)] text-[var(--success)]',
        tone === 'danger' && 'bg-[var(--bg-active)] border-[var(--danger)] text-[var(--danger)]'
      )}
    >
      {icon}
    </div>
  )
}
