import { Plugin } from 'prosemirror-state';
/**
 * L3 Concealed 态的 Interactive 子状态：
 *
 * - 链接在 Concealed 态单击是"打开"（mousedown 拦截，不移动光标）；
 *   要进入编辑必须用键盘移入，或 Cmd/Ctrl+点击。这是 Bear 区别于普通编辑器的手感。
 * - checkbox widget 点击切换 `[ ]` ↔ `[x]`（直接改源码文本，不动 selection）。
 *   readOnly 下该写事务会被 L1 的 filterTransaction 拒绝，展示仍然工作。
 * - diagram widget（渲染态图表）点击 = 进入编辑：把光标送到围栏开行末尾，
 *   selection 进入区域 → 整块立即 Revealed 回源码（Bear 的"点渲染物回源码"手感）。
 *   readOnly 下点击不进入编辑（reveal 被强制关闭，进去也只会看到空白）。
 */
export interface InteractionOptions {
    /** 默认 window.open(href, '_blank') */
    onOpenLink?: (href: string) => void;
}
export declare function interactionsPlugin(options?: InteractionOptions): Plugin;
