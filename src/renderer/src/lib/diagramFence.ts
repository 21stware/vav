export type DiagramKind = 'mermaid' | 'graphviz' | 'vegalite' | 'erd'

const DIAGRAM_LANGS: Record<string, DiagramKind> = {
  mermaid: 'mermaid',
  graphviz: 'graphviz',
  dot: 'graphviz',
  gv: 'graphviz',
  'vega-lite': 'vegalite',
  vegalite: 'vegalite',
  vega: 'vegalite',
  vl: 'vegalite',
  erd: 'erd',
  er: 'erd',
  erdiagram: 'erd'
}

export function diagramKindForLang(language: string): DiagramKind | null {
  const key = language.trim().toLowerCase()
  return DIAGRAM_LANGS[key] ?? null
}

/**
 * True when `source` ends inside an unclosed mermaid / graphviz / vega / ERD
 * fence. The stream tail keeps that fence until a blank line seals it; painting
 * on every tick re-parses incomplete source through mermaid/vega.
 */
export function sourceHasOpenDiagramFence(source: string): boolean {
  let inside = false
  let marker = ''
  let diagram = false
  for (const line of source.split('\n')) {
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (!fence) continue
    const ch = fence[1]![0]!
    if (!inside) {
      inside = true
      marker = ch
      const lang = line.slice(fence[0].length).trim().split(/\s+/)[0] ?? ''
      diagram = diagramKindForLang(lang) != null
    } else if (ch === marker) {
      inside = false
      marker = ''
      diagram = false
    }
  }
  return inside && diagram
}
