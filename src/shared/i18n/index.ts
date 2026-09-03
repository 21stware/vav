import { en, zhCN, type AppLocale, type LocalePreference, type MessageKey } from './messages.ts'

export type { AppLocale, LocalePreference, MessageKey }
export { en, zhCN }

const catalogs: Record<AppLocale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
  en
}

export function resolveLocale(preference: LocalePreference, systemLocale: string): AppLocale {
  if (preference === 'zh-CN' || preference === 'en') return preference
  const base = systemLocale.toLowerCase().replace('_', '-')
  if (base === 'zh' || base.startsWith('zh-')) return 'zh-CN'
  return 'en'
}

export type TParams = Record<string, string | number>

export function t(locale: AppLocale, key: MessageKey, params?: TParams): string {
  const template = catalogs[locale][key] ?? catalogs.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    params[name] === undefined || params[name] === null ? `{${name}}` : String(params[name])
  )
}

/** Default / legacy untitled session titles across locales. */
export function isDefaultSessionTitle(title: string): boolean {
  const trimmed = title.trim()
  return (
    trimmed === zhCN['common.untitledSession'] ||
    trimmed === zhCN['common.untitledSessionLegacy'] ||
    trimmed === en['common.untitledSession'] ||
    trimmed === en['common.untitledSessionLegacy']
  )
}

export function defaultSessionTitle(locale: AppLocale): string {
  return t(locale, 'common.untitledSession')
}

/** Approval button texts the runtime must recognize regardless of current UI locale. */
export function isApprovalDenyText(text: string): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  return (
    line === zhCN['approval.deny'] ||
    line === zhCN['approval.skip'] ||
    line === en['approval.deny'] ||
    line === en['approval.skip'] ||
    text.startsWith(`${zhCN['approval.skip']}\n`) ||
    text.startsWith(`${zhCN['approval.deny']}\n`) ||
    text.startsWith(`${en['approval.skip']}\n`) ||
    text.startsWith(`${en['approval.deny']}\n`)
  )
}

export function isApprovalApproveText(text: string, editMode: boolean): boolean {
  const line = text.split('\n')[0]?.trim() ?? ''
  if (editMode) {
    return (
      line === zhCN['approval.approveRun'] ||
      line === en['approval.approveRun'] ||
      text.startsWith(`${zhCN['approval.approveRun']}\n`) ||
      text.startsWith(`${en['approval.approveRun']}\n`)
    )
  }
  return line === zhCN['approval.approve'] || line === en['approval.approve']
}

/** True if `text` contains the catalog string in either locale. */
export function catalogTextIncludes(key: MessageKey, text: string | null | undefined): boolean {
  if (!text) return false
  return text.includes(zhCN[key]) || text.includes(en[key])
}

export function catalogTextEquals(key: MessageKey, text: string | null | undefined): boolean {
  if (!text) return false
  return text === zhCN[key] || text === en[key]
}

/**
 * True if `text` starts with the catalog template with `{placeholders}`
 * stripped (e.g. `tool.backgroundPid` → "后台运行 · pid" / "Background · pid").
 */
export function catalogTextStartsWithTemplate(key: MessageKey, text: string): boolean {
  const strip = (value: string): string => value.replace(/\s*\{[^}]*\}.*$/, '').trimEnd()
  return text.startsWith(strip(zhCN[key])) || text.startsWith(strip(en[key]))
}

export function fileSortLabelKey(
  key: string
): MessageKey {
  const map: Record<string, MessageKey> = {
    none: 'files.sort.none',
    name: 'files.sort.name',
    kind: 'files.sort.kind',
    application: 'files.sort.application',
    dateAdded: 'files.sort.dateAdded',
    dateModified: 'files.sort.dateModified',
    dateCreated: 'files.sort.dateCreated',
    size: 'files.sort.size',
    tags: 'files.sort.tags'
  }
  return map[key] ?? 'files.sort.name'
}
