import type { Deck, Folder } from '@/lib/types'

/**
 * Archiving is INHERITED down the folder tree: a deck inside an archived
 * folder is itself archived, at any depth, and stays that way until the user
 * explicitly unarchives it — nothing un-archives implicitly.
 *
 * A deck's (or subfolder's) own `isArchived` flag is stored independently and
 * never overwritten by a parent, so unarchiving a folder restores exactly the
 * items that were archived *only* by inheritance and leaves anything the user
 * archived individually still archived.
 *
 * What "archived" means for scheduling lives in `useLibraryStore`: no new
 * cards are introduced (`getNewCards`), but everything already in the SRS
 * schedule keeps coming up for review (`getReviewsDue`). See
 * `src/store/archivedDeck.test.ts`.
 */

/** Folder ids that are archived outright or sit under an archived ancestor. */
export function archivedFolderIds(folders: Folder[]): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const cache = new Map<string, boolean>()

  const resolve = (id: string, seen: Set<string>): boolean => {
    const cached = cache.get(id)
    if (cached !== undefined) return cached
    const folder = byId.get(id)
    // Missing parent (orphaned chain) or a cycle in a corrupted tree: treat as
    // not archived rather than guessing, and never recurse forever.
    if (!folder || seen.has(id)) return false
    seen.add(id)
    const archived =
      folder.isArchived || (folder.parentId !== null && resolve(folder.parentId, seen))
    cache.set(id, archived)
    return archived
  }

  const result = new Set<string>()
  for (const f of folders) if (resolve(f.id, new Set())) result.add(f.id)
  return result
}

/** Deck ids that are archived outright or sit in an archived folder. */
export function archivedDeckIds(decks: Deck[], folders: Folder[]): Set<string> {
  const archivedFolders = archivedFolderIds(folders)
  const result = new Set<string>()
  for (const d of decks) {
    if (d.isArchived || (d.folderId !== null && archivedFolders.has(d.folderId))) result.add(d.id)
  }
  return result
}
