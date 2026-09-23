import { ChartLine, Clock, HardDrive, type LucideIcon } from 'lucide-react'
import { APP_CATALOG_PLUGINS } from '@shared/appPlugins'
import type { MessageKey } from '@shared/i18n'
import type { ApplicationsMode } from '../state/sessionTypes'
import { NotebookDot } from './appNavIcons'

export type AppNavMode = Exclude<ApplicationsMode, 'devices'>

const APP_NAV_ICONS: Record<AppNavMode, LucideIcon | typeof NotebookDot> = {
  knowledge: NotebookDot,
  data: ChartLine,
  scheduled: Clock,
  storage: HardDrive
}

export const APP_NAV: {
  mode: AppNavMode
  testId: string
  labelKey: MessageKey
  Icon: LucideIcon | typeof NotebookDot
}[] = APP_CATALOG_PLUGINS.map((plugin) => ({
  mode: plugin.id,
  testId: plugin.nav.testId,
  labelKey: plugin.nav.labelKey as MessageKey,
  Icon: APP_NAV_ICONS[plugin.id]
}))
