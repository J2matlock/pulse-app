/**
 * The internal app name decides where existing users' data lives and which
 * OS key-store entry protects their database key. These tests guard against
 * a rename (or a reordered import) quietly moving either.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// The module pins on import, so the mocks must exist before imports run
const m = vi.hoisted(() => ({ setName: vi.fn(), setPath: vi.fn(), hasUserDataSwitch: false }))
const { setName, setPath } = m
vi.mock('electron', () => ({
  app: {
    setName: (n: string) => m.setName(n),
    setPath: (k: string, v: string) => m.setPath(k, v),
    getPath: (k: string) => (k === 'appData' ? '/home/u/.config' : `/x/${k}`),
    commandLine: { hasSwitch: (s: string) => s === 'user-data-dir' && m.hasUserDataSwitch },
  },
}))

import { pinAppIdentity } from '../src/main/app-identity'
import { INTERNAL_APP_NAME, PRODUCT_NAME } from '../src/shared/constants'

describe('app identity', () => {
  beforeEach(() => { setName.mockClear(); setPath.mockClear(); m.hasUserDataSwitch = false })

  it('is the name existing installs were created under', () => {
    // package.json `name` is what electron-builder ships and Electron uses
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as { name: string }
    expect(INTERNAL_APP_NAME).toBe('baringasoft-pulse')
    expect(pkg.name).toBe(INTERNAL_APP_NAME)
  })

  it('pins the app name and data folder', () => {
    pinAppIdentity()
    expect(setName).toHaveBeenCalledWith('baringasoft-pulse')
    expect(setPath).toHaveBeenCalledWith('userData', join('/home/u/.config', 'baringasoft-pulse'))
  })

  it('respects an explicit --user-data-dir', () => {
    m.hasUserDataSwitch = true
    pinAppIdentity()
    expect(setName).toHaveBeenCalled()
    expect(setPath).not.toHaveBeenCalled()
  })

  it('runs before every other module in the main process', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8')
    const firstImport = src.split('\n').find(l => l.startsWith('import '))
    expect(firstImport).toBe("import './app-identity'")
  })

  it('keeps the display name in one place', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(f) && !p.endsWith(join('shared', 'constants.ts')) && readFileSync(p, 'utf8').includes(PRODUCT_NAME)) offenders.push(p)
      }
    }
    walk(join(__dirname, '..', 'src'))
    expect(offenders).toEqual([])
  })
})
