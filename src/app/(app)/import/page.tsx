'use client'

import { Suspense, useCallback, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Upload, X, FileText } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import { cn, truncate } from '@/lib/utils'
import type { CardType } from '@/lib/types'
import {
  detectFormat,
  parseDelimited,
  parseMarkdownCards,
  parseAnkiExport,
  importFromCSV,
  importFromJSON,
} from '@/lib/import'

// ── Types ────────────────────────────────────────────────────────────────────

interface ParsedCard {
  front: string
  back: string
  tags?: string[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveDelimiter(raw: string): string {
  if (!raw || raw === '\\t') return '\t'
  if (raw === '\\n') return '\n'
  return raw
}

function detectCardType(front: string, back: string): CardType {
  if (/\{\{c\d+::/.test(front)) return 'cloze'
  if (/^(https?:\/\/|data:image)/.test(back.trim())) return 'image'
  return 'basic'
}

function parseFile(
  filename: string,
  text: string,
  delimiterRaw: string,
  skipFirstRow: boolean
): { cards: ParsedCard[]; error: string | null } {
  const format = detectFormat(filename, text)
  const delimiter = resolveDelimiter(delimiterRaw)

  try {
    let cards: ParsedCard[] = []

    if (format === 'anki') {
      cards = parseAnkiExport(text)
    } else if (format === 'markdown') {
      cards = parseMarkdownCards(text)
    } else if (format === 'json') {
      try {
        const backup = importFromJSON(text)
        if (backup.cards.length > 0) {
          cards = backup.cards.map((c) => ({ front: c.front, back: c.back }))
        } else {
          const raw = JSON.parse(text)
          if (Array.isArray(raw)) {
            cards = raw
              .filter((r): r is { front: string; back: string } =>
                typeof r?.front === 'string' && typeof r?.back === 'string'
              )
              .map((r) => ({ front: r.front, back: r.back }))
          }
        }
      } catch {
        const raw = JSON.parse(text)
        if (Array.isArray(raw)) {
          cards = raw.filter(
            (r): r is { front: string; back: string } =>
              typeof r?.front === 'string' && typeof r?.back === 'string'
          )
        }
      }
    } else {
      const rawLines = text.split(/\r?\n/)
      const dataText = skipFirstRow ? rawLines.slice(1).join('\n') : text
      cards = parseDelimited(dataText, delimiter)
      if (cards.length === 0) {
        const csvCards = importFromCSV(text)
        cards = csvCards
      }
    }

    if (cards.length === 0) {
      return { cards: [], error: 'No cards found in this file.' }
    }

    return { cards, error: null }
  } catch (err) {
    return {
      cards: [],
      error: err instanceof Error ? err.message : 'Failed to parse file.',
    }
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

function ImportContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const targetDeckId = searchParams.get('deckId')

  const { decks, folders, createDeck, createCard } = useLibraryStore()
  const { addToast } = useAppStore()

  const targetDeck = targetDeckId ? decks.find((d) => d.id === targetDeckId) : null

  // File state
  const [fileName, setFileName] = useState('')
  const [fileText, setFileText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Settings
  const [delimiterRaw, setDelimiterRaw] = useState('\\t')
  const [skipFirstRow, setSkipFirstRow] = useState(false)
  const [deckName, setDeckName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)

  // Parsed result
  const [parsedCards, setParsedCards] = useState<ParsedCard[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // Import state
  const [importing, setImporting] = useState(false)

  const detectedFormat = fileName ? detectFormat(fileName, fileText) : null
  const showDelimiterSettings =
    detectedFormat === 'csv' ||
    detectedFormat === 'tsv' ||
    detectedFormat === 'unknown' ||
    detectedFormat === null

  // ── File processing ────────────────────────────────────────────────────────

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = (e.target?.result as string) ?? ''
        const name = file.name
        setFileName(name)
        setFileText(text)
        const baseName = name.replace(/\.[^.]+$/, '')
        if (!targetDeckId) setDeckName(baseName)

        const { cards, error } = parseFile(name, text, delimiterRaw, skipFirstRow)
        setParsedCards(cards.length > 0 ? cards : null)
        setParseError(error)
      }
      reader.readAsText(file)
    },
    [delimiterRaw, skipFirstRow, targetDeckId]
  )

  const reParse = useCallback(
    (newDelim: string, newSkip: boolean) => {
      if (!fileName || !fileText) return
      const { cards, error } = parseFile(fileName, fileText, newDelim, newSkip)
      setParsedCards(cards.length > 0 ? cards : null)
      setParseError(error)
    },
    [fileName, fileText]
  )

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false) }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsedCards || parsedCards.length === 0) return
    setImporting(true)
    try {
      let finalDeckId: string

      if (targetDeckId) {
        finalDeckId = targetDeckId
      } else {
        const name = deckName.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported Deck'
        const deck = createDeck(name, folderId)
        finalDeckId = deck.id
      }

      for (const card of parsedCards) {
        const type = detectCardType(card.front, card.back)
        createCard(finalDeckId, card.front, card.back, type)
      }

      const label = targetDeck ? `"${targetDeck.name}"` : `"${deckName.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported Deck'}"`
      addToast({
        type: 'success',
        message: `Imported ${parsedCards.length} card${parsedCards.length !== 1 ? 's' : ''} into ${label}`,
      })
      router.push('/library')
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Import failed.',
      })
    } finally {
      setImporting(false)
    }
  }

  const handleClear = () => {
    setFileName('')
    setFileText('')
    setParsedCards(null)
    setParseError(null)
    if (!targetDeckId) setDeckName('')
    setFolderId(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const previewCards = parsedCards?.slice(0, 10) ?? []
  const extraCount = (parsedCards?.length ?? 0) - previewCards.length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Import Cards"
        breadcrumbs={
          <div className="flex items-center gap-2 min-w-0">
            <Link
              href="/library"
              className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ArrowLeft size={13} />
              Library
            </Link>
            <span className="text-[var(--text-muted)]">/</span>
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {targetDeck ? `Import into "${targetDeck.name}"` : 'Import Cards'}
            </span>
          </div>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Top row: Drop zone + Settings */}
          <div className="flex flex-col lg:flex-row gap-5">

            {/* Left: Drop zone */}
            <div className="flex-1 min-w-0">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={cn(
                  'relative flex flex-col items-center justify-center gap-3 min-h-[220px] rounded-[var(--radius-lg)] border-2 border-dashed transition-colors cursor-pointer',
                  isDragOver
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : fileName
                    ? 'border-[var(--accent)]/40 bg-[var(--bg-surface)]'
                    : 'border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
                )}
                onClick={() => !fileName && fileInputRef.current?.click()}
              >
                {fileName ? (
                  <>
                    <FileText size={28} className="text-[var(--accent)]" />
                    <div className="text-center px-4">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate max-w-xs">
                        {fileName}
                      </p>
                      {detectedFormat && detectedFormat !== 'unknown' && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 uppercase tracking-wide">
                          {detectedFormat} detected
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={<X size={12} />}
                      onClick={(e) => { e.stopPropagation(); handleClear() }}
                      className="absolute top-2 right-2"
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  <>
                    <div className={cn(
                      'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
                      isDragOver ? 'bg-[var(--accent)]/10' : 'bg-[var(--bg-hover)]'
                    )}>
                      <Upload size={22} className={isDragOver ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'} />
                    </div>
                    <div className="text-center px-4">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {isDragOver ? 'Drop to import' : 'Drop files here'}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        Supported: CSV, TSV, TXT, MD, JSON
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click() }}
                    >
                      Browse files
                    </Button>
                  </>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple={false}
                accept=".csv,.tsv,.txt,.md,.json,.anki"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {/* Right: Import settings */}
            <div className="w-full lg:w-72 shrink-0">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import Settings</h2>

                {/* Delimiter input */}
                {showDelimiterSettings && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">
                      Delimiter
                    </label>
                    <input
                      type="text"
                      placeholder="\t (tab), , (comma), | (pipe)…"
                      value={delimiterRaw}
                      onChange={(e) => {
                        setDelimiterRaw(e.target.value)
                        reParse(e.target.value, skipFirstRow)
                      }}
                      className="w-full h-8 px-2.5 text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] font-mono"
                    />
                    <p className="text-[10px] text-[var(--text-muted)]">
                      Use <code className="font-mono">\t</code> for tab (default)
                    </p>
                  </div>
                )}

                {/* Skip first row */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipFirstRow}
                    onChange={(e) => {
                      setSkipFirstRow(e.target.checked)
                      reParse(delimiterRaw, e.target.checked)
                    }}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)]">First row is header</span>
                </label>

                {/* Target deck */}
                {targetDeck ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">Importing into</label>
                    <div className="text-xs text-[var(--text-primary)] bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2.5 py-1.5 font-medium">
                      {targetDeck.name}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Deck name */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Deck name</label>
                      <input
                        type="text"
                        placeholder="Enter deck name…"
                        value={deckName}
                        onChange={(e) => setDeckName(e.target.value)}
                        className="w-full h-7 px-2.5 text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>

                    {/* Target folder */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Target folder</label>
                      <select
                        value={folderId ?? ''}
                        onChange={(e) => setFolderId(e.target.value || null)}
                        className="w-full h-7 px-2 text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      >
                        <option value="">No folder</option>
                        {folders.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Preview + Confirm */}
          {(parsedCards !== null || parseError !== null) && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] overflow-hidden">
              {/* Preview header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">Preview</h2>
                  {parsedCards && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)]">
                      Found {parsedCards.length} card{parsedCards.length !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={handleClear}>Clear</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={importing}
                    disabled={!parsedCards || parsedCards.length === 0 || importing}
                    onClick={handleImport}
                  >
                    Import {parsedCards ? `${parsedCards.length} cards` : 'cards'}
                  </Button>
                </div>
              </div>

              {/* Error */}
              {parseError && (
                <div className="px-4 py-3 text-sm text-[var(--danger)] bg-[var(--danger-subtle)]">
                  {parseError}
                </div>
              )}

              {/* Table */}
              {parsedCards && parsedCards.length > 0 && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--border)] bg-[var(--bg-hover)]">
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide w-1/2">Front</th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide w-1/2">Back</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewCards.map((card, i) => (
                          <tr
                            key={i}
                            className={cn(
                              'border-b border-[var(--border)] last:border-0',
                              i % 2 === 0 ? '' : 'bg-[var(--bg-hover)]/40'
                            )}
                          >
                            <td className="px-4 py-2.5 text-[var(--text-primary)] align-top">
                              {truncate(card.front, 60)}
                            </td>
                            <td className="px-4 py-2.5 text-[var(--text-secondary)] align-top">
                              {truncate(card.back, 60)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {extraCount > 0 && (
                    <div className="px-4 py-2.5 text-xs text-[var(--text-muted)] border-t border-[var(--border)] bg-[var(--bg-hover)]/30">
                      … and {extraCount} more card{extraCount !== 1 ? 's' : ''}
                    </div>
                  )}
                </>
              )}

              {parsedCards && parsedCards.length === 0 && !parseError && (
                <div className="px-4 py-6 text-sm text-center text-[var(--text-muted)]">
                  No cards found. Try adjusting the delimiter or format settings.
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

export default function ImportPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full text-[var(--text-muted)] text-sm">Loading…</div>}>
      <ImportContent />
    </Suspense>
  )
}
