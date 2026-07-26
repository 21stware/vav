import { IS_MAC, keys } from './lib/platform'

/**
 * Shown by the 快捷键 sheet, which either window can raise.
 *
 * Written in macOS glyphs and respelled per platform by `keys`; the two entries
 * that describe platform behaviour rather than a key differ outright.
 */
export const SHORTCUTS: [string, string][] = [
  [keys('⌘↵'), '发送'],
  [keys('⌘⇧↵'), '在新窗口中新建会话'],
  [keys('⌘K'), '聚焦输入框'],
  [keys('⌘N'), '新会话'],
  [keys('⌘,'), '设置'],
  [['⌘F', '⌘G', '⌘⇧G'].map(keys).join(' / '), '会话内查找 / 下一个 / 上一个'],
  [keys('⌘⇧H'), '显示或隐藏侧栏'],
  [keys('⌘⇧E'), '显示或隐藏工具台'],
  [keys('⌘⇧T'), '切换 Files / Terminal'],
  [keys('⌘T'), '新终端标签'],
  [keys('⌘⇧O'), '切换工作目录'],
  ...(IS_MAC ? ([['Space', 'Quick Look 选中文件']] as [string, string][]) : []),
  [keys('⌘W'), IS_MAC ? '隐藏窗口（进程与 PTY 保持）' : '关闭窗口']
]
