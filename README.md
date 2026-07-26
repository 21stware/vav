<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.png">
  <img src="docs/wordmark.png" alt="vav" height="54">
</picture>

本机 AI 编程代理工作台。一个窗口里放三样东西：对话、这次对话真正在操作的文件树、以及一个真实的终端。

Agent 不是在描述它做了什么 —— 你在右边直接看着它 `cd`、跑测试、写文件。所有数据留在本机，除了发往你自己配置的模型接口的请求。

![vav](docs/screenshot.png)

## 特性

- **流式对话**，带思考过程折叠、工具调用卡片、可展开的命令输出
- **五个工具**：`terminal`、`fs_read`、`fs_write`、`fs_list`，以及会真正停下来等你回答的 `ask_user_question` / `request`
- **粘性 shell**：agent 的每条命令跑在同一个长活 shell 里，`cd` 和 `export` 会保留下来
- **真实 PTY 标签页**：node-pty + xterm.js，`top` 和 `vim` 都能用；agent 第一次执行命令时会按需开出它自己的 bash session（只读镜像）
- **文件树**：按需展开、agent 变更高亮、空格键 Quick Look
- **每会话工作目录**，默认是一个临时工作区，可随时指到真实项目
- **Anthropic 与 OpenAI 兼容接口**都支持，endpoint 可自定义
- API Key 经 `safeStorage`（Keychain）加密存储，不落明文

## 安装

到 [Releases](https://github.com/21stware/vav/releases) 取对应平台的包。两个构建都没有代码签名，第一次打开都会被系统拦一下：

- **macOS（Apple 芯片）** — 拖进「应用程序」后执行一次
  `xattr -dr com.apple.quarantine /Applications/vav.app`，否则 Gatekeeper 会说文件已损坏。
- **Windows（x64）** — SmartScreen 会警告，选「更多信息」→「仍要运行」。

## 运行

需要 Node 20+，macOS 或 Windows。

```bash
npm install
npm run dev
```

打包（原生模块决定了只能在目标平台上打目标平台的包）：

```bash
npm run dist        # macOS → release/vav-1.0.0-macos-arm64.dmg
npm run dist:win    # Windows → release/vav-1.0.0-windows-x64-setup.exe
```

首次启动会提示配置 API Key（⌘, / Ctrl+, 打开设置）。在配置之前文件树和终端已经可用，只有发送 Agent 回合需要密钥。

## 快捷键

macOS 用 ⌘，Windows 用 Ctrl；界面里的提示会自己换写法。

| 操作 | 键 |
| --- | --- |
| 新建对话 | ⌘N |
| 发送 | ⌘↩ |
| 取消当前回合 | Esc |
| 会话内搜索 | ⌘F |
| 新建终端标签 | ⌘T |
| 切换侧栏 / 工具面板 | ⌘⇧H / ⌘⇧E |
| 设置 | ⌘, |

全局唤起热键可在「外观」里录制，默认关闭。

## 平台差异

绝大多数东西两边一样，剩下这几处是系统本身不同，不是没做完：

| | macOS | Windows |
| --- | --- | --- |
| Agent 与终端的 shell | zsh / bash / fish | PowerShell |
| 关闭主窗口 | 只隐藏，回合与 PTY 继续跑，Dock 图标唤回 | 真的关闭并退出（没有 Dock 可以唤回） |
| 文件树按空格 | Quick Look 预览 | 用系统默认程序打开 |
| 全局热键默认 | ⌃⌘Space | Ctrl+Alt+Space |

## 项目结构

```
src/
  shared/      领域类型与 IPC 契约
  main/
    store/     设置、密钥、会话持久化
    agent/     LLM 客户端、工具定义、回合循环
    terminal/  粘性 shell、PTY 管理
    fs/        文件枚举与监听
  preload/     contextBridge 暴露的 window.vav
  renderer/    React UI、zustand store、流式投影
```

实现取向与权衡见 [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)。产品行为的规格用 RPML 写在 Origin 里，由 `.agents/skills/origin-product-spec-management` 拉到 `.agents/specs/`（未入库）。

## License

MIT
