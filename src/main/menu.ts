import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'
import { APP_NAME } from './brand'
import { t } from './i18n'

const IS_MAC = process.platform === 'darwin'

/**
 * Native menu carrying the product shortcuts from README §7.
 *
 * Everything here just forwards a command to the renderer, which owns the
 * actual behaviour; the menu exists so the accelerators work even when focus
 * sits inside the terminal (where xterm would otherwise swallow keys).
 *
 * macOS puts the app's own submenu first and expects Settings / Quit to live
 * there. Windows has no such menu, so those two move into File.
 */
export function buildAppMenu(
  dispatch: (command: MenuCommand) => void,
  openSettings: () => void,
  newDetachedSession: () => void
): Menu {
  const send = (command: MenuCommand) => () => dispatch(command)
  const settingsItem: MenuItemConstructorOptions = {
    label: t('common.settingsEllipsis'),
    accelerator: 'CmdOrCtrl+,',
    click: openSettings
  }

  const appMenu: MenuItemConstructorOptions[] = IS_MAC
    ? [
        {
          label: APP_NAME,
          submenu: [
            { role: 'about', label: t('menu.aboutApp', { app: APP_NAME }) },
            { type: 'separator' },
            settingsItem,
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide', label: t('menu.hideApp', { app: APP_NAME }) },
            { role: 'hideOthers', label: t('menu.hideOthers') },
            { role: 'unhide', label: t('menu.showAll') },
            { type: 'separator' },
            { role: 'quit', label: t('menu.quitApp', { app: APP_NAME }) }
          ]
        }
      ]
    : []

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newSession'), accelerator: 'CmdOrCtrl+N', click: send('new-conversation') },
        {
          label: t('menu.newSessionWindow'),
          accelerator: 'CmdOrCtrl+Shift+Return',
          click: newDetachedSession
        },
        { label: t('menu.newTerminal'), accelerator: 'CmdOrCtrl+T', click: send('new-terminal') },
        {
          label: t('menu.switchWorkdir'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: send('switch-workdir')
        },
        { type: 'separator' },
        ...(IS_MAC ? [] : [settingsItem, { type: 'separator' } as MenuItemConstructorOptions]),
        // Custom click (not role:close): renderer routes ⌘W by UI focus scope
        // (close bash / collapse Files tray / else close window).
        {
          label: t('menu.closeWindow'),
          accelerator: 'CmdOrCtrl+W',
          click: send('close-context')
        },
        ...(IS_MAC
          ? []
          : [{ role: 'quit', label: t('menu.quitApp', { app: APP_NAME }) } as MenuItemConstructorOptions])
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { role: 'undo', label: t('menu.undo') },
        { role: 'redo', label: t('menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('menu.cut') },
        { role: 'copy', label: t('menu.copy') },
        { role: 'paste', label: t('menu.paste') },
        { role: 'selectAll', label: t('menu.selectAll') },
        { type: 'separator' },
        { label: t('menu.find'), accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: t('menu.findNext'), accelerator: 'CmdOrCtrl+G', click: send('find-next') },
        {
          label: t('menu.findPrevious'),
          accelerator: 'CmdOrCtrl+Shift+G',
          click: send('find-previous')
        }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        {
          label: t('menu.toggleSidebar'),
          accelerator: 'CmdOrCtrl+Shift+H',
          click: send('toggle-sidebar')
        },
        {
          label: t('menu.toggleTools'),
          accelerator: 'CmdOrCtrl+Shift+E',
          click: send('toggle-tools-panel')
        },
        {
          label: t('menu.togglePanelSegment'),
          accelerator: 'CmdOrCtrl+Shift+T',
          click: send('toggle-panel-segment')
        },
        {
          label: t('menu.focusBash'),
          // Control+` (tilde/backtick) — main-chat / tools tray bash focus.
          accelerator: 'Control+`',
          click: send('focus-bash')
        },
        { type: 'separator' },
        {
          label: t('menu.focusWorkspace'),
          accelerator: 'CmdOrCtrl+1',
          click: send('focus-tools-1')
        },
        ...([2, 3, 4, 5, 6, 7, 8, 9] as const).map(
          (n): MenuItemConstructorOptions => ({
            label: t('menu.focusTerminal', { n: n - 1 }),
            accelerator: `CmdOrCtrl+${n}`,
            click: send(`focus-tools-${n}` as MenuCommand)
          })
        ),
        { type: 'separator' },
        {
          label: t('menu.focusComposer'),
          accelerator: 'CmdOrCtrl+K',
          click: send('focus-composer')
        },
        {
          label: t('menu.focusComposer'),
          accelerator: 'CmdOrCtrl+I',
          click: send('focus-composer')
        },
        { label: t('menu.send'), accelerator: 'CmdOrCtrl+Return', click: send('send') },
        { type: 'separator' },
        { role: 'reload', label: t('menu.reload') },
        { role: 'toggleDevTools', label: t('menu.devTools') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('menu.actualSize') },
        { role: 'zoomIn', label: t('menu.zoomIn') },
        { role: 'zoomOut', label: t('menu.zoomOut') },
        { role: 'togglefullscreen', label: t('menu.fullscreen') }
      ]
    },
    {
      label: t('menu.window'),
      submenu: [
        { role: 'minimize', label: t('menu.minimize') },
        { role: 'zoom', label: t('menu.zoom') },
        ...(IS_MAC
          ? ([
              { type: 'separator' },
              { role: 'front', label: t('menu.front') }
            ] as MenuItemConstructorOptions[])
          : [])
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
