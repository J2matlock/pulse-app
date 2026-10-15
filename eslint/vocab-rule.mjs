/**
 * Words like "client" and "caseload" (and the internal "grid") must come from the vocabulary layer
 * (src/shared/vocab.ts, useVocab), so users' own words show everywhere.
 * See plans/generalization/W01-workspace.md §2.4.
 */
const WORDS = String.raw`\b(clients?|caseloads?|case (notes?|logs?)|grids?|providers?|acuity|case managers?|social workers?|care coordinators?|contact requirements?)\b`

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

const MESSAGE = 'Use the vocabulary layer (useVocab) for record, list and note words.'
/** Props whose text people read; the generic words are checked only in the first four (see D-033) */
const ATTR = String.raw`^(placeholder|title|aria-label|label)$`
const ATTR_ALL = String.raw`^(placeholder|title|aria-label|label|content|message|description|confirmLabel|emptyText|intro|menuLabel)$`

/** Plain strings and template-literal text in labels and toast() calls */
const inLabelsAndToasts = (words, attr = ATTR) => [
  `JSXAttribute[name.name=/${attr}/] Literal[value=/${words}/i]:not(CallExpression > Literal[value=/^\\w+$/])`,
  `JSXAttribute[name.name=/${attr}/] TemplateElement[value.raw=/${words}/i]`,
  `CallExpression[callee.name='toast'] > Literal[value=/${words}/i]`,
  `CallExpression[callee.object.name='toast'] > Literal[value=/${words}/i]`,
  `CallExpression[callee.name='toast'] > TemplateLiteral > TemplateElement[value.raw=/${words}/i]`,
  `CallExpression[callee.object.name='toast'] > TemplateLiteral > TemplateElement[value.raw=/${words}/i]`,
]

/**
 * WORDS in a message, unless it's a developer message friendlyError replaces
 * with a plain fallback ("Invalid provider ID", "Expected an array of providers")
 */
const SHOWN_WORDS = String.raw`^(?!(Invalid|Expected|Too many)\b).*${WORDS}`

/** A plain string or template text passed straight to a call or constructor */
const argsOf = (callee, words) => [
  `${callee} > Literal[value=/${words}/i]`,
  `${callee} > TemplateLiteral > TemplateElement[value.raw=/${words}/i]`,
]

/**
 * Renderer .ts files (stores, hooks, utils) have no JSX; their words reach
 * people through toasts and setError(...).
 */
export const vocabRendererTsRuleOptions = [WORDS, GENERIC].flatMap(words => [
  ...argsOf(`CallExpression[callee.name='toast']`, words),
  ...argsOf(`CallExpression[callee.object.name='toast']`, words),
  ...argsOf(`CallExpression[callee.name='setError']`, words),
]).map(selector => ({ selector, message: MESSAGE }))

/**
 * Main-process text people read: fail(...) and the app's own errors (shown by
 * friendlyError), PDF text (doc.text, sectionTitle) and table heads and titles.
 * Only the human-services words are checked here: the generic ones have too
 * many plain uses in developer messages, and tests/vocab-main-generic-words
 * checks them in the messages friendlyError shows.
 */
export const vocabMainRuleOptions = [
  ...argsOf(`CallExpression[callee.name='fail']`, SHOWN_WORDS),
  // The app's own error classes; a plain Error/TypeError carries a developer message
  ...argsOf(`NewExpression[callee.name=/^(?!(Error|TypeError|RangeError)$)\\w+Error$/]`, SHOWN_WORDS),
  ...argsOf(`CallExpression[callee.object.name='doc'][callee.property.name='text']`, WORDS),
  ...argsOf(`CallExpression[callee.name='sectionTitle']`, WORDS),
  `Property[key.name=/^(head|title)$/] Literal[value=/${WORDS}/i]`,
  `Property[key.name=/^(head|title)$/] TemplateElement[value.raw=/${WORDS}/i]`,
].map(selector => ({ selector, message: MESSAGE }))

export const vocabRuleOptions = [
  // The About page's authorship line is a fact about Pulse, not a workspace word
  `JSXText[value=/${WORDS}/i]:not(JSXText[value=/Built by a care coordinator/])`,
  ...inLabelsAndToasts(WORDS, ATTR_ALL),
  ...inLabelsAndToasts(GENERIC),
].map(selector => ({ selector, message: MESSAGE }))

/**
 * Not converted yet. Each word-rollout commit removes its folder from this
 * list, so the rule then guards it for good. The list ends empty.
 */
export const vocabNotYetConverted = [
]
