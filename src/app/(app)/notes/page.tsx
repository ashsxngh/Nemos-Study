'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { NotesLayout } from '@/components/notes/NotesLayout'
import { Button } from '@/components/ui/Button'
import { Plus } from 'lucide-react'
import { useNotesStore } from '@/store/useNotesStore'

export default function NotesPage() {
  const createNote = useNotesStore((s) => s.createNote)
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null)

  const handleNewNote = () => {
    const note = createNote()
    setPendingNoteId(note.id)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Notes"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={13} />}
            onClick={handleNewNote}
          >
            New Note
          </Button>
        }
      />
      <main className="flex-1 overflow-hidden">
        <NotesLayout initialNoteId={pendingNoteId} />
      </main>
    </div>
  )
}
