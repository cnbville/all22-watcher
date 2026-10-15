// End-to-end smoke test: launches the real app, downloads a season, imports clips, grades a
// snap, opens a player and exports a PDF.
//
//   npm run build && node e2e/smoke.mjs                 # the dev build
//   APP="dist/mac-arm64/All-22 Watcher.app/Contents/MacOS/All-22 Watcher" node e2e/smoke.mjs
//
// NFLVERSE_MIRROR=/folder/of/release/files reads nflverse data from disk instead of the network.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'e2e', 'output')
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'all22-smoke-'))
const fixtures = join(root, 'e2e', 'fixtures')

const launch = process.env.APP
  ? { executablePath: resolve(process.env.APP), args: [] }
  : { executablePath: join(root, 'node_modules', 'electron', 'dist', process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron'), args: [root] }

const app = await electron.launch({
  ...launch,
  args: [...launch.args, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: {
    ...process.env,
    ALL22_USER_DATA: userData,
    ...(process.env.NFLVERSE_MIRROR ? { ALL22_NFLVERSE_MIRROR: process.env.NFLVERSE_MIRROR } : {})
  },
  timeout: 60_000
})

const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(e.message))
await win.setViewportSize({ width: 1440, height: 900 })
const shot = (name) => win.screenshot({ path: join(out, `${name}.png`) })

let failed = false
const step = async (name, fn) => {
  try {
    await fn()
    console.log(`✓ ${name}`)
  } catch (e) {
    failed = true
    console.log(`✗ ${name}: ${e.message}`)
    await shot(`failed-${name}`).catch(() => {})
    throw e
  }
}

try {
  await step('opens', () => win.waitForSelector('.season-hero', { timeout: 30_000 }))

  await step('downloads the 2025 season', async () => {
    await win.selectOption('.season-hero select', '2025')
    await win.click('text=Download 2025 data')
    await win.waitForSelector('.team-card', { timeout: 300_000 })
    await shot('1-teams')
  })

  await step('opens a team', async () => {
    await win.click('.team-card:has-text("Eagles")')
    await win.waitForSelector('.team-hero')
    await win.waitForSelector('.stat-tile')
    await shot('2-team')
  })

  await step('imports film', async () => {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, fixtures)
    await win.locator('tr:has-text("vs DAL")').first().locator('button').click()
    await win.click('.modal-body button:has-text("Choose clips")')
    await win.waitForSelector('.match-table')
    await win.click('text=Save film')
    await win.waitForSelector('.tape', { timeout: 30_000 })
  })

  await step('plays a clip', async () => {
    await win.waitForFunction(() => {
      const v = document.querySelector('video')
      return v && v.readyState >= 2 && !v.error && v.videoWidth > 0
    }, null, { timeout: 20_000 })
    await shot('3-tape-room')
  })

  await step('grades a snap', async () => {
    await win.keyboard.press('=')
    await win.waitForSelector('.gbtn.plus.on')
  })

  await step('opens a player', async () => {
    await win.locator('.player-row .pname a').first().click()
    await win.waitForSelector('.player-hero', { timeout: 20_000 })
    await win.waitForSelector('.reel-item')
    await shot('4-player')
  })

  await step('exports a PDF report', async () => {
    const pdf = join(out, 'report.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, pdf)
    await win.click('text=Export report (PDF)')
    for (let i = 0; i < 120 && !(existsSync(pdf) && statSync(pdf).size > 0); i++) await win.waitForTimeout(250)
    if (!existsSync(pdf) || statSync(pdf).size < 10_000) throw new Error('PDF missing or empty')
  })

  if (errors.length) throw new Error(`Page errors: ${errors.join('; ')}`)
} catch {
  failed = true
} finally {
  await app.close()
}

console.log(failed ? 'Smoke test failed' : `Smoke test passed (${readdirSync(out).length} files in e2e/output)`)
process.exit(failed ? 1 : 0)
