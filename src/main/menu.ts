import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'
import type { ResolvedKeyBindings } from '@shared/keyBindings'
import { APP_NAME } from './brand'
import { isDevRuntime } from './devRuntime'
import { t } from './i18n'

const IS_MAC = process.platform === 'darwin'

/**
 * Native application menu — product actions + standard Edit/Window roles.
 *
 * Accelerators also re-fire from `before-input-event` (menuShortcuts) so they
 * work when focus is inside xterm. Behaviour lives in the renderer
 * (`handleMenuCommand`); this file only dispatches.
 *
 * Layout mirrors the product:
 *   File    — sessions, packs, terminal, workdir
 *   Edit    — OS edit + find in transcript
 *   View    — chrome panels, focus slots, zoom
 *   Session — composer, send, stop, sidebar list modes
 *   Window  — minimize / zoom / front
 *   Help    — shortcuts, updates
 */
export function buildAppMenu(
  dispatch: (command: MenuCommand) => void,
  openSettings: () => void,
  newDetachedSession: () => void,
  bindings: ResolvedKeyBindings
): Menu {
  const send = (command: MenuCommand) => () => dispatch(command)
  const isDev = isDevRuntime()
  const b = bindings

  const settingsItem: MenuItemConstructorOptions = {
    label: t('common.settingsEllipsis'),
    accelerator: b.openSettings,
    click: openSettings
  }

  const checkUpdatesItem: MenuItemConstructorOptions = {
    label: t('menu.checkUpdates'),
    click: send('check-updates')
  }

  const appMenu: MenuItemConstructorOptions[] = IS_MAC
    ? [
        {
          label: APP_NAME,
          submenu: [
            { role: 'about', label: t('menu.aboutApp', { app: APP_NAME }) },
            { type: 'separator' },
            settingsItem,
            checkUpdatesItem,
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

  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.newSession'),
      accelerator: b.newSession,
      click: send('new-conversation')
    },
    {
      label: t('menu.newSessionWindow'),
      accelerator: b.newSessionWindow,
      click: newDetachedSession
    },
    { type: 'separator' },
    {
      label: t('menu.importPack'),
      click: send('import-pack')
    },
    {
      label: t('menu.exportPack'),
      click: send('export-pack')
    },
    { type: 'separator' },
    {
      label: t('menu.newTerminal'),
      accelerator: b.newTerminal,
      click: send('new-terminal')
    },
    {
      label: t('menu.switchWorkdir'),
      accelerator: b.switchWorkdir,
      click: send('switch-workdir')
    },
    { type: 'separator' },
    ...(IS_MAC ? [] : [settingsItem, { type: 'separator' } as MenuItemConstructorOptions]),
    // Custom click (not role:close): renderer routes ⌘W by UI focus scope
    // (close bash / collapse Files tray / else close window).
    {
      label: t('menu.closeWindow'),
      accelerator: b.closeContext,
      click: send('close-context')
    },
    ...(IS_MAC
      ? []
      : [
          {
            role: 'quit',
            label: t('menu.quitApp', { app: APP_NAME })
          } as MenuItemConstructorOptions
        ])
  ]

  const viewSubmenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.toggleSidebar'),
      accelerator: b.toggleSidebar,
      click: send('toggle-sidebar')
    },
    {
      label: t('menu.toggleTools'),
      accelerator: b.toggleTools,
      click: send('toggle-tools-panel')
    },
    {
      label: t('menu.togglePanelSegment'),
      accelerator: b.togglePanelSegment,
      click: send('toggle-panel-segment')
    },
    {
      label: t('menu.focusBash'),
      accelerator: b.focusBash,
      click: send('focus-bash')
    },
    { type: 'separator' },
    {
      label: t('menu.switchCliMode'),
      accelerator: b.switchCliMode,
      click: send('switch-cli-mode')
    },
    {
      label: t('menu.switchVavMode'),
      accelerator: b.switchVavMode,
      click: send('switch-vav-mode')
    },
    { type: 'separator' },
    {
      label: t('menu.focusWorkspace'),
      accelerator: b.focusTools1,
      click: send('focus-tools-1')
    },
    ...([2, 3, 4, 5, 6, 7, 8, 9] as const).map((n): MenuItemConstructorOptions => {
      const id = `focusTools${n}` as keyof ResolvedKeyBindings
      return {
        label: t('menu.focusTerminal', { n: n - 1 }),
        accelerator: b[id],
        click: send(`focus-tools-${n}` as MenuCommand)
      }
    }),
    { type: 'separator' },
    { role: 'resetZoom', label: t('menu.actualSize') },
    { role: 'zoomIn', label: t('menu.zoomIn') },
    { role: 'zoomOut', label: t('menu.zoomOut') },
    { role: 'togglefullscreen', label: t('menu.fullscreen') },
    ...(isDev
      ? ([
          { type: 'separator' },
          { role: 'reload', label: t('menu.reload') },
          { role: 'toggleDevTools', label: t('menu.devTools') }
        ] as MenuItemConstructorOptions[])
      : [])
  ]

  const sessionSubmenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.focusComposer'),
      accelerator: b.focusComposer,
      click: send('focus-composer')
    },
    {
      label: t('menu.send'),
      accelerator: b.sendMenu,
      click: send('send')
    },
    {
      label: t('menu.stopTurn'),
      click: send('cancel-turn')
    },
    { type: 'separator' },
    {
      label: t('menu.switchModel'),
      accelerator: b.switchModel,
      click: send('switch-model')
    },
    {
      label: t('menu.switchApproval'),
      accelerator: b.switchApproval,
      click: send('switch-approval')
    },
    { type: 'separator' },
    {
      label: t('menu.showSessions'),
      click: send('show-sessions')
    },
    {
      label: t('menu.showArchive'),
      click: send('show-archive')
    },
    {
      label: t('menu.showFileSessions'),
      click: send('show-file-sessions')
    }
  ]

  const helpSubmenu: MenuItemConstructorOptions[] = [
    {
      label: t('menu.keyboardShortcuts'),
      click: send('open-shortcuts')
    },
    ...(IS_MAC ? [] : [checkUpdatesItem])
  ]

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: t('menu.file'),
      submenu: fileSubmenu
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
        { label: t('menu.find'), accelerator: b.find, click: send('find') },
        { label: t('menu.findNext'), accelerator: b.findNext, click: send('find-next') },
        {
          label: t('menu.findPrevious'),
          accelerator: b.findPrevious,
          click: send('find-previous')
        }
      ]
    },
    {
      label: t('menu.view'),
      submenu: viewSubmenu
    },
    {
      label: t('menu.session'),
      submenu: sessionSubmenu
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
    },
    {
      label: t('menu.help'),
      submenu: helpSubmenu
    }
  ]

  return Menu.buildFromTemplate(template)
}
