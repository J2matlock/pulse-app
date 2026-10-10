import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import security from 'eslint-plugin-security'
import reactHooks from 'eslint-plugin-react-hooks'
import { vocabRuleOptions, vocabNotYetConverted } from './eslint/vocab-rule.mjs'

const undoInvokeRule = {
  selector: "Property[key.name=/^(undo|redo)$/] CallExpression[callee.name='safeInvoke']",
  message: 'Use mustInvoke() inside undo/redo callbacks so a failure is reported instead of looking like success.',
}

export default [
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      security,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // Security
      'security/detect-object-injection': 'off', // too noisy for bracket access
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'warn',
      'security/detect-buffer-noassert': 'warn',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-child-process': 'warn',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General quality
      'no-eval': 'error',
      'no-implied-eval': 'error',
    },
  },
  {
    // Undo must fail loudly (audit L-08): safeInvoke never throws, so a failed undo looked like success
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    rules: { 'no-restricted-syntax': ['error', undoInvokeRule] },
  },
  {
    // User-facing record/list/note words come from the vocabulary layer
    files: ['src/renderer/**/*.tsx'],
    ignores: vocabNotYetConverted,
    rules: { 'no-restricted-syntax': ['error', ...vocabRuleOptions, undoInvokeRule] },
  },
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.*', 'eslint/**'],
  },
]
