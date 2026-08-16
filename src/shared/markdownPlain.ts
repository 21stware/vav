/**
 * Visible text of a markdown message — headings, marks, and link targets
 * stripped so Copy as plain text matches what the bubble shows.
 */
export function markdownToPlainText(source: string): string {
  if (!source) return ''
  let text = source.replace(/\r\n/g, '\n')
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, '$1')
  text = text.replace(/~~~[\w-]*\n?([\s\S]*?)~~~/g, '$1')
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  text = text.replace(/^#{1,6}\s+/gm, '')
  text = text.replace(/^\s{0,3}>\s?/gm, '')
  text = text.replace(/^\s*[-*+]\s+/gm, '')
  text = text.replace(/^\s*\d+\.\s+/gm, '')
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')
  text = text.replace(/~~(.*?)~~/g, '$1')
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}
