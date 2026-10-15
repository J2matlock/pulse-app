// @vitest-environment jsdom
/** Pulse's own mark (Q8): one logo on password setup, the lock screen, the welcome screen and About. */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PulseMark } from '../../../../src/renderer/components/ui/PulseMark'

afterEach(cleanup)

describe('PulseMark', () => {
  it('is decorative by default: no name, hidden from screen readers', () => {
    const { container } = render(<PulseMark />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('alt')).toBe('')
    expect(img.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('has a name when asked', () => {
    render(<PulseMark label="Pulse" />)
    const img = screen.getByRole('img', { name: 'Pulse' })
    expect(img.getAttribute('aria-hidden')).toBeNull()
  })

  it('sits on a white tile at the three sizes', () => {
    const { container } = render(<><PulseMark size={32} /><PulseMark size={48} /><PulseMark size={64} /></>)
    const tiles = [...container.querySelectorAll('span')]
    expect(tiles.map(t => t.className.match(/w-(8|12|16) h-\1/)?.[0])).toEqual(['w-8 h-8', 'w-12 h-12', 'w-16 h-16'])
    for (const t of tiles) expect(t.className).toMatch(/(^| )bg-white( |$)/)
  })

  it('the hero screens and About use it instead of other icons', () => {
    const views = join(__dirname, '../../../../src/renderer')
    for (const f of ['views/PasswordSetupView.tsx', 'views/LockScreenView.tsx', 'views/SetupView.tsx', 'components/settings/AboutSection.tsx']) {
      expect(readFileSync(join(views, f), 'utf8'), f).toMatch(/<PulseMark /)
    }
  })
})
