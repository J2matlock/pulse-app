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

// Pulse's own pages: the source code, the releases (update downloads) and the website (terms, privacy)
const APP_LINK_PREFIXES = ['https://github.com/J2matlock/', 'https://www.baringasoft.com/']

/**
 * What APP_OPEN_EXTERNAL may open: https pages of Pulse's own, nothing else
 * (F-035, D-014). Links people type in notes go through the window's open
 * handler (isOpenableExternal) instead; this channel takes a URL from the
 * window, so a compromised window could otherwise send data anywhere in it.
 */
export function isAppLink(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
    return APP_LINK_PREFIXES.some(p => u.href.startsWith(p))
  } catch {
    return false
  }
}
