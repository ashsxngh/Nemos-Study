'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { FileText, Search, X, Hash, Eye, Edit2 } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { useShallow } from 'zustand/react/shallow'
import { cn, formatRelativeTime } from '@/lib/utils'
import { useNotesStore } from '@/store/useNotesStore'
import { useAppStore } from '@/store/useAppStore'
import { NOTE_CONTENT_MAX_LENGTH, NAME_MAX_LENGTH } from '@/lib/limits'

interface NotesLayoutProps {
  onCreateNote?: () => void
  initialNoteId?: string | null
}

export function NotesLayout({ initialNoteId }: NotesLayoutProps) {
  const { notes, updateNote, deleteNote } = useNotesStore(
    useShallow((s) => ({ notes: s.notes, updateNote: s.updateNote, deleteNote: s.deleteNote }))
  )

  const [activeNoteId, setActiveNoteId] = useState<string | null>(initialNoteId ?? null)
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [isPreview, setIsPreview] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-open last note on mount
  useEffect(() => {
    if (initialNoteId) return // already set via prop
    const lastId = useAppStore.getState().lastOpenNoteId
    if (lastId && notes.some((n) => n.id === lastId)) {
      setActiveNoteId(lastId)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync active note fields when selection changes
  useEffect(() => {
    const note = notes.find((n) => n.id === activeNoteId)
    if (note) {
      setTitle(note.title)
      setContent(note.content)
      setTags(note.tags)
    } else {
      setTitle('')
      setContent('')
      setTags([])
    }
    setIsPreview(false)
    setTagInput('')
  }, [activeNoteId]) // intentionally omit notes to avoid loop

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }, [content])

  // Immediate save (for unmount / navigation away)
  const saveNow = useCallback(() => {
    if (!activeNoteId) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    updateNote(activeNoteId, { title, content, tags })
  }, [activeNoteId, title, content, tags, updateNote])

  // Save on unmount
  useEffect(() => () => { saveNow() }, [saveNow])

  // Save on page navigation / tab close
  useEffect(() => {
    window.addEventListener('beforeunload', saveNow)
    return () => window.removeEventListener('beforeunload', saveNow)
  }, [saveNow])

  // Debounced auto-save
  const scheduleAutoSave = useCallback(
    (newTitle: string, newContent: string, newTags: string[]) => {
      if (!activeNoteId) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        updateNote(activeNoteId, { title: newTitle, content: newContent, tags: newTags })
      }, 500)
    },
    [activeNoteId, updateNote]
  )

  const handleTitleChange = (val: string) => {
    setTitle(val)
    scheduleAutoSave(val, content, tags)
  }

  const handleContentChange = (val: string) => {
    setContent(val)
    scheduleAutoSave(title, val, tags)
  }

  const handleAddTag = (raw: string) => {
    const trimmed = raw.trim().replace(/,+$/, '').trim()
    if (!trimmed || tags.includes(trimmed)) {
      setTagInput('')
      return
    }
    const next = [...tags, trimmed]
    setTags(next)
    setTagInput('')
    scheduleAutoSave(title, content, next)
  }

  const handleRemoveTag = (tag: string) => {
    const next = tags.filter((t) => t !== tag)
    setTags(next)
    scheduleAutoSave(title, content, next)
  }

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      handleAddTag(tagInput)
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      handleRemoveTag(tags[tags.length - 1])
    }
  }

  const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length

  const filteredNotes = notes
    .filter((n) => {
      if (!search) return true
      const q = search.toLowerCase()
      return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null

  return (
    <div className="flex h-full">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-[var(--border)] flex flex-col bg-[var(--bg-surface)]">
        <div className="p-2.5 border-b border-[var(--border)]">
          <Input
            placeholder="Search notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            icon={<Search size={12} />}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-1.5">
              <FileText size={20} className="text-[var(--text-muted)]" />
              <p className="text-[10px] text-[var(--text-muted)]">
                {search ? 'No results' : 'No notes yet'}
              </p>
            </div>
          ) : (
            filteredNotes.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                isActive={note.id === activeNoteId}
                onClick={() => {
                  setActiveNoteId(note.id)
                  useAppStore.getState().setLastOpenNote(note.id)
                }}
                onDelete={() => {
                  deleteNote(note.id)
                  if (activeNoteId === note.id) {
                    setActiveNoteId(null)
                    useAppStore.getState().setLastOpenNote(null)
                  }
                }}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Editor pane ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeNote ? (
          <>
            {/* Title */}
            <div className="px-8 pt-7 pb-0 shrink-0">
              <input
                type="text"
                value={title}
                maxLength={NAME_MAX_LENGTH}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="Untitled"
                className={cn(
                  'w-full text-2xl font-bold bg-transparent border-none outline-none',
                  'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]'
                )}
              />
            </div>

            {/* Tags bar */}
            <div className="px-8 pt-3 pb-0 flex flex-wrap items-center gap-1.5 shrink-0">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 text-[10px] text-[var(--text-muted)] bg-[var(--bg-hover)] border border-[var(--border)] px-1.5 py-0.5 rounded-full"
                >
                  <Hash size={9} />
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-[var(--danger)] transition-colors ml-0.5"
                    aria-label={`Remove tag ${tag}`}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => {
                  // auto-commit on comma typed mid-word
                  if (e.target.value.endsWith(',')) {
                    handleAddTag(e.target.value)
                  } else {
                    setTagInput(e.target.value)
                  }
                }}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput) handleAddTag(tagInput) }}
                placeholder="Add tag…"
                className="text-[10px] bg-transparent border-none outline-none text-[var(--text-muted)] placeholder:text-[var(--text-muted)] w-20 min-w-0"
              />
            </div>

            {/* Toolbar */}
            <div className="px-8 pt-3 pb-2 flex items-center justify-between shrink-0 border-b border-[var(--border)]">
              <span className="text-[10px] text-[var(--text-muted)]">
                {formatRelativeTime(activeNote.updatedAt)}
              </span>
              <button
                onClick={() => setIsPreview((v) => !v)}
                className={cn(
                  'inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors',
                  isPreview
                    ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                {isPreview ? <Edit2 size={10} /> : <Eye size={10} />}
                {isPreview ? 'Edit' : 'Preview'}
              </button>
            </div>

            {/* Editor / Preview */}
            <div className="flex-1 overflow-y-auto px-8 py-5 relative">
              {isPreview ? (
                <div className="prose prose-sm max-w-none text-[var(--text-primary)] [&_h1]:text-[var(--text-primary)] [&_h2]:text-[var(--text-primary)] [&_h3]:text-[var(--text-primary)] [&_p]:text-[var(--text-secondary)] [&_li]:text-[var(--text-secondary)] [&_code]:bg-[var(--bg-hover)] [&_code]:text-[var(--accent)] [&_pre]:bg-[var(--bg-hover)] [&_blockquote]:border-l-[var(--accent)] [&_a]:text-[var(--accent)]">
                  {content ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[[rehypeKatex, { strict: false }]]}
                    >
                      {content}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-[var(--text-muted)] italic">Nothing to preview.</p>
                  )}
                </div>
              ) : (
                <textarea
                  ref={textareaRef}
                  value={content}
                  maxLength={NOTE_CONTENT_MAX_LENGTH}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Start writing… (Markdown supported)"
                  className={cn(
                    'w-full resize-none bg-transparent border-none outline-none',
                    'text-sm text-[var(--text-secondary)] placeholder:text-[var(--text-muted)]',
                    'font-mono leading-7 min-h-64'
                  )}
                  style={{ height: 'auto' }}
                />
              )}

              {/* Word count */}
              <div className="absolute bottom-3 right-5 text-[9px] text-[var(--text-muted)] select-none pointer-events-none">
                {wordCount} {wordCount === 1 ? 'word' : 'words'}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={32} className="text-[var(--text-muted)] mx-auto mb-2" />
              <p className="text-sm text-[var(--text-secondary)]">Select a note or create a new one</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── NoteItem ────────────────────────────────────────────────────────────────

interface NoteItemProps {
  note: { id: string; title: string; content: string; updatedAt: string }
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

function NoteItem({ note, isActive, onClick, onDelete }: NoteItemProps) {
  const [hovered, setHovered] = useState(false)

  const preview = note.content.replace(/[#*`>\-_~[\]()!]/g, '').slice(0, 60)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onContextMenu={(e) => { e.preventDefault(); onDelete() }}
      className={cn(
        'relative w-full text-left px-3 py-2.5 border-b border-[var(--border)] transition-colors cursor-pointer select-none',
        isActive ? 'bg-[var(--bg-active)]' : 'hover:bg-[var(--bg-hover)]'
      )}
    >
      <div className="flex items-center gap-1.5 mb-1 pr-5">
        <FileText size={12} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-xs font-medium text-[var(--text-primary)] truncate">
          {note.title || 'Untitled'}
        </span>
      </div>
      {preview && (
        <p className="text-[10px] text-[var(--text-muted)] truncate mb-1">{preview}</p>
      )}
      <span className="text-[9px] text-[var(--text-muted)]">
        {formatRelativeTime(note.updatedAt)}
      </span>

      {/* Delete button (hover) */}
      {hovered && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-2 right-2 p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-subtle)] transition-colors"
          aria-label="Delete note"
        >
          <X size={11} />
        </button>
      )}
    </div>
  )
}
