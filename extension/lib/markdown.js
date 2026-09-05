export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;'
    if (ch === '<') return '&lt;'
    if (ch === '>') return '&gt;'
    if (ch === '"') return '&quot;'
    return '&#39;'
  })
}

/** Small, safe subset — agent-log prose, not a full CommonMark port. */
export function renderMarkdown(source) {
  let text = escapeHtml(source || '')
  const fences = []
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    fences.push(`<pre><code>${code}</code></pre>`)
    return `\u0000F${fences.length - 1}\u0000`
  })
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>'
  )
  text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  text = text.replace(/^# (.+)$/gm, '<h2>$1</h2>')
  text = text.replace(/^(?:- |\* )(.+)$/gm, '<li>$1</li>')
  text = text.replace(/(?:<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
  text = text.replace(/\n{2,}/g, '</p><p>')
  text = text.replace(/\n/g, '<br>')
  text = text.replace(/\u0000F(\d+)\u0000/g, (_, i) => fences[Number(i)] || '')
  return `<p>${text}</p>`
}
