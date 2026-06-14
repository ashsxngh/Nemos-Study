import JSZip from 'jszip'

// Strip HTML markup from Anki field content (Anki always stores HTML).
// Converts <br> to newlines, strips all other tags, decodes entities.
function stripAnkiHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

// ── Minimal SQLite B-tree reader ──────────────────────────────────────────────
// Only handles ordinary rowid tables, UTF-8 text, no WAL, no encryption.
// Supports overflow pages for large cell payloads.

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1]
}

function u32(b: Uint8Array, o: number): number {
  return (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0)
}

// Returns [value, bytesConsumed]. Uses multiplication (not bit-shifts) to
// avoid 32-bit overflow for values > 2^31.
function varint(b: Uint8Array, o: number): [number, number] {
  let v = 0
  for (let i = 0; i < 9; i++) {
    const byte = b[o + i]
    if (i < 8) {
      v = v * 128 + (byte & 0x7f)
      if (!(byte & 0x80)) return [v, i + 1]
    } else {
      v = v * 256 + byte
      return [v, 9]
    }
  }
  return [v, 9]
}

function utf8(b: Uint8Array, o: number, len: number): string {
  return new TextDecoder().decode(b.subarray(o, o + len))
}

type SqlVal = string | number | null

// Decode a SQLite record payload into an array of column values.
function decodeRecord(p: Uint8Array): SqlVal[] {
  const [hLen, hB] = varint(p, 0)
  const types: number[] = []
  let pos = hB
  while (pos < hLen) {
    const [t, tb] = varint(p, pos)
    types.push(t)
    pos += tb
  }
  const out: SqlVal[] = []
  let dp = hLen
  for (const t of types) {
    if (t === 0) { out.push(null) }
    else if (t === 1) { out.push(p[dp]); dp += 1 }
    else if (t === 2) { out.push(u16(p, dp)); dp += 2 }
    else if (t === 3) { out.push((p[dp] << 16) | (p[dp + 1] << 8) | p[dp + 2]); dp += 3 }
    else if (t === 4) { out.push(u32(p, dp)); dp += 4 }
    else if (t === 5) { out.push(u16(p, dp) * 0x100000000 + u32(p, dp + 2)); dp += 6 }
    else if (t === 6) { out.push(u32(p, dp) * 0x100000000 + u32(p, dp + 4)); dp += 8 }
    else if (t === 7) { out.push(new DataView(p.buffer, p.byteOffset + dp, 8).getFloat64(0)); dp += 8 }
    else if (t === 8) { out.push(0) }
    else if (t === 9) { out.push(1) }
    else if (t >= 12 && t % 2 === 0) { const l = (t - 12) / 2; out.push(null); dp += l }
    else if (t >= 13 && t % 2 === 1) { const l = (t - 13) / 2; out.push(utf8(p, dp, l)); dp += l }
    else out.push(null)
  }
  return out
}

// Extract the payload bytes for a table-leaf B-tree cell, following overflow
// pages when the content exceeds the per-page threshold.
function cellPayload(
  page: Uint8Array,
  cellOff: number,
  psz: number,
  db: Uint8Array
): Uint8Array | null {
  try {
    let pos = cellOff
    const [pSz, pB] = varint(page, pos); pos += pB
    const [, rB] = varint(page, pos); pos += rB   // skip rowid

    const X = psz - 35
    if (pSz <= X) return page.subarray(pos, pos + pSz)

    // Overflow: calculate local portion per SQLite spec section 2.3.3
    const M = Math.floor(((psz - 12) * 32 / 255) - 23)
    const K = M + ((pSz - M) % (psz - 4))
    const localSz = K <= X ? K : M

    const result = new Uint8Array(pSz)
    result.set(page.subarray(pos, pos + localSz))
    let rem = pSz - localSz
    let ovPg = u32(page, pos + localSz)
    let dst = localSz
    while (rem > 0 && ovPg !== 0) {
      const ovOff = (ovPg - 1) * psz
      const next = u32(db, ovOff)
      const n = Math.min(rem, psz - 4)
      result.set(db.subarray(ovOff + 4, ovOff + 4 + n), dst)
      dst += n; rem -= n; ovPg = next
    }
    return result
  } catch { return null }
}

// Recursively walk a table B-tree and collect all leaf records.
function scanBTree(
  db: Uint8Array,
  pgNum: number,
  psz: number,
  out: SqlVal[][]
): void {
  if (pgNum < 1 || (pgNum - 1) * psz + psz > db.length) return
  const pgOff = (pgNum - 1) * psz
  const hOff = pgNum === 1 ? 100 : 0   // page 1 has a 100-byte file header first
  const pg = db.subarray(pgOff, pgOff + psz)
  const type = pg[hOff]
  if (type !== 0x05 && type !== 0x0D) return  // only table btree pages
  const isLeaf = type === 0x0D
  const hSz = isLeaf ? 8 : 12
  const cellCount = u16(pg, hOff + 3)
  const offsets: number[] = []
  for (let i = 0; i < cellCount; i++) offsets.push(u16(pg, hOff + hSz + i * 2))
  if (isLeaf) {
    for (const co of offsets) {
      const pl = cellPayload(pg, co, psz, db)
      if (pl) { try { out.push(decodeRecord(pl)) } catch { /* skip bad cell */ } }
    }
  } else {
    // Interior page: each cell holds a left-child pointer + key varint
    for (const co of offsets) scanBTree(db, u32(pg, co), psz, out)
    scanBTree(db, u32(pg, hOff + 8), psz, out)  // rightmost child
  }
}

// Scan sqlite_schema (page 1) to find the root page number of a named table.
function findRootPage(db: Uint8Array, psz: number, tableName: string): number | null {
  const rows: SqlVal[][] = []
  scanBTree(db, 1, psz, rows)
  // sqlite_schema columns: type(0), name(1), tbl_name(2), rootpage(3), sql(4)
  for (const r of rows) {
    if (r[0] === 'table' && r[1] === tableName) {
      const rp = r[3]
      return typeof rp === 'number' ? rp : null
    }
  }
  return null
}

// Parse an Anki SQLite database (.anki2 / .anki21) and return cards.
//
// In SQLite, INTEGER PRIMARY KEY columns are stored as serial type 0 (NULL
// placeholder) in the record payload — so the actual column indices are:
//   payload col 0: id     (null, actual value is the B-tree rowid)
//   payload col 1: guid   (text)
//   payload col 2: mid    (integer)
//   payload col 3: mod    (integer)
//   payload col 4: usn    (integer)
//   payload col 5: tags   (text)
//   payload col 6: flds   (text, fields separated by 0x1f)
//
// We also detect the correct column dynamically by searching for the \x1f
// separator to guard against databases that omit the null id placeholder.
function parseAnkiSqlite(db: Uint8Array): { front: string; back: string; tags: string[] }[] {
  if (db.length < 100 || utf8(db, 0, 15) !== 'SQLite format 3') {
    throw new Error('Not a valid SQLite database')
  }
  const rawPsz = u16(db, 16)
  const psz = rawPsz === 1 ? 65536 : rawPsz

  const rootPg = findRootPage(db, psz, 'notes')
  if (!rootPg) throw new Error('No notes table found in Anki database')

  const rows: SqlVal[][] = []
  scanBTree(db, rootPg, psz, rows)

  const results: { front: string; back: string; tags: string[] }[] = []
  for (const row of rows) {
    // Find flds by searching for the \x1f field separator.
    // Standard layout has id as null placeholder at [0], so flds is at [6] and
    // tags at [5]. Fall back to [5]/[4] in case id is omitted from the header.
    let flds: SqlVal
    let tagsRaw: SqlVal
    if (typeof row[6] === 'string' && row[6].includes('\x1f')) {
      flds = row[6]
      tagsRaw = row[5]
    } else if (typeof row[5] === 'string' && row[5].includes('\x1f')) {
      flds = row[5]
      tagsRaw = row[4]
    } else {
      continue
    }

    const parts = (flds as string).split('\x1f')
    const front = stripAnkiHtml(parts[0] ?? '')
    const back = stripAnkiHtml(parts[1] ?? '')
    if (!front) continue
    const tags = typeof tagsRaw === 'string' ? tagsRaw.trim().split(/\s+/).filter(Boolean) : []
    results.push({ front, back, tags })
  }
  return results
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseAnkiPackage(
  buffer: ArrayBuffer
): Promise<{ front: string; back: string; tags: string[] }[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new Error('Not a valid Anki package (.apkg must be a ZIP file)')
  }

  // Anki 23.10+ uses collection.anki21b (zstd-compressed), which requires
  // decompression before SQLite parsing. Detect it early so the error is clear.
  if (zip.file('collection.anki21b') && !zip.file('collection.anki21') && !zip.file('collection.anki2')) {
    throw new Error(
      'This package uses Anki\'s new compressed format (Anki 23.10+). ' +
      'To import it, open Anki → File → Export, choose "Anki Deck Package (.apkg)" ' +
      'and enable "Legacy support (Anki 2.1 scheduler)" before exporting.'
    )
  }

  // Anki 2.1.26+ uses collection.anki21; older versions use collection.anki2
  const dbFile = zip.file('collection.anki21') ?? zip.file('collection.anki2')
  if (!dbFile) throw new Error('No Anki collection database found in this package')

  const dbBytes = await dbFile.async('uint8array')
  return parseAnkiSqlite(dbBytes)
}
