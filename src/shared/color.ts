/**
 * A colour as "#rrggbb", or null when it isn't a hex colour. Accepts "#abc",
 * "abc", "#aabbcc" and "aabbcc". Category colours are printed by jsPDF, which
 * throws on anything it can't parse ("red", "#abc"), so only this form is saved.
 */
export function normalizeHexColor(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) return `#${raw.split('').map(c => c + c).join('').toLowerCase()}`
  return null
}
