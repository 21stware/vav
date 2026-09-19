import { formatPortMark, loopbackHttpUrl, type PtyPortForward } from '@shared/ptyPorts.ts'
import { useT } from '../i18n/useT'
import type { MessageKey } from '@shared/i18n'

const MAX_VISIBLE = 3

const STATUS_KEY: Record<PtyPortForward['status'], MessageKey> = {
  local: 'tools.port.local',
  forwarding: 'tools.port.forwarding',
  conflict: 'tools.port.conflict',
  error: 'tools.port.error'
}

function canOpen(row: PtyPortForward): boolean {
  return (row.status === 'local' || row.status === 'forwarding') && row.localPort > 0
}

export function TerminalPortMarks({
  forwards,
  insetClose
}: {
  forwards?: PtyPortForward[]
  insetClose?: boolean
}): React.JSX.Element | null {
  const t = useT()
  if (!forwards?.length) return null
  const visible = forwards.slice(0, MAX_VISIBLE)
  const extra = forwards.length - visible.length

  return (
    <div
      className="terminal-port-marks"
      data-inset-close={insetClose ? 'true' : undefined}
      data-testid="terminal-port-marks"
    >
      {visible.map((row) => {
        const open = canOpen(row)
        const label = formatPortMark(row.remotePort)
        const title = t(STATUS_KEY[row.status], { port: label })
        return (
          <button
            key={row.remotePort}
            type="button"
            className="terminal-port-mark"
            data-status={row.status}
            data-testid={`terminal-port-mark-${row.remotePort}`}
            title={title}
            aria-label={title}
            disabled={!open}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              if (!open) return
              window.open(loopbackHttpUrl(row.localPort), '_blank', 'noopener,noreferrer')
            }}
          >
            {label}
          </button>
        )
      })}
      {extra > 0 ? (
        <span className="terminal-port-mark is-more" title={t('tools.port.more', { count: String(extra) })}>
          +{extra}
        </span>
      ) : null}
    </div>
  )
}
