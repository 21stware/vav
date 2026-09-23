/**
 * @21stware/handymd —— Bear 风格的源码保真 Markdown 编辑器 SDK（基于 ProseMirror）。
 *
 * 文档即 Markdown 源码；每个元素在 Concealed（渲染态）与 Revealed（源码态）
 * 之间由 selection 驱动切换。四层状态机：
 *
 *   L1 生命周期    → HandyEditor / createEditor        (src/editor.ts)
 *   L2 输入管线    → imePlugin + filterTransaction + normalizePlugin
 *   L3 元素渲染    → concealPlugin（纯函数推导，无 N 个状态对象）
 *   L4 持久化      → Autosave
 */
export { createEditor, HandyEditor } from './editor';
export type { EditorPhase, HandyEditorOptions } from './editor';
export { concealPlugin, concealKey, setConcealMeta } from './conceal/plugin';
export type { ConcealState, ConcealMeta, ConcealOptions } from './conceal/plugin';
export { isRevealed, revealSignature } from './conceal/hittest';
export { buildBlockDecos } from './conceal/decorations';
export { imePlugin } from './ime';
export { interactionsPlugin } from './interactions';
export type { InteractionOptions } from './interactions';
export { normalizePlugin } from './normalize';
export { caretGuardPlugin } from './caret';
export { markdownKeymap, headingInputPlugin, continueListItem, toggleInline, indentListItem, dedentListItem, backspaceBlockFormat, arrowLeftSkipPrefix, arrowUpToPrevContentEnd, deleteToContentStart, deleteToContentEnd, } from './keymap';
export { insertTable, buildTableMarkdown, goToNextTableCell, goToPrevTableCell, continueTableRow, } from './table';
export type { InsertTableOptions } from './table';
export { parseTableRow, isTableSeparator, looksLikeTableRow, formatTableRow, formatSeparator, } from './parse/table';
export { highlightPlugin, highlightKey, createShikiHighlighter } from './highlight';
export type { CodeHighlighter, HighlightSpan, ShikiHighlighterOptions } from './highlight';
export { createDiagramRenderCallback, createMermaidRenderer } from './diagram';
export type { DiagramRenderer, DiagramRenderCallback, MermaidRendererOptions } from './diagram';
export { Autosave } from './autosave';
export type { AutosaveOptions, SaveStatus } from './autosave';
export { schema } from './schema';
export { markdownToDoc, docToMarkdown } from './markdown';
export { parseInline, parseInlineCached } from './parse/inline';
export { classifyLines, diagramLangOf } from './parse/blocks';
export type { LineInfo, LineType } from './parse/blocks';
export { parseDoc } from './parse/docparse';
export type { BlockMeta } from './parse/docparse';
export type { ElementRange, ElementKind, ElementAttrs, InlineKind, BlockKind, RelElement, Span, } from './elements';
