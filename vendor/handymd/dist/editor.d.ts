import { Plugin } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { type CodeHighlighter } from './highlight';
import { type DiagramRenderer } from './diagram';
import { Autosave, type AutosaveOptions, type SaveStatus } from './autosave';
import { type InsertTableOptions } from './table';
/**
 * L1 编辑器生命周期状态机：
 *
 *   Loading → Ready        : load() 拿到 markdown 源文本，parse → doc，创建 EditorView
 *   Loading → Error        : 加载失败；Error → Loading : retry()
 *   Ready(Editable ⇄ ReadOnly) : setReadOnly()。ReadOnly 下 L3 全部强制 Concealed，
 *                                filterTransaction 拒绝写事务，链接/checkbox 展示仍工作
 *   Ready → Conflicted     : notifyRemote() 时本地有未保存改动
 *   Conflicted → Ready     : resolveConflict('local' | 'remote')
 *   Ready → Destroyed      : destroy()（flush 未保存内容后销毁 view）
 */
export type EditorPhase = 'loading' | 'ready' | 'error' | 'conflicted' | 'destroyed';
export interface HandyEditorOptions {
    /** 编辑器挂载点 */
    mount: HTMLElement;
    /** 初始 markdown（与 load 二选一；都给时 load 优先） */
    content?: string;
    /** 异步拉取 markdown 源文本 */
    load?: () => Promise<string> | string;
    /** 提供后启用 L4 自动保存 */
    save?: (markdown: string) => Promise<unknown> | unknown;
    /** L4 参数（防抖/退避等） */
    autosave?: Omit<AutosaveOptions, 'save' | 'onStatusChange'>;
    readOnly?: boolean;
    /** Concealed 链接被点击时的回调，默认 window.open */
    onOpenLink?: (href: string) => void;
    onChange?: (markdown: string) => void;
    onPhaseChange?: (phase: EditorPhase) => void;
    onSaveStatusChange?: (status: SaveStatus, error?: unknown) => void;
    /** 追加自定义 ProseMirror 插件 */
    plugins?: Plugin[];
    /** 是否启用 undo/redo，默认 true */
    history?: boolean;
    /** 是否启用有序列表自动重编号，默认 true */
    normalizeOrderedLists?: boolean;
    /**
     * 代码块语法高亮器。默认启用 `createShikiHighlighter()`；
     * 可传入自定义实现或带主题的 Promise。
     */
    highlight?: CodeHighlighter | Promise<CodeHighlighter>;
    /**
     * diagram block 渲染器（推荐 `createMermaidRenderer()`，接受 Promise）。
     * 提供后 ```mermaid 围栏在光标离开时渲染为图表，光标进入回到源码；
     * 缺省时 diagram block 按普通代码块呈现。
     */
    diagram?: DiagramRenderer | Promise<DiagramRenderer>;
}
type EventMap = {
    phase: EditorPhase;
    change: string;
    saveStatus: SaveStatus;
};
export declare class HandyEditor {
    view: EditorView | null;
    autosave: Autosave | null;
    private phaseValue;
    private readOnlyValue;
    private readOnlyBeforeConflict;
    private remoteMarkdown;
    private lastLoadError;
    private readonly opts;
    private readonly listeners;
    constructor(options: HandyEditorOptions);
    get phase(): EditorPhase;
    get loadError(): unknown;
    get saveStatus(): SaveStatus;
    get readOnly(): boolean;
    private setPhase;
    private init;
    /** Error → Loading：重试加载 */
    retry(): void;
    private createView;
    getMarkdown(): string;
    setMarkdown(markdown: string, options?: {
        addToHistory?: boolean;
    }): void;
    /**
     * 编程式插入 GFM 管道表格。
     * 表格是多行结构，不提供 Markdown 输入触发；请用本方法或 `insertTable` command。
     */
    insertTable(options?: InsertTableOptions): boolean;
    focus(): void;
    setReadOnly(readOnly: boolean): void;
    /**
     * 远端版本变化时调用。本地干净 → 直接吃掉远端；本地有未保存改动 → Conflicted，
     * 编辑冻结，等 resolveConflict。
     */
    notifyRemote(remoteMarkdown: string): void;
    get remoteConflict(): string | null;
    resolveConflict(choice: 'local' | 'remote'): void;
    flush(): Promise<void>;
    on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void;
    private emit;
    /** unmount：flush 未保存内容后 destroy */
    destroy(): Promise<void>;
}
export declare function createEditor(options: HandyEditorOptions): HandyEditor;
export {};
