export type SwarmBracketKind = 'first' | 'mid' | 'last'

export function ConvBracket({ kind }: { kind: SwarmBracketKind }): React.JSX.Element {
  return <span className={`conv-bracket is-${kind}`} aria-hidden />
}
