import { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { ElementRange } from './elements';
import type { BlockMeta } from './parse/docparse';
export declare function permanentPrefixAt(state: EditorState, blockPos: number): {
    block: BlockMeta;
    el: ElementRange;
} | null;
/**
 * 折叠光标：推出隐藏前缀。
 * 范围选区：两端各自推出 —— 否则三击选行 / Cmd+Shift+← 选到行首后输入或删除，
 * 会把隐藏的 `- ` / `# ` 一起替换掉，格式无声丢失。
 */
export declare function caretGuardPlugin(): Plugin;
