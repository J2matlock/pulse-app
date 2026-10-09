# W11. Reminders: notifications, tray mode, start with computer

Size: S–M (4 days). Phase: P2 (notifications while running) and P5 (tray mode, start with computer).

## 1. User stories
1. *As anyone*, at 8:30 each morning Pulse tells me "3 due today, 2 appointments" if it's open.
2. *As a therapist*, I get a reminder 10 minutes before each appointment.
3. *As someone who closes apps*, Pulse can stay in the tray (locked) so reminders still come, without exposing names.
4. *As a privacy-minded user*, reminders never show names unless I turn that on.

## 2. Notifications (P2)
- **Electron `Notification`** from main.
- **Settings → Deadlines → Reminders:**
  - Daily summary at [time], off by default.
  - Before appointments: [off, 5, 10, 15, 30, 60 min], once W07 exists.
  - Show names in reminders: off by default, with the warning "Names can appear on your lock screen and in notification history".
- **Content:**
  - daily: "Pulse: 3 due today, 1 overdue, 2 appointments";
  - appointment: "Appointment at 3:00 pm" (+ "with J.S." only when names are on; initials for person lists, display name for things).
- **Scheduling** (main, `src/main/reminders.ts`):
  - a 1-minute tick while unlocked;
  - the computation uses `loadDeadlines` (W05) and appointments (W07) for today;
  - deduplicated per day/appointment by an in-memory set plus settings `reminders_last_daily` (date).
- **Click** focuses the window: the dashboard for daily, the calendar day for appointments.
- **While locked** (normal mode): no notifications, because the database is closed. Tray mode (§3) changes this using cached counts only.
- **OS permission:** Windows and macOS may need the app to be allowed in notification settings; the settings screen links to instructions if a test notification fails.

## 3. Tray mode (P5)
- **Setting:** "Keep {{ProductName}} running in the background" (off by default).
- **When on:**
  - Closing the window **locks** (DB closed, key zeroed via `lockApp()`, on-close backup runs) and hides to the tray, instead of quitting.
  - E2's "closing quits" applies only when tray mode is off.
  - **Tray menu:** Open (shows the lock screen), Lock now, Quit.
  - **Badge/tooltip:** counts only, computed at lock time and cached in memory ("3 due today"). No names, since the DB is closed.
  - **Reminders while locked:**
    - the daily summary uses the cached counts;
    - appointment reminders use a cached list of today's appointment *times only*, held in memory and never on disk (e.g. "Appointment at 3:00 pm").
- **Security:** nothing new is written to disk. The cache is in main-process memory and dropped on quit. Document this in the security summary. Must stay compatible with the quick-unlock design (E1): tray mode is the natural home for "unlock with Touch ID" later.

## 4. Start with the computer (P5)
- "Open {{ProductName}} when I sign in" via `app.setLoginItemSettings({ openAtLogin, openAsHidden: trayMode })`.
- Off by default.
- On Windows portable builds `openAtLogin` points at the exe's current path; the setting warns if the exe is on removable media.

## 5. Tests
- Schedule computation (pure): daily-time crossing, dedupe, appointment lead times across midnight.
- Content builder: names off/on, kinds.
- Tray mode: close → `lockApp` called, key zeroed, window hidden; quit from tray runs backup; cached counts exclude names.
- Login item toggles.

## 6. Commits
1. P2: reminders module + settings + daily summary.
2. P4/P5: appointment reminders (after W07).
3. P5: tray mode + cached counts + security doc update.
4. P5: start with computer.
