import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    testTimeout: 10000,
    hookTimeout: 10000,
    // Agent worktrees under .claude/ hold whole copies of the repo (and its node_modules)
    exclude: ['e2e/**', 'node_modules/**', '.claude/**'],
    globalSetup: ['tests/globalSetup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/**/*.ts',
        'src/renderer/utils/**/*.ts',
        'src/renderer/stores/**/*.ts',
        'src/renderer/components/**/*.tsx',
        'src/renderer/views/**/*.tsx',
        'src/renderer/hooks/**/*.ts',
        'src/shared/**/*.ts',
      ],
      exclude: ['src/main/main.ts', 'src/**/*.d.ts'],
      thresholds: {
        lines: 70,
        branches: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer'),
    },
  },
})
