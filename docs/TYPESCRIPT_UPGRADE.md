# TypeScript 升级技术方案

> 状态：**评估完成，待决策**。本文回答三个问题：我们现在依赖什么、升级到 7.0 会改变什么、为什么不能卡死在 5.9，以及给出可执行的升级路径。

## 1. 现状：我们依赖的到底是什么

`typescript` 在 `package.json` 里位于 **`dependencies`**（`"^5.9.0"`），而不是 `devDependencies`。这不是笔误，因为它在 vav 里承担了**两个完全不同、容易混淆的角色**：

| 角色 | 用途 | 生命周期 |
|------|------|----------|
| ① 构建工具 | `npm run typecheck`（`tsc --noEmit`）做类型检查 | 仅开发期 |
| ② 运行时库 | `src/main/preview/parseTsCodeBlocks.ts` 在主进程 `import ts from 'typescript'`，用编译器的 **AST 解析 API** 把 TS/JS 源码解析成预览块 | **应用运行时** |

electron-vite 用 `externalizeDepsPlugin` 把 `typescript` 外部化（不打包进 bundle），所以**应用打包后运行时仍会 `require('typescript')`**。也就是说，TypeScript 编译器本身是文件预览功能的一个**运行时依赖**。

**这就是"被版本卡死"的根源**：我们不只是在"用 tsc 编译"，而是把整个 TypeScript 编译器当作运行时解析库在用。编译器升级 = 预览功能可能失效，所以不敢升。

### `parseTsCodeBlocks` 用到的编译器能力

这个文件是**纯语法级 AST 解析**，不涉及类型检查、符号表、语义分析。用到的 API：

- `ts.createSourceFile` / `ts.ScriptKind` / `ts.ScriptTarget` — 解析配置
- AST 节点类型：`SourceFile`、`Node`、`Statement`、`NamedDeclaration`、`FunctionLikeDeclaration`、`ClassElement`、`TypeElement`
- `ts.is*` 系列判断函数（约 20 个：`isClassDeclaration`、`isFunctionDeclaration`、`isArrowFunction`…）
- `ts.forEachChild` — 子节点遍历
- `getStart/getEnd/getText/getLineAndCharacterOfPosition` — 位置与源码切片

## 2. 升级到 7.0 会改变什么

TypeScript 7.0（2026-07-08 GA）是**把整个编译器从 JavaScript 重写为 Go 原生二进制**，性能是核心卖点：

| 指标 | 数据 |
|------|------|
| 完整构建 | 7.7x–11.9x 更快（vscode 125.7s→10.6s） |
| 内存 | 降低 6%–26% |
| 编辑器首错时间 | 17.5s→1.3s（>13x） |
| 语言服务崩溃 | -60%+，命令失败 -80% |

但这个重写有一个**关键取舍**：**7.0 不再附带 JS 编译器 API**。

- 5.9 / 6.0：`typescript` 是 JS 写的，`import ts from 'typescript'` 能拿到完整解析器 API
- 7.0：`typescript` 包只提供**原生 `tsc` 可执行文件**，没有可被 JS `import` 的编译器对象。官方明确："7.0 does not ship with an API"，新 API 预计 7.1 才提供

**对 vav 的直接影响**：`parseTsCodeBlocks.ts` 在运行时 `require('typescript')` 拿不到 `SourceFile`/`Node`/`is*`，**文件预览功能直接失效**。这不是改几行类型能解决的，是运行时依赖整体消失。

### tsconfig 层面的改动（小，可控）

实测在 TS7 下跑本项目完整类型检查，除预览模块外只有这些：

1. **`baseUrl` 被移除**（两个 tsconfig 都有）→ 删除 `baseUrl`，`paths` 值加 `./` 前缀（已验证可行）
2. **`noUncheckedSideEffectImports` 默认开启** → `main.tsx` 两个 CSS 副作用导入报 TS2882，加 CSS 模块声明即可
3. 其余（`strict` 默认开启、`rootDir` 默认 `./`、`types` 默认 `[]`）本项目已显式配置，无影响

## 3. 为什么不能卡死在 5.9

你的判断是对的——**不能因为一个技术选型永远锁死版本**。卡死的代价会累积：

1. **性能差距持续扩大**：5.9 是纯 JS 编译器，TS7 的 8–12x 提速是实打实的，且随代码库增长差距更大
2. **生态逐渐落后**：新语法、`lib.d.ts` 更新（DOM/`ArrayBuffer` 类型修正等）只进新版本
3. **维护与安全**：旧版本不再获得修复

而"解锁"的关键**不是升级本身，而是解除「运行时依赖整个编译器」这个耦合**。一旦预览功能不再依赖 TS 编译器 API，`typescript` 就回归"纯 devDependency 构建工具"角色，升级就变成改 tsconfig 的小事。

## 4. 关于"更高性能的解析方案"（实测）

你提到"parse 之类可以看现在是否有更高性能的技术方案"。我做了实测，结论值得注意：

**在 JS 生态内，TypeScript 的 `createSourceFile` 本身就是最快的解析器之一。** 实测对比（本机，vav 项目 node_modules）：

| 源码规模 | `@babel/parser` | TS `createSourceFile` | 倍率 |
|----------|-----------------|----------------------|------|
| ~11 KB（50行） | 1.027 ms | 0.609 ms | TS 快 1.7x |
| ~45 KB（200行） | 4.336 ms | 2.459 ms | TS 快 1.8x |
| ~226 KB（1000行） | 27.056 ms | 14.955 ms | TS 快 1.8x |
| ~1054 KB | 83.399 ms | 59.734 ms | TS 快 1.4x |

**所以"换个更快的 JS 解析器"这个方向不成立**——`@babel/parser` 反而更慢。TS7 的 8–12x 提速来自 **Go 原生重写 + 多核并行**，不在 JS 解析器维度。

这意味着：如果目标是"预览解析更快"，JS 生态内没有比 TS `createSourceFile` 更快的现成方案。真正的性能红利在 TS7 的**构建/类型检查**（`tsc`），而那是编译期，与预览功能无关。

## 5. 可选路径（技术方案）

### 路径 A：npm alias 双版本（官方推荐，改动最小，推荐优先评估）

官方为"7.0 无 API"提供了明确过渡方案：**同时装 7.0（原生 `tsc`）和 6.0（`tsc6`，保留 JS API）**。

```json
{
  "devDependencies": {
    "@typescript/native": "npm:typescript@^7.0.2",
    "typescript": "npm:@typescript/typescript6@^6.0.2"
  }
}
```

- 构建/类型检查用 7.0 的 `tsc` → **享受 8–12x 提速**
- 预览功能继续用 6.0 的 JS API → **功能不破坏**
- 改动：tsconfig 去 `baseUrl` + CSS 声明 + 改 `typecheck` 脚本指向 `@typescript/native` 的 tsc
- 风险：低。6.0 是最后的 JS 版，API 与 5.9 兼容，`parseTsCodeBlocks` 无需改动

**这是"先解锁版本"成本最低的路径**，但仍是双版本并存，预览功能仍依赖 6.0。

### 路径 B：重构预览功能，解除运行时依赖（根治，后续彻底自由）

把 `parseTsCodeBlocks` 从"import 整个 typescript"改为**独立轻量解析库**。候选：

| 方案 | 说明 | 备注 |
|------|------|------|
| `@babel/parser` | 已在项目里（vite 生态间接依赖 7.29.7），`@babel/types`/`@babel/traverse` 齐全 | **零新增依赖**，但实测比 TS 慢 ~1.8x |
| `acorn` | 轻量、快 | 需新增依赖，AST 结构较底层，改写量大 |
| TS7.1 新 API | 官方即将提供 | 未发布，不可依赖 |

- 需把 `ts.is*` 系列 + `forEachChild` + 位置切片逻辑映射到 babel AST（`babel.types.isIfStatement`、`t.isBlockStatement` 等）
- 预览功能独立后，`typescript` 移回 `devDependencies`，版本彻底自由
- 代价：预览解析慢 ~1.8x（毫秒级，对 UI 无感），需一次性改写 ~200 行逻辑

### 路径 C：先升 6.0，暂不动（最保守）

- 6.0 保留 JS API，`parseTsCodeBlocks` 不破坏
- 但 6.0 仍是 JS 编译器，**性能无提升**，只是为 7.0 铺路
- 收益有限，不建议单独作为终点

## 6. 建议

**短期（解除版本锁死 + 拿性能）**：走 **路径 A**（npm alias 双版本）。改动小、风险低、立即拿到 TS7 构建提速，同时预览功能用 6.0 不受影响。

**中长期（根治耦合）**：在路径 A 稳定后，评估 **路径 B** 把预览功能用 `@babel/parser` 独立出来（零新增依赖）。届时 `typescript` 回归纯 devDependency，7.1 新 API 落地后可以平滑迁移，彻底告别"版本锁死"。

> 注意：路径 B 的"性能"预期要摆正——JS 生态内没有比 TS `createSourceFile` 更快的解析器，重构换来的是**解耦与版本自由**，而非解析速度提升。

## 7. 待办清单（若批准执行）

- [ ] 路径 A：修改 `package.json` 加 `@typescript/native` + `typescript6` alias
- [ ] 路径 A：两个 tsconfig 删除 `baseUrl`，`paths` 加 `./` 前缀
- [ ] 路径 A：`main.tsx` 加 CSS 模块声明（或 `// @ts-expect-error`）
- [ ] 路径 A：`typecheck` 脚本改用 7.0 的 tsc，验证 `tsc --noEmit` 全绿
- [ ] 路径 B（后续）：改写 `parseTsCodeBlocks.ts` 用 `@babel/parser`，`typescript` 移回 devDependencies
