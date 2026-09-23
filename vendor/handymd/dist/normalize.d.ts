import { Plugin } from 'prosemirror-state';
/**
 * L2 管线的 Append 阶段：appendTransaction 规范化。
 *
 * 有序列表编号：按缩进层级维护独立 run。更深缩进的子项不会打断父级
 * 序号；回到父级缩进时继续累加。嵌套 run（indent > 0）一律从 1 起，
 * 顶层 run 仍保留首项用户写的起始值。
 *
 * composing 期间跳过（IME 冻结原则同样适用于规范化写入）。
 */
export declare function normalizePlugin(): Plugin;
