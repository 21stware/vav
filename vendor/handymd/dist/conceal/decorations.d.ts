import { Decoration } from 'prosemirror-view';
import type { DiagramRenderCallback } from '../diagram';
import type { ImageResolver } from '../image';
import type { BlockMeta } from '../parse/docparse';
/**
 * decoration 生成的环境依赖。renderDiagram 缺省时 diagram block 退化为
 * 普通 code block 呈现（结构化解析仍然分类为 diagram，只是不渲染图表）。
 */
export interface DecorationContext {
    renderDiagram?: DiagramRenderCallback;
    /** 表格单元格里链接被单击时的回调，默认 window.open */
    onOpenLink?: (href: string) => void;
    /** 把 Markdown 里的图片地址解析成可加载的 URL（相对路径 / 自定义存储） */
    resolveImage?: ImageResolver;
}
export declare function buildBlockDecos(block: BlockMeta, revealed: readonly boolean[], ctx?: DecorationContext): Decoration[];
