/** 3.6 (R-35): email and phone links on a record open the mail or phone app; nothing else unsafe does. */
import { describe, it, expect } from 'vitest'
import { isOpenableExternal, isAppLink } from '../src/main/external-links'

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

describe('isAppLink (F-035)', () => {
  it.each([
    ['https://github.com/J2matlock/pulse-app', true],
    ['https://github.com/J2matlock/pulse-releases/releases/download/v2.4.0/Pulse.AppImage', true],
    ['https://www.baringasoft.com/terms.html', true],
    ['http://www.baringasoft.com/terms.html', false],
    ['https://github.com/J2matlockx/repo', false],
    ['https://github.com/someone/J2matlock/', false],
    ['https://user:pw@github.com/J2matlock/', false],
    ['https://baringasoft.com/', false],
    ['https://www.baringasoft.com.evil.example/', false],
    ['mailto:help@baringasoft.com', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isAppLink(url)).toBe(expected)
  })
})
