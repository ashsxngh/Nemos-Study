import { cn } from '@/lib/utils'

type Variant = 'default' | 'accent' | 'success' | 'warning' | 'danger' | 'outline'

interface BadgeProps {
  children: React.ReactNode
  variant?: Variant
  className?: string
}

const variantStyles: Record<Variant, string> = {
  default: 'bg-[var(--bg-active)] text-[var(--text-secondary)]',
  accent: 'bg-[var(--accent-subtle)] text-[var(--accent)]',
  success: 'bg-[var(--success-subtle)] text-[var(--success)]',
  warning: 'bg-[var(--warning-subtle)] text-[var(--warning)]',
  danger: 'bg-[var(--danger-subtle)] text-[var(--danger)]',
  outline: 'border border-[var(--border)] text-[var(--text-secondary)]',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-1 rounded-[var(--radius-sm)] font-mono text-[11px] font-medium tracking-wide leading-none',
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
