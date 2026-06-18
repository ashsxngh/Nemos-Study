export type Theme = 'light' | 'dark' | 'system'

export type CardType = 'basic' | 'cloze' | 'image' | 'typed'

export type CardSide = 'front' | 'back'

export type Difficulty = 1 | 2 | 3 | 4

export type FolderColor =
  | 'default'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'blue'
  | 'purple'
  | 'pink'

export interface User {
  id: string
  email: string
  name: string
  avatarUrl?: string
  createdAt: string
}

export interface Folder {
  id: string
  userId: string
  parentId: string | null
  name: string
  color: FolderColor
  isStarred: boolean
  isArchived: boolean
  order: number
  createdAt: string
  updatedAt: string
  _cardCount?: number
  _childCount?: number
}

export interface Deck {
  id: string
  userId: string
  folderId: string | null
  name: string
  description?: string
  isStarred: boolean
  isArchived: boolean
  tags: string[]
  order: number
  createdAt: string
  updatedAt: string
  _cardCount?: number
  _masteryPercent?: number
  _dueCount?: number
}

export interface Card {
  id: string
  deckId: string
  userId: string
  type: CardType
  front: string
  back: string
  hint?: string
  imageUrl?: string
  tags: string[]
  isPinned: boolean
  isArchived: boolean
  linkedCardIds: string[]
  prerequisiteCardIds: string[]
  order: number
  createdAt: string
  updatedAt: string
  _srsData?: SRSData
}

export interface SRSData {
  cardId: string
  userId: string
  interval: number
  easeFactor: number
  repetitions: number
  dueDate: string
  lastReviewedAt: string | null
  lapses: number
  masteryPercent: number
  state: 'new' | 'review' | 'relearning'
}

export interface ReviewSession {
  id: string
  userId: string
  deckId?: string
  folderId?: string
  startedAt: string
  endedAt?: string
  cardsReviewed: number
  cardsCorrect: number
  cardsIncorrect: number
  averageResponseMs: number
  mode: 'standard' | 'cram' | 'random' | 'failed-only' | 'new-only' | 'reviews-only'
}

export interface ReviewLog {
  id: string
  sessionId: string
  cardId: string
  userId: string
  rating: Difficulty
  responseMs: number
  reviewedAt: string
  scheduledInterval: number
  ease: number
  wasNew?: boolean
}

export interface Note {
  id: string
  userId: string
  folderId?: string | null
  title: string
  content: string
  isStarred: boolean
  isArchived: boolean
  tags: string[]
  linkedNoteIds: string[]
  embeddedCardIds: string[]
  createdAt: string
  updatedAt: string
}

export interface Exam {
  id: string
  userId: string
  name: string
  subject: string
  date: string
  notes?: string
  priority: 'low' | 'medium' | 'high'
  deckIds: string[]
  folderIds: string[]
  targetRetention: number  // 0–1, e.g. 0.90 = 90% recall on exam day
  createdAt: string
  rating?: number                   // 1–5 stars, set after exam date passes
  predictedRetentionAtExam?: number // avgRetention captured at rating time (0–1)
}

export interface Goal {
  id: string
  userId: string
  type: 'daily-cards' | 'daily-minutes' | 'weekly-cards' | 'streak'
  target: number
  current: number
  period: string
  createdAt: string
}

export interface StudyStreak {
  userId: string
  currentStreak: number
  longestStreak: number
  lastStudiedAt: string | null
  totalDaysStudied: number
}

export interface DailyStats {
  userId: string
  date: string
  cardsReviewed: number
  cardsLearned: number
  minutesStudied: number
  sessionsCount: number
  retentionRate: number
}

export interface CommandItem {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string[]
  group: string
  action: () => void
  keywords?: string[]
}

export interface NavItem {
  id: string
  label: string
  href: string
  icon: string
  badge?: number
}

export interface BreadcrumbItem {
  label: string
  href?: string
}

export interface ToastData {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
  duration?: number
}

export interface StudySettings {
  algorithm: 'sm2' | 'fsrs' | 'custom'
  newCardsPerDay: number
  maxReviewsPerDay: number
  easeBonus: number
  hardInterval: number
  graduatingInterval: number
  lapseInterval: number
  showAnswerTimer: boolean
  autoPlayAudio: boolean
}
