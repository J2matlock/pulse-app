/**
 * The lint rule that keeps record/list/note words out of hard-coded JSX
 * (they must come from the vocabulary layer).
 */
import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import tsparser from '@typescript-eslint/parser'
// @ts-expect-error -- plain .mjs config module without types
import { vocabRuleOptions, vocabNotYetConverted } from '../eslint/vocab-rule.mjs'

const linter = new Linter({ configType: 'flat' })
const lint = (code: string) => linter.verify(code, [{
  files: ['**/*.tsx'],
  languageOptions: { parser: tsparser, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { 'no-restricted-syntax': ['error', ...vocabRuleOptions] },
}], 'x.tsx')

describe('vocabulary lint rule', () => {
  it('flags hard-coded words in JSX text and labels', () => {
    expect(lint('const a = <p>Add a client</p>')).toHaveLength(1)
    expect(lint('const a = <p>Your Caseloads</p>')).toHaveLength(1)
    expect(lint('const a = <h2>Case log</h2>')).toHaveLength(1)
    expect(lint('const a = <input placeholder="Search clients" />')).toHaveLength(1)
    expect(lint('const a = <button aria-label="New case note" />')).toHaveLength(1)
  })

  it('leaves other text alone', () => {
    expect(lint('const a = <p>Add {word}</p>')).toHaveLength(0)
    expect(lint('const a = <p>Clientele and showcase logs</p>')).toHaveLength(0)
    expect(lint('const a = <div className="client-row" />')).toHaveLength(0)
  })

  it('tracks which folders are still waiting for the word rollout', () => {
    // Shrinks to [] as the rollout converts each folder (W01 §2.3)
    expect(Array.isArray(vocabNotYetConverted)).toBe(true)
  })
})
