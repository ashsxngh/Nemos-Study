const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')
const seed = fs.readFileSync(path.join(__dirname, '_seed.js'), 'utf8')
const BASE = 'http://localhost:3311'
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
  await page.addScriptTag({ content: seed })
  await page.evaluate(() => window.__seedNemos())
  await page.goto(BASE + '/library', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.locator('main').getByText('219 cards').first().click()
  await page.waitForTimeout(900)
  await page.mouse.move(1580, 980)
  await page.waitForTimeout(200)
  const info = await page.evaluate(() => {
    const cb = document.querySelector('main input[type=checkbox]')
    if (!cb) return { found: false }
    const cs = getComputedStyle(cb)
    return {
      found: true,
      opacity: cs.opacity,
      className: cb.className,
      // check if group-hover variant CSS exists
      hasGroupClassOnAncestor: !!cb.closest('.group'),
    }
  })
  console.log(JSON.stringify(info, null, 2))
  await browser.close()
})()
