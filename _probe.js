const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const seed = fs.readFileSync(path.join(__dirname, '_seed.js'), 'utf8')
const BASE = 'http://localhost:3311'
;(async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ content: seed })
  const seededRes = await page.evaluate(() => window.__seedNemos())
  console.log('seeded:', JSON.stringify(seededRes))
  // dashboard first (matches shoot.js order that works), THEN library
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.goto(BASE + '/library', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const mainText = await page.evaluate(() => document.querySelector('main')?.textContent?.slice(0, 200))
  console.log('main text:', mainText)
  // Try to drill into the folder by clicking the folder card
  const clicked = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('main [class*="card-surface"]')]
    const folder = cards.find((c) => c.textContent.includes('cards'))
    if (folder) { folder.click(); return true }
    return false
  })
  console.log('folder clicked via DOM:', clicked)
  await page.waitForTimeout(1200)
  await page.mouse.move(20, 500)
  await page.waitForTimeout(300)
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('main [class*="card-surface"]')]
    const deckCard = cards.find((c) => c.textContent.includes('Neuroanatomy') || c.textContent.includes('Pharmacology'))
    if (!deckCard) return { found: false, cardTexts: cards.map((c) => c.textContent.slice(0, 30)) }
    const cb = deckCard.querySelector('input[type=checkbox]')
    const grip = deckCard.querySelector('[aria-label="Drag to move deck"]')
    const menu = deckCard.querySelector('[aria-label="More options"]')
    const op = (el) => el ? getComputedStyle(el).opacity : 'none'
    return {
      found: true,
      checkboxOpacity: op(cb),
      menuWrapperOpacity: menu ? getComputedStyle(menu.parentElement).opacity : 'none',
      gripOpacity: op(grip),
    }
  })
  console.log('info:', JSON.stringify(info, null, 2))
  await browser.close()
})()
