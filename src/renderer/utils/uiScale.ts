/**
 * App zoom limits, in percent. 200% meets WCAG 1.4.4 (text resizable to 200%) (AUDIT-055).
 * Kept out of settingsStore so tests that mock the store still see the real limits.
 */
export const UI_SCALE_MIN = 50
export const UI_SCALE_MAX = 200
/** Ctrl+- stops here: smaller sizes are only a Settings choice */
export const UI_SCALE_KEY_MIN = 80
