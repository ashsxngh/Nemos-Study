'use client'

import { Suspense, useCallback, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Upload, X, FileText, Folder as FolderIcon, ChevronRight } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useAppStore } from '@/store/useAppStore'
import { cn, truncate } from '@/lib/utils'
import type { CardType, Folder, Deck } from '@/lib/types'
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

// ── Folder/Deck tree helpers ──────────────────────────────────────────────────

interface FolderNode {
  folder: Folder
  depth: number
  children: FolderNode[]
}

function buildFolderTree(folders: Folder[]): FolderNode[] {
  const nodeMap = new Map<string, FolderNode>()
  for (const f of folders) {
    nodeMap.set(f.id, { folder: f, depth: 0, children: [] })
  }
  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodeMap.get(f.id)!
    if (f.parentId && nodeMap.has(f.parentId)) {
      nodeMap.get(f.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  function setDepth(node: FolderNode, d: number) {
    node.depth = d
    for (const c of node.children) setDepth(c, d + 1)
  }
  roots.forEach((n) => setDepth(n, 0))
  return roots
}

function flattenFolderTree(nodes: FolderNode[]): FolderNode[] {
  const out: FolderNode[] = []
  function walk(ns: FolderNode[]) {
    for (const n of ns) { out.push(n); walk(n.children) }
  }
  walk(nodes)
  return out
}

// ── FolderTreePicker ──────────────────────────────────────────────────────────

function FolderTreeRow({
  node,
  value,
  expanded,
  onSelect,
  onToggle,
}: {
  node: FolderNode
  value: string | null
  expanded: Set<string>
  onSelect: (id: string | null) => void
  onToggle: (id: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.folder.id)
  const isSelected = value === node.folder.id

  return (
    <>
      <div
        style={{ paddingLeft: `${10 + node.depth * 14}px` }}
        className={cn(
          'flex items-center pr-1.5 transition-colors',
          isSelected
            ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        )}
      >
        {/* Expand/collapse toggle — only shown when folder has children */}
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.folder.id)}
          className={cn(
            'flex items-center justify-center w-4 h-6 shrink-0 transition-colors',
            hasChildren ? 'hover:text-[var(--text-primary)] cursor-pointer' : 'cursor-default opacity-0 pointer-events-none'
          )}
          tabIndex={hasChildren ? 0 : -1}
        >
          <ChevronRight
            size={11}
            className={cn('transition-transform duration-150', isOpen && 'rotate-90')}
          />
        </button>

        {/* Folder name — selectable */}
        <button
          type="button"
          onClick={() => onSelect(node.folder.id)}
          className={cn(
            'flex items-center gap-1.5 flex-1 min-w-0 py-1.5 text-left',
            isSelected ? 'font-medium' : ''
          )}
        >
          <FolderIcon size={11} className="shrink-0 opacity-60" />
          <span className="truncate">{node.folder.name}</span>
        </button>
      </div>

      {/* Children — only rendered when expanded */}
      {isOpen && node.children.map((child) => (
        <FolderTreeRow
          key={child.folder.id}
          node={child}
          value={value}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  )
}

function FolderTreePicker({
  folders,
  value,
  onChange,
}: {
  folders: Folder[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const roots = buildFolderTree(folders.filter((f) => !f.isArchived))

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="max-h-[176px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] text-xs">
      {/* No folder option */}
      <button
        type="button"
        onClick={() => onChange(null)}
        className={cn(
          'w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 transition-colors',
          value === null
            ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
        )}
      >
        <span className="w-4 shrink-0" />
        No folder
      </button>

      {roots.map((node) => (
        <FolderTreeRow
          key={node.folder.id}
          node={node}
          value={value}
          expanded={expanded}
          onSelect={onChange}
          onToggle={toggle}
        />
      ))}
    </div>
  )
}

// ── DeckTreePicker ────────────────────────────────────────────────────────────

function DeckTreePicker({
  decks,
  folders,
  value,
  onChange,
}: {
  decks: Deck[]
  folders: Folder[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const activeDecks = decks.filter((d) => !d.isArchived)
  const flat = flattenFolderTree(buildFolderTree(folders.filter((f) => !f.isArchived)))
  const unfoldered = activeDecks.filter((d) => !d.folderId)

  return (
    <div className="max-h-[200px] overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border)] text-xs">
      {activeDecks.length === 0 && (
        <div className="px-2.5 py-3 text-[var(--text-muted)] text-center">No decks yet</div>
      )}

      {/* Decks with no folder */}
      {unfoldered.map((deck) => (
        <button
          key={deck.id}
          type="button"
          onClick={() => onChange(deck.id)}
          className={cn(
            'w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 transition-colors',
            value === deck.id
              ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
              : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
          )}
        >
          {deck.name}
        </button>
      ))}

      {/* Folders as section headers with nested decks */}
      {flat.map((node) => {
        const folderDecks = activeDecks.filter((d) => d.folderId === node.folder.id)
        if (folderDecks.length === 0) return null
        return (
          <div key={node.folder.id}>
            <div
              style={{ paddingLeft: `${10 + node.depth * 12}px` }}
              className="flex items-center gap-1 pr-2.5 py-1 text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide select-none"
            >
              <FolderIcon size={9} className="shrink-0" />
              {node.folder.name}
            </div>
            {folderDecks.map((deck) => (
              <button
                key={deck.id}
                type="button"
                onClick={() => onChange(deck.id)}
                style={{ paddingLeft: `${20 + node.depth * 12}px` }}
                className={cn(
                  'w-full text-left flex items-center pr-2.5 py-1.5 transition-colors',
                  value === deck.id
                    ? 'bg-[var(--accent)]/10 text-[var(--accent)] font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {deck.name}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
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
  const [delimiterRaw, setDelimiterRaw] = useState(',')
  const [skipFirstRow, setSkipFirstRow] = useState(false)
  const [deckName, setDeckName] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [importMode, setImportMode] = useState<'new' | 'existing'>('new')
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null)

  // Parsed result
  const [parsedCards, setParsedCards] = useState<ParsedCard[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  // Import state
  const [importing, setImporting] = useState(false)

  const detectedFormat = fileName ? detectFormat(fileName, fileText) : null
  const isAnkiPkg = detectedFormat === 'apkg'
  const showDelimiterSettings =
    !isAnkiPkg &&
    (detectedFormat === 'csv' ||
      detectedFormat === 'tsv' ||
      detectedFormat === 'unknown' ||
      detectedFormat === null)

  // ── File processing ────────────────────────────────────────────────────────

  const processFile = useCallback(
    async (file: File) => {
      const name = file.name
      setFileName(name)
      setFileText('')
      const baseName = name.replace(/\.[^.]+$/, '')
      if (!targetDeckId) setDeckName(baseName)

      if (name.toLowerCase().endsWith('.apkg')) {
        try {
          const buf = await file.arrayBuffer()
          const { parseAnkiPackage } = await import('@/lib/ankiPackage')
          const cards = await parseAnkiPackage(buf)
          setParsedCards(cards.length > 0 ? cards : null)
          setParseError(cards.length === 0 ? 'No cards found in this Anki package.' : null)
        } catch (err) {
          setParsedCards(null)
          setParseError(err instanceof Error ? err.message : 'Failed to parse Anki package.')
        }
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        const text = (e.target?.result as string) ?? ''
        setFileText(text)
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
      } else if (importMode === 'existing' && selectedDeckId) {
        finalDeckId = selectedDeckId
      } else {
        const name = deckName.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported Deck'
        const deck = createDeck(name, folderId)
        finalDeckId = deck.id
      }

      for (const card of parsedCards) {
        const type = detectCardType(card.front, card.back)
        createCard(finalDeckId, card.front, card.back, type)
      }

      const existingName = importMode === 'existing' && selectedDeckId
        ? decks.find((d) => d.id === selectedDeckId)?.name
        : null
      const label = targetDeck
        ? `"${targetDeck.name}"`
        : existingName
        ? `"${existingName}"`
        : `"${deckName.trim() || fileName.replace(/\.[^.]+$/, '') || 'Imported Deck'}"`
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
                          {detectedFormat === 'apkg' ? 'Anki Package' : detectedFormat} detected
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
                        CSV, TSV, TXT, MD, JSON, Anki (.anki, .apkg)
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
                accept=".csv,.tsv,.txt,.md,.json,.anki,.apkg"
                className="hidden"
                onChange={handleFileInputChange}
              />
            </div>

            {/* Right: Import settings */}
            <div className="w-full lg:w-72 shrink-0">
              <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-lg)] p-4 space-y-4">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">Import Settings</h2>

                {/* Delimiter input (text formats only) */}
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
                      Use <code className="font-mono">\t</code> for tab
                    </p>
                  </div>
                )}

                {/* Skip first row (text formats only) */}
                {!isAnkiPkg && (
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
                )}

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
                    {/* Import mode toggle */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--text-secondary)]">Import into</label>
                      <div className="flex gap-1 p-0.5 bg-[var(--bg-hover)] rounded-[var(--radius-sm)]">
                        <button
                          onClick={() => setImportMode('new')}
                          className={cn(
                            'flex-1 text-[10px] py-1 rounded-sm font-medium transition-colors',
                            importMode === 'new'
                              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                          )}
                        >
                          New Deck
                        </button>
                        <button
                          onClick={() => setImportMode('existing')}
                          className={cn(
                            'flex-1 text-[10px] py-1 rounded-sm font-medium transition-colors',
                            importMode === 'existing'
                              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm'
                              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                          )}
                        >
                          Existing Deck
                        </button>
                      </div>
                    </div>

                    {importMode === 'existing' ? (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--text-secondary)]">Select deck</label>
                        <DeckTreePicker
                          decks={decks}
                          folders={folders}
                          value={selectedDeckId}
                          onChange={setSelectedDeckId}
                        />
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

                        {/* Target folder — tree picker */}
                        <div className="space-y-1.5">
                          <label className="text-xs font-medium text-[var(--text-secondary)]">Target folder</label>
                          <FolderTreePicker
                            folders={folders}
                            value={folderId}
                            onChange={setFolderId}
                          />
                        </div>
                      </>
                    )}
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
                    disabled={
                      !parsedCards || parsedCards.length === 0 || importing ||
                      (!targetDeckId && importMode === 'existing' && !selectedDeckId)
                    }
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
