/**
 * String length limits counted in UTF-16 units, as String.length and the
 * renderer's maxLength attributes count them.
 *
 * Zod 4.5+ counts code points in its string .min() / .max() / .length(), so an
 * emoji (two units) counts once and a limit lets text with emoji run to twice
 * its size (F-119, P-011). Use `.check(textLength({ min, max }, message))` in
 * their place; tests/textLength.test.ts keeps zod's string length calls out of src.
 *
 * The issues are zod's own: too_small / too_big with origin 'string', so the
 * default messages, paths and `message` overrides read as before.
 */
import type { z } from 'zod'

export function textLength(limits: { min?: number; max?: number }, message?: string): z.core.CheckFn<string> {
  const { min, max } = limits
  return (payload) => {
    const input = payload.value
    const units = input.length
    const own = message === undefined ? {} : { message }
    if (min !== undefined && units < min) {
      payload.issues.push({ origin: 'string', code: 'too_small', minimum: min, inclusive: true, input, continue: true, ...own })
    }
    if (max !== undefined && units > max) {
      payload.issues.push({ origin: 'string', code: 'too_big', maximum: max, inclusive: true, input, continue: true, ...own })
    }
  }
}
