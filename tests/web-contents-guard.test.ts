/**
 * Window hardening (Q-058): every page Pulse creates denies pop-ups and <webview>
 * and stays on Pulse's own pages; the main window states its security settings.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/tmp' }, ipcMain: { handle: () => {} }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }))

import { hardenWebContents, SECURE_WEB_PREFERENCES } from '../src/main/web-contents-guard'

function fakeContents() {
  const listeners = new Map<string, (e: { preventDefault: () => void }, url?: string) => void>()
  let openHandler: ((d: { url: string }) => { action: string }) | null = null
  return {
    listeners,
    open: (url: string) => openHandler!({ url }),
    setWindowOpenHandler: (h: (d: { url: string }) => { action: string }) => { openHandler = h },
    on: (name: string, fn: (e: { preventDefault: () => void }, url?: string) => void) => { listeners.set(name, fn) },
  }
}
const fire = (c: ReturnType<typeof fakeContents>, name: string, url?: string) => {
  const e = { preventDefault: vi.fn() }
  c.listeners.get(name)!(e, url)
  return e.preventDefault.mock.calls.length > 0
}

describe('every web page Pulse creates', () => {
  it('denies pop-ups and webviews, and refuses to navigate or redirect away from Pulse', () => {
    const c = fakeContents()
    hardenWebContents(c as never)
    expect(c.open('https://example.com/')).toEqual({ action: 'deny' })
    expect(fire(c, 'will-attach-webview')).toBe(true)
    expect(fire(c, 'will-navigate', 'https://example.com/')).toBe(true)
    expect(fire(c, 'will-redirect', 'file:///etc/passwd')).toBe(true)
    expect(fire(c, 'will-navigate', 'app://bundle/index.html#/grid')).toBe(false)
  })
})

describe('the main window', () => {
  it('states every security setting instead of relying on defaults', () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false })
    const index = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    // One window, created with those settings; every page gets the guard as it's made
    expect(index.match(/new BrowserWindow\(/g)).toHaveLength(1)
    expect(index).toMatch(/webPreferences: \{[^}]*\.\.\.SECURE_WEB_PREFERENCES/)
    expect(index).toMatch(/app\.on\('web-contents-created', \(_event, contents\) => hardenWebContents\(contents\)\)/)
  })
})
