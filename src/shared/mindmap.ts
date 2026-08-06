/**
 * Unified mind-map tree used by FreeMind (.mm) and OPML (.opml).
 * Edit in memory, then serialize back to the open format.
 */

export interface MindNode {
  id: string
  title: string
  /** Free-form note / rich text stripped to plain. */
  notes?: string
  children: MindNode[]
}

export type MindMapFormat = 'freemind' | 'opml'

export interface MindMapDoc {
  format: MindMapFormat
  root: MindNode
  /** Original map version attr (FreeMind), preserved on write when possible. */
  version?: string
}

let idSeq = 0
export function newMindNodeId(): string {
  idSeq += 1
  return `n-${Date.now().toString(36)}-${idSeq}`
}

export function createEmptyMindMap(format: MindMapFormat = 'freemind'): MindMapDoc {
  return {
    format,
    version: format === 'freemind' ? '1.0.1' : undefined,
    root: { id: newMindNodeId(), title: 'Central Topic', children: [] }
  }
}

/** Sniff FreeMind / Freeplane XML (vs Objective-C++ .mm). */
export function looksLikeFreeMind(text: string): boolean {
  const head = text.slice(0, 800).replace(/^\uFEFF/, '').trimStart()
  if (!head) return false
  if (/^<\?xml/i.test(head) && /<map[\s>]/i.test(head)) return true
  if (/^<map[\s>]/i.test(head)) return true
  return false
}

export function looksLikeOpml(text: string): boolean {
  const head = text.slice(0, 800).replace(/^\uFEFF/, '').trimStart()
  return /<opml[\s>]/i.test(head)
}

export function mindMapFormatForPath(path: string, text: string): MindMapFormat | null {
  const base = path.split(/[/\\]/).pop() ?? path
  const ext = base.includes('.') ? `.${base.split('.').pop()!.toLowerCase()}` : ''
  if (ext === '.opml' || looksLikeOpml(text)) return 'opml'
  if (ext === '.mm' && looksLikeFreeMind(text)) return 'freemind'
  if (looksLikeFreeMind(text)) return 'freemind'
  return null
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function encodeXmlEntities(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')
  const m = tag.match(re)
  if (!m) return null
  return decodeXmlEntities(m[2] ?? m[3] ?? '')
}

/**
 * Minimal FreeMind map parser — walks <node …> / </node> with a stack.
 * Handles self-closing <node …/> and TEXT / TEXT_CONTENT attributes.
 */
export function parseFreeMind(xml: string): MindMapDoc {
  const versionMatch = xml.match(/<map\b[^>]*\bversion\s*=\s*["']([^"']+)["']/i)
  const version = versionMatch?.[1] ?? '1.0.1'

  type Frame = { node: MindNode; open: boolean }
  const stack: Frame[] = []
  let root: MindNode | null = null

  const tokenRe = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?node\b[^>]*\/?>/gi
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(xml))) {
    const tok = m[0]
    if (tok.startsWith('<!--') || tok.startsWith('<![CDATA')) continue
    if (/^<\/node/i.test(tok)) {
      stack.pop()
      continue
    }
    const selfClose = /\/>\s*$/.test(tok)
    const title =
      attr(tok, 'TEXT') ??
      attr(tok, 'text') ??
      attr(tok, 'TEXT_CONTENT') ??
      'Topic'
    const id = attr(tok, 'ID') ?? attr(tok, 'id') ?? newMindNodeId()
    const node: MindNode = { id, title, children: [] }
    if (!root) {
      root = node
      if (!selfClose) stack.push({ node, open: true })
      continue
    }
    const parent = stack[stack.length - 1]?.node
    if (parent) parent.children.push(node)
    if (!selfClose) stack.push({ node, open: true })
  }

  if (!root) {
    return createEmptyMindMap('freemind')
  }
  return { format: 'freemind', version, root }
}

/** OPML outline tree. */
export function parseOpml(xml: string): MindMapDoc {
  type Frame = { node: MindNode }
  const stack: Frame[] = []
  let root: MindNode | null = null

  const tokenRe = /<!--[\s\S]*?-->|<\/?outline\b[^>]*\/?>/gi
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(xml))) {
    const tok = m[0]
    if (tok.startsWith('<!--')) continue
    if (/^<\/outline/i.test(tok)) {
      stack.pop()
      continue
    }
    const selfClose = /\/>\s*$/.test(tok)
    const title =
      attr(tok, 'text') ?? attr(tok, 'title') ?? attr(tok, 'TEXT') ?? 'Topic'
    const node: MindNode = { id: newMindNodeId(), title, children: [] }
    if (!root) {
      root = node
      if (!selfClose) stack.push({ node })
      continue
    }
    const parent = stack[stack.length - 1]?.node
    if (parent) parent.children.push(node)
    else root.children.push(node)
    if (!selfClose) stack.push({ node })
  }

  if (!root) return createEmptyMindMap('opml')
  return { format: 'opml', root }
}

export function parseMindMap(path: string, text: string): MindMapDoc {
  const format = mindMapFormatForPath(path, text)
  if (format === 'opml') return parseOpml(text)
  if (format === 'freemind') return parseFreeMind(text)
  // Fallback: single root with body as title
  return {
    format: 'freemind',
    version: '1.0.1',
    root: { id: newMindNodeId(), title: text.trim().slice(0, 80) || 'Central Topic', children: [] }
  }
}

function serializeFreeMindNode(node: MindNode, indent: string): string {
  const kids = node.children
  const open = `${indent}<node ID="${encodeXmlEntities(node.id)}" TEXT="${encodeXmlEntities(node.title)}"`
  if (kids.length === 0) return `${open}/>\n`
  let out = `${open}>\n`
  for (const c of kids) out += serializeFreeMindNode(c, indent + '  ')
  out += `${indent}</node>\n`
  return out
}

export function serializeFreeMind(doc: MindMapDoc): string {
  const ver = doc.version || '1.0.1'
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<map version="${encodeXmlEntities(ver)}">\n` +
    serializeFreeMindNode(doc.root, '  ') +
    `</map>\n`
  )
}

function serializeOpmlOutline(node: MindNode, indent: string): string {
  const kids = node.children
  const open = `${indent}<outline text="${encodeXmlEntities(node.title)}"`
  if (kids.length === 0) return `${open}/>\n`
  let out = `${open}>\n`
  for (const c of kids) out += serializeOpmlOutline(c, indent + '  ')
  out += `${indent}</outline>\n`
  return out
}

export function serializeOpml(doc: MindMapDoc): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<opml version="2.0">\n` +
    `  <head><title>${encodeXmlEntities(doc.root.title)}</title></head>\n` +
    `  <body>\n` +
    serializeOpmlOutline(doc.root, '    ') +
    `  </body>\n` +
    `</opml>\n`
  )
}

export function serializeMindMap(doc: MindMapDoc): string {
  return doc.format === 'opml' ? serializeOpml(doc) : serializeFreeMind(doc)
}

/** Immutable helpers for edit. */
export function findMindNode(root: MindNode, id: string): MindNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findMindNode(c, id)
    if (hit) return hit
  }
  return null
}

export function mapMindTree(root: MindNode, fn: (n: MindNode) => MindNode): MindNode {
  const next = fn(root)
  return {
    ...next,
    children: next.children.map((c) => mapMindTree(c, fn))
  }
}

export function updateMindNodeTitle(doc: MindMapDoc, id: string, title: string): MindMapDoc {
  const t = title.trim() || 'Topic'
  return {
    ...doc,
    root: mapMindTree(doc.root, (n) => (n.id === id ? { ...n, title: t } : n))
  }
}

export function addMindChild(doc: MindMapDoc, parentId: string, title = 'New Topic'): MindMapDoc {
  const child: MindNode = { id: newMindNodeId(), title, children: [] }
  return {
    ...doc,
    root: mapMindTree(doc.root, (n) =>
      n.id === parentId ? { ...n, children: [...n.children, child] } : n
    )
  }
}

export function deleteMindNode(doc: MindMapDoc, id: string): MindMapDoc {
  if (doc.root.id === id) return doc // never delete root
  const strip = (n: MindNode): MindNode => ({
    ...n,
    children: n.children.filter((c) => c.id !== id).map(strip)
  })
  return { ...doc, root: strip(doc.root) }
}

/** Flatten path labels root → node for PreviewRef text. */
export function mindNodePath(root: MindNode, id: string): string[] | null {
  const walk = (n: MindNode, trail: string[]): string[] | null => {
    const next = [...trail, n.title]
    if (n.id === id) return next
    for (const c of n.children) {
      const hit = walk(c, next)
      if (hit) return hit
    }
    return null
  }
  return walk(root, [])
}

export function mindNodeSubtreeText(node: MindNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  const lines = [`${pad}- ${node.title}`]
  for (const c of node.children) lines.push(mindNodeSubtreeText(c, depth + 1))
  return lines.join('\n')
}
