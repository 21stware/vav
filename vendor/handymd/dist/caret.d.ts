import { Plugin } from 'prosemirror-state';
import type { EditorState } from 'prosemirror-state';
import type { ElementRange } from './elements';
import type { BlockMeta } from './parse/docparse';
export declare function permanentPrefixAt(state: EditorState, blockPos: number): {
    block: BlockMeta;
    el: ElementRange;
} | null;
export declare function caretGuardPlugin(): Plugin;
