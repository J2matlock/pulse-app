# Pulse — Questions from Supervisors and IT

**Does BaringaSoft see our clients' information?**
No. Pulse stores everything in an encrypted file on the worker's computer. Nothing is uploaded, synced, or sent to us. We have no server that holds customer data.

**Does Pulse connect to the internet?**
Only for an update check once each time it's unlocked (it reads the latest version number; nothing is sent; this can be turned off in Settings → About) and a one-time license activation (it sends the license key and an anonymous computer ID). No client data is involved in either. The app is built to block any other connection.

**Do we need a business associate agreement (BAA)?**
Generally no. HHS guidance says a software vendor that doesn't create, receive, maintain, or transmit protected health information is not a business associate, and BaringaSoft never has access to the data in Pulse. Your compliance office makes the final call; we're happy to answer their questions.

**What happens if the laptop is lost or stolen?**
The Pulse data is encrypted with AES-256 and can't be read without the worker's password or recovery key. Pulse locks itself after inactivity and as soon as the computer sleeps or the screen locks. We still recommend full-disk encryption (BitLocker or FileVault) and an OS login on the computer.

**What if the worker forgets their password?**
They unlock with the recovery key they saved during setup. Without the password or recovery key, the data can't be recovered by anyone, including us. That's the point of the encryption.

**What if the computer dies?**
Pulse makes encrypted backups. A `.pulse-backup` file can be restored on a new computer with the old password or recovery key. We recommend scheduled backups to an agency-approved drive.

**Can we see who changed what?**
Each client has an activity timeline and a change history for each field. Edited case notes keep every earlier version, and once a note is more than 15 minutes old it can only be voided (kept, hidden), not deleted. Pulse is single-user, so every change was made by the license holder.

**Is the data in exported reports protected?**
No. CSV and PDF exports are ordinary files once saved. Treat them like any other document containing client information, and save them only to approved locations.

**Where are attached files kept?**
Files added to a record (scanned forms, photos, PDFs) are stored inside the encrypted database, so they're protected and backed up like everything else. Only document and picture types are accepted; programs, scripts, archives and web pages are refused by checking the file's contents, not its name. When the worker opens a file to view it, Pulse puts a temporary unencrypted copy in a private folder inside its data folder so the computer's viewer can show it; that folder is emptied when Pulse locks or closes. "Save a copy" creates an ordinary file, like an export.

If "Keep running in the background" is turned on, closing the window locks Pulse (database closed, key wiped) and hides it in the system tray instead of quitting, so reminders can still appear. In that state Pulse holds only today's counts and appointment times in memory, so reminders say "3 due today" or "Appointment at 3:00 pm" and never a name. Nothing is written to disk for this; the memory is cleared when Pulse quits. "Open when I sign in" starts Pulse hidden in the tray, locked.

**What's in a shared setup file?**
Settings → Workspace → "Share your setup" saves a `.pulse` template file so a coworker can start with the same lists. It holds structure only: list and column names, deadline rules, checklists, note types, the names of custom numbers, requirements, words and feature switches, note formats and the worker's own letter templates. It never contains records, notes, numbers entered on notes, files, the worker's name or contact details, or license information. The file isn't encrypted, because it holds no client information; review the letter templates before sharing if your agency's templates contain anything sensitive.

**Can several staff share one copy?**
No. Each license is for one person. Shared access isn't supported, by design.

**How do we remove it?**
Settings → Data → "Reset everything" (in the Danger zone) permanently deletes the database, the credentials, and the automatic backups on that computer. Backups saved elsewhere are kept; delete those separately if needed.

**How are security issues handled?**
Report them to support@baringasoft.com. Updates are announced in the app; nothing installs or restarts on its own.
