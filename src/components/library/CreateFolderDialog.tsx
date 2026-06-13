'use client'

import { useState, useEffect } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useLibraryStore } from '@/store/useLibraryStore'
import { cn } from '@/lib/utils'
import type { FolderColor } from '@/lib/types'

const COLORS: { value: FolderColor; label: string; bg: string; ring: string }[] = [
  { value: 'default', label: 'Default', bg: 'bg-[var(--bg-active)]', ring: 'ring-[var(--border-strong)]' },
  { value: 'red',     label: 'Red',     bg: 'bg-red-400',      ring: 'ring-red-400' },
  { value: 'orange',  label: 'Orange',  bg: 'bg-orange-400',   ring: 'ring-orange-400' },
  { value: 'yellow',  label: 'Yellow',  bg: 'bg-yellow-400',   ring: 'ring-yellow-400' },
  { value: 'green',   label: 'Green',   bg: 'bg-emerald-400',  ring: 'ring-emerald-400' },
  { value: 'blue',    label: 'Blue',    bg: 'bg-sky-400',      ring: 'ring-sky-400' },
  { value: 'purple',  label: 'Purple',  bg: 'bg-purple-400',   ring: 'ring-purple-400' },
  { value: 'pink',    label: 'Pink',    bg: 'bg-pink-400',     ring: 'ring-pink-400' },
]

interface CreateFolderDialogProps {
  open: boolean
  onClose: () => void
  defaultParentId?: string | null
}

export function CreateFolderDialog({ open, onClose, defaultParentId }: CreateFolderDialogProps) {
  const { folders, createFolder } = useLibraryStore()
  const [name, setName] = useState('')
  const [color, setColor] = useState<FolderColor>('default')
  const [parentId, setParentId] = useState<string>(defaultParentId ?? '')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) setParentId(defaultParentId ?? '')
  }, [open, defaultParentId])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Folder name is required')
      return
    }
    createFolder(trimmed, parentId || null, color)
    setName('')
    setColor('default')
    setParentId(defaultParentId ?? '')
    setError('')
    onClose()
  }

  const handleClose = () => {
    setName('')
    setColor('default')
    setParentId(defaultParentId ?? '')
    setError('')
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="New Folder"
      description="Create a folder to organise your decks."
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
            placeholder="e.g. A-Level Sciences"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (error) setError('')
            }}
            error={error}
          />
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Color
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={c.label}
                onClick={() => setColor(c.value)}
                className={cn(
                  'w-6 h-6 rounded-full transition-all',
                  c.bg,
                  color === c.value && `ring-2 ring-offset-2 ring-offset-[var(--bg-surface)] ${c.ring}`
                )}
              />
            ))}
          </div>
        </div>

        {/* Parent folder */}
        {folders.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Parent folder <span className="text-[var(--text-muted)]">(optional)</span>
            </label>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              className={cn(
                'w-full h-8 bg-[var(--bg-hover)] border border-[var(--border)] rounded-[var(--radius-sm)]',
                'text-[var(--text-primary)] text-sm px-3',
                'hover:border-[var(--border-strong)]',
                'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]'
              )}
            >
              <option value="">None (top level)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm">
            Create Folder
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
