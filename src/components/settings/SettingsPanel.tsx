'use client'

import { useEffect, useState } from 'react'
import { X, Sun, Brain, Bell, Keyboard, Database, AlertTriangle, Activity } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/useAppStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { FSRSSimulator } from '@/components/settings/FSRSSimulator'
import {
  Toggle,
  SettingRow,
  AlgorithmPicker,
  FSRSWeightsGrid,
  ResetFSRSDefaultsButton,
  BurnoutThresholdToggles,
  DataBackupSection,
  NumberField,
  THEMES,
} from '@/components/settings/SettingsShared'
import { cn } from '@/lib/utils'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

// ── Keyboard shortcut recorder ───────────────────────────────────────────────

function formatKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key === 'ArrowLeft') return '←'
  if (key === 'ArrowRight') return '→'
  if (key === 'ArrowUp') return '↑'
  if (key === 'ArrowDown') return '↓'
  if (key === 'Enter') return 'Enter'
  if (key === 'Escape') return 'Esc'
  if (key === 'Backspace') return '⌫'
  if (key === 'Tab') return 'Tab'
  if (key.length === 1) return key.toUpperCase()
  return key
}

const BLOCKED_KEYS = new Set(['Escape', 'Tab', 'CapsLock', 'Meta', 'Control', 'Alt', 'Shift'])

interface ShortcutRecorderProps {
  value: string
  onChange: (key: string) => void
}

function ShortcutRecorder({ value, onChange }: ShortcutRecorderProps) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const handler = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (BLOCKED_KEYS.has(e.key)) {
        setRecording(false)
        return
      }
      onChange(e.key)
      setRecording(false)
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [recording, onChange])

  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      className={cn(
        'min-w-[56px] px-2 py-1 rounded border text-xs font-mono font-medium transition-colors',
        recording
          ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] animate-pulse'
          : 'border-[var(--border)] bg-[var(--bg-active)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]'
      )}
    >
      {recording ? 'Press key…' : formatKey(value)}
    </button>
  )
}

const globalShortcuts = [
  { action: 'Command palette', keys: ['⌘', 'K'] },
  { action: 'Toggle sidebar', keys: ['['] },
  { action: 'Toggle theme', keys: ['⌘', 'Shift', 'L'] },
  { action: 'Navigate back', keys: ['Alt', '←'] },
  { action: 'Flip card (study)', keys: ['Space'] },
]

// ── Sub-components ────────────────────────────────────────────────────────────

interface SectionHeadingProps {
  icon: React.ElementType
  label: string
}

function SectionHeading({ icon: Icon, label }: SectionHeadingProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className="text-[var(--text-muted)]" />
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{label}</h3>
      </div>
      <hr className="border-[var(--border)]" />
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { theme, setTheme } = useAppStore(useShallow((s) => ({ theme: s.theme, setTheme: s.setTheme })))
  const settings = useSettingsStore()
  const { updateSettings } = settings

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      {/* Fixed overlay positioned after the sidebar */}
      <div
        className="fixed inset-0 z-40"
        style={{ left: 'var(--sidebar-width, 220px)' }}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />

        {/* Panel */}
        <div
          className="absolute left-0 top-0 bottom-0 w-[480px] max-w-full bg-[var(--bg-surface)] border-r border-[var(--border)] overflow-y-auto shadow-2xl flex flex-col"
          style={{
            transform: open ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.2s ease',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] shrink-0">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Settings</h2>
            <button
              onClick={onClose}
              className="w-6 h-6 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
              aria-label="Close settings"
            >
              <X size={14} />
            </button>
          </div>

          {/* Settings content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-8">

            {/* ── Appearance ── */}
            <section className="space-y-4">
              <SectionHeading icon={Sun} label="Appearance" />
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
            </section>

            {/* ── SRS Algorithm ── */}
            <section className="space-y-4">
              <SectionHeading icon={Brain} label="SRS Algorithm" />

              <AlgorithmPicker />

              {settings.algorithm === 'sm2' && (
                <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day">
                      <NumberField value={settings.newCardsPerDay} onChange={(v) => updateSettings({ newCardsPerDay: v })} />
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards per day">
                      <NumberField value={settings.maxReviewsPerDay} onChange={(v) => updateSettings({ maxReviewsPerDay: v })} />
                    </SettingRow>
                    <SettingRow label="Session length" description="Cards per study session (default 20, 5-100)">
                      <NumberField value={settings.sessionLength} onChange={(v) => updateSettings({ sessionLength: v })} bounds={{ min: 5, max: 100 }} />
                    </SettingRow>
                    <SettingRow label="Starting ease factor" description="Initial ease multiplier for new cards (default: 2.5)">
                      <NumberField value={settings.startingEase} onChange={(v) => updateSettings({ startingEase: v })} />
                    </SettingRow>
                    <SettingRow label="Easy bonus" description="Added to ease factor when you rate Easy (default: 0.15)">
                      <NumberField value={settings.easyBonus} onChange={(v) => updateSettings({ easyBonus: v })} />
                    </SettingRow>
                    <SettingRow label="Hard interval multiplier" description="Interval multiplier when you rate Hard (default: 1.2)">
                      <NumberField value={settings.hardInterval} onChange={(v) => updateSettings({ hardInterval: v })} />
                    </SettingRow>
                    <SettingRow label="Graduating interval (days)" description="Interval after second Good rating (default: 4)">
                      <NumberField value={settings.graduatingInterval} onChange={(v) => updateSettings({ graduatingInterval: v })} />
                    </SettingRow>
                    <SettingRow label="Lapse interval (%)" description="New interval as % of previous after forgetting (default: 10%)">
                      <NumberField value={settings.lapseInterval} onChange={(v) => updateSettings({ lapseInterval: v })} />
                    </SettingRow>
                    <SettingRow label="Leech threshold (lapses)" description="Flag a card as a leech after this many lapses">
                      <NumberField value={settings.leechThreshold} onChange={(v) => updateSettings({ leechThreshold: v })} />
                    </SettingRow>
                  </div>
                </>
              )}

              {settings.algorithm === 'fsrs' && (
                <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day">
                      <NumberField value={settings.newCardsPerDay} onChange={(v) => updateSettings({ newCardsPerDay: v })} />
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards per day">
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
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">
                      FSRS-5 weights (w0–w16)
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      FSRS-5 uses machine-learning optimized weights. Change these only if you have
                      optimized parameters from your own data.
                    </p>
                    <FSRSWeightsGrid />
                  </div>

                  <div className="flex justify-end">
                    <ResetFSRSDefaultsButton />
                  </div>
                </>
              )}
            </section>

            {/* ── FSRS Simulator ── */}
            <section className="space-y-4">
              <SectionHeading icon={Activity} label="FSRS Simulator" />
              <FSRSSimulator />
            </section>

            {/* ── Burnout & Workload ── */}
            <section className="space-y-4">
              <SectionHeading icon={AlertTriangle} label="Burnout & Workload" />

              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                <BurnoutThresholdToggles />

                <SettingRow label="Auto-advance after rating" description="Automatically move to the next card after rating">
                  <Toggle checked={settings.autoAdvance} onChange={(v) => updateSettings({ autoAdvance: v })} />
                </SettingRow>
              </div>
            </section>

            {/* ── Notifications ── */}
            <section className="space-y-4">
              <SectionHeading icon={Bell} label="Notifications" />

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
            </section>

            {/* ── Keyboard Shortcuts ── */}
            <section className="space-y-4">
              <SectionHeading icon={Keyboard} label="Keyboard Shortcuts" />

              {/* Study session — customisable */}
              <div>
                <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Study session</p>
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                  {([
                    { key: 'forgot',     label: 'Missed', description: 'Rate card to review again soon' },
                    { key: 'remembered', label: 'Remembered', description: 'Rate card as remembered (also flips card)' },
                    { key: 'skip',       label: 'Skip card',  description: 'Skip without rating' },
                    { key: 'back',       label: 'Go back',    description: 'Return to previous card' },
                  ] as const).map(({ key, label, description }) => (
                    <div key={key} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <p className="text-sm text-[var(--text-primary)]">{label}</p>
                        <p className="text-xs text-[var(--text-muted)]">{description}</p>
                      </div>
                      <ShortcutRecorder
                        value={settings.studyShortcuts[key]}
                        onChange={(k) =>
                          updateSettings({
                            studyShortcuts: { ...settings.studyShortcuts, [key]: k },
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-[var(--text-muted)] mt-1.5">Click a key badge then press any key to rebind.</p>
              </div>

              {/* Global — read-only */}
              <div>
                <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">Global</p>
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                  {globalShortcuts.map(({ action, keys }) => (
                    <div key={action} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm text-[var(--text-primary)]">{action}</span>
                      <div className="flex items-center gap-1">
                        {keys.map((k) => (
                          <kbd
                            key={k}
                            className="text-xs bg-[var(--bg-active)] border border-[var(--border)] rounded px-1.5 py-0.5 font-mono text-[var(--text-secondary)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ── Data & Backup ── */}
            <section className="space-y-4">
              <SectionHeading icon={Database} label="Data & Backup" />
              <DataBackupSection />
            </section>

          </div>
        </div>
      </div>
    </>
  )
}
