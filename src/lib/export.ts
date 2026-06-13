import type { Folder, Deck, Card, SRSData, ReviewSession } from '@/lib/types'

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  setTimeout(() => {
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, 1000)
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

export function exportAsJSON(state: {
  folders: Folder[]
  decks: Deck[]
  cards: Card[]
  srsData: Record<string, SRSData>
  sessions: ReviewSession[]
}) {
  const json = JSON.stringify(state, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  triggerDownload(blob, `nemo-backup-${dateStamp()}.json`)
}

export function exportDecksAsCSV(decks: Deck[], cards: Card[]) {
  const deckMap = new Map(decks.map((d) => [d.id, d.name]))

  const escape = (value: string) => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`
    }
    return value
  }

  const rows: string[] = ['deck_name,front,back,type,tags']

  for (const card of cards) {
    const deckName = deckMap.get(card.deckId) ?? ''
    rows.push(
      [
        escape(deckName),
        escape(card.front),
        escape(card.back),
        escape(card.type),
        escape(card.tags.join(';')),
      ].join(',')
    )
  }

  const csv = rows.join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  triggerDownload(blob, `nemo-cards-${dateStamp()}.csv`)
}
