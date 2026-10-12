/**
 * Scratch-notes lists show their bullets and numbers (Q-052). Tailwind's reset removes list
 * markers and @tailwindcss/typography isn't installed, so the `prose` classes did nothing.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const RENDERER = join(__dirname, '../../src/renderer')
const css = readFileSync(join(RENDERER, 'styles/globals.css'), 'utf8')
const pad = readFileSync(join(RENDERER, 'components/profile/ScratchPad.tsx'), 'utf8')

describe('scratch-notes lists', () => {
  it('the editor uses the scratch-editor class, not the plugin-less prose classes', () => {
    expect(pad).toMatch(/class: 'scratch-editor\b/)
    expect(pad).not.toMatch(/\bprose\b/)
  })

  it('globals.css gives its bullet and numbered lists markers and an indent', () => {
    expect(css).toMatch(/\.scratch-editor ul\s*\{[^}]*list-style:\s*disc[^}]*padding-left/)
    expect(css).toMatch(/\.scratch-editor ol\s*\{[^}]*list-style:\s*decimal[^}]*padding-left/)
  })
})
