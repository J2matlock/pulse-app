# Auto-Update Plan — CaseConnect Pulse

## Current State

You already have:
- A "Check for updates" button in Settings > About (`AboutSection.tsx`)
- A placeholder IPC handler (`ipc-app.ts:125-152`) that fetches a `latest.json` from a URL
- The handler compares semver, validates the download URL, and returns `{ available, version, downloadUrl }`
- The UI shows "Version X.Y.Z is available" with a "Download" link that opens the browser

**Important constraint:** Your Windows build is a **portable .exe** (not an NSIS installer). Portable apps can't auto-update in place — there's no installer to silently swap files. So the right pattern is exactly what you have: check for a new version, tell the user, link them to download it. This is what apps like Obsidian and many portable Electron apps do.

You do NOT need `electron-updater`. That library is for NSIS/MSI installers that can silently replace themselves. Your portable exe flow is simpler and better for your audience.

## What You Need to Do

### Step 1: Create a GitHub repo for releases (if you don't have one already)

You need a public place to host two things:
- The `latest.json` manifest file (tiny JSON, tells the app what the newest version is)
- The actual `.exe` and `.AppImage` build artifacts (so the download link works)

**Option A: GitHub Releases (recommended)**
1. Create a repo (can be separate from your source code, e.g. `baringasoft/pulse-releases`)
2. You'll upload build artifacts as GitHub Release assets
3. Host `latest.json` via GitHub Pages or as a raw file in the repo

**Option B: Any static file host**
- S3 bucket, Cloudflare R2, Netlify, your own server — anything that serves files over HTTPS
- You'd upload `latest.json` + the exe/AppImage after each build

GitHub Releases is free and the most common choice. The rest of this plan assumes GitHub.

### Step 2: Set up GitHub Pages for latest.json

1. In your releases repo, enable GitHub Pages (Settings > Pages > Source: main branch, `/docs` folder)
2. Create `docs/latest.json`:

```json
{
  "version": "1.0.0",
  "releaseNotes": "Initial release",
  "downloadUrl": "https://github.com/baringasoft/pulse-releases/releases/latest/download/CaseConnectPulse-1.0.0.exe",
  "linuxDownloadUrl": "https://github.com/baringasoft/pulse-releases/releases/latest/download/CaseConnectPulse-1.0.0.AppImage"
}
```

The URL for this file will be: `https://baringasoft.github.io/pulse-releases/latest.json`

Alternative: Instead of GitHub Pages, you can use the raw file URL:
`https://raw.githubusercontent.com/baringasoft/pulse-releases/main/latest.json`

### Step 3: Update the code (two small changes)

**Change 1: `src/main/ipc/ipc-app.ts` line 129**

Replace the placeholder URL:
```
const UPDATE_CHECK_URL = 'https://your-domain.com/pulse/latest.json'
```
with your actual URL:
```
const UPDATE_CHECK_URL = 'https://baringasoft.github.io/pulse-releases/latest.json'
```

Also remove the early-return guard on lines 130-132 (the `if (UPDATE_CHECK_URL.includes('your-domain.com'))` block).

**Change 2: `src/renderer/components/settings/AboutSection.tsx` line 28**

Replace the placeholder fallback URL:
```
const url = result?.downloadUrl || 'https://your-domain.com/download'
```
with your LemonSqueezy product page (or GitHub releases page):
```
const url = result?.downloadUrl || 'https://your-lemonsqueezy-url.com'
```

**Change 3 (optional but recommended): Add platform-aware download URL**

Right now the handler returns a single `downloadUrl`. You could extend it to return a platform-specific URL so Linux users get the AppImage link. In `ipc-app.ts`, after parsing the JSON response:

```typescript
// Pick platform-appropriate URL
const platformUrl = process.platform === 'win32'
  ? data.downloadUrl
  : data.linuxDownloadUrl ?? data.downloadUrl
```

And return `downloadUrl: platformUrl` instead of `downloadUrl: safeDownloadUrl`.

### Step 4: Your release workflow (what you do each time you ship a new version)

Every time you want to release a new version:

1. **Bump the version** in `package.json` (e.g. `"version": "1.1.0"`)

2. **Build the artifacts:**
   ```bash
   npm run package:linux    # produces dist/CaseConnectPulse-1.1.0.AppImage
   npm run package:win      # produces dist/CaseConnectPulse-1.1.0.exe
   ```

3. **Create a GitHub Release:**
   - Go to your releases repo > Releases > "Draft a new release"
   - Tag: `v1.1.0`
   - Title: `v1.1.0`
   - Write release notes (what changed)
   - Drag and drop the `.exe` and `.AppImage` files as release assets
   - Publish

4. **Update `latest.json`:**
   ```json
   {
     "version": "1.1.0",
     "releaseNotes": "Added contact import, fixed backup bug",
     "downloadUrl": "https://github.com/baringasoft/pulse-releases/releases/download/v1.1.0/CaseConnectPulse-1.1.0.exe",
     "linuxDownloadUrl": "https://github.com/baringasoft/pulse-releases/releases/download/v1.1.0/CaseConnectPulse-1.1.0.AppImage"
   }
   ```
   Commit and push. GitHub Pages will update within a minute.

5. **Update the LemonSqueezy product** with the new `.exe` so new buyers get the latest version.

That's it. When existing users click "Check for updates", the app fetches your `latest.json`, compares versions, and shows them the download link.

### Step 5 (optional): Automate with GitHub Actions

If you want to skip the manual steps, you can add a GitHub Actions workflow that:
1. Triggers when you push a version tag (`v*`)
2. Builds both platforms
3. Creates the GitHub Release with assets
4. Auto-updates `latest.json`

This is nice-to-have, not required. Manual releases work fine for a solo dev shipping quarterly.

## What about auto-update (silent background updates)?

If you ever want true silent auto-updates (no user action, app replaces itself):
- You'd need to switch from portable `.exe` to an **NSIS installer** target
- Install `electron-updater` and configure it with the GitHub provider
- The app would download the new installer in the background and prompt the user to restart

This is a bigger change and probably not worth it right now. Your users download a portable exe from LemonSqueezy — that's the product model. The "check + download" pattern is simpler, more transparent, and matches user expectations for a portable app.

## Summary

| What | Where |
|-|-|
| Version manifest | `latest.json` hosted on GitHub Pages (or any HTTPS URL) |
| Build artifacts | GitHub Releases (free, unlimited for public repos) |
| Code changes | 2 lines in `ipc-app.ts`, 1 line in `AboutSection.tsx` |
| Purchase/license | LemonSqueezy (stays as-is) |
| Release process | Build > upload to GitHub Release > update `latest.json` > update LemonSqueezy |
