import type { Command } from 'prosemirror-state';
import { Plugin } from 'prosemirror-state';
/**
 * Enter：列表/引用续行；标题特殊处理；行内标记中间回车两侧都补标记。
 *
 * 标题：
 *   - 行首（内容起点、行非空）：上方插空行，`# Title` 整行保持标题
 *   - 行中/行末：split，下一行是普通段落（不继承 `#`）
 *   - 空标题再回车：退出标题格式
 *
 * 列表/引用：
 *   - 空前缀行再回车：嵌套项先退一级缩进，顶层项退出块格式
 *   - 行首（内容起点、行非空）：上方插入空项，当前项（含勾选状态）原样下移
 *   - 其余：续前缀
 */
export declare const continueListItem: Command;
/**
 * Shift-Enter：拆行但不续前缀（列表/引用/标题里换到一行普通文本），
 * 行内标记拆分规则同 Enter。代码块与表格交给默认行为。
 */
export declare const splitWithoutPrefix: Command;
/**
 * 围栏开行末尾回车：若这个围栏没有闭合（或会错把后面另一个代码块的闭合行
 * 当成自己的），自动补上闭合行 —— 否则下面整篇文档都会变成代码块。
 */
export declare const closeFenceOnEnter: Command;
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
 * Backspace 在块前缀的内容起点：删除整个前缀（= 关闭该行格式，
 * 与 Bear 一致 —— 列表/引用/标题/待办退格一次变回普通段落）。
 *   - 嵌套列表项先退一级缩进，不把缩进空格露成正文
 *   - 有序列表序号可见但同样整体去掉
 *   - 标题上方是空行时先吃掉空行（标题保持）；否则去掉标题格式，
 *     可用 Mod-1…6 恢复
 *   - hr 行：整行删除（分隔线是一个对象，退格整体移除）
 */
export declare const backspaceBlockFormat: Command;
/**
 * Delete 在行尾：下一行带块前缀（列表/引用/标题/待办/有序）时，合并进来的只有内容，
 * 前缀随之丢弃 —— 否则隐藏的 `- ` 会变成本行里可见的正文。下一行是 hr 则整行删除。
 */
export declare const deleteForwardStripPrefix: Command;
export declare const backspaceIntoTable: Command;
export declare const deleteIntoTable: Command;
/**
 * Mod-1…6：把当前行设为对应级别标题；已是同级标题则还原为普通段落。
 * 列表/引用行会先去掉原前缀。
 */
export declare function setHeading(level: number): Command;
/**
 * ArrowLeft 在 permanent 前缀的内容起点：跳到上一行行尾（隐藏前缀不可进入）。
 */
export declare const arrowLeftSkipPrefix: Command;
/**
 * Shift-ArrowLeft 在隐藏前缀的内容起点：选区 head 直接跨到上一行行尾。
 * 否则浏览器把 head 放进前缀、caret guard 又推回来，选区永远扩不过去。
 */
export declare const shiftArrowLeftSkipPrefix: Command;
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
 * Tab（非列表、非表格行）：代码块内插入两个空格，多行选区整体缩进；
 * 其余文本插入制表符。都吞掉按键，避免焦点跳出编辑器。
 */
export declare const insertTab: Command;
/** Shift-Tab（非列表、非表格行）：代码块内每行去掉至多两个前导空格；其余只吞掉按键 */
export declare const removeTab: Command;
/**
 * 空标题是 `# ` / `## ` …（带尾部空格）。此时再敲 `#` 应升为更高一级标题，
 * 而不是把 `#` 写进标题正文。
 */
export declare function headingInputPlugin(): Plugin;
export declare function markdownKeymap(): Plugin;
