/**
 * GFM 管道表格行解析：切分 cell / pipe 的相对（行内）坐标。
 * 分类器与 decoration / insertTable 共用，保证列数与光标落点一致。
 */
import type { Span } from '../elements';
export interface TableCellSpan {
    from: number;
    to: number;
    text: string;
}
export interface ParsedTableRow {
    cells: TableCellSpan[];
    pipes: Span[];
}
/** 行内所有未转义的 `|` 位置（`\|` 是单元格内的字面竖线） */
export declare function findPipes(line: string): Span[];
/**
 * 按 GFM 规则切分表格行。
 * 允许省略首尾 `|`；单元格文本保留两侧空格（编辑时可点进空白格）。
 */
export declare function parseTableRow(line: string): ParsedTableRow;
export type TableAlign = 'left' | 'center' | 'right' | 'none';
/** 分隔行每列的对齐方式 */
export declare function parseTableAlign(sepLine: string): TableAlign[];
/** 单元格源码 → 编辑框里展示的文本：去掉两侧 padding 空格 */
export declare function cellDisplaySource(raw: string): string;
/** 编辑框文本 → 单元格源码：换行折成空格，裸 `|` 转义，两侧补 padding */
export declare function cellSourceFromInput(input: string): string;
/** 分隔行：每个 cell 都是 `---` / `:---` / `---:` / `:---:`，且行内必须有 `|`（避免与 hr 冲突） */
export declare function isTableSeparator(line: string): boolean;
/** 可能的表头/表体行：含 `|` 且非空白 */
export declare function looksLikeTableRow(line: string): boolean;
/** 生成空单元格文本（两侧各一空格，便于落光标） */
export declare function emptyCellText(): string;
export declare function formatTableRow(cells: readonly string[]): string;
export declare function formatSeparator(cols: number, align?: readonly ('left' | 'center' | 'right' | 'none')[]): string;
