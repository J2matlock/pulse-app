# Pulse

**A free, private tracker for everything with a deadline.** People, paperwork, vehicles, inspections, renewals. Pulse runs on your computer, works without the internet and is encrypted with your password.

Pulse started as a caseload tracker built by a care coordinator with 12+ years in human services. It now comes with 38 ready-made starters (human services, therapy, special education, property management, fleets, animal rescue, caring for a parent and more), and you can change every word, column and rule.

- **Deadlines that know your rules:** "90 days after intake", "every quarter", "every 5,000 miles or 6 months", "sessions left on this authorization", step-by-step milestones, business days and extensions.
- **Colors that tell you what to do next:** green is fine, yellow is coming up, red is overdue.
- **Calendar and appointments, a board view, linked lists, forms, encrypted files, reports and desktop reminders.**
- **Bring your spreadsheet:** import from Excel or CSV.
- **Stays on your computer:** no account, no cloud, no telemetry. The database is encrypted (SQLCipher, AES-256), Pulse locks itself when you step away, and backups are automatic. The only network request is an optional update check.

Website: https://baringasoft.com

## Download

Get the latest version from the [releases page](https://github.com/J2matlock/pulse-releases/releases/latest).

- **Windows 10/11:** download `PULSE.exe` and run it. It's portable: your data is kept in a `PulseData` folder next to it. Pulse isn't code-signed, so the first time Windows may say "Windows protected your PC": click **More info → Run anyway**.
- **Linux:** download the AppImage, make it executable (`chmod +x`) and run it, or see [Building](#building).
- **Mac:** macOS 13 (Ventura) or newer.

Each release lists SHA-256 checksums in `SHA256SUMS.txt`.

## Building

You need Node.js 22 or newer and npm. The encrypted SQLite module ships prebuilt for Windows, macOS and Linux (x64 and arm64; Linux needs glibc 2.35+, e.g. Ubuntu 22.04+), so a C++ toolchain is only needed on other platforms.

```bash
git clone https://github.com/J2matlock/pulse-app.git
cd pulse-app
npm install
npm run dev          # run Pulse in development mode
```

Packages:

```bash
npm run package:linux   # AppImage in dist/
npm run package:win     # Windows PULSE.exe (needs Inno Setup; on Linux, under Wine: bash scripts/setup-innosetup.sh)
npm run package:mac     # macOS (on a Mac)
```

The first `npm run dev` downloads Electron itself (Electron 42+ no longer downloads during `npm install`).

## Tests

```bash
npm test             # unit and integration tests
npm run typecheck
npm run lint
npm run test:e2e     # Playwright end-to-end tests against the built app
```

Always run tests through `npm test`, not `vitest` directly.

## How it's built

Electron, React, TypeScript, Tailwind CSS and SQLite (`better-sqlite3-multiple-ciphers`). All database access happens in the main process; the renderer talks to it over typed IPC channels (`src/shared/ipc-channels.ts`, `src/shared/ipc-contract.ts`). `CLAUDE.md` is the developer guide, and `plans/` holds the design specs.

## Contributing

Bug reports, ideas for new starters and pull requests are welcome. Please open an issue first for anything large. Pulse is used by people who aren't tech-savvy, so plain language, 15px text and 44px click targets matter (see `CLAUDE.md`).

Found a security problem? Please email support@baringasoft.com with "SECURITY" in the subject instead of opening a public issue.

## Support the project

Pulse is free. If it helps you, tell a coworker, or buy the developer a coffee.

## License

Copyright © 2026 BaringaSoft

Pulse is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3, as published by the Free Software Foundation. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for details.

Third-party licenses are listed in `THIRD_PARTY_LICENSES.txt`.

Pulse is a tracking aid, not an official record system. Keep your official records where your agency, court or regulator requires them.
