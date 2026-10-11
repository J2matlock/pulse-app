# macOS build (brainstorm E2)

Status: **prepared, not shipped.** Everything that can be done without a Mac and an Apple Developer account is done. Building, signing, notarizing and testing need both.

## What's in place
- **Build config** (`package.json` → `build.mac`): dmg + zip, Apple Silicon (arm64) and Intel (x64) as separate downloads, macOS 13+ (Electron 44's minimum; was 12+ under Electron 39), hardened runtime, dark mode, `BaringaSoftPulse-<version>-<arch>.dmg`.
- **`npm run package:mac`** → `scripts/build-mac.js`. Runs only on macOS. Uses a production-only staging folder (same approach as Linux) and builds each architecture separately so each gets its own native database module. It signs and notarizes automatically when the environment variables below are set; otherwise it makes an unsigned test build.
- **Security fuses** (`scripts/afterPack.js`) apply to the Mac build too. Flipping them invalidates the ad hoc signature of an unsigned arm64 build, so the script re-signs it ad hoc (`resetAdHocDarwinSignature`); without that, an unsigned Apple Silicon build won't launch.
- **Menu bar**: macOS only lets Cut/Copy/Paste/Select All work in text fields when the menu bar has them. `src/main/app-menu.ts` adds an app menu (About, Hide, Quit), an Edit menu and a Window menu. Undo/Redo appear in the menu but leave the keys to the page, so Cmd+Z undoes typing in a text field and undoes the last Pulse change elsewhere.
- **Shortcuts**: every Ctrl shortcut also works with Cmd on a Mac (`src/renderer/utils/keys.ts`). Ctrl still works too.
- **Closing the window quits**, on macOS as well. Pulse is one window over an encrypted database, and quitting is what closes the database and runs the on-close backup. (Mac apps usually keep running; this is a deliberate exception.)
- **Update check**: `latest.json` may now include `"downloads": { "win": "…", "mac": "…", "linux": "…" }`; each platform gets its own link. Files with only `downloadUrl` still work.

## What needs the Apple account ($99/year)
1. Enroll in the Apple Developer Program as an organization (BaringaSoft) or individual.
2. In Xcode or the developer site, create a **Developer ID Application** certificate and install it in the login keychain of the Mac doing the build.
3. Create an **app-specific password** for your Apple ID (appleid.apple.com → Sign-In and Security), and find your **Team ID** (developer.apple.com → Membership).
4. Build:
   ```bash
   export CSC_NAME="Developer ID Application: BaringaSoft (TEAMID)"
   export APPLE_ID="you@example.com"
   export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
   export APPLE_TEAM_ID="TEAMID"
   npm run package:mac
   ```
   Notarization uploads the app to Apple and usually takes a few minutes per architecture. Never commit these values.

## Test checklist on a real Mac
- [ ] Unsigned build opens on the build Mac (right-click → Open the first time).
- [ ] Signed + notarized build opens on a *different* Mac with no warning.
- [ ] Set a password, add clients, lock, unlock. (If unlock silently fails, the native module was built for the wrong architecture.)
- [ ] Cmd+C / Cmd+V / Cmd+X / Cmd+A in a text field, a grid cell editor and a case note.
- [ ] Cmd+Z in a text field undoes typing; outside a text field it undoes the last Pulse change. Edit → Undo with the mouse does the same.
- [ ] Cmd+K, Cmd+N, Cmd+L, Cmd+Shift+F. (Cmd+H is macOS's Hide; Find & Replace stays on Ctrl+H.)
- [ ] Closing the window quits; reopening asks for the password; the on-close backup appears in Settings → Backup.
- [ ] Backups, the move-to-a-new-computer wizard, and opening a `.pulse` template by double-click.
- [ ] Printing and PDF exports; file save dialogs.
- [ ] Try removing `com.apple.security.cs.disable-library-validation` from `build/entitlements.mac.plist` (the native module is signed with the same certificate, so it may not be needed). If the signed app still unlocks, keep it removed; fewer exceptions look better in an IT security review.

## Known gaps
- Shortcut labels in the app still say "Ctrl" (they work with Cmd too). Showing ⌘ on a Mac is a small follow-up.
- No universal (single) build: two downloads keep the native module simple. The website should offer "Apple Silicon (M1 or newer)" and "Intel".
- Auto-update stays "check and link to download", as on Windows: Pulse never updates or restarts itself.
