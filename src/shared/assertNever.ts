/**
 * Exhaustiveness helpers for switches over a union.
 *
 * Put one in the `default:` branch. When a member is added to the union and
 * no `case` handles it, the value is no longer `never` and typecheck fails,
 * so a new kind, period or operator can't silently take some other branch.
 */

/**
 * For values that can only come from code: reaching it at runtime is a bug,
 * so it throws.
 */
export function assertNever(value: never, what = 'value'): never {
  throw new Error(`Unexpected ${what}: ${String(value)}`)
}

/**
 * For values that may come from stored data (the database, a saved view, a
 * backup from another version), where an unknown value must not crash the
 * screen. It only checks at compile time; the caller's safe fallback runs
 * after it.
 */
export function unhandledCase(value: never): void {
  void value
}
