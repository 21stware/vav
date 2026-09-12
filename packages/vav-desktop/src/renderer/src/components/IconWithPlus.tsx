import type { LucideIcon } from 'lucide-react'
import { Plus } from 'lucide-react'

/** Category glyph with a plus in the lower-right — Task add / Scheduled add / DB add. */
export function IconWithPlus({
  icon: Icon,
  size = 14
}: {
  icon: LucideIcon
  size?: number
}): React.JSX.Element {
  const mark = Math.max(9, Math.round(size * 0.65))
  return (
    <span className="icon-with-plus" style={{ width: size, height: size }}>
      <Icon size={size} aria-hidden />
      <span className="icon-with-plus-mark" aria-hidden>
        <Plus size={mark} strokeWidth={3} />
      </span>
    </span>
  )
}
