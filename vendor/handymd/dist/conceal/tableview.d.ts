/**
 * 表格行 Concealed 态的可视化 DOM。
 *
 * ProseMirror 会把重叠的 inline decoration 合并成平铺 span（而非嵌套），
 * 因此不能在源码 span 上用 flex 做列布局 —— 单元格内的链接/加粗会拆成多列。
 * 这里改为整行 widget：列容器是真实 DOM，行内样式按 parseInline 预览绘制。
 */
import type { BlockMeta } from '../parse/docparse';
/** 把单元格源码画成预览 DOM：隐藏标记符，保留 link/strong 等语义 class */
export declare function renderCellPreview(raw: string): DocumentFragment;
export declare function buildTableRowVisual(block: BlockMeta, kind: 'tableHeader' | 'tableRow'): HTMLElement;
