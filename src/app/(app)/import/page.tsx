'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Upload, X, FileText } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import { cn, truncate } from '@/lib/utils'
import {
  detectFormat,
  parseDelimited,
  parseMarkdownCards,
  parseAnkiExport,
  importFromCSV,
  importFromJSON,
} from '@/lib/import'

// ── Types ────────────────────────────────────────────────────────────────────

type DelimiterOption = 'tab' | 'comma' | 'semicolon' | 'pipe' | 'doublecolon' | 'custom'

interface ParsedCard {
  front: string
  back: string
  tags?: string[]
}

const DELIMITER_MAP: Record<Exclude<DelimiterOption, 'custom'>, string> = {
  tab: '\t',
  comma: ',',
  semicolon: ';',
  pipe: '|',
  doublecolon: '::',
}

const DELIMITER_LABELS: Record<DelimiterOption, string> = {
  tab: 'Tab (default)',
  comma: 'Comma',
  semicolon: 'Semicolon',
  pipe: 'Pipe ( | )',
  doublecolon: 'Double colon ( :: )',
  custom: 'Custom',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseFile(
  filename: string,
  text: string,
  delimiterOption: DelimiterOption,
  customDelimiter: string,
  skipFirstRow: boolean
): { cards: ParsedCard[]; error: string | null } {
  const format = detectFormat(filename, text)

  try {
    let cards: ParsedCard[] = []

    if (format === 'anki') {
      cards = parseAnkiExport(text)
    } else if (format === 'markdown') {
      cards = parseMarkdownCards(text)
    } else if (format === 'json') {
      // Try Nemo backup JSON first; fall back to simple [{front,back}] array
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
    } else if (format === 'csv') {
      // Use our new parseDelimited with the selected delimiter
      const delimiter =
        delimiterOption === 'custom'
          ? customDelimiter || ','
          : DELIMITER_MAP[delimiterOption]
      const rawLines = text.split(/\r?\n/)
      const dataText = skipFirstRow ? rawLines.slice(1).join('\n') : text
      cards = parseDelimited(dataText, delimiter)
      // Fallback to the original CSV parser if nothing found
      if (cards.length === 0 && format === 'csv') {
        const csvCards = importFromCSV(text)
        cards = csvCards
      }
    } else if (format === 'tsv') {
      const rawLines = text.split(/\r?\n/)
      const dataText = skipFirstRow ? rawLines.slice(1).join('\n') : text
      cards = parseDelimited(dataText, '\t')
    } else {
      // unknown — try tab then comma
      const rawLines = text.split(/\r?\n/)
      const dataText = skipFirstRow ? rawLines.slice(1).join('\n') : text
      const delimiter =
        delimiterOption === 'custom'
          ? customDelimiter || '\t'
          : DELIMITER_MAP[delimiterOption]
      cards = parseDelimited(dataText, delimiter)
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

export default function ImportPage() {
  const router = useRouter()
  const { folders, createDeck, createCard } = useLibraryStore()
  const { addToast } = useAppStore()

  // File state
  const [fileName, setFileName] = useState('')
  const [fileText, setFileText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Settings
  const [delimiterOption, setDelimiterOption] = useState<DelimiterOption>('tab')
  const [customDelimiter, setCustomDelimiter] = useState('')
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
        // Auto-set deck name from filename (strip extension)
        const baseName = name.replace(/\.[^.]+$/, '')
        setDeckName(baseName)

        const { cards, error } = parseFile(
          name,
          text,
          delimiterOption,
          customDelimiter,
          skipFirstRow
        )
        setParsedCards(cards.length > 0 ? cards : null)
        setParseError(error)
      }
      reader.readAsText(file)
    },
    [delimiterOption, customDelimiter, skipFirstRow]
  )

  // Re-parse when settings change (if we already have a file loaded)
  const reParse = useCallback(
    (
      newDelimiter: DelimiterOption,
      newCustom: string,
      newSkip: boolean
    ) => {
      if (!fileName || !fileText) return
      const { cards, error } = parseFile(
        fileName,
        fileText,
        newDelimiter,
        newCustom,
        newSkip
      )
      setParsedCards(cards.length > 0 ? cards : null)
      setParseError(error)
    },
    [fileName, fileText]
  )

  // ── Drag-and-drop ──────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset the input so the same file can be re-selected
    e.target.value = ''
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!parsedCards || parsedCards.length === 0) return
    setImporting(true)
    try {
      const name = deckName.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported Deck'
      const deck = createDeck(name, folderId)
      for (const card of parsedCards) {
        createCard(deck.id, card.front, card.back)
      }
      addToast({
        type: 'success',
        message: `Imported ${parsedCards.length} card${parsedCards.length !== 1 ? 's' : ''} into "${name}"`,
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
    setDeckName('')
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
              Import Cards
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

                {/* Delimiter selector */}
                {showDelimiterSettings && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--text-secondary)]">Delimiter</label>
                    <div className="space-y-1">
                      {(Object.keys(DELIMITER_LABELS) as DelimiterOption[]).map((opt) => (
                        <label
                          key={opt}
                          className="flex items-center gap-2 cursor-pointer group"
                        >
                          <input
                            type="radio"
                            name="delimiter"
                            value={opt}
                            checked={delimiterOption === opt}
                            onChange={() => {
                              setDelimiterOption(opt)
                              reParse(opt, customDelimiter, skipFirstRow)
                            }}
                            className="accent-[var(--accent)]"
                          />
                          <span className="text-xs text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
                            {DELIMITER_LABELS[opt]}
                          </span>
                        </label>
                      ))}
                    </div>
                    {delimiterOption === 'custom' && (
                      <input
                        type="text"
                        placeholder="Enter delimiter…"
                        value={customDelimiter}
                        maxLength={4}
                        onChange={(e) => {
                          setCustomDelimiter(e.target.value)
                          reParse(delimiterOption, e.target.value, skipFirstRow)
                        }}
                        className="mt-1 w-full h-7 px-2.5 text-xs bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                      />
                    )}
                  </div>
                )}

                {/* Skip first row */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipFirstRow}
                    onChange={(e) => {
                      setSkipFirstRow(e.target.checked)
                      reParse(delimiterOption, customDelimiter, e.target.checked)
                    }}
                    className="accent-[var(--accent)]"
                  />
                  <span className="text-xs text-[var(--text-secondary)]">First row is header</span>
                </label>

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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                  >
                    Clear
                  </Button>
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
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide w-1/2">
                            Front
                          </th>
                          <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide w-1/2">
                            Back
                          </th>
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
