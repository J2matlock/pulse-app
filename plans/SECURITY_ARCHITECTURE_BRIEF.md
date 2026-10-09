# Pulse by BaringaSoft -- Security & Architecture Brief

**Version:** 0.1.0
**Date:** March 2026
**Prepared for:** IT Security Review & Procurement Evaluation
**Contact:** support@baringasoft.com
**Source code:** https://github.com/J2matlock/pulse-app (GNU GPL v3)

---

## 1. Architecture Overview

Pulse is a **100% offline desktop application** for caseload management. It is designed for care coordinators, social workers, case managers, and similar professionals who manage caseloads of people with recurring deadlines.

### Zero-Network Architecture

**Client data never leaves the computer. There is no server, no cloud, no telemetry.**

- No telemetry or analytics
- No crash reporting
- No automatic updates (installing an update is always manual)
- No data synchronization
- No third-party API calls
- The only outbound network calls are: an update check once each time Pulse is unlocked (GET of a public version file on GitHub; no data sent, GitHub sees only the computer's IP address). It can be turned off in Settings → About.

### Data Flow

```
User --> Application (Electron) --> Local Encrypted SQLite Database --> User's Machine Only
```

All data remains on the user's device at all times. There is no server component, no cloud storage, and no mechanism by which data could leave the device through the application.

### Platform Support

- Windows (portable .exe, no installation required)
- Linux (AppImage)
- macOS (dmg)

---

## 2. Data Protection

### Encryption at Rest

| Property | Detail |
|-|-|
| Engine | SQLCipher 4 (bundled statically) |
| Algorithm | AES-256 in CBC mode |
| KDF | PBKDF2-HMAC-SHA512, 256,000 iterations |
| HMAC | HMAC-SHA512 per database page |
| Page size | 4,096 bytes |
| Key length | 256-bit random key (crypto.randomBytes) |

The database key is a cryptographically random 256-bit value generated at initial setup. It is **never stored in plaintext** on disk.

### Key Management

The database encryption key is protected using a **key-wrapping pattern**:

1. User's password is processed through **PBKDF2-SHA256 with 600,000 iterations** and a unique 32-byte salt
2. The derived key encrypts (wraps) the database key using **AES-256-GCM** with a 12-byte IV and authentication tag
3. Only the wrapped (encrypted) key is stored on disk
4. On supported platforms, the wrapped key is further protected by the OS credential store (**DPAPI** on Windows, **Keychain** on macOS, **libsecret** on Linux) via Electron's safeStorage API
5. Password-, recovery-key-, and backup-envelope unwrapping all rely on the same PBKDF2 + AES-256-GCM construction; the OS credential store is an additional layer on this computer only (see Backup Security for portability)
6. The raw database key exists in memory only while the application is unlocked
7. On lock or close, the in-memory key is **cryptographically zeroed** (overwritten with random bytes before nulling)
8. The credential file is never deleted automatically; an unreadable file is quarantined and a last-known-good copy is restored

### Authentication

| Property | Detail |
|-|-|
| Password hashing | bcrypt, 12 rounds |
| Password policy | New passwords: 12+ characters, common passwords refused; strength meter |
| Failed-attempt notice | Wrong attempts since the last unlock are shown at the next unlock |
| Brute-force protection | Progressive lockout: 30s after 5 failures, 60s after 10, 5min after 15 (max 30min) |
| Lockout persistence | Survives application restart |
| Recovery | 28-character recovery key generated at setup, displayed as XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX (unambiguous character set, no modulo bias) |
| Credential changes | Creating, replacing, or revoking the recovery key requires the current password; password reset without the old password is only possible after a recovery-key unlock |
| Auto-lock | Inactivity timeout (5 min–2 h, no "never"), plus immediate lock when the computer sleeps, the screen locks, or the user switches |
| Lock on launch | Password required on every application start |

### File System Security

- Database file permissions: `0600` (owner read/write only) on Unix
- Process umask set to `0077` during database operations
- Backup directory permissions: `0700` (owner only)
- Backup files: `0600` (owner read/write only)

### Backup Security

- Backups are copies of the SQLCipher-encrypted database (encrypted at rest by default)
- Each `.pulse-backup` includes a **key envelope**: the database key wrapped by the user's password and recovery key (PBKDF2-600k + AES-256-GCM), without the machine-bound OS layer. A backup can therefore be restored on a new computer with the password or recovery key — and is protected by those alone, like any password-protected archive
- SHA-256 integrity hash verified on restore; the key is proven to open the backup before any existing data is touched, and an existing database is moved aside rather than overwritten
- Path traversal protection on archive extraction (validated against `..`, `/`, `\`)
- Zip bomb protection: 200MB compressed limit, 2GB uncompressed limit
- Atomic write pattern (temp file + fsync + rename) prevents corruption on power loss
- Temporary files cleaned up in `finally` blocks

---

## 3. Application Security

### Electron Hardening

Pulse follows Electron security best practices:

| Security Control | Status |
|-|-|
| Context Isolation | Enabled |
| Sandbox | Enabled |
| Node Integration | Disabled |
| DevTools in Production | Disabled |
| Web Security | Enabled |
| Permission Requests | All denied |
| Navigation Guards | Cross-origin blocked |
| New Window Creation | Blocked |
| F12 / DevTools Shortcut | Blocked in production |

### Content Security Policy

Applied at the protocol level (not meta tag), enforced for all renderer content:

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
font-src 'self';
connect-src 'self';
object-src 'none';
base-uri 'none';
form-action 'none';
```

No `eval()`, no remote code loading, no inline scripts in production.

### Custom Protocol

The application uses a custom `app://` protocol instead of `file://`, with path traversal guards that validate all requested paths are within the application bundle.

### SQL Injection Prevention

- All database queries use **parameterized statements** with `?` placeholders
- Dynamic column identifiers validated as safe positive integers before interpolation
- Database key format validated with strict regex (`/^[0-9a-f]{64}$/`) before use in PRAGMA
- Prepared statement cache with LRU eviction for performance

### Input Sanitization

- HTML content sanitized with DOMPurify before rendering
- File paths from user input validated against directory traversal
- All IPC (Inter-Process Communication) calls wrapped in try/catch with user-friendly error messages

---

## 4. Compliance Positioning

### HIPAA (Health Insurance Portability and Accountability Act)

BaringaSoft is not a covered entity, and because it never creates, receives, maintains, or transmits the ePHI stored in Pulse, it is not a business associate under HHS guidance on software vendors without access to PHI, so a Business Associate Agreement (BAA) is generally not required (each organization's compliance office makes the final determination). However, for organizations that store PHI locally, Pulse provides safeguards aligned with the HIPAA Security Rule (45 CFR 164.312):

- **Access Control (164.312(a)):** Password authentication on every launch, auto-lock after inactivity, progressive brute-force lockout
- **Encryption (164.312(a)(2)(iv)):** AES-256 encryption at rest via SQLCipher
- **Integrity (164.312(c)):** SHA-256 backup verification, parameterized queries preventing injection
- **Audit Controls (164.312(b)):** Change tracking and activity timeline for all data modifications

These technical controls satisfy encryption, access control, and integrity requirements without introducing the transmission risks that trigger most HIPAA enforcement actions.

### FERPA (Family Educational Rights and Privacy Act)

Because Pulse stores all data locally with zero network transmission, education records never leave the device, eliminating the third-party disclosure risks that FERPA's "reasonable methods" standard is designed to prevent. The encrypted local database, per-launch authentication, and inactivity lock meet FERPA's requirement for technical safeguards on systems storing student records. No vendor data sharing agreement is needed since Pulse never accesses, processes, or stores data on external servers.

### 42 CFR Part 2 (Substance Use Disorder Records)

Part 2's strict re-disclosure prohibitions make offline architecture ideal for SUD records. Pulse's zero-network design means substance use disorder data cannot be transmitted, intercepted, or re-disclosed electronically. Combined with AES-256 encryption and mandatory authentication, this architecture provides the strongest possible technical barrier against unauthorized disclosures.

### State Data Breach Notification Laws

All 50 U.S. states exempt encrypted data from breach notification requirements when the encryption key has not been compromised. Pulse's SQLCipher AES-256 encryption, with the key wrapped by the user's password via PBKDF2 (600,000 iterations) and never stored in plaintext, means that even physical device theft does not constitute a reportable breach under any state statute, provided the password remains uncompromised.

### SOC 2

As a locally-installed tool with no cloud component, Pulse falls outside SOC 2's scope (which applies to service organizations processing customer data). However, Pulse supports an organization's own SOC 2 posture by enforcing:

- **Confidentiality:** Encryption at rest
- **Security:** Authentication and auto-lock
- **Processing Integrity:** Audit trails and change tracking

Pulse does not introduce a new third-party data processor into the organization's compliance boundary.

---

## 5. Accessibility

Pulse is designed toward **WCAG 2.0 Level AA** conformance:

| Criterion | Implementation |
|-|-|
| 2.1.1 Keyboard | Full keyboard navigation: Tab, Shift+Tab, Arrow keys, Enter, Escape, F2, Home/End |
| 2.4.7 Focus Visible | 3px solid focus rings on all interactive elements |
| 1.4.4 Resize Text | 15px minimum font size throughout the application |
| Target Size | 44px minimum height for all interactive elements |
| Color Independence | Deadline status communicated via text labels in addition to color |
| Dark Mode | Full dark mode support with appropriate contrast ratios |

A formal **VPAT (Voluntary Product Accessibility Template)** is available upon request.

---

## 6. Software Bill of Materials (SBOM)

A complete CycloneDX 1.6 SBOM (`sbom.json`) is available upon request or included with the application distribution.

### Dependency Summary

| Metric | Value |
|-|-|
| Total production components | 255 |
| Direct dependencies | 28 |

### License Distribution (Production)

| License | Count |
|-|-|
| MIT | 245 |
| ISC | 17 |
| BSD-3-Clause | 4 |
| Apache-2.0 | 4 |
| BSD-2-Clause | 2 |
| Other permissive (0BSD, Unlicense, Python-2.0, Zlib) | 5 |
| Dual-licensed (permissive option available) | 3 |

**No copyleft-only (GPL, AGPL, LGPL) dependencies.** Every dependency's license is compatible with Pulse's own license, the GNU GPL v3. Dual-licensed packages (DOMPurify: MPL-2.0 or Apache-2.0; JSZip: MIT or GPL-3.0) are used under their permissive license option.

### Key Components

| Component | Version | License | Purpose |
|-|-|-|-|
| Electron | 39.7.0 | MIT | Application framework |
| better-sqlite3-multiple-ciphers | 12.6.2 | MIT | SQLCipher database engine |
| React | 19.2.4 | MIT | UI framework |
| DOMPurify | 3.3.1 | Apache-2.0 | HTML sanitization |
| ExcelJS | 4.4.0 | MIT | Spreadsheet import |
| bcryptjs | 3.0.3 | MIT | Password hashing |
| Zod | 4.3.6 | MIT | Input validation |

---

## 7. Frequently Asked Questions

**Q: Does the application phone home?**
A: Only one kind of request is made: an update check once each time Pulse is unlocked (reads a public version file; nothing is sent). It sends no PHI or personally identifiable information, and it can be turned off.

**Q: Where is my data stored?**
A: In a single encrypted SQLite database file on your local machine, in the standard application data directory for your operating system (e.g., `%APPDATA%` on Windows, `~/.config` on Linux).

**Q: What happens if my computer is stolen?**
A: The database is encrypted with AES-256. Without the password, the data is unreadable. Under all 50 U.S. state breach notification laws, encrypted data whose key has not been compromised is exempt from breach reporting.

**Q: Can my IT department audit the application?**
A: Yes. Pulse is open source under the GNU GPL v3, so the complete source code is public for review at https://github.com/J2matlock/pulse-app. We also provide a CycloneDX SBOM, this security brief and full third-party license documentation.

**Q: Is the application code signed?**
A: No. Pulse is free and open source, and the Windows build is not code-signed, so Windows SmartScreen asks for confirmation on first run (More info → Run anyway). Each release lists SHA-256 checksums, and your IT team can build Pulse from the public source code instead.

**Q: Does the application auto-update?**
A: No. Updates are never installed automatically. Users must manually check for updates and choose to install them.

---

## 8. Contact

For security questions, SBOM requests, or to schedule a security review:

- **Email:** support@baringasoft.com
- **Security Issues:** support@baringasoft.com (subject: SECURITY)

---

*This document is intended for IT security reviewers and procurement teams. It describes the security architecture of Pulse as of the version and date listed above.*
