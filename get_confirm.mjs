import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
mkdirSync('C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();

// Visit 1secmail with the inbox pre-selected
await page.goto('https://www.1secmail.com/?login=nemosclaudetest&domain=1secmail.com', { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\1sec_inbox.png' });

// Check for email list
const bodyText = await page.textContent('body');
console.log('Body (first 1000):', bodyText.slice(0, 1000));

// Try to find emails
const emailRows = page.locator('#messageList tr, .mail-entry, [class*="message"]');
console.log('Email rows found:', await emailRows.count());

// Try clicking on the first email if any
if (await emailRows.count() > 0) {
  await emailRows.first().click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'C:\\Users\\arshn\\AppData\\Local\\Temp\\verify_shots\\1sec_email.png' });
  const emailContent = await page.textContent('body');
  console.log('Email content (first 2000):', emailContent.slice(0, 2000));

  // Find confirm link
  const links = await page.locator('a[href*="confirm"], a[href*="supabase"], a[href*="token"], a[href*="verify"]').all();
  for (const link of links) {
    const href = await link.getAttribute('href');
    if (href) console.log('CONFIRM LINK:', href);
  }
} else {
  console.log('No emails found yet. Trying to refresh...');
  await page.click('#refresh, button[id*="refresh"], a[id*="refresh"]').catch(() => {});
  await page.waitForTimeout(3000);
  const afterRefresh = await page.textContent('#messageList, body');
  console.log('After refresh:', afterRefresh?.slice(0, 500));
}

await browser.close();
