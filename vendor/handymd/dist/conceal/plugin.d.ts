import type { Transaction } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
import type { DiagramRenderCallback } from '../diagram';
import type { ImageResolver } from '../image';
import { type BlockMeta } from '../parse/docparse';
/**
 * L3 conceal/reveal 状态机的宿主插件，同时承担 L2 管线的 Reconciling 阶段：
 *
 *   Reparse   → parseDocIncremental（未改行 map 元素；脏行重解析 + 行内缓存）
 *   HitTest   → isRevealed(el, selection, readOnly) 纯函数
 *   Decorate  → 整篇 DecorationSet 只 map 一次，然后对「脏块」做 remove/add
 *
 * 关键架构决策：不为每个元素建状态对象。结果由
 * (doc, selection, composing, readOnly) 推导。
 *
 * 性能约束（决定了这里的写法）：DecorationSet.create() 的代价是
 * O(块数 × decoration 数)，在扁平的「一行一个 block」文档里就是 O(N²)。
 * 所以稳态路径（按键 / 移光标）绝不能重建整个 set —— 只能 map + 局部
 * remove/add，这两者的代价只跟脏块数量有关。create 仅用于首次构建与
 * 强制全量重算。
 *
 * IME 冻结：composing 期间 decoration 只 map，禁止重建与状态迁移。
 */
export interface ConcealMeta {
    composing?: boolean;
    readOnly?: boolean;
    /** 源码模式：关闭全部 conceal / 渲染 decoration，整篇直面 Markdown 源码 */
    source?: boolean;
    /** 强制全量重算（compositionend / 外部主题切换等场景） */
    refresh?: boolean;
}
export interface ConcealState {
    blocks: BlockMeta[];
    /** 每块的 reveal 签名 */
    sigs: string[];
    set: DecorationSet;
    composing: boolean;
    /** composing 期间发生过 docChanged，解冻后需要全量重算 */
    stale: boolean;
    readOnly: boolean;
    source: boolean;
}
export declare const concealKey: PluginKey<ConcealState>;
/** 起始位置恰为 pos 的块下标（blocks 按位置有序），没有则 -1 */
export declare function findBlockAt(blocks: readonly BlockMeta[], pos: number): number;
export interface ConcealOptions {
    readOnly?: boolean;
    /** 以源码模式启动（见 ConcealMeta.source） */
    source?: boolean;
    /**
     * diagram block（如 ```mermaid）在 Concealed 态的渲染回调
     * （见 diagram.ts 的 createDiagramRenderCallback）。缺省时 diagram
     * block 按普通 code block 呈现。
     */
    renderDiagram?: DiagramRenderCallback;
    /** 表格单元格里链接被单击时的回调，默认 window.open */
    onOpenLink?: (href: string) => void;
    /** 图片地址解析（见 HandyEditorOptions.resolveImage） */
    resolveImage?: ImageResolver;
}
export declare function concealPlugin(options?: ConcealOptions): Plugin<ConcealState>;
/** 向 conceal 状态机投递配置迁移（readOnly / composing / 强制重算）。 */
export declare function setConcealMeta(tr: Transaction, meta: ConcealMeta): Transaction;
