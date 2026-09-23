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
 */
export declare function isRevealed(el: ElementRange, sel: SelLike, readOnly: boolean): boolean;
/** 一个块的 reveal 签名：只有签名变化的块才需要重建 decoration。 */
export declare function revealSignature(revealed: readonly boolean[]): string;
