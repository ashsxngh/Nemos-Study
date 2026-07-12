'use client'

import { useState } from 'react'
import { Sun, Brain, Bell, Keyboard, Database, AlertTriangle, Sparkles, Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/useAppStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { optimizeFsrsWeights, MIN_REVIEWS_FOR_OPTIMIZATION } from '@/lib/srs'
import { FSRSSimulator } from '@/components/settings/FSRSSimulator'
import {
  Toggle,
  SettingRow,
  NumberField,
  FSRSWeightsGrid,
  ResetFSRSDefaultsButton,
  BurnoutThresholdToggles,
  DataBackupSection,
  THEMES,
} from '@/components/settings/SettingsShared'
import { cn } from '@/lib/utils'

const sections = [
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'srs', label: 'Review Algorithm', icon: Brain },
  { id: 'fsrs-sim', label: 'FSRS Simulator', icon: Activity },
  { id: 'burnout', label: 'Burnout & Workload', icon: AlertTriangle },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'data', label: 'Data & Backup', icon: Database },
]

const shortcuts = [
  { action: 'Open command palette', keys: ['⌘', 'K'] },
  { action: 'Search', keys: ['/'] },
  { action: 'New card', keys: ['N'] },
  { action: 'Flip card', keys: ['Space'] },
  { action: 'Rate: Again', keys: ['1'] },
  { action: 'Rate: Hard', keys: ['2'] },
  { action: 'Rate: Good', keys: ['3'] },
  { action: 'Rate: Easy', keys: ['4'] },
  { action: 'Toggle sidebar', keys: ['['] },
  { action: 'Toggle theme', keys: ['⌘', 'Shift', 'L'] },
]

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('appearance')
  const { theme, setTheme, addToast } = useAppStore(
    useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme, addToast: s.addToast }))
  )
  const reviewLogs = useHistoryStore((s) => s.reviewLogs)
  const settings = useSettingsStore()
  const { updateSettings, resetSettings } = settings

  // ── FSRS weight optimization ───────────────────────────────────────────────
  const handleOptimizeWeights = () => {
    const result = optimizeFsrsWeights(
      reviewLogs.map((l) => ({ cardId: l.cardId, rating: l.rating, reviewedAt: l.reviewedAt }))
    )
    if (!result) {
      addToast({
        type: 'warning',
        message: `Not enough review history yet (needs ~${MIN_REVIEWS_FOR_OPTIMIZATION}+ repeat reviews). Keep studying and try again.`,
      })
      return
    }
    updateSettings({ fsrsWeights: result.weights })
    addToast({ type: 'success', message: `Weights optimized from ${result.reviewCount} reviews.` })
  }

  // ── Projected daily load ───────────────────────────────────────────────────
  const projectedLoad = (() => {
    const timed = reviewLogs.filter((l) => l.responseMs > 0)
    const avgSec = timed.length > 0
      ? Math.min(30, Math.max(3, timed.reduce((s, l) => s + l.responseMs, 0) / timed.length / 1000 + 3))
      : 9
    const weekAgo = Date.now() - 7 * 86400000
    const recentReviews = reviewLogs.filter((l) => new Date(l.reviewedAt).getTime() >= weekAgo).length
    const avgDailyReviews = Math.round(recentReviews / 7)
    const projectedCards = settings.newCardsPerDay + Math.min(settings.maxReviewsPerDay, avgDailyReviews)
    const minutes = Math.max(1, Math.round((projectedCards * avgSec) / 60))
    const pct = Math.min(100, Math.round((minutes / Math.max(settings.dailyMinuteTarget, 1)) * 100))
    return { minutes, pct, projectedCards }
  })()

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex gap-6">
        {/* Nav */}
        <nav className="w-44 shrink-0 space-y-0.5">
          {sections.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                'w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[var(--radius-sm)] text-sm transition-colors text-left',
                activeSection === id
                  ? 'bg-[var(--bg-active)] text-[var(--text-primary)] font-medium'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              )}
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* ── Appearance ── */}
          {activeSection === 'appearance' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Appearance</h2>
              <div className="space-y-6">
                <div>
                  <label className="text-xs font-medium text-[var(--text-secondary)] block mb-2">Theme</label>
                  <div className="flex gap-2">
                    {THEMES.map(({ value, label, icon: Icon }) => (
                      <button
                        key={value}
                        onClick={() => setTheme(value)}
                        className={cn(
                          'flex flex-col items-center gap-2 p-3 rounded-[var(--radius)] border text-xs transition-colors w-24',
                          theme === value
                            ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                            : 'border-[var(--border)] hover:border-[var(--border-strong)] text-[var(--text-secondary)]'
                        )}
                      >
                        <Icon size={18} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Card appearance */}
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-0.5">Customize card appearance</p>
                  <p className="text-xs text-[var(--text-muted)] mb-3">Choose what information appears under a card in the deck page.</p>
                  <div className="grid grid-cols-3 gap-x-4 gap-y-2.5 mb-4">
                    {(
                      [
                        { key: 'progress', label: 'Progress' },
                        { key: 'lastReview', label: 'Last review' },
                        { key: 'dueDate', label: 'Due date' },
                        { key: 'retention', label: 'Retention' },
                        { key: 'tagsList', label: 'Tags list' },
                        { key: 'createdAt', label: 'Created at' },
                        { key: 'updatedAt', label: 'Updated at' },
                      ] as { key: keyof typeof settings.cardFields; label: string }[]
                    ).map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={settings.cardFields[key]}
                          onChange={(e) =>
                            updateSettings({ cardFields: { ...settings.cardFields, [key]: e.target.checked } })
                          }
                          className="w-4 h-4 rounded accent-[var(--accent)] cursor-pointer"
                        />
                        <span className="text-sm text-[var(--text-primary)]">{label}</span>
                      </label>
                    ))}
                  </div>

                  {/* Live preview */}
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4">
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">Example card</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
                      {settings.cardFields.progress && (
                        <span className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
                          <span className="w-3 h-3 rounded-full border border-[var(--text-muted)] inline-block" />
                          8 DAYS
                        </span>
                      )}
                      {settings.cardFields.retention && (
                        <span className="text-[11px] text-[var(--text-muted)]">↺ 82%</span>
                      )}
                      {settings.cardFields.lastReview && (
                        <span className="text-[11px] text-[var(--text-muted)]">Reviewed 2d ago</span>
                      )}
                      {settings.cardFields.dueDate && (
                        <span className="text-[11px] text-[var(--text-muted)]">Due Jun 15</span>
                      )}
                      {settings.cardFields.tagsList && (
                        <span className="text-[11px] text-[var(--text-muted)]">#biology</span>
                      )}
                      {settings.cardFields.createdAt && (
                        <span className="text-[11px] text-[var(--text-muted)]">Created Jun 1</span>
                      )}
                      {settings.cardFields.updatedAt && (
                        <span className="text-[11px] text-[var(--text-muted)]">Updated Jun 10</span>
                      )}
                      {!Object.values(settings.cardFields).some(Boolean) && (
                        <span className="text-[11px] text-[var(--text-muted)] italic">No fields selected</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* ── Review Algorithm (FSRS) ── */}
          {activeSection === 'srs' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Review Algorithm</h2>

              <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day — new cards that have never been reviewed">
                      <NumberField value={settings.newCardsPerDay} onChange={(v) => updateSettings({ newCardsPerDay: v })} />
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards (previously seen cards due for repetition) per day">
                      <NumberField value={settings.maxReviewsPerDay} onChange={(v) => updateSettings({ maxReviewsPerDay: v })} />
                    </SettingRow>
                    <SettingRow label="Session length" description="Cards per study session (default 20, 5-100)">
                      <NumberField value={settings.sessionLength} onChange={(v) => updateSettings({ sessionLength: v })} bounds={{ min: 5, max: 100 }} />
                    </SettingRow>
                    <SettingRow
                      label="Target retention"
                      description="Desired probability of recall at review time (default: 0.90)"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0.7}
                          max={0.99}
                          step={0.01}
                          value={settings.fsrsTargetRetention}
                          onChange={(e) =>
                            updateSettings({ fsrsTargetRetention: parseFloat(e.target.value) })
                          }
                          className="w-24 accent-[var(--accent)]"
                        />
                        <span className="text-xs text-[var(--text-secondary)] w-10 text-right">
                          {(settings.fsrsTargetRetention * 100).toFixed(0)}%
                        </span>
                      </div>
                    </SettingRow>
                    <SettingRow label="Maximum interval (days)" description="Cap on review interval in days (default: 36500)">
                      <NumberField value={settings.fsrsMaxInterval} onChange={(v) => updateSettings({ fsrsMaxInterval: v })} />
                    </SettingRow>
                    <SettingRow label="Show answer timer" description="Display response time while reviewing">
                      <Toggle checked={settings.showAnswerTimer} onChange={(v) => updateSettings({ showAnswerTimer: v })} />
                    </SettingRow>
                  </div>

                  <div className="space-y-2 mt-4">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      FSRS-5 weights (w0–w16)
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      FSRS-5 uses machine-learning optimized weights. Change these only if you have
                      optimized parameters from your own data.
                    </p>
                    <FSRSWeightsGrid />
                  </div>

                  {/* Optimize weights from review history */}
                  <div className="mt-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[var(--accent-subtle)] flex items-center justify-center shrink-0">
                        <Sparkles size={15} className="text-[var(--accent)]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--text-primary)]">Optimize weights</p>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          Tune the scheduler to your actual recall — based on {reviewLogs.length.toLocaleString()} reviews.
                        </p>
                      </div>
                    </div>
                    <Button variant="primary" size="sm" onClick={handleOptimizeWeights}>
                      Optimize Now
                    </Button>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <ResetFSRSDefaultsButton />
                  </div>
              </>
            </section>
          )}

          {/* ── FSRS Simulator ── */}
          {activeSection === 'fsrs-sim' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">FSRS Simulator</h2>
              <FSRSSimulator />
            </section>
          )}

          {/* ── Burnout & Workload ── */}
          {activeSection === 'burnout' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Burnout &amp; Workload</h2>

              {/* Projected daily load */}
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 mb-3 flex items-center gap-5">
                <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="transparent" stroke="var(--bg-active)" strokeWidth="5" />
                    <circle
                      cx="32" cy="32" r="28" fill="transparent"
                      stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 28}
                      strokeDashoffset={2 * Math.PI * 28 * (1 - projectedLoad.pct / 100)}
                    />
                  </svg>
                  <span className="absolute text-[10px] font-bold text-[var(--text-primary)]">
                    {projectedLoad.pct}%
                  </span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    ~{projectedLoad.minutes} min/day
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    Projected load — about {projectedLoad.projectedCards} cards/day at your current limits
                    and review pace, vs your {settings.dailyMinuteTarget} min daily target.
                  </p>
                </div>
              </div>

              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                <BurnoutThresholdToggles />

                {/* Leech threshold */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-primary)]">Flag leeches after</p>
                    <div className="flex items-center gap-2">
                      <NumberField value={settings.leechThreshold} onChange={(v) => updateSettings({ leechThreshold: v })} className="w-20" />
                      <span className="text-xs text-[var(--text-muted)]">lapses</span>
                    </div>
                  </div>
                </div>

                {/* Auto-suspend leeches */}
                <SettingRow label="Auto-suspend leeches" description="Archive cards automatically once they hit the leech threshold, so they stop clogging reviews">
                  <Toggle checked={settings.autoSuspendLeeches} onChange={(v) => updateSettings({ autoSuspendLeeches: v })} />
                </SettingRow>

                {/* Session progress bar */}
                <SettingRow label="Show session progress bar" description="Display the green/red progress bar at the top of study sessions">
                  <Toggle checked={settings.showSessionProgress} onChange={(v) => updateSettings({ showSessionProgress: v })} />
                </SettingRow>

                {/* Auto-advance */}
                <SettingRow label="Auto-advance after rating" description="Automatically move to the next card after rating">
                  <Toggle checked={settings.autoAdvance} onChange={(v) => updateSettings({ autoAdvance: v })} />
                </SettingRow>

                {/* Daily goals */}
                <SettingRow label="Daily card target" description="Cards to review per day goal">
                  <NumberField value={settings.dailyCardTarget} onChange={(v) => updateSettings({ dailyCardTarget: v })} />
                </SettingRow>
                <SettingRow label="Daily minute target" description="Study time goal per day (minutes)">
                  <NumberField value={settings.dailyMinuteTarget} onChange={(v) => updateSettings({ dailyMinuteTarget: v })} />
                </SettingRow>
              </div>

              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={resetSettings}>Reset to defaults</Button>
              </div>
            </section>
          )}

          {/* ── Notifications ── */}
          {activeSection === 'notifications' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Notifications</h2>
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">

                {/* Daily reminder */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-primary)]">Daily review reminder</p>
                    <Toggle
                      checked={settings.dailyReminderEnabled}
                      onChange={(v) => updateSettings({ dailyReminderEnabled: v })}
                    />
                  </div>
                  {settings.dailyReminderEnabled && (
                    <div className="flex items-center gap-2 pl-1">
                      <span className="text-xs text-[var(--text-muted)]">Remind me at</span>
                      <input
                        type="time"
                        value={settings.dailyReminderTime}
                        onChange={(e) => updateSettings({ dailyReminderTime: e.target.value })}
                        className={cn(
                          'h-8 bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)]',
                          'text-[var(--text-primary)] text-sm px-2',
                          'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]'
                        )}
                      />
                    </div>
                  )}
                </div>

                <SettingRow label="Streak at risk warning" description="Notify when you haven't studied and streak may break">
                  <Toggle checked={settings.streakWarningEnabled} onChange={(v) => updateSettings({ streakWarningEnabled: v })} />
                </SettingRow>

                <SettingRow label="Weekly progress report" description="Summary of your progress every week">
                  <Toggle checked={settings.weeklyReportEnabled} onChange={(v) => updateSettings({ weeklyReportEnabled: v })} />
                </SettingRow>
              </div>

              <div className="mt-3 flex justify-end">
                <Button variant="ghost" size="sm" onClick={resetSettings}>Reset to defaults</Button>
              </div>
            </section>
          )}

          {/* ── Keyboard Shortcuts ── */}
          {activeSection === 'shortcuts' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Keyboard Shortcuts</h2>
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                {shortcuts.map(({ action, keys }) => (
                  <div key={action} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-[var(--text-primary)]">{action}</span>
                    <div className="flex items-center gap-1">
                      {keys.map((k) => (
                        <kbd key={k} className="text-xs bg-[var(--bg-active)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono text-[var(--text-secondary)]">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Data & Backup ── */}
          {activeSection === 'data' && (
            <section>
              <h2 className="meta-label text-[var(--text-secondary)] mb-4">Data & Backup</h2>
              <DataBackupSection />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
