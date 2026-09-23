import type { Node as PMNode } from 'prosemirror-model';
import type { Mapping } from 'prosemirror-transform';
import type { ElementRange } from '../elements';
import { type LineInfo } from './blocks';
/**
 * 元素范围表：每个 block（行）一条 BlockMeta，携带该行解析出的全部元素
 * （绝对文档坐标）。这是 L3 状态机实例集合的物理载体。
 */
export interface BlockMeta {
    /** block 节点自身位置 */
    pos: number;
    /** block 节点 nodeSize（内容 = [pos+1, pos+size-1]） */
    size: number;
    text: string;
    line: LineInfo;
    elements: ElementRange[];
}
export declare function parseDoc(doc: PMNode): BlockMeta[];
/**
 * 增量 parse：全量 classify（fence/table 状态机需要），
 * 对「文本 + 行类型 + 结构 attrs 未变」的行 map 旧 elements，跳过 parseInline。
 */
export declare function parseDocIncremental(doc: PMNode, prevBlocks: BlockMeta[], mapping: Mapping): BlockMeta[];
