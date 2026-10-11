/** Open-failure codes for the lock screen (AUDIT-003) and the startup error box words (AUDIT-059). */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { dbOpenFailedCode, parseDbOpenFailure, startupFailureText } from '../src/shared/dbOpen'

describe('open-failure codes', () => {
  it('round-trip every kind', () => {
    for (const kind of ['newer', 'migration', 'unreadable'] as const) {
      expect(parseDbOpenFailure(dbOpenFailedCode(kind))).toBe(kind)
    }
  })

  it('ignore every other error', () => {
    for (const e of ['Incorrect password', 'READ_ONLY', 'DB_OPEN_FAILED:', 'DB_OPEN_FAILED:other', '', null, undefined]) {
      expect(parseDbOpenFailure(e)).toBeNull()
    }
  })
})

describe('startup error box', () => {
  const { title, message } = startupFailureText('Pulse')

  it('uses plain words, says the data is still there, and gives a next step', () => {
    expect(title).toBe("Pulse couldn't start")
    expect(message).toMatch(/hasn't been deleted/)
    expect(message).toMatch(/Restart your computer/)
    expect(`${title} ${message}`).not.toMatch(/database|initiali[sz]e|error|SQLITE|EACCES/i)
  })

  it('is what index.ts shows, with no raw exception text in the box', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const box = src.slice(src.indexOf('await initDatabase()'), src.indexOf('app.exit(1)'))
    expect(box).toMatch(/startupFailureText\(PRODUCT_NAME\)/)
    expect(box).toMatch(/dialog\.showErrorBox\(title, message\)/)
    expect(box).not.toMatch(/showErrorBox\([^)]*err/)
  })
})
