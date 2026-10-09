# Website redesign: Pulse goes free and open source

Created 2026-10-08. Handoff plan for the agent working in `/home/jmatlock/projects/pulse-landing-page` (repo `J2matlock/pulseLandingPage`, live at https://baringasoft.com). The app lives in `/home/jmatlock/projects/pulse`; read from it, never write to it.

**Before you change anything,** read this whole file. Then write a short checklist of the page-by-page work to `REDESIGN_PROGRESS.md` in the landing-page repo, and keep it updated as you go.

---

## 1. What changed in the app since the site was last updated (March 2026)

The site describes Pulse 1.1.6 as it was in March: a $59 caseload tracker for care coordinators, with a 30-day trial and LemonSqueezy checkout. Since then, about 230 commits have changed what Pulse is.

### Pulse is now a general deadline tracker (the "generalization" work, W01–W16)
- **One flexible workspace.** Pulse tracks *people, things or jobs* with deadlines, notes and reminders. Users choose their own words: "client" can become "tenant", "vehicle", "animal", "student" and so on, and every screen uses those words.
- **38 starter templates** in 11 groups: Human services, Health, Education and youth, Legal and government, Faith and community, Business, Property and safety, Trades and service, Animals, Personal. Each one sets up lists, deadline rules, forms, letters, note types and sample data. New users choose one of three starts: from an example, from a spreadsheet (Excel/CSV import), or blank with a guided first list.
- **Deadline engine v2.** Deadlines can be relative ("90 days after intake"), calendar ("every Jan/Apr/Jul/Oct 30th"), meter ("every 5,000 miles or 6 months"), quota ("sessions left on this authorization"), step by step ("1, 3, 6 and 13 months"), or conditional. Business days, extensions and recurring requirements ("2 contacts a month") are also supported.
- **Linked records** between lists (customers → vehicles → jobs; units → tenants).
- **Stages and a board view** (drag cards from Estimate → Approved → In progress → Done). Moving a card can stamp a date or start a follow-up.
- **Appointments and a calendar** (month, week, day, agenda), repeating series, and marking appointments done, no-show or cancelled.
- **Forms**: a form builder, filling in a form to add or update a record, and printing blank or filled forms.
- **Encrypted file attachments** on records and notes. Files are stored inside the encrypted database.
- **Report builder**: saved reports that can be pinned to the dashboard and exported to PDF or CSV. Batch letters, postcards and address labels.
- **Dashboard cards** you can arrange, plus number-history charts (for example PHQ-9 scores over time).
- **Desktop reminders**: a daily summary, reminders before appointments, a background (tray) mode, and an option to start with the computer.
- **Help** covers all of the above.

### What didn't change (still true, still the core message)
- Offline, single user, no account, no cloud. Data never leaves the computer.
- AES-256 encrypted database, password lock, auto-lock, recovery key, automatic backups.
- Plain language, large text, big click targets, built by a care coordinator with 12+ years in human services.
- The name stays **Pulse by BaringaSoft** (decided 2026-10-05).

### The new decision: free and open source
| Decision | Choice |
|-|-|
| Price | Free. No trial, no purchase, no license key, no record limit. |
| License | **GPL-3.0** |
| Source code | A **new public GitHub repo** with clean history (not yet created). Use the placeholder `{{SOURCE_URL}}`. |
| Donations | **Ko-fi** tip jar. URL not yet known: use the placeholder `{{KOFI_URL}}`. |
| Past buyers | There are none, so don't mention them. |
| Downloads | Keep `https://github.com/J2matlock/pulse-releases/releases/latest`, because the app's update check points there. |

Keep both placeholders as literal strings, and list every file that contains one in `REDESIGN_PROGRESS.md` so the owner can fill them in at the end. Don't invent URLs.

---

## 2. Inputs you have

| What | Where |
|-|-|
| Per-starter page copy (38 pages + index) | `/home/jmatlock/projects/pulse/plans/website/*.md` (`README.md` is the index, with groups) |
| Source of that copy | `/home/jmatlock/projects/pulse/scripts/website-copy/blurbs.mjs` (headline + problem per starter) |
| Product facts | `/home/jmatlock/projects/pulse/plans/generalization-plan.md` section 0–1, `/home/jmatlock/projects/pulse/CLAUDE.md` |
| Security facts | `/home/jmatlock/projects/pulse/plans/SECURITY_ARCHITECTURE_BRIEF.md` and `plans/security-review/` |
| Current site | `index.html`, `security.html`, `compliance.html`, `privacy.html`, `terms.html`, `refund.html`, `404.html`, `blog/`, `docs/`, `llms.txt`, `sitemap.xml`, `robots.txt` |

**Screenshots don't exist yet.** The starter screenshots are generated in the app repo by `scripts/website-copy/screenshots.sh` and aren't committed. The two hero images (`img/screenshot-*.png`) are from March and show the old app. Build every page with screenshot slots that point to `img/starters/<id>/0{1..4}-{list,dashboard,record,calendar}.png`, plus `img/hero-*.png` for the home page. Until the images arrive, each slot shows a neutral placeholder box at the same aspect ratio (about 1.83:1, as in the existing images), and the page must not break. The owner will run the screenshot script and copy the files in.

---

## 3. Fixed constraints

1. **Keep these URLs working:** `/terms.html` and `/privacy.html`. The app's password setup screen links to `https://www.baringasoft.com/terms.html` and `/privacy.html`. Also keep `/security.html` and `/compliance.html`, which people may have bookmarked or sent to IT.
2. **`/refund.html`:** replace it with a short page ("Pulse is free; there is nothing to refund") that links home, and drop it from the footer and sitemap. Don't delete the file: old links and search results point to it.
3. **Stack stays the same:** static HTML + Tailwind 4 via `make css`, plus `js/main.js` and `icons/sprite.svg`. No framework. Adding a small Node build script for the starter pages is fine (section 5.3).
4. **Accessibility and readability**, the same rules as the app: body text 16px or larger (the current site uses 13px in places, so fix those), 44px minimum click targets, a visible 3px focus ring, AA contrast, a skip link, alt text on every screenshot, and `prefers-reduced-motion` respected.
5. **No third-party scripts.** Remove `lemon.js`. Don't add analytics, a Ko-fi widget script or embeds. Ko-fi is a plain link.
6. **Keep the brand:** the navy `#1a2540` / `#0f172a` and amber accent palette, the BaringaSoft logo (`img/baringa.webp`), and the existing design language. This is a re-message and re-structure, not a new visual identity.

---

## 4. Messaging

### Positioning, in one line
> **Pulse: a free, private tracker for everything with a deadline.** People, paperwork, vehicles, inspections, renewals. It runs on your computer, works without the internet and is encrypted with your password. Free and open source.

### Voice
- Plain, warm and specific: the way a coworker explains it, not a startup pitch. Short sentences. Copy from `plans/website/*.md` already uses this voice, so match it.
- Lead with what the reader is juggling, then what Pulse does about it.
- No jargon: no "SaaS", "CRM", "workflow automation", "leverage", "solution" or "seamless". Say "list", "deadline", "note", "reminder".
- Human services stays the **origin story and the flagship**, not the only audience. The founder line ("Built by a care coordinator with 12+ years in human services") stays prominent, since it's the most credible thing on the site.

### Why free and open source (use this framing, in the owner's voice)
- People doing this work are underpaid and their agencies don't buy tools for them, so the tool should be free.
- You can see exactly what it does with your data, because the code is public. That's a stronger privacy promise than any policy page.
- It can't be taken away: no subscription, no company that can shut it off.
- The ask, if they want to help: tell a coworker, report a bug, contribute code, or buy the developer a coffee on Ko-fi.

### Words and claims to remove everywhere
Remove all of these: "$59", "one-time purchase", "no subscription" (when used as a selling point against price), "free trial", "30-day", "read-only after trial", "license key", "activate", "Buy Now", "Download Trial", "multi-seat pricing", "money-back guarantee", "Pricing", "LemonSqueezy", and "free version keeps up to 15 active …".

**Watch out:** each `plans/website/*.md` page ends with *"The free version keeps up to 15 active clients; sample data never counts."* Drop that sentence when converting. It's no longer true.

### Claims to state carefully
- **Network:** the app currently makes two kinds of call: an optional update check, and license activation. License activation is being removed from the app (section 8). Until the owner confirms that release has shipped, say: *"Pulse never sends your data anywhere. The only time it goes online is to check for updates, and you can turn that off."* Don't mention license activation at all. Mark the line in `REDESIGN_PROGRESS.md` for the owner to confirm.
- **Platforms:** check `gh release view -R J2matlock/pulse-releases --json assets` before writing platform claims. As of 2026-10-08 the latest release (1.1.6) has only `PULSE.exe` (Windows 10/11, portable). Don't promise macOS. Offer Linux as "build from source" until an AppImage appears in a release.
- **Compliance:** keep the existing careful wording: "helps you", "tracking aid, not your official record system". Never say "HIPAA compliant".
- **Version:** the generalization features aren't in 1.1.6. Don't print a version number in copy. Mark it in `REDESIGN_PROGRESS.md` that the site must not go live before the release that includes the generalization work and the license removal.

---

## 5. New site map and page-by-page instructions

```
/                         Home (rewritten)
/starters/                Starter gallery (new)
/starters/<id>.html       38 starter pages (new, generated)
/open-source.html         Why free, license, source, how to help (new)
/download.html            Download + install steps + first-run (new)
/security.html            Updated
/compliance.html          Updated
/privacy.html             Rewritten (URL fixed)
/terms.html               Rewritten (URL fixed)
/refund.html              Stub (section 3.2)
/blog/                    Kept, light edits
/404.html                 Footer update
```

**Nav (all pages):** Features · Starters · Security · Open source · [Download, the amber button]. Mobile menu has the same items. Put a GitHub icon link to `{{SOURCE_URL}}` on the right on desktop.

**Footer (all pages):** Starters · Download · Security · Compliance FAQ · Open source · Source code · Support Pulse (Ko-fi) · Privacy · Terms · Blog. Also "© 2026 BaringaSoft · Pulse is free software under the GNU GPL v3." Use one footer markup, identical on every page. Generate it from the same partial if you add a build script.

### 5.1 Home (`index.html`): section order
1. **Hero.**
   - Eyebrow: "Free and open source · Built by a care coordinator".
   - H1, around 8 words, about never missing a deadline for anything you track. Suggested: "Never miss a deadline again — for anyone or anything you look after."
   - Subhead: the positioning line from section 4.
   - Buttons: primary **"Download Pulse — free"** (goes to `/download.html`), secondary "See the starters" (goes to `/starters/`).
   - Trust line: Free forever · Works offline · Encrypted · Windows 10 & 11.
   - Hero image: keep the existing tabbed screenshot widget (Dashboard / List / Calendar), with new image slots.
2. **"Pick up where your spreadsheet left off."** The problem: a spreadsheet holds dates but doesn't tell you what's next. Use 3 short beats, as today, but general: spreadsheet → sticky notes → "something built for this".
3. **"Start from an example."** A strip of 8 to 10 starter cards across different groups, so the breadth shows (Human services, Therapy & counseling, Property manager, Fleet manager, Animal rescue, Childcare director, Personal documents, Caring for a parent, Auto & equipment service, Grant manager). Each card has an icon, a name and a one-line headline taken from the starter's H1, and links to its page. End with a "See all 38 →" link.
4. **Features**, regrouped into about 9 cards. Lead with the ones that are new since March:
   - Deadlines that know your rules (the 6 deadline types, in plain words with one example each)
   - Calendar & appointments
   - Board view (stages)
   - Linked lists
   - Forms
   - Files, encrypted
   - Reports & dashboard
   - Reminders
   - Your words, your columns

   Keep (merged): import from Excel/CSV, letters and snippets, backups, profiles and notes, the contact directory.
5. **Security band.** Keep the current section, edited per section 4's network claim. Add one line: "Don't take our word for it — the code is public."
6. **"Free. Open. Yours."** This replaces the pricing section, and uses the same dark navy band so the page rhythm stays. Three columns: *Free forever* (no trial, no limits, no account) · *Open source* (GPL-3.0, read the code, link) · *Can't be taken away* (it's on your computer, nothing to cancel). Below them: a small "Support Pulse" line with the Ko-fi link and "or tell a coworker". Add `id="pricing"` as an empty anchor inside this section so old `#pricing` links land here.
7. **Who it's for.** Keep the founder story. Widen the list of roles to mirror the starter groups.
8. **FAQ.** Rewrite it (it also feeds the FAQPage JSON-LD; keep the two in sync):
   - Is it really free? What's the catch?
   - Why is it open source? / What does GPL mean for me? (You can use it for anything, including at work. The license only matters if you share a modified copy.)
   - Does my data ever leave my computer?
   - Can I use it at my agency/business? Do I need IT approval? (Point to `/security.html` and `/compliance.html`.)
   - Can I bring my spreadsheet?
   - What if I'm not a social worker? (The starters.)
   - What happens if I forget my password? (The recovery key.)
   - Moving to a new computer (backup and restore. Drop the "reactivate license key" step.)
   - How do I get help / report a bug? (GitHub issues at `{{SOURCE_URL}}/issues`, plus the support email `support@baringasoft.com`, shown as text.)

   Remove the trial, multi-seat and license-key questions.
9. **Final call to action:** "Ready to retire the spreadsheet?" with the Download button.

### 5.2 Download (`download.html`, new)
- A large Windows download button linking to `https://github.com/J2matlock/pulse-releases/releases/latest/download/PULSE.exe` (the same direct link as today).
- An "All downloads and release notes" link to the releases page.
- Install steps for the portable exe: (1) download, (2) if Windows SmartScreen says "Windows protected your PC", click **More info → Run anyway** (the build isn't code-signed yet, so explain this plainly), (3) choose a password, write down the recovery key, (4) pick a starter, import a spreadsheet, or start blank.
- Linux / build from source: a short section linking to `{{SOURCE_URL}}#building`.
- System requirements: Windows 10/11. Check whether a 64-bit-only build is true in `/home/jmatlock/projects/pulse/package.json` `build.win`.

### 5.3 Starter pages (`starters/index.html` + `starters/<id>.html`, new)
- **Generator:** add `scripts/build-starters.mjs`, with `marked` (exact version, as a devDependency) for Markdown, plus a `make starters` target, and make `make build` run `starters` and then `css`. It does the following:
  1. Reads `/home/jmatlock/projects/pulse/plans/website/*.md`, configurable through the `PULSE_REPO` env var with that path as the default. Copy the markdown into `content/starters/` in this repo and generate from that copy, so the site builds without the app repo. Add a `make sync-starters` target that refreshes the copy.
  2. Strips the "free version keeps up to 15" sentence and rewrites the "Try it free" section heading to "Get Pulse — free" (download link to `/download.html`).
  3. Rewrites the image paths `screenshots/<id>/NN-x.png` to `/img/starters/<id>/NN-x.png`, and emits the placeholder box when the file is missing.
  4. Wraps each page in the shared template: nav, a breadcrumb (Starters › Group › Name), the content, a "Related starters" row (the same group), the footer, and a per-page `<title>`, meta description (the starter's headline), canonical URL and OG tags.
  5. Builds `starters/index.html`: the 38 starters grouped by the 11 groups (order and group names from `plans/website/README.md`), each card with name + headline, plus a top filter of group chips (plain anchors, no JS needed). Add an intro line: "Pick the one closest to your work — you can change every word, column and rule afterwards. Or start blank."
  6. Emits sitemap entries for every starter page.
- Keep the disclaimer quote block on the pages that have it (regulated trades), styled as a calm note, not a warning.
- Don't hand-edit generated HTML. Fix the generator or the source markdown. If the copy itself needs a change, list it in `REDESIGN_PROGRESS.md` for the owner to make upstream in `scripts/website-copy/blurbs.mjs`.

### 5.4 Open source (`open-source.html`, new)
- Why it's free (section 4 framing, first person from the founder, 3 short paragraphs).
- What the GPL-3.0 means, in plain language. Link the full license text at gnu.org.
- The source code: `{{SOURCE_URL}}`. Name the tech in one line (Electron, React, TypeScript, SQLite with SQLCipher-style encryption) for developers.
- How to help: report a bug, suggest a starter for your profession, improve the help text, contribute code, support on Ko-fi (`{{KOFI_URL}}`).
- "Will it stay free?" Yes. It's GPL: even if BaringaSoft stopped, anyone could carry it on.

### 5.5 Security (`security.html`) and Compliance (`compliance.html`)
- Remove every mention of license activation and LemonSqueezy. Use the network claim from section 4.
- Section 7 "Dependencies & Licensing": keep the dependency table. Add that Pulse itself is GPL-3.0 and its source is public for audit. The claim "No copyleft dependencies" is still true of the dependencies, so keep it, but reword the heading so it doesn't read as if Pulse isn't copyleft.
- Add short subsections for the new data-handling features, using facts from `plans/SECURITY_ARCHITECTURE_BRIEF.md` in the app repo:
  - Attachments are stored encrypted inside the database. Opened copies are temporary and wiped. Files saved out by the user aren't encrypted.
  - Desktop reminders and tray mode show only counts and times while locked, never names.
- Update `docs/SECURITY_ARCHITECTURE_BRIEF.md` to match. It still says "CaseConnect Pulse" in places, so fix the name to "Pulse by BaringaSoft". Copy the newer brief from the app repo if it's more current, and diff the two first.
- Replace "available for security questionnaires" with "the source is public — your IT team can review it directly".
- `sbom.json` / `licenses.txt` are probably stale (March). Leave the files in place, list them in `REDESIGN_PROGRESS.md` as needing regeneration from the app repo, and don't fabricate new ones.

### 5.6 Privacy (`privacy.html`) and Terms (`terms.html`)
- **Privacy:** remove the LemonSqueezy / payments / license-key sections. What remains: the app collects nothing, has no telemetry, and the update check is the only network call. The website has no analytics and no cookies; check `js/main.js` and the HTML to confirm. Email support: what's received and why. Update "Last updated".
- **Terms:** replace the purchase-license terms with "Terms of use":
  - (1) the software is licensed under GPL-3.0, with a link; the GPL governs copying and modification.
  - (2) Keep **section 6, the deadline alerts disclaimer**, nearly as is. It matters more now that Pulse covers regulated trades.
  - (3) No warranty. Restate GPL sections 15–16 in plain words.
  - (4) The user is responsible for their data, backups and recovery key.
  - (5) The website's terms of use.
  - (6) Contact.

  Remove trial, payment, refunds, updates-for-one-year, the 18+-to-purchase rule, and the non-transferable-license wording. **Keep the anchor IDs** where a section survives, so `#disclaimer`-style links still work. Check the current IDs first.
- Put "This is plain-language guidance, not legal advice" in `REDESIGN_PROGRESS.md` as a note for the owner to review both pages. Don't add it to the pages.

### 5.7 Everything else
- **`<head>` of `index.html`:**
  - Meta description, OG and Twitter text: no price, add "free and open source".
  - JSON-LD `SoftwareApplication`: `offers.price` "0", `isAccessibleForFree: true`, `license: "https://www.gnu.org/licenses/gpl-3.0.html"`, `codeRepository` (`{{SOURCE_URL}}`), and `operatingSystem` matching section 4. Widen `applicationCategory`/`description` beyond caseloads. Remove `priceValidUntil`. The FAQPage JSON-LD should match the new FAQ.
- **`llms.txt`:** rewrite it with the new positioning, free + GPL, the 38 starters (one line each with links), and links to the security and open-source pages.
- **`sitemap.xml`:** add the new pages and the starter pages, drop refund, update `lastmod`.
- **`blog/`:** posts are care-coordinator focused, and that's fine. Remove any price or trial mentions (a grep found none). Update the blog index's footer and nav. Optionally add a post draft "Pulse is now free and open source" in `blog/posts/`, written in the founder's voice and marked as a draft in `REDESIGN_PROGRESS.md` for the owner to edit.
- **`404.html`:** new nav and footer.
- **`js/main.js`:** remove any LemonSqueezy hooks and the pricing-specific code. Keep the lightbox, tabs, mobile menu, FAQ accordion and back-to-top.
- **Untracked files in the repo root** (`SECURITY_ARCHITECTURE_BRIEF.md`, `THIRD_PARTY_LICENSES.txt`, `licenses.txt`, `sbom.json`, `refund-policy-spec.md`, `seo.md`, `tos-spec.md`) and the modified `baringa.png`: these are the owner's. Leave them alone and don't commit them.

---

## 6. Suggested commit order (one commit each, all pushed to a branch `open-source-site`, not `main`)
1. Shared nav and footer partials, plus removing the pricing, trial and LemonSqueezy content site-wide (including `lemon.js` and `refund.html` → stub).
2. Home page rewrite (sections 1–9) + head metadata + JSON-LD.
3. Starter generator + `content/starters/` + `starters/index.html` + 38 pages + sitemap.
4. `download.html` + `open-source.html`.
5. Security, compliance and docs brief updates.
6. Privacy + terms rewrite.
7. `llms.txt`, blog touch-ups, 404, the 16px font pass, and the accessibility pass.

Run `make build` before each commit. Don't deploy, and don't merge to `main`. The owner reviews the branch first. Find out how the site is deployed (no Netlify, Vercel or GitHub Pages config is in the repo, so ask the owner) and write it down in `REDESIGN_PROGRESS.md`.

---

## 7. Done means
- `git grep -niE '\$59|trial|lemonsqueezy|license key|buy now|refund policy|multi-seat|15 active' -- '*.html' '*.txt' '*.js' '*.md' ':!content/starters' ':!*-spec.md' ':!REDESIGN_PROGRESS.md'` returns nothing user-facing. Exceptions: the `refund.html` stub's own explanation, and blog posts the owner hasn't approved yet.
- `/terms.html` and `/privacy.html` load and read correctly.
- Every page passes at 400px wide (no horizontal scroll) and at 1440px.
- Keyboard-only: every link and button can be reached, with a visible focus ring, and the skip link works.
- Lighthouse (local, `npx serve` or similar): Accessibility 100, SEO 100, Best Practices ≥ 95 on Home, a starter page and Download.
- No external requests besides GitHub (downloads), Ko-fi (a plain link) and gnu.org (a plain link). No third-party scripts.
- `REDESIGN_PROGRESS.md` lists: the placeholders still unfilled (`{{SOURCE_URL}}`, `{{KOFI_URL}}`), the screenshot slots still empty, stale docs (`sbom.json`, `licenses.txt`), the claims waiting on an app release (network line, record limit, version), legal pages for owner review, and the deploy method.

---

## 8. Not for the website agent: app-side work this depends on (tracked in the pulse repo)
These need to happen in `/home/jmatlock/projects/pulse` before the new site goes live. They're listed here so both sides agree.
1. Remove licensing: `src/main/licensing.ts`, `components/licensing/*` (LicenseActivationModal, TrialBanner), the status-bar trial notice, `enforceClientCapacity` and its callers, the license IPC (`ipc-license.ts`), and the LemonSqueezy network call. Update `CLAUDE.md` "Internet Connectivity" to list one network call.
2. Replace `LICENSE` (currently "CaseConnect, all rights reserved") with GPL-3.0, set package.json `"license": "GPL-3.0-only"`, and update About and the third-party licenses screen.
3. Update the password-setup consent text if the terms change from "Terms of Service" to "Terms of use" (`PasswordSetupView.tsx`, which links to `baringasoft.com/terms.html` and `/privacy.html`).
4. Create the fresh public source repo: run a secrets scan, leave out `plans/` audit and security-finding files, the `audit-findings-*.md` files and the LemonSqueezy IDs, and add a README with build instructions (`#building`).
5. Generate the starter screenshots (`scripts/website-copy/screenshots.sh`) and new hero shots, then copy them to `pulse-landing-page/img/starters/<id>/` and `img/hero-*.png`.
6. Ship a release with the generalization work plus the license removal, so the website's claims are true on launch day.
