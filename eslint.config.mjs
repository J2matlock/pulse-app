import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import security from 'eslint-plugin-security'
import reactHooks from 'eslint-plugin-react-hooks'
import { vocabRuleOptions, vocabNotYetConverted, vocabRendererTsRuleOptions, vocabMainRuleOptions } from './eslint/vocab-rule.mjs'

const undoInvokeRule = {
  selector: "Property[key.name=/^(undo|redo)$/] CallExpression[callee.name='safeInvoke']",
  message: 'Use mustInvoke() inside undo/redo callbacks so a failure is reported instead of looking like success.',
}

// Error toasts never show a raw IPC error: wrap it in friendlyError() (audit 2.15 / N-28)
const rawErrorToast = {
  selector: "CallExpression[callee.object.name='toast'][callee.property.name='error'] > MemberExpression.arguments:first-child[property.name='error']",
  message: 'Wrap the error in friendlyError(...) so people never see raw system text.',
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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],

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
    rules: { 'no-restricted-syntax': ['error', ...vocabRuleOptions, rawErrorToast, undoInvokeRule] },
  },
  {
    files: ['src/renderer/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...vocabRendererTsRuleOptions, rawErrorToast, undoInvokeRule] },
  },
  {
    // Main-process messages, PDF text and table heads use word()/vocabFor() (A28-05).
    // Migrations write the words existing installs keep, so they may name them.
    files: ['src/main/**/*.ts'],
    ignores: ['src/main/migrations/**'],
    rules: { 'no-restricted-syntax': ['error', ...vocabMainRuleOptions] },
  },
  {
    // These modules only ever touch Pulse's own files, at paths built from
    // getPortableDataDir() and fixed names (no path from the renderer, a dialog
    // or a file's contents reaches them): logger.ts (logs/ and its rotations),
    // auth.ts (pulse-secure.json, its .backup/.corrupt copies), database.ts
    // (resolveDatabasePath() = <data>/pulse.db and its -wal/-shm),
    // private-files.ts (chmod/mkdir on the data folder and electron-store files),
    // prefs.ts (<data>/pulse-prefs.json). Checked file by file in sweep Phase 4
    // (D-055); a module that takes a user-chosen path does not belong in this list,
    // which is why attachment-files.ts isn't here (saveAttachmentCopy takes the
    // save-dialog path, R5-03).
    files: [
      'src/main/logger.ts', 'src/main/auth.ts', 'src/main/database.ts',
      'src/main/private-files.ts', 'src/main/prefs.ts',
    ],
    rules: { 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**', '*.config.*', 'eslint/**'],
  },
]
