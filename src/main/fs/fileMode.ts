/** POSIX mode bits as `rwxr-xr-x (755)` for inspect metadata. */
export function modeToPermissions(mode: number): string {
  const perms = mode & 0o777
  const rwx = (n: number): string =>
    `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
  const owner = rwx((perms >> 6) & 7)
  const group = rwx((perms >> 3) & 7)
  const other = rwx(perms & 7)
  const octal = perms.toString(8).padStart(3, '0')
  return `-${owner}${group}${other} (${octal})`
}
