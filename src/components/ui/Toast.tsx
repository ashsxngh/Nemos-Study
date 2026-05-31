'use client'

import { useEffect } from 'react'
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/useAppStore'
import type { ToastData } from '@/lib/types'

const icons = {
  success: CheckCircle2,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
}

const styles = {
  success: 'text-[var(--success)]',
  error: 'text-[var(--danger)]',
  info: 'text-[var(--accent)]',
  warning: 'text-[var(--warning)]',
}

function ToastItem({ toast }: { toast: ToastData }) {
  const removeToast = useAppStore((s) => s.removeToast)
  const Icon = icons[toast.type]

  useEffect(() => {
    const timer = setTimeout(() => removeToast(toast.id), toast.duration ?? 4000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, removeToast])

  return (
    <div className="flex items-start gap-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-lg p-3 animate-fade-in min-w-64 max-w-xs">
      <Icon size={15} className={cn('mt-0.5 shrink-0', styles[toast.type])} />
      <p className="text-sm text-[var(--text-primary)] flex-1">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useAppStore((s) => s.toasts)

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  )
}
