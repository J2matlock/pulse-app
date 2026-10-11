/**
 * A default file name for a save dialog that keeps accented and non-Latin
 * letters ("José Núñez", "Ольга"). Only characters that Windows, macOS or
 * Linux refuse in a file name are removed.
 */
export function safeFileName(name: string, fallback = 'contact'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops trailing dots and spaces, which can collide with another file.
    .replace(/[. ]+$/, '')
  return cleaned || fallback
}
