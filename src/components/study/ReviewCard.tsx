'use client'

import React, { useState, useRef, useEffect } from 'react'
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
  /** Called when typed-answer card submits the check (triggers onFlip equivalent) */
  onTypedCheck?: () => void
}

const CLOZE_RE = /\{\{c\d+::([^}]+)\}\}/g

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

export function ReviewCard({ card, showAnswer, className, onTypedCheck }: ReviewCardProps) {
  const [typedAnswer, setTypedAnswer] = useState('')
  const [answerChecked, setAnswerChecked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTypedAnswer('')
    setAnswerChecked(false)
  }, [card.id])

  useEffect(() => {
    if (card.type === 'typed' && !showAnswer && inputRef.current) {
      inputRef.current.focus()
    }
  }, [card.id, card.type, showAnswer])

  const isCorrect =
    answerChecked &&
    typedAnswer.trim().toLowerCase() === card.back.trim().toLowerCase()

  const isImage =
    card.type === 'image' &&
    (card.back.startsWith('data:image') || card.back.startsWith('http'))

  const handleCheck = () => {
    setAnswerChecked(true)
    onTypedCheck?.()
  }

  return (
    <div className={cn('w-full', className)}>
      {/* Question section */}
      <div className="p-6 text-[#e8e8ea]">
        {card.type === 'cloze' ? (
          <p className="text-base leading-relaxed">
            {parseCloze(card.front, false)}
          </p>
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

      {/* Answer section — fades in when showAnswer === true */}
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
