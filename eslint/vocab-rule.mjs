/**
 * Words like "client" and "caseload" (and the internal "grid") must come from the vocabulary layer
 * (src/shared/vocab.ts, useVocab / <V>), so users' own words show everywhere.
 * See plans/generalization/W01-workspace.md §2.4.
 */
const WORDS = String.raw`\b(clients?|caseloads?|case (notes?|log)|grids?)\b`

/**
 * The generic defaults ("record", "note", "contact") leak just the same: a
 * workspace that says "client" shouldn't read "Open the record". These words
 * also have plain meanings ("contact info", "a record of every change",
 * "Notes (optional)", "note the letter"), so this only matches the forms that
 * are nearly always the vocabulary word: "record(s)", "contacts", and "contact"
 * or "note(s)" after a word like "this", "new" or "no". It's checked in
 * tooltips, labels and toasts, where the words come up most; screen text
 * (JSXText) has too many plain uses to check this way.
 */
const GENERIC = String.raw`\b(records?|contacts|(a|this|that|each|every|new|selected|no) contact(?! (info|date|requirement))|(a|this|that|each|every|new|no|or|and|your|the) notes?)\b`

const MESSAGE = 'Use the vocabulary layer (useVocab / <V>) for record, list and note words.'
const ATTR = String.raw`^(placeholder|title|aria-label|label)$`

/** Plain strings and template-literal text in labels and toast() calls */
const inLabelsAndToasts = words => [
  `JSXAttribute[name.name=/${ATTR}/] Literal[value=/${words}/i]:not(CallExpression > Literal[value=/^\\w+$/])`,
  `JSXAttribute[name.name=/${ATTR}/] TemplateElement[value.raw=/${words}/i]`,
  `CallExpression[callee.name='toast'] > Literal[value=/${words}/i]`,
  `CallExpression[callee.object.name='toast'] > Literal[value=/${words}/i]`,
  `CallExpression[callee.name='toast'] > TemplateLiteral > TemplateElement[value.raw=/${words}/i]`,
  `CallExpression[callee.object.name='toast'] > TemplateLiteral > TemplateElement[value.raw=/${words}/i]`,
]

export const vocabRuleOptions = [
  `JSXText[value=/${WORDS}/i]`,
  ...inLabelsAndToasts(WORDS),
  ...inLabelsAndToasts(GENERIC),
].map(selector => ({ selector, message: MESSAGE }))

/**
 * Not converted yet. Each word-rollout commit removes its folder from this
 * list, so the rule then guards it for good. The list ends empty.
 */
export const vocabNotYetConverted = [
]
