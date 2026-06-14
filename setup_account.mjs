/**
 * Creates a test account by:
 * 1. Getting a Guerrilla Mail address
 * 2. Signing up with it via Supabase REST API
 * 3. Clicking the confirmation email
 * 4. Returning session cookies for use in tests
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
mkdirSync('C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots', { recursive: true });

const SUPABASE_URL = 'https://hmqfbfquunoenzrrltya.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhtcWZiZnF1dW5vZW56cnJsdHlhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyMTI3NTgsImV4cCI6MjA5NTc4ODc1OH0.jYJVObllFGXrAVYuI3Oz8BGIXCDJONMTJ6mW01FoZGM';
const PASS = 'TestNemos2024!';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// ── 1. Get a Guerrilla Mail address ──────────────────────────────────────────
console.log('Getting Guerrilla Mail address...');
await page.goto('https://www.guerrillamail.com/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\gm_home.png' });

// Try to get the generated email address
let gmEmail = null;
try {
  gmEmail = await page.locator('#email-widget .email-widget--header, #email-display, .email-widget--header, [data-email], #inbox-id').first().textContent({ timeout: 5000 });
  gmEmail = gmEmail?.trim();
} catch {}

if (!gmEmail) {
  // Try spans near "Your Guerrilla Mail address is"
  const allText = await page.textContent('body');
  const match = allText.match(/([a-z0-9._+-]+@guerrillamailblock\.com|[a-z0-9._+-]+@guerrillamail\.(com|net|org|info|de|biz))/i);
  if (match) gmEmail = match[1];
}

if (!gmEmail) {
  // Try the Guerrilla Mail API
  const apiResp = await page.evaluate(async (url) => {
    const r = await fetch(url);
    const d = await r.json();
    return d;
  }, 'https://api.guerrillamail.com/ajax.php?f=get_email_address');
  console.log('GM API response:', JSON.stringify(apiResp));
  gmEmail = apiResp?.email_addr;
}

console.log('Guerrilla Mail address:', gmEmail);
if (!gmEmail) {
  // Fallback: use a known working temp email format
  // Try mailnesia.com instead
  gmEmail = `nemostest${Date.now()}@mailnesia.com`;
  console.log('Using mailnesia fallback:', gmEmail);
}

// ── 2. Sign up via Supabase REST API ─────────────────────────────────────────
console.log(`Signing up with ${gmEmail}...`);
const signupResp = await page.evaluate(async ({ url, key, email, password }) => {
  const r = await fetch(`${url}/auth/v1/signup`, {
    method: 'POST',
    headers: { 'apikey': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return await r.json();
}, { url: SUPABASE_URL, key: ANON_KEY, email: gmEmail, password: PASS });

console.log('Signup result:', JSON.stringify(signupResp).slice(0, 300));

// ── 3. Wait for and read the confirmation email ───────────────────────────────
let confirmLink = null;

if (gmEmail.includes('guerrillamail') || gmEmail.includes('guerrillamailblock')) {
  console.log('Checking Guerrilla Mail inbox...');
  await page.waitForTimeout(8000); // wait for email

  // Check inbox via Guerrilla Mail API
  for (let attempt = 0; attempt < 6; attempt++) {
    const checkResp = await page.evaluate(async () => {
      const r = await fetch('https://api.guerrillamail.com/ajax.php?f=check_email&seq=0');
      return await r.json();
    });
    console.log(`Attempt ${attempt+1}: ${checkResp?.count ?? 0} emails`);
    if (checkResp?.list?.length > 0) {
      const emailId = checkResp.list[0].mail_id;
      const emailResp = await page.evaluate(async (id) => {
        const r = await fetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${id}`);
        return await r.json();
      }, emailId);
      const emailBody = emailResp?.mail_body ?? '';
      console.log('Email body snippet:', emailBody.slice(0, 500));
      const linkMatch = emailBody.match(/href=["']([^"']*(?:confirm|verify|token)[^"']*)['"]/i)
        || emailBody.match(/(https:\/\/[^\s"'<>]+(?:confirm|verify|token)[^\s"'<>]+)/i);
      if (linkMatch) { confirmLink = linkMatch[1].replace(/&amp;/g, '&'); break; }
    }
    await page.waitForTimeout(5000);
  }
} else if (gmEmail.includes('mailnesia')) {
  // Mailnesia: check via web scraping
  console.log('Checking Mailnesia inbox...');
  const username = gmEmail.split('@')[0];
  await page.waitForTimeout(8000);

  for (let attempt = 0; attempt < 6; attempt++) {
    const mailnesia = await (await browser.newContext()).newPage();
    await mailnesia.goto(`https://mailnesia.com/mailbox/${username}`, { waitUntil: 'networkidle', timeout: 15000 });
    await mailnesia.screenshot({ path: `C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\mailnesia_${attempt}.png` });

    const rows = mailnesia.locator('table.email tbody tr');
    const count = await rows.count();
    console.log(`Attempt ${attempt+1}: ${count} emails in mailnesia`);

    if (count > 0) {
      await rows.first().click();
      await mailnesia.waitForTimeout(2000);
      await mailnesia.screenshot({ path: `C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\mailnesia_email.png` });

      const emailHtml = await mailnesia.content();
      const linkMatch = emailHtml.match(/href=["']([^"']*(?:confirm|verify|token)[^"']*)['"]/i)
        || emailHtml.match(/(https:\/\/[^\s"'<>]+(?:confirm|verify|token)[^\s"'<>]+)/i);
      if (linkMatch) {
        confirmLink = linkMatch[1].replace(/&amp;/g, '&');
        console.log('Found link:', confirmLink.slice(0, 100));
        await mailnesia.close();
        break;
      }
    }
    await mailnesia.close();
    await page.waitForTimeout(5000);
  }
}

console.log('\nConfirmation link:', confirmLink ? confirmLink.slice(0, 120) : 'NOT FOUND');

// ── 4. Follow the confirmation link ──────────────────────────────────────────
if (confirmLink) {
  console.log('\nFollowing confirmation link...');
  await page.goto(confirmLink, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);
  console.log('URL after confirm:', page.url());
  await page.screenshot({ path: 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\after_confirm.png' });

  // Check if we're logged in
  if (!page.url().includes('/login') && !page.url().includes('/signup')) {
    console.log('✅ Logged in successfully!');
  } else {
    console.log('Still on auth page, trying manual login...');
    await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
    await page.fill('input[type="email"]', gmEmail);
    await page.fill('input[type="password"]', PASS);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(3000);
    console.log('URL after login:', page.url());
  }
} else {
  // Try direct login anyway (maybe already confirmed)
  console.log('\nNo confirm link found. Trying direct login...');
  await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
  await page.fill('input[type="email"]', gmEmail);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\login_attempt.png' });
  console.log('URL after login:', page.url());
}

// ── 5. Save session state ────────────────────────────────────────────────────
const finalUrl = page.url();
const isLoggedIn = !finalUrl.includes('/login') && !finalUrl.includes('/signup');
console.log(`\nLogged in: ${isLoggedIn}`);

if (isLoggedIn) {
  const cookies = await ctx.cookies();
  const storageState = await ctx.storageState();
  writeFileSync('C:\\Users\\arshn\\AppData\\Local\\Temp\\nemos_session.json', JSON.stringify(storageState, null, 2));
  console.log('Session saved to C:\\Users\\arshn\\AppData\\Local\\Temp\\nemos_session.json');
}

await browser.close();

console.log('\n═══════════════════════════════════');
console.log('TEST ACCOUNT CREDENTIALS:');
console.log(`  Email:    ${gmEmail}`);
console.log(`  Password: ${PASS}`);
console.log('═══════════════════════════════════');
