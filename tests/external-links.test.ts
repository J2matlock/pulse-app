/** 3.6 (R-35): email and phone links on a record open the mail or phone app; nothing else unsafe does. */
import { describe, it, expect } from 'vitest'
import { isOpenableExternal } from '../src/main/external-links'

describe('isOpenableExternal', () => {
  it('allows web, email and phone links', () => {
    expect(isOpenableExternal('https://example.org')).toBe(true)
    expect(isOpenableExternal('mailto:ann@example.org')).toBe(true)
    expect(isOpenableExternal('tel:+15550199')).toBe(true)
  })
  it('refuses everything else', () => {
    expect(isOpenableExternal('file:///etc/passwd')).toBe(false)
    expect(isOpenableExternal('javascript:alert(1)')).toBe(false)
    expect(isOpenableExternal('not a url')).toBe(false)
  })
})
