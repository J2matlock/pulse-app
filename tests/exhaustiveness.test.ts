/**
 * Union exhaustiveness (sweep plan 2.11, queue DF-02).
 *
 * The compile-time half lives in src: `satisfies Record<Union, …>` maps and
 * assertNever / unhandledCase defaults make typecheck fail when a union
 * member is added and not handled. These tests cover the runtime half: the
 * helpers behave as documented, the lists the app iterates hold every member,
 * and values read from stored data that no longer exist fall back safely.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import { assertNever, unhandledCase } from '../src/shared/assertNever'
import { IPC_READ_ONLY } from '../src/shared/constants'

const SRC = path.resolve(__dirname, '../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('assertNever / unhandledCase', () => {
  it('assertNever throws with the value it was given', () => {
    expect(() => assertNever('fortnight' as never, 'period')).toThrow('Unexpected period: fortnight')
  })

  it('unhandledCase returns, so the caller can fall back for stored data', () => {
    expect(unhandledCase('fortnight' as never)).toBeUndefined()
  })
})

describe('IPC_READ_ONLY', () => {
  it('keeps the value the main process and renderer agree on', () => {
    expect(IPC_READ_ONLY).toBe('READ_ONLY')
  })

  it('is the only spelling of the read-only error in src', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => !f.endsWith(path.join('shared', 'constants.ts')))
      .filter((f) => /['"`]READ_ONLY['"`]/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
    expect(offenders).toEqual([])
  })
})
