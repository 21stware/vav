import { Plugin, PluginKey } from 'prosemirror-state';
import { DecorationSet } from 'prosemirror-view';
/**
 * 代码块语法高亮。
 *
 * 与 conceal 层完全解耦：本插件只读取 conceal 状态里的 fence 区域，
 * 把 (code, lang) 交给外部 CodeHighlighter（推荐 shiki），拿到逐行
 * token 后铺 inline decoration（style="color:…"）。
 *
 * 高亮是异步的：结果按 (lang, code) 缓存；未命中时先渲染无高亮，
 * resolve 后补一次 meta 事务刷新。文档模型不变 —— 高亮永远只是 decoration。
 */
export interface HighlightSpan {
    text: string;
    color?: string;
}
/** 返回逐行 token（与输入 code 按 \n 切分后行数对应） */
export type CodeHighlighter = (code: string, lang: string) => HighlightSpan[][] | Promise<HighlightSpan[][]>;
export declare const highlightKey: PluginKey<DecorationSet>;
export declare function highlightPlugin(highlighter: CodeHighlighter | Promise<CodeHighlighter>): Plugin<DecorationSet>;
export interface ShikiHighlighterOptions {
    /** shiki 主题名，默认 'github-light' */
    theme?: string;
    /** 预加载的语言，默认常用前端/脚本语言 */
    langs?: string[];
}
/**
 * shiki 适配器（动态 import）。`createEditor` 默认启用本适配器。
 *
 *   createEditor({ highlight: createShikiHighlighter({ theme: 'github-dark' }) })
 */
export declare function createShikiHighlighter(options?: ShikiHighlighterOptions): Promise<CodeHighlighter>;
