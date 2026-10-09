# Pulse — Recommended Setup Checklist

*A worker can follow this, then show it to their supervisor or IT.*

**On the computer (agency or IT)**
- [ ] The computer requires a login and locks its screen when idle.
- [ ] Full-disk encryption is on (BitLocker on Windows, FileVault on Mac).
- [ ] The Pulse data folder is **not** inside OneDrive, Dropbox, or Google Drive. Pulse warns if it is.

**In Pulse**
- [ ] **Password:** not used anywhere else. Pulse requires 12+ characters; a short sentence works well.
- [ ] **Recovery key created and stored safely** (printed and locked away, or in the agency's password manager). Settings → Security.
- [ ] **Auto-lock: 5 or 15 minutes.** Settings → Security. (Pulse also locks when the computer sleeps.)
- [ ] **Scheduled backups on, to an agency-approved location** (network share or encrypted USB), not the same disk. Settings → Backup.
- [ ] **Check a backup once:** Settings → Backup → "Restore from file…", then pick the backup. Pulse checks that it opens and asks before changing anything; choose **Cancel**. You'll know your backups work before you need them.
- [ ] **Exports:** save PDFs and CSVs only to approved folders, and delete them when done. They're not encrypted.

**When a worker leaves or a computer is retired**
- [ ] Settings → Data → "Reset everything" (Danger zone), plus delete any backups saved elsewhere.
- [ ] Wipe or re-image the computer per agency policy.
