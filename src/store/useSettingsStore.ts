'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_FSRS_PARAMS } from '@/lib/srs'

interface SettingsData {
  // SRS
  algorithm: 'sm2' | 'fsrs'
  newCardsPerDay: number
  maxReviewsPerDay: number
  easyBonus: number
  hardInterval: number
  graduatingInterval: number
  lapseInterval: number
  startingEase: number

  // FSRS parameters
  fsrsWeights: number[]        // 17 weights w0-w16
  fsrsTargetRetention: number  // default 0.9
  fsrsMaxInterval: number      // default 36500

  // Burnout / workload
  burnoutWarningEnabled: boolean
  burnoutThresholdCards: number
  burnoutThresholdMinutes: number

  // Review behaviour
  showAnswerTimer: boolean
  autoAdvance: boolean
  leechThreshold: number

  // Goals
  dailyCardTarget: number
  dailyMinuteTarget: number

  // Notifications
  dailyReminderEnabled: boolean
  dailyReminderTime: string
  streakWarningEnabled: boolean
  weeklyReportEnabled: boolean
}

interface SettingsState extends SettingsData {
  updateSettings: (updates: Partial<SettingsData>) => void
  resetSettings: () => void
}

const defaults: SettingsData = {
  algorithm: 'sm2',
  newCardsPerDay: 20,
  maxReviewsPerDay: 200,
  easyBonus: 1.3,
  hardInterval: 1.2,
  graduatingInterval: 4,
  lapseInterval: 10,
  startingEase: 2.5,

  fsrsWeights: DEFAULT_FSRS_PARAMS.weights,
  fsrsTargetRetention: DEFAULT_FSRS_PARAMS.targetRetention,
  fsrsMaxInterval: DEFAULT_FSRS_PARAMS.maximumInterval,

  burnoutWarningEnabled: true,
  burnoutThresholdCards: 150,
  burnoutThresholdMinutes: 90,

  showAnswerTimer: false,
  autoAdvance: false,
  leechThreshold: 8,

  dailyCardTarget: 50,
  dailyMinuteTarget: 30,

  dailyReminderEnabled: false,
  dailyReminderTime: '18:00',
  streakWarningEnabled: true,
  weeklyReportEnabled: false,
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      updateSettings: (updates) => set((s) => ({ ...s, ...updates })),
      resetSettings: () => set({ ...defaults }),
    }),
    {
      name: 'nemos-settings',
    }
  )
)
