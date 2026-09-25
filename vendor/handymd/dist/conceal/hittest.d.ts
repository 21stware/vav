import type { ElementRange } from '../elements';
export interface SelLike {
    from: number;
    to: number;
}
/**
 * L3 状态机的转移条件，编码为纯函数：
 *
 *   Concealed --cursorEnter--> Revealed : selection 与 [hitFrom, hitTo] 相交
 *   Revealed --cursorLeave--> Concealed : selection 完全离开（且非 composition 中，
 *                                          composition 冻结在 plugin.apply 层实现）
 *
 * inline 元素的 hit 区间是 [from-1, to+1]（扩一格判定）；fence 是整个代码块
 * 区域；static / permanent 元素永远不 reveal（hr/bullet/quote/todo 一旦渲染
 * 就不再回到源码 —— Bear 的手感）；heading 参与 reveal（聚焦展示层级图标，
 * 源码 `#` 仍在 decoration 层永久隐藏）；readOnly 强制全部 Concealed。
 *
 * 范围选区只在两个端点处 reveal：选区覆盖的中间部分保持渲染态，
 * 否则全选 / 拖选会让整片内容回到源码，文字重排后选区端点在拖动中跳动。
 *
 * 图片是原子元素，永远不回到源码：对它而言 "revealed" 表示「被选中」
 * （选区完整覆盖整段 `![alt](src)`），只用来画选中态。
 */
export declare function isRevealed(el: ElementRange, sel: SelLike, readOnly: boolean): boolean;
/** 一个块的 reveal 签名：只有签名变化的块才需要重建 decoration。 */
export declare function revealSignature(revealed: readonly boolean[]): string;
