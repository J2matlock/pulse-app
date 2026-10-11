// Chromium's spellchecker on Windows and Linux uses Hunspell dictionaries that
// it downloads from Google's CDN the first time a text field is focused. Pulse
// promises that the update check is its only network request, so the
// spellchecker is turned off there. macOS uses the OS spellchecker and never
// downloads anything, so it stays on.

type SpellcheckSession = {
  setSpellCheckerEnabled(enable: boolean): void
}

export function spellcheckAllowed(platform: NodeJS.Platform): boolean {
  return platform === 'darwin'
}

/** Apply the platform's spellchecker setting to a session. Call before any window opens. */
export function configureSpellchecker(ses: SpellcheckSession, platform: NodeJS.Platform): void {
  ses.setSpellCheckerEnabled(spellcheckAllowed(platform))
}
