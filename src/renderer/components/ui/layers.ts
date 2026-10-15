/**
 * Stacking layers for the shared components, lowest first. Only components in
 * this folder use them, so a menu opened from a dialog always sits above it
 * and a toast above both (before, 11 different z-values meant a z-50 dialog
 * could open underneath a z-[200] one).
 *
 * Full class names, so Tailwind finds them when it scans the source.
 */
export const LAYER = {
  /** Dialog backdrop and panel */
  dialog: 'z-[200]',
  /** Menus, popovers and pickers, also when opened from a dialog */
  popover: 'z-[250]',
  /** Toasts and tooltips */
  toast: 'z-[300]',
} as const

export type Layer = keyof typeof LAYER
