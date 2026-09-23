/**
 * L4 持久化状态机：
 *
 *   Clean → Dirty        : tr.docChanged（markDirty，重置防抖计时器）
 *   Dirty → Saving       : 防抖到期(默认 800ms) / flush（blur、Mod-s、unmount）
 *   Saving → Clean       : 保存成功且期间无新输入
 *   Saving → Saving      : 保存期间又有输入 → 完成后立即再存
 *   Saving → Retrying    : 网络失败，指数退避
 *   Retrying → Saving    : 退避到期重试
 *   Retrying → Offline   : 连续失败超过 maxRetries
 *   Offline → Saving     : retryNow()（编辑器会挂 window 'online' 事件自动触发）
 *
 * 序列化免费：文档模型即源码，getSource() 就是按行拼接。
 */
export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'retrying' | 'offline';
export interface AutosaveOptions {
    save: (markdown: string) => Promise<unknown> | unknown;
    /** 防抖时长，默认 800ms */
    debounceMs?: number;
    /** 进入 Offline 前的最大重试次数，默认 5 */
    maxRetries?: number;
    /** 退避基数，默认 500ms（500, 1000, 2000, ...，封顶 backoffMaxMs） */
    backoffBaseMs?: number;
    backoffMaxMs?: number;
    onStatusChange?: (status: SaveStatus, error?: unknown) => void;
    /** 是否监听 window 'online' 自动从 Offline 恢复，默认 true */
    listenOnline?: boolean;
}
export declare class Autosave {
    private statusValue;
    private timer;
    private retryTimer;
    private attempts;
    private dirtyDuringSave;
    private inFlight;
    private destroyed;
    private waiters;
    private lastError;
    private readonly onlineHandler;
    private readonly getSource;
    private readonly opts;
    constructor(getSource: () => string, options: AutosaveOptions);
    get status(): SaveStatus;
    get error(): unknown;
    private setStatus;
    /** tr.docChanged → 置脏并重置防抖计时器 */
    markDirty(): void;
    /** 手动标记为已保存（例如冲突解决选择了远端版本之后） */
    markClean(): void;
    /** 立即保存（blur / Mod-s / unmount flush）。resolve 于回到 Clean。 */
    flush(): Promise<void>;
    /** Offline/Retrying → 立即重试（网络恢复时） */
    retryNow(): void;
    destroy(): void;
    private clearTimers;
    private settleWaiters;
    private run;
}
