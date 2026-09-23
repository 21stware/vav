/**
 * 表格的编程式创建与行内导航。
 *
 * GFM 表格是多行结构（表头 + 分隔行 + 表体），不适合靠"输入触发"生成；
 * 宿主应调用 `insertTable` / `editor.insertTable()`。源码仍是管道表格文本，
 * 由 classifyLines + decorations 渲染。
 */
import type { Command } from 'prosemirror-state';
export interface InsertTableOptions {
    /** 总行数（含表头），默认 3 */
    rows?: number;
    /** 列数，默认 3 */
    cols?: number;
    /** 是否生成表头行，默认 true */
    withHeaderRow?: boolean;
    /** 可选表头文案；长度不足时用空单元格补齐 */
    headers?: string[];
}
/** 生成 GFM 管道表格源码（不含首尾多余空行） */
export declare function buildTableMarkdown(options?: InsertTableOptions): string;
/**
 * 在光标处插入一张 GFM 表格。
 * - 当前块为空：就地替换为表格
 * - 否则：在当前块后方插入
 * 光标落到第一行第一个单元格内容起点。
 */
export declare function insertTable(options?: InsertTableOptions): Command;
export declare const goToNextTableCell: Command;
export declare const goToPrevTableCell: Command;
/**
 * 表格内 Enter：在当前行后插入同样列数的空表体行，光标进新行首格。
 * 分隔行上的 Enter 忽略（由默认 keymap 处理）。
 */
export declare const continueTableRow: Command;
