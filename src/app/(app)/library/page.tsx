'use client'

import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { LibraryBrowser } from '@/components/library/LibraryBrowser'
import { CreateFolderDialog } from '@/components/library/CreateFolderDialog'
import { CreateDeckDialog } from '@/components/library/CreateDeckDialog'
import { Button } from '@/components/ui/Button'
import Link from 'next/link'
import { Plus, FolderPlus, Upload } from 'lucide-react'

export default function LibraryPage() {
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [deckDialogOpen, setDeckDialogOpen] = useState(false)
  const [deckDefaultFolderId, setDeckDefaultFolderId] = useState<string | null>(null)
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null)

  const openDeckDialog = (folderId?: string | null) => {
    setDeckDefaultFolderId(folderId ?? null)
    setDeckDialogOpen(true)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header
        title="Library"
        actions={
          <>
            <Link href="/import">
              <Button
                variant="ghost"
                size="sm"
                icon={<Upload size={13} />}
              >
                Import
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="sm"
              icon={<FolderPlus size={13} />}
              onClick={() => setFolderDialogOpen(true)}
            >
              New Folder
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={13} />}
              onClick={() => openDeckDialog(currentFolderId)}
            >
              New Deck
            </Button>
          </>
        }
      />
      <main className="flex-1 overflow-y-auto">
        <LibraryBrowser
          onNewFolder={() => setFolderDialogOpen(true)}
          onNewDeck={openDeckDialog}
          onFolderChange={setCurrentFolderId}
        />
      </main>

      <CreateFolderDialog
        open={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        defaultParentId={currentFolderId}
      />
      <CreateDeckDialog
        open={deckDialogOpen}
        onClose={() => setDeckDialogOpen(false)}
        defaultFolderId={deckDefaultFolderId}
      />
    </div>
  )
}
