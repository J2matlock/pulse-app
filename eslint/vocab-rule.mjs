/**
 * Words like "client" and "caseload" (and the internal "grid") must come from the vocabulary layer
 * (src/shared/vocab.ts, useVocab / <V>), so users' own words show everywhere.
 * See plans/generalization/W01-workspace.md §2.4.
 */
const WORDS = String.raw`\b(clients?|caseloads?|case (notes?|log)|grids?)\b`

export const vocabRuleOptions = [
  {
    selector: `JSXText[value=/${WORDS}/i]`,
    message: 'Use the vocabulary layer (useVocab / <V>) for record, list and note words.',
  },
  {
    selector: `JSXAttribute[name.name=/^(placeholder|title|aria-label|label)$/] > Literal[value=/${WORDS}/i]`,
    message: 'Use the vocabulary layer (useVocab / <V>) for record, list and note words.',
  },
]

/**
 * Not converted yet. Each word-rollout commit removes its folder from this
 * list, so the rule then guards it for good. The list ends empty.
 */
export const vocabNotYetConverted = [
]
