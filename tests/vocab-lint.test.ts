/**
 * The lint rule that keeps record/list/note words out of hard-coded JSX
 * (they must come from the vocabulary layer).
 */
import { describe, it, expect } from 'vitest'
import { Linter } from 'eslint'
import tsparser from '@typescript-eslint/parser'
// @ts-expect-error -- plain .mjs config module without types
import { vocabRuleOptions, vocabNotYetConverted, vocabMainRuleOptions, vocabRendererTsRuleOptions } from '../eslint/vocab-rule.mjs'

const linter = new Linter({ configType: 'flat' })
const lint = (code: string) => linter.verify(code, [{
  files: ['**/*.tsx'],
  languageOptions: { parser: tsparser, parserOptions: { ecmaFeatures: { jsx: true } } },
  rules: { 'no-restricted-syntax': ['error', ...vocabRuleOptions] },
}], 'x.tsx')
const lintTs = (code: string, options: unknown[]) => linter.verify(code, [{
  files: ['**/*.ts'],
  languageOptions: { parser: tsparser },
  rules: { 'no-restricted-syntax': ['error', ...options] },
}], 'x.ts')
const lintMain = (code: string) => lintTs(code, vocabMainRuleOptions)
const lintRendererTs = (code: string) => lintTs(code, vocabRendererTsRuleOptions)

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

  // The generic defaults leaked into workspaces that say "client", "case note" or "provider" (R7)
  it('flags the generic record, note and contact words in labels and toasts', () => {
    expect(lint('const a = <button title="Open the record" />')).toHaveLength(1)
    expect(lint('const a = <button title={on ? "Sort contacts" : "x"} />')).toHaveLength(1)
    expect(lint('const a = <button aria-label={`Attach a file to this note ${n}`} />')).toHaveLength(1)
    expect(lint('toast.success("No records or notes were changed")')).toHaveLength(1)
    expect(lint('toast(`Removed ${n} records`)')).toHaveLength(1)
    expect(lint('toast.error(`Clients ${n}`)')).toHaveLength(1)
  })

  it('leaves the plain meanings and vocabulary calls alone', () => {
    expect(lint('const a = <button title="Remove contact info" />')).toHaveLength(0)
    expect(lint('const a = <input placeholder="e.g. Last Contact Date" />')).toHaveLength(0)
    expect(lint('const a = <input placeholder="Notes (optional)" />')).toHaveLength(0)
    expect(lint('toast.error("We couldn\'t note the letter")')).toHaveLength(0)
    expect(lint("const a = <button title={`Open the ${t('record')}`} />")).toHaveLength(0)
    expect(lint("const a = <button title={w('record', { many: true })} />")).toHaveLength(0)
  })

  it('tracks which folders are still waiting for the word rollout', () => {
    // Shrinks to [] as the rollout converts each folder (W01 §2.3)
    expect(Array.isArray(vocabNotYetConverted)).toBe(true)
  })

  // A28-05: more human-services words, more props, renderer .ts files and the main process
  it('flags the other human-services words and the props that carry text', () => {
    expect(lint('const a = <p>Linked providers</p>')).toHaveLength(1)
    expect(lint('const a = <p>Acuity</p>')).toHaveLength(1)
    expect(lint('const a = <p>For social workers and care coordinators</p>')).toHaveLength(1)
    expect(lint('const a = <Dialog message="Archive this client?" />')).toHaveLength(1)
    expect(lint('const a = <Dialog confirmLabel="Remove provider" />')).toHaveLength(1)
    expect(lint('const a = <Empty emptyText={`No contact requirements yet`} />')).toHaveLength(1)
    expect(lint('const a = <Tip content="Each case manager sees this" />')).toHaveLength(1)
    // the About page's authorship line is a fact, and "Record minutes" is a verb
    expect(lint('const a = <p>Built by a care coordinator, for anyone</p>')).toHaveLength(0)
    expect(lint('const a = <Offer message={`Record minutes on ${t("activity")}?`} />')).toHaveLength(0)
  })

  it('flags words in renderer .ts toasts and setError', () => {
    expect(lintRendererTs('toast.error("Could not save the client")')).toHaveLength(1)
    expect(lintRendererTs('setError(`Choose a caseload first`)')).toHaveLength(1)
    expect(lintRendererTs('setError("Pick the record to open")')).toHaveLength(1)
    expect(lintRendererTs("setError(`Choose ${t('list', { article: true })} first`)")).toHaveLength(0)
  })

  it('flags human-services words in main-process messages, PDF text and table heads', () => {
    expect(lintMain("return fail('That client no longer exists.')")).toHaveLength(1)
    expect(lintMain('throw new StageError(`The caseload ${n} is gone`)')).toHaveLength(1)
    expect(lintMain("doc.text('Case notes', 10, 20)")).toHaveLength(1)
    expect(lintMain("sectionTitle('Linked providers')")).toHaveLength(1)
    expect(lintMain("const t = { head: [['Client', 'Due']] }")).toHaveLength(1)
    expect(lintMain("const t = { title: 'Acuity summary' }")).toHaveLength(1)
  })

  it('leaves developer messages and vocabulary calls in the main process alone', () => {
    expect(lintMain("return fail('Invalid provider ID')")).toHaveLength(0)
    expect(lintMain("return fail('Expected an array of providers')")).toHaveLength(0)
    expect(lintMain("throw new Error('Too many provider IDs requested')")).toHaveLength(0)
    expect(lintMain("throw new Error('provider row missing')")).toHaveLength(0)
    expect(lintMain("return fail(`That ${word('record')} no longer exists.`)")).toHaveLength(0)
    expect(lintMain("doc.text(`${word('record', { cap: true })} profile`, 10, 20)")).toHaveLength(0)
  })
})
