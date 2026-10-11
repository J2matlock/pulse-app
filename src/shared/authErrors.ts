/**
 * authErrors.ts — error codes the unlock flow passes from the main process to
 * the lock screen, which turns them into plain words.
 */

/**
 * The saved sign-in data is protected by the computer's password vault (Windows
 * DPAPI, macOS Keychain, a Linux keyring), and that vault isn't available right
 * now: for example the Linux keyring isn't unlocked yet, or Pulse started at
 * sign-in before it was ready. Nothing is wrong with the password or the data,
 * so this never counts as a wrong password (AUDIT-021).
 */
export const KEYRING_UNAVAILABLE = 'KEYRING_UNAVAILABLE'
