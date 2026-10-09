---
name: backup-integrity
description: End-to-end audit of Pulse's backup/restore system (auto-on-close, scheduled .pulse-backup, manual, pre-migration, restore rollback) including the "my laptop died" disaster-recovery path.
disable-model-invocation: true
---

# Backup Integrity — Pulse

Users have no server and no other copy of their caseload. Backups are the only safety net, so audit them as if data loss means a missed court date.

Code: `src/main/backup.ts`, backup and restore handlers in `src/main/ipc/ipc-export.ts`, the quit flow in `src/main/index.ts`, and the UI in `src/renderer/components/settings/BackupSection.tsx`. Tests: `tests/backup.test.ts`.

## Layers to trace
| Layer | Trigger | Location / retention |
|-|-|-|
| Auto | `before-quit` → `runAutoBackup()` | `<data>/backups/pulse-auto-*.db`, newest 5 + 1/day ×7 + 1/week ×4 (`selectAutoBackupsToKeep`) |
| Scheduled | 15-minute timer → `checkAndRunScheduled()` | user folder, `pulse-scheduled-*.pulse-backup`, rolling 10 |
| Manual | Settings → Backup | user path, `.pulse-backup` (zip + sha256 meta) |
| Pre-migration | `runMigrations()` | `pulse-pre-migration-v*-to-v*`, rolling 5 |
| Pre-restore | every restore | `pulse-pre-restore-*.db` |

## Questions that matter most
1. **Disaster recovery.** `.pulse-backup` files carry a `key-envelope.json` (DB key wrapped by password + recovery key, not OS-bound); `restoreBackupOnNewInstall` + `AUTH_RESTORE_FROM_BACKUP` restore them on a fresh install. Verify the round trip still works (`tests/backup-new-install.test.ts`) and note that raw `.db` auto-backups have no envelope — they only restore on the same install.
2. **Retention.** Tiered auto-backup retention — confirm a burst of quits can't rotate out older days, and check total disk use for large DBs.
3. **Same-disk risk.** The default scheduled destination is next to the DB. Does the UI push users toward USB or another drive?
4. **Restore safety.** Is the backup verified to decrypt with the current key *before* the live DB is overwritten? Is the rollback path tested? Is newer-schema downgrade blocked? Does the renderer reload stale store data?
5. **WAL.** Is there a checkpoint before copy, `-wal`/`-shm` removal before restore, and the EXCLUSIVE lock release trick in `createAtomicDbSnapshot`?
6. **Quit path.** What happens when backup exceeds its 12-second timeout? What happens when the app is locked, so the DB is closed, at quit time?

## Failure table (fill in)
| Scenario | What the user sees | Recoverable? |
|-|-|-|
| Power loss mid-backup | | |
| Disk full | | |
| USB pulled mid-write | | |
| Restore of a non-Pulse / corrupt file | | |
| Restore of a backup from a different install (different key) | | |
| Restore on a new computer | | |
| `pulse-secure.json` corrupt or deleted | | |

## Output
Findings with severity, scenario, data at risk, `file:line`, and a fix. Then:
- a grade for backup and a grade for restore;
- data-loss scenarios ranked by likelihood;
- the single most important fix.

To prove the round trip, run `npm test -- tests/backup.test.ts`.
