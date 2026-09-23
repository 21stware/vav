/**
 * L3 状态机的"实例集合"数据结构。
 *
 * 每个 Markdown 元素解析为一个 ElementRange。注意：这里不存 Concealed/Revealed
 * 状态本身 —— 状态是每次事务后由 (doc, selection, composing, readOnly) 纯函数
 * 推导出来的（见 conceal/plugin.ts），ElementRange 只描述"范围与命中区间"。
 */
export interface Span {
    from: number;
    to: number;
}
export type InlineKind = 'strong' | 'em' | 'code' | 'strike' | 'mark' | 'link' | 'image' | 'tag';
export type BlockKind = 'heading' | 'quote' | 'todo' | 'bullet' | 'ordered' | 'hr' | 'fenceOpen' | 'fenceClose' | 'codeLine' | 'diagramOpen' | 'diagramClose' | 'diagramLine' | 'tableHeader' | 'tableSep' | 'tableRow' | 'tableCell';
export type ElementKind = InlineKind | BlockKind;
export interface ElementAttrs {
    /** heading 级别 1-6 */
    level?: number;
    /** todo 是否勾选 */
    checked?: boolean;
    /** todo 勾选字符（` ` / `x`）在文档中的绝对位置 */
    checkPos?: number;
    /** link / image 的目标 */
    href?: string;
    /** image 的 alt 文本 */
    alt?: string;
    /** 列表缩进（空格数） */
    indent?: number;
    /** ordered 序号 */
    num?: number;
    /** fence 的语言信息串 */
    info?: string;
    /** diagram 的图表语言（info string 首个 token，如 `mermaid`） */
    lang?: string;
    /** diagram 的源码（围栏体各行以 \n 拼接，只挂在 diagramOpen 上） */
    code?: string;
    /** 表格列数 */
    colCount?: number;
    /** 表格单元格列下标 */
    col?: number;
    /** 表格区域首/末行（用于边框圆角） */
    tableEdge?: 'first' | 'last' | 'only';
}
export interface ElementRange {
    kind: ElementKind;
    /**
     * hitTest 粒度：inline 以字符范围相邻性触发，block 以光标所在块触发。
     */
    scope: 'inline' | 'block';
    /** 元素整体范围（绝对文档位置） */
    from: number;
    to: number;
    /**
     * cursorEnter/cursorLeave 的判定区间。
     * inline 元素为 [from-1, to+1]（扩一格判定，光标停在紧邻外侧即 reveal）；
     * block 元素为所在块的节点范围；fence 为整个代码块区域。
     */
    hitFrom: number;
    hitTo: number;
    /** 需要在 Concealed 态隐藏的标记符子范围 */
    markers: Span[];
    /** 语义内容范围（应用样式的部分） */
    content?: Span;
    attrs?: ElementAttrs;
    /**
     * static 元素的 decoration 与 conceal 状态无关（如 codeLine 的底色、
     * ordered 序号的弱化样式、#tag 的 pill），永远不参与 reveal 判定。
     */
    static?: boolean;
    /**
     * permanent 元素永久 Concealed（Bear 的块级手感）：hr / bullet / quote /
     * todo 一旦解析立即渲染，光标进入也不回到源码。标记符仍然存在于源码中
     * （序列化无损），只是永远不显示。
     *
     * 标题例外：源码 `#`/`##` 永远隐藏，但聚焦时在 gutter 展示层级图标
     * （见 decorations 的 heading 分支）—— 因此 heading 不设 permanent，
     * 以便参与 cursorEnter/Leave 判定。
     */
    permanent?: boolean;
}
/** 相对坐标版本（供行内解析缓存复用，base=0），结构与 ElementRange 相同。 */
export type RelElement = Omit<ElementRange, 'hitFrom' | 'hitTo'>;
export declare function spansIntersect(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean;
