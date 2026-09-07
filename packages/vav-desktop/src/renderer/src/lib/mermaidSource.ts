/** Drop YAML frontmatter / %%{init}%% so beautiful-mermaid sees the diagram header. */
export function stripMermaidPreamble(source: string): string {
  let text = source.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
  if (text.startsWith('---')) {
    const close = text.indexOf('\n---', 3)
    if (close >= 0) text = text.slice(close + 4).replace(/^\s*\n/, '').trim()
  }
  for (;;) {
    const next = text.replace(/^%%\{[\s\S]*?\}%%\s*/, '').replace(/^%%[^\n]*\n\s*/, '')
    if (next === text) break
    text = next.trim()
  }
  return text
}
