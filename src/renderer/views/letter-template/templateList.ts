/**
 * Which list a letter template was last used with, so "Insert field" and
 * "Generate letter" start there instead of on whatever list was open.
 * A per-computer convenience: losing it only means picking the list again.
 */
const key = (templateId: number) => `pulse.letterTemplateList.${templateId}`

export function rememberedList(templateId: number | null | undefined): number | null {
  if (!templateId) return null
  try {
    const n = Number(window.localStorage.getItem(key(templateId)))
    return Number.isInteger(n) && n > 0 ? n : null
  } catch { return null }
}

export function rememberList(templateId: number | null | undefined, gridId: number | null): void {
  if (!templateId || !gridId) return
  try { window.localStorage.setItem(key(templateId), String(gridId)) } catch { /* storage unavailable: nothing to remember */ }
}
