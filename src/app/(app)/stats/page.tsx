'use client'

import { Header } from '@/components/layout/Header'
import { StatsPage } from '@/components/stats/StatsPage'
import { Button } from '@/components/ui/Button'
import { Download } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useLibraryStore } from '@/store/useLibraryStore'
import { useHistoryStore } from '@/store/useHistoryStore'
import { exportAsJSON } from '@/lib/export'

export default function StatsRoute() {
  const { folders, decks, cards, fsrsData } = useLibraryStore(
    useShallow((s) => ({ folders: s.folders, decks: s.decks, cards: s.cards, fsrsData: s.fsrsData }))
  )
  const sessions = useHistoryStore((s) => s.sessions)

  function handleExport() {
    exportAsJSON({ folders, decks, cards, fsrsData, sessions })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        actions={
          <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={handleExport}>
            Export
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto px-6 py-6">
        <StatsPage />
      </main>
    </div>
  )
}
