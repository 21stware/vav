# @21stware/handymd

Bear 风格的**源码保真** Markdown 编辑器 SDK，基于 [ProseMirror](https://prosemirror.net)，工具链基于 [Bun](https://bun.sh)。

核心理念：**文档即 Markdown 源码 + 按光标位置选择性隐藏标记符**。没有富文本模型 —— 语义只存在于 decoration 层；每个元素在 `Concealed` / `Revealed` 之间由 selection 纯函数推导，不为元素存状态对象。

**在线试写 / 文档：** https://21stware.github.io/handymd/

## 安装

```bash
bun add @21stware/handymd
# 可选：代码高亮
bun add shiki
```

## 快速开始

```ts
import { createEditor, createShikiHighlighter } from '@21stware/handymd'
import '@21stware/handymd/style.css'

const editor = createEditor({
  mount: document.getElementById('editor')!,
  load: () => fetch('/api/note/42').then((r) => r.text()),
  save: (markdown) => fetch('/api/note/42', { method: 'PUT', body: markdown }),
  autosave: { debounceMs: 800 },
  highlight: createShikiHighlighter({ theme: 'github-light' }), // 可选
  onPhaseChange: (phase) => console.log('L1:', phase),
  onSaveStatusChange: (status) => console.log('L4:', status),
})

editor.getMarkdown()
editor.setMarkdown('# 新内容')
editor.setReadOnly(true)
await editor.flush()
await editor.destroy()
```

更完整的用法见 `docs/`：

| 文档 | 内容 |
|---|---|
| [docs/guide.md](./docs/guide.md) | 安装、接入、主题、快捷键、协同冲突、常见场景 |
| [docs/api.md](./docs/api.md) | 完整 API 参考 |
| [docs/architecture.md](./docs/architecture.md) | 四层状态机与 ProseMirror 映射 |

## 手感一览

**行内（conceal ⇄ reveal）**

- `**bold**` / `*em*` / `` `code` `` / `~~strike~~` / `==mark==` / 链接 / 图片
- 扩一格判定：光标停在紧邻外侧即 Reveal
- 嵌套强调：`*outer **inner**.*` 两层都生效
- Concealed 链接单击打开；Cmd/Ctrl+点击进入编辑
- IME composition 期间冻结状态迁移

**块级（permanent：一旦渲染不回源码）**

- `- ` → bullet，`- [ ] ` / `- [x] ` → checkbox，`> ` → 引用，`---` → 分隔线
- 标题：源码 `#`/`##` 永远隐藏；**聚焦时**左侧 gutter 出层级图标
- 行首 Backspace 去掉格式；空前缀行再 Enter 退出块

**其它**

- 序列化免费（`doc` 本身就是源码），roundtrip 无损
- 可选 shiki 代码高亮（peer dependency，动态 import）
- 防抖自动保存 + 指数退避 + 冲突提示

## 开发

```bash
bun install
bun test                 # 单元测试（happy-dom）
bun run typecheck
bun run build            # dist/（ESM + d.ts + style.css）
```

## License

MIT
