/**
 * 行级分类器：把每一行（= 一个 block 节点的 textContent）归入块级类型。
 * fence / table 是带跨行状态的结构，用小状态机处理；其余都是单行正则。
 *
 * 围栏块在结构化解析阶段就分成两类：
 *   - code block    → fenceOpen / code / fenceClose
 *   - diagram block → diagramOpen / diagramLine / diagramClose
 * 判据是 info string 的首个 token 是否为图表语言（如 ```mermaid）。
 * 两者共享同一套围栏状态机，仅产出的行类型不同。
 */
export type LineInfo = {
    t: 'blank';
} | {
    t: 'para';
} | {
    t: 'heading';
    level: number;
    prefixLen: number;
} | {
    t: 'quote';
    prefixLen: number;
} | {
    t: 'todo';
    indent: number;
    checked: boolean;
    prefixLen: number;
    checkOffset: number;
} | {
    t: 'bullet';
    indent: number;
    prefixLen: number;
} | {
    t: 'ordered';
    indent: number;
    num: number;
    numLen: number;
    prefixLen: number;
} | {
    t: 'hr';
} | {
    t: 'fenceOpen';
    tickStart: number;
    tickLen: number;
    info: string;
} | {
    t: 'fenceClose';
    tickStart: number;
    tickLen: number;
} | {
    t: 'code';
} | {
    t: 'diagramOpen';
    tickStart: number;
    tickLen: number;
    info: string;
    lang: string;
} | {
    t: 'diagramClose';
    tickStart: number;
    tickLen: number;
} | {
    t: 'diagramLine';
} | {
    t: 'tableHeader';
    colCount: number;
} | {
    t: 'tableSep';
    colCount: number;
} | {
    t: 'tableRow';
    colCount: number;
};
export type LineType = LineInfo['t'];
/**
 * LineInfo 结构相等。热路径（每次按键对每一行调用数次）上跑，
 * 所以走字段比较而不是 JSON.stringify —— 同变体的字段集合固定，
 * 逐 key 比较即可，且不受 key 顺序影响。
 */
export declare function lineInfoEqual(a: LineInfo, b: LineInfo): boolean;
/** info string → 图表语言；非图表围栏返回 null */
export declare function diagramLangOf(info: string): string | null;
export declare function classifyLines(lines: readonly string[]): LineInfo[];
