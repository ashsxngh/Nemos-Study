import type { Folder, Deck, Card, SRSData, CardType } from '@/lib/types'

/**
 * Parse a delimited row respecting RFC 4180 quoted fields.
 * Handles multi-character delimiters (e.g. '::').
 */
function parseDelimitedRow(row: string, delimiter: string): string[] {
  // For multi-character delimiters we do a simple split (no quoting ambiguity)
  if (delimiter.length > 1) {
    return row.split(delimiter).map((f) => f.trim())
  }

  const fields: string[] = []
  let current = ''
  let inQuotes = false
  let i = 0

  while (i < row.length) {
    const ch = row[i]

    if (inQuotes) {
      if (ch === '"') {
        if (row[i + 1] === '"') {
          current += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        current += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (row.startsWith(delimiter, i)) {
        fields.push(current)
        current = ''
        i += delimiter.length
      } else {
        current += ch
        i++
      }
    }
  }

  fields.push(current)
  return fields
}

/**
 * Parse a CSV row respecting RFC 4180 quoted fields (comma delimiter).
 */
function parseCSVRow(row: string): string[] {
  return parseDelimitedRow(row, ',')
}

const VALID_CARD_TYPES = new Set(['basic', 'cloze', 'typed', 'image'])

/**
 * Parse CSV text into card objects.
 * Supports both plain "front,back" format and the Nemo export format
 * (deck_name, front, back, type, tags).
 */
export function importFromCSV(
  csvText: string
): { front: string; back: string; type?: CardType; tags?: string[] }[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const firstRow = parseCSVRow(lines[0])
  const hasHeader =
    firstRow[0]?.toLowerCase() === 'front' ||
    firstRow[0]?.toLowerCase() === 'deck_name'

  const dataLines = hasHeader ? lines.slice(1) : lines
  const results: { front: string; back: string; type?: CardType; tags?: string[] }[] = []

  for (const line of dataLines) {
    const fields = parseCSVRow(line)
    if (fields.length < 2) continue

    // Nemo CSV format: deck_name, front, back, type, tags
    if (hasHeader && firstRow[0]?.toLowerCase() === 'deck_name') {
      const front = (fields[1] ?? '').trim()
      const back = (fields[2] ?? '').trim()
      const rawType = (fields[3] ?? '').trim()
      const rawTags = (fields[4] ?? '').trim()
      const type = VALID_CARD_TYPES.has(rawType) ? (rawType as CardType) : undefined
      const tags = rawTags ? rawTags.split(';').map((t) => t.trim()).filter(Boolean) : undefined
      if (front) results.push({ front, back, type, tags })
    } else {
      // Simple two-column format: front, back
      const front = (fields[0] ?? '').trim()
      const back = (fields[1] ?? '').trim()
      if (front) results.push({ front, back })
    }
  }

  return results
}

// ── New parsers ──────────────────────────────────────────────────────────────

/**
 * Parse text with an arbitrary delimiter into front/back pairs.
 * Supported delimiters: '\t', ',', ';', '|', '::'
 * Handles RFC 4180 quoted fields (single-char delimiters only).
 * Skips blank lines and comment lines starting with '#'.
 * Uses column 0 → front, column 1 → back; ignores extra columns.
 */
export function parseDelimited(
  text: string,
  delimiter: string
): { front: string; back: string }[] {
  const lines = text.split(/\r?\n/)
  const results: { front: string; back: string }[] = []

  for (const line of lines) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const fields = parseDelimitedRow(line, delimiter)
    if (fields.length < 2) continue
    const front = fields[0].trim()
    const back = fields[1].trim()
    if (front) results.push({ front, back })
  }

  return results
}

/**
 * Strip HTML tags from a string.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()
}

/**
 * Parse an Anki export (tab-separated with optional meta comment headers).
 * Supports #separator:, #html:, #tags: headers.
 * Returns { front, back, tags }[].
 */
export function parseAnkiExport(
  text: string
): { front: string; back: string; tags: string[] }[] {
  const lines = text.split(/\r?\n/)
  let separator = '\t'
  let htmlMode = false
  const globalTags: string[] = []
  const results: { front: string; back: string; tags: string[] }[] = []

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Parse meta headers
    if (line.startsWith('#separator:')) {
      const val = line.slice('#separator:'.length).trim().toLowerCase()
      if (val === 'tab' || val === '\\t') separator = '\t'
      else if (val === 'comma') separator = ','
      else if (val === 'semicolon') separator = ';'
      else if (val === 'pipe') separator = '|'
      else separator = val
      continue
    }
    if (line.startsWith('#html:')) {
      htmlMode = line.slice('#html:'.length).trim().toLowerCase() === 'true'
      continue
    }
    if (line.startsWith('#tags:')) {
      const tagStr = line.slice('#tags:'.length).trim()
      globalTags.push(...tagStr.split(/\s+/).filter(Boolean))
      continue
    }
    if (line.startsWith('#')) continue // other comment
    if (line.trim() === '') continue

    const fields = parseDelimitedRow(line, separator)
    if (fields.length < 2) continue

    let front = fields[0].trim()
    let back = fields[1].trim()
    if (htmlMode) {
      front = stripHtml(front)
      back = stripHtml(back)
    }
    if (!front) continue

    // Anki sometimes puts tags in column 3+ or as a dedicated tags field
    const lineTags = [...globalTags]
    if (fields.length >= 3 && fields[2].trim()) {
      lineTags.push(...fields[2].trim().split(/\s+/).filter(Boolean))
    }

    results.push({ front, back, tags: lineTags })
  }

  return results
}

/**
 * Parse markdown files into front/back card pairs.
 *
 * Format 1 — Separator format:
 *   Front text
 *   ---
 *   Back text
 *   ===
 *   Next front
 *   ---
 *   Next back
 *
 * Format 2 — Header format:
 *   ## Question heading
 *   Answer paragraph(s)
 *
 *   ## Next question
 *   Next answer
 */
export function parseMarkdownCards(
  text: string
): { front: string; back: string }[] {
  const trimmed = text.trim()

  // Detect separator format: text contains '===' card separators
  if (/^===$/m.test(trimmed)) {
    return parseSeparatorFormat(trimmed)
  }

  // Detect header format: file contains '## ' headings
  if (/^##\s+/m.test(trimmed)) {
    return parseHeaderFormat(trimmed)
  }

  // Single-card separator format without '===' (just one card with '---')
  if (/^---$/m.test(trimmed)) {
    return parseSeparatorFormat(trimmed)
  }

  return []
}

function parseSeparatorFormat(text: string): { front: string; back: string }[] {
  const results: { front: string; back: string }[] = []
  // Split on '===' to get individual cards
  const cardBlocks = text.split(/^===$/m)

  for (const block of cardBlocks) {
    const parts = block.split(/^---$/m)
    const front = parts[0]?.trim()
    const back = parts[1]?.trim()
    if (front && back) {
      results.push({ front, back })
    }
  }

  return results
}

function parseHeaderFormat(text: string): { front: string; back: string }[] {
  const results: { front: string; back: string }[] = []
  const lines = text.split(/\r?\n/)
  let currentFront: string | null = null
  let backLines: string[] = []

  const flush = () => {
    if (currentFront !== null) {
      const back = backLines.join('\n').trim()
      if (back) results.push({ front: currentFront, back })
    }
  }

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/)
    if (headerMatch) {
      flush()
      currentFront = headerMatch[1].trim()
      backLines = []
    } else if (currentFront !== null) {
      backLines.push(line)
    }
  }
  flush()

  return results
}

/**
 * Detect the import format based on filename and/or content.
 */
export function detectFormat(
  filename: string,
  text: string
): 'anki' | 'apkg' | 'csv' | 'tsv' | 'markdown' | 'json' | 'unknown' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''

  // Extension-based detection (highest priority)
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'json') return 'json'
  if (ext === 'csv') return 'csv'
  if (ext === 'tsv') return 'tsv'
  if (ext === 'anki') return 'anki'
  if (ext === 'apkg') return 'apkg'

  // Content sniffing for .txt and other extensions
  const firstLine = text.trimStart().split(/\r?\n/)[0] ?? ''

  if (firstLine.startsWith('#separator:')) return 'anki'

  const stripped = text.trimStart()
  if (stripped.startsWith('{') || stripped.startsWith('[')) return 'json'
  if (/^##?\s+/m.test(text)) return 'markdown'
  if (text.includes('\t')) return 'tsv'

  return 'csv'
}

export interface ImportedBackup {
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  srsData: Record<string, SRSData>
}

/**
 * Parse a Nemo backup JSON and return the structured data.
 */
export function importFromJSON(jsonText: string): ImportedBackup {
  const parsed = JSON.parse(jsonText) as Partial<ImportedBackup>
  return {
    folders: Array.isArray(parsed.folders) ? parsed.folders : [],
    decks: Array.isArray(parsed.decks) ? parsed.decks : [],
    cards: Array.isArray(parsed.cards)
      ? parsed.cards.map((c: Card) => ({ ...c, hint: c.hint ?? '', front: c.front ?? '', back: c.back ?? '' }))
      : [],
    srsData:
      parsed.srsData && typeof parsed.srsData === 'object'
        ? (parsed.srsData as Record<string, SRSData>)
        : {},
  }
}
