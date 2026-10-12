/**
 * defineHandler (src/main/ipc/ipc-define.ts): the declarative IPC handler.
 * It must register through secureWrap (sender check + humanized errors), gate
 * writes before anything else, check arguments in order with each schema's own
 * message, and hand the body the parsed arguments.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { z } from 'zod'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
const logged = vi.hoisted(() => ({ errors: [] as Array<{ component: string; channel?: string }> }))

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp' },
  ipcMain: { handle: (channel: string, h: (...args: unknown[]) => unknown) => { handlers.set(channel, h) } },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
}))
vi.mock('../src/main/logger', () => ({
  logger: {
    info: () => {}, warn: () => {}, debug: () => {},
    error: (component: string, _message: string, meta?: { channel?: string }) => { logged.errors.push({ component, channel: meta?.channel }) },
  },
}))
vi.mock('../src/main/data-dir', () => ({ getPortableDataDir: () => '/tmp' }))

import { defineHandler, handlersFor, idArg, textArg, schemaArg } from '../src/main/ipc/ipc-define'
import { ok, fail, registerReadOnlyChecker, GENERIC_ERROR_MESSAGE } from '../src/main/ipc/ipc-utils'
import { IPC_READ_ONLY } from '../src/shared/constants'

const pulseFrame = { senderFrame: { parent: null, url: 'app://bundle/index.html' } }
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(pulseFrame, ...args)

beforeEach(() => { handlers.clear(); logged.errors.length = 0 })
afterEach(() => { registerReadOnlyChecker(null) })

describe('defineHandler', () => {
  it('registers through secureWrap: subframes and foreign pages are refused before the body runs', async () => {
    const body = vi.fn(() => ok(true))
    defineHandler('test:wrapped', 'ipc-test', [], body)
    expect(await handlers.get('test:wrapped')!({ senderFrame: { parent: {}, url: 'app://bundle/index.html' } }))
      .toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(await handlers.get('test:wrapped')!({ senderFrame: { parent: null, url: 'https://example.com/' } }))
      .toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(await handlers.get('test:wrapped')!({ senderFrame: { parent: null, url: '' } }))
      .toEqual({ ok: false, error: 'Unauthorized IPC sender' })
    expect(body).not.toHaveBeenCalled()
    expect(await call('test:wrapped')).toEqual({ ok: true, data: true })
  })

  it('a thrown error is logged under the component and channel and answered with a plain sentence', async () => {
    defineHandler('test:throws', 'ipc-test', [], () => { throw new TypeError('x is undefined') })
    expect(await call('test:throws')).toEqual({ ok: false, error: GENERIC_ERROR_MESSAGE })
    expect(logged.errors).toEqual([{ component: 'ipc-test', channel: 'test:throws' }])
  })

  it('awaits an async body, and a rejected one is humanized too', async () => {
    defineHandler('test:async', 'ipc-test', [idArg()], async (id) => ok(id * 2))
    defineHandler('test:rejects', 'ipc-test', [], async () => { throw new Error('UNIQUE constraint failed: tags.name') })
    expect(await call('test:async', 4)).toEqual({ ok: true, data: 8 })
    expect(await call('test:rejects')).toEqual({ ok: false, error: "There's already a tag called that." })
  })

  it('a write is refused with IPC_READ_ONLY while read-only, before its arguments are checked', async () => {
    const body = vi.fn(() => ok(true))
    defineHandler('test:write', 'ipc-test', [idArg()], body, { write: true })
    registerReadOnlyChecker(() => true)
    expect(await call('test:write', 'not an id')).toEqual({ ok: false, error: IPC_READ_ONLY })
    expect(await call('test:write', 1)).toEqual({ ok: false, error: IPC_READ_ONLY })
    expect(body).not.toHaveBeenCalled()
    registerReadOnlyChecker(() => false)
    expect(await call('test:write', 1)).toEqual({ ok: true, data: true })
  })

  it('a read is not gated', async () => {
    defineHandler('test:read', 'ipc-test', [], () => ok('data'))
    registerReadOnlyChecker(() => true)
    expect(await call('test:read')).toEqual({ ok: true, data: 'data' })
  })

  it('checks arguments in order and answers the first failing schema\'s message', async () => {
    const body = vi.fn(() => ok(true))
    defineHandler('test:args', 'ipc-test', [
      idArg(),
      z.string('Invalid name').min(1, 'Invalid name').max(5, 'Invalid name'),
      z.string('Invalid color'),
    ], body)
    expect(await call('test:args', 0, 'a', 'red')).toEqual({ ok: false, error: 'Invalid ID' })
    expect(await call('test:args', 1, 7, 7)).toEqual({ ok: false, error: 'Invalid name' })
    expect(await call('test:args', 1, '', 'red')).toEqual({ ok: false, error: 'Invalid name' })
    expect(await call('test:args', 1, 'toolong', 'red')).toEqual({ ok: false, error: 'Invalid name' })
    expect(await call('test:args', 1, 'ok', null)).toEqual({ ok: false, error: 'Invalid color' })
    expect(body).not.toHaveBeenCalled()
  })

  it('a missing argument is checked as undefined; arguments past the list are ignored', async () => {
    const body = vi.fn((a: number, b: string | undefined) => ok([a, b]))
    defineHandler('test:arity', 'ipc-test', [idArg(), z.string('Invalid note').optional()], body)
    expect(await call('test:arity')).toEqual({ ok: false, error: 'Invalid ID' })
    expect(await call('test:arity', 3)).toEqual({ ok: true, data: [3, undefined] })
    expect(await call('test:arity', 3, 'x', 'extra', 99)).toEqual({ ok: true, data: [3, 'x'] })
    expect(body).toHaveBeenLastCalledWith(3, 'x')
  })

  it('hands the body the parsed values', async () => {
    defineHandler('test:parsed', 'ipc-test', [z.looseObject({ name: z.string('Invalid name') })], (o) => ok(o))
    const input = { name: 'a', extra: 1 }
    expect(await call('test:parsed', input)).toEqual({ ok: true, data: { name: 'a', extra: 1 } })
  })

  it('the body\'s own fail() passes through unchanged', async () => {
    defineHandler('test:own-fail', 'ipc-test', [], () => fail('No valid fields to update'))
    expect(await call('test:own-fail')).toEqual({ ok: false, error: 'No valid fields to update' })
  })
})

describe('idArg', () => {
  it.each([[null], [undefined], [0], [-1], [1.5], [NaN], [Infinity], ['1'], [{}]])('refuses %s with Invalid ID', (value) => {
    expect(idArg().safeParse(value)).toMatchObject({ success: false, error: { issues: [{ message: 'Invalid ID' }] } })
  })

  it('accepts positive integers, as validId does', () => {
    expect(idArg().safeParse(1)).toMatchObject({ success: true, data: 1 })
    expect(idArg().safeParse(2 ** 60)).toMatchObject({ success: true })
  })

  it('can say something else', () => {
    expect(idArg('Invalid record').safeParse(0)).toMatchObject({ success: false, error: { issues: [{ message: 'Invalid record' }] } })
  })
})

describe('textArg', () => {
  const msg = (r: { success: boolean; error?: { issues: Array<{ message: string }> } }) => r.success ? 'ok' : r.error!.issues.map(i => i.message)

  it('refuses anything but a string with its message', () => {
    for (const v of [undefined, null, 1, {}, ['a']]) expect(msg(textArg('Invalid name').safeParse(v))).toEqual(['Invalid name'])
  })

  it('applies min and max in String.length units, every issue with the same message', () => {
    const t = textArg('Invalid name', { min: 1, max: 3 })
    expect(msg(t.safeParse(''))).toEqual(['Invalid name'])
    expect(msg(t.safeParse('abcd'))).toEqual(['Invalid name'])
    expect(msg(t.safeParse('abc'))).toBe('ok')
    // An emoji is two UTF-16 units, as String.length counts it
    expect(msg(t.safeParse('a\u{1F600}'))).toBe('ok')
    expect(msg(t.safeParse('ab\u{1F600}'))).toEqual(['Invalid name'])
  })

  it('notBlank refuses text that is only spaces, as !s.trim() did', () => {
    const t = textArg('Invalid view name', { max: 200, notBlank: true })
    expect(msg(t.safeParse('   '))).toEqual(['Invalid view name'])
    expect(msg(t.safeParse(''))).toEqual(['Invalid view name'])
    expect(msg(t.safeParse(' a '))).toBe('ok')
    expect(t.safeParse(' a ')).toMatchObject({ data: ' a ' })
  })

  it('without limits takes any string, the empty one included', () => {
    expect(msg(textArg('Invalid').safeParse(''))).toBe('ok')
  })
})

describe('schemaArg', () => {
  const patch = z.object({ trayMode: z.boolean('needs a boolean') }).partial().strict()

  it('answers its one message whatever the schema says', () => {
    for (const v of [undefined, null, 'x', { trayMode: 'yes' }, { other: true }]) {
      expect(schemaArg(patch, 'That setting isn\'t valid.').safeParse(v))
        .toMatchObject({ success: false, error: { issues: [{ message: 'That setting isn\'t valid.' }] } })
    }
  })

  it('hands on the schema\'s parsed value', () => {
    const trimmed = z.object({ name: z.string().trim() })
    expect(schemaArg(trimmed, 'Invalid').safeParse({ name: ' a ', extra: 1 })).toMatchObject({ success: true, data: { name: 'a' } })
    expect(schemaArg(patch, 'Invalid').safeParse({})).toMatchObject({ success: true, data: {} })
  })
})

describe('handlersFor', () => {
  it('fills in the component and passes the options on', async () => {
    const define = handlersFor('ipc-grouped')
    define('test:grouped', [idArg()], () => { throw new RangeError('bad') }, { write: true })
    registerReadOnlyChecker(() => true)
    expect(await call('test:grouped', 1)).toEqual({ ok: false, error: IPC_READ_ONLY })
    registerReadOnlyChecker(null)
    expect(await call('test:grouped', 1)).toEqual({ ok: false, error: GENERIC_ERROR_MESSAGE })
    expect(logged.errors).toEqual([{ component: 'ipc-grouped', channel: 'test:grouped' }])
  })
})
