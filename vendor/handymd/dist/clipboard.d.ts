import { Slice } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
/**
 * 剪贴板：文档即源码，一行一个 block，所以进出剪贴板的纯文本都必须是
 * 按 `\n` 精确对应的源码行。ProseMirror 默认按 `\n\n` 拼接块（复制出去每行
 * 多一个空行）、按 `\n+` 切分粘贴文本（空行被吞掉），两者都要替换。
 *
 * 外部 HTML（网页 / 文档编辑器）转换成 Markdown 源码再插入；
 * 编辑器内部的复制粘贴（带 data-pm-slice）走 ProseMirror 默认路径。
 */
/** 多行源码 → 两端 open 的 Slice：首行并入光标所在行，末行接上光标后的内容 */
export declare function markdownToSlice(markdown: string): Slice;
/** 外部 HTML → Markdown 源码（段间一个空行，列表项之间不空行） */
export declare function htmlToMarkdown(html: string): string;
export declare function clipboardPlugin(): Plugin;
