'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, ImagePlus, Eye, Edit2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useLibraryStore } from '@/store/useLibraryStore'
import { cn } from '@/lib/utils'
import { CARD_TEXT_MAX_LENGTH } from '@/lib/limits'
import type { Card, CardType } from '@/lib/types'
import { ReviewCard } from '@/components/study/ReviewCard'

const CARD_TYPES: { value: CardType; label: string; description: string }[] = [
  { value: 'basic',  label: 'Basic',         description: 'Front and back' },
  { value: 'cloze',  label: 'Cloze',         description: '{{c1::word}} fill-in-the-blank' },
  { value: 'typed',  label: 'Typed Answer',  description: 'Type the answer' },
  { value: 'image',  label: 'Image',         description: 'Question with image answer' },
]

interface CardEditorProps {
  deckId: string
  card?: Card // if provided, edit mode
  onDone?: () => void
}

export function CardEditor({ deckId, card, onDone }: CardEditorProps) {
  const createCard = useLibraryStore((s) => s.createCard)
  const updateCard = useLibraryStore((s) => s.updateCard)

  const [front, setFront] = useState(card?.front ?? '')
  const [back, setBack] = useState(card?.back ?? '')
  const [type, setType] = useState<CardType>(card?.type ?? 'basic')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>(card?.tags ?? [])
  const [errors, setErrors] = useState<{ front?: string; back?: string }>({})
  const [duplicateWarning, setDuplicateWarning] = useState(false)
  const [ignoreDuplicate, setIgnoreDuplicate] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(
    card?.type === 'image' && card?.back?.startsWith('data:image') ? card.back : null
  )
  const [showPreview, setShowPreview] = useState(false)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const frontRef = useRef<HTMLTextAreaElement>(null)
  const backRef = useRef<HTMLTextAreaElement>(null)

  // Sync when card prop changes (e.g. switching between cards)
  useEffect(() => {
    setFront(card?.front ?? '')
    setBack(card?.back ?? '')
    setType(card?.type ?? 'basic')
    setTags(card?.tags ?? [])
    setTagInput('')
    setErrors({})
    setDuplicateWarning(false)
    setIgnoreDuplicate(false)
    setImagePreview(
      card?.type === 'image' && card?.back?.startsWith('data:image') ? card.back : null
    )
    setShowPreview(false)
  }, [card?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (skipDuplicate = false) => {
    const e: { front?: string; back?: string } = {}
    if (!front.trim()) e.front = 'Front is required'
    if (type !== 'image' && !back.trim()) e.back = 'Back is required'
    if (type === 'image' && !back) e.back = 'Please upload an image'

    // Duplicate front check
    if (!skipDuplicate && front.trim()) {
      const { cards } = useLibraryStore.getState()
      const existing = cards.find(
        (c) =>
          c.deckId === deckId &&
          c.front.trim().toLowerCase() === front.trim().toLowerCase() &&
          c.id !== card?.id
      )
      if (existing) {
        setDuplicateWarning(true)
        setErrors(e)
        return Object.keys(e).length === 0 ? 'duplicate' : false
      }
    }

    setDuplicateWarning(false)
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const doSave = useCallback(() => {
    const result = validate(ignoreDuplicate)
    if (!result || result === 'duplicate') return
    if (card) {
      updateCard(card.id, { front: front.trim(), back, type, tags })
    } else {
      createCard(deckId, front.trim(), back, type, tags)
      setFront(''); setBack(''); setTags([]); setTagInput(''); setImagePreview(null)
    }
    onDone?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [front, back, type, tags, ignoreDuplicate, card, deckId])

  const applyFormat = useCallback((
    ref: React.RefObject<HTMLTextAreaElement | null>,
    value: string,
    setValue: (v: string) => void,
    before: string,
    after: string,
  ) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const newValue = value.slice(0, start) + before + selected + after + value.slice(end)
    setValue(newValue)
    requestAnimationFrame(() => {
      el.focus()
      if (selected) {
        el.setSelectionRange(start + before.length, start + before.length + selected.length)
      } else {
        el.setSelectionRange(start + before.length, start + before.length)
      }
    })
  }, [])

  const handleTextareaKeyDown = useCallback((
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    ref: React.RefObject<HTMLTextAreaElement | null>,
    value: string,
    setValue: (v: string) => void,
  ) => {
    const ctrl = e.ctrlKey || e.metaKey

    if (ctrl && e.key === 'Enter') {
      e.preventDefault()
      doSave()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      onDone?.()
      return
    }
    if (!ctrl) return

    if (e.key === 'b') { e.preventDefault(); applyFormat(ref, value, setValue, '**', '**'); return }
    if (e.key === 'i') { e.preventDefault(); applyFormat(ref, value, setValue, '*', '*'); return }
    if (e.key === 'h') { e.preventDefault(); applyFormat(ref, value, setValue, '==', '=='); return }
    if (e.key === 'o') { e.preventDefault(); setType('image'); imageInputRef.current?.click(); return }

    if (e.shiftKey) {
      if (e.key === 'X') { e.preventDefault(); applyFormat(ref, value, setValue, '~~', '~~'); return }
      if (e.key === 'F') { e.preventDefault(); applyFormat(ref, value, setValue, '```\n', '\n```'); return }
      if (e.key === 'M') { e.preventDefault(); applyFormat(ref, value, setValue, '$', '$'); return }
      if (e.key === 'L') { e.preventDefault(); applyFormat(ref, value, setValue, '{{c1::', '}}'); return }
    }
  }, [doSave, applyFormat, onDone])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const result = validate(ignoreDuplicate)
    if (!result || result === 'duplicate') return

    if (card) {
      updateCard(card.id, { front: front.trim(), back, type, tags })
    } else {
      createCard(deckId, front.trim(), back, type, tags)
      // Reset for next card
      setFront('')
      setBack('')
      setTags([])
      setTagInput('')
      setImagePreview(null)
    }
    onDone?.()
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Warn if image is large — base64 in localStorage has a ~5MB limit total
    if (file.size > 500_000) {
      setErrors((prev) => ({
        ...prev,
        back: `Image is ${(file.size / 1024).toFixed(0)} KB. Large images can fill storage quickly. Consider resizing to under 500 KB.`,
      }))
    }

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string
      setBack(dataUrl)
      setImagePreview(dataUrl)
    }
    reader.readAsDataURL(file)
  }

  const addTag = () => {
    const trimmed = tagInput.trim().toLowerCase()
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setTagInput('')
  }

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag))

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag()
    }
  }

  const isEdit = !!card

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Card type selector */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Card type
        </label>
        <div className="flex gap-2 flex-wrap">
          {CARD_TYPES.map((ct) => (
            <button
              key={ct.value}
              type="button"
              onClick={() => setType(ct.value)}
              className={cn(
                'flex-1 min-w-[100px] px-3 py-2 rounded-[var(--radius-sm)] border text-left transition-colors',
                type === ct.value
                  ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
              )}
            >
              <div className="text-xs font-medium">{ct.label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{ct.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Front */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Front <span className="text-[var(--text-muted)] font-normal">(markdown supported)</span>
        </label>
        <textarea
          ref={frontRef}
          rows={3}
          maxLength={CARD_TEXT_MAX_LENGTH}
          placeholder={type === 'cloze' ? 'The {{c1::mitochondria}} is the powerhouse of the cell.' : 'Question or prompt…'}
          value={front}
          onChange={(e) => {
            setFront(e.target.value)
            if (errors.front) setErrors((prev) => ({ ...prev, front: undefined }))
          }}
          onKeyDown={(e) => handleTextareaKeyDown(e, frontRef, front, setFront)}
          className={cn(
            'w-full bg-[var(--bg-hover)] border rounded-[var(--radius-sm)]',
            'text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]',
            'px-3 py-2 resize-none transition-colors duration-100',
            'hover:border-[var(--border-strong)]',
            'focus:outline-none focus:ring-1',
            errors.front
              ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]'
              : 'border-[var(--border)] focus:border-[var(--accent)] focus:ring-[var(--accent)]'
          )}
        />
        {errors.front && <p className="mt-1 text-xs text-[var(--danger)]">{errors.front}</p>}
        {duplicateWarning && !errors.front && (
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            <p className="text-xs text-[var(--danger)]">
              A card with this front already exists in this deck.
            </p>
            <button
              type="button"
              onClick={() => {
                setIgnoreDuplicate(true)
                setDuplicateWarning(false)
                // Save immediately, bypassing duplicate check
                if (card) {
                  updateCard(card.id, { front: front.trim(), back, type, tags })
                } else {
                  createCard(deckId, front.trim(), back, type, tags)
                  setFront('')
                  setBack('')
                  setTags([])
                  setTagInput('')
                  setImagePreview(null)
                }
                onDone?.()
              }}
              className="text-xs underline text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Save anyway
            </button>
          </div>
        )}
        {type === 'cloze' && (
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            Wrap words to hide with <code className="bg-[var(--bg-active)] px-1 rounded">{'{{c1::word}}'}</code>
          </p>
        )}
      </div>

      {/* Back — image variant */}
      {type === 'image' ? (
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Back <span className="text-[var(--text-muted)] font-normal">(upload image)</span>
          </label>

          {/* Hidden file input */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleImageChange}
          />

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className={cn(
              'flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] border text-sm transition-colors',
              errors.back
                ? 'border-[var(--danger)] text-[var(--danger)]'
                : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'
            )}
          >
            <ImagePlus size={14} />
            {imagePreview ? 'Change image' : 'Upload image'}
          </button>

          {/* Preview thumbnail */}
          {imagePreview && (
            <div className="mt-2 relative inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Card back preview"
                className="h-24 w-auto rounded-[var(--radius-sm)] border border-[var(--border)] object-contain bg-[var(--bg-active)]"
              />
              <button
                type="button"
                onClick={() => {
                  setImagePreview(null)
                  setBack('')
                }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[var(--danger)] text-[var(--danger-fg)] flex items-center justify-center"
                aria-label="Remove image"
              >
                <X size={9} />
              </button>
            </div>
          )}

          {errors.back && <p className="mt-1 text-xs text-[var(--danger)]">{errors.back}</p>}
        </div>
      ) : (
        /* Back — text variant */
        <div>
          <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
            Back <span className="text-[var(--text-muted)] font-normal">(markdown supported)</span>
          </label>
          <textarea
            ref={backRef}
            rows={3}
            maxLength={CARD_TEXT_MAX_LENGTH}
            placeholder="Answer or explanation…"
            value={back}
            onChange={(e) => {
              setBack(e.target.value)
              if (errors.back) setErrors((prev) => ({ ...prev, back: undefined }))
            }}
            onKeyDown={(e) => handleTextareaKeyDown(e, backRef, back, setBack)}
            className={cn(
              'w-full bg-[var(--bg-hover)] border rounded-[var(--radius-sm)]',
              'text-[var(--text-primary)] text-sm placeholder:text-[var(--text-muted)]',
              'px-3 py-2 resize-none transition-colors duration-100',
              'hover:border-[var(--border-strong)]',
              'focus:outline-none focus:ring-1',
              errors.back
                ? 'border-[var(--danger)] focus:border-[var(--danger)] focus:ring-[var(--danger)]'
                : 'border-[var(--border)] focus:border-[var(--accent)] focus:ring-[var(--accent)]'
            )}
          />
          {errors.back && <p className="mt-1 text-xs text-[var(--danger)]">{errors.back}</p>}
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            Supports Markdown and LaTeX math: <code className="font-mono">$inline$</code> or <code className="font-mono">$$display$$</code>
          </p>
        </div>
      )}

      {/* Live preview toggle (only for non-image cards) */}
      {type !== 'image' && (
        <div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 text-[10px] px-2 py-1 rounded transition-colors',
              showPreview
                ? 'bg-[var(--accent)] text-[var(--accent-fg)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
            )}
          >
            {showPreview ? <Edit2 size={10} /> : <Eye size={10} />}
            {showPreview ? 'Hide Preview' : 'Preview'}
          </button>

          {showPreview && (front || back) && (
            <div className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
              <ReviewCard
                card={{
                  id: '__preview__',
                  deckId,
                  userId: '',
                  front: front || '(empty front)',
                  back: back || '(empty back)',
                  type,
                  tags: [],
                  isPinned: false,
                  isArchived: false,
                  order: 0,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                }}
                showAnswer={true}
              />
            </div>
          )}
        </div>
      )}

      {/* Tags */}
      <div>
        <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
          Tags <span className="text-[var(--text-muted)] font-normal">(optional, comma separated)</span>
        </label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-active)] text-xs text-[var(--text-secondary)]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <Input
          placeholder="Add tags… (press Enter or comma)"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleTagKeyDown}
          onBlur={addTag}
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        {onDone && (
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            {isEdit ? 'Cancel' : 'Done'}
          </Button>
        )}
        <Button type="submit" variant="primary" size="sm">
          {isEdit ? 'Save Changes' : 'Add Card'}
        </Button>
      </div>
    </form>
  )
}
