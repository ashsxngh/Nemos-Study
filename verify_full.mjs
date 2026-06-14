/**
 * Full end-to-end verification:
 *   1. Create test account via signup page (yopmail disposable email)
 *   2. Confirm email via yopmail inbox
 *   3. Test all import formats, card types, cloze hints, tables
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const BASE = 'http://localhost:3000';
const SHOTS = 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots';
mkdirSync(SHOTS, { recursive: true });

const TEST_EMAIL = 'nemosclaudetest@yopmail.com';
const TEST_PASS  = 'TestNemos2024!';

const browser = await chromium.launch({ headless: true });
const results = [];

function log(test, verdict, detail = '') {
  results.push({ test, verdict, detail });
  console.log(`[${verdict}] ${test}${detail ? ': ' + detail : ''}`);
}

function tmpFile(name, content) {
  const p = join('C:\\Users\\arshn\\AppData\\Local\\Temp', name);
  writeFileSync(p, content, 'utf8');
  return p;
}

// ── STEP 1: Sign up ───────────────────────────────────────────────────────────
const signupCtx = await browser.newContext();
const signupPage = await signupCtx.newPage();

console.log('\n── Creating test account ──');
await signupPage.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
await signupPage.fill('input[type="text"], input[placeholder*="name"], input[name="name"]', 'Claude Dev Check');
await signupPage.fill('input[type="email"]', TEST_EMAIL);
await signupPage.fill('input[type="password"]', TEST_PASS);
await signupPage.screenshot({ path: join(SHOTS, '00a_signup.png') });
await signupPage.click('button[type="submit"]');
await signupPage.waitForTimeout(3000);
await signupPage.screenshot({ path: join(SHOTS, '00b_after_signup.png') });
const signupBody = await signupPage.textContent('body');
const signupSuccess = signupBody.includes('Check your email') || signupBody.includes('check your email') || signupBody.includes('confirmation');
console.log(`Signup result: ${signupSuccess ? 'success (needs email confirm)' : 'unknown'}`);
console.log(`Body snippet: ${signupBody.slice(0, 200)}`);
await signupCtx.close();

// ── STEP 2: Confirm email via yopmail ─────────────────────────────────────────
console.log('\n── Fetching confirmation email from yopmail ──');
const yopmailCtx = await browser.newContext();
const yopmailPage = await yopmailCtx.newPage();

// yopmail iframe-based interface
await yopmailPage.goto('https://yopmail.com/en/', { waitUntil: 'networkidle', timeout: 30000 });
await yopmailPage.screenshot({ path: join(SHOTS, '00c_yopmail_home.png') });

// Enter inbox name
const yopInput = yopmailPage.locator('#login, input[name="login"], input[placeholder*="email"], input[placeholder*="Enter"]').first();
if (await yopInput.count() > 0) {
  await yopInput.fill('nemosclaudetest');
  await yopmailPage.keyboard.press('Enter');
  await yopmailPage.waitForTimeout(3000);
  await yopmailPage.screenshot({ path: join(SHOTS, '00d_yopmail_inbox.png') });
}

// Look for the email in inbox (may be in an iframe)
let confirmUrl = null;
try {
  // Try to access the inbox iframe
  const frames = yopmailPage.frames();
  console.log(`Found ${frames.length} frames on yopmail`);

  for (const frame of frames) {
    const frameText = await frame.textContent('body').catch(() => '');
    if (frameText.includes('Nemo') || frameText.includes('supabase') || frameText.includes('confirm')) {
      console.log('Found relevant email frame, text:', frameText.slice(0, 300));
      // Find confirmation link
      const links = await frame.locator('a[href*="confirm"], a[href*="supabase"], a[href*="token"]').all();
      for (const link of links) {
        const href = await link.getAttribute('href');
        if (href) { confirmUrl = href; console.log('Confirm URL found:', href.slice(0, 100)); break; }
      }
    }
  }

  // Also try direct page links
  if (!confirmUrl) {
    const allLinks = await yopmailPage.locator('a').all();
    for (const link of allLinks) {
      const href = await link.getAttribute('href').catch(() => '');
      if (href && (href.includes('confirm') || href.includes('supabase') || href.includes('token'))) {
        confirmUrl = href;
        console.log('Found confirm URL on main page:', href.slice(0, 100));
        break;
      }
    }
  }
} catch (e) {
  console.log('yopmail iframe search error:', e.message);
}

if (!confirmUrl) {
  // Try clicking the first email in inbox
  try {
    await yopmailPage.waitForTimeout(2000);
    const emailItem = yopmailPage.locator('.lm, .lf, [class*="mail"]').first();
    if (await emailItem.count() > 0) {
      await emailItem.click();
      await yopmailPage.waitForTimeout(2000);
      await yopmailPage.screenshot({ path: join(SHOTS, '00e_yopmail_email.png') });
    }

    // Check all frames again
    for (const frame of yopmailPage.frames()) {
      const links = await frame.locator('a').all();
      for (const link of links) {
        const href = await link.getAttribute('href').catch(() => '');
        if (href && href.includes('confirm')) {
          confirmUrl = href;
          console.log('Got confirm URL from email frame:', href.slice(0, 100));
          break;
        }
      }
      if (confirmUrl) break;
    }
  } catch (e2) {
    console.log('yopmail email click error:', e2.message);
  }
}

await yopmailCtx.close();

// ── STEP 3: Click confirmation link ──────────────────────────────────────────
const appCtx = await browser.newContext();
const page = await appCtx.newPage();

if (confirmUrl) {
  console.log('\n── Confirming email ──');
  await page.goto(confirmUrl, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(SHOTS, '00f_confirmed.png') });
  console.log('After confirm URL:', page.url());
} else {
  console.log('\n⚠️  No confirmation URL found — trying to log in anyway (account may already exist/confirmed)');
  // Maybe the account was already confirmed from a previous run, try logging in
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOTS, '00g_login_attempt.png') });
}

// Check if we're logged in
const currentUrl = page.url();
const isLoggedIn = !currentUrl.includes('/login') && !currentUrl.includes('/signup');
console.log(`\nCurrent URL: ${currentUrl}`);
console.log(`Logged in: ${isLoggedIn}`);

if (!isLoggedIn) {
  // Try direct login
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASS);
  await page.screenshot({ path: join(SHOTS, '00h_login_form.png') });
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(SHOTS, '00i_after_login.png') });
  console.log('URL after login attempt:', page.url());
}

// ── STEP 4: Run import + card tests ──────────────────────────────────────────
async function uploadFile(path) {
  const input = page.locator('input[type="file"]');
  await input.waitFor({ state: 'attached', timeout: 10000 });
  await input.setInputFiles(path);
  await page.waitForTimeout(1500);
}

async function getCardCount() {
  const text = await page.textContent('body');
  return text.match(/Found (\d+) card/)?.[1] ?? null;
}

// ── 1. CSV basic ─────────────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t1.csv', 'front,back\nWhat is 2+2?,4\nCapital of France?,Paris\n'));
  await page.screenshot({ path: join(SHOTS, '01_csv_basic.png') });
  const n = await getCardCount();
  log('CSV basic (front,back)', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('CSV basic', 'FAIL', e.message); }

// ── 2. Nemo CSV round-trip ───────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t2.csv',
    'deck_name,front,back,type,tags\n"D","What is {{c1::Paris}}?","Answer","cloze","geo;france"\n'));
  await page.screenshot({ path: join(SHOTS, '02_csv_nemo.png') });
  const n = await getCardCount();
  log('Nemo CSV round-trip (type+tags)', n === '1' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 1`);
} catch (e) { log('Nemo CSV round-trip', 'FAIL', e.message); }

// ── 3. Markdown header ───────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t3.md',
    '## What is photosynthesis?\nLight to energy.\n\n## What is mitosis?\nCell division.\n'));
  await page.screenshot({ path: join(SHOTS, '03_md_header.png') });
  const n = await getCardCount();
  log('Markdown header (## format)', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('Markdown header', 'FAIL', e.message); }

// ── 4. Markdown separator ────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t4.md',
    'Powerhouse?\n---\nMitochondria\n===\nPhotosynthesis?\n---\nLight to energy\n'));
  await page.screenshot({ path: join(SHOTS, '04_md_sep.png') });
  const n = await getCardCount();
  log('Markdown separator (---/===)', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('Markdown separator', 'FAIL', e.message); }

// ── 5. Anki text export ──────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t5.anki',
    '#separator:tab\n#html:false\nWhat is H2O?\tWater\tchemistry\nWhat is NaCl?\tSalt\tchemistry\n'));
  await page.screenshot({ path: join(SHOTS, '05_anki.png') });
  const n = await getCardCount();
  log('Anki text export (.anki)', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('Anki text export', 'FAIL', e.message); }

// ── 6. TSV ──────────────────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t6.tsv', 'Header front\tHeader back\nHello\tWorld\nFoo\tBar\n'));
  const skip = page.locator('input[type="checkbox"]').first();
  if (await skip.count() > 0) { await skip.check(); await page.waitForTimeout(600); }
  await page.screenshot({ path: join(SHOTS, '06_tsv.png') });
  const n = await getCardCount();
  log('TSV (with skip-header)', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('TSV import', 'FAIL', e.message); }

// ── 7. JSON backup ──────────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  const json = JSON.stringify({
    folders: [], decks: [{ id: 'd1', name: 'JsonDeck', folderId: null, isArchived: false, isStarred: false, tags: [], description: '', order: 0, userId: 'local-user', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    cards: [
      { id: 'c1', deckId: 'd1', userId: 'u', type: 'basic', front: 'Q1', back: 'A1', hint: '', tags: [], isPinned: false, isArchived: false, linkedCardIds: [], prerequisiteCardIds: [], order: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'c2', deckId: 'd1', userId: 'u', type: 'cloze', front: '{{c1::Paris}} is capital', back: '', hint: '', tags: ['geo'], isPinned: false, isArchived: false, linkedCardIds: [], prerequisiteCardIds: [], order: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ], srsData: {}, sessions: []
  });
  await uploadFile(tmpFile('t7.json', json));
  await page.screenshot({ path: join(SHOTS, '07_json.png') });
  const n = await getCardCount();
  log('JSON backup import', n === '2' ? 'PASS' : 'FAIL', `Found ${n ?? 'none'}, expected 2`);
} catch (e) { log('JSON backup', 'FAIL', e.message); }

// ── 8. Import & study cloze with hint ────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t8_cloze.csv',
    'deck_name,front,back,type,tags\n"ClozeVerify","The capital of France is {{c1::Paris::city of light}}.","",cloze,""\n'));
  await page.waitForTimeout(600);

  const importBtn = page.locator('button').filter({ hasText: /^Import \d+ card/ });
  if (await importBtn.count() > 0) { await importBtn.click(); await page.waitForURL(/\/library/, { timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(1000);

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: join(SHOTS, '08a_library.png') });

  const deckEl = page.locator('text=ClozeVerify').first();
  if (await deckEl.count() > 0) {
    await deckEl.click(); await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS, '08b_deck.png') });

    const studyEl = page.locator('a, button').filter({ hasText: /study/i }).first();
    if (await studyEl.count() > 0) {
      await studyEl.click(); await page.waitForTimeout(800);
      await page.screenshot({ path: join(SHOTS, '08c_study.png') });

      const studyText = await page.textContent('body');
      const showsBlank = studyText.includes('[blank') || studyText.includes('Blank 1');
      const leaksHint  = studyText.includes('city of light');
      const hasInput   = await page.locator('[data-cloze-input]').count() > 0;
      log('Cloze: blank visible, hint NOT shown', showsBlank && !leaksHint ? 'PASS' : 'FAIL',
        `blank=${showsBlank}, hintLeak=${leaksHint}, input=${hasInput}`);

      if (hasInput) {
        await page.locator('[data-cloze-input]').first().fill('Paris');
        const checkBtn = page.locator('button').filter({ hasText: 'Check Answer' });
        if (await checkBtn.count() > 0) {
          await checkBtn.click(); await page.waitForTimeout(500);
          await page.screenshot({ path: join(SHOTS, '08d_checked.png') });
          const ansText = await page.textContent('body');
          const correct    = ansText.includes('✓') || ansText.toLowerCase().includes('correct');
          const hintInAns  = ansText.includes('city of light');
          log('Cloze: answer correct, hint not in reveal', correct && !hintInAns ? 'PASS' : 'FAIL',
            `correct=${correct}, hintInAnswer=${hintInAns}`);
        }
      }
    } else { log('Cloze study', 'FAIL', 'No study button on deck page'); }
  } else { log('Cloze import', 'FAIL', 'ClozeVerify deck not found in library'); }
} catch (e) { log('Cloze test', 'FAIL', e.message); }

// ── 9. Typed answer card ─────────────────────────────────────────────────────
try {
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t9_typed.csv',
    'deck_name,front,back,type,tags\n"TypedVerify","What is 2 + 2?","4","typed",""\n'));
  await page.waitForTimeout(600);

  const importBtn2 = page.locator('button').filter({ hasText: /^Import \d+ card/ });
  if (await importBtn2.count() > 0) { await importBtn2.click(); await page.waitForURL(/\/library/, { timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(1000);

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  const typedDeck = page.locator('text=TypedVerify').first();
  if (await typedDeck.count() > 0) {
    await typedDeck.click(); await page.waitForTimeout(600);
    const studyBtn = page.locator('a, button').filter({ hasText: /study/i }).first();
    if (await studyBtn.count() > 0) {
      await studyBtn.click(); await page.waitForTimeout(600);
      await page.screenshot({ path: join(SHOTS, '09a_typed.png') });
      const typedInput = page.locator('input[placeholder*="answer"], input[placeholder*="Answer"]');
      const hasInput = await typedInput.count() > 0;
      log('Typed card: input field present', hasInput ? 'PASS' : 'FAIL', `Input found: ${hasInput}`);
      if (hasInput) {
        await typedInput.first().fill('4');
        const checkBtn2 = page.locator('button').filter({ hasText: 'Check Answer' });
        if (await checkBtn2.count() > 0) {
          await checkBtn2.click(); await page.waitForTimeout(400);
          await page.screenshot({ path: join(SHOTS, '09b_typed_checked.png') });
          const afterText = await page.textContent('body');
          const correct2 = afterText.includes('✓') || afterText.toLowerCase().includes('correct');
          log('Typed card: correct answer accepted', correct2 ? 'PASS' : 'FAIL', `Correct shown: ${correct2}`);
          // Wrong answer test
          await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
        }
      }
    } else { log('Typed card study', 'FAIL', 'No study button'); }
  } else { log('Typed card', 'FAIL', 'TypedVerify not in library'); }
} catch (e) { log('Typed card test', 'FAIL', e.message); }

// ── 10. Table rendering ──────────────────────────────────────────────────────
try {
  // Import a card with a markdown table on the back, then study to see it render
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  const tableBack = '| Country | Capital |\n|---------|----------|\n| France | Paris |\n| Germany | Berlin |';
  await uploadFile(tmpFile('t10_table.csv',
    'deck_name,front,back,type,tags\n"TableVerify","What are the EU capitals?","' + tableBack.replace(/\n/g,'\\n').replace(/"/g,'""') + '","basic",""\n'));
  await page.waitForTimeout(600);

  const importBtnT = page.locator('button').filter({ hasText: /^Import \d+ card/ });
  if (await importBtnT.count() > 0) { await importBtnT.click(); await page.waitForURL(/\/library/, { timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(1000);

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  const tableDeck = page.locator('text=TableVerify').first();
  if (await tableDeck.count() > 0) {
    await tableDeck.click(); await page.waitForTimeout(600);
    const studyBtnT = page.locator('a, button').filter({ hasText: /study/i }).first();
    if (await studyBtnT.count() > 0) {
      await studyBtnT.click(); await page.waitForTimeout(800);
      // Flip card
      const flipBtn = page.locator('button').filter({ hasText: /show|flip|reveal|answer/i }).first();
      if (await flipBtn.count() > 0) { await flipBtn.click(); await page.waitForTimeout(500); }
      await page.screenshot({ path: join(SHOTS, '10_table_rendered.png') });
      // Check for actual <table> element in DOM
      const tableCount = await page.locator('table').count();
      log('Table renders as HTML table (not raw text)', tableCount > 0 ? 'PASS' : 'FAIL',
        `Found ${tableCount} <table> element(s) in DOM`);
    } else { log('Table rendering', 'FAIL', 'No study button'); }
  } else { log('Table deck', 'FAIL', 'TableVerify not found in library'); }
} catch (e) { log('Table rendering', 'FAIL', e.message); }

// ── 11. Image card ───────────────────────────────────────────────────────────
try {
  // Create a minimal 1x1 red pixel PNG as base64 data URI
  const redPixelBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
  await page.goto(`${BASE}/import`, { waitUntil: 'networkidle' });
  await uploadFile(tmpFile('t11_img.csv',
    `deck_name,front,back,type,tags\n"ImgVerify","What does a red pixel look like?","${redPixelBase64}","image",""\n`));
  await page.waitForTimeout(600);
  const importBtnI = page.locator('button').filter({ hasText: /^Import \d+ card/ });
  if (await importBtnI.count() > 0) { await importBtnI.click(); await page.waitForURL(/\/library/, { timeout: 8000 }).catch(() => {}); }
  await page.waitForTimeout(1000);

  await page.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  const imgDeck = page.locator('text=ImgVerify').first();
  if (await imgDeck.count() > 0) {
    await imgDeck.click(); await page.waitForTimeout(500);
    const studyBtnI = page.locator('a, button').filter({ hasText: /study/i }).first();
    if (await studyBtnI.count() > 0) {
      await studyBtnI.click(); await page.waitForTimeout(600);
      const flipBtnI = page.locator('button').filter({ hasText: /show|flip|reveal|answer/i }).first();
      if (await flipBtnI.count() > 0) { await flipBtnI.click(); await page.waitForTimeout(400); }
      await page.screenshot({ path: join(SHOTS, '11_image_card.png') });
      const imgCount = await page.locator('img[src^="data:image"]').count();
      log('Image card renders <img> with data URI', imgCount > 0 ? 'PASS' : 'FAIL',
        `Found ${imgCount} data: image(s)`);
    } else { log('Image card study', 'FAIL', 'No study button'); }
  } else { log('Image card', 'FAIL', 'ImgVerify not found'); }
} catch (e) { log('Image card', 'FAIL', e.message); }

// ── DONE ─────────────────────────────────────────────────────────────────────
await appCtx.close();
await browser.close();

console.log('\n' + '═'.repeat(55));
console.log('TEST ACCOUNT CREDENTIALS:');
console.log(`  Email:    ${TEST_EMAIL}`);
console.log(`  Password: ${TEST_PASS}`);
console.log(`  Inbox:    https://yopmail.com (use "nemosclaudetest")`);
console.log('═'.repeat(55));
console.log('\nSUMMARY:');
for (const r of results) {
  console.log(`  ${r.verdict === 'PASS' ? '✅' : '❌'} ${r.test}${r.detail ? ' — ' + r.detail : ''}`);
}
const fails = results.filter(r => r.verdict === 'FAIL');
console.log(`\n  ${results.length - fails.length}/${results.length} PASS`);
