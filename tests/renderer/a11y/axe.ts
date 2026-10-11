/**
 * Automated accessibility check (audit A06-33): runs axe-core over a rendered
 * jsdom container and fails with a readable list of what's wrong.
 *
 * jsdom has no layout or painting, so rules that need real rendering
 * (colour contrast, target size, scrollable regions) are turned off here.
 * Contrast is covered by tests/renderer/contrast.test.ts and
 * tests/renderer/a11y/urgencyContrast.test.ts instead.
 */
import axe from 'axe-core'
import { expect } from 'vitest'

const JSDOM_UNSUPPORTED_RULES = [
  'color-contrast',
  'color-contrast-enhanced',
  'link-in-text-block',
  'target-size',
  'scrollable-region-focusable',
  // A component rendered on its own has no page landmarks or <h1> around it
  'region',
  'page-has-heading-one',
  'landmark-one-main',
  'bypass',
  'document-title',
  'html-has-lang',
]

export interface AxeCheckOptions {
  /** More rules to turn off, with a reason in the calling test */
  disableRules?: string[]
}

export function formatViolations(violations: axe.Result[]): string {
  return violations.map(v => {
    const nodes = v.nodes.slice(0, 5).map(n => `    - ${n.target.join(' ')}\n      ${n.html.slice(0, 160)}\n      ${n.failureSummary?.split('\n').join(' ') ?? ''}`).join('\n')
    const more = v.nodes.length > 5 ? `\n    …and ${v.nodes.length - 5} more` : ''
    return `[${v.impact ?? 'n/a'}] ${v.id}: ${v.help}\n${nodes}${more}`
  }).join('\n\n')
}

export async function axeViolations(container: Element, options: AxeCheckOptions = {}): Promise<axe.Result[]> {
  const rules: axe.RuleObject = {}
  for (const id of [...JSDOM_UNSUPPORTED_RULES, ...(options.disableRules ?? [])]) rules[id] = { enabled: false }
  const results = await axe.run(container, {
    rules,
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
    resultTypes: ['violations'],
  })
  return results.violations
}

export async function expectNoAxeViolations(container: Element, options: AxeCheckOptions = {}): Promise<void> {
  const violations = await axeViolations(container, options)
  expect(violations.length, `Accessibility problems found:\n\n${formatViolations(violations)}`).toBe(0)
}
