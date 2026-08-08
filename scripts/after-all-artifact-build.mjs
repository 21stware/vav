/**
 * electron-builder notarizes + staples the .app *before* the DMG is built.
 * The outer DMG is left unsigned unless `dmg.sign: true`, and never stapled
 * unless we notarize it after packaging.
 *
 * Browser downloads attach com.apple.quarantine to the DMG. An unsigned /
 * unstapled DMG is a common path to the macOS dialog:
 *   “VAV is damaged and can’t be opened. You should move it to the Trash.”
 *
 * This hook runs after every artifact is written. With credentials present it
 * submits each .dmg to notarytool and staples the ticket onto the DMG itself.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

/** @param {{ artifactPaths?: string[] }} context */
export default async function afterAllArtifactBuild(context) {
  if (process.platform !== 'darwin') return

  const dmgs = (context.artifactPaths ?? []).filter((p) => p.endsWith('.dmg'))
  if (dmgs.length === 0) return

  const appleApiKey = process.env.APPLE_API_KEY
  const appleApiKeyId = process.env.APPLE_API_KEY_ID
  const appleApiIssuer = process.env.APPLE_API_ISSUER

  if (!appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    console.warn(
      '[vav] skip DMG notarization: set APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER'
    )
    return
  }

  const { notarize } = await import('@electron/notarize')

  for (const dmgPath of dmgs) {
    const name = path.basename(dmgPath)
    console.log(`[vav] notarizing DMG ${name}…`)

    // Requires dmg.sign: true so the disk image is already Developer ID signed.
    await notarize({
      appPath: dmgPath,
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer
    })

    execFileSync('xcrun', ['stapler', 'validate', dmgPath], { stdio: 'inherit' })
    console.log(`[vav] DMG notarized + stapled: ${name}`)
  }
}
