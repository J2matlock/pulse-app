# Feature Plan: TOS Acceptance in Onboarding

## Summary
Add a Terms of Service + Privacy Policy acceptance step to the onboarding wizard, shown once on first setup. The step appears between "welcome" and "role" — the user must agree before proceeding.

## Links
- Terms of Service: https://www.baringasoft.com/terms.html
- Privacy Policy: https://www.baringasoft.com/privacy.html

## Design

### New wizard step: `terms`
- Inserted after `welcome`, before `role`
- Flow becomes: `welcome -> terms -> role -> profile -> path -> ...`

### UI layout
- Heading: "Terms of Service"
- Short explanatory text: "Please review and accept our Terms of Service and Privacy Policy to continue."
- Two clickable links that open in the default browser via `APP_OPEN_EXTERNAL`:
  - "Terms of Service" -> https://www.baringasoft.com/terms.html
  - "Privacy Policy" -> https://www.baringasoft.com/privacy.html
- Single checkbox: "I have read and agree to the Terms of Service and Privacy Policy"
- "Continue" button (disabled until checkbox is checked)
- Back button returns to welcome step
- Progress dots updated to include the new step

### Persistence
- On accepting and clicking Continue, store `tos_accepted_at` (ISO timestamp) in the `app_meta` table via a new IPC call or reuse `SETTINGS_UPDATE`
- This is a one-time gate — once accepted, the step is never shown again (the onboarding wizard itself is one-time)
- No need for a separate "re-acceptance on update" flow right now; can be added later if terms change materially

## Implementation

### File: `src/renderer/views/OnboardingView.tsx`

1. Add `'terms'` to the `WizardStep` type union
2. Add `tosAccepted` boolean state (default `false`)
3. Update `welcome` step's "Let's get started" button to go to `'terms'` instead of `'role'`
4. Update `goBack()`:
   - `case 'terms': setStep('welcome'); break`
   - `case 'role': setStep('terms'); break` (was `'welcome'`)
5. Update progress dots `visibleSteps` array to include `'terms'` at position 0
6. Add the `terms` step render block (between welcome and role blocks):
   - Import `ExternalLink` from lucide-react (or `FileText` / `Shield` for visual flair)
   - Two link buttons calling `window.api.invoke(IPC.APP_OPEN_EXTERNAL, url)`
   - Checkbox with `tosAccepted` state
   - Continue button disabled when `!tosAccepted`
   - On Continue: save timestamp to DB, then `setStep('role')`
7. Save acceptance: `await window.api.invoke(IPC.SETTINGS_UPDATE, 'tos_accepted_at', new Date().toISOString())`
   - `SETTINGS_UPDATE` already writes to `app_meta` table, so no new IPC channel needed

### No backend changes needed
- `SETTINGS_UPDATE` and `APP_OPEN_EXTERNAL` already exist
- `app_meta` table already stores arbitrary key-value pairs
- No new migration required

## Testing
- Verify the terms step appears after welcome and before role
- Verify Continue is disabled until checkbox is checked
- Verify both links open in the system browser
- Verify `tos_accepted_at` is written to `app_meta` after acceptance
- Verify back navigation works correctly through the new step
- Verify progress dots show the correct count and highlight

## Scope
- OnboardingView.tsx is the only file modified
- No new files, no new IPC channels, no migrations
