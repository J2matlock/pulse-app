import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { windowStateToSave, restorableWindowState, windowBackground } from '../src/main/window-state'

const laptop = { x: 0, y: 0, width: 1440, height: 870 }
const external = { x: 1440, y: 0, width: 2560, height: 1400 }

describe('window state', () => {
  it('saves the normal size of a maximized window, not the whole screen', () => {
    const saved = windowStateToSave({ x: 100, y: 80, width: 1200, height: 760 }, true)
    expect(saved).toEqual({ x: 100, y: 80, width: 1200, height: 760, maximized: true })
  })

  it('keeps a position that is on a connected screen', () => {
    const saved = { x: 1600, y: 100, width: 1280, height: 800, maximized: false }
    expect(restorableWindowState(saved, [laptop, external])).toEqual(saved)
  })

  it('drops a position on a screen that is no longer connected', () => {
    const saved = { x: 1600, y: 100, width: 1280, height: 800, maximized: false }
    const restored = restorableWindowState(saved, [laptop])
    expect(restored).toEqual({ width: 1280, height: 800, maximized: false })
    expect('x' in restored).toBe(false)
  })

  it('drops a position whose title bar is above every screen', () => {
    const saved = { x: 100, y: -500, width: 1280, height: 800, maximized: false }
    expect(restorableWindowState(saved, [laptop]).x).toBeUndefined()
  })

  it('keeps a window that only partly hangs off a screen edge', () => {
    const saved = { x: 1200, y: 50, width: 1280, height: 800, maximized: false }
    expect(restorableWindowState(saved, [laptop]).x).toBe(1200)
  })

  it('leaves a state with no saved position alone', () => {
    const saved = { width: 1280, height: 800, maximized: true }
    expect(restorableWindowState(saved, [laptop])).toEqual(saved)
  })
})

describe('window background before the page paints (Q8)', () => {
  it('is dark when the computer is in dark mode, light otherwise', () => {
    expect(windowBackground(true)).toBe('#0F172A')
    expect(windowBackground(false)).toBe('#F8FAFC')
  })

  it('createWindow asks the computer which one, instead of a fixed light colour', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    expect(src).toMatch(/backgroundColor: windowBackground\(nativeTheme\.shouldUseDarkColors\)/)
    expect(src).not.toMatch(/backgroundColor: '#/)
  })
})
