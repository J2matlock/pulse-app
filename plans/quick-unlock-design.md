# Quick unlock with Touch ID / Windows Hello (brainstorm E1): design

Status: **design only.** Nothing is implemented. This touches how the database key is handled, so it should be built deliberately and tested on real Macs and Windows PCs. It can't be tested on the Linux machine this was written on.

## Goal
After Pulse auto-locks (say, 15 minutes idle), let the user get back in with a fingerprint, face or Windows Hello PIN instead of typing the full password. Later, optionally use the same prompt as a **second factor** for the first unlock of the day (HIPAA's proposed MFA requirement).

## How unlocking works today
- The database is encrypted with a random 256-bit key.
- That key is stored only *wrapped*: by the password (PBKDF2), by the recovery key, and on top of that by the OS keystore (`safeStorage`: Keychain on macOS, DPAPI on Windows).
- On lock, `lockApp()` zeroes the key in memory (`liveDbKey`) and closes the database. Nothing that can open the database stays in memory.

Quick unlock must not quietly undo that last point.

## Options considered

| | A. Session-only quick unlock (recommended first) | B. Hardware-bound key (later, if needed) |
|-|-|-|
| What's stored | Nothing new on disk. While Pulse stays open, the key is kept in memory, sealed with `safeStorage`, instead of being zeroed. | A copy of the database key wrapped by a key that only the Secure Enclave / TPM releases after a biometric check. |
| Survives quitting Pulse or a restart | No: password required | Yes |
| How the prompt works | macOS: `systemPreferences.promptTouchID()`. Windows: `UserConsentVerifier` (Windows Hello). Both are built into Electron or the OS; a tiny native helper is needed on Windows. | macOS: Keychain item with `kSecAccessControlBiometryCurrentSet`. Windows: `KeyCredentialManager` (a Hello-bound key pair; sign a fixed challenge and derive the wrapping key from the signature). Both need a native module. |
| Protects against | Someone at an unlocked-then-auto-locked computer | The same, plus a stolen disk image while Pulse isn't running |
| Doesn't protect against | Malware already running as the user (it could read Pulse's memory either way) | Malware running as the user that waits for the user to approve a prompt |
| Effort and risk | Small. No new secret on disk, no native crypto. | Large. Native modules on two platforms, code signing, Secure Enclave/TPM edge cases (fingerprint added, Hello reset). |

**Recommendation: build A first.** It covers the real use case (auto-lock several times a day) without writing any new secret to disk, which keeps the IT-security story simple: "biometric unlock only resumes a session you already opened with your password."

## Design of option A
1. **Setting** (Settings → Security): "Unlock with Touch ID / Windows Hello after Pulse locks itself". Off by default. Shown only when the OS says biometrics or Hello are set up (`systemPreferences.canPromptTouchID()` on macOS; `UserConsentVerifier.checkAvailabilityAsync()` on Windows).
2. **On auto-lock or Ctrl+L, with the setting on:**
   - Close the database exactly as today.
   - Instead of zeroing `liveDbKey`, seal it: `sealed = safeStorage.encryptString(key)`. Zero the plain copy. Keep `sealed` only in a main-process variable. It's never written to disk, never sent to the renderer, and never logged.
   - Record `sealedAt` and how the lock happened.
3. **Lock screen** shows "Unlock with Touch ID" (or "Windows Hello") as the first choice, with the password field still there.
4. **On a quick-unlock request** (a new IPC channel, renderer → main, no arguments):
   - Show the OS prompt with a reason: "unlock Pulse".
   - If it succeeds: unseal, reopen the database, zero the plain copy as usual, and keep the sealed copy for the next lock.
   - On failure or cancel: nothing changes; the password still works.
5. **The sealed key is discarded (password required) when:**
   - Pulse quits, the computer restarts, or the user logs out.
   - The computer sleeps or the screen locks (`powerMonitor` `suspend` / `lock-screen`). This is optional and on by default; it's the conservative choice for shared offices.
   - More than **12 hours** have passed since the last password unlock (a setting). This keeps "type your password at least once a day."
   - The password is changed, the recovery key is used, a backup is restored, or the user locks with **Lock and require password** (a second lock menu item).
   - 3 failed biometric attempts in a row.
6. **Audit**: each quick unlock is logged locally ("Unlocked with Touch ID"), with no secrets, like password unlocks.
7. **Free version and licensing**: unaffected.

## Second factor (later, separate decision)
The same OS prompt could be *required* after the password for the first unlock each day. That makes it real MFA (something you know + something you are/have) and fits the HIPAA proposal. It needs a recovery path when the fingerprint reader or Hello breaks (the recovery key works) and a way for agencies to turn it on. Wait for the final HIPAA rule before building it.

## Tests to write when implementing
- Unit (main): the seal/unseal state machine, mocking `safeStorage` and the prompt. Covers every discard trigger, timeouts, the failed-attempt counter, and that `liveDbKey` is zeroed after sealing and after unlock.
- Unit: the IPC handler refuses when the setting is off, nothing is sealed, or the app is already unlocked.
- Manual on a Mac with Touch ID, a Mac without it, a Windows PC with Hello (fingerprint and PIN), and one without it: enable, lock, quick unlock, sleep, restart, change password, restore a backup.

## What to tell IT (for the security summary)
"Optional quick unlock with Touch ID or Windows Hello resumes a session the user already opened with their password. It works only while Pulse is running, and never after a restart, a sleep, or 12 hours. No biometric data is seen or stored by Pulse; the operating system handles the check. No new copy of the key is written to disk."
