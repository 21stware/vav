/**
 * 本地图片存储：没有后端时替代 data: URL 内联。
 *
 * upload 把文件存进 IndexedDB（不可用时退化为内存），返回一个相对路径
 * `assets/<name>-<hash>.<ext>` 写进 Markdown；resolve 在渲染时把这个路径
 * 换回 blob: URL。源码保持短小、可读，导出到真实目录时路径也照样成立。
 *
 *   const images = createLocalImageStore()
 *   createEditor({ mount, uploadImage: images.upload, resolveImage: images.resolve })
 */
import type { ImageResolver, ImageUploader } from './image';
export interface LocalImageStoreOptions {
    /** 写进 Markdown 的路径前缀，默认 `assets/` */
    prefix?: string;
    /** IndexedDB 库名，默认 `handymd-images`；传 null 只存内存 */
    dbName?: string | null;
}
export interface LocalImageStore {
    upload: ImageUploader;
    resolve: ImageResolver;
    /** 取回原始文件（导出 / 另存为时把图片一起写出） */
    get(path: string): Promise<Blob | null>;
}
export declare function createLocalImageStore(options?: LocalImageStoreOptions): LocalImageStore;
