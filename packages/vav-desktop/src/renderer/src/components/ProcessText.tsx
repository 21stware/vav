import { MarkdownView } from './MarkdownView'

/** Interstitial narration inside Thinking process — prose, not another row. */
export function ProcessText({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="process-text-body" data-testid="process-text">
      <MarkdownView source={text} />
    </div>
  )
}
