import type { Node as PMNode, Schema } from 'prosemirror-model';
/**
 * markdown 文本 ↔ ProseMirror doc。
 *
 * 因为文档模型就是源码（一行一个 block），这两个转换都是无损且 O(n) 的，
 * 不存在富文本 → markdown 的有损映射。
 */
export declare function markdownToDoc(markdown: string, schema?: Schema): PMNode;
export declare function docToMarkdown(doc: PMNode): string;
export interface CommonMarkOptions {
    /**
     * 相邻两行普通文本在编辑器里是两行，CommonMark 里却是同一段的软换行（会被合并）。
     * `'hard'`（默认）：行尾补两个空格成为硬换行；`'paragraph'`：中间插空行拆成两段。
     */
    lineBreak?: 'hard' | 'paragraph';
}
/**
 * 编辑器源码 → 语义等价的 CommonMark / GFM。
 *
 * 编辑器按"一行一块"渲染，而 CommonMark 有段落续行、懒续行、setext 标题等跨行规则，
 * 同一份源码导出到其他渲染器会变样。这里只在行与行之间补空白，不改动行内容：
 *   - 普通文本行相邻：按 lineBreak 补硬换行或空行
 *   - 列表 / 引用后紧跟普通文本：插空行，避免成为懒续行
 *   - 普通文本后紧跟 `===` / `---` / 列表 / 表格：插空行，避免 setext 标题或无法打断段落
 * 代码块内部原样保留。
 */
export declare function toCommonMark(markdown: string, options?: CommonMarkOptions): string;
