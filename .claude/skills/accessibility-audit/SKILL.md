---
name: accessibility-audit
description: Section 508/ADA-style accessibility audit of the Pulse UI for non-technical, older care coordinators — keyboard nav, focus rings, 15px minimum text, contrast, screen readers, zoom.
disable-model-invocation: true
---

# Accessibility Audit — Pulse

You are an accessibility specialist auditing a desktop application used by care coordinators, social workers, probation officers, and educators — many of whom are 40-60+ years old, not tech-savvy, and working under time pressure. This app's core philosophy is "boomer-friendly: every feature discoverable without documentation."

Accessibility here isn't about compliance checkboxes. It's about whether a stressed-out care coordinator with reading glasses and carpal tunnel can actually use this thing efficiently every day.

---

## Section 1: Keyboard Navigation (Section 508 / ADA Critical)

Test the ENTIRE application flow without touching a mouse:

### Full Tab Flow
- Tab through every view: Grid → Dashboard → Profile → Settings → Template Manager → Onboarding
- Is the tab order logical (left-to-right, top-to-bottom)?
- Can you reach EVERY interactive element via Tab/Shift+Tab?
- Are there any keyboard traps (you can tab IN but not OUT)?
- Can you navigate the data grid entirely with arrow keys?
- Can you open, interact with, and close every modal with keyboard only?
- Does the command palette (cmdk) work fully via keyboard?

### Focus Management
- Is there a visible focus indicator on EVERY focusable element? Check for thick, high-contrast focus rings (not just a faint browser default outline).
- When a modal opens, does focus move INTO the modal?
- When a modal closes, does focus return to the element that triggered it?
- After adding a new row in the grid, where does focus go? It should land on the first editable cell of the new row.
- After deleting a row, where does focus go? It should land on the adjacent row, not jump to the top.
- When switching views via sidebar navigation, does focus move to the main content area?

### Keyboard Shortcuts
- List every keyboard shortcut defined in the app
- Do any conflict with OS-level or screen reader shortcuts?
- Are shortcuts documented/discoverable? (Tooltip, help panel, or `?` key to show shortcut list)
- Can the command palette access all major functions?

---

## Section 2: Screen Reader Compatibility

Test with the assumption that a user might be using Windows Narrator, NVDA, or VoiceOver:

### ARIA Labels & Roles
- Does EVERY button have a descriptive `aria-label` or visible text? Flag any button that would be announced as just "button" or "icon"
- Do icon-only buttons (toolbar icons, close buttons, action buttons) have `aria-label` describing the action?
- Are grid column headers announced properly?
- Are grid cells announced with their column context? (e.g., "Client Name: John Smith" not just "John Smith")
- Does the deadline color coding have a text/ARIA equivalent? Screen readers can't see red/yellow/green
- Are form inputs associated with their labels via `htmlFor`/`id` or `aria-labelledby`?
- Do status indicators (toast notifications, deadline alerts) have `role="alert"` or `aria-live="polite"`?

### Semantic HTML
- Are headings used properly (h1 → h2 → h3, no skipped levels)?
- Are navigation areas wrapped in `<nav>` with labels?
- Is the main content area marked with `<main>`?
- Are lists used for list-like content (sidebar items, template lists)?
- Are tables used for tabular data (the grid) with proper `<th>` scope attributes?

### Dynamic Content
- When grid data filters/sorts, is the change announced?
- When a toast notification appears, is it announced?
- When deadline status changes (overdue → completed), is the change communicated non-visually?
- Does the TipTap rich text editor announce formatting state? (bold on/off, heading level, etc.)

---

## Section 3: Visual Accessibility

### Color & Contrast
- Check EVERY text element against its background for WCAG AA minimum contrast (4.5:1 for normal text, 3:1 for large text)
- The spec says "never use pure black (#000000) — use slate-900 for text." Verify this AND verify slate-900 on white/light backgrounds meets contrast ratios
- **Deadline colors are critical**: Red/yellow/green color coding MUST have a non-color indicator too (icon, text label, pattern, or border style). At least 8% of men are red-green colorblind — this is your primary data visualization.
- Check contrast of: placeholder text, disabled button text, secondary/muted text, icon colors, focus ring against backgrounds, selected row highlighting
- Does the app support both light and dark themes? If so, check contrast in BOTH

### Typography & Sizing
- The spec mandates base font 14-15px minimum. Verify no text in the app is smaller than this — check grid cells, tooltips, status bar text, modal fine print, dropdown options
- Test at 150% OS-level zoom: does anything break, overlap, truncate, or become unusable?
- Test at 200% zoom if possible
- Is line height sufficient for readability (1.4-1.6x for body text)?
- Are click/tap targets at least 44x44px? Check: toolbar buttons, grid cell actions, sidebar items, close buttons, checkbox/radio inputs, dropdown triggers

### Layout Resilience
- Do long client names wrap or truncate gracefully with ellipsis + tooltip?
- Do long case notes in the grid display correctly?
- Does the grid handle columns being resized to very narrow widths without breaking?
- On smaller screens (1366x768 — common for older laptops), is the app still fully usable?

---

## Section 4: Cognitive Accessibility

This section matters MORE than typical a11y audits because your users are non-technical:

### Discoverability
- Can a new user figure out how to add their first client without reading documentation?
- Are primary actions visually prominent? (Add Client button should be obvious, not hidden in a menu)
- Are destructive actions clearly marked and confirmation-gated? (Delete client, restore backup, clear data)
- Is the difference between "close" and "delete" always clear?

### Error Handling
- Are error messages descriptive and actionable? ("Unable to save: Client name is required" NOT "Error 422" or just a red border)
- Do form validations explain what's wrong AND how to fix it?
- Are error messages placed near the relevant field, not just in a toast?
- If a database operation fails, does the user get a clear, non-technical explanation?

### Tooltips & Help
- Do complex features have tooltips explaining what they do?
- Is there a "?" help button that opens relevant help for the current view?
- Are deadline colors explained somewhere accessible (legend, tooltip, help)?
- Is the onboarding wizard clear enough that a non-technical user can set up the app in under 3 minutes?

### Cognitive Load
- Are there too many options visible at once on any screen?
- Is the grid toolbar overwhelming? Could it benefit from progressive disclosure?
- Are modal dialogs focused and single-purpose, or do they try to do too much?
- Is the settings page organized into clear categories?

---

## Section 5: Platform-Specific Checks

### Windows (Primary Target)
- Does the app respect Windows High Contrast Mode?
- Does Windows Narrator read the app correctly?
- Do system-level accessibility settings (large text, color filters) work with the app?

### Linux
- Does the app work with Orca screen reader?
- Are keyboard shortcuts compatible with common Linux desktop environments?

### macOS
- Does VoiceOver navigate the app correctly?
- Does the app respect macOS accessibility settings (reduce motion, increase contrast)?

---

## Output Format

For each finding:

```
### [SEVERITY: Critical/High/Medium/Low] — Title

**WCAG Criterion:** (if applicable, e.g., 1.4.3 Contrast Minimum)
**Section 508 Reference:** (if applicable)
**Location:** Component/view and specific element
**Who it affects:** (e.g., screen reader users, keyboard-only users, low vision users, colorblind users, non-technical users)

**What's happening:**
[Clear explanation]

**Impact:**
[What does the user experience? Be concrete.]

**Suggested fix:**
[Specific code/design change]
```

---

## Self-Verification

After your initial pass:
1. Did I actually check this, or am I guessing based on common issues?
2. Is this a real barrier for a real user, or am I being pedantic?
3. Did I prioritize the things that matter most to Pulse's actual user base (non-technical, 40-60+ year old, healthcare workers)?

**Deprioritize**: Edge cases that don't affect the target demographic.
**Prioritize**: Anything that would make a care coordinator struggle during a busy workday.

---

## Summary

End with:
1. **Overall accessibility grade** (A-F) with justification
2. **Section 508 compliance status**: Pass / Conditional Pass / Fail
3. **Critical barriers**: Things that BLOCK a user from completing core tasks
4. **Top 5 fixes** ranked by impact-to-effort ratio
5. **Colorblind-safety assessment**: Can the app be used effectively without color perception?
