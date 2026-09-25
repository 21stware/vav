/**
 * 表格结构操作（纯函数，作用于管道表格源码行）。
 *
 * 行操作尽量保持原行文本不变（只重排 / 增删行）；列操作必须重写每一行，
 * 分隔行按新的列数与对齐重新生成。表头行的单元格数总是补齐到列数 ——
 * GFM 要求表头与分隔行列数一致，否则整张表不再被识别。
 */
import { type TableAlign } from './parse/table';
export interface TableSource {
    /** 表头 + 表体行（不含分隔行），源码原文 */
    rows: string[];
    /** 分隔行原文 */
    sep: string;
}
export declare function splitTableSource(src: string): TableSource;
export declare function joinTableSource(t: TableSource): string[];
export declare function tableColCount(t: TableSource): number;
export declare function insertTableRow(t: TableSource, at: number): TableSource;
/** 删除一行；删到只剩分隔行时返回 null（= 删除整张表）。删表头则下一行升为表头 */
export declare function deleteTableRow(t: TableSource, index: number): TableSource | null;
/** 把第 from 行移到第 to 行的位置（to 是移动后的下标） */
export declare function moveTableRow(t: TableSource, from: number, to: number): TableSource;
export declare function insertTableColumn(t: TableSource, at: number): TableSource;
/** 删除一列；删掉最后一列时返回 null（= 删除整张表） */
export declare function deleteTableColumn(t: TableSource, index: number): TableSource | null;
export declare function moveTableColumn(t: TableSource, from: number, to: number): TableSource;
export declare function setTableColumnAlign(t: TableSource, index: number, value: TableAlign): TableSource;
