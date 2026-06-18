'use client'

import { useEffect } from 'react'
import { useSync } from '@/hooks/useSync'
import { useAppStore } from '@/store/useAppStore'

export function SyncProvider() {
  const { syncing, error, offline, manualPush } = useSync()
  const setSyncing = useAppStore((s) => s.setSyncing)
  const setSyncError = useAppStore((s) => s.setSyncError)
  const setSyncOffline = useAppStore((s) => s.setSyncOffline)
  const setManualSync = useAppStore((s) => s.setManualSync)

  useEffect(() => { setSyncing(syncing) }, [syncing, setSyncing])
  useEffect(() => { setSyncError(error) }, [error, setSyncError])
  useEffect(() => { setSyncOffline(offline) }, [offline, setSyncOffline])
  useEffect(() => {
    setManualSync(manualPush)
    return () => setManualSync(null)
  }, [manualPush, setManualSync])

  return null
}
