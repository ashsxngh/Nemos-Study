'use client'

import { useEffect } from 'react'
import { useSync } from '@/hooks/useSync'
import { useAppStore } from '@/store/useAppStore'

export function SyncProvider() {
  const { syncing, error } = useSync()
  const setSyncing = useAppStore((s) => s.setSyncing)
  const setSyncError = useAppStore((s) => s.setSyncError)

  useEffect(() => { setSyncing(syncing) }, [syncing, setSyncing])
  useEffect(() => { setSyncError(error) }, [error, setSyncError])

  return null
}
