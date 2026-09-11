/** POSIX-safe single quotes for a path used in a `/bin/sh` helper. */
export function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Packaged macOS `vav` shim. Never `open -n`: a second Chromium fights the
 * running instance for `userData` / SingletonLock and can tear the primary down.
 *
 * No args → activate (or cold-start) the bundle.
 * A path → `open -a App <folder>` so a running instance gets `open-file`
 * (Launch Services drops `--args` without `-n`).
 */
export function packagedMacCliLauncher(bundle: string, helpText: string): string {
  return [
    '#!/bin/sh',
    'set -e',
    `APP=${JSON.stringify(bundle)}`,
    'case "$1" in',
    '  -h|--help)',
    '    cat <<\'EOF\'',
    helpText + 'EOF',
    '    exit 0',
    '    ;;',
    'esac',
    'if [ "$#" -eq 0 ]; then',
    '  open -a "$APP"',
    '  exit 0',
    'fi',
    'TARGET="$1"',
    'case "$TARGET" in',
    '  .) TARGET="$(pwd -P)" ;;',
    '  /*) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
    '  *) TARGET="$(cd "$TARGET" 2>/dev/null && pwd -P || echo "$TARGET")" ;;',
    'esac',
    'open -a "$APP" "$TARGET"',
    ''
  ].join('\n')
}

/** Packaged Finder-service helper: open the folder in the running app. */
export function packagedMacOpenDirectoryHelper(bundle: string): string {
  return [
    '#!/bin/sh',
    'set -e',
    'f="$1"',
    '[ -n "$f" ] || exit 0',
    '[ -d "$f" ] || exit 0',
    `exec /usr/bin/open -a ${shSingleQuote(bundle)} "$f"`,
    ''
  ].join('\n')
}
