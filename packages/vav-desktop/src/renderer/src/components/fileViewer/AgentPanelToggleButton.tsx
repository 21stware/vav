import wordmark from '../../assets/wordmark.png'
import wordmarkDark from '../../assets/wordmark-dark.png'

/** Shared Agent panel toggle — product mark (main embedded + standalone). */
export function AgentPanelToggleButton({
  open,
  title,
  onClick,
  className
}: {
  open: boolean
  title: string
  onClick: () => void
  className?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`btn ghost sm icon-only preview-agent-logo-btn${open ? ' is-active-toggle' : ''}${className ? ` ${className}` : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={open}
      onClick={onClick}
    >
      <span className="preview-agent-logo" aria-hidden>
        <img className="logo-light" src={wordmark} alt="" />
        <img className="logo-dark" src={wordmarkDark} alt="" />
      </span>
    </button>
  )
}
