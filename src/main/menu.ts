import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'
import { APP_NAME } from './brand'

const IS_MAC = process.platform === 'darwin'

/**
 * Native menu carrying the product shortcuts from README §7.
 *
 * Everything here just forwards a command to the renderer, which owns the
 * actual behaviour; the menu exists so the accelerators work even when focus
 * sits inside the terminal (where xterm would otherwise swallow keys).
 *
 * macOS puts the app's own submenu first and expects 设置 / 退出 to live there.
 * Windows has no such menu, so those two move into 文件 and the whole
 * macOS-only block (services, hide others, 前置全部窗口) drops out.
 */
export function buildAppMenu(
  dispatch: (command: MenuCommand) => void,
  openSettings: () => void,
  newDetachedSession: () => void
): Menu {
  const send = (command: MenuCommand) => () => dispatch(command)
  const settingsItem: MenuItemConstructorOptions = {
    // Settings own a window, so this bypasses the renderer round trip and
    // works no matter which window has focus.
    label: '设置…',
    accelerator: 'CmdOrCtrl+,',
    click: openSettings
  }

  const appMenu: MenuItemConstructorOptions[] = IS_MAC
    ? [
        {
          label: APP_NAME,
          submenu: [
            { role: 'about', label: `关于 ${APP_NAME}` },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: `隐藏 ${APP_NAME}` },
            { role: 'hideOthers', label: '隐藏其他' },
            { role: 'unhide', label: '全部显示' },
            { type: 'separator' },
            { role: 'quit', label: `退出 ${APP_NAME}` }
          ]
        }
      ]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: '文件',
      submenu: [
        { label: '新会话', accelerator: 'CmdOrCtrl+N', click: send('new-conversation') },
        // Handled in main, not the renderer: the point of ⌘⇧↵ is that it works
        // from any window, including one that has no sidebar to create from.
        {
          label: '在新窗口中新建会话',
          accelerator: 'CmdOrCtrl+Shift+Return',
          click: newDetachedSession
        },
        { label: '新终端标签', accelerator: 'CmdOrCtrl+T', click: send('new-terminal') },
        {
          label: '切换工作目录…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: send('switch-workdir')
        },
        { type: 'separator' },
        ...(IS_MAC ? [] : [settingsItem, { type: 'separator' } as MenuItemConstructorOptions]),
        // On macOS this hides the window; the process stays alive for
        // background turns. Elsewhere it closes for real.
        { role: 'close', label: '关闭窗口' },
        ...(IS_MAC
          ? []
          : [{ role: 'quit', label: `退出 ${APP_NAME}` } as MenuItemConstructorOptions])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '拷贝' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: '查找下一个', accelerator: 'CmdOrCtrl+G', click: send('find-next') },
        { label: '查找上一个', accelerator: 'CmdOrCtrl+Shift+G', click: send('find-previous') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '显示/隐藏侧栏', accelerator: 'CmdOrCtrl+Shift+H', click: send('toggle-sidebar') },
        {
          label: '显示/隐藏工具台',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: send('toggle-tools-panel')
        },
        {
          label: '切换 Files / Terminal',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: send('toggle-panel-segment')
        },
        { type: 'separator' },
        { label: '聚焦输入框', accelerator: 'CmdOrCtrl+K', click: send('focus-composer') },
        { label: '发送', accelerator: 'CmdOrCtrl+Return', click: send('send') },
        { type: 'separator' },
        { role: 'reload', label: '重新载入' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(IS_MAC
          ? ([
              { type: 'separator' },
              { role: 'front', label: '前置全部窗口' }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
