// Input length caps — enforced at input components and store actions so
// oversized content can't reach the store, IndexedDB, or Supabase.
export const CARD_TEXT_MAX_LENGTH = 10_000
export const NOTE_CONTENT_MAX_LENGTH = 100_000
export const NAME_MAX_LENGTH = 255
