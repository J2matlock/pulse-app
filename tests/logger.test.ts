/**
 * logger.ts tests — Structured logging, sanitization, and level filtering.
 *
 * The logger depends on Electron's `app` for getPath and isPackaged.
 * We mock `electron` and test the sanitization logic, log-level filtering,
 * and file output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

let tmpRoot: string
let tmpLogDir: string // logs live in <data folder>/logs

vi.mock('electron', () => {
  return {
    app: {
      get isPackaged() { return true },
      getPath: (name: string) => {
        if (name === 'userData') return tmpRoot
        return '/tmp/pulse-test-logger'
      },
      commandLine: { appendSwitch: () => {} },
    },
  }
})

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pulse-logger-test-'))
  tmpLogDir = join(tmpRoot, 'logs')
  vi.resetModules()
})

afterEach(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* best effort */ }
})

async function getLogger() {
  const mod = await import('../src/main/logger')
  return mod.logger
}

describe('Logger — data sanitization', () => {
  it('redacts 64-char hex strings in data values', async () => {
    const logger = await getLogger()
    const hexKey = 'a'.repeat(64)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Key found', { key: hexKey })
    const output = stderrSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.data.key).toContain('[REDACTED_KEY]')
    expect(parsed.data.key).not.toBe(hexKey)
    stderrSpy.mockRestore()
  })

  it('redacts sensitive object keys (password, token, email)', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'User data', { password: 'secret123', username: 'jdoe', token: 'abc' })
    const output = stderrSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.data.password).toBe('[REDACTED]')
    expect(parsed.data.token).toBe('[REDACTED]')
    expect(parsed.data.username).toBe('jdoe')
    stderrSpy.mockRestore()
  })

  it('redacts nested sensitive keys', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Nested', { user: { email: 'test@test.com', id: 5 } })
    const output = stderrSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.data.user.email).toBe('[REDACTED]')
    expect(parsed.data.user.id).toBe(5)
    stderrSpy.mockRestore()
  })

  it('sanitizes Error objects to message+stack', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.error('test', 'Failure', new Error('Something broke'))
    const output = stderrSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.data.message).toBe('Something broke')
    expect(parsed.data.stack).toBeDefined()
    stderrSpy.mockRestore()
  })

  it('caps recursion depth to prevent infinite nesting', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    // Build a 10-level deep object (max depth is 5)
    const deep: Record<string, unknown> = { a: { b: { c: { d: { e: { f: { g: 'deep' } } } } } } }
    logger.info('test', 'Deep object', deep)
    const output = stderrSpy.mock.calls[0][0] as string
    expect(output).toContain('[MAX_DEPTH]')
    stderrSpy.mockRestore()
  })

  it('redacts password patterns in string values', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Config line', { config: 'password: "mypass123"' })
    const output = stderrSpy.mock.calls[0][0] as string
    expect(output).not.toContain('mypass123')
    stderrSpy.mockRestore()
  })

  it('sanitizes arrays of objects', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Array data', [{ password: 'hidden' }, 'normal', 42])
    const output = stderrSpy.mock.calls[0][0] as string
    const parsed = JSON.parse(output)
    expect(parsed.data[0].password).toBe('[REDACTED]')
    expect(parsed.data[1]).toBe('normal')
    expect(parsed.data[2]).toBe(42)
    stderrSpy.mockRestore()
  })

  it('redacts content, notes, and body keys', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'PII', { content: 'private note', notes: 'personal', body: 'letter text', id: 1 })
    const parsed = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(parsed.data.content).toBe('[REDACTED]')
    expect(parsed.data.notes).toBe('[REDACTED]')
    expect(parsed.data.body).toBe('[REDACTED]')
    expect(parsed.data.id).toBe(1)
    stderrSpy.mockRestore()
  })
})

describe('Logger — level filtering', () => {
  it('respects minimum log level (info skips debug)', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.debug('test', 'Debug message')
    expect(stderrSpy).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it('logs warn and error at info level', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.warn('test', 'Warning')
    logger.error('test', 'Error')
    expect(stderrSpy).toHaveBeenCalledTimes(2)
    stderrSpy.mockRestore()
  })

  it('logs info at info level', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Info message')
    expect(stderrSpy).toHaveBeenCalledTimes(1)
    stderrSpy.mockRestore()
  })
})

describe('Logger — file output', () => {
  it('writes structured JSON to log file in packaged mode', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'File write test')
    stderrSpy.mockRestore()

    const logPath = join(tmpLogDir, 'pulse-main.log')
    expect(existsSync(logPath)).toBe(true)
    const content = readFileSync(logPath, 'utf-8')
    expect(content).toContain('File write test')
    const parsed = JSON.parse(content.trim())
    expect(parsed.level).toBe('info')
    expect(parsed.component).toBe('test')
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('rotates log file when exceeding 5MB', async () => {
    const logPath = join(tmpLogDir, 'pulse-main.log')
    const fivePointOneMb = Buffer.alloc(5 * 1024 * 1024 + 100, 'x')
    mkdirSync(tmpLogDir, { recursive: true })
    writeFileSync(logPath, fivePointOneMb)

    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'After rotation')
    stderrSpy.mockRestore()

    const rotatedPath = join(tmpLogDir, 'pulse-main.log.1')
    expect(existsSync(rotatedPath)).toBe(true)
    const newContent = readFileSync(logPath, 'utf-8')
    expect(newContent).toContain('After rotation')
  })

  it('includes data fields in JSON output', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.warn('db', 'Slow query', { duration: 150 })
    stderrSpy.mockRestore()

    const logPath = join(tmpLogDir, 'pulse-main.log')
    const content = readFileSync(logPath, 'utf-8')
    const parsed = JSON.parse(content.trim())
    expect(parsed.level).toBe('warn')
    expect(parsed.component).toBe('db')
    expect(parsed.msg).toBe('Slow query')
    expect(parsed.data.duration).toBe(150)
  })
})

describe('Logger — edge cases', () => {
  it('handles null data', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Null data', null)
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(output.data).toBeNull()
    stderrSpy.mockRestore()
  })

  it('omits data field when undefined', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'No data')
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect('data' in output).toBe(false)
    stderrSpy.mockRestore()
  })

  it('preserves boolean and number primitives', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Primitives', { flag: true, count: 42 })
    const output = JSON.parse(stderrSpy.mock.calls[0][0] as string)
    expect(output.data.flag).toBe(true)
    expect(output.data.count).toBe(42)
    stderrSpy.mockRestore()
  })

  it('writes multiple log entries as separate lines', async () => {
    const logger = await getLogger()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    logger.info('test', 'Line one')
    logger.info('test', 'Line two')
    logger.warn('test', 'Line three')
    stderrSpy.mockRestore()

    const logPath = join(tmpLogDir, 'pulse-main.log')
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).msg).toBe('Line one')
    expect(JSON.parse(lines[2]).level).toBe('warn')
  })
})
