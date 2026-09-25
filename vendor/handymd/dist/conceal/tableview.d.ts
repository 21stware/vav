/**
 * 表格的可视化与单元格内编辑。
 *
 * 整张表在表头行渲染为一个 `<table>` widget，其余源码行（分隔行 / 表体）折叠为零高。
 * 源码仍是管道表格文本 —— widget 只是它的投影：
 *
 *   - 单元格平时画预览（隐藏 `**` / `[]()` 等标记符）
 *   - 点击（或光标经由键盘进入表格行）后该格变为独立的 plaintext 编辑框，
 *     展示这一格的源码；每次输入立刻把这一格写回对应行的源码区间
 *   - 写回会让 widget 以新源码重建，重建后把焦点 / 光标还原到同一格
 *
 * 编辑框位于 contenteditable=false 的 widget 里，stopEvent 让 ProseMirror 完全
 * 不接管其中的事件与 DOM 变更；键盘导航 / 撤销 / IME 都在这里自行处理。
 */
import type { EditorView } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { type TableAlign } from '../parse/table';
import { type TableSource } from '../tableops';
/** 把单元格源码画成预览 DOM：隐藏标记符，保留 link/strong 等语义 class */
export declare function renderCellPreview(raw: string): DocumentFragment;
export interface TableModel {
    /** 每行的单元格源码（含 padding）；第 0 行是表头，不含分隔行 */
    rows: string[][];
    align: TableAlign[];
    colCount: number;
}
export declare function parseTableModel(src: string): TableModel;
/** 从表头块起逐行收集整张表的块位置（与 classifyLines 的表格状态机一致） */
export declare function tableLinePositions(doc: PMNode, headerPos: number): number[];
export interface TableViewOptions {
    onOpenLink?: (href: string) => void;
}
interface Target {
    row: number;
    col: number;
}
type Caret = number | 'start' | 'end';
declare const CONTROLLER: unique symbol;
type WrapEl = HTMLElement & {
    [CONTROLLER]?: TableController;
};
/** 整行 / 整列被选中（点击边缘把手） */
export interface TablePick {
    kind: 'row' | 'col';
    index: number;
}
declare class TableController {
    private readonly view;
    private readonly getPos;
    private readonly model;
    private readonly opts;
    readonly wrap: WrapEl;
    private readonly scroller;
    private readonly inner;
    private readonly table;
    private readonly rowHandle;
    private readonly colHandle;
    private readonly dropLine;
    private menu;
    private editing;
    private composing;
    private hover;
    private picked;
    private dragging;
    constructor(view: EditorView, getPos: () => number | undefined, model: TableModel, opts: TableViewOptions);
    private chrome;
    private renderTable;
    private cellEl;
    private rawAt;
    private headerPos;
    get rowCount(): number;
    get colCount(): number;
    beginEdit(t: Target, caret?: Caret, selectTo?: number): boolean;
    private endEdit;
    private onFocusOut;
    /**
     * 编辑框展示源码（比预览长），自动列宽会随输入跳动。编辑期间按预览态
     * 的列宽锁定；写回重建出的新 widget 先以预览态渲染，所以量到的宽度一致。
     */
    private freezeColumns;
    private unfreezeColumns;
    private onInput;
    private commit;
    private dispatchAndRestore;
    private onPaste;
    private onMouseDown;
    private onKeyDown;
    private toggleWrap;
    private insertRowAfter;
    private deleteRow;
    private deleteTable;
    private onHover;
    /** 把手跟随悬停（或已选中）的行列；菜单贴着选中的行列 */
    private positionChrome;
    get pickedRange(): TablePick | null;
    /** 选中整行 / 整列（null = 取消）。选中期间键盘焦点在表格容器上 */
    pick(p: TablePick | null, focus?: boolean): void;
    private showMenu;
    private positionMenu;
    private onPickKey;
    private onHandleDown;
    /** 指针位置对应的插入边界（0…n：插到第 n 行 / 列之前） */
    private dropBoundary;
    private showDrop;
    private autoScroll;
    private currentSource;
    /**
     * 用 op 改写整张表的源码（一次事务，可撤销）。重建出的新 widget 恢复
     * 选中的行列或进入某一格编辑。op 返回 null = 删除整张表。
     */
    structural(op: (src: TableSource) => TableSource | null, after?: {
        pick?: TablePick;
        edit?: Target;
    }): void;
    private moveRow;
    private moveCol;
    private deletePicked;
    private appendRow;
    private appendColumn;
    /** 离开表格：光标回到表格前一行行尾 / 后一行行首（没有就补一个空行） */
    exit(dir: 'before' | 'after'): void;
}
export declare function tableControllerAt(view: EditorView, headerPos: number): TableController | null;
/** 让表格的某一格进入编辑（格子不存在时退到最近的一格） */
export declare function focusTableCell(view: EditorView, headerPos: number, target: Target, caret?: Caret): boolean;
export declare function buildTableWidget(view: EditorView, getPos: () => number | undefined, src: string, opts: TableViewOptions): HTMLElement;
/**
 * ProseMirror 选区落进表格源码行时（键盘上下移动、insertTable、撤销），
 * 把它换成对应单元格的编辑框。返回是否接管。
 */
export declare function redirectSelectionIntoTable(view: EditorView): boolean;
export {};
