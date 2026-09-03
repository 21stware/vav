/** Fallback Uniform Type Identifier when mdls is unavailable. */
export function mimeHintToUti(ext: string): string {
  switch (ext) {
    case '.dmg':
      return 'com.apple.disk-image-udif'
    case '.pkg':
      return 'com.apple.installer-package-archive'
    case '.app':
      return 'com.apple.application-bundle'
    case '.zip':
      return 'com.pkware.zip-archive'
    case '.apk':
      return 'com.android.package-archive'
    default:
      return 'public.data'
  }
}
