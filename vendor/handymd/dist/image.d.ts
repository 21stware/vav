/**
 * 图片。
 *
 * 图片在源码里就是一行 `![alt](src)`，由 decorations 渲染成预览 widget。
 * 这里负责：
 *   - 插入：`insertImage({ src, alt })` command / `editor.insertImage()`、
 *     粘贴 / 拖放图片文件（imagePlugin）、`editor.insertImageFiles(files)`
 *   - 原子交互：图片永远不回到源码。单击 = 选中（选区覆盖整段源码），
 *     Backspace / Delete 先选中再删除，方向键把它当成一个字符跨过
 *
 * 文件先以 blob: URL 占位插入（立即可见），上传完成后把占位 URL 原位替换为
 * 最终地址；上传失败则移除占位。未提供上传函数时退化为 data: URL 内联
 * （不推荐：源码会被 base64 撑大 —— 用 upload 或 createLocalImageStore）。
 */
import type { Command, EditorState } from 'prosemirror-state';
import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ElementRange } from './elements';
export interface InsertImageOptions {
    src: string;
    alt?: string;
}
/** 上传图片文件，返回可放进 Markdown 的地址 */
export type ImageUploader = (file: File) => Promise<string>;
/**
 * 渲染时把 Markdown 里的图片地址解析成浏览器可加载的 URL。
 * 用于相对路径（`assets/a.png` → 相对当前文档）或自定义存储（IndexedDB / 私有桶签名）。
 */
export type ImageResolver = (src: string) => string | Promise<string>;
export interface ImagePluginOptions {
    /** 缺省时图片以 data: URL 内联进源码 */
    upload?: ImageUploader;
}
export declare function imageMarkdown({ src, alt }: InsertImageOptions): string;
/**
 * 把图片作为独立一行插入：
 *   - 当前行为空：就地变成图片行
 *   - 否则：插在当前行之后
 * 光标落到图片下一行行首（没有空行就补一个），图片保持渲染态。
 */
export declare function insertImage(options: InsertImageOptions): Command;
export declare function isImageFile(file: File): boolean;
/**
 * 在当前选区插入图片文件：先插占位，再异步上传 / 内联并原位替换。
 * 返回的 Promise 在所有文件处理完成后 resolve。
 */
export declare function insertImageFiles(view: EditorView, files: Iterable<File>, upload?: ImageUploader): Promise<void>;
/** 选区是否恰好选中一张图片 */
export declare function selectedImage(state: EditorState): ElementRange | null;
/** 粘贴 / 拖放图片文件 → 插入图片；图片的点击选中 / 键盘删除 */
export declare function imagePlugin(options?: ImagePluginOptions): Plugin;
