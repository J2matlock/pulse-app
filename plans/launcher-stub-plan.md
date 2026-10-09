# Launcher Stub Plan — Fast-Start Portable EXE

## Problem

The current Windows portable EXE is a self-extracting archive. Every time the user clicks it, Electron extracts ~200MB+ to a temp directory before anything appears on screen. This takes 8-10 seconds with zero visual feedback. Users think nothing happened and click again (though our single-instance lock prevents duplicate windows, the experience is bad).

## Solution: "Extract Once" Launcher with Splash Screen

Replace the current single portable EXE with a **launcher stub** that:

1. Shows a branded splash window instantly (< 200ms)
2. On first run: extracts the app to a permanent folder next to itself
3. On subsequent runs: detects the already-extracted app and launches it directly
4. Hides the inner Electron EXE — user only ever sees the launcher

### What the user experiences

- **First launch:** Click EXE -> splash screen appears immediately -> progress text ("Setting up Pulse...") -> app opens. Slow, but they can see it's working.
- **Every launch after:** Click EXE -> splash screen for ~1 second -> app opens. Fast.
- **USB portable:** Works the same. Folder structure travels with the EXE.

### Folder structure on disk

```
D:\MyUSB\
  PulseByBaringaSoft.exe          <-- The launcher stub (~500KB)
  PulseData\                      <-- User data (already exists today)
    pulse.db
    backups/
  .pulse-app\                     <-- Extracted Electron app (hidden folder)
    Pulse by BaringaSoft.exe      <-- Real Electron EXE
    resources/
    ...etc
    .version                      <-- Text file with version string, e.g. "1.0.0-preview"
```

## Implementation Approach: Inno Setup in Portable Mode

**Why Inno Setup over a custom stub or 7-Zip SFX:**
- Well-tested, widely used, handles edge cases (partial extraction, disk full, etc.)
- Shows a real progress bar during extraction — no custom GUI code
- Can be configured for zero registry writes, zero Start Menu entries, no admin required
- Has version checking built in (only re-extract when version changes)
- Free and open source
- We already cross-compile from Linux (Inno Setup runs under Wine)

**Why not a custom Go/C# stub:**
- More code to write and maintain
- Need to handle Windows GUI, error cases, cleanup — Inno Setup already does this
- Not worth the engineering time for what is essentially a self-extractor

**Why not 7-Zip SFX:**
- Less control over the UX (generic dialog, no branding)
- No built-in "skip extraction if already extracted" logic — we'd need a wrapper script anyway

## Detailed Steps

### Step 1: Change electron-builder target from `portable` to `dir`

**Plain English:** Right now electron-builder produces a single self-extracting EXE. We switch it to produce a plain directory of files instead. This directory is what we'll package into the launcher.

**Changes:**
- In `package.json`, change `build.win.target` from `[{target: "portable", arch: ["x64"]}]` to `[{target: "dir", arch: ["x64"]}]`
- Remove `build.win.artifactName` (not needed for dir target)
- In `scripts/build-win.js`, update Step 5 to expect a `win-unpacked/` directory instead of an `.exe` file

### Step 2: Create Inno Setup script

**Plain English:** Inno Setup uses a `.iss` script file that describes what to package and how to install. Our script will be configured as a "portable installer" — it extracts files to a folder next to itself, doesn't touch the registry, doesn't need admin rights, and doesn't create Start Menu entries.

**New file:** `scripts/pulse-launcher.iss`

Key configuration:
```ini
[Setup]
AppName=Pulse by BaringaSoft
AppVersion={#AppVersion}
; No admin required
PrivilegesRequired=lowest
; Extract next to the EXE, not to Program Files
DefaultDirName={src}\.pulse-app
; No uninstaller (it's portable)
Uninstallable=no
CreateUninstallRegKey=no
; No Start Menu
DisableProgramGroupPage=yes
; No directory selection UI — silent extraction
DisableDirPage=yes
; Branding
WizardStyle=modern
SetupIconFile=..\build\icon.ico
WizardSmallImageFile=..\build\icon-55.bmp

[Files]
; Pack the entire win-unpacked directory
Source: "..\dist\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs

[Run]
; After extraction, launch the real app
Filename: "{app}\Pulse by BaringaSoft.exe"; Flags: nowait skipifsilent

[Code]
// Pascal script to:
// 1. Check if .pulse-app\.version matches current version -> skip extraction
// 2. Show "Setting up Pulse..." splash during extraction
// 3. Write .version file after successful extraction
// 4. On subsequent runs, just launch the inner EXE directly
```

The `[Code]` section is where the "extract once" logic lives. Inno Setup's Pascal scripting supports checking files, comparing versions, and conditionally skipping extraction.

### Step 3: Add version stamp file

**Plain English:** After extraction, the launcher writes a tiny `.version` file inside `.pulse-app/`. On every launch, it checks if this file matches the current version. If it matches, skip extraction and launch directly. If it doesn't match (user downloaded a new version), re-extract.

This handles upgrades cleanly: drop the new launcher EXE next to PulseData, and it automatically extracts the new version on first run.

### Step 4: Create splash bitmap

**Plain English:** Inno Setup can show a small image during setup. We need a 55x55 BMP file for the wizard and optionally a larger banner. We can generate these from our existing `icon-256.png`.

**New file:** `build/icon-55.bmp` (generated from icon-256.png during build)

### Step 5: Update build-win.js

**Plain English:** The build script gains a new final step: after electron-builder produces the `win-unpacked/` directory, run Inno Setup (via `iscc` under Wine on Linux, or native `iscc` on Windows) to package it into the launcher EXE.

**Changes to `scripts/build-win.js`:**

```
Current flow:
  1. electron-vite build
  2. Download Windows native binary
  3. Create staging dir
  4. electron-builder --win (produces portable EXE)
  5. Copy artifacts
  6. Cleanup
  7. Code signing

New flow:
  1. electron-vite build
  2. Download Windows native binary
  3. Create staging dir
  4. electron-builder --win (produces win-unpacked/ directory)
  5. Run Inno Setup to create launcher EXE from win-unpacked/
  6. Copy launcher EXE to dist/
  7. Cleanup
  8. Code signing (sign the launcher EXE)
```

New step 5 detail:
```js
// Inno Setup compilation
// On Linux: wine "C:\Program Files\Inno Setup 6\ISCC.exe" scripts/pulse-launcher.iss
// On Windows: "C:\Program Files\Inno Setup 6\ISCC.exe" scripts/pulse-launcher.iss
// Pass version as define: /DAppVersion=1.0.0-preview
```

### Step 6: Linux build — no changes needed

**Plain English:** Linux uses AppImage, which already extracts and mounts instantly via FUSE. No launcher stub needed. This plan only affects Windows.

### Step 7: Update getPortableDataDir()

**Plain English:** Currently, `database.ts` uses `PORTABLE_EXECUTABLE_DIR` to find the directory where the user placed the EXE. With the new launcher, the inner Electron EXE lives inside `.pulse-app/`, so `process.execPath` points there. We need to go up one more level to find `PulseData/`.

However — Inno Setup launches the inner EXE, and `PORTABLE_EXECUTABLE_DIR` won't be set (that's an electron-builder portable feature). We have two options:

**Option A (simpler):** Set a custom environment variable in the Inno Setup `[Run]` section:
```ini
[Run]
Filename: "{app}\Pulse by BaringaSoft.exe"
Parameters: "--launcher-dir={src}"
```
Then in `index.ts`, parse `--launcher-dir` and pass it to `getPortableDataDir()`.

**Option B (no app changes):** Have Inno Setup set `PORTABLE_EXECUTABLE_DIR` as an environment variable before launching. The existing code already reads this. This is the cleanest option — zero changes to the Electron app code.

**Recommendation:** Option B. Zero app code changes.

### Step 8: Handle .pulse-app as hidden folder

**Plain English:** On Windows, we can mark `.pulse-app/` as hidden (like dotfiles on Unix) so it doesn't clutter the user's view. Inno Setup can set the hidden attribute on the directory.

### Step 9: Update .gitignore

Add `*.bmp` build artifacts if generated, and any Inno Setup output directories.

## Build Dependencies

- **Inno Setup 6:** Free, open source. On Linux, runs under Wine.
  - Install: `sudo dnf install wine` then download Inno Setup 6 installer and run via Wine
  - Or use the Docker image `amake/innosetup` for CI
- **ImageMagick** (optional): To convert PNG to BMP for the splash image
  - `convert build/icon-256.png -resize 55x55 build/icon-55.bmp`

## Risk Assessment

| Risk | Mitigation |
|-|-|
| Inno Setup under Wine is flaky | Well-tested combo; used by many open source projects. Can also build on Windows CI. |
| Users delete .pulse-app folder | Launcher re-extracts on next run. PulseData is separate, so no data loss. |
| Antivirus flags the launcher | Inno Setup EXEs are widely whitelisted. Code signing (Step 8 in build script) helps further. |
| Version check fails | Worst case: re-extracts every launch (same as today but with a progress bar). |
| Disk space for extracted app | ~250MB for .pulse-app. Same as temp extraction today, but persistent. Users need this space regardless. |

## What Stays the Same

- PulseData folder location (next to the launcher EXE)
- Single-instance lock (Electron's `requestSingleInstanceLock`)
- All app behavior, database, backups — completely unchanged
- Linux AppImage build — unchanged
- Code signing — applied to the launcher EXE instead of the portable EXE

## What Changes

- Windows build output: single portable EXE -> Inno Setup launcher EXE
- First launch: ~same speed but with visible progress bar
- Subsequent launches: ~1-2 seconds instead of 8-10 seconds
- Disk footprint: adds a persistent `.pulse-app/` folder (~250MB) next to the EXE

## Open Questions

1. **Should we show "Setting up Pulse..." text or a real progress bar?** Inno Setup supports both. Progress bar is better UX but makes it look more like an "installer," which might confuse users who expect portable.

2. **Should the launcher EXE be named `Pulse by BaringaSoft.exe` or `PulseByBaringaSoft.exe`?** Currently it's `CaseConnectPulse-1.0.0-preview.exe`. The launcher is the new "front door" so naming matters.

3. **Should we keep a fallback `portable` target in electron-builder for users who truly want single-file?** Could offer both via `package:win:portable` and `package:win:launcher`.

## Estimated File Changes

| File | Change |
|-|-|
| `package.json` | Win target: portable -> dir; add `package:win:launcher` script |
| `scripts/build-win.js` | Add Inno Setup compilation step after electron-builder |
| `scripts/pulse-launcher.iss` | NEW — Inno Setup script with extract-once logic |
| `build/icon-55.bmp` | NEW — splash image for Inno Setup wizard |
| `.gitignore` | Add Inno Setup output dirs |
| `src/main/database.ts` | Possibly no changes (if Option B for PORTABLE_EXECUTABLE_DIR) |
