# CaseConnect Pulse — Full Dependency Upgrade Plan

**Created:** 2026-02-27
**Status:** ALL PHASES COMPLETE (2026-02-28)
**Estimated sessions:** 3-4 (one per phase below)

---

## Overview

Every package is organized into 4 phases, ordered by dependency chain. Each phase must complete and pass `npm run build && npm test` before starting the next.

| Phase | What | Risk | Est. effort |
|-|-|-|-|
| 1 | Safe minor/patch bumps + bcryptjs 3 | Very Low | ~30 min |
| 2 | Electron 39 + build toolchain | Medium | ~1 session |
| 3 | React 19 + TipTap 3 | Low-Medium | ~1 session |
| 4 | Tailwind 4 | Medium | ~1 session |

**NOT upgrading (and why):**
- `@dnd-kit` — v10 is beta (0.3.2), complete API rewrite. Stay on 6/8 until 1.0 stable.
- `electron-store` — v9+ is ESM-only, requires main process ESM migration. Stay on v8.
- `vite` 7 / `electron-vite` 4 — Tailwind 4 PostCSS plugin doesn't support Vite 7 yet. Using Vite 6 + electron-vite 3 instead.

---

## Phase 1: Safe Minor/Patch Bumps + bcryptjs 3

**Risk: Very Low.** All semver-compatible or single-file changes.

### Commands
```bash
npm install @tanstack/react-table@^8.21.3 @tanstack/react-virtual@^3.13.19 \
  autoprefixer@^10.4.27 lucide-react@^0.575.0 papaparse@^5.5.3 \
  postcss@^8.5.6 react-hot-toast@^2.6.0 react-router-dom@^7.13.1 \
  zustand@^5.0.11 motion@^12.34.3 date-fns@^4.1.0

npm install -D typescript@^5.9.3 @types/better-sqlite3@^7.6.13 \
  @types/dompurify@^3.2.0 @types/papaparse@^5.5.2
```

### bcryptjs 2.4.3 → 3.0.3

**What changed in v3:**
- Package renamed import path. Check if `import bcrypt from 'bcryptjs'` still works or needs `import * as bcrypt from 'bcryptjs'`.
- API (`hash`, `compare`, `genSalt`) is unchanged.
- `@types/bcryptjs` should also bump to 3.x.

**Files to check:** `src/main/auth.ts` (only file using bcryptjs — 1 import, ~10 usage lines)

```bash
npm install bcryptjs@^3.0.3
npm install -D @types/bcryptjs@^3.0.0
```

**Verification after Phase 1:**
```bash
npx tsc --noEmit
npm run build
npm test
```

### What could go wrong
- `@types/bcryptjs` v3 might not exist yet → stay on v2 types, they're compatible
- `lucide-react` icon names occasionally change between minor versions → grep for any missing icons in build output

---

## Phase 2: Electron 39 + Build Toolchain

**Risk: Medium.** Native module rebuild is the main risk. Config files may need minor changes.

### Target Versions
| Package | From | To |
|-|-|-|
| electron | 33.4.11 | ^39.0.0 |
| electron-vite | ^2.3.0 | ^3.1.0 |
| vite | ^5.4.0 | ^6.0.0 |
| @vitejs/plugin-react | ^4.3.4 | ^4.3.4 (no change needed) |
| electron-builder | ^25.1.8 | ^26.8.1 |
| @electron/rebuild | ^3.7.2 | ^3.7.2 (stay on 3.x — v4 has issues with electron-builder) |
| @electron/fuses | ^2.1.0 | ^2.1.0 (no change) |
| @types/node | ^22.13.5 | ^22.13.5 (match Electron 39's Node 22) |

### Step-by-step

**Step 1: Upgrade Electron**
```bash
npm install electron@^39.0.0
```

**Step 2: Upgrade electron-vite to v3 (requires Vite 6)**
```bash
npm install -D electron-vite@^3.1.0 vite@^6.0.0
```

**Step 3: Check electron.vite.config.ts**
The current config uses `defineConfig` and `externalizeDepsPlugin` — these are unchanged in electron-vite 3. No config file changes expected.

Vite 6 changes to verify:
- `commonjsOptions.strictRequires` now defaults to `true` — shouldn't affect us since we use ESM in renderer
- `postcss-load-config` updated to v6 — our simple `postcss.config.js` should still work
- No CSS preprocessor changes needed (we don't use Sass)

**Step 4: Upgrade electron-builder**
```bash
npm install -D electron-builder@^26.8.1
```

electron-builder 26 changes:
- Uses `node-module-collector` (assumes npm on PATH — should be fine)
- No config format changes in `package.json` build section
- Test the actual packaging: `npm run build:linux` (or equivalent)

**Step 5: Rebuild native modules**
```bash
./node_modules/.bin/electron-rebuild -f -w better-sqlite3-multiple-ciphers
```

Electron 39 embeds Node 22.20 — same Node 22 major as our current setup. ABI should be compatible. If rebuild fails:
- Check `better-sqlite3-multiple-ciphers` has prebuilt for Electron 39 (confirmed: prebuilts exist for 29-40)
- Try `npm rebuild better-sqlite3-multiple-ciphers --build-from-source`

**Step 6: Add missing Electron Fuses**
In `scripts/afterPack.js`, add:
```js
[FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
[FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
```

**Step 7: Verify**
```bash
npx tsc --noEmit
npm run build
npm test
# Then manually launch: npm run dev
# Test: app starts, DB unlocks, grid loads, import works, exports work
```

### What could go wrong
- **Native module rebuild fails** → check if `better-sqlite3-multiple-ciphers` needs a version bump for Electron 39 ABI. May need `npm install better-sqlite3-multiple-ciphers@latest`.
- **electron-builder packaging fails** → v26.4.0 had regressions copying deps. Pin to 26.8.1 specifically if issues arise.
- **GTK 4 rendering issues on GNOME Linux** (Electron 36+ defaults to GTK 4) → add `--gtk-version=3` to launch args if visual issues appear.
- **Vite 6 PostCSS changes** → if `postcss.config.js` fails to load, rename to `postcss.config.mjs` with ESM syntax.

### Breaking changes between Electron 33 and 39 (none affect Pulse)
- Electron 34: Menu bar hidden in fullscreen on Windows
- Electron 35: `WebRequestFilter.urls` empty array behavior changed
- Electron 35: `session.setPreloads`/`getPreloads` deprecated
- Electron 36: GTK 4 default on GNOME (visual only)
- Electron 36: macOS 11 dropped (we defer macOS)
- Electron 37: Utility process unhandled rejection behavior
- Electron 38: `ELECTRON_OZONE_PLATFORM_HINT` env var removed
- Electron 38: macOS 11 dropped
- Electron 39: `--host-rules` deprecated, `window.open` popups always resizable

---

## Phase 3: React 19 + TipTap 3

**Risk: Low-Medium.** Codebase scan shows zero usage of removed React APIs.

### Target Versions
| Package | From | To |
|-|-|-|
| react | ^18.3.1 | ^19.2.4 |
| react-dom | ^18.3.1 | ^19.2.4 |
| @types/react | ^18.3.18 | ^19.2.14 |
| @types/react-dom | ^18.3.5 | ^19.2.3 |
| @tiptap/react | ^2.10.3 | ^3.20.0 |
| @tiptap/starter-kit | ^2.10.3 | ^3.20.0 |
| @tiptap/extension-underline | ^2.10.3 | REMOVE (bundled in StarterKit 3) |

### Pre-upgrade: Audit useRef calls

Search for `useRef()` with no argument — `@types/react@19` requires an explicit initial value.

```bash
grep -rn "useRef()" src/renderer/ --include="*.tsx" --include="*.ts"
```

For each match, add `null` or `undefined` as the argument:
- `useRef()` → `useRef(null)` (for DOM refs)
- `useRef()` → `useRef(undefined)` (for value refs)

This can be done BEFORE the React upgrade (it's backward-compatible with React 18).

### Step-by-step

**Step 1: Fix useRef calls (while still on React 18)**
Search and fix all bare `useRef()` calls. This is backward-compatible.

**Step 2: Run the types codemod**
```bash
npx types-react-codemod@latest preset-19 ./src
```
This auto-fixes deprecated type references (`ReactChild`, `ReactText`, `VFC`, etc.). Review the diff.

**Step 3: Upgrade React**
```bash
npm install react@^19.2.4 react-dom@^19.2.4
npm install -D @types/react@^19.2.14 @types/react-dom@^19.2.3
```

**Step 4: Upgrade TipTap to v3**
```bash
npm install @tiptap/react@^3.20.0 @tiptap/starter-kit@^3.20.0 @tiptap/pm@^3.20.0
npm uninstall @tiptap/extension-underline
```

TipTap 3 changes in `src/renderer/components/profile/ScratchPad.tsx`:
- `@tiptap/extension-underline` import → REMOVE (Underline now bundled in StarterKit)
- If StarterKit config has `history: {...}` → rename to `undoRedo: {...}`
- If using `BubbleMenu` or `FloatingMenu` → import from `@tiptap/react/menus` instead of `@tiptap/react`
- `useEditor` hook API is unchanged
- `editor.getHTML()` / `editor.getJSON()` unchanged

**Step 5: Type-check and build**
```bash
npx tsc --noEmit
npm run build
npm test
```

**Step 6: Manual QA — focus areas**
- Drag-and-drop (dnd-kit on React 19): test row reorder, column reorder, sidebar grid reorder, checklist item reorder, task reorder
- Rich text editor (ScratchPad): test bold, italic, underline, bullet lists, undo/redo
- Command palette (cmdk): test Ctrl+K, search, navigation
- Toast notifications: test save confirmations, error toasts

### What could go wrong

- **`@dnd-kit` runtime issues on React 19** — The peer dep allows React 19, but the library hasn't been updated in over a year. Known GitHub issues mention edge cases. If drag-and-drop breaks: (a) check for `@dnd-kit/core` updates, (b) as a last resort, pin React to 18 and skip this phase.
- **`useRef` type errors** — `@types/react@19` is stricter about ref types. May need explicit generic params: `useRef<HTMLDivElement>(null)`.
- **TipTap 3 StarterKit config** — If we pass extension-specific options to StarterKit that changed names, TypeScript will catch it.

### Codebase scan results (why this is low risk)
- `forwardRef`: 0 usages
- `defaultProps`: 0 usages
- `string refs`: 0 usages
- `Context.Provider`: 0 usages (Zustand-only, no React Context)
- `ReactDOM.render`: 0 usages (already using `createRoot`)
- `useContext`: 0 usages
- TipTap usage: 1 file only (`ScratchPad.tsx`)

---

## Phase 4: Tailwind CSS 4

**Risk: Medium.** The automated upgrade tool handles ~90% of changes. The remaining 10% is manual dark mode config and `@apply` fixes.

### Target Versions
| Package | From | To |
|-|-|-|
| tailwindcss | ^3.4.17 | ^4.2.1 |
| autoprefixer | ^10.4.27 | REMOVE (Tailwind 4 bundles vendor prefixing) |
| @tailwindcss/postcss | (new) | ^4.2.1 |

### Impact Summary
- **2,124 `dark:` class usages across 78 files** — dark mode mechanism changes
- **8 `@apply` directives in 1 file** (`globals.css`) — syntax may change
- **tailwind.config.js** (79 lines) → CSS-based config
- **postcss.config.js** → simplified to single plugin

### Step-by-step

**Step 1: Run the automated upgrade tool**
```bash
npx @tailwindcss/upgrade
```

This tool will:
- Convert `tailwind.config.js` → CSS `@theme` blocks in `globals.css`
- Rename utility classes across all .tsx files:
  - `shadow-sm` → `shadow-xs`, `shadow` → `shadow-sm`
  - `rounded-sm` → `rounded-xs`, `rounded` → `rounded-sm`
  - `ring` (3px default) → `ring-3` (Tailwind 4 default is 1px)
  - `outline-none` → `outline-hidden`
  - `bg-gradient-to-*` → `bg-linear-to-*`
- Update CSS imports: `@tailwind base/components/utilities` → `@import "tailwindcss"`
- Update `postcss.config.js`

**Step 2: Fix dark mode**
Tailwind 4 defaults to `prefers-color-scheme` (media query) instead of class-based.

Add to the top of `globals.css` (after the `@import "tailwindcss"` line):
```css
@variant dark (&:where(.dark, .dark *));
```

This restores the `.dark` class-based dark mode that Pulse uses. Without this, all 2,124 `dark:` utility usages break.

**Step 3: Fix postcss.config.js**
Replace contents with:
```js
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {}
  }
}
```

Remove `autoprefixer` from devDependencies:
```bash
npm uninstall autoprefixer
npm install -D @tailwindcss/postcss
```

**Step 4: Convert tailwind.config.js to CSS @theme**
The upgrade tool should auto-convert, but verify. The current config has:

```
colors.alert.green/yellow/orange/red/pulse → @theme { --color-alert-green: #22C55E; ... }
colors.star → @theme { --color-star: #F59E0B; }
colors.sticky-note → @theme { --color-sticky-note: #FFFBEB; }
fontSize overrides → @theme { --font-size-base: 15px; --font-size-base--line-height: 1.5; ... }
minHeight.touch → @theme { --min-height-touch: 44px; }
height.topbar/statusbar/row-* → @theme { --height-topbar: 48px; ... }
width.sidebar-expanded/collapsed → @theme { --width-sidebar-expanded: 220px; ... }
ringWidth.3 → @theme { --ring-width-3: 3px; }
borderColor.grid → @theme { --border-color-grid: #D1D5DB; }
fontFamily.sans/mono → @theme { --font-family-sans: system-ui, ...; }
```

If auto-conversion misses any, manually add them. Then DELETE `tailwind.config.js`.

**Step 5: Fix @apply directives in globals.css**
The 8 `@apply` directives in `globals.css` should still work in Tailwind 4, but:
- Any renamed utilities inside `@apply` must be updated (e.g., `rounded-md` is fine, but `rounded-sm` → `rounded-xs`)
- The upgrade tool should handle this automatically
- `@layer components` and `@layer utilities` still work

**Step 6: Fix the `ring` default change**
Tailwind 4 changes `ring` from 3px to 1px default. Search for bare `ring` (without a width number) and replace with `ring-3` where 3px rings are intended:

```
ring-2 → ring-2 (unchanged, explicit width)
ring → ring-3 (was 3px in v3, now 1px in v4)
```

Also: `ring` default color changed from `blue-500` to `currentColor`. Check if any bare `ring` without `ring-blue-500` needs the color added.

**Step 7: Fix border default color change**
Tailwind 4 changes `border` default from `gray-200` to `currentColor`. Anywhere using bare `border` without an explicit color class (like `border-slate-200`), add the color explicitly:

```
border → border border-gray-200 (or whatever color was intended)
```

**Step 8: Fix `!important` syntax (if used)**
Old: `!flex`, `!hidden`
New: `flex!`, `hidden!`

Search for `!` prefix on utility classes and move to suffix.

**Step 9: Verify**
```bash
npx tsc --noEmit
npm run build
npm test
# Manual QA: check every view in both light and dark mode
# Pay special attention to: grid borders, focus rings, alert colors, button styles
```

### What could go wrong
- **Dark mode breaks everywhere** — forgot the `@variant dark` line. Fix: add it.
- **`ring` width changes** — focus rings appear thinner than before. Fix: add explicit `ring-3` where needed.
- **`border` color changes** — borders appear as black/currentColor instead of gray. Fix: add explicit border colors.
- **Custom theme values not converted** — the upgrade tool misses some. Fix: manually add `@theme` entries.
- **`@apply` with renamed classes** — upgrade tool should catch these but verify.
- **`shadow` size shifts** — shadows appear different. Fix: replace `shadow` with `shadow-sm` and `shadow-sm` with `shadow-xs`.

---

## Post-Upgrade Checklist

After all 4 phases, verify:

- [ ] `npx tsc --noEmit` — zero errors
- [ ] `npm run build` — clean output
- [ ] `npm test` — no new test failures
- [ ] App launches (`npm run dev`)
- [ ] Password entry / lock screen works
- [ ] Grid loads with data, scrolls smoothly
- [ ] Cell editing (text, date, number, checkbox, dropdown)
- [ ] Drag-and-drop: row reorder, column reorder, sidebar grid reorder
- [ ] Rich text editor (ScratchPad) — bold, italic, underline, lists
- [ ] Command palette (Ctrl+K) — search, navigate
- [ ] Dark mode toggle — all views render correctly
- [ ] Alert colors (green → yellow → orange → red → pulsing red)
- [ ] Focus rings visible (3px, blue)
- [ ] Import CSV/Excel file
- [ ] Export CSV/PDF
- [ ] Contacts view — list, detail, vCard import/export
- [ ] Backup and restore
- [ ] Toast notifications appear (not duplicated)

---

## Version Summary (final target state)

### Production Dependencies
| Package | Target |
|-|-|
| react | ^19.2.4 |
| react-dom | ^19.2.4 |
| tailwindcss | ^4.2.1 |
| @tailwindcss/postcss | ^4.2.1 |
| @tiptap/react | ^3.20.0 |
| @tiptap/starter-kit | ^3.20.0 |
| @tiptap/pm | ^3.20.0 |
| bcryptjs | ^3.0.3 |
| lucide-react | ^0.575.0 |
| react-hot-toast | ^2.6.0 |
| react-router-dom | ^7.13.1 |
| zustand | ^5.0.11 |
| @tanstack/react-table | ^8.21.3 |
| @tanstack/react-virtual | ^3.13.19 |
| papaparse | ^5.5.3 |
| motion | ^12.34.3 |
| date-fns | ^4.1.0 |
| exceljs | ^4.4.0 |
| @dnd-kit/core | ^6.3.1 (unchanged) |
| @dnd-kit/sortable | ^8.0.0 (unchanged) |
| @dnd-kit/utilities | ^3.2.2 (unchanged) |
| electron-store | ^8.2.0 (unchanged) |
| dompurify | 3.3.1 (unchanged) |

### Dev Dependencies
| Package | Target |
|-|-|
| electron | ^39.0.0 |
| electron-vite | ^3.1.0 |
| vite | ^6.0.0 |
| @vitejs/plugin-react | ^4.3.4 (unchanged) |
| electron-builder | ^26.8.1 |
| @electron/rebuild | ^3.7.2 (unchanged) |
| @electron/fuses | ^2.1.0 (unchanged) |
| typescript | ^5.9.3 |
| @types/react | ^19.2.14 |
| @types/react-dom | ^19.2.3 |
| @types/node | ^22.13.5 (unchanged) |
| postcss | ^8.5.6 |
| autoprefixer | REMOVED |
| @tiptap/extension-underline | REMOVED |

### Removed
| Package | Reason |
|-|-|
| autoprefixer | Tailwind 4 bundles vendor prefixing |
| @tiptap/extension-underline | Bundled in TipTap 3 StarterKit |
| xlsx | Replaced by exceljs (done in prior commit) |
