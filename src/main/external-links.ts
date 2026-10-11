/**
 * Links the app may hand to the system: web pages, and email and phone links
 * so a record's email address or phone number opens the mail or phone app
 * (3.6, R-35). Anything else (file:, javascript:, custom schemes) is refused.
 */
export function isOpenableExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:' || protocol === 'tel:'
  } catch {
    return false
  }
}
