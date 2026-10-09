# W13–W16. Licensing, rename, Spanish, help

## W13. Free tier for general use — S (1–2 days). Phase: P1.

### Rule (assumption A1)
The free version allows **15 active records in people and thing lists**:
- Job lists don't count (they come and go; the customers and vehicles behind them do count).
- Appointments, notes, activities and attachments never count.
- Archived and trashed records don't count (as today); sample data never counts (as today).

### Changes
- `src/main/licensing.ts`:
  - `countBillableClients()` → `countBillableRecords()`: `SELECT COUNT(*) FROM rows r JOIN grids g ON g.id = r.grid_id WHERE r.is_active = 1 AND r.deleted_at IS NULL AND g.is_active = 1 AND g.record_kind IN ('person','thing') AND g.id != <sample grid>`;
  - `checkClientCapacity(adding, gridId)` gains the grid so job lists are exempt;
  - `FREE_LIMIT_MESSAGE` uses `vocabFor()`.
- `ipc-utils.ts` `enforceClientCapacity(adding, gridId)`; callers updated:
  - `ipc-row.ts` create/duplicate/restore/move;
  - `import.ts` `maxNewClients` (kind of target grid);
  - forms (W08) create;
  - starter sample data (exempt).
- **Changing a list's kind from job → person/thing** when over the limit: allowed, but adding is blocked until under the limit (same as today's never-read-only rule).
- **Renderer:** TrialBanner "Free version: 9 of 15 {records}", with the main record word (or "records" when lists use different words); license modal text via vocab.
- **Tests:** counting by kind, sample exclusion, job lists exempt, move between kinds, import cap respects kind.

## W14. Rename — S (2 days once a name exists). Phase: P0 (safety) + P5 (switch).

### P0 safety rails (done 2026-10-01)
1. `src/shared/constants.ts`:
   - `PRODUCT_NAME = 'Pulse by BaringaSoft'` (display only);
   - `INTERNAL_APP_NAME = 'baringasoft-pulse'` (never changes). This is package.json's `name`, which is the runtime app name and the live data folder (`~/.config/baringasoft-pulse`), *not* the `productName`.
2. `src/main/app-identity.ts` is imported first by `index.ts`. It calls `app.setName(INTERNAL_APP_NAME)` and sets `userData` to `<appData>/baringasoft-pulse`, unless `--user-data-dir` is passed. The bundle was checked: it runs before any module reads a path.
3. Every display use of the name goes through `PRODUCT_NAME`:
   - window title, `document.title`, file association label;
   - PDF footers (profile, batch, contact, directory, supervisor);
   - lock and password screens, recovery key printout, security summary, About.
   - `src/renderer/index.html` keeps a static fallback title.
4. `tests/app-identity.test.ts` guards:
   - the internal name equals package.json's `name`;
   - name and path pinning, and that an explicit `--user-data-dir` is respected;
   - the first-import order;
   - that the display name appears only in `constants.ts`.
5. **Rule for the rename:** never change package.json's `name` or `INTERNAL_APP_NAME`.

### P5 switch (when the name is chosen)
**Decision 2026-10-05: the name stays Pulse, so the switch isn't needed.** The safety rails stay in place in case that changes.

1. Set `PRODUCT_NAME`; `package.json` `productName`; `build.win.artifactName`, `build.linux.artifactName`, `build.mac.artifactName`; `dmg.title`; Linux `executableName` (AppImage users download a new file anyway, so no alias is needed).
2. Icons if the logo changes (`build/icon*.png`, `.ico`).
3. **Keep:**
   - `appId`;
   - `INTERNAL_APP_NAME` and package.json `name`;
   - the `PulseData` folder;
   - the `.pulse` and `.pulse-backup` extensions;
   - the `PulseTemplate` ProgID;
   - the update repository;
   - LemonSqueezy product IDs.
4. **Upgrade test matrix** (manual, documented in `plans/release-checklist.md`): install the old build, create data, set a recovery key, then install the new build and confirm:
   - unlock works;
   - data is present;
   - backups list;
   - the license stays active;
   - `.pulse` double-click opens.

   Windows portable (same folder), Linux AppImage, macOS (when it ships).
5. **Outside the app (user):** website, LemonSqueezy product display name and store name, email templates.

## W15. Spanish — M (2 weeks). Phase: P6.
**Deferred 2026-10-05:** skipped for now, by decision.

### Approach
1. **Extend the W01 vocabulary layer into full i18n:**
   - `src/shared/i18n/{en,es}.ts`, flat keys by area (`grid.addRow`, `profile.caseLog.empty`…), ICU-style plurals via a tiny formatter (no library): `{count, plural, one {# client} other {# clients}}`.
   - Words (W01) are injected as variables: `t('grid.addRow', { record: term(v,'record',{article:true}) })`.
   - Spanish grammar needs gender for articles: `Term` gains `gender?: 'm' | 'f'` and `articleEs`.
2. **Extraction pass:** every user-facing string in renderer and main → keys. The W01 lint rule is extended to flag any JSX text not wrapped in `t()` (allowlist for numbers and symbols).
3. **Settings → Appearance → Language** (English, Español). `Intl.DateTimeFormat` / `NumberFormat` use the language for dates and money. Week start stays its own setting.
4. **PDFs and reports** use the language at generation time.
5. **Starters:** `name`/`description`/`helpTips`/sample data get `es` variants (`i18n: { es: {...} }` in the JSON). Human services first.
6. **Help** (`faqData.tsx`) translated.

### Tests
- Every key exists in both languages (key parity).
- No raw strings left (lint).
- Plural forms.
- The PDF smoke test in Spanish.
- A render test of main views in `es` with no missing-key markers.

## W16. Help, docs and website copy — S–M, alongside each phase

| Phase | Help topics (in `views/help/faqData.tsx`, feature-aware) | Docs |
|-|-|-|
| P1 | Your words; turning features on and off; starting from an example; starting blank; sharing your setup; list kinds; auto numbers; note types; numbers on notes; requirements per week/month/quarter | Update `plans/security-review/*` for workspace export (structure only) |
| P2 | Deadline types (6) with examples; business days and days off; extensions; reminders | — |
| P3 | Linking lists; the board; batch letters and labels; dashboard cards; number charts | — |
| P4 | Appointments and series; the calendar; forms and printing blanks | — |
| P5 | Files; report builder; background mode | Security docs: attachments, temp files, tray mode cache |

- **Help is feature-aware:** topics for switched-off features are listed under "More features you can turn on", with a "Turn on" button.
- **Website copy** (`plans/website/<starter-id>.md`, one page per shipped starter): the problem in their words, 3 screenshots from sample data (generated by extending `npm run ui-tour` to accept `--starter <id>`), "your spreadsheet, but safer", a free download link, and the disclaimer for regulated trades.
