import { chromium } from 'playwright-core'
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=swiftshader', '--no-sandbox'] })
const SHOT = '/tmp/claude-0/-home-user-devisdsp/6f77e728-cc5f-5024-ae99-d4891659b5ca/scratchpad'

const HINTS = {
  1: 'tape dans les creux',
  2: 'tape hors du secteur',
  3: 'franchis-la ou fuis',
}

for (const stageId of [1, 2, 3]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 780 } })
  await page.goto('http://localhost:4293/', { waitUntil: 'networkidle' })
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('taptap.save.v1', s) },
    JSON.stringify({ highScore: 0, maxUnlocked: stageId, noyauBeaten: false }))
  await page.reload({ waitUntil: 'networkidle' })
  const box = await page.locator('.tt-screen').boundingBox()
  const cx = box.x + box.width / 2, cy = box.y + box.height * 0.5
  const bar = page.locator('[role=progressbar]').first()

  await page.mouse.click(cx, cy); await page.waitForTimeout(120)          // éveil
  await page.locator(`button[aria-label^="Stage ${stageId}"]`).click(); await page.waitForTimeout(150)

  // Taper jusqu'à l'apparition du boss (la jauge passe en « Purge de … »).
  let bossName = null
  for (let i = 0; i < 900; i++) {
    await page.mouse.click(cx, cy); await page.waitForTimeout(12)
    if (i % 5 === 0) {
      const lbl = await bar.getAttribute('aria-label')
      if (lbl && lbl.startsWith('Purge de ')) { bossName = lbl.replace('Purge de ', ''); break }
    }
  }
  // UN seul tap pour fermer la notice et lancer le combat, puis on NE TOUCHE PLUS.
  await page.mouse.click(cx, cy)

  // Attendre une charge, puis capturer la géométrie du danger.
  let hint = null
  for (let i = 0; i < 90; i++) {
    const t = await page.textContent('body')
    const m = t.match(/tape dans les creux|tape hors du secteur|franchis-la ou fuis/)
    if (m) { hint = m[0]; break }
    await page.waitForTimeout(100)
  }
  if (hint) await page.screenshot({ path: `${SHOT}/kind-${stageId}.png`, clip: { x: box.x, y: box.y + 90, width: box.width, height: 560 } })
  const ok = hint === HINTS[stageId]
  console.log(`Palier ${stageId} → ${bossName ?? '✗ non atteint'} | consigne « ${hint ?? 'n/a' } » ${ok ? '✓' : '✗ (attendu: ' + HINTS[stageId] + ')'}`)
  await page.close()
}
await browser.close()
console.log('DONE')
