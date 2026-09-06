# vav — 技术设计

vav 是一个本机 AI 编程代理桌面应用：一侧是会话，另一侧是这次会话真正在操作的文件树与终端。Agent 不描述它做了什么，你直接看到它做了什么。

本文件描述实现取向与关键权衡。产品行为的唯一事实来源是 `.agents/specs/` 下的 RPML；本文只解释「为什么这样落地」。

## 1. 进程与信任边界

```
┌─ main (Node) ───────────────────────────────┐
│ SettingsStore  SecretStore  ConversationStore│  磁盘、密钥
│ pi-ai / pi-agent-core  AgentRuntime  tools    │  网络、回合循环
│ StickyShell    PtyManager    FileService      │  子进程、文件系统
└───────────────┬─────────────────────────────┘
        IPC（contextBridge，channel 白名单）
┌───────────────┴─────────────────────────────┐
│ preload: window.vav = VavApi                 │
├──────────────────────────────────────────────┤
│ renderer (React)                             │
│ sessionStore / workspaceStore / StreamProjection │
└──────────────────────────────────────────────┘
```

所有特权能力都留在 main。renderer 里 `nodeIntegration: false`、`contextIsolation: true`，只能看到 `src/shared/ipc.ts` 里显式列出的通道。这条边界不是形式主义：agent 会执行任意 shell 命令，把执行面收在 main 里意味着渲染层被 XSS（例如模型输出里的恶意 HTML）攻破时，攻击者拿到的仍然只是那份白名单。

renderer 的 CSP 禁止 `unsafe-eval` 与外部源；markdown 渲染走 markdown-it 的 `html: false`，模型输出永远不会变成 DOM 标签。

## 2. 一次回合是怎么跑完的

回合循环本身来自 [`earendil-works/pi`](https://github.com/earendil-works/pi)：`@earendil-works/pi-ai` 负责 provider 协议与流式事件，`@earendil-works/pi-agent-core` 的 `runAgentLoopContinue` 负责「补全 → 工具 → 再补全」这个循环本身。`AgentRuntime` 退化成两件事：把 vav 的存储形态翻译成 pi 的消息类型，以及把 pi 的事件投影成 renderer 订阅的那个流。翻译时图片附件会按模型的模态声明内联为 `ImageContent`（`attachmentImages.ts` 预读、`buildHistory` 组装，最新优先、有数量与字节上限），纯文本模型继续走路径行。

```
thread path ──► pi Message[] ──► runAgentLoopContinue
                                       │
      message_update(contentIndex) ────┴─► 32ms 合批 ──► turn:delta{index} ──► renderer
                                       │
                                 stop_reason=toolUse
                                       │
                             ┌─────────┴─────────┐
                        非交互工具            交互工具
                 terminal/fs_read/fs_write   request / ask_user_question
                 /fs_list 直接执行            挂起 Promise，等 renderer 回答
                             └─────────┬─────────┘
                                 toolResult 回到循环
```

选 pi 而不是继续手写 SSE，直接的收益是**消息顺序**。之前 text delta 边流边追加、tool_use 块要等整段流完才 push，于是模型发出的 `文字 → 工具 → 文字 → 工具` 会渲染成「所有文字挤在一起，两张卡片吊在后面」。pi 的流协议里每个增量事件都带 `contentIndex`，指向同一个有序 `content[]`；顺序是协议保证的，不是拼装时猜的。

`contentIndex` 每个 LLM turn 从 0 重新开始，而 vav 的一个回合最多跨 `MAX_ITERATIONS = 12` 个 LLM turn，所以 `AgentRuntime.slotFor` 用 `(llmTurn, contentIndex)` 这个组合键映射到全局块位置；`turn:delta` 和 `turn:tool` 都带上这个位置，renderer 的 `StreamProjection` 按下标落座而不是往尾巴上追加。

pi 的内置工具（bash/read/write/edit）没有采用：vav 的 `terminal` 要写进会话的 sticky shell，`request` / `ask_user_question` 要把回合挂在一个 Promise 上等用户，这两点都是产品决定，pi 的 `bash` 会把它们抹掉。工具因此仍然是 vav 自己的，只是换成 pi 的 `AgentTool` 形状注册进去。

几个刻意的选择：

**并发按会话隔离。** `turns: Map<conversationId, TurnState>`。切换会话不会打断正在跑的回合，两个会话可以同时跑；同一会话第二次 send 会被拒绝而不是排队，因为「排队」在 UI 上无法诚实表达。

**只在两个点落盘。** 工具边界与回合结束。中途每个 token 都写盘会让 `conversations.json` 变成写放大源；只在这两处 `persistPartial`，意味着崩溃最多丢失最后一段未完成的文本，而工具已产生的副作用（文件、命令）总是有对应记录。

**取消是协作式的。** `AbortController` 传给 pi 的循环，同时挂在 sticky shell 上。还有一处必须手动兜住：挂在 `ask_user_question` 上的回合停在一个 Promise 里，abort signal 到不了它，所以 `cancel()` 要显式 resolve 那个 pending，否则循环永远醒不过来。取消后仍然 seal 已收内容并提交为一条 `cancelled` 消息 —— 用户需要看到「跑到哪儿被停的」，而不是内容凭空消失。

**工具失败分两种。** 命令退出码非零、文件不存在，这些是模型必须看到的正常结果，不是异常；工具照常返回，只在 `details.failed` 上打标，由 `afterToolCall` 抬成 pi 的 `isError`。`details` 同时承载给人看的完整输出，`content` 承载给模型看的截断版本 —— 卡片和上下文本来就不该是同一份文本。

**交互工具会过期。** 如果一个回合挂在 `ask_user_question` 上而 app 退出，重启后那个 ToolCallBlock 被标成 `expired` 而不是永远 pending。悬而未决的 UI 比明确的失败更糟。

## 3. 会话是一棵树，不是一条列表

「重新生成」如果只是再追加一条助手消息，就等于告诉用户「刚才那条也还算数」——于是同一个问题下面越堆越多，而其中只有一条是你要的。真实的语义是：这是同一个位置上的另一个版本。

所以 `ChatMessage` 带 `parentId`，`Conversation` 带 `activeLeafId`。存的是全部节点，看到的是从根到 `activeLeafId` 的那一条路径（`shared/thread.ts`，main 与 renderer 共用同一份纯函数，两边推导出的 transcript 必然一致）。

四个操作因此变成同一件事的四种参数：

| 操作 | 新节点的 parent | 效果 |
| --- | --- | --- |
| 发送 | 当前 leaf | 往下长一层 |
| 重新生成（助手消息） | 该消息的 parent | 与它并列的另一个回答 |
| 编辑提问（用户消息） | 该提问的 parent | 与它并列的另一个提问，各自带自己的下文 |
| Fork | 不落盘，只把 leaf 移到分叉点 | 下一句话自然成为并列的一支 |

**分支导航挂在分叉点上，不挂在分支自己身上。** `‹ 2/2 ›` 显示的是「这个位置往下有几条路、现在走的是第几条」，所以它属于那条路的起点——重新生成时是上面那条提问，fork 助手消息时是那条助手消息。分支自己身上没地方挂：刚 fork 出来的那一支还是空的。

空分支因此要单独表示。`branchPoints()` 在 leaf 恰好停在分叉点上时，往 `targets` 末尾补一个「还没说话的分支」，用起点自己的 id 命名（根前面的位置用 `ROOT_LEAF`）。没有这一格，fork 完看起来就像把原来的回答删了。反过来，一旦从这一格走开，它就消失了——一条空分支没有什么可以回去的。

切换分支走 `conv:select-branch`（移到选中节点再沿最新分支下探到叶子）；切到空的那一格走 `conv:set-leaf`，因为下探恰好会走回用户想离开的那一支。

**Continue in new session** 是另一回事：它不开分支，而是把当前路径截到某条消息为止、深拷成一个新的 conversation（新 id、新消息 id，继承工作目录与模型，token 用量按截断比例带过去）。分支是「同一个会话里的两种可能」，新会话是「从这里另起一段，原来的别再动它」——终端和文件树都重开。

**模型只看见一条分支。** `buildApiHistory(conversation, leafId)` 显式接收本回合的 parent，而不是读 store 里的当前 leaf——否则重新生成时会把正在被替换的那条回答喂回去。其它版本是给读者看的，不进上下文。

**用户消息不再做乐观回显。** 树需要真实的 id 和 parent，本地先造一条 `local-*` 再对账只会引入一类不必要的分歧。主进程落盘后立刻发 `turn:user` 事件，renderer 等这一跳（一次 IPC 往返，肉眼看不出来）。

旧数据在 `ConversationStore.load()` 里补齐：没有 `parentId` 的消息按原顺序串成一条链，leaf 指向末尾——线性会话本来就是只有一条路径的树。

## 4. 流式渲染：为什么不是「setState per token」

每秒几十个 token，每个都触发一次 React 树更新，会在长会话里直接卡死。三层缓解：

1. **main 侧 32ms 合批** —— delta 先按块位置进 buffer，定时按位置升序 flush 成一批 `turn:delta`。
2. **StreamProjection** —— renderer 里一个独立于 React 的对象持有在途回合，以 `TICK_MS` 节奏发布快照。它按事件带来的下标落座（稀疏数组，发布时跳过空洞），因为「先到的不一定排在前面」。只有 `StreamingMessage` 订阅它，已完成的消息完全不参与。
3. **MarkdownSegmenter** —— 把流式 markdown 切成「已封口的块」+「开放的尾巴」。封口块的 HTML 被缓存且永不重算，只有尾巴在每 tick 重新渲染。代码块尤其关键：一个 200 行的代码块在到达闭合 ``` 之前只是尾巴，之后就固化了。

已完成的 `MessageRow` 是 `memo` 的，且只在搜索打开时才拿到 `highlight` prop —— 平时流式过程中它们的 props 恒定，React 直接跳过。

## 5. 双轨终端

产品里有两种终端，它们的语义完全不同，所以实现也不共享。

**Agent sticky shell**（`StickyShell.ts`）：每个会话一个长活 shell 进程。Agent 的每次 `terminal` 调用不是 `spawn` 一个新进程，而是往这个 shell 里写一行命令，用标记协议框住：

```
<command>
printf '\n__VAV_END__%d__\n' $?
```

读到 `__VAV_END__<code>__` 就知道命令结束了、退出码是多少。代价是要处理标记被拆分到多个 chunk 的情况；收益是 `cd` 有效、`export` 有效、venv 有效 —— agent 的第 5 条命令能看到第 3 条命令建立的环境。这是「一次一个 `child_process.exec`」永远做不到的，而 agent 工作流严重依赖它。

sticky shell 失败时降级为一次性执行，功能退化但不中断。

**用户 PTY 标签**（`PtyManager.ts` + node-pty）：真正的伪终端，有 job control、有 `top`、有 vim。

agent 的 bash session 不是默认存在的标签，而是 agent 自己控制、按需出现的：第一条 `terminal` 工具调用触发 `ensureAgentTab`，标签才插进工具台，把 sticky shell 的命令与输出回放出来，让你看着它干活。在挂载之前到达的镜像输出存在 `pendingMirrors` 里，等视图出现再回放，所以晚建标签不丢内容。它没有自己的 PTY，只读。

`terminalRegistry.ts` 让 xterm 实例脱离 React 生命周期：切换标签、折叠面板、切换会话都不销毁终端。React 只负责把 `entry.container` append 到当前宿主 div，卸载时 detach 而不 dispose。

**CLI agent host 的 live persistence（对齐 Herdr）**

Herdr 的模型是「headless server 持有 pane 进程；client 只 attach/detach」。VAV 的 main 进程就是那个 server：

- 主 pane 用稳定 id `agent-host:<agentId>:<conversationId>`（`preferredId`），多窗口 `activate` 竞态走 attach 而不是再 spawn 一份 CLI。
- 分屏（⌘D / ⌘⇧D）不带 preferredId，每次新起 pane。
- 独立会话窗口打开时，主窗 soft-park xterm（`parkTerminal`：detach DOM、保留 buffer 与 live sink），关窗后 reclaim 秒画，再 `SIGWINCH` 对齐几何。
- `snapshotForReplay` 从 last clear / alt-screen 切一帧给冷 attach；新 viewer 挂上后 force resize，让 TUI 自己重绘。

node-pty 的 `spawn-helper` 在某些解包路径下会丢掉可执行位，导致每次 `pty.spawn` 都 `posix_spawnp failed`。`scripts/fix-pty-permissions.mjs` 在 postinstall 修回来。

## 6. 工作目录即会话

每个会话拥有一个真实目录。「临时工作区」不是「没有目录」，而是 `$TMPDIR/vav/<uuid>/Workspace` 的一个标签。这个不变式让下游全部简化：文件树永远有根、`fs_*` 工具永远能解析相对路径、终端永远有 cwd。旧数据在 `ConversationStore.load()` 里回填。

`FileService` 按需列目录（展开才读），跳过 `.git`/`node_modules`/`.DS_Store`，单层截断并显示「… N more」。`fs.watch` 带防抖，避免 `npm install` 期间的事件风暴打爆 IPC。

## 7. 密钥与设置

API Key 走 `safeStorage`（macOS 上即 Keychain 派生密钥）加密后落 `apikey.bin`，永不进入 `settings.json`，也永不发给 renderer —— renderer 只拿到 `apiKeyPresent: boolean` 与一个掩码提示。加密不可用时退化为仅内存保存，并在 UI 里说明。

其余设置是普通 JSON。写入时 clamp 到允许区间，因为设置文件是用户可编辑的，不能假设它合法。

设置是一个独立窗口，不是盖在会话上的 sheet —— 它常常要和会话对照着改（换模型、换工作目录、验证 key 之后马上再发一次），盖住主界面就没法对照。同一份 renderer bundle 由 `?view=settings` 分流，`main.tsx` 据此挂载 `SettingsWindow` 而不是 `App`。⌘, 直接由主进程的菜单项处理而不是转发给 renderer，这样无论焦点在哪个窗口都有效。

## 8. 一个会话可以自己占一个窗口

双击侧栏的行，那个会话就在自己的窗口里也打开一份：只有 transcript、工具台和输入框，没有侧栏——它已经不需要在会话之间导航了。同一个 conversationId 最多一个这样的窗口，再双击是把已有的窗口提到前面。⌘⇧↵ 是同一条路的快捷入口：新建一个临时工作区的会话，直接开在新窗口里，输入框已经聚焦。这一个由主进程的菜单项直接处理，因为它必须在没有侧栏的窗口里也能用。

窗口分流仍然是那份 bundle 加一个 query：`?view=session&conversationId=…`。

尺寸和落点是有意的：460×760，贴着屏幕工作区的右边缘往里 28px。独立会话是你在别的东西旁边用余光看着的，所以它按「陪衬的一列」而不是「第二个主窗口」来定，也不会正好盖住把它开出来的那扇窗。多开几个时按 26px 递进错开，否则它们会叠成一个。

**双击不动主窗口。** 侧栏的行还在原位、还是选中态，transcript 也不变——双击是「再开一扇窗看它」，不是「把它交出去」。这一条比看上去重要：如果主窗口跟着跳走，双击就同时做了两件事，而用户只要求了一件。代价是同一个会话可能同时显示在两个窗口里，这没问题，因为两边都只是同一份主进程状态的投影。

**主进程不能再只对着主窗口说话。** 原来的 `send()` 只发给 `mainWindow`，现在 turn / pty / 文件监听事件一律 broadcast——一个会话此刻在哪些窗口显示，主进程没有便宜的办法知道，而 renderer 本来就按 conversationId 分派。反过来，菜单命令发给**当前聚焦的**窗口，因为快捷键作用于用户正在看的东西。会话列表本身也变成 broadcast（`conv:changed`）：重命名、置顶、新建都可能发生在另一个窗口，谁都不能把自己那份当权威。

⌘⇧↵ 开出来的会话如果关窗时一句话都没说，就直接删掉。快捷键的用途是「随手问一句」，代价不该是侧栏里堆一排空壳。这条只对 ⌘⇧↵ 建的会话生效——手动建的空会话是用户自己留下的。

侧栏的排序是三层：置顶区（按 pinTime 降序）→ 今天 / 昨天 / 本周 / 更早（组内按 `updatedAt` 降序）。「本周」取的是滚动的七天而不是自然周：自然周在周一那天会是空的，两天前的会话掉进「更早」，看着像 bug。搜索时分组头和分隔线全部收起——过滤后的列表再按时间切段只是噪音，置顶仍然优先。置顶行的图标盖过 loader 和 help-circle：它排在最上面的原因是置顶，那才是需要解释的事。

## 9. 视觉语言

整套配色是从 logo 里取出来的，不是另起炉灶。手写体 wordmark 只有两个颜色：墨蓝 `#131b35` 和长春花紫 `#b2a5dc`。前者成了正文与结构色，后者成了唯一的强调色，底色是偏冷的纸白 `#fbfbfe`。

强调色只用在「这一屏里最该点的那个东西」上——发送按钮、当前会话、正在等你回答的卡片。别的地方一律靠层次而非颜色区分。`#b2a5dc` 本身太浅，做按钮填充与白字的对比度只有 2.2:1，所以拆成两个 token：`--accent` 是同色相加深后的 `#6b5bc0`（填充用），`--accent-text` 才是接近 logo 原色的那支（文字与图标用）。

几个具体决定：

- **transcript 是一条 log，不是一段聊天。** 所有东西——提问、回答、工具调用、系统提示——都在同一列里左对齐，没有右对齐的气泡。气泡把一次会话画成两个人来回说话，但这里真正在发生的是「你下了一条指令，然后一串事情被执行了」，那是日志的形状。提问因此只戴一条 2px 的强调色竖线，而且靠负外边距把它挂进左边的留白里，正文本身仍然和下面的回答齐头——一屏扫下来左边缘是一条直线，只有竖线在标记每一段的开头。提问那一行的操作按钮改成横向排在右侧：竖排时它们即使不可见也占着 24px，而这 24px 会横在每一个问题和它的答案之间。
- **助手消息没有容器，工具调用也没有。** 正文直接是正文，行高 1.72；工具调用是这一轮里的一行，不是挂在它上面的一份文档。折叠态就是「图标 + 工具名 + 参数 + 结果」一行，边框、填充、投影全部去掉，只在指针底下浮出一层 hover 底色。它的左右外边距是负的，正好抵掉那层底色自己的内边距，于是行首和上一段正文对齐——一段答复里穿插三四次工具调用时，左边缘不会变成锯齿。成功是预期结果，所以给一个淡绿的勾而不是一枚「完成」药丸；只有执行中、失败、跳过、过期才配文字，因为只有它们需要打断阅读。
- **展开的明细按工具分型。** 一次 shell 调用、一次写文件、一次读文件产出的是三种东西，用同一个 `<pre>` 装它们只是把解读工作推给读者。`ToolDetail` 因此按 `block.tool` 分派：终端结果保留终端自己的深底和 `$` 提示符，`exit` 码按 0/非 0 着色，读文件带行号槽，列目录是带图标的两列网格，写文件是 unified diff。识别不出来的（包括这些视图存在之前记录的调用）落回原来的输入/输出双栏，所以旧会话不会变成空白。
- **diff 是写入那一刻算的，不是事后推的。** 模型写的是整份文件，「改了什么」只存在于磁盘上的旧字节和即将覆盖它的新字节之间。`fs_write` 于是在落盘前先读一次原文，`main/agent/diff.ts` 用剥掉公共首尾后的 LCS 生成带三行上下文的 hunk，结果写进 `details.display`——它会随会话持久化，所以两头都设了闸：超过 1500 行不做比较，只记「整体替换」；输出超过 400 行截断。读取被 `TEXT_PREVIEW_CAP` 截断过的大文件不生成 diff，因为那份「旧内容」是残缺的，拿它做对比会把文件尾巴报成删除。
- **工具区、输入区、模型切换是一块地。** 它们本来是三条各带边框的横条：工具台一条、输入框一条、底下再一条写着模型名和 token 的说明文字。现在外面套一个 `.dock`，底色只由它画一次；模型选择器和 token 计量搬进 composer 框内部，和发送按钮同一行——它们本来就都作用于上方那段文字，靠近就是全部的解释；快捷键提示并进 placeholder。省下的是一条横条的高度加两条边框，但真正的收益是这一带从三个东西变回一个。
- **wordmark 出两版 PNG。** 原图 `brand/logo.png` 是白底深色墨迹。直接把白色抠成透明会顺手把淡紫笔画也吃掉——它本身够亮，亮度上更接近纸而不是墨。所以 `brand/generate.py` 改成按色相把两种笔画分开，各自重画成纯色再反推 alpha，边缘于是能干净地叠在任何底色上。深色版的墨色是 `#efeff1` 而不是带蓝的近白：暗色主题是一整套中性灰，任何偏冷的白落在上面都像一块渍。淡紫保留，且换成暗色主题里的那支 `#b7aaf3`——它在暗色下是全屏唯一的彩色，logo 没有理由用另一支。两版都渲染、由 CSS 按主题挑一版，渲染层不需要知道当前主题；GitHub 上没有我们的 CSS 可用，所以 README 里同一对文件由 `<picture>` 的 `prefers-color-scheme` 挑。它挂在空 transcript 上而不是标题栏：标题栏每一屏都在，logo 在那里只是长期占着一格；空会话是这个应用唯一一次可以自报家门的地方。同一个脚本还顺带生成两个图标：`build/icon.png` 给 macOS，`build/icon.ico` 给 Windows。后者不是前者的缩放——macOS 的 1024 画布要留 100 的边距，Windows 直接把图标画在任务栏上、没有自己的图版，照那个边距缩到 16px 时字标只剩几个像素宽，所以它用一份边距小得多的图版。
- **应用图标是超椭圆，不是圆角矩形。** `rounded_rectangle` 的圆弧角在直边处有可见的切线接缝，放在 Dock 里一眼就是「不是 macOS 原生的那个形状」。`brand/generate.py` 改成按 `|x|^5 + |y|^5 = 1` 采样出轮廓多边形，4 倍超采样后降采样成 alpha 遮罩，曲率于是连续。1024 的画布留 100 的边距，正好是 macOS 期望的 824 图版。
- **分界靠表面明度和颜色，不靠边框。** 全应用只剩三种线：`hr`（那是内容）、提问和 ask 卡片的强调色竖条（那是标记）、以及输入框的一圈内投影。其余一律换成层次或颜色：`.detail` 卡片只留投影，`.dock` 只比正文低一档底色，工具台盒子是一张浮在 dock 上的卡片，侧栏时间分组去掉分隔线只留组头加一段留白，当前会话行改成左缘 3px 的强调色导轨。这样窄窗口下也不会出现「线比内容多」的观感。
- **颜色承担 IA。** 四个工具各有一支色（`--tone-shell` / `--tone-read` / `--tone-write` / `--tone-list`），折叠态的图标就是这一行唯一的颜色，扫一列工具调用时形状之前先读到「shell / 读 / 写 / 列目录」；`request` 用警告色、`ask_user_question` 用强调色，因为它们会停住这一轮。文件树里目录用 `--tone-list`、文件用三级文字色；「本次改动」那条 strip 整体用 `--tone-write`，和 transcript 里同一件事同色。markdown 表格不画网格线，表头用强调色底、行用斑马纹。
- **终端与应用同色系。** xterm 的 ANSI 十六色是有彩的，背景是中性的；`--bg-terminal`（`#101012`）与 `terminalRegistry.ts` 里的 `THEME_DARK.background` 必须一致，否则 host 的 padding 处会露出一圈接缝。它比任何应用表面都深，所以也不需要画边框——最深的那层底色本身就是边界。没有终端时这层深底撤掉，那块地方回到工具台自己的颜色。
- **代码高亮是自己写的十几条规则**，不是套 highlight.js 的现成主题——现成主题的饱和度在这套底色上都太跳。
- **红绿灯和标题栏按钮在同一条线上。** 标题栏 52px、按钮 28px，按钮中心在 26px；macOS 的窗口按钮是 12px 的圆，所以 `trafficLightPosition` 的 y 必须是 20 而不是默认那档，否则左边三颗比右边一排高出 6px——这种错位单看不出问题，和右边的按钮一起看就是歪的。Windows 上让路的是另一边，见 §11。「新会话」也挪到了左边紧挨侧栏开关：它开出来的东西落在侧栏里，和右端那两个窗口级的按钮不是一类。
- **输入框是填充的，不是描边的。** 一层比周围低一档的底色说「这里能打字」，和一条 1px 的线说得一样清楚，而全屏少一条线。代价是聚焦时没有边框可以加深，所以 `.text-field:focus` 换成底色提亮加一圈 3px 的 `--accent-soft`——这是全应用唯一的聚焦环，只给那些「偶尔进去一次」的字段（搜索、设置）。composer 不给：一个窗口开着的大部分时间焦点都在它里面，常亮的光晕是噪音而不是信号，所以它只从 `--shadow-card` 抬到 `--shadow-raised`。
- **动效按使用频率配额。** 三条曲线和四档时长是 token（`--ease-out` / `--ease-in-out` / `--ease-drawer`，120/140/180/220ms），没有手写的 cubic-bezier。规则是频率越高、动得越少：每天要按几百次的东西（发送、快捷键、切会话）不做入场动画，只留 `scale(0.97)` 的按压反馈——那是反馈，不是装饰；工具卡片展开这种偶尔发生的用 180ms `ease-out`；空会话每天见不到几次，才配得上 50ms 一档的错峰入场。展开用的是 `grid-template-rows: 0fr → 1fr` 而不是 keyframes：过渡可以在半路被重新指向，keyframes 只会从头再来一遍，而这个东西是可以被连点的。工具台的高度不做过渡——xterm 的 `ResizeObserver` 会在每一帧 refit 并向 PTY 发一次 resize，为一次展开付六十次重排不值得。
- **消息本身不做入场动画。** 发消息是这个应用里最高频的动作，给它加一段 200ms 会让每一次发送都慢 200ms；而切会话时整条 transcript 重新挂载，逐条淡入会变成满屏闪烁。
- **宽度不够时横向滚，不竖向挤。** 表格、代码块、diff、读文件、命令输出全都是「列有意义」的内容：把它们压进窄容器换来的是每行三行高的折行，而这恰好毁掉它们唯一的用处。所以 markdown 表格由渲染层包一层 `.table-scroll`，表格本身 `width: max-content`（列取内容需要的宽度，单个长单元格由 `max-width: 26rem` 兜住），容器横向滚；`pre`、diff 行、文件行、`term-output` 一律 `white-space: pre` 配容器滚动。macOS 的覆盖式滚动条不滚动时是隐形的，所以 `.table-scroll` 用一组 `local` / `scroll` 双层渐变做滚动阴影——只有那个方向还有内容时那一侧才压暗。

暗色不是把亮色压暗，而是换一套没有色相的灰阶：`--bg-window` 到 `--bg-raised` 走 `#121213 → #242427`，全程中性，`--border` 直接是白色透明度。深蓝底在夜里会把整屏染成一种颜色，也把强调色的紫压得看不出是紫；中性灰之上，唯一有彩的东西是强调色和那四支工具色——该有颜色的地方才有颜色。亮色仍然是从 logo 取的那支长春花紫加偏冷纸白，两套共用一份 token 名。

## 10. 菜单交给系统

弹出菜单交给 AppKit，不在 DOM 里画。渲染层把菜单项序列化成 `NativeMenuItem[]` 走 `window:popup-menu`，主进程 `Menu.popup()` 之后把选中项的 id 回传。这样菜单能溢出窗口、跟随系统外观与「减弱动态效果」、用系统一致的手势关闭；拷贝/粘贴这类用 `role` 交给 Electron，连快捷键提示都是对的。没有自定义菜单的地方由 `installDefaultContextMenu()` 兜底出标准编辑菜单，它靠 `event.defaultPrevented` 判断这一次右键是否已经被组件接管。

## 11. 两个平台

Windows 支持不是把 macOS 的代码抄一遍加 `if`，而是先划清楚哪些地方两个系统真的不一样。分歧集中在四处，其余全是共用的。

**shell。** `SHELL_PATHS` 那张常量表换成 `shellPath(kind)`：POSIX 一侧还是 zsh / bash / fish，Windows 一侧只有 PowerShell。cmd 被砍掉了不是因为懒——sticky shell 靠往 stdin 写一个带唯一结束标记的命令块来分帧，而那个标记里的 `<<<` 和 `>>>` 在 cmd 里是重定向运算符，转义完剩下的东西已经不能叫「同一个机制」了。半个能用的 cmd 比没有 cmd 更糟。PowerShell 这边有两处非它不可的处理：一是失败信号被劈成两半（`$?` 管 cmdlet，`$LASTEXITCODE` 管原生程序），得先清零再合并读；二是 5.1 往管道写的时候用的是控制台的 OEM 代码页，会话第一行必须把 `OutputEncoding` 顶成 UTF-8，否则任何非 ASCII 输出读回来都是乱码。超时杀进程也换了：POSIX 有进程组，一个信号带走整棵树；Windows 只能 `taskkill /T` 顺着父子链走一遍。

**窗口按钮。** 两边都是无边框，但理由相反。macOS 用 `hiddenInset` 留下红绿灯，标题栏左边空出 88px 给它们。Windows 没有对应的样式，只能开 `titleBarOverlay`，让系统把最小化/最大化/关闭画在我们的标题栏之上——那三颗在右边，所以让路的是右边的 146px。这两个数字是 CSS 变量 `--chrome-lead` / `--chrome-trail`，由 `<html data-platform>` 选一组；渲染层不写任何 `if (isMac)`。overlay 的配色不跟随 `nativeTheme`，得在主题变化时手动重刷一次。

**关窗的含义。** macOS 上关闭主窗口只是隐藏，回合和 PTY 继续跑，Dock 图标能唤回来（README §2.9）。Windows 没有 Dock，同样的行为会把窗口关进一个用户找不回来的地方——除非再加一个托盘图标，而那是往每个用户的通知区里塞一个他没要的东西。所以那边关闭就是关闭，退出走 `before-quit` 里原本就有的那套拆卸。这是产品行为的差异，不是移植没做完，README 里明写了。

**键盘。** 快捷键在源码里只写一遍，写成 macOS 的字形（`⌘⇧O`），由 `lib/platform.ts` 的 `keys()` 在非 macOS 上改写成 `Ctrl+Shift+O`。它需要在模块加载时就知道平台，所以 `platform` 是 `window.vav` 上唯一一个同步字段，其余全是 Promise。全局热键的默认值也得换：`Command` 在 Windows 上不是任何一个键，`globalShortcut.register` 会静默失败；从别的机器带过来的 settings.json 里如果有 `Command`，`SettingsStore` 在 load 时就把它降级成平台默认值，shell 同理。

## 12. 品牌与开发期的 Electron 包

`app.setName()` 只改菜单栏。Dock 的悬停名来自当前运行 bundle 的 Info.plist，而开发期跑的是 `node_modules/electron/dist/Electron.app` —— 所以那里一直写着 Electron。`scripts/prepare-electron-brand.mjs` 在 `npm run dev` 之前把这个 bundle 本身改名：`vav.app`、可执行文件 `vav`、写进 `CFBundleName`/`CFBundleDisplayName` = `VAV Dev`、换成从 `build/icon.png` 生成的 `.icns`，并同步 `node_modules/electron/path.txt`。

开发版和正式版必须是两套身份，否则单实例锁、userData、Dock 会抢同一个槽：

| | 正式版 | 开发版 |
| --- | --- | --- |
| 显示名 / 进程名 | `VAV` | `VAV Dev` |
| bundle / AppUserModelID | `com.vav.app` | `dev.vav.app` |
| userData / Chromium lock | `…/vav` | `…/vav-dev` |

其中两步容易被漏掉。一是 bundle identifier 必须换成 `dev.vav.app`：LaunchServices 按 identifier 缓存显示名，`com.github.Electron` 在系统里早就登记成 “Electron”，不换的话改了 plist 也没用。二是改过 Info.plist 之后签名失效，要重新 ad-hoc 签一次。脚本按 Electron 版本与图标 mtime 打戳，`npm install` 还原了原始 bundle 时会自己再跑一遍。打包产物不走这条路，`productName` 已经够了。`scripts/kill-dev.mjs` 只杀 `VAV Dev` / `electron/dist/vav.app`，绝不 `pkill -x VAV`。

## 13. 开发期工具

两个 `!app.isPackaged` 门控的钩子：renderer console 转发到主进程 stdout，以及

```
VAV_SNAPSHOT=/tmp/x.png VAV_SNAPSHOT_JS="<expr>" npm start
```

离屏渲染窗口、可选地用一段 JS 把 UI 驱动到某个状态、截图后退出。整个 UI 的验证（流式、工具卡片、挂起的 ask、错误横幅、首次运行）都是这样做的 —— 不抢焦点，也不需要人在场。

## 14. 已知边界

- 主界面只有一个窗口（设置窗口除外）。真正的多主窗口需要重做 `StreamProjection` 的单例假设。
- 搜索只覆盖已加载的消息，不做全库索引。
- pi-ai 支持十几个 provider，vav 走 `anthropic-messages`、`openai-completions`、`google-generative-ai`（generativelanguage 端点）三条，仍由 endpoint 形态推断；私有网关如果都不像，需要手动选择——目前没有这个开关。Responses / Bedrock / Vertex 这些都只差一个 `Model.api` 字段。模型元数据（上下文窗口、输出上限、$/MTok、推理开关、模态、thinking 档位映射）由 `src/main/agent/modelMeta.ts` 从 pi 的生成目录查表，查不到再落回 `@shared` 的正则启发式；vav 自己的模型列表也会在解锁后探活 provider 的 `/models` 路由（`vavModelProbe.ts`）。
- pi-agent-core 的 compaction、skills、prompt templates 都没接。上下文满了就是满了，目前只有 token 计数条提示。
- 没有 diff 视图。Agent 改文件后你看到的是「变更条」加文件内容，不是补丁。

## 15. Remote：daemon 与 control UI

Remote 不是「把会话拷到另一台电脑再跑一遍 agent」。那会让受控端 UI 变黑——回合发生在控制端进程里，受控桌面只是一份过期快照。

两层协议共用配对密钥，用 `hello.role` 分流：

```
phone / desktop control UI ── hello.role=phone ──► RemoteControlHub  会话、回合、配置
desktop / vavd             ── hello.role=daemon ─► DaemonServer      fs / spawn / pty
```

LAN 监听端口和 tailcat 本地回环都接到同一个 Hub。Hub 是 Electron-free 的；sidecar、配对文件、已知设备名单留在 `RemoteControlService`。

各端配置（`remoteHostKind.ts`）：

| 端 | control plane | workspace host | 本地 agent | 密钥 |
| --- | --- | --- | --- | --- |
| iOS | 是 | 否 | 否 | 在电脑上 |
| 桌面控制端 → 另一台桌面 | 是 | 是 | 否 | 在受控端 |
| 桌面控制端 → vavd | 是 | 是 | 否 | 在 vavd |
| 桌面受控端 | 是 | 是 | 是 | 是 |
| vavd | 是 | 是 | 是 | 是 |

桌面 remote 窗口和 iOS `RemoteClient` 是同构的会话客户端：同一套帧、同一套 `applyRemoteServerMessage` 规则（Swift 镜像这份 TypeScript）。桌面多出来的只是 daemon 上的文件树和 PTY。

控制端的 send / cancel / reply / create / configure（模型、审批、thinking、Fast、ACP mode）/ workspace / rename / archive 都走这套帧。Adopt 后本地 id 若发生碰撞，`hostSessionId` 用 `duplicateSourceId` 对回受控端。`vavd` 接 phone-role hello：回合在 daemon 里跑，桌面 / 手机 / 网页 / 扩展都是壳。Regenerate / edit / fork / compact 不在 phone 协议里，控制平面会话上直接拒绝，避免又在控制端起一轮。

回合只在持有会话的那台机器上跑。`handleAgentEvent` 同时 `fanRemoteTurn`（控制平面）和 `sendToWorkspaceWindows`（本机 UI）。所以手机或另一台桌面发一句话，受控端 transcript 会自己动。

## 16. 诊断日志

Transcript 是给人看的工作记录，不是给排障用的。设置 → 日志另外收两路明细：

- **用户行为**（`user.*`）：发送 / 停止 / 回答卡片 / 重新生成 / 编辑提问 / 新建或删除会话 / 改设置的字段名。不写正文、不写密钥。
- **Agent 技术**（`agent.*`）：回合开始（host + model）、phase、工具名与状态、挂起等待、结束（耗时、cancelled / errorKind）。token delta、文件草稿、终端镜像故意不记——那是洪水，不是故事。
- **系统**（`system.*`）：启动、退出、uncaught / unhandled。

三类寿命是刻意分开的：

| 类 | 默认寿命 | 落盘 | 移除 |
| --- | --- | --- | --- |
| 临时 `ephemeral` | 15 分钟 / 最多 2000 条 | 否（内存环形） | 过期、计数淘汰、退出、清除临时 |
| 会话 `session` | 24 小时 | `userData/logs/session.jsonl` | 过期、删会话时级联、清除全部 |
| 留存 `durable` | 设置里的 1/3/7/14/30 天（默认 7） | `durable.jsonl` | 过期、计数淘汰（20000）、清除全部。删会话不删它 |

排障时你要的是「刚才那一轮工具为什么失败」，不是永远留着每一次设置导航。会话删了，跟它绑定的工具时间线一起走；错误和发送记录留下来，因为事后才知道要看。写入时按 key 名和 `sk-` 形态抹掉密钥，字符串截断。`vavd` 与桌面共用同一套 store。

