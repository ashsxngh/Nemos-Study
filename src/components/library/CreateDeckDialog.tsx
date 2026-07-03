'use client'

import { useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useShallow } from 'zustand/react/shallow'
import { useLibraryStore } from '@/store/useLibraryStore'
import { FolderTreePicker } from '@/components/library/FolderTreePicker'
import { cn } from '@/lib/utils'
import { NAME_MAX_LENGTH } from '@/lib/limits'

interface CreateDeckDialogProps {
  open: boolean
  onClose: () => void
  defaultFolderId?: string | null
}

export function CreateDeckDialog({ open, onClose, defaultFolderId }: CreateDeckDialogProps) {
  const { folders, createDeck } = useLibraryStore(
    useShallow((s) => ({ folders: s.folders, createDeck: s.createDeck }))
  )
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId ?? null)
  const [nameError, setNameError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setNameError('Deck name is required')
      return
    }
    createDeck(trimmed, folderId, description.trim())
    setName('')
    setDescription('')
    setFolderId(defaultFolderId ?? null)
    setNameError('')
    onClose()
  }

  const handleClose = () => {
    setName('')
    setDescription('')
    setFolderId(defaultFolderId ?? null)
    setNameError('')
    onClose()
  }

  const currentFolderName = folders.find((f) => f.id === defaultFolderId)?.name

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="New Deck"
      description={
        currentFolderName
          ? `Creating a deck inside "${currentFolderName}".`
          : 'Create a new flashcard deck.'
      }
      size="sm"
    >
      <form onSubmit={handleSubmit} className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Name
          </label>
          <Input
            autoFocus
            placeholder="e.g. Cell Biology"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError('')
            }}
            error={nameError}
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Description <span className="text-[var(--text-muted)]">(optional)</span>
          </label>
          <textarea
            rows={3}
            placeholder="What is this deck about?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={cn(
              'w-full bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)]',
              'text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]',
              'px-3 py-2 resize-none transition-colors duration-100',
              'hover:border-[var(--border-strong)]',
              'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]'
            )}
          />
        </div>

        {/* Folder */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Location
          </label>
          <FolderTreePicker
            folders={folders}
            value={folderId}
            onChange={setFolderId}
            noFolderLabel="No folder (top level)"
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm">
            Create Deck
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
