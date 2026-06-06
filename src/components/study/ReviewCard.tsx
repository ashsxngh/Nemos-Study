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

const CLOZE_RE = /\{\{c\d+::([^}]+)\}\}/g

// Extract cloze answers in order
function parseClozeAnswers(text: string): string[] {
  const answers: string[] = []
  const re = /\{\{c\d+::([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    answers.push(match[1])
  }
  return answers
}

// Replace cloze markers with [blank N] placeholder text
function renderClozeQuestion(text: string): string {
  let n = 0
  return text.replace(/\{\{c\d+::([^}]+)\}\}/g, () => {
    n++
    return `[blank ${n}]`
  })
}

function parseCloze(text: string, reveal: boolean): React.ReactNode {
  const parts: React.ReactNode[] = []
  let last = 0
  let match: RegExpExecArray | null
  CLOZE_RE.lastIndex = 0
  while ((match = CLOZE_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index))
    const answer = match[1]
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
          <p className="leading-relaxed text-base text-[#e8e8ea]">{children}</p>
        ),
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-')
          return isBlock ? (
            <pre className="bg-[#0f0f11] rounded-[var(--radius-sm)] p-3 overflow-x-auto my-2 text-left">
              <code className="text-sm font-mono text-[#e8e8ea]">{children}</code>
            </pre>
          ) : (
            <code className="bg-[#0f0f11] text-[var(--accent)] px-1.5 py-0.5 rounded text-sm font-mono">
              {children}
            </code>
          )
        },
        strong: ({ children }) => <strong className="font-bold text-[#e8e8ea]">{children}</strong>,
        em: ({ children }) => <em className="italic text-[#9b9ba4]">{children}</em>,
        ul: ({ children }) => <ul className="list-disc list-inside space-y-1 text-left my-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 text-left my-1">{children}</ol>,
        h1: ({ children }) => <h1 className="text-xl font-bold text-[#e8e8ea] mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-lg font-semibold text-[#e8e8ea] mb-1">{children}</h2>,
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-[var(--accent)] pl-3 text-[#9b9ba4] italic my-2">
            {children}
          </blockquote>
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
      {/* Question section */}
      <div className="p-6 text-[#e8e8ea]">
        {card.type === 'cloze' ? (
          <>
            <p className="text-lg leading-relaxed mb-4">
              {parseCloze(card.front, false)}
            </p>

            {/* Cloze typed inputs (shown before answer) */}
            {!showAnswer && (
              <div className="space-y-2.5 mt-4">
                {clozeAnswers.map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <span className="text-xs text-[#6b6b72] shrink-0 w-14">Blank {i + 1}</span>
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
                      className="flex-1 h-8 px-2.5 text-sm bg-[#161618] border border-[#2a2a30] rounded-[var(--radius-sm)] text-[#e8e8ea] placeholder:text-[#4a4a55] outline-none focus:border-[var(--accent)] transition-colors"
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
        <div className="animate-fade-in border-t border-[#2a2a30] bg-[#161618] p-6">

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
                <p className="text-[10px] text-[#4a4a55] pt-1">
                  Use the rating buttons to override if you think you had it right.
                </p>
              )}
            </div>
          )}

          {card.type === 'cloze' ? (
            <p className="text-base leading-relaxed text-[#e8e8ea]">
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
            <div className="text-[#e8e8ea]">
              <CardContent content={card.back} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
