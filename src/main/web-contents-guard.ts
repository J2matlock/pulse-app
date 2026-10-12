/**
 * Hardening every web page Pulse ever creates, not just the main window (Q-058):
 * no pop-up windows, no <webview>, and no navigating or redirecting away from
 * Pulse's own pages. The main window adds its own handlers on top (external
 * links open in the browser); this is the floor for anything else.
 */
import type { WebContents } from 'electron'
import { isTrustedSenderUrl } from './ipc/ipc-utils'
import { logger } from './logger'

/** The security settings every BrowserWindow is created with, stated rather than left to defaults */
export const SECURE_WEB_PREFERENCES = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
} as const

export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => {
    logger.warn('app', 'Blocked a webview')
    event.preventDefault()
  })
  const stayInPulse = (event: { preventDefault: () => void }, url: string) => {
    if (!isTrustedSenderUrl(url)) event.preventDefault()
  }
  contents.on('will-navigate', stayInPulse)
  contents.on('will-redirect', stayInPulse)
}
