import { absoluteTime, relativeTime } from '../lib/format'
import { joinListFacts } from '../lib/writingStats'
import { getResolvedLocale } from '../i18n/useT'

export type ObjectFact = {
  id: string
  label: string
  value: string
  title?: string
}

export function formatFactCount(value: number): string {
  return value.toLocaleString(getResolvedLocale())
}

export function timeFact(
  id: string,
  label: string,
  at: number | null | undefined
): ObjectFact | null {
  if (at == null || !Number.isFinite(at) || at <= 0) return null
  return { id, label, value: relativeTime(at), title: absoluteTime(at) }
}

export function countFact(
  id: string,
  label: string,
  value: number | null | undefined
): ObjectFact | null {
  if (value == null || !Number.isFinite(value)) return null
  return { id, label, value: formatFactCount(value) }
}

/**
 * Quiet property strip: created, updated, length, and the counts that
 * belong to that kind of object. `bar` pins to the pane; `inline` sits in a form.
 */
export function ObjectFacts({
  items,
  variant = 'bar'
}: {
  items: Array<ObjectFact | null>
  variant?: 'bar' | 'inline'
}): React.JSX.Element | null {
  const visible = items.filter((item): item is ObjectFact => !!item && item.value !== '')
  if (visible.length === 0) return null
  return (
    <div
      className={`object-facts${variant === 'inline' ? ' is-inline' : ''}`}
      data-testid="object-facts"
      data-variant={variant}
    >
      {visible.map((item) => (
        <span key={item.id} className="object-fact" data-fact={item.id} title={item.title}>
          <span className="object-fact-label">{item.label}</span>
          <span className="object-fact-value">{item.value}</span>
        </span>
      ))}
    </div>
  )
}

/** Second line of an app-column list row. */
export function ObjectListLine({
  parts,
  title
}: {
  parts: ReadonlyArray<{ label: string; value: string | number | null | undefined }>
  title?: string
}): React.JSX.Element | null {
  const line = joinListFacts(parts)
  if (!line) return null
  return (
    <span className="applications-object-row-sub" title={title || line}>
      {line}
    </span>
  )
}

export function ObjectMasthead({
  title,
  reading = false
}: {
  title: string
  reading?: boolean
}): React.JSX.Element {
  return (
    <div className={`object-masthead${reading ? ' is-reading' : ''}`}>
      <h1 className="object-masthead-title" title={title}>
        {title}
      </h1>
    </div>
  )
}
