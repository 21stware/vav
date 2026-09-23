import { Decoration } from 'prosemirror-view';
import type { DiagramRenderCallback } from '../diagram';
import type { BlockMeta } from '../parse/docparse';
/**
 * decoration 生成的环境依赖。renderDiagram 缺省时 diagram block 退化为
 * 普通 code block 呈现（结构化解析仍然分类为 diagram，只是不渲染图表）。
 */
export interface DecorationContext {
    renderDiagram?: DiagramRenderCallback;
}
export declare function buildBlockDecos(block: BlockMeta, revealed: readonly boolean[], ctx?: DecorationContext): Decoration[];
