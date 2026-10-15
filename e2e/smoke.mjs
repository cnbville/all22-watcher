// End-to-end smoke test: launches the real app, downloads a season, drives the menu bar and the
// Settings window, imports clips, grades a snap, opens a player and exports a PDF.
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
  await step('opens', async () => {
    await win.waitForSelector('[data-test="welcome"]', { timeout: 30_000 })
    await shot('0-welcome')
    await win.click('[data-test="welcome-continue"]')
  })

  await step('downloads the 2025 season', async () => {
    await win.click('[data-test="season-popup"]')
    await win.click('[data-test="season-option-2025"]')
    await win.waitForSelector('[data-test="season-popup"]:has-text("2025")')
    await win.waitForSelector('[data-test="season-download"]:has-text("2025")')
    await win.click('[data-test="season-download"]')
    await win.click('[data-test="sidebar-item-teams"]')
    await win.waitForSelector('[data-test="team-tile"]', { timeout: 300_000 })
    await shot('1-teams')
  })

  await step('menu reaches the renderer', async () => {
    await win.click('[data-test="sidebar-item-home"]')
    await win.waitForSelector('[data-test="screen-home"]')
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('go.teams').click())
    await win.waitForSelector('[data-test="screen-teams"]')
  })

  await step('opens Settings', async () => {
    const opened = app.waitForEvent('window')
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('app.settings').click())
    const settings = await opened
    await settings.waitForSelector('[data-test="settings-tab-general"]')
    await settings.screenshot({ path: join(out, '1b-settings.png') })
    await settings.close()
  })

  await step('opens a team', async () => {
    await win.click('[data-test="team-tile"]:has-text("Eagles")')
    await win.waitForSelector('[data-test="team-header"]')
    await win.waitForSelector('[data-test="stat-tile"]')
    await shot('2-team')
  })

  await step('imports film', async () => {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] })
    }, fixtures)
    await win.click('[data-test="team-section-games"]')
    await win.locator('[data-test="game-row"]:has-text("vs DAL") [data-test="game-action"]').first().click()
    await win.click('[data-test="import-sheet"] [data-test="choose-clips"]')
    await win.waitForSelector('[data-test="match-table"]')
    await win.click('[data-test="import-save"]')
    await win.waitForSelector('[data-test="tape-room"]', { timeout: 30_000 })
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
    await win.waitForSelector('[data-test="grade-plus"][aria-pressed="true"]')
  })

  await step('opens a player', async () => {
    await win.locator('[data-test="grading-player-name"]').first().click()
    await win.waitForSelector('[data-test="player-header"]', { timeout: 20_000 })
    await win.click('[data-test="player-section-film"]')
    await win.waitForSelector('[data-test="reel-item"]')
    await shot('4-player')
  })

  await step('player sections', async () => {
    await win.click('[data-test="player-section-splits"]')
    await win.waitForSelector('[data-test="splits-table"]')
    await win.click('[data-test="player-section-career"]')
    await win.waitForSelector('[data-test="player-career"] [data-test="career-row"]', { timeout: 20_000 })
  })

  await step('exports a PDF report', async () => {
    const pdf = join(out, 'report.pdf')
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    }, pdf)
    await win.click('[data-test="toolbar-export"]')
    await win.click('[data-test="export-report"]')
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
