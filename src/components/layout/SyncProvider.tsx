'use client'

import { useSync } from '@/hooks/useSync'

export function SyncProvider() {
  useSync()
  return null
}
