'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import type { Card } from '@/lib/types'

interface ReviewCardProps {
  card: Card
  showAnswer: boolean
  className?: string
  onTypedCheck?: () => void
}

// Matches {{cN::answer}} and {{cN::answer::hint}}. Capture group 1 is the full content
// (possibly "answer::hint"); callers extract the answer by splitting on the first "::".
const CLOZE_RE = /\{\{c\d+::([^}]*)\}\}/g

// Extract cloze answers in order. Handles both {{c1::answer}} and {{c1::answer::hint}}.
function parseClozeAnswers(text: string): string[] {
  const answers: string[] = []
  const re = /\{\{c\d+::([^}]*)\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    // content may be "answer::hint" — take only the answer part
    const content = match[1]
    const sep = content.indexOf('::')
    answers.push(sep >= 0 ? content.slice(0, sep) : content)
  }
  return answers
}

function parseCloze(text: string, reveal: boolean): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  CLOZE_RE.lastIndex = 0
  while ((match = CLOZE_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    // Strip hint: "answer::hint" → "answer"
    const content = match[1]
    const sep = content.indexOf('::')
    const answer = sep >= 0 ? content.slice(0, sep) : content
    if (reveal) {
      parts.push(
        <span key={match.index} className="text-[var(--accent)] font-bold px-0.5">{answer}</span>
      )
    } else {
      parts.push(
        <span
          key={match.index}
          className="inline-block border-b-2 border-[var(--accent)] bg-[var(--accent-subtle)] text-transparent rounded-sm px-2 min-w-[3rem] select-none"
        >
          {answer}
        </span>
      )
    }
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function CardContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { strict: false }]]}
      components={{
        p: ({ children }) => (
          <p className="leading-[1.6] text-[18px] text-[var(--text-primary)]">{children}</p>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          return isBlock ? (
            <pre className="bg-[var(--bg-base)] rounded-[var(--radius-sm)] p-3 overflow-x-auto my-2 text-left">
              <code className="text-sm font-mono text-[var(--text-primary)]">{children}</code>
            </pre>
          ) : (
            <code className="bg-[var(--bg-base)] text-[var(--accent)] px-1.5 py-0.5 rounded text-sm font-mono">
              {children}
            </code>
          )
        },
        strong: ({ children }) => <strong className="font-bold text-[var(--text-primary)]">{children}</strong>,
        em: ({ children }) => <em className="italic text-[var(--text-secondary)]">{children}</em>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 text-left my-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 text-left my-1">{children}</ol>,
        h1: ({ children }) => <h1 className="text-xl font-bold text-[var(--text-primary)] mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{children}</h2>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[var(--accent)] pl-3 text-[var(--text-secondary)] italic my-2">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full border-collapse text-sm text-left">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="px-3 py-1.5 border border-[var(--border)] bg-[var(--bg-base)] font-semibold text-[var(--text-primary)]">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-secondary)]">{children}</td>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function isAnswerMatch(typed: string, expected: string): boolean {
  return typed.trim().toLowerCase() === expected.trim().toLowerCase()
}

export function ReviewCard({ card, showAnswer, className, onTypedCheck }: ReviewCardProps) {
  const [typedAnswer, setTypedAnswer] = useState('')
  const [answerChecked, setAnswerChecked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Cloze-specific state
  const clozeAnswers = useMemo(() => parseClozeAnswers(card.front), [card.front])
  const [clozeInputs, setClozeInputs] = useState<string[]>([])
  const [clozeChecked, setClozeChecked] = useState(false)
  const firstClozeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTypedAnswer('')
    setAnswerChecked(false)
    setClozeInputs(new Array(clozeAnswers.length).fill(''))
    setClozeChecked(false)
  }, [card.id, clozeAnswers.length])

  useEffect(() => {
    if (card.type === 'typed' && !showAnswer && inputRef.current) {
      inputRef.current.focus()
    }
    if (card.type === 'cloze' && !showAnswer && !clozeChecked && firstClozeRef.current) {
      firstClozeRef.current.focus()
    }
  }, [card.id, card.type, showAnswer, clozeChecked])

  const isCorrect =
    answerChecked &&
    isAnswerMatch(typedAnswer, card.back)

  const clozeResults = useMemo(() => {
    if (!clozeChecked) return []
    return clozeAnswers.map((expected, i) => isAnswerMatch(clozeInputs[i] ?? '', expected))
  }, [clozeChecked, clozeAnswers, clozeInputs])

  const allClozeCorrect = clozeResults.length > 0 && clozeResults.every(Boolean)

  const isImage =
    card.type === 'image' &&
    (card.back.startsWith('data:image') || card.back.startsWith('http'))

  const handleCheck = () => {
    setAnswerChecked(true)
    onTypedCheck?.()
  }

  const handleClozeCheck = () => {
    if (clozeInputs.every((v) => !v.trim())) return
    setClozeChecked(true)
    onTypedCheck?.()
  }

  return (
    <div className={cn('w-full', className)}>
      {/* Question section — Stitch mandates ≥32px padding inside study cards */}
      <div className="p-8 text-[var(--text-primary)]">
        {card.type === 'cloze' ? (
          <>
            <p className="text-[18px] leading-[1.6] mb-4">
              {parseCloze(card.front, false)}
            </p>

            {/* Cloze typed inputs (shown before answer) */}
            {!showAnswer && (
              <div className="space-y-2.5 mt-4">
                {clozeAnswers.map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-xs text-[var(--text-muted)] shrink-0 w-14">Blank {i + 1}</span>
                    <input
                      ref={i === 0 ? firstClozeRef : undefined}
                      type="text"
                      placeholder={`Type answer for blank ${i + 1}…`}
                      value={clozeInputs[i] ?? ''}
                      onChange={(e) => {
                        const next = [...clozeInputs]
                        next[i] = e.target.value
                        setClozeInputs(next)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (i < clozeAnswers.length - 1) {
                            // move to next blank
                            const next = document.querySelectorAll<HTMLInputElement>('[data-cloze-input]')
                            next[i + 1]?.focus()
                          } else {
                            handleClozeCheck()
                          }
                        }
                      }}
                      data-cloze-input
                      className="flex-1 h-8 px-2.5 text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
                    />
                  </div>
                ))}
                <Button
                  variant="primary"
                  onClick={handleClozeCheck}
                  disabled={clozeInputs.every((v) => !v.trim())}
                  className="mt-1"
                >
                  Check Answer
                </Button>
              </div>
            )}
          </>
        ) : (
          <CardContent content={card.front} />
        )}

        {/* Typed input (before answer) */}
        {card.type === 'typed' && !showAnswer && (
          <div className="mt-5 flex flex-col gap-2 max-w-sm">
            <Input
              ref={inputRef}
              placeholder="Type your answer…"
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typedAnswer.trim()) handleCheck()
              }}
            />
            <Button
              variant="primary"
              onClick={handleCheck}
              disabled={!typedAnswer.trim()}
            >
              Check Answer
            </Button>
          </div>
        )}
      </div>

      {/* Answer section */}
      {showAnswer && (
        <div className="animate-fade-in border-t border-[var(--border)] p-8">

          {/* Typed result feedback */}
          {card.type === 'typed' && answerChecked && (
            <div
              className={cn(
                'inline-flex items-center gap-2 mb-4 px-3 py-1.5 rounded-full text-xs font-medium',
                isCorrect
                  ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                  : 'bg-[var(--danger-subtle)] text-[var(--danger)]'
              )}
            >
              {isCorrect ? '✓ Correct!' : `✗ You wrote: "${typedAnswer}"`}
            </div>
          )}

          {/* Cloze result feedback */}
          {card.type === 'cloze' && clozeChecked && (
            <div className="mb-4 space-y-1.5">
              {clozeAnswers.map((expected, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
                    clozeResults[i]
                      ? 'bg-[var(--success-subtle)] text-[var(--success)]'
                      : 'bg-[var(--danger-subtle)] text-[var(--danger)]'
                  )}
                >
                  {clozeResults[i] ? '✓' : '✗'}
                  <span>Blank {i + 1}:</span>
                  {!clozeResults[i] && (
                    <span className="opacity-70">you wrote &ldquo;{clozeInputs[i] || '(blank)'}&rdquo; — </span>
                  )}
                  <span>answer: <strong>{expected}</strong></span>
                </div>
              ))}
              {clozeResults.length > 0 && !allClozeCorrect && (
                <p className="text-[10px] text-[var(--text-muted)] pt-1">
                  Use the rating buttons to override if you think you had it right.
                </p>
              )}
            </div>
          )}

          {card.type === 'cloze' ? (
            <p className="text-[18px] leading-[1.6] text-[var(--text-primary)]">
              {parseCloze(card.back?.trim() ? card.back : card.front, true)}
            </p>
          ) : isImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.back}
              alt="Answer"
              className="max-h-64 max-w-full rounded-[var(--radius)] object-contain"
            />
          ) : (
            <div className="text-[var(--text-primary)]">
              <CardContent content={card.back} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
