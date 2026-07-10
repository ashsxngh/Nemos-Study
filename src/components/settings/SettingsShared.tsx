'use client'

import { useRef, useState } from 'react'
import { Sun, Moon, Monitor, Download, Upload, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Dialog } from '@/components/ui/Dialog'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { useAppStore } from '@/store/useAppStore'
import { useSettingsStore } from '@/store/useSettingsStore'
import { exportAsJSON, exportDecksAsCSV } from '@/lib/export'
import { importFromCSV } from '@/lib/import'
import { restoreBackup } from '@/lib/restoreBackup'
import { deleteAllData } from '@/lib/deleteAllData'
import { cn } from '@/lib/utils'
import type { Theme } from '@/lib/types'

// Shared building blocks for SettingsPage (full page) and SettingsPanel
// (slide-over) — both render largely the same controls over the same store,
// just in different shells. Anything that was byte-identical in both files
// lives here now so a fix only needs to happen once.

// ── Static data ───────────────────────────────────────────────────────────────

export const THEMES: { value: Theme; label: string; icon: React.ElementType }[] = [
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'system', label: 'System', icon: Monitor },
]

export const FSRS5_DEFAULT_WEIGHTS = [
  0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0589, 1.3547, 0.1049,
  1.0, 1.9898, 0.11, 0.29, 2.2700, 0.1790, 2.9898,
]

// ── Toggle ────────────────────────────────────────────────────────────────────

interface ToggleProps {
  checked: boolean
  onChange: (v: boolean) => void
}

export function Toggle({ checked, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-11 h-6 rounded-full relative transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40',
        checked ? 'bg-[var(--accent)]' : 'bg-[var(--bg-active)]'
      )}
    >
      <div
        className={cn(
          'absolute top-1 w-4 h-4 rounded-full transition-all duration-150',
          checked ? 'translate-x-6 bg-[var(--accent-fg)]' : 'translate-x-1 bg-[var(--text-secondary)]'
        )}
      />
    </button>
  )
}

// ── SettingRow ────────────────────────────────────────────────────────────────

interface SettingRowProps {
  label: string
  description?: string
  children: React.ReactNode
}

export function SettingRow({ label, description, children }: SettingRowProps) {
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

// ── NumberField ───────────────────────────────────────────────────────────────
// Replaces the old per-file `numInput(key, value, bounds)` closures — both
// were identical except for reaching into `updateSettings` via a generic key
// trick. Taking value/onChange directly is simpler and equally reusable.

interface NumberFieldProps {
  value: number
  onChange: (v: number) => void
  bounds?: { min: number; max: number }
  className?: string
}

export function NumberField({ value, onChange, bounds, className }: NumberFieldProps) {
  return (
    <Input
      type="number"
      min={bounds?.min}
      max={bounds?.max}
      className={cn('w-24 text-right', className)}
      value={value}
      onChange={(e) => {
        let v = parseFloat(e.target.value) || 0
        if (bounds) v = Math.min(bounds.max, Math.max(bounds.min, v))
        onChange(v)
      }}
    />
  )
}

// ── FSRS weights grid + reset ─────────────────────────────────────────────────

export function FSRSWeightsGrid() {
  const { fsrsWeights, updateSettings } = useSettingsStore(
    useShallow((s) => ({ fsrsWeights: s.fsrsWeights, updateSettings: s.updateSettings }))
  )
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {fsrsWeights.map((w, i) => (
        <div key={i} className="flex flex-col gap-0.5">
          <label className="font-mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">w[{i}]</label>
          <Input
            type="number"
            className="font-mono text-right text-xs h-7 px-1.5"
            value={w}
            onChange={(e) => {
              const next = [...fsrsWeights]
              next[i] = parseFloat(e.target.value) || 0
              updateSettings({ fsrsWeights: next })
            }}
          />
        </div>
      ))}
    </div>
  )
}

export function ResetFSRSDefaultsButton() {
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        updateSettings({
          fsrsWeights: FSRS5_DEFAULT_WEIGHTS,
          fsrsTargetRetention: 0.9,
          fsrsMaxInterval: 36500,
        })
      }
    >
      Reset to FSRS-5 defaults
    </Button>
  )
}

// ── Burnout threshold toggles ────────────────────────────────────────────────
// The exact two rows that used to both write `burnoutWarningEnabled` (see
// CLAUDE.md session log) — kept in one place now so that bug can't reappear.

export function BurnoutThresholdToggles() {
  const { burnoutWarningEnabled, burnoutThresholdCards, burnoutTimeWarningEnabled, burnoutThresholdMinutes, updateSettings } =
    useSettingsStore(
      useShallow((s) => ({
        burnoutWarningEnabled: s.burnoutWarningEnabled,
        burnoutThresholdCards: s.burnoutThresholdCards,
        burnoutTimeWarningEnabled: s.burnoutTimeWarningEnabled,
        burnoutThresholdMinutes: s.burnoutThresholdMinutes,
        updateSettings: s.updateSettings,
      }))
    )
  return (
    <>
      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-primary)]">Warn when daily queue exceeds</p>
          <Toggle
            checked={burnoutWarningEnabled}
            onChange={(v) => updateSettings({ burnoutWarningEnabled: v })}
          />
        </div>
        {burnoutWarningEnabled && (
          <div className="flex items-center gap-2 pl-1">
            <NumberField
              value={burnoutThresholdCards}
              onChange={(v) => updateSettings({ burnoutThresholdCards: v })}
            />
            <span className="text-xs text-[var(--text-muted)]">cards</span>
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[var(--text-primary)]">Warn when projected study time exceeds</p>
          <Toggle
            checked={burnoutTimeWarningEnabled}
            onChange={(v) => updateSettings({ burnoutTimeWarningEnabled: v })}
          />
        </div>
        {burnoutTimeWarningEnabled && (
          <div className="flex items-center gap-2 pl-1">
            <NumberField
              value={burnoutThresholdMinutes}
              onChange={(v) => updateSettings({ burnoutThresholdMinutes: v })}
            />
            <span className="text-xs text-[var(--text-muted)]">minutes</span>
          </div>
        )}
      </div>
    </>
  )
}

// ── Import CSV dialog ─────────────────────────────────────────────────────────

interface ImportCSVDialogProps {
  cards: { front: string; back: string }[]
  decks: { id: string; name: string }[]
  onConfirm: (deckId: string) => void
  onCancel: () => void
}

function ImportCSVDialog({ cards, decks, onConfirm, onCancel }: ImportCSVDialogProps) {
  const [selectedDeck, setSelectedDeck] = useState(decks[0]?.id ?? '')

  return (
    <Dialog open onClose={onCancel} title={`Import ${cards.length} cards`} size="sm">
      <div className="p-4 space-y-4">
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
    </Dialog>
  )
}

// ── Data & Backup section ────────────────────────────────────────────────────
// Fully self-contained: owns its own file inputs, CSV/backup import state,
// and the delete-all-data confirm — both SettingsPage and SettingsPanel just
// drop this in under their own section header.

export function DataBackupSection() {
  const { decks, cards, folders, fsrsData, createCard } = useLibraryStore(
    useShallow((s) => ({
      decks: s.decks,
      cards: s.cards,
      folders: s.folders,
      fsrsData: s.fsrsData,
      createCard: s.createCard,
    }))
  )
  const sessions = useHistoryStore((s) => s.sessions)
  const addToast = useAppStore((s) => s.addToast)

  const csvInputRef = useRef<HTMLInputElement>(null)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  const [csvCards, setCsvCards] = useState<{ front: string; back: string }[] | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleExportJSON = () => {
    exportAsJSON({ folders, decks, cards, fsrsData, sessions })
  }

  const handleExportCSV = () => {
    exportDecksAsCSV(decks, cards)
  }

  const handleDeleteAllData = async () => {
    setDeleting(true)
    try {
      await deleteAllData()
      setShowDeleteConfirm(false)
      addToast({ type: 'success', message: 'All data deleted.' })
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete data. Please try again.',
      })
    } finally {
      setDeleting(false)
    }
  }

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

  const handleJSONFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const backup = restoreBackup(event.target?.result as string)
        addToast({ type: 'success', message: `Backup restored — ${backup.cards.length} cards imported` })
      } catch {
        addToast({ type: 'error', message: 'Failed to parse backup file. Is it a valid Nemo JSON?' })
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
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

      {csvCards && (
        <ImportCSVDialog
          cards={csvCards}
          decks={decks}
          onConfirm={handleCSVImportConfirm}
          onCancel={() => setCsvCards(null)}
        />
      )}

      <Dialog open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} title="Delete all data?" size="sm">
        <div className="p-4 space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            This permanently deletes all folders, decks, cards, notes, exams, and review history from
            this device and the cloud. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={handleDeleteAllData}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
        </div>
      </Dialog>

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

        <div className="bg-[var(--danger-subtle)] border border-[var(--danger)]/30 rounded-[var(--radius)] p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--danger)]">Delete All Data</p>
              <p className="text-xs text-[var(--text-muted)]">Permanently delete all cards, notes, and stats</p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={() => setShowDeleteConfirm(true)}
            >
              Delete
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
