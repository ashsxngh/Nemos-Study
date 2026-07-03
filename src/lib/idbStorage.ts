'use client'

// ── IndexedDB storage for zustand persist ─────────────────────────────────────
// localStorage caps at ~5MB — enough for a few hundred cards but not 20k+.
// IDB has no practical limit (bounded only by device storage).
// We also auto-migrate any existing localStorage data on first read.
// Shared by every persisted store (one DB, one object store, one key per store).

const DB_NAME = 'nemos-idb'
const STORE = 'kv'
let _db: IDBDatabase | null = null
// Caches the in-flight open request, not just the resolved db — without
// this, two near-simultaneous callers (e.g. React Strict Mode's mount /
// unmount / remount cycle firing rehydrate() twice in quick succession)
// each see _db as null and issue their own indexedDB.open() call. On a
// fresh profile where the database doesn't exist yet, both requests race
// to create the same object store; the second can get stuck behind the
// first's still-open upgrade transaction with no onsuccess/onerror ever
// firing — a silent, permanent hang.
let _openPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (_openPromise) return _openPromise
  _openPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => { _db = req.result; _openPromise = null; res(_db) }
    req.onerror = () => { _openPromise = null; rej(req.error) }
    req.onblocked = () => { _openPromise = null; rej(new Error('indexedDB open blocked by another connection')) }
  })
  return _openPromise
}

function idbGet(key: string): Promise<string | null> {
  return open().then((db) => new Promise((res, rej) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key)
    req.onsuccess = () => res((req.result as string) ?? null)
    req.onerror = () => rej(req.error)
  }))
}

function idbPut(key: string, value: string): Promise<void> {
  return open().then((db) => new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  }))
}

function idbDel(key: string): Promise<void> {
  return open().then((db) => new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  }))
}

export function createIDBStorage() {
  return {
    async getItem(key: string): Promise<string | null> {
      const val = await idbGet(key)
      if (val !== null) return val
      // One-time migration: if data exists in localStorage, move it to IDB.
      try {
        const lsVal = localStorage.getItem(key)
        if (lsVal !== null) {
          await idbPut(key, lsVal)
          localStorage.removeItem(key)
          return lsVal
        }
      } catch { /* localStorage may not be available in all contexts */ }
      return null
    },
    setItem: idbPut,
    removeItem: idbDel,
  }
}
