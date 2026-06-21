'use client'

import { useState } from 'react'
import { ChevronRight, Folder as FolderIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Folder } from '@/lib/types'

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
        {/* Expand/collapse indicator — purely visual; the whole row below
            handles both selecting and toggling */}
        <span className="flex items-center justify-center w-4 h-6 shrink-0 text-current">
          {hasChildren && (
            <ChevronRight
              size={11}
              className={cn('transition-transform duration-150', isOpen && 'rotate-90')}
            />
          )}
        </span>

        {/* Folder name — selects this folder and expands/collapses its children */}
        <button
          type="button"
          onClick={() => {
            onSelect(node.folder.id)
            if (hasChildren) onToggle(node.folder.id)
          }}
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

interface FolderTreePickerProps {
  folders: Folder[]
  value: string | null
  onChange: (id: string | null) => void
  noFolderLabel?: string
}

/**
 * Shared folder-location tree picker — used by the import flow and by every
 * New Folder / New Deck creation flow so placement is chosen explicitly
 * rather than silently defaulting to root.
 */
export function FolderTreePicker({ folders, value, onChange, noFolderLabel = 'No folder' }: FolderTreePickerProps) {
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
        {noFolderLabel}
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
