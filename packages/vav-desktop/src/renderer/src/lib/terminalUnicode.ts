import type { IUnicodeHandling, IUnicodeVersionProvider, Terminal } from '@xterm/xterm'

const ZWJ_VERSION = 'vav-11-zwj'
const UNICODE11_VERSION = '11'
const ZERO_WIDTH_JOINER = 0x200d

type XtermUnicodeCore = Terminal & {
  unicode: IUnicodeHandling
  _core?: {
    unicodeService?: {
      _providers?: Record<string, IUnicodeVersionProvider>
    }
  }
}

function extractWidth(properties: number): 0 | 1 | 2 {
  return ((properties >> 1) & 3) as 0 | 1 | 2
}

function extractCharKind(properties: number): number {
  return properties >> 3
}

export function zwjCharProperties(
  codepoint: number,
  preceding: number,
  wcwidth: (cp: number) => 0 | 1 | 2,
  fallback: (cp: number, prev: number) => number
): number {
  const precedingWidth = extractWidth(preceding)
  const precedingKind = extractCharKind(preceding)
  if (codepoint === ZERO_WIDTH_JOINER && precedingWidth > 0) {
    return ((ZERO_WIDTH_JOINER & 0xffffff) << 3) | ((precedingWidth & 3) << 1) | 1
  }
  if (precedingKind === ZERO_WIDTH_JOINER && precedingWidth > 0 && wcwidth(codepoint) > 0) {
    // CLIs budget a ZWJ emoji as one wide glyph. Default Unicode11 advances
    // for each emoji part, which tears OpenCode / Grok tables.
    return ((codepoint & 0xffffff) << 3) | ((precedingWidth & 3) << 1) | 1
  }
  return fallback(codepoint, preceding)
}

class ZwjUnicodeProvider implements IUnicodeVersionProvider {
  readonly version = ZWJ_VERSION
  private readonly base: IUnicodeVersionProvider

  constructor(base: IUnicodeVersionProvider) {
    this.base = base
  }

  wcwidth(codepoint: number): 0 | 1 | 2 {
    return this.base.wcwidth(codepoint)
  }

  charProperties(codepoint: number, preceding: number): number {
    return zwjCharProperties(
      codepoint,
      preceding,
      (cp) => this.base.wcwidth(cp),
      (cp, prev) => this.base.charProperties(cp, prev)
    )
  }
}

/**
 * Unicode 11 widths plus ZWJ joining so emoji in TUI tables occupy one cell pair.
 */
export function activateTerminalUnicode(term: Terminal): void {
  const unicode = term.unicode
  if (!unicode) return
  if (unicode.versions.includes(UNICODE11_VERSION)) {
    unicode.activeVersion = UNICODE11_VERSION
  }
  wrapActiveUnicodeWithZwj(term as XtermUnicodeCore)
}

function wrapActiveUnicodeWithZwj(term: XtermUnicodeCore): void {
  const unicode = term.unicode
  if (unicode.activeVersion === ZWJ_VERSION) return
  const base =
    term._core?.unicodeService?._providers?.[unicode.activeVersion] ??
    term._core?.unicodeService?._providers?.[UNICODE11_VERSION]
  if (!base) return
  if (!unicode.versions.includes(ZWJ_VERSION)) {
    unicode.register(new ZwjUnicodeProvider(base))
  }
  unicode.activeVersion = ZWJ_VERSION
}
