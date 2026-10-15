import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return cssFiles(path)
    return name.endsWith('.css') ? [path] : []
  })
}

// Colors live in tokens.css (and the print palette in report.css); every other stylesheet references them (01 §9.4).
const ALLOWED = new Set(['styles/tokens.css', 'styles/report.css', 'report.css'])
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/

describe('stylesheets', () => {
  it('use tokens instead of color literals', () => {
    const offenders: string[] = []
    for (const file of cssFiles(ROOT)) {
      const rel = relative(ROOT, file).split('\\').join('/')
      if (ALLOWED.has(rel)) continue
      readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .forEach((line, i) => {
          if (LITERAL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
    }
    expect(offenders).toEqual([])
  })
})
