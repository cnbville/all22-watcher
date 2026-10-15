import { TEAM_BY_ABBR } from '@shared/teams'
import { contrast, luminance, oklabToLinear, parseHex, rgbToOklab, toHex, type RGB } from './color'

const CONTENT: RGB = [0x12, 0x12, 0x14]
const cache = new Map<string, string>()

/**
 * A team's color made visible on graphite (spec 01 §5.3): keep the OKLab hue and chroma and raise lightness
 * by 0.01 until the contrast with --bg-content is at least 2.6.
 */
export function teamMark(color: string): string {
  const hit = cache.get(color)
  if (hit) return hit
  const [L, a, b] = rgbToOklab(parseHex(color))
  let l = L
  let out = toHex(parseHex(color))
  for (let i = 0; i < 100; i++) {
    const rgb = oklabToLinear([l, a, b]).map((v) => Math.max(0, Math.min(1, v)))
    const srgb = rgb.map((v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) as RGB
    out = toHex(srgb)
    if (contrast(parseHex(out), CONTENT) >= 2.6) break
    l += 0.01
  }
  cache.set(color, out)
  return out
}

export function teamMarkFor(abbr: string): string {
  const t = TEAM_BY_ABBR[abbr]
  return t ? teamMark(t.color) : '#5C5C64'
}

/** Text on the large team badge: white, or near-black on a light primary like New Orleans gold. */
export function badgeTextColor(color: string): string {
  return luminance(parseHex(color)) > 0.5 ? '#111113' : '#FFFFFF'
}
