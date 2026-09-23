import type { Node as PMNode, Schema } from 'prosemirror-model';
/**
 * markdown 文本 ↔ ProseMirror doc。
 *
 * 因为文档模型就是源码（一行一个 block），这两个转换都是无损且 O(n) 的，
 * 不存在富文本 → markdown 的有损映射。
 */
export declare function markdownToDoc(markdown: string, schema?: Schema): PMNode;
export declare function docToMarkdown(doc: PMNode): string;
