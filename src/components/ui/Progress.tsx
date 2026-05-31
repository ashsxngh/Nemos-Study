import { cn } from '@/lib/utils'

interface ProgressProps {
  value: number
  max?: number
  className?: string
  barClassName?: string
  size?: 'sm' | 'md' | 'lg'
  color?: 'accent' | 'success' | 'warning' | 'danger'
}

const sizeH = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' }
const colorStyle = {
  accent: 'bg-[var(--accent)]',
  success: 'bg-[var(--success)]',
  warning: 'bg-[var(--warning)]',
  danger: 'bg-[var(--danger)]',
}

export function Progress({
  value,
  max = 100,
  className,
  barClassName,
  size = 'md',
  color = 'accent',
}: ProgressProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100))

  return (
    <div
      className={cn(
        'w-full bg-[var(--bg-active)] rounded-full overflow-hidden',
        sizeH[size],
        className
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-all duration-300',
          colorStyle[color],
          barClassName
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
