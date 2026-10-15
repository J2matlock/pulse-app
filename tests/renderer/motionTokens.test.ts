/**
 * Motion stays short and stays switchable (Q6): every motion/react duration
 * in utils/animations.ts is at most 200 ms, every CSS animation in motion.css
 * is too (the fading tint of a new record is colour, not movement, so it may
 * take 1.2 s), every animated class has a rule for both kinds of reduced
 * motion, and no animation class is defined without being used.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')
const ANIMATIONS = readFileSync(join(RENDERER, 'utils/animations.ts'), 'utf8')
const MOTION_CSS = readFileSync(join(RENDERER, 'styles/motion.css'), 'utf8')
const GLOBALS = readFileSync(join(RENDERER, 'styles/globals.css'), 'utf8')

const TOKENS: Record<string, number> = { '--motion-fast': 120, '--motion-base': 180, '--motion-enter': 200 }
/** Colour fades that may run longer than a movement */
const LONG_OK = new Set(['motion-flash', 'pulse-alert', 'pulse-alert-dark'])

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return /\.(tsx?|ts)$/.test(name) ? [p] : []
  })
}

/** Class name → the animation shorthands given to it (".a::after" counts as "a") */
function animatedClasses(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  // The reduced-motion rules turn animations off; they're checked on their own below
  css = css.replace(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g, '')
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (const m of css.matchAll(rule)) {
    const selector = m[1]!.trim()
    const body = m[2]!
    const anim = /(?:^|;|\s)animation:\s*([^;]+)/.exec(body)
    if (!anim || selector.startsWith('@') || /reduce-motion|^\d|^from|^to/.test(selector)) continue
    const cls = /\.([a-z][\w-]*)/.exec(selector.replace(/^:is\(\.dark\s+/, ''))
    if (!cls) continue
    found.set(cls[1]!, [...(found.get(cls[1]!) ?? []), anim[1]!.trim()])
  }
  return found
}

function msOf(value: string): number | null {
  const token = /var\((--motion-[a-z]+)\)/.exec(value)
  if (token) return TOKENS[token[1]!] ?? null
  const ms = /(\d+(?:\.\d+)?)ms/.exec(value)
  if (ms) return Number(ms[1])
  const s = /(\d+(?:\.\d+)?)s\b/.exec(value)
  return s ? Number(s[1]) * 1000 : null
}

describe('motion tokens', () => {
  it('every duration in animations.ts is at most 0.2 s', () => {
    const durations = [...ANIMATIONS.matchAll(/duration:\s*([\d.]+)/g)].map(m => Number(m[1]))
    expect(durations.length).toBeGreaterThan(3)
    for (const d of durations) expect(d).toBeLessThanOrEqual(0.2)
    const tokens = /MOTION = \{([^}]*)\}/.exec(ANIMATIONS)![1]!
    for (const m of tokens.matchAll(/([\d.]+)/g)) expect(Number(m[1])).toBeLessThanOrEqual(0.2)
  })

  it('motion.css defines the same three CSS durations', () => {
    for (const [name, ms] of Object.entries(TOKENS)) expect(MOTION_CSS).toContain(`${name}: ${ms}ms;`)
  })

  it('every animation in motion.css takes at most 200 ms, apart from colour fades', () => {
    const classes = animatedClasses(MOTION_CSS)
    expect(classes.size).toBeGreaterThan(1)
    for (const [cls, anims] of classes) {
      for (const a of anims) {
        const ms = msOf(a)
        expect(ms, `${cls}: ${a}`).not.toBeNull()
        if (!LONG_OK.has(cls)) expect(ms!, `${cls}: ${a}`).toBeLessThanOrEqual(200)
      }
    }
  })

  it('every animated class in motion.css has a rule for both kinds of reduced motion', () => {
    const media = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(MOTION_CSS)?.[1] ?? ''
    for (const cls of animatedClasses(MOTION_CSS).keys()) {
      expect(media, `@media rule for .${cls}`).toMatch(new RegExp(`\\.${cls}\\b`))
      expect(MOTION_CSS, `.reduce-motion rule for .${cls}`).toMatch(new RegExp(`\\.reduce-motion \\.${cls}\\b`))
    }
  })

  it('globals.css keeps only the deadline pulse keyframes; the rest live in motion.css', () => {
    const names = [...GLOBALS.matchAll(/@keyframes ([\w-]+)/g)].map(m => m[1])
    expect(names.sort()).toEqual(['pulse-alert', 'pulse-alert-dark'])
    expect(GLOBALS).toMatch(/@import "\.\/motion\.css";/)
  })

  it('every .animate-* and .motion-* class defined in CSS is used under src/renderer', () => {
    const defined = new Set<string>()
    for (const css of [MOTION_CSS, GLOBALS]) {
      for (const m of css.matchAll(/\.((?:animate|motion)-[\w-]+)/g)) defined.add(m[1]!)
    }
    // Tailwind's own animate-spin / animate-pulse aren't defined here
    const source = sourceFiles(RENDERER).map(p => readFileSync(p, 'utf8')).join('\n')
    for (const cls of defined) expect(source, `.${cls} is defined but never used`).toMatch(new RegExp(`(?<![\\w-])${cls}(?![\\w-])`))
  })
})
