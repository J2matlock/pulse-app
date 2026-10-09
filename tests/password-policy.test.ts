import { describe, it, expect } from 'vitest'
import { checkNewPassword } from '../src/shared/passwordPolicy'

describe('checkNewPassword', () => {
  it('requires 12 characters', () => {
    expect(checkNewPassword('elevenchars').ok).toBe(false)
    expect(checkNewPassword('twelve chars').ok).toBe(true)
  })
  it('blocks common and trivial passwords', () => {
    for (const pw of ['password1234', 'Password1234', '123456789012', 'aaaaaaaaaaaa', 'qwertyuiop12']) {
      expect(checkNewPassword(pw)).toMatchObject({ ok: false, strength: 'too-common' })
    }
  })
  it('rates passphrases as strong', () => {
    expect(checkNewPassword('blue tractor sings at noon').strength).toBe('strong')
    expect(checkNewPassword('Coffee-Time-42').strength).toBe('strong')
    expect(checkNewPassword('twelve chars').strength).toBe('fair')
  })
})
