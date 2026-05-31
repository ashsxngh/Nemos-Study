'use client'

import { useState, useRef } from 'react'
import { Sun, Moon, Monitor, Brain, Bell, Keyboard, Database, Download, Upload, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAppStore } from '@/store/useAppStore'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { exportAsJSON, exportDecksAsCSV } from '@/lib/export'
import { importFromCSV, importFromJSON } from '@/lib/import'
import { cn } from '@/lib/utils'
import type { Theme } from '@/lib/types'

const sections = [
  { id: 'appearance', label: 'Appearance', icon: Sun },
  { id: 'srs', label: 'SRS Algorithm', icon: Brain },
  { id: 'burnout', label: 'Burnout & Workload', icon: AlertTriangle },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'data', label: 'Data & Backup', icon: Database },
]

const themes: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
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

// ── Toggle component ──────────────────────────────────────────────────────────

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

// ── Import CSV Dialog ─────────────────────────────────────────────────────────

interface ImportCSVDialogProps {
  cards: { front: string; back: string }[]
  decks: { id: string; name: string }[]
  onConfirm: (deckId: string) => void
  onCancel: () => void
}

function ImportCSVDialog({ cards, decks, onConfirm, onCancel }: ImportCSVDialogProps) {
  const [selectedDeck, setSelectedDeck] = useState(decks[0]?.id ?? '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
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

// ── Shared section row helpers ────────────────────────────────────────────────

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

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('appearance')
  const { theme, setTheme, addToast } = useAppStore()
  const { folders, decks, cards, srsData, sessions, createCard } = useLibraryStore()
  const settings = useSettingsStore()
  const { updateSettings, resetSettings } = settings

  // CSV import state
  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [csvCards, setCsvCards] = useState<{ front: string; back: string }[] | null>(null)

  // ── Export handlers ────────────────────────────────────────────────────────
  const handleExportJSON = () => {
    exportAsJSON({ folders, decks, cards, srsData, sessions })
  }

  const handleExportCSV = () => {
    exportDecksAsCSV(decks, cards)
  }

  // ── Import CSV handlers ────────────────────────────────────────────────────
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

  // ── Import JSON (backup) handler ───────────────────────────────────────────
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

  // ── Number input helper ────────────────────────────────────────────────────
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

  return (
    <div className="max-w-3xl mx-auto">
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

      {/* CSV Import Dialog */}
      {csvCards && (
        <ImportCSVDialog
          cards={csvCards}
          decks={decks}
          onConfirm={handleCSVImportConfirm}
          onCancel={() => setCsvCards(null)}
        />
      )}

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
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Appearance</h2>
              <div className="space-y-5">
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
              </div>
            </section>
          )}

          {/* ── SRS Algorithm ── */}
          {activeSection === 'srs' && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">SRS Algorithm</h2>

              {/* Algorithm picker */}
              <div className="mb-4">
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
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day — new cards that have never been reviewed">
                      {numInput('newCardsPerDay', settings.newCardsPerDay)}
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards (previously seen cards due for repetition) per day">
                      {numInput('maxReviewsPerDay', settings.maxReviewsPerDay)}
                    </SettingRow>
                    <SettingRow label="Starting ease factor" description="Initial ease multiplier assigned to new cards (SM-2 default: 2.5)">
                      {numInput('startingEase', settings.startingEase)}
                    </SettingRow>
                    <SettingRow label="Easy bonus" description="Added to ease factor when you rate a card Easy — higher means larger future intervals (default: 0.15)">
                      {numInput('easyBonus', settings.easyBonus)}
                    </SettingRow>
                    <SettingRow label="Hard interval multiplier" description="Interval is multiplied by this when you rate Hard — keeps the card close but not immediate (default: 1.2)">
                      {numInput('hardInterval', settings.hardInterval)}
                    </SettingRow>
                    <SettingRow label="Graduating interval (days)" description="Interval after the second Good rating — how many days before the card is reviewed again (default: 4)">
                      {numInput('graduatingInterval', settings.graduatingInterval)}
                    </SettingRow>
                    <SettingRow label="Lapse interval (%)" description="After forgetting a card, the new interval is this % of the previous interval (default: 10%)">
                      {numInput('lapseInterval', settings.lapseInterval)}
                    </SettingRow>
                    <SettingRow label="Leech threshold (lapses)" description="Flag a card as a leech after this many lapses so you can rewrite or suspend it">
                      {numInput('leechThreshold', settings.leechThreshold)}
                    </SettingRow>
                    <SettingRow label="Show answer timer" description="Display response time while reviewing">
                      <Toggle checked={settings.showAnswerTimer} onChange={(v) => updateSettings({ showAnswerTimer: v })} />
                    </SettingRow>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <Button variant="ghost" size="sm" onClick={resetSettings}>Reset to SM-2 defaults</Button>
                  </div>
                </>
              )}

              {settings.algorithm === 'fsrs' && (
                <>
                  <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] divide-y divide-[var(--border)]">
                    <SettingRow label="New cards per day" description="Maximum new cards introduced per day — new cards that have never been reviewed">
                      {numInput('newCardsPerDay', settings.newCardsPerDay)}
                    </SettingRow>
                    <SettingRow label="Max reviews per day" description="Cap on review cards (previously seen cards due for repetition) per day">
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

                  <div className="mt-3 flex justify-end">
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
          )}

          {/* ── Burnout & Workload ── */}
          {activeSection === 'burnout' && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Burnout &amp; Workload</h2>
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

                {/* Leech threshold */}
                <div className="px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-[var(--text-primary)]">Flag leeches after</p>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="w-20 text-right"
                        value={settings.leechThreshold}
                        onChange={(e) => updateSettings({ leechThreshold: parseInt(e.target.value) || 1 })}
                      />
                      <span className="text-xs text-[var(--text-muted)]">lapses</span>
                    </div>
                  </div>
                </div>

                {/* Auto-advance */}
                <SettingRow label="Auto-advance after rating" description="Automatically move to the next card after rating">
                  <Toggle checked={settings.autoAdvance} onChange={(v) => updateSettings({ autoAdvance: v })} />
                </SettingRow>

                {/* Daily goals */}
                <SettingRow label="Daily card target" description="Cards to review per day goal">
                  {numInput('dailyCardTarget', settings.dailyCardTarget)}
                </SettingRow>
                <SettingRow label="Daily minute target" description="Study time goal per day (minutes)">
                  {numInput('dailyMinuteTarget', settings.dailyMinuteTarget)}
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
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Notifications</h2>
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

                <SettingRow label="Exam countdown alerts" description="Reminders as upcoming exams approach">
                  <Toggle checked={false} onChange={() => {}} />
                </SettingRow>

                <SettingRow label="Weekly progress report" description="Summary of your progress every week">
                  <Toggle checked={settings.weeklyReportEnabled} onChange={(v) => updateSettings({ weeklyReportEnabled: v })} />
                </SettingRow>

                <SettingRow label="Goal completion" description="Notify when daily goals are reached">
                  <Toggle checked={false} onChange={() => {}} />
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
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Keyboard Shortcuts</h2>
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
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Data & Backup</h2>
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
          )}
        </div>
      </div>
    </div>
  )
}
