/**
 * Urgency colors are readable (audit A06-3, A06-30). Computes WCAG contrast
 * from Tailwind's own palette (theme.css, oklch) rather than trusting
 * remembered hex values, and checks the source doesn't bring back light-theme
 * yellow/orange/amber text that fails 4.5:1 on white.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const THEME = readFileSync(join(__dirname, '../../../node_modules/tailwindcss/theme.css'), 'utf8')
const PALETTE: Record<string, string> = {}
for (const m of THEME.matchAll(/--color-([a-z]+-\d+|white|black):\s*([^;]+);/g)) PALETTE[m[1]!] = m[2]!.trim()

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** Linear-light RGB of a palette color (oklch → OKLab → linear sRGB, clipped to gamut) */
function linearRgb(name: string): [number, number, number] {
  const v = PALETTE[name]
  if (!v) throw new Error(`No Tailwind color ${name}`)
  if (v.startsWith('#')) {
    const h = v.length === 4 ? v.slice(1).split('').map(c => c + c).join('') : v.slice(1)
    return [0, 2, 4].map(i => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)) as [number, number, number]
  }
  const m = v.match(/oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/)
  if (!m) throw new Error(`Can't read ${name}: ${v}`)
  const L = Number(m[1]) / 100, C = Number(m[2]), H = Number(m[3]) * Math.PI / 180
  const a = C * Math.cos(H), b = C * Math.sin(H)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
  const clip = (x: number) => Math.min(1, Math.max(0, x))
  return [
    clip(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    clip(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    clip(-0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s),
  ]
}

/** "yellow-900/40 over slate-800" blends in sRGB, as the browser does */
function luminance(spec: string): number {
  const [top, under] = spec.split(' over ')
  const [name, pct] = top!.split('/')
  let rgb = linearRgb(name!)
  if (pct && under) {
    const alpha = Number(pct) / 100
    const base = linearRgb(under)
    rgb = rgb.map((c, i) => toLinear(toSrgb(c) * alpha + toSrgb(base[i]!) * (1 - alpha))) as [number, number, number]
  }
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

export function contrast(fg: string, bg: string): number {
  const a = luminance(fg), b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('urgency text contrast', () => {
  it('reproduces the audit numbers, so the math is right', () => {
    expect(contrast('yellow-600', 'white')).toBeCloseTo(2.94, 1)
    expect(contrast('orange-600', 'white')).toBeCloseTo(3.56, 1)
  })

  it('light-theme urgency text reads at 4.5:1 on white, the hover grey and the pill tints', () => {
    const text: Array<[string, string]> = [
      ['yellow-700', 'white'], ['orange-700', 'white'], ['amber-700', 'white'], ['red-700', 'white'],
      ['yellow-700', 'slate-50'], ['orange-700', 'slate-50'], ['amber-700', 'slate-50'],
      // Task and checklist due-date pills (taskHelpers dueDateBadge / dueDateLabel)
      ['red-700', 'red-100'], ['orange-800', 'orange-100'], ['yellow-800', 'yellow-100'], ['slate-600', 'slate-100'],
      ['amber-700', 'slate-100'], ['yellow-800', 'slate-100'],
    ]
    for (const [fg, bg] of text) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('dark-theme urgency text reads at 4.5:1 on the dark cards and pill tints', () => {
    const text: Array<[string, string]> = [
      ['yellow-400', 'slate-800'], ['orange-400', 'slate-800'], ['amber-400', 'slate-800'], ['red-400', 'slate-800'],
      ['yellow-400', 'slate-900'], ['orange-400', 'slate-900'],
      ['red-300', 'red-900/40 over slate-800'], ['orange-300', 'orange-900/40 over slate-800'],
      ['yellow-300', 'yellow-900/40 over slate-800'],
    ]
    for (const [fg, bg] of text) expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('settings switches: the off track and knob stand out at 3:1 in both themes (A06-30)', () => {
    // Off: white track, slate-500 outline and knob. Dark: slate-400 outline and knob on the dark card.
    expect(contrast('slate-500', 'white')).toBeGreaterThanOrEqual(3)
    expect(contrast('slate-400', 'slate-800')).toBeGreaterThanOrEqual(3)
    expect(contrast('slate-400', 'slate-900')).toBeGreaterThanOrEqual(3)
    // On: dark track with a white knob, and the reverse in dark mode
    expect(contrast('white', 'slate-700')).toBeGreaterThanOrEqual(3)
    expect(contrast('slate-300', 'slate-800')).toBeGreaterThanOrEqual(3)
  })
})

const RENDERER = join(__dirname, '../../../src/renderer')
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(name) ? [full] : []
  })
}

describe('no faint urgency text in the light theme', () => {
  it('yellow, orange and amber text is -700 or darker unless it is an icon or always on a dark background', () => {
    // Unprefixed (light-theme) text-yellow/orange/amber-300…600
    const FAINT = /(^|["'`\s{])text-(yellow|orange|amber)-(300|400|500|600)\b/g
    // Focus mode is always on slate-900, where the bright shades pass
    const ALWAYS_DARK = ['/views/focus-mode/', '/views/FocusModeView.tsx']
    const offenders: string[] = []
    for (const file of sourceFiles(RENDERER)) {
      const rel = file.replace(RENDERER, '')
      if (ALWAYS_DARK.some(d => rel.startsWith(d))) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!FAINT.test(line)) return
        FAINT.lastIndex = 0
        // Icons (a capitalised JSX tag such as <Star or <AlertTriangle, a filled
        // shape, or an icon-only button) are non-text and need only 3:1
        const isIcon = /<[A-Z][A-Za-z]*\s[^>]*className/.test(line) || /\bfill-(yellow|amber)-/.test(line)
          || /className="hit-44 p-1\.5 rounded-sm text-amber-600/.test(line)
        if (!isIcon) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
