const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const BASE = process.env.BASE || 'http://localhost:3311'
const OUT = process.env.OUT || 'shots'
const seed = fs.readFileSync(path.join(__dirname, '_seed.js'), 'utf8')

const SCREENS = [
  { name: 'dashboard', path: '/' },
  { name: 'library', path: '/library' },
  { name: 'notes', path: '/notes' },
  { name: 'stats', path: '/stats' },
  { name: 'planner', path: '/planner' },
  { name: 'trash', path: '/trash' },
  { name: 'login', path: '/login' },
  { name: 'settings', path: '/settings' },
]

;(async () => {
  fs.mkdirSync(path.join(__dirname, OUT), { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200)) })
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)))

  // Seed once via first navigation
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ content: seed })
  const stats = await page.evaluate(() => window.__seedNemos())
  console.log('seeded:', JSON.stringify(stats))

  for (const s of SCREENS) {
    try {
      await page.goto(BASE + s.path, { waitUntil: 'networkidle', timeout: 20000 })
      await page.waitForTimeout(1400)
      const file = path.join(__dirname, OUT, s.name + '.png')
      await page.screenshot({ path: file, fullPage: true })
      console.log('shot:', s.name)

      // Library: drill into the first folder to reveal deck cards.
      // Click the folder CARD in <main> (the "219 cards" footer is unique to it),
      // not the sidebar tree item of the same name.
      if (s.name === 'library') {
        const folder = page.locator('main').getByText('219 cards').first()
        await folder.click()
        await page.waitForTimeout(900)
        await page.mouse.move(1580, 980) // park cursor away so no card shows hover state
        await page.waitForTimeout(200)
        await page.screenshot({ path: path.join(__dirname, OUT, 'library-decks.png'), fullPage: true })
        console.log('shot: library-decks')
      }
    } catch (e) {
      console.log('FAIL', s.name, String(e).slice(0, 160))
    }
  }

  // Session — drive via a client-side click so the store is already hydrated
  // (a hard nav to /study/session races the async IDB rehydrate → empty queue).
  try {
    await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(2500) // let stores rehydrate from IDB
    const startBtn = page.locator('text=Start Inbox').first()
    await startBtn.click()
    await page.waitForTimeout(1800)
    // reveal the answer so both the card and the Missed/Remembered bar show
    await page.keyboard.press('Space')
    await page.waitForTimeout(700)
    await page.screenshot({ path: path.join(__dirname, OUT, 'session.png'), fullPage: false })
    console.log('shot: session')
  } catch (e) {
    console.log('FAIL session', String(e).slice(0, 160))
  }

  await browser.close()
})()
