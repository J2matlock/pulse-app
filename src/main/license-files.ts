import { join } from 'path'
import type { LicenseDoc } from '../shared/constants'

// Packaged names must match package.json build.extraResources "to". In
// development the files sit at the project root under their source names.
const PACKAGED_NAMES: Record<LicenseDoc, string> = {
  license: 'LICENSE.txt',
  'third-party': 'THIRD_PARTY_LICENSES.txt',
}
const SOURCE_NAMES: Record<LicenseDoc, string> = {
  license: 'LICENSE',
  'third-party': 'THIRD_PARTY_LICENSES.txt',
}

export function isLicenseDoc(v: unknown): v is LicenseDoc {
  return v === 'license' || v === 'third-party'
}

export function licenseFilePath(which: LicenseDoc, isPackaged: boolean, resourcesPath: string, appPath: string): string {
  return isPackaged ? join(resourcesPath, PACKAGED_NAMES[which]) : join(appPath, SOURCE_NAMES[which])
}
