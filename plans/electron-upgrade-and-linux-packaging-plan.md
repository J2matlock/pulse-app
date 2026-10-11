# Plan: Electron upgrade, Linux .deb, asar integrity (AUDIT-089, 019, 094/186)

Approved in principle on 2026-10-11 ("approve all with the noted tweaks"). This file is the plan to check before implementing.

## Why
- Electron 39 reached end of life on 2026-05-05 (Chromium M142). Pulse holds health-adjacent client data, and it's running an unpatched Chromium.
- Supported lines as of 2026-10-11: 44 (EOL 2027-03-02), 43 (EOL 2027-01-05), 42 (EOL 2026-10-20). Electron 45 ships 2026-10-20.
- Electron 40+ uses Node 24. Node 24 is now an LTS line, so the 2026-02-27 decision-log reason ("Node 24 bleeding edge") no longer holds.

## Target
**Electron 44.x**: the latest patch that is at least 2 weeks old at implementation time. It gives the longest runway (to March 2027) without taking a brand-new major. Plan to re-bump every 1–2 majors from now on. Alternative: 43.x, if the native module doesn't support 44 yet.

## Steps
1. **Compatibility check (no code changes).**
   - better-sqlite3-multiple-ciphers: does the pinned 12.6.2 (or a newer 12.x) build or have prebuilds for the Electron 44 ABI (Node 24 headers)? Check its changelog and issues.
   - @electron/fuses and electron-builder 26.8: do they support Electron 44's fuse layout?
   - electron-vite 3 / Vite 6: is the `electron` peer range fine?
   - electron-store 8: does it still work on Node 24? (CommonJS; expected yes.)
   - Electron 40–44 breaking changes: read the "Breaking changes" doc for each major. Watch for removed or renamed APIs Pulse uses: `session.setSpellCheckerEnabled`, `safeStorage`, `shell.openExternal`, `setWindowOpenHandler`, `webContents` print APIs, `protocol` registration, clipboard, `powerMonitor` (lock on sleep), and changed default `webPreferences`.
2. **Bump** electron (exact version) plus anything step 1 requires. Run `npx electron-rebuild -f -w better-sqlite3-multiple-ciphers`, then `npm test`, `npm run typecheck` and lint.
3. **Packaging config**
   - Add a `deb` target next to the AppImage in the `linux` build section. It needs maintainer, category and depends; electron-builder's deb includes an AppArmor profile for the sandbox on Ubuntu 24.04+.
   - README: Ubuntu AppImage note (`sudo apt install libfuse2t64`, plus the AppArmor workaround) and a .deb install line.
   - Fuses: set `EnableEmbeddedAsarIntegrityValidation: true` for **darwin and win32 only** in `scripts/afterPack.js`.
   - The build scripts (staging + `npm ci`) need no change apart from the new target.
4. **Verification (needs you, or VMs)**

   | Platform | Check |
   |-|-|
   | Fedora (dev machine) | AppImage launches, unlock, backup/restore, PDF export, no spellcheck network calls |
   | Ubuntu 24.04 VM, stock | .deb installs and launches (sandbox on); AppImage behavior documented |
   | Windows 11 | PULSE.exe launcher + version-change path; asar integrity on (app launches; a tampered app.asar refuses to start) |
   | macOS (arm64) | Launch with the tightened entitlements + asar integrity |

5. **Docs**: update the CLAUDE.md tech stack and decision log ("Upgrade to Electron 44; Node 24 is LTS now"), and progress.md.

## Risks
- The native module is the main risk. If there's no build for 44, either pin 43 or build from source in the staging step (slower CI, needs a toolchain on build machines).
- Chromium changes could subtly alter print/PDF and focus behavior. The a11y tests and axe checks catch some of this, and the manual QA list covers the rest.
- Asar integrity can brick launch if the hash isn't embedded. That's why it ships only after the Windows and macOS launch checks.

## Not in scope
Code signing (still out per the 2026-10-09 decision), Flatpak/Snap, auto-update.
