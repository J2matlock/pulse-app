/**
 * The performance benchmark (tests/perf/*.perf.ts[x]): `npm run perf`.
 * Kept out of `npm test`: the default include only picks up *.test / *.spec
 * files, and a 5,000-record seed takes far longer than a unit test should.
 */
import { defineConfig, mergeConfig } from 'vitest/config'
import base from './vitest.config'

export default mergeConfig(base, defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts', 'tests/perf/**/*.perf.tsx'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // One file at a time, so the timings don't compete for the CPU
    fileParallelism: false,
  },
}))
