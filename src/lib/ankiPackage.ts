import JSZip from 'jszip'

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
// The notes table schema (id is INTEGER PRIMARY KEY → omitted from payload):
//   payload col 0: guid   (text)
//   payload col 1: mid    (integer)
//   payload col 2: mod    (integer)
//   payload col 3: usn    (integer)
//   payload col 4: tags   (text)
//   payload col 5: flds   (text, fields separated by 0x1f)
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
    const flds = row[5]
    const tagsRaw = row[4]
    if (typeof flds !== 'string') continue
    const parts = flds.split('\x1f')
    const front = (parts[0] ?? '').trim()
    const back = (parts[1] ?? '').trim()
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

  // Anki 2.1.26+ uses collection.anki21; older versions use collection.anki2
  const dbFile = zip.file('collection.anki21') ?? zip.file('collection.anki2')
  if (!dbFile) throw new Error('No Anki collection database found in this package')

  const dbBytes = await dbFile.async('uint8array')
  return parseAnkiSqlite(dbBytes)
}
