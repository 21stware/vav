import type { MessageKey, TParams } from '@shared/i18n'
import { IS_MAC, keys } from './lib/platform'

type TFn = (key: MessageKey, params?: TParams) => string

/**
 * Shown by the 快捷键 sheet, which either window can raise.
 *
 * Written in macOS glyphs and respelled per platform by `keys`; the two entries
 * that describe platform behaviour rather than a key differ outright.
 */
export function getShortcuts(t: TFn): [string, string][] {
  return [
    [keys('⌘↵'), t('shortcut.send')],
    [keys('⌘K'), t('shortcut.focusComposer')],
    [keys('⌘I'), t('shortcut.focusComposerAlt')],
    [keys('⌘N'), t('shortcut.newSession')],
    [keys('⌘⇧↵'), t('shortcut.newSessionWindow')],
    [keys('⌘,'), t('shortcut.settings')],
    [['⌘F', '⌘G', '⌘⇧G'].map(keys).join(' / '), t('shortcut.searchNav')],
    [keys('⌘⇧H'), t('shortcut.sidebar')],
    [keys('⌘⇧E'), t('shortcut.tools')],
    [keys('⌘⇧T'), t('menu.togglePanelSegment')],
    [keys('⌘T'), t('menu.newTerminal')],
    [keys('⌘⇧O'), t('shortcut.switchWorkdir')],
    [keys('⌘1'), t('menu.focusWorkspace')],
    [['⌘2', '⌘3', '⌘4'].map(keys).join(' / '), t('shortcut.focusTerminalTabs')],
    ...(IS_MAC ? ([['Space', t('shortcut.quickLook')]] as [string, string][]) : []),
    [keys('⌘W'), IS_MAC ? t('shortcut.hideWindowMac') : t('shortcut.closeWindow')]
  ]
}
