'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Sun, Moon, Monitor, Brain, Bell, Keyboard, Database, Download, Upload, Trash2, AlertTriangle, Activity } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { exportAsJSON, exportDecksAsCSV } from '@/lib/export'
import { importFromCSV, importFromJSON } from '@/lib/import'
import { FSRSSimulator } from '@/components/settings/FSRSSimulator'
import { cn } from '@/lib/utils'
import type { Theme } from '@/lib/types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettingsPanelProps {
  open: boolean
  onClose: () => void
}

// ── Static data ───────────────────────────────────────────────────────────────

const themes: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
]

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

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
}

function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-9 h-5 rounded-full relative transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:ring-offset-1',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-active)]'
      )}
    >
      <div
        className={cn(
          'absolute top-1 w-3 h-3 bg-white rounded-full transition-transform duration-150',
          checked ? 'translate-x-5' : 'translate-x-1'
        )}
      />
    </button>
  )
}

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div>
        <p className="text-sm text-[var(--text-primary)]">{label}</p>
        {description && <p className="text-xs text-[var(--text-muted)] mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0 ml-4">{children}</div>
    </div>
  )
}

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

interface ImportCSVDialogProps {
  cards: { front: string; back: string }[]
  decks: { id: string; name: string }[]
  onConfirm: (deckId: string) => void
  onCancel: () => void
}

function ImportCSVDialog({ cards, decks, onConfirm, onCancel }: ImportCSVDialogProps) {
  const [selectedDeck, setSelectedDeck] = useState(decks[0]?.id ?? '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-6 w-full max-w-sm space-y-4 shadow-xl">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Import {cards.length} cards</h3>
        <p className="text-xs text-[var(--text-muted)]">Which deck would you like to import into?</p>
        {decks.length === 0 ? (
          <p className="text-xs text-[var(--danger)]">No decks found. Create a deck first.</p>
        ) : (
          <select
            value={selectedDeck}
            onChange={(e) => setSelectedDeck(e.target.value)}
            className={cn(
              'w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)]',
              'text-[var(--text-primary)] text-sm px-3 py-2',
              'focus:outline-none focus:ring-1 focus:ring-[var(--accent)] focus:border-[var(--accent)]'
            )}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onConfirm(selectedDeck)}
            disabled={!selectedDeck || decks.length === 0}
          >
            Import
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function SettingsPanel({ open, onClose }: SettingsPanelProps) {
  const { theme, setTheme, addToast } = useAppStore()
  const { folders, decks, cards, srsData, sessions, createCard } = useLibraryStore()
  const settings = useSettingsStore()
  const { updateSettings, resetSettings } = settings

  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [csvCards, setCsvCards] = useState<{ front: string; back: string }[] | null>(null)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Export handlers
  const handleExportJSON = () => {
    exportAsJSON({ folders, decks, cards, srsData, sessions })
  }

  const handleExportCSV = () => {
    exportDecksAsCSV(decks, cards)
  }

  // Import CSV
  const handleCSVFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const parsed = importFromCSV(text)
      if (parsed.length === 0) {
        addToast({ type: 'warning', message: 'No cards found in this CSV file.' })
        return
      }
      setCsvCards(parsed)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleCSVImportConfirm = (deckId: string) => {
    if (!csvCards) return
    for (const { front, back } of csvCards) {
      createCard(deckId, front, back, 'basic')
    }
    addToast({ type: 'success', message: `Imported ${csvCards.length} cards successfully.` })
    setCsvCards(null)
  }

  // Import JSON
  const handleJSONFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        importFromJSON(event.target?.result as string)
        addToast({ type: 'info', message: 'Backup imported — reload to see changes' })
      } catch {
        addToast({ type: 'error', message: 'Failed to parse backup file. Is it a valid Nemo JSON?' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  // Number input helper
  function numInput(
    key: Parameters<typeof updateSettings>[0] extends Partial<infer T> ? keyof T : never,
    value: number
  ) {
    return (
      <Input
        type="number"
        className="w-24 text-right"
        value={value}
        onChange={(e) => updateSettings({ [key]: parseFloat(e.target.value) || 0 })}
      />
    )
  }

  if (!open) return null

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={handleCSVFileChange}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleJSONFileChange}
      />

      {/* CSV import dialog renders above the panel */}
      {csvCards && (
        <ImportCSVDialog
          cards={csvCards}
          decks={decks}
          onConfirm={handleCSVImportConfirm}
          onCancel={() => setCsvCards(null)}
        />
      )}

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
                  {themes.map(({ value, label, icon: Icon }) => (
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

              {/* Algorithm picker */}
              <div>
                <label className="text-xs font-medium text-[var(--text-secondary)] block mb-2">Algorithm</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateSettings({ algorithm: 'sm2' })}
                    className={cn(
                      'px-3 py-1.5 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors',
                      settings.algorithm === 'sm2'
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    SM-2 (default)
                  </button>
                  <button
                    onClick={() => updateSettings({ algorithm: 'fsrs' })}
                    className={cn(
                      'px-3 py-1.5 rounded-[var(--radius-sm)] border text-xs font-medium transition-colors',
                      settings.algorithm === 'fsrs'
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                        : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    FSRS-5
                  </button>
                </div>
              </div>

              {settings.algorithm === 'sm2' && (
                <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day">
                      {numInput('newCardsPerDay', settings.newCardsPerDay)}
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards per day">
                      {numInput('maxReviewsPerDay', settings.maxReviewsPerDay)}
                    </SettingRow>
                    <SettingRow label="Starting ease factor" description="Initial ease multiplier for new cards (default: 2.5)">
                      {numInput('startingEase', settings.startingEase)}
                    </SettingRow>
                    <SettingRow label="Easy bonus" description="Added to ease factor when you rate Easy (default: 0.15)">
                      {numInput('easyBonus', settings.easyBonus)}
                    </SettingRow>
                    <SettingRow label="Hard interval multiplier" description="Interval multiplier when you rate Hard (default: 1.2)">
                      {numInput('hardInterval', settings.hardInterval)}
                    </SettingRow>
                    <SettingRow label="Graduating interval (days)" description="Interval after second Good rating (default: 4)">
                      {numInput('graduatingInterval', settings.graduatingInterval)}
                    </SettingRow>
                    <SettingRow label="Lapse interval (%)" description="New interval as % of previous after forgetting (default: 10%)">
                      {numInput('lapseInterval', settings.lapseInterval)}
                    </SettingRow>
                    <SettingRow label="Leech threshold (lapses)" description="Flag a card as a leech after this many lapses">
                      {numInput('leechThreshold', settings.leechThreshold)}
                    </SettingRow>
                  </div>

                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={resetSettings}>Reset to SM-2 defaults</Button>
                  </div>
                </>
              )}

              {settings.algorithm === 'fsrs' && (
                <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day">
                      {numInput('newCardsPerDay', settings.newCardsPerDay)}
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards per day">
                      {numInput('maxReviewsPerDay', settings.maxReviewsPerDay)}
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
                      {numInput('fsrsMaxInterval', settings.fsrsMaxInterval)}
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
                    <div className="grid grid-cols-4 gap-1.5">
                      {settings.fsrsWeights.map((w, i) => (
                        <div key={i} className="flex flex-col gap-0.5">
                          <label className="text-[10px] text-[var(--text-muted)]">w{i}</label>
                          <Input
                            type="number"
                            className="text-right text-xs h-7 px-1.5"
                            value={w}
                            onChange={(e) => {
                              const next = [...settings.fsrsWeights]
                              next[i] = parseFloat(e.target.value) || 0
                              updateSettings({ fsrsWeights: next })
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        updateSettings({
                          fsrsWeights: [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.3547, 0.1049, 1.0, 1.9898, 0.11, 0.29, 2.2700, 0.1790, 2.9898],
                          fsrsTargetRetention: 0.9,
                          fsrsMaxInterval: 36500,
                        })
                      }
                    >
                      Reset to FSRS-5 defaults
                    </Button>
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
                {/* Burnout warning - cards */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-primary)]">Warn when daily queue exceeds</p>
                    <Toggle
                      checked={settings.burnoutWarningEnabled}
                      onChange={(v) => updateSettings({ burnoutWarningEnabled: v })}
                    />
                  </div>
                  {settings.burnoutWarningEnabled && (
                    <div className="flex items-center gap-2 pl-1">
                      <Input
                        type="number"
                        className="w-24 text-right"
                        value={settings.burnoutThresholdCards}
                        onChange={(e) => updateSettings({ burnoutThresholdCards: parseInt(e.target.value) || 0 })}
                      />
                      <span className="text-xs text-[var(--text-muted)]">cards</span>
                    </div>
                  )}
                </div>

                {/* Burnout warning - minutes */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-primary)]">Warn when projected study time exceeds</p>
                    <Toggle
                      checked={settings.burnoutWarningEnabled}
                      onChange={(v) => updateSettings({ burnoutWarningEnabled: v })}
                    />
                  </div>
                  {settings.burnoutWarningEnabled && (
                    <div className="flex items-center gap-2 pl-1">
                      <Input
                        type="number"
                        className="w-24 text-right"
                        value={settings.burnoutThresholdMinutes}
                        onChange={(e) => updateSettings({ burnoutThresholdMinutes: parseInt(e.target.value) || 0 })}
                      />
                      <span className="text-xs text-[var(--text-muted)]">minutes</span>
                    </div>
                  )}
                </div>

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
                    { key: 'forgot',     label: 'Forgot',    description: 'Rate card as forgotten' },
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

              <div className="space-y-3">
                <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Export All Data</p>
                      <p className="text-xs text-[var(--text-muted)]">Download all your cards, notes, and stats as JSON</p>
                    </div>
                    <Button variant="outline" size="sm" icon={<Download size={13} />} onClick={handleExportJSON}>
                      Export
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Export as CSV</p>
                      <p className="text-xs text-[var(--text-muted)]">Download cards as a spreadsheet-compatible CSV</p>
                    </div>
                    <Button variant="outline" size="sm" icon={<Download size={13} />} onClick={handleExportCSV}>
                      Export CSV
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Import CSV</p>
                      <p className="text-xs text-[var(--text-muted)]">Import cards from a CSV file (front, back columns)</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Upload size={13} />}
                      onClick={() => csvInputRef.current?.click()}
                    >
                      Import CSV
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">Import Backup</p>
                      <p className="text-xs text-[var(--text-muted)]">Restore from a Nemo JSON backup file</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      icon={<Upload size={13} />}
                      onClick={() => jsonInputRef.current?.click()}
                    >
                      Import Backup
                    </Button>
                  </div>
                </div>

                <div className="bg-[var(--danger-subtle)] border border-[var(--danger)] border-opacity-30 rounded-[var(--radius)] p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--danger)]">Delete All Data</p>
                      <p className="text-xs text-[var(--text-muted)]">Permanently delete all cards, notes, and stats</p>
                    </div>
                    <Button variant="danger" size="sm" icon={<Trash2 size={13} />}>Delete</Button>
                  </div>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </>
  )
}
