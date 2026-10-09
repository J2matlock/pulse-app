/**
 * Rules for NEW passwords (setup, change, reset, restore on a new computer).
 * Existing passwords are never re-checked, so nobody gets locked out by a
 * stricter rule. Shared by the renderer (live feedback) and main (enforcement).
 */

export const MIN_PASSWORD_LENGTH = 12

// Common passwords and patterns that meet the length rule but are guessed first.
const COMMON_PASSWORDS = new Set([
  'password1234', 'password12345', 'password123!', 'passwordpassword', 'password1234!',
  '123456789012', '1234567890123', '12345678910', 'qwertyuiop12', 'qwertyuiop123',
  'qwerty123456', '1q2w3e4r5t6y', 'iloveyou1234', 'welcome12345', 'letmein12345',
  'abc123456789', 'abcdefghijkl', 'administrator', 'changeme1234', 'football1234',
  'baseball1234', 'superman1234', 'trustno11234', 'sunshine1234', 'princess1234',
  'monkey123456', 'dragon123456', 'master123456', 'whatever1234', 'caseworker12',
  'socialworker', 'socialwork12', 'casemanager1', 'pulsepassword', 'baringasoft1',
])

export type PasswordStrength = 'too-short' | 'too-common' | 'fair' | 'good' | 'strong'

export interface PasswordCheck {
  ok: boolean
  strength: PasswordStrength
  /** Plain-English problem to show the user, when !ok */
  message?: string
}

function characterClasses(pw: string): number {
  return [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(pw)).length
}

export function checkNewPassword(pw: string): PasswordCheck {
  if ([...pw].length < MIN_PASSWORD_LENGTH) {
    return { ok: false, strength: 'too-short', message: `Use at least ${MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember.` }
  }
  const lower = pw.toLowerCase()
  const allSame = /^(.)\1+$/.test(pw)
  const digitsOnlySequence = /^\d+$/.test(pw) && '01234567890123456789'.includes(pw)
  if (COMMON_PASSWORDS.has(lower) || allSame || digitsOnlySequence) {
    return { ok: false, strength: 'too-common', message: 'That password is too common or easy to guess. Try a short sentence instead.' }
  }
  const len = [...pw].length
  const classes = characterClasses(pw)
  if (len >= 20 || (len >= 16 && classes >= 2) || (len >= 14 && classes >= 3)) return { ok: true, strength: 'strong' }
  if (len >= 14 || classes >= 3) return { ok: true, strength: 'good' }
  return { ok: true, strength: 'fair' }
}
