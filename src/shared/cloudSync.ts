/** Cloud-sync folders corrupt live SQLite databases (and copy client data off the computer). */
const CLOUD_SYNC_FOLDERS = ['OneDrive', 'Dropbox', 'Google Drive', 'iCloud', 'Box Sync', 'pCloud']

/** The cloud service whose folder contains `path`, or null. */
export function detectCloudSyncService(path: string): string | null {
  return CLOUD_SYNC_FOLDERS.find(name => path.includes(name)) ?? null
}
