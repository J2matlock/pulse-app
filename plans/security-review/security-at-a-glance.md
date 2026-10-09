# Pulse — Security at a Glance

*For supervisors and IT staff deciding whether a team member may use Pulse with client information.*

**Pulse is a caseload tracker that runs entirely on one computer. BaringaSoft never sees, stores, or receives your clients' information.**

### Where the data lives
- On the worker's computer only: one encrypted file, plus encrypted backups in folders the worker chooses.
- There are no accounts, no cloud, no syncing, and no telemetry.

### How it's protected
- **Encrypted at rest:** the entire database uses AES-256 (SQLCipher 4). A stolen laptop or a copied file shows nothing without the password.
- **Password-protected:** at least 12 characters, and common passwords are refused. The password unlocks an encryption key; the key itself is never stored in readable form. After repeated wrong passwords, unlocking is paused, and the worker is told about wrong attempts at their next unlock.
- **Locks itself:** after inactivity (30 minutes by default, never longer than 2 hours) and immediately when the computer sleeps or the screen locks. The clipboard is cleared on lock.
- **Recovery key:** a printable key lets the worker regain access if they forget the password. Without the password or recovery key, nobody can open the data, including BaringaSoft.
- **Backups are encrypted, too**, and can be restored on a replacement computer with the password or recovery key.
- **Files on records** (scans, photos, PDFs) are stored inside the encrypted database and backed up with it. Only documents and pictures are accepted, checked by content. A file opened for viewing is copied to a private folder that is emptied when Pulse locks or closes.
- **Background mode** (off by default): closing the window locks Pulse and leaves a tray icon so reminders still arrive. While locked, only counts and appointment times held in memory are used; names are never read, and nothing about it is written to disk.
- **Tamper-evident:** the encrypted data is authenticated; changes made outside Pulse are detected.

### What it connects to
Only two things, both over HTTPS, and neither sends client data:
1. **Update check:** once each time Pulse is unlocked, it reads a version number from our public release page. Nothing is sent. It can be turned off in Settings → About.
2. **License activation:** sends the license key and an anonymous computer ID, once.

### Records integrity
- Changes to client information keep their earlier values (the last 50 changes per field).
- Case notes keep every earlier version when edited. After 15 minutes a note can't be deleted, only voided (kept in the record, hidden).
- An activity timeline records completions, archive and restore, and other events per client.

### What stays the agency's responsibility
- Your HIPAA program and risk analysis (this page and our safeguards map can feed into it).
- The computer itself: OS login, full-disk encryption (BitLocker or FileVault), screen lock, physical security.
- Where backups and any exported PDFs or CSVs, or saved copies of attached files, are kept. These are ordinary files and are not encrypted.
- Shared setup files (Settings → Workspace → "Share your setup") hold structure only: lists, columns, rules, checklists, note types, words and letter templates. No records or notes.

### Business associate agreement
Because BaringaSoft has no access to the data Pulse stores, we are not a business associate under HHS guidance on software vendors, so a BAA is generally not required. *(Have your compliance office confirm for your situation.)*

### More detail
- Safeguard-by-safeguard map: *HIPAA Safeguards Map*
- Technical design: *Security & Architecture Brief*
- Questions: support@baringasoft.com
