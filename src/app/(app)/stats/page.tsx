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
        title="Stats & Analytics"
        actions={
          <Button variant="ghost" size="sm" icon={<Download size={13} />} onClick={handleExport}>
            Export
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto p-5">
        <StatsPage />
      </main>
    </div>
  )
}
