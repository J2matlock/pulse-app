# HIPAA Security Rule — Safeguards Map for Pulse

**Scope:** Pulse used by one worker on one computer (one user per license). The employer (the covered entity) stays responsible for its HIPAA program; this map shows which safeguards Pulse provides, which it helps with, and which remain the agency's job.
**Reviewed:** 2026-09-30, against the current Security Rule (45 CFR 164.308–316). Evidence is from the code at commit `061e078`.

**Status key:** **Met** = Pulse provides it · **Partial** = provided with a gap · **Gap** = not provided · **Agency** = the employer's responsibility (Pulse can't do it for them)

> **Proposed rule:** HHS proposed a major Security Rule update on Jan 6, 2025 (90 FR 898). It would make encryption at rest and multi-factor authentication mandatory, among other things. As of our last check (July 2026 sources), no final rule has been published. The "Proposed rule" notes below show where Pulse already fits it.

## Technical safeguards (164.312)

| Requirement | Status | How Pulse handles it | Evidence |
|-|-|-|-|
| **Unique user identification** (a)(2)(i) | Met (single user) | One license, one user, one password. Every record in the database belongs to that user. | `src/main/auth.ts` |
| **Emergency access procedure** (a)(2)(ii) | Met | 28-character recovery key (about 134 bits) unlocks the data if the password is lost. Backups can be restored on another computer with the password or recovery key. | `auth.ts` `generateRecoveryKey`, `restoreBackupOnNewInstall` in `backup.ts` |
| **Automatic logoff** (a)(2)(iii) | Met | Locks after inactivity (default 30 min; 5 min–2 h; there's no "never"), and immediately when the computer sleeps, the screen locks, or the user switches. A main-process fallback locks even if the window crashes. | `src/main/index.ts` `forceLock`, `powerMonitor`; `shared/constants.ts` `normalizeAutoLockMinutes` |
| **Encryption and decryption** (a)(2)(iv) | Met | The whole database is encrypted with SQLCipher 4 (AES-256, HMAC-SHA512 page authentication) using a random 256-bit key. The key is wrapped by the password (PBKDF2-SHA256, 600,000 iterations, AES-256-GCM), plus the OS keystore where available. The key is wiped from memory on lock. **Proposed rule:** already meets "encryption at rest". | `database.ts` `openEncryptedDatabase`; `auth.ts` |
| **Audit controls** (b) | Partial | Change history per cell (last 50 changes), an automatic activity timeline, every edited version of a case note, and notes older than 15 minutes can only be voided (kept, hidden), never deleted. **Gaps:** no record of who *viewed* what (single user, so lower value); no one-click audit export yet. | `ipc-cell.ts` history; `ipc-caselog.ts` `case_log_edits`, delete window |
| **Integrity** (c)(1)–(2) | Met | Every encrypted page is authenticated (HMAC), so tampering is detected. Backups carry a SHA-256 checksum that's verified on restore. Writes use transactions. | SQLCipher HMAC; `backup.ts` `streamHash` |
| **Person or entity authentication** (d) | Met | Password (new passwords: 12+ characters, common passwords blocked; bcrypt-checked) with lockout after repeated failures (30 s → 5 min), and a notice of wrong attempts since the last unlock. **Proposed rule:** would require MFA; Pulse has no second factor. | `auth.ts` `verifyAndUnlock`, `shared/passwordPolicy.ts` |
| **Transmission security** (e)(1) | Met (N/A) | Client data is never transmitted. The only network calls are an update check once per unlock (no data sent) and license activation (license key plus an anonymous machine hash), both over HTTPS. The app's content policy blocks any other connection. | `licensing.ts`, `ipc-app.ts` update check, CSP in `index.ts` |

## Physical safeguards (164.310)

| Requirement | Status | Notes |
|-|-|-|
| Workstation use and security (b)–(c) | Agency | Locking the computer, screen privacy, where it's used. Pulse helps with auto-lock and clears the clipboard on lock. |
| Device and media controls: disposal and re-use (d)(2)(i)–(ii) | Met / Agency | Factory reset deletes the database, credentials, and local backups (fixed `d035d90`). Wiping the disk is the agency's job. |
| Accountability (d)(2)(iii) | Agency | Tracking which laptop holds the data. |
| Data backup and storage (d)(2)(iv) | Met | Encrypted automatic backups on close (tiered retention), scheduled backups to a chosen folder, and manual backups. All are encrypted. |

## Administrative safeguards (164.308) — where Pulse helps

| Requirement | Status | Notes |
|-|-|-|
| Risk analysis / risk management (a)(1) | Agency | This map and `security-at-a-glance.md` are inputs to the agency's risk analysis. |
| Information system activity review (a)(1)(ii)(D) | Yes | Activity timeline and audit mode per client; audit trail PDF per client or caseload over any date range (field changes, all notes including voided ones and earlier versions, checklist completions). |
| Log-in monitoring (a)(5)(ii)(C) | Met | Failed unlocks are counted, trigger lockouts, and are reported to the user at the next unlock. |
| Password management (a)(5)(ii)(D) | Met | New passwords need 12+ characters and aren't on a common-password list; strength meter; change password; recovery key. |
| Data backup plan / disaster recovery (a)(7)(ii)(A)–(B) | Met | Backups plus restore on a new computer. The agency decides where backups live. |
| Testing and revision (a)(7)(ii)(D) | Partial | Backups can be verified (checksum and decrypt test). No reminder to do a test restore. |
| Business associate contracts (b)(1) | Likely not needed | BaringaSoft never creates, receives, stores, or transmits client data; HHS guidance says a software vendor without access to PHI is not a business associate. **Have a lawyer confirm before stating this in writing.** |

## Things that leave the encrypted boundary

| Item | Encrypted? | Notes |
|-|-|-|
| Database, auto-backups, `.pulse-backup` files | Yes | Includes files attached to records (stored as blobs inside the database). |
| Opened files (`<Pulse data folder>/tmp-open`) | **No** | Opening an attached file writes a copy with a random name and owner-only permissions so the system viewer can show it. The folder is emptied after 10 minutes where possible, on every lock and quit, and on startup. |
| Background mode (tray) | n/a | Optional. Closing the window locks (database closed, key wiped); reminders use counts and appointment times held in main-process memory only, captured at lock time, dropped on quit. Names never leave the database for this. Notification text can show on the lock screen or in notification history, which is why names in reminders are off by default. The only things stored outside the database are the two on/off choices (`pulse-prefs.json`). |
| "Save a copy" of an attached file | **No** | An ordinary file the user chose to create; Pulse reminds them that copies aren't encrypted. |
| CSV / PDF exports, printed letters, supervisor reports | **No** | Files the user chose to create. Pulse says so after the first export each session; profile PDFs default to initials + date, not the client's name. |
| App logs (`<Pulse data folder>\logs`) | No | They contain no client data: fields such as name, content, phone, and notes are redacted. They can include folder paths the user picked. Removed by "Reset everything". |
| Clipboard | n/a | Cleared on lock and on quit. |
| Credential file (`pulse-secure.json`) | Wrapped | Holds only wrapped keys, salts, and hashes; never the raw key. |
