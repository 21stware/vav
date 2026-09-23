import type { Command } from 'prosemirror-state';
import { Plugin } from 'prosemirror-state';
/**
 * Enter：列表/引用续行；标题特殊处理。
 *
 * 标题：
 *   - 行首（内容起点、行非空）：上方插空行，`# Title` 整行保持标题
 *   - 行中/行末：split，下一行是普通段落（不继承 `#`）
 *   - 空标题再回车：退出标题格式
 *
 * 列表/引用：空前缀行再回车 = 退出块格式；否则续前缀。
 */
export declare const continueListItem: Command;
/**
 * 用一对标记符包裹/解包 selection（Mod-b / Mod-i / Mod-e / Mod-Shift-x）。
 * 空 selection 时插入一对并把光标放中间。
 */
export declare function toggleInline(marker: string): Command;
/**
 * Mod-Backspace（macOS「删到行首」）：只清内容，保留 checkbox / 列表 / 引用 / 标题前缀。
 * 已在内容起点时吞掉按键，避免把前缀一并删掉。
 * 普通段落也自己处理 —— contenteditable 里浏览器的原生「删到行首」并不可靠。
 */
export declare const deleteToContentStart: Command;
/**
 * Mod-Delete：删到行尾，同样不碰隐藏前缀（前缀在光标左侧，天然不受影响）。
 */
export declare const deleteToContentEnd: Command;
/**
 * Backspace 在 permanent 前缀的内容起点：删除整个隐藏前缀（= 关闭该行格式，
 * 与 Bear 一致 —— 列表/引用/标题/待办退格一次变回普通段落）。
 * hr 行：整行删除（分隔线是一个对象，退格整体移除）。
 */
export declare const backspaceBlockFormat: Command;
/**
 * ArrowLeft 在 permanent 前缀的内容起点：跳到上一行行尾（隐藏前缀不可进入）。
 */
export declare const arrowLeftSkipPrefix: Command;
/**
 * ArrowUp 落在块首时：若上一行带隐藏前缀（标题/列表/引用…），把光标放到上一行
 * 行尾，而不是内容起点。
 *
 * 典型陷阱：标题行末 Enter → 下一空行 → ArrowUp。浏览器按 x=0 映射，光标会停在
 * 隐藏 `# ` 之后；再按 Backspace 就会误触去格式。
 */
export declare const arrowUpToPrevContentEnd: Command;
export declare const indentListItem: Command;
export declare const dedentListItem: Command;
/**
 * 空标题是 `# ` / `## ` …（带尾部空格）。此时再敲 `#` 应升为更高一级标题，
 * 而不是把 `#` 写进标题正文。
 */
export declare function headingInputPlugin(): Plugin;
export declare function markdownKeymap(): Plugin;
