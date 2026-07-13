// Vérification de la grammaire des combos (spec-grammaire-combos.md > Verification).
// Pilote un Chromium réel : cadence, bruit, pulsations lentes, résonance.
//
// Usage :
//   npm run build && npx vite preview --port 4293 &
//   npm i --no-save playwright-core           # outil de vérif, PAS une dépendance de l'app
//   TT_CHROMIUM=/chemin/vers/chrome node scripts/verify-combos.mjs
//
// Variables : TT_URL (défaut http://localhost:4293/) · TT_CHROMIUM (exécutable Chromium)
// · TT_OUT (dossier des captures, défaut docs/implementation-artifacts/verify-combos).

import { chromium } from 'playwright-core'

const EXE = process.env.TT_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const URL = process.env.TT_URL || 'http://localhost:4293/'
const OUT = process.env.TT_OUT || 'docs/implementation-artifacts/verify-combos'

const B = await chromium.launch({ executablePath: EXE, args: ['--use-gl=swiftshader'] })
let failures = 0
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

async function freshPage() {
  const page = await B.newPage({ viewport: { width: 390, height: 780 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  const box = await page.locator('.tt-screen').boundingBox()
  return { page, errors, box }
}
const readFlux = (p) => p.evaluate(() => parseInt(document.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')))
const readScore = (p) => p.evaluate(() => parseInt(document.querySelectorAll('span')[3].textContent))
const hudText = (p) => p.evaluate(() => document.body.innerText)

// (a) CADENCE : taps réguliers ~300 ms → multiplicateurs + progression.
{
  const { page, errors, box } = await freshPage()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  let sawX2 = false, sawX3 = false, sawX4 = false
  for (let i = 0; i < 45; i++) {
    await page.mouse.click(
      box.x + box.width * (0.3 + 0.4 * ((i % 5) / 5)),
      box.y + box.height * (0.3 + 0.4 * (((i * 2) % 5) / 5)),
    )
    if (i % 4 === 0) {
      const t = await hudText(page)
      if (t.includes('x2 CADENCE')) sawX2 = true
      if (t.includes('x3 CADENCE')) sawX3 = true
      if (t.includes('x4 CADENCE')) sawX4 = true
    }
    await page.waitForTimeout(300)
  }
  const flux = await readFlux(page)
  const stage = await page.evaluate(() => document.querySelectorAll('span')[1].textContent)
  await page.screenshot({ path: `${OUT}/a-cadence.png` })
  check('a-cadence: x2/x3/x4 vus', sawX2 && sawX3 && sawX4)
  check('a-cadence: progression (seuil franchi ou FLUX haut)', stage !== 'WAVEFORM' || flux > 60, `stage=${stage} flux=${flux}`)
  check('a-cadence: console propre', errors.length === 0, errors.join(' | '))
  await page.close()
}

// (b) BRUIT : martèlement ~40 ms → rien ne progresse, détection visible.
{
  const { page, errors, box } = await freshPage()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(400)
  const scoreBefore = await readScore(page)
  let redSeen = false, bruitLabel = false
  for (let i = 0; i < 30; i++) {
    await page.mouse.click(cx + (i % 3) * 5, cy)
    if (i === 10) {
      const border = await page.evaluate(() => getComputedStyle(document.querySelector('[role="progressbar"]')).borderColor)
      if (border.includes('255, 59, 48')) redSeen = true
      if ((await hudText(page)).includes('bruit.')) bruitLabel = true
      await page.screenshot({ path: `${OUT}/b-bruit.png` })
    }
    await page.waitForTimeout(35)
  }
  await page.waitForTimeout(200)
  check('b-bruit: score fige', (await readScore(page)) - scoreBefore <= 10)
  check('b-bruit: FLUX stagne', (await readFlux(page)) <= 5)
  check('b-bruit: liseré rouge + etiquette', redSeen && bruitLabel)
  check('b-bruit: console propre', errors.length === 0, errors.join(' | '))
  await page.close()
}

// (c) PULSATIONS LENTES : la décroissance gagne.
{
  const { page, errors, box } = await freshPage()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 8; i++) {
    await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4)
    await page.waitForTimeout(800)
  }
  check('c-lent: FLUX proche de 0', (await readFlux(page)) <= 5)
  check('c-lent: pas de CADENCE affichee', !(await hudText(page)).includes('CADENCE'))
  check('c-lent: console propre', errors.length === 0, errors.join(' | '))
  await page.close()
}

// (d) RÉSONANCE : tap sur son propre anneau (âge ~550 ms → rayon ~0,174).
{
  const { page, errors, box } = await freshPage()
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2
  await page.mouse.click(cx, cy)
  await page.waitForTimeout(900)
  let plusSeen = false
  for (let round = 0; round < 6 && !plusSeen; round++) {
    await page.mouse.click(cx, cy)
    await page.waitForTimeout(550)
    await page.mouse.click(box.x + box.width * (0.5 + 0.174), cy)
    const t = await hudText(page)
    if (t.includes('+3 %') || t.includes('+6 %')) plusSeen = true
    if (plusSeen) await page.screenshot({ path: `${OUT}/d-resonance.png` })
    await page.waitForTimeout(700)
  }
  check('d-resonance: bonus obtenu', plusSeen)
  check('d-resonance: console propre', errors.length === 0, errors.join(' | '))
  await page.close()
}

await B.close()
console.log(failures === 0 ? '\nTOUT PASSE ✓' : `\n${failures} ECHEC(S) ✗`)
process.exit(failures === 0 ? 0 : 1)
