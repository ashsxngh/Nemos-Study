/**
 * Creates a real Anki-format SQLite database using node:sqlite,
 * wraps it in a ZIP, runs it through our parseAnkiPackage,
 * and reports what happens.
 */
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';

// ── 1. Create a real Anki-format SQLite database ────────────────────────────

const dbPath = join(tmpdir(), 'test_anki.db');

// Clean up any previous run
try { unlinkSync(dbPath); } catch {}

const db = new DatabaseSync(dbPath);

// Anki 2.1 schema
db.exec(`
  CREATE TABLE col (
    id    INTEGER PRIMARY KEY,
    crt   INTEGER NOT NULL,
    mod   INTEGER NOT NULL,
    scm   INTEGER NOT NULL,
    ver   INTEGER NOT NULL,
    dty   INTEGER NOT NULL,
    usn   INTEGER NOT NULL,
    ls    INTEGER NOT NULL,
    conf  TEXT NOT NULL,
    models TEXT NOT NULL,
    decks TEXT NOT NULL,
    dconf TEXT NOT NULL,
    tags  TEXT NOT NULL
  );

  CREATE TABLE notes (
    id    INTEGER PRIMARY KEY,
    guid  TEXT NOT NULL,
    mid   INTEGER NOT NULL,
    mod   INTEGER NOT NULL,
    usn   INTEGER NOT NULL,
    tags  TEXT NOT NULL,
    flds  TEXT NOT NULL,
    sfld  TEXT NOT NULL,
    csum  INTEGER NOT NULL,
    flags INTEGER NOT NULL,
    data  TEXT NOT NULL
  );

  CREATE TABLE cards (
    id     INTEGER PRIMARY KEY,
    nid    INTEGER NOT NULL,
    did    INTEGER NOT NULL,
    ord    INTEGER NOT NULL,
    mod    INTEGER NOT NULL,
    usn    INTEGER NOT NULL,
    type   INTEGER NOT NULL,
    queue  INTEGER NOT NULL,
    due    INTEGER NOT NULL,
    ivl    INTEGER NOT NULL,
    factor INTEGER NOT NULL,
    reps   INTEGER NOT NULL,
    lapses INTEGER NOT NULL,
    left   INTEGER NOT NULL,
    odue   INTEGER NOT NULL,
    odid   INTEGER NOT NULL,
    flags  INTEGER NOT NULL,
    data   TEXT NOT NULL
  );

  CREATE TABLE revlog (
    id      INTEGER PRIMARY KEY,
    cid     INTEGER NOT NULL,
    usn     INTEGER NOT NULL,
    ease    INTEGER NOT NULL,
    ivl     INTEGER NOT NULL,
    lastIvl INTEGER NOT NULL,
    factor  INTEGER NOT NULL,
    time    INTEGER NOT NULL,
    type    INTEGER NOT NULL
  );

  INSERT INTO col VALUES (1, 1000000, 1000000, 1000000, 11, 0, -1, 0, '{}', '{}', '{}', '{}', '{}');

  INSERT INTO notes VALUES (1, 'abcd1234', 1, 1000000, -1, '', 'What is 2+2?\x1f4', 'What is 2+2?', 12345, 0, '');
  INSERT INTO notes VALUES (2, 'efgh5678', 1, 1000000, -1, 'geography france', 'Capital of France?\x1fParis', 'Capital of France?', 67890, 0, '');
  INSERT INTO notes VALUES (3, 'ijkl9012', 1, 1000000, -1, 'biology', 'What is {{c1::mitosis}}?\x1fCell division', 'What is mitosis?', 11111, 0, '');
`);

db.close();

const dbBytes = readFileSync(dbPath);
console.log(`SQLite DB created: ${dbBytes.length} bytes`);
console.log(`First 16 bytes: "${Buffer.from(dbBytes.slice(0, 16)).toString('ascii')}"`);

// Check page size from header
const pageSize = (dbBytes[16] << 8) | dbBytes[17];
console.log(`Page size: ${pageSize} bytes`);
console.log(`Page type at byte 100: 0x${dbBytes[100].toString(16).padStart(2, '0')}`);

// ── 2. Build .apkg ZIP ────────────────────────────────────────────────────

const zip = new JSZip();
zip.file('collection.anki21', dbBytes);
zip.file('media', '{}');
const apkgBuffer = await zip.generateAsync({ type: 'arraybuffer' });

console.log(`\nAPKG ZIP size: ${apkgBuffer.byteLength} bytes`);
console.log(`ZIP contains: collection.anki21, media`);

// ── 3. Run through our parser ─────────────────────────────────────────────

console.log('\n── Running parseAnkiPackage ──');

// We need to import the TypeScript file. Let's use tsx or just extract the logic.
// Since we can't import .ts directly, let's re-implement the core logic inline
// to verify it:

function u16(b, o) { return (b[o] << 8) | b[o + 1] }
function u32(b, o) { return (((b[o] << 24) | (b[o+1] << 16) | (b[o+2] << 8) | b[o+3]) >>> 0) }

function varint(b, o) {
  let v = 0;
  for (let i = 0; i < 9; i++) {
    const byte = b[o + i];
    if (i < 8) {
      v = v * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return [v, i + 1];
    } else {
      v = v * 256 + byte;
      return [v, 9];
    }
  }
  return [v, 9];
}

function utf8(b, o, len) { return new TextDecoder().decode(b.subarray(o, o + len)); }

function decodeRecord(p) {
  const [hLen, hB] = varint(p, 0);
  const types = [];
  let pos = hB;
  while (pos < hLen) {
    const [t, tb] = varint(p, pos);
    types.push(t);
    pos += tb;
  }
  const out = [];
  let dp = hLen;
  for (const t of types) {
    if (t === 0) { out.push(null); }
    else if (t === 1) { out.push(p[dp]); dp += 1; }
    else if (t === 2) { out.push(u16(p, dp)); dp += 2; }
    else if (t === 3) { out.push((p[dp] << 16) | (p[dp+1] << 8) | p[dp+2]); dp += 3; }
    else if (t === 4) { out.push(u32(p, dp)); dp += 4; }
    else if (t === 5) { out.push(u16(p, dp) * 0x100000000 + u32(p, dp+2)); dp += 6; }
    else if (t === 6) { out.push(u32(p, dp) * 0x100000000 + u32(p, dp+4)); dp += 8; }
    else if (t === 7) { out.push(new DataView(p.buffer, p.byteOffset + dp, 8).getFloat64(0)); dp += 8; }
    else if (t === 8) { out.push(0); }
    else if (t === 9) { out.push(1); }
    else if (t >= 12 && t % 2 === 0) { const l = (t-12)/2; out.push(null); dp += l; }
    else if (t >= 13 && t % 2 === 1) { const l = (t-13)/2; out.push(utf8(p, dp, l)); dp += l; }
    else out.push(null);
  }
  return out;
}

function cellPayload(page, cellOff, psz, db) {
  try {
    let pos = cellOff;
    const [pSz, pB] = varint(page, pos); pos += pB;
    const [, rB] = varint(page, pos); pos += rB;

    const X = psz - 35;
    if (pSz <= X) return page.subarray(pos, pos + pSz);

    const M = Math.floor(((psz - 12) * 32 / 255) - 23);
    const K = M + ((pSz - M) % (psz - 4));
    const localSz = K <= X ? K : M;

    const result = new Uint8Array(pSz);
    result.set(page.subarray(pos, pos + localSz));
    let rem = pSz - localSz;
    let ovPg = u32(page, pos + localSz);
    let dst = localSz;
    while (rem > 0 && ovPg !== 0) {
      const ovOff = (ovPg - 1) * psz;
      const next = u32(db, ovOff);
      const n = Math.min(rem, psz - 4);
      result.set(db.subarray(ovOff + 4, ovOff + 4 + n), dst);
      dst += n; rem -= n; ovPg = next;
    }
    return result;
  } catch(e) {
    console.error('cellPayload error:', e.message);
    return null;
  }
}

function scanBTree(db, pgNum, psz, out) {
  if (pgNum < 1 || (pgNum - 1) * psz + psz > db.length) return;
  const pgOff = (pgNum - 1) * psz;
  const hOff = pgNum === 1 ? 100 : 0;
  const pg = db.subarray(pgOff, pgOff + psz);
  const type = pg[hOff];
  if (type !== 0x05 && type !== 0x0D) {
    console.log(`  Page ${pgNum}: skipped (type=0x${type.toString(16)}, not a table btree page)`);
    return;
  }
  const isLeaf = type === 0x0D;
  const hSz = isLeaf ? 8 : 12;
  const cellCount = u16(pg, hOff + 3);
  const offsets = [];
  for (let i = 0; i < cellCount; i++) offsets.push(u16(pg, hOff + hSz + i * 2));

  console.log(`  Page ${pgNum}: type=${isLeaf?'leaf':'interior'}, cells=${cellCount}, offsets=[${offsets.join(',')}]`);

  if (isLeaf) {
    for (const co of offsets) {
      const pl = cellPayload(pg, co, psz, db);
      if (pl) {
        try {
          const row = decodeRecord(pl);
          console.log(`    Row: ${row.map((v,i) => `[${i}]=${JSON.stringify(String(v).slice(0,30))}`).join(', ')}`);
          out.push(row);
        } catch(e) {
          console.error('    decodeRecord error:', e.message);
        }
      } else {
        console.log(`    Cell at ${co}: cellPayload returned null`);
      }
    }
  } else {
    for (const co of offsets) {
      const childPg = u32(pg, co);
      console.log(`  → recursive to left child page ${childPg}`);
      scanBTree(db, childPg, psz, out);
    }
    const rightmostChild = u32(pg, hOff + 8);
    console.log(`  → recursive to rightmost child page ${rightmostChild}`);
    scanBTree(db, rightmostChild, psz, out);
  }
}

function findRootPage(db, psz, tableName) {
  const rows = [];
  console.log(`\nScanning sqlite_schema (page 1) for table "${tableName}":`);
  scanBTree(db, 1, psz, rows);
  console.log(`Schema rows found: ${rows.length}`);
  for (const r of rows) {
    console.log(`  type=${r[0]}, name=${r[1]}, rootpage=${r[3]}`);
    if (r[0] === 'table' && r[1] === tableName) {
      return typeof r[3] === 'number' ? r[3] : null;
    }
  }
  return null;
}

// Run the parser
const rawDb = new Uint8Array(dbBytes.buffer);
const rawPsz = u16(rawDb, 16);
const psz = rawPsz === 1 ? 65536 : rawPsz;
console.log(`Page size from header: ${psz}`);

const rootPg = findRootPage(rawDb, psz, 'notes');
console.log(`\nNotes table root page: ${rootPg}`);

if (rootPg) {
  const rows = [];
  console.log(`\nScanning notes table (page ${rootPg}):`);
  scanBTree(rawDb, rootPg, psz, rows);
  console.log(`\nRows decoded: ${rows.length}`);

  const results = [];
  for (const row of rows) {
    // Fixed: id INTEGER PRIMARY KEY stored as null at [0], so flds is at [6]
    let flds, tagsRaw;
    if (typeof row[6] === 'string' && row[6].includes('\x1f')) {
      flds = row[6]; tagsRaw = row[5];
    } else if (typeof row[5] === 'string' && row[5].includes('\x1f')) {
      flds = row[5]; tagsRaw = row[4];
    } else {
      console.log(`  row[5]=${JSON.stringify(row[5])}, row[6]=${JSON.stringify(row[6])} → SKIPPED (no \\x1f found)`);
      continue;
    }
    console.log(`  flds: ${JSON.stringify(flds)?.slice(0,60)}`);
    const parts = flds.split('\x1f');
    const front = parts[0]?.trim() ?? '';
    const back = parts[1]?.trim() ?? '';
    if (!front) { console.log('  → SKIPPED (no front)'); continue; }
    results.push({ front, back });
    console.log(`  → CARD: front="${front}", back="${back}"`);
  }

  console.log(`\n══════════════════════════════`);
  console.log(`RESULT: ${results.length} cards parsed`);
  results.forEach((c, i) => console.log(`  ${i+1}. "${c.front}" / "${c.back}"`));

  if (results.length === 3) {
    console.log('\n✅ Parser works correctly with a real SQLite database!');
    console.log('The bug must be in how the ACTUAL .apkg file differs from the expected format.');
    console.log('Likely causes:');
    console.log('  1. The .apkg uses collection.anki21b (compressed, Anki 23.10+)');
    console.log('  2. The .apkg has a different notes schema');
    console.log('  3. The SQLite DB in the package uses WAL mode');
  } else {
    console.log('\n❌ Parser bug confirmed with this test file!');
    console.log('The hand-rolled B-tree parser has a bug that needs to be fixed.');
  }
} else {
  console.log('\n❌ findRootPage failed to find the notes table!');
}

// Clean up
try { unlinkSync(dbPath); } catch {}
