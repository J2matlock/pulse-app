#!/usr/bin/env node
/**
 * sign-exe.js — Sign Windows executables using jsign + Azure Trusted Signing.
 *
 * Prerequisites:
 *   1. Java 11+ installed (java on PATH)
 *   2. jsign 7.1+ JAR at ./scripts/jsign.jar (or JSIGN_JAR env var)
 *   3. Azure CLI installed and authenticated (az login)
 *   4. Azure Trusted Signing account configured
 *
 * Usage:
 *   node scripts/sign-exe.js <path-to-exe>
 *   node scripts/sign-exe.js          # auto-finds exe in dist/
 *
 * Environment variables (optional overrides):
 *   JSIGN_JAR              — path to jsign JAR (default: scripts/jsign.jar)
 *   AZURE_SIGNING_URI      — Azure Trusted Signing account URI
 *   AZURE_CERT_PROFILE     — certificate profile name
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')

// --- Config ---
// jsign TRUSTEDSIGNING expects just the hostname for --keystore
const AZURE_SIGNING_ENDPOINT = process.env.AZURE_SIGNING_ENDPOINT || 'eus.codesigning.azure.net'
// --alias format: <account-name>/<certificate-profile>
const AZURE_SIGNING_ACCOUNT = process.env.AZURE_SIGNING_ACCOUNT || 'baringasoft-signing'
const AZURE_CERT_PROFILE = process.env.AZURE_CERT_PROFILE || 'BaringaSoftPulse'
const JSIGN_JAR = process.env.JSIGN_JAR || path.join(__dirname, 'jsign.jar')

function findExe(exePath) {
  if (exePath && fs.existsSync(exePath)) return exePath

  // Auto-find in dist/
  if (fs.existsSync(DIST)) {
    const exes = fs.readdirSync(DIST).filter(f => f.endsWith('.exe'))
    if (exes.length === 1) return path.join(DIST, exes[0])
    if (exes.length > 1) {
      // Pick the one matching current package.json version
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
      const versionMatch = exes.find(f => f.includes(pkg.version))
      if (versionMatch) {
        console.log(`[sign] Multiple .exe files found, selecting version match: ${versionMatch}`)
        return path.join(DIST, versionMatch)
      }
      console.error('[sign] Multiple .exe files found in dist/. Specify which one:')
      exes.forEach(e => console.error(`  ${e}`))
      process.exit(1)
    }
  }

  console.error('[sign] No .exe file found. Pass the path as an argument or build first.')
  process.exit(1)
}

function checkPrereqs() {
  // Check Java
  try {
    execSync('java -version', { stdio: 'pipe' })
  } catch {
    console.error('[sign] Java not found. Install JDK 11+ and ensure java is on PATH.')
    process.exit(1)
  }

  // Check jsign JAR
  if (!fs.existsSync(JSIGN_JAR)) {
    console.error(`[sign] jsign JAR not found at: ${JSIGN_JAR}`)
    console.error('[sign] Download it:')
    console.error('  curl -sL https://github.com/ebourg/jsign/releases/download/7.1/jsign-7.1.jar -o scripts/jsign.jar')
    process.exit(1)
  }

  // Check Azure CLI
  try {
    execSync('az account show', { stdio: 'pipe' })
  } catch {
    console.error('[sign] Azure CLI not authenticated. Run: az login')
    process.exit(1)
  }

  // Get Azure access token for Azure Trusted Signing
  try {
    const token = execSync(
      'az account get-access-token --resource https://codesigning.azure.net --query accessToken -o tsv',
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    return token
  } catch (e) {
    console.error('[sign] Failed to get Azure access token for code signing.')
    console.error('[sign] Make sure your account has access to the Trusted Signing resource.')
    console.error(e.stderr?.toString() || e.message)
    process.exit(1)
  }
}

function signExe(exePath, token) {
  const alias = `${AZURE_SIGNING_ACCOUNT}/${AZURE_CERT_PROFILE}`
  console.log(`[sign] Signing: ${path.basename(exePath)}`)
  console.log(`[sign] Endpoint: ${AZURE_SIGNING_ENDPOINT}`)
  console.log(`[sign] Alias: ${alias}`)

  const args = [
    '-jar', JSIGN_JAR,
    '--storetype', 'TRUSTEDSIGNING',
    '--keystore', AZURE_SIGNING_ENDPOINT,
    '--alias', alias,
    '--storepass', token,
    '--tsaurl', 'http://timestamp.acs.microsoft.com',
    '--tsmode', 'RFC3161',
    exePath,
  ]

  try {
    execSync(`java ${args.map(a => `"${a}"`).join(' ')}`, {
      stdio: 'inherit',
      cwd: ROOT,
    })
    console.log('[sign] Signing successful!')
  } catch (e) {
    console.error('[sign] Signing failed!')
    process.exit(1)
  }
}

// --- Main ---
const exeArg = process.argv[2]
const exePath = findExe(exeArg)
console.log(`\n=== Code Signing with Azure Trusted Signing ===`)
const token = checkPrereqs()
signExe(exePath, token)
