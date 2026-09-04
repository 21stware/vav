# Chrome 扩展：把 VAV 能力发到浏览器的潜力与成本

评估对象：把 VAV 的自定义模型、以及「跟本机 `vavd` 通信并使用 agent」做成 Chrome 扩展，值不值得做、做成什么样、贵在哪里。

产品行为的权威来源仍是 `.agents/specs/`。本文只谈发布形态、协议边界和工程成本，不改产品语义。

## 0. 结论

**值得做，但不要把桌面端搬进 Chrome。** 扩展的正确身份是第三种薄客户端（iOS / 桌面 remote 窗口之后），不是第二个 Electron。

| 问题 | 答案 |
| --- | --- |
| 自定义模型能不能在扩展里用？ | 能。MV3 service worker 配 `host_permissions` 可以直连供应商 API，不受页面 CORS 限制。密钥只能放 `chrome.storage`，弱于桌面 Keychain。 |
| 扩展能不能直接跟本机 `vavd` 说话？ | 不能。`vavd` 是裸 TCP JSON-lines，浏览器没有任意 TCP。必须加一层 WebSocket / HTTP 网关，或走 Native Messaging。 |
| 扩展能不能「用上 agent」？ | 能，但 **agent 循环不能跑在扩展进程里**。今天桌面 → `vavd` 的拓扑已经写死：回合在控制端，工具在 `vavd`。扩展要么挂到正在跑的桌面 VAV（iOS 同构），要么把 `vavd` 升级成真正的 agent 宿主。 |
| 最高性价比的第一刀？ | **Side panel 薄客户端 → 本机桌面 VAV**。自定义模型和 agent 都已经在桌面就绪；扩展只多出浏览器独有的页面上下文。 |
| 明确不要做的？ | 把 `AgentRuntime` + PTY + 文件树整包塞进 MV3；把扩展做成又一个 ChatGPT wrapper。 |

成本按「要动哪些子系统、侵入多深」计，不按日历估。下文四条路径里，**路径 A 是推荐起步**；路径 C 是「只要 `vavd`、不要桌面」时才该付的账。

---

## 1. 今天的能力其实在哪

VAV 把特权和 UI 拆得很干净。扩展能复用什么、必须重写什么，都由这张分层决定。

```
┌─ main / vavd (Node) ─────────────────────────────────┐
│ 密钥  模型探测  AgentRuntime  sticky shell  fs / pty   │
└────────────────────────┬─────────────────────────────┘
                         │  IPC 或 远程帧
┌────────────────────────▼─────────────────────────────┐
│ renderer / iOS / （未来的扩展）                         │
│ 会话列表  transcript  composer  模型选择器  审批卡片     │
└──────────────────────────────────────────────────────┘
```

规模对照（约数，含测试）：

| 层 | 规模 | 扩展能直接搬吗 |
| --- | --- | --- |
| renderer | ~74k LOC | 不能整包。Side panel 装不下文件预览 / Office / Swarm / PTY |
| main | ~74k LOC | 不能。Node、`node-pty`、`safeStorage`、DuckDB |
| shared 协议 | `remoteControl.ts` ~800、`daemonProtocol.ts` ~430 | **能**。纯 TS，iOS 已经镜像过一遍 |
| iOS 薄客户端 | ~4k Swift | 这是扩展 UI 的真实参照，不是桌面 |

`remoteHostKind.ts` 里各端的能力矩阵：

| 端 | control plane | workspace host | 本机跑 agent | 持有密钥 |
| --- | --- | --- | --- | --- |
| iOS | 是 | 否 | 否 | 否（在电脑上） |
| 桌面控制端 → 另一台桌面 | 是 | 是 | 否 | 否 |
| 桌面控制端 → vavd | **否** | 是 | **是** | **是** |
| 桌面受控端 | 是 | 是 | 是 | 是 |
| vavd | **否** | 是 | **否** | **否** |

两层协议共用配对密钥，用 `hello.role` 分流：

```
phone / 桌面控制 UI  ── hello.role=phone  ──► RemoteControlHub   会话 / 回合 / configure
桌面 / vavd         ── hello.role=daemon ──► DaemonServer       fs / spawn / pty
```

关键事实：

1. **`vavd` 拒绝 phone-role。** 没有 `RemoteControlHub`、没有 `AgentRuntime`、没有密钥。它对扩展来说只是一台远程 syscall 机器。
2. **桌面配对 `vavd` 时，agent 跑在桌面上。** 工具（`terminal` / `fs_*`）经 daemon RPC 打到 `vavd`；DuckDB / `web_search` / 检索仍留在控制端。
3. **回合只在持有会话的那台机器上跑。** 把会话拷到扩展再本地跑一轮，受控端 UI 会变黑——这是 `TECH_DESIGN.md` §15 明确禁止的。
4. Phone 协议没有 regenerate / edit / fork / compact，也没有附件、PTY、spawn、读文件、密钥（`REMOTE_PHONE_CAPABILITIES`）。

扩展如果自称「VAV」，必须遵守这套所有权，而不是另起一套会话。

---

## 2. Chrome 平台会挡什么

这些是硬限制，不是口味。

### 2.1 浏览器连不上今天的 `vavd`

传输是 **裸 TCP 上的换行 JSON**，不是 WebSocket，不是 HTTP。无 TLS。默认口：

| 通道 | 端口 | 谁在听 |
| --- | --- | --- |
| daemon | 4750 | `vavd` / 桌面「允许其他设备」 |
| LAN 宣告 | UDP 4751 | 组播，不含密钥 |
| phone / tailcat 回环 | 4747 | 仅桌面 |

扩展的 content script / service worker / offscreen document 都没有任意 TCP。可行桥只有两条：

| 桥 | 优点 | 代价 |
| --- | --- | --- |
| **给 `vavd` / 桌面加 WebSocket（或 HTTP+SSE）网关** | 扩展用标准 `WebSocket`；大帧不受 Native Messaging 上限；以后 Web / 扩展 / 测试共用 | 要改宿主；Chrome 147+ 的 Local Network Access 要处理 |
| **Native Messaging host** | Chrome 官方推荐的本机通道；不碰 LNA | 每 OS 一份宿主安装与清单；**host → 扩展单条消息上限 1 MB**（`vavd` 单帧上限是 8 MB）；等于再发一份本机二进制 |

**Native Messaging 的 1 MB 上限会撞上 daemon 协议。** `fs.readFile`、截图、大工具输出都可能超。要走这条路必须先把 daemon 帧改成分块，或把宿主做成「完整 DaemonClient + 自己切块」。WebSocket 网关没有这个坑。

### 2.2 Local Network Access（Chrome 147+）

从**公开网页**的 content script 去连 `ws://127.0.0.1` 会弹 LNA 权限，而且按站点弹。正确做法：

- 只在 **扩展自己的 service worker** 里连本机，声明 `host_permissions: ["http://127.0.0.1/*", "ws://127.0.0.1/*"]`（具体 scheme 以当年版本为准）
- 页面上下文用 `chrome.runtime.sendMessage` 回传到 SW，不要让每个 tab 自己开 socket
- 网关绑 `127.0.0.1`，不要绑 `0.0.0.0`（`vavd` 默认绑全接口是给 LAN 配对用的；给扩展的口必须 loopback）

### 2.3 MV3 service worker 养不住 agent 循环

SW 空闲约 30 秒会被杀。VAV 一个回合可以跨最多 12 次 LLM turn，还可能挂在 `ask_user_question` / `request` 上几分钟。

| 放哪 | 行不行 |
| --- | --- |
| Service worker 里跑 `runAgentLoopContinue` | 不行。杀进程 = 丢回合，协作式 cancel 也救不回来 |
| Offscreen document 保活 | 脆弱，商店政策在收紧 |
| 桌面 VAV / 升级后的 `vavd` / Native Host | 行。长循环留在 Node |

结论：扩展只做 UI 和页面采集；循环留在 Node。

### 2.4 扩展比普通网页多出来的，只有这些

- **`host_permissions` 下的跨域 `fetch`**：直连 Anthropic / OpenAI / 自建网关，无 CORS
- **当前标签**：选区、可读正文、截图、URL
- **Side panel**：浏览时始终在
- **没有**：任意 TCP、PTY、真实文件系统、Keychain、`child_process`、稳定的长循环

「自定义模型」正好落在第一项上。「跟 `vavd` 用 agent」落在它没有的那几项上，所以必须桥。

---

## 3. 自定义模型：潜力高，但扩展不该成为密钥的家

### 3.1 今天桌面怎么做

VAV 没有「用户手填模型 ID」的注册表。`settings.customModels` 是遗留字段，选择器不读它。实际模型是：

1. **Provider** = HTTP endpoint + API key（Settings → Agents → 命名厂商或「New custom provider」）
2. **目录** = 对该 endpoint 做一次 `/models` 探活（`vavModelProbe.ts`），缓存在 main 内存，30 分钟
3. **会话** = `conversation.model` + 创建时盖上的 `accountId`
4. **协议** = `detectProtocol(endpoint, modelId)` 猜 `anthropic` / `openai` / `google`，**没有手动覆盖开关**

支持的厂商目录：DeepSeek、OpenRouter、OpenAI、Anthropic、xAI、Google、Together、SiliconFlow、智谱、Kimi，外加 endpoint 为空的 Custom。线协议只有三条：`anthropic-messages`、`openai-completions`、`google-generative-ai`。Responses / Bedrock / Vertex / 原生 Ollama 都没接；Ollama 只有在它暴露 OpenAI 兼容 `/v1` 时才能用。

密钥在 Electron `safeStorage`（macOS 即 Keychain）里，renderer 只看到 `apiKeyPresent`。远程客户端（iOS）**从不持有密钥**，只收 `controls.models` 快照，用 `configure` 帧改当前会话的模型。

### 3.2 三种放法

| 放法 | 自定义模型谁来调 | 密钥在哪 | 和现有产品的吻合度 |
| --- | --- | --- | --- |
| **A. 薄客户端** | 桌面 / 未来的 vavd 宿主 | 宿主 Keychain / `~/.vavd` | 与 iOS 完全同构。扩展只画选择器 |
| **B. 扩展自己调供应商** | Service worker + `vavProtocol.ts` | `chrome.storage.local`（可选 session） | 能跑通 Chat；密钥安全降一档；和「local-first、密钥不上渲染层」冲突 |
| **C. 扩展调、工具走 vavd** | SW 里跑循环 | 扩展存储 | 拓扑上像「桌面 → vavd」，但循环在 SW 里，§2.3 否决 |

**推荐：自定义模型配置留在宿主，扩展只做 picker。**

理由：

- `configure` / `controls` 已经覆盖模型、thinking、审批、Fast、ACP mode。iOS `SessionDetailView` 就是现成交互。
- 用户在桌面加好 Custom endpoint 之后，扩展立刻能用，不用在扩展里再做一遍 Accounts。
- 扩展里存 key 会变成第二种 SecretStore，还要处理泄露、导出、多设备，和 `SECURITY.md` 的「reveal 必须走原生确认框」对不上。Chrome 没有等价物。

### 3.3 若坚持「扩展里直接配自定义模型」

可复用、纯 TS、不必 Node：

- `src/shared/vavProtocol.ts` — 协议推断、`baseUrlFor`
- `src/shared/llmVendors.ts` — 厂商目录
- `src/shared/vavModelList.ts` / `agentModels.ts` — 选择器逻辑
- `src/main/agent/vavModelProbe.ts` — 探活（fetch + 解析，可搬）

必须新写：

- 密钥 UX 与存储（降级）
- 把 `provider.ts` + pi-ai 打进 SW，或手写三条流式协议
- `modelMeta.ts` 依赖的 pi-ai 目录（现在只在 main）
- 私有网关的协议覆盖开关（桌面都还没有）

探活 + 协议层大约 1.2k LOC 可搬。真要在扩展里跑完整 VAV 循环，还要再带上 accounts、缓存、thinking 映射、图片附件，接近 main 里那 ~5k 的模型子系统，外加一个养不住的 SW。

**潜力判断：** 自定义模型本身不是扩展的差异化卖点——桌面已经做得完整。扩展的增量是「浏览时换模型、把当前页送给已经配好的模型」。密钥和探活继续放宿主，成本几乎为零。

---

## 4. 跟本机 `vavd` 通信并用 agent

### 4.1 今天桌面是怎么用 `vavd` 的

```
┌──────────── 桌面 VAV（控制端）────────────┐
│ AgentRuntime / CliAgentHost               │
│ SecretStore、Settings、conversations.json │
│ StickyShell ──process.spawn──► daemon RPC │
│ FileService ──fs.*──────────► daemon RPC  │
└──────────────────┬───────────────────────┘
                   │ TCP :4750  hello.role=daemon
┌──────────────────▼───────────────────────┐
│ vavd                                      │
│ DaemonServer: fs / process / pty          │
│ 无 agent、无密钥、无 control plane          │
└──────────────────────────────────────────┘
```

配对行：

```
vav-daemon://<secret>@192.168.1.5:4750?name=MyMachine&token=…
```

或 `host:port secret`。密钥 ≥16 字符。`SECURITY.md` 写明：**有效配对密钥 = 这台机器上的本地代码执行。**

`vavd` 还提供 loopback 管理口（`vavd clients | unpair | disconnect | rotate-offer`），与扩展无关。

### 4.2 扩展要「用 agent」，循环必须有一个 Node 家

| 循环放哪 | 要改什么 | 评价 |
| --- | --- | --- |
| **正在跑的桌面 VAV** | 桌面加 loopback WS，把现成 `RemoteControlHub` 暴露给扩展；扩展当 phone | 最低成本。自定义模型、CLI agent、审批、会话树全部现成。用户必须开着 VAV |
| **升级 `vavd` 成 agent 宿主** | `vavd` 增加 control plane、`AgentRuntime`、密钥、会话存储；改 `remoteHostKind`（今天 `localAgent: false`） | 「`npx vavd` + 扩展」才能成立。这是改 `vavd` 的产品定义，不是加个口 |
| **Native Messaging 宿主（迷你 main）** | 再发一份 Node 二进制：DaemonClient + AgentRuntime + SecretStore | `vavd` 不用改循环，但安装面 ≈ 再装一个 VAV；1 MB 消息上限要处理 |
| **扩展 SW** | 见 §2.3 | 否决 |

### 4.3 工具哪些过得来

`createTools()` 今天注册的工具：

| 工具 | 桌面 → vavd | 扩展薄客户端（经宿主） | 扩展自己跑 |
| --- | --- | --- | --- |
| `terminal` / `wait` / `read_bash_session` | 远程 sticky shell | 宿主执行，扩展只渲染卡片 | 不可能 |
| `fs_read` / `fs_write` / `fs_list` | daemon `fs.*` | 同上 | File System Access API，沙箱、要用户授权、不是项目树 |
| `request` / `ask_user_question` | 控制端挂 Promise | 扩展 UI 回 `reply`（phone 已有） | UI 可以，循环不能挂在 SW |
| `web_search` / `web_fetch` | 控制端本地 | 宿主 | SW 能做，但是另一套实现 |
| `doc_search` / `doc_fetch` / `sql_query` | DuckDB 在控制端 | 宿主 | 基本不能 |
| `load_skill` / `plan` / `switch_mode` | 控制端 | 宿主 | 要重做存储 |
| 用户 PTY 标签 | daemon `pty.*` | phone 协议明确关掉 | 不可能 |
| CLI agents（Claude Code / Codex / …） | 控制端 `proc.which` + 本地或远程 spawn | 只有宿主是桌面 / 升级后的 vavd 才有 | 不可能 |

扩展**多出来**、桌面和 iOS 都没有的：

- 当前标签选区 / Readability 正文 / 截图 → 当附件或 `web_fetch` 的本地等价物
- 填写表单、点按钮（那是另一款「浏览器 agent」产品，不是 VAV workbench）

Phone 协议现在 `attachments: false`。要把页面送进回合，宿主侧要先打开附件能力，或加一种「把这段文本当用户消息」的约定。这是路径 A 里唯一必须动协议的地方，比加新 `hello.role` 便宜。

### 4.4 不要给扩展发明 `hello.role=extension`

新 role 解决不了「谁跑循环、谁持有密钥」。

- 对着**桌面**：已有 `phone`，扩展就是 phone，外加可选的页面附件。
- 对着 **`vavd`**：要么继续当 daemon 客户端（循环在别处），要么让 `vavd` 接 `phone`（循环搬进 `vavd`）。没有第三种语义。

---

## 5. 四条路径：潜力 × 成本

成本用「新子系统 + 对现有协议/产品定义的侵入」衡量。潜力用「是否扩大 VAV 的工作台定位，而不是变成聊天包装」。

### 路径 A — 桌面的浏览器遥控器（推荐第一刀）

```
Side panel ──WS 127.0.0.1──► 桌面 RemoteControlHub (phone)
                                  │
                                  ├─ AgentRuntime / 自定义模型 / 密钥
                                  └─ 若已配对 vavd：工具仍打到 vavd
```

- **用户得到什么：** 浏览时开着 VAV 会话；换模型（桌面已配好的 Custom 也在内）；发选区 / 当前页；回审批和 ask。若桌面已经挂了 `vavd`，扩展间接用上那台机器的 agent 工具。
- **复用：** `remoteControl.ts`、`remoteControlSession.ts`、`applyRemoteServerMessage`；UI 按 iOS 的 Sessions / SessionDetail / 模型 picker 缩小重做。
- **要新写：**
  1. 桌面 loopback WebSocket（或 HTTP+SSE）适配现成 Hub。Hub 已是 Electron-free，只差一层传输。
  2. MV3 扩展：side panel + SW 连接 + 配对（贴桌面 QR / `vav-remote:` 行）+ 精简 transcript。
  3. 可选：打开 phone 附件，或「当前页 → 用户消息」约定。
- **侵入：** 低。不改 `vavd` 产品定义，不改 agent 所有权。
- **规模：** 扩展 UI 对标 iOS（~4k 量级的新代码，React 可抽 shared 投影）；桌面网关是小适配器，不是新协议。
- **潜力：** 中高。差异化是「工作台长在浏览旁边」，不是「又能聊模型」。依赖桌面开着——和 iOS 依赖电脑开着是同一笔交易，用户已经接受过。
- **风险：** LNA 配置；配对密钥出现在扩展存储里（只是 phone secret，不是 API key，但仍等于控制那台电脑的会话）。

### 路径 B — 扩展里只做自定义模型 Chat（不连 vavd）

- **用户得到什么：** Side panel 里用 DeepSeek / OpenRouter / 自建网关聊天，可带当前页。
- **成本：** 低。`vavProtocol` + 探活 + 三条流式 + 设置页。
- **潜力：** 低。和商店里几百个「自带 key 的 ChatGPT 扩展」同质。VAV 的卖点是「打开目录、看着它改、旁边有真终端」，这里一样都没有。
- **何时做：** 只作为路径 A 的离线降级（桌面没开时仍能问当前页），不要当主产品。

### 路径 C — `npx vavd` + 扩展，不要桌面（「只要 daemon 就能用 agent」）

这是题目里「和 local vavd 通信使用 agent」的字面满足，也是最贵的一条。

必须同时做三件事：

1. **`vavd` 接 control plane。** 今天 phone hello 回 `control plane not available`。要把 `RemoteControlHub` 嵌进去，会话 / send / turn / configure 才有家。
2. **`vavd` 跑 `AgentRuntime` 并持有密钥。** 改 `remoteHostKind`：`headless-daemon` 从 `{ localAgent: false, holdsSecrets: false }` 变成宿主。`~/.vavd` 要长出 SecretStore、accounts、conversations、模型探活缓存。CLI agent（`proc.which` + spawn）也只有在这一步之后才对扩展有意义。
3. **浏览器桥。** 给 `vavd` 加 loopback WebSocket（推荐），不要 Native Messaging 当主通道。

这等于把 `vavd` 从「工作区宿主」提升成「无头 VAV 服务器」。收益是真实的：扩展、未来的 Web UI、甚至 iOS 都可以不经过桌面打到一台 headless 机器。代价也是真实的：

- 产品定义变更，所有「回合在哪台机器」的测试和文档（`TECH_DESIGN.md` §15、`remoteHostKind`、e2e `remote-daemon.spec.ts`）要重写
- `vavd` 包体积和依赖暴涨（pi-ai、密钥、会话树、工具、DuckDB……），和现在「Node 22 + node-pty」的安装故事冲突
- 桌面 → `vavd` 今天是「控制端跑 agent」。升级后要决定：旧拓扑是否保留、两台桌面互控是否仍由受控端跑回合

**不要**用「Native Host 里再塞一个 AgentRuntime」来回避这次升级——那是路径 D，安装面更差。

- **潜力：** 高（若战略是「VAV = 协议 + 多种壳」）。
- **成本：** 高。接近再做一个 headless main，外加扩展壳。
- **建议：** 只有在路径 A 验证了「浏览器壳有人用」，并且明确要卖「无桌面远程」时再做。

### 路径 D — Native Messaging 迷你 main + 现状 `vavd`

拓扑上复制「桌面 → vavd」：宿主跑循环和密钥，`vavd` 只做 fs/pty。

- **看起来省：** `vavd` 不用升级。
- **其实不省：** 要打包、签名、按 OS 注册 Native Host；Chrome 扩展 ID 写进 `allowed_origins`；自动更新是两份工件；1 MB 消息上限。用户心智是「装扩展还要再装一个后台」。
- **潜力：** 中。对已经会 `npx @21stware/vavd` 的人重复。
- **建议：** 不作为主路径。最多当 WebSocket 网关还没就绪时的工程脚手架。

---

## 6. 建议怎么切

```
第一刀   路径 A：扩展 = phone 客户端 + 页面上下文
              自定义模型：只做 picker（configure 帧）
              agent：桌面跑；若桌面已挂 vavd，工具自然打过去
              协议：loopback WS；附件或「当前页当消息」

第二刀   只在 A 证明有使用后再评估路径 C
              vavd 升级为 agent 宿主 + 同一套 WS
              扩展几乎不用改（还是 phone）

明确不做  路径 B 当主产品
              路径 D 当发布形态
              新 hello.role
              在 SW 里跑 AgentRuntime
              把 renderer 的文件预览 / Swarm / PTY 搬进 side panel
```

第一刀里和「自定义模型 / vavd / agent」直接对应的交付：

1. **自定义模型** — 零新协议。宿主 `controls.models` 已经包含 Custom 探活出来的 id。扩展画现有 picker。
2. **vavd** — 第一刀不直连 `vavd`。用户在桌面 Settings 里配对 `vavd`；扩展连桌面。这是今天唯一不破坏所有权的接法。
3. **agent** — 扩展发 `send` / `cancel` / `reply`；`turn` 帧回流。工具卡片只渲染，不执行。

若第一刀的验收标准写成「扩展必须自己 TCP 到 4750」，会把项目直接推进路径 C/D，成本跳一档。

---

## 7. 商店、安全、许可

- **配对密钥 = RCE。** 扩展存储里的 secret 必须当密码：不打日志、不进崩溃报告、卸载时清。Loopback 网关只接受已配对 hello，绑 `127.0.0.1`。
- **权限要窄。** 不要 `<all_urls>` 除非做页面采集。采集用 optional host permissions，按站点要。商店对「能读所有页 + 连本机」的扩展审得更紧。
- **Native Messaging** 要在商店说明里写清「会启动本机程序、该程序能执行代码」。WebSocket-to-desktop 同样要写清。
- **单用途。** 商店政策要求扩展目的单一。定位写成「VAV 的浏览器控制面」，不要同时做广告拦截和通用 scraping。
- **PolyForm Noncommercial。** 21stware 自己发扩展没有许可问题；若源码进同一仓库，第三方不能把扩展当商业产品再分发。和桌面同一套。
- **密钥。** 路径 A/C 下 API key 不到扩展。路径 B 必须在设置里写明：Chrome 存储不是 Keychain。

---

## 8. 和现有代码的对接面（若开做）

第一刀最小改动面：

| 位置 | 做什么 |
| --- | --- |
| `src/main/remote/RemoteControlHub.ts` | 已 Electron-free，保持 |
| `src/main/remote/RemoteControlService.ts` | 在 127.0.0.1 加 WS 适配器，复用同一套 adopt / fan-out |
| `src/shared/remoteControl.ts` | 可选：附件，或 `send` 带 `pageContext` |
| `src/shared/remoteControlSession.ts` | 扩展直接复用 reducer |
| `src/shared/remoteHostKind.ts` | 第一刀不改；路径 C 才改 `headless-daemon` |
| `src/main/daemon/*` | 第一刀不改 |
| 新目录 `extension/` | MV3：manifest、SW、side panel、配对 |

路径 C 额外：

| 位置 | 做什么 |
| --- | --- |
| `vavd.ts` / `DaemonServer.ts` | 接 `onControlHello`；默认仍可关 |
| `~/.vavd` | 密钥、accounts、conversations |
| `AgentRuntime` + tools | 链到 `createLocalWorkspaceHost()` |
| `packages/vavd` | 依赖和安装故事重写 |
| e2e `remote-daemon.spec.ts` | 补「phone → vavd」而不再断言拒绝 |

---

## 9. 一句话对照

| 能力 | 第一刀（A） | 扩展直连现状 vavd | 升级 vavd 后（C） |
| --- | --- | --- | --- |
| 用桌面已配的自定义模型 | 有 | 无（vavd 无密钥、无循环） | 有（密钥改到 `~/.vavd`） |
| 在扩展里新加 Custom endpoint | 不做（避免第二套密钥） | — | 可做设置页，仍存宿主 |
| 发消息、看流式、回 ask | 有 | 无（phone 被拒） | 有 |
| 工具改 `vavd` 那台机器的盘 / shell | 有（经桌面） | 无循环则无工具 | 有（vavd 自己跑） |
| 不打开桌面 | 无 | 无 | 有 |
| 当前页 / 选区进回合 | 第一刀的真正增量 | — | 同样带上 |

**潜力：** 作为「工作台的浏览器壳」是中高；作为「又一个自定义模型聊天框」是低。  
**成本：** 薄客户端 + loopback 桥是可控的、和 iOS 同构的一刀；「扩展 ↔ vavd ↔ 完整 agent」是把 `vavd` 升级成无头服务器，不该和第一刀绑在一起做。
