'use client'

import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { useLibraryStore } from '@/store/useLibraryStore'
import { FolderTreePicker } from '@/components/library/FolderTreePicker'
import type { Folder } from '@/lib/types'

/**
 * `rootId` plus every folder beneath it. These are the one set of invalid move
 * targets: a folder cannot be moved into itself or into its own descendant,
 * which would detach the whole subtree from the tree.
 */
function subtreeIds(folders: Folder[], rootId: string): Set<string> {
  const out = new Set([rootId])
  // Parents can appear after children in the array, so sweep until stable.
  let grew = true
  while (grew) {
    grew = false
    for (const f of folders) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id)
        grew = true
      }
    }
  }
  return out
}

/**
 * Move a folder to another folder, or to the library root.
 *
 * This is the folder counterpart of the deck "Move to folder" dialog in
 * LibraryBrowser — same `FolderTreePicker`, same "Library root" option, which
 * is what makes moving to root possible (picking no folder sets parentId to
 * null, exactly as it sets a deck's folderId to null).
 */
export function MoveFolderDialog({
  folder,
  onClose,
}: {
  folder: Folder | null
  onClose: () => void
}) {
  const { folders, updateFolder } = useLibraryStore(
    useShallow((s) => ({ folders: s.folders, updateFolder: s.updateFolder }))
  )
  const [target, setTarget] = useState<string | null>(null)

  // Start on the folder's current parent each time the dialog opens, so the
  // picker reflects where the folder actually lives right now.
  useEffect(() => {
    if (folder) setTarget(folder.parentId ?? null)
  }, [folder])

  if (!folder) return null

  const invalid = subtreeIds(folders, folder.id)
  const options = folders.filter((f) => !invalid.has(f.id))

  return (
    <Dialog open onClose={onClose} title={`Move "${folder.name}"`} size="sm">
      <div className="p-4 space-y-3">
        <FolderTreePicker
          folders={options}
          value={target}
          onChange={setTarget}
          noFolderLabel="Library root"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              updateFolder(folder.id, { parentId: target })
              onClose()
            }}
          >
            Move
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
