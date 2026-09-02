/** CFBundleVersion stand-in: YYYY.MMDD.patch from package version + calendar day. */
export function appBuildNumber(version: string, now = new Date()): string {
  const y = now.getFullYear()
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const patch = version.split('.').pop() ?? '0'
  return `${y}.${md}.${patch}`
}
