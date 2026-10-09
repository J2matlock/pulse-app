/** True on macOS, where shortcuts use Cmd instead of Ctrl. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

/** The shortcut modifier: Ctrl, or Cmd on a Mac (Ctrl works there too). */
export function isMod(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || (IS_MAC && e.metaKey)
}
