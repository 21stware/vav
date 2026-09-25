/**
 * 导出 PDF：把「渲染态」文档交给浏览器打印（用户在打印对话框里选「存储为 PDF」）。
 *
 * 做法是克隆编辑器当前的渲染 DOM，而不是另写一套 Markdown → HTML：
 * 标记符隐藏、代码高亮、mermaid 图表、表格、图片都与屏幕上所见一致。
 *
 *   1. 临时把 conceal 切到只读渲染态（光标所在元素也收起源码；源码模式也按渲染态导出）
 *   2. 等待仍在渲染的图表 / 图片
 *   3. 克隆 DOM，去掉编辑态痕迹（表格把手、编辑中的格子、选中态）
 *   4. 写进隐藏 iframe（带上页面的样式表与 --hm-* 主题变量），调用 print()
 */
import type { EditorView } from 'prosemirror-view';
export interface ExportPDFOptions {
    /** 打印文档标题（多数浏览器用作默认 PDF 文件名）；缺省取第一个标题 */
    title?: string;
    /** 追加的打印 CSS */
    css?: string;
    /** 等待图表 / 图片 / 样式加载的上限（ms），默认 8000 */
    timeout?: number;
    /**
     * 触发打印的方式，默认 `win.print()`。可替换为宿主自己的实现
     * （如桌面壳的原生打印接口），测试里也用它拦截。
     */
    print?: (win: Window) => void | Promise<void>;
}
/** 克隆渲染态 DOM 并去掉编辑态痕迹（导出为纯展示内容） */
export declare function printableClone(dom: HTMLElement): HTMLElement;
/** 生成可直接打印的完整 HTML 文档（渲染态内容 + 页面样式） */
export declare function buildPrintDocument(view: EditorView, options?: Pick<ExportPDFOptions, 'title' | 'css'>): string;
/**
 * 打开系统打印对话框导出 PDF。返回的 Promise 在 print() 调用返回后 resolve。
 * 只读 / 源码模式都可以导出，且不改变编辑器的状态。
 */
export declare function exportToPDF(view: EditorView, options?: ExportPDFOptions): Promise<void>;
