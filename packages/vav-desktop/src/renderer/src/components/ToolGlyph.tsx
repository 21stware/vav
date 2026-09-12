import { iconForTool } from '../lib/toolGlyph'

export function ToolGlyph({
  tool,
  size = 13,
  title
}: {
  tool: string
  size?: number
  title?: string
}): React.JSX.Element {
  const Icon = iconForTool(tool)
  return (
    <span className="tool-glyph-hit" title={title} aria-label={title}>
      <Icon className="tool-glyph" size={size} strokeWidth={2} aria-hidden />
    </span>
  )
}
