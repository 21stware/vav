# Connector 与 Timer 调研

对照现有代码：GitHub / Cloudflare / Supabase 已经以「工作区状态托盘」落地；Vercel 和 vavd 定时任务还不存在。本文记录现状、和目标能力的差距，以及可以沿哪条现有路径往下做。

产品意图（本次调研的对照标准）：

- **Connector**：接到第三方服务，并且能**实施**服务（例如 Vercel connector 托管网页）。现有 GitHub、Supabase、Cloudflare 都应归入这一范畴。
- **Timer**：vavd 上的定时执行。必须能触发；跑完后留下 output 或对应文档。定时任务不和传统会话混在一起，是单独的 session 类型，工作区带时间戳。

---

## 1. Connector：现状是「状态盘」，不是「实施器」

仓库里没有名为 `connector` 的抽象。第三方服务被做成 **Files 托盘里的只读状态页**：扫工作区配置 → 解析本机凭证 → 拉远端状态 → 画在 Files 右侧预览。文案自己写明了「不能从这里 deploy / 不能合并」。

| 集成 | 检测 | 鉴权 | UI 能做什么 | 默认开关 | Agent 专用工具 |
| --- | --- | --- | --- | --- | --- |
| **Git（本地）** | 工作区是 git 仓库 | 无（本机 git） | status / diff / 建分支 / checkout / worktree | 常开，不算 connector | 无（走 `terminal`） |
| **GitHub** | `git remote` 解析出 github.com / GHES | `GH_TOKEN` / `GITHUB_TOKEN` / `gh auth token` | PR / Actions / Releases / Pages，只读 | 开 | 无 |
| **Cloudflare** | 扫 `wrangler.toml` / `wrangler.jsonc` | Settings token → `CLOUDFLARE_API_TOKEN` → `wrangler login` | Workers / Pages 部署状态；CI 脚本提示 | 关 | 无 |
| **Supabase** | 扫 `supabase/`（`config.toml`、functions） | Settings token → `SUPABASE_ACCESS_TOKEN` → `supabase login` | 项目健康 + Edge Functions | 关 | 无 |
| **Vercel** | — | — | — | — | — |

Git 是本地变更检查器，和 GitHub 托盘分开。GitHub / Cloudflare / Supabase 才是第三方 connector 的雏形。

### 1.1 数据流

```
工作区 cwd
   │
   ├─ GitService          本机 git CLI（可走 daemon HostProcess）
   ├─ GithubService       git remote → REST/GraphQL
   ├─ CloudflareService   wrangler 配置 → api.cloudflare.com
   └─ SupabaseService     supabase/ + .env → api.supabase.com / supabase CLI
                │
                ▼
        registerVcsIpc  （仅 Electron IPC）
                │
                ▼
        Files 托盘 + SessionPreview
        github | github-action | github-site | github-release
        cloudflare | supabase
```

关键文件：

- 服务：`src/main/github/GithubService.ts`、`src/main/cloudflare/CloudflareService.ts`、`src/main/supabase/SupabaseService.ts`
- 类型：`src/shared/github.ts`、`src/shared/cloudflare.ts`、`src/shared/supabase.ts`
- IPC：`src/main/ipc/registerVcsIpc.ts`、`src/shared/ipc.ts`
- 托盘开关：`src/shared/workspaceTrays.ts`、Settings → Workspace
- UI：`src/renderer/src/components/FilesPanel.tsx`、`githubPanel/`、`CloudflarePanel.tsx`、`SupabasePanel.tsx`
- 预览槽：`src/renderer/src/state/sessionTypes.ts` 的 `SessionPreview`

产品自己标了边界（`src/shared/i18n/messages.ts`）：

- GitHub：「只读：不能在 vav 里合并、评论或重跑工作流。」
- Cloudflare：「检测到 wrangler 配置时显示 Workers / Pages 部署状态。不能从这里 deploy。」
- Supabase：「检测到 supabase 目录时显示 Edge Functions 健康状态。不能从这里 deploy。」

### 1.2 鉴权怎么接

三家都复用本机 CLI，而不是再做一套 OAuth：

| | Settings / SecretStore | 环境变量 | 本机 CLI |
| --- | --- | --- | --- |
| GitHub | 无独立 secret（不进 `SecretName`） | `GH_TOKEN`、`GITHUB_TOKEN`、`GH_ENTERPRISE_TOKEN` | `gh auth token` |
| Cloudflare | `SecretName = 'cloudflare'` + `cloudflareAccountId` | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | wrangler OAuth token 文件 |
| Supabase | `SecretName = 'supabase'` + `supabaseProjectRef` | `SUPABASE_ACCESS_TOKEN` / `SUPABASE_URL` | `~/.supabase/access-token`、Keychain、`supabase` CLI |

`SecretName` 今天是 `'api' | 'braveSearch' | 'tinyfish' | 'cloudflare' | 'supabase'`。加 Vercel 会在这里多一个名字。

### 1.3 Agent 侧：没有 connector 工具

`createTools()`（`src/main/agent/tools.ts`）只有：

`terminal` / `wait` / `read_bash_session` / `fs_*` / `doc_*` / `sql_query` / `web_*` / `load_skill` / `request` / `ask_user_question` / `plan`

没有 `github_*`、`cloudflare_deploy`、`supabase_invoke`。系统提示也不提这三家。所谓「实施」今天只能靠 agent 在 sticky shell 里跑 `gh`、`wrangler deploy`、`supabase functions deploy`——前提是本机装了 CLI、且用户批准 `terminal`。

这和「connector vercel 能托管网页」差一层：缺的是**产品级动作**（deploy / invoke / 回填预览 URL），不是再做一个状态页。

### 1.4 vavd 吃不到这些托盘

`registerVcsIpc` 只挂在 Electron `ipcMain`。`createVavControlPlane`（vavd 的会话面）不注册 GitHub / Cloudflare / Supabase，也不把 token 交给 agent。

后果：

- 桌面 Files 托盘能看状态；连上 vavd 的网页 / 扩展 / 手机看不到同一套盘。
- Headless 回合里，agent 仍然只有 shell，没有结构化 connector。
- Cloudflare / Supabase 的 Keychain token 在桌面 `SecretStore`；vavd 用 `NodeSecretStore`（`~/.vavd`），两套密钥空间。

Git 是例外：`GitService` 可通过 `setGitHostFor` 打到 daemon 的 `HostProcess`，所以远程工作区的**本地 git** 能跑。GitHub API 仍在控制端进程里按 cwd 调，不经过 daemon RPC。

### 1.5 和目标的差距

目标是「接到第三方，并实施服务」。现在三家都停在「看见远端现在怎样」。

缺的几块：

1. **统一 Connector 接口**（id、检测、鉴权、status、actions）。现在是三份平行服务 + 三套 tray flag。
2. **写操作**：GitHub merge / comment / rerun；Cloudflare / Pages deploy；Supabase function deploy / invoke；Vercel 托管。
3. **Vercel**：仓库里没有 vercel 配置解析、token、托盘或 deploy。
4. **Agent 工具**：把动作收成带审批的 tool，而不是只靠自由 `terminal`。
5. **vavd 暴露面**：状态和动作都应在 daemon 上，桌面只是壳。

---

## 2. 建议的 Connector 形状

沿现有「扫工作区 + 解析凭证 + 远端 API」的路，把**读**和**做**拆开，而不是再发明一套插件运行时。

```
Connector {
  id: 'github' | 'cloudflare' | 'supabase' | 'vercel' | …
  detect(cwd) -> { present, config }
  resolveAuth() -> token | cli-session | missing
  status(cwd) -> 只读快照          // 今天已经有
  actions: {
    deploy? / invoke? / merge? …  // 今天没有
  }
}
```

落地时尽量复用现成零件：

| 层 | 复用 | 要加的 |
| --- | --- | --- |
| 检测 | `scanCloudflareWorkspace`、`isSupabaseWorkspace`、`detectGithubRepo` | `vercel.json` / `.vercel/project.json` |
| 鉴权 | `SecretName` + CLI fallback | `vercel` CLI / `VERCEL_TOKEN` |
| UI | Files 托盘 + `SessionPreview` | 动作按钮（Deploy）+ 最近一次 URL |
| Agent | `request` 审批门 + `terminal` 兜底 | 每个 connector 一组显式 tool |
| Host | `VavControlPlane` / `DaemonServer` | 把 status/actions 做成 daemon RPC，而不是只留 Electron IPC |

Vercel 和 Cloudflare Pages 最像：工作区配置 → 凭证 → 远端项目 → 部署列表 → 预览 URL。差别是 Vercel 的「实施」是 `vercel deploy` / REST deployments，而不是 wrangler。

GitHub 的「实施」更宽（merge、comment、dispatch workflow、Pages 构建），和「托管网页」不完全一类，但同属 connector：绑定远端身份，并对那个身份做事。

建议的动作边界：

- **Tray**：继续做状态；动作要二次确认（已有 `request` / approvalMode）。
- **Agent**：优先调 connector action（结构化结果：url、deployment id、logs 链接）；CLI 不在 PATH 时再降级 `terminal`。
- **密钥**：永远不进 renderer；vavd 和桌面各自的 secret store 都要能解析同一套来源（settings / env / CLI）。

---

## 3. Timer：调度器已落地（session，不是 conversation）

产品级 cron 已在 `TimerStore` + `TimerScheduler` 落地。侧栏 More 里「显示定时会话」与「显示文件会话」并列；主列表用 `isMainSidebarSession` 滤掉 `fileId` / `timerJobId`。

vavd 已经具备「到点之后该跑的那一半」：

```
vavd
  DaemonServer          配对、fs / spawn / pty
  VavControlPlane       ConversationStore + AgentRuntime + RemoteControlHub
    createSession()     造普通会话 + 临时工作区
    send(id, text)      在 daemon 里跑回合
  ~/.vavd               identity、secrets、conversations 分片
```

缺的是：**持久化的调度表、到点触发、以及和普通会话隔离的 session / workspace**。

Remote 协议（`src/shared/remoteControl.ts`）只有 `create` / `send` / `workspace` / `configure` / `cancel`……没有 `schedule`。vavd 管理命令只有 `clients` / `disconnect` / `unpair` / `rotate-offer`。

### 3.1 会话今天怎么分类

`Conversation` **没有** `kind` / `sessionType`。隔离靠几个可空字段：

| 字段 | 谁用 | 会不会进侧栏 `listMeta()` | 会不会进手机会话列表 |
| --- | --- | --- | --- |
| （默认） | 普通聊天 | 是 | 是（未归档） |
| `fileId` | File Preview 会话 | **否** | **否** |
| `swarmParentId` | Swarm 子 pane | 是（子行） | **否** |
| `archived` | 归档 | 是（归档视图） | **否** |
| `cliHost` | Claude / Codex / ACP | 是 | 是（`surface: 'cli'`） |

`listMeta()` 与手机主列表用 `isMainSidebarSession`：`fileId` / `timerJobId` 都滤掉。

**File session 与 Timer session 并列**：同一套 transcript 存储，侧栏 More 里两个入口——「文件会话」和「定时会话」。不要把 timer 做成普通 conversation 的一个字段展示。

### 3.2 工作区今天怎么铸

桌面和 vavd 都是：

```
$TMPDIR/vav/<8 hex uuid>/Workspace
```

见 `mintTempWorkdir()`（`src/main/index.ts`、`src/main/host/VavControlPlane.ts`）。这是临时工作区，不是时间戳工作区。OS 清 `/tmp` 时，`cliTurnLifecycle` 会按同一布局补建。

定时任务如果也用 8 位 hex，跑完很难按时间找回产物。目标需要类似：

```
$TMPDIR/vav/timer-<jobId>/<YYYYMMDD-HHmmss>/Workspace
```

或持久化到 daemon 状态目录（`~/.vavd/timers/<jobId>/<stamp>/Workspace`），避免 `/tmp` 被清掉后报告失踪。

### 3.3 跑完之后今天能留下什么

一次普通回合结束时：

- transcript 写入 `conversations/{id}.json`（工具边界和回合结束才落盘）
- 工作区文件留在 cwd（agent 的 `fs_write`）
- `resultUnseen` 让托盘显示 Done，直到用户打开
- 桌面可发完成通知；vavd 没有等价的「定时报告」通道

没有「这次 run 的正式 output 文档」约定。Timer 需要约定产物位置（例如工作区里的 `OUTPUT.md`），或把助手最后一条消息当作 output 挂到 job run 记录上。

---

## 4. 建议的 Timer 形状

调度必须活在 **vavd**（或桌面里那份 in-process host），不能只活在 renderer：Windows 关窗即退出，手机 / 扩展也不会替 daemon 守夜。

### 4.1 单独的 session 类型

仿 `fileId`：

```ts
// ConversationMeta
timerJobId?: string | null   // 非空 = 定时会话，listMeta / 手机主列表都滤掉
timerRunAt?: number | null   // 这次开火的墙钟时间
```

另做 `TimerStore`（对标 `FileSessionStore`）：

```
~/.vavd/timers/index.json     // job 定义：cron / at、prompt、enabled
~/.vavd/timers/runs.json      // runId → conversationId、workspace、status、outputPath
```

侧栏 More 里「显示定时会话」与「显示文件会话」并列。主列表不出现这些行。

`TimerStore` + `TimerScheduler` 已落地：job 在 `{stateDir}/timers/index.json`，每次开火一条 timer session。

### 4.2 时间戳工作区

每次开火：

1. 铸 `…/vav/timer-<jobId>/<YYYYMMDD-HHmmss>/Workspace`（优先 `~/.vavd`，不要只靠 `/tmp`）。
2. `conversations.create(workdir, model, { timerJobId, title })`。
3. `agent.send(conversationId, job.prompt)`——复用现有回合循环。
4. 回合结束后：
   - 若工作区有 `OUTPUT.md`（或 job 指定的路径）→ 记到 run 记录；
   - 否则把最后一条助手文本写进 `OUTPUT.md`，保证每次 run 都有一份能打开的文档。
5. `resultUnseen = true`；桌面 / 手机用独立「Timer」表面看，不混进普通 Done 托盘（可选：托盘单独一组）。

同一 job 的多次开火 = 多条 conversation（一次 run 一条），不要在同一条 transcript 上无限追加——和「重新生成是并列版本」一致：每次定时是一次独立工作。

### 4.3 触发

最小实现（vavd 进程内）：

- 启动时加载 `TimerStore`，算每个 job 的 next due。
- `setTimeout` 链到下一个 due（进程活着就能触发）。
- 漏过的 due：启动时补跑或标 missed（要产品拍板；补跑更接近「确保能触发」）。
- 重叠：同一 job 上一次还在跑则跳过或排队，不要并行写同一工作区。

`vavd` 默认绑全接口、不随桌面退出，适合当调度器。桌面 `--no-vavd` 的 in-process host 若也要定时，需要同一套 `TimerStore`，否则两套时钟会双触发——job 应挂在 **workspace host**（那台跑 agent 的机器）上。

Remote 协议可后续加 `timer.list` / `timer.upsert` / `timer.runs`；第一刀可以只在 daemon 本地 store + 桌面 IPC。

### 4.4 和 connector 的交点

定时回合就是一次普通 agent 回合，只是入口和隔离不同。若 connector 已有 deploy / invoke 工具，定时 prompt 可以直接说「每天构建并 deploy 到 Vercel，把 URL 写进 OUTPUT.md」。在 connector 动作落地之前，prompt 只能让 agent 走 `terminal`。

---

## 5. 建议落地顺序

按依赖，而不是按日历：

1. **给 Conversation 加上可过滤的 kind 字段**（至少 `timerJobId`；必要时把 `fileId` 收成 `sessionKind`）。侧栏 / 手机列表 / duplicate 一起改。这是 Timer 不混进普通任务的前提。
2. **TimerStore + vavd 调度循环 + 时间戳工作区 + OUTPUT.md 约定**。先证明「到点 → 新会话 → 回合 → 文件」。UI 可以先是设置页里的 job 列表 + 独立「定时」列表。
3. **把现有三家收成 Connector 接口**，行为先保持只读，避免托盘回归。
4. **补实施动作**：Cloudflare/Pages deploy、Supabase deploy/invoke，再加 Vercel（配置检测 + token + deploy + 预览 URL）。
5. **Agent 工具**包这些动作，走现有审批。
6. **vavd RPC** 暴露 connector status/actions，让 headless 和桌面同一套。

1 和 2 不依赖 connector。4–6 让「定时部署网页」成为一条完整路径。

---

## 6. 风险

- **密钥**：connector 写操作放大 token 权限；继续 Keychain / `NodeSecretStore`，不要写进会话 JSON。
- **审批**：无人值守的定时任务不能弹 `ask_user_question`。Job 应固定 `approvalMode`（多半是 `auto`），或只跑只读 prompt。
- **工作区寿命**：`/tmp` 会被清；timer 产物应落在 `~/.vavd`（或用户选的目录）。
- **双 host**：桌面 spawn 的 vavd 和 in-process host 不要各跑一份调度器。
- **Phone 列表 cap**：远程列表只留 30 条普通会话；timer 本来就不该进这个列表。

---

## 7. 结论

- **Connector** 在产品上已经有三家（GitHub、Cloudflare、Supabase），实现上却是 Files 里的只读状态盘：有检测、有鉴权、有预览，没有 deploy / invoke / merge，也没有 Vercel，也没有 agent 工具，vavd 也没挂上。要「实施服务」，需要在现有 status 服务上加 action 面，并接到 agent 和 daemon。
- **Timer session** 与 file session 并列：侧栏 More →「显示定时会话」。`timerJobId` 把这次 run 从主列表滤掉；`TimerStore` 管 job / run；每次开火铸 `{stateDir}/timers/{jobId}/{YYYYMMDD-HHmmss}/Workspace`，跑完写下 `OUTPUT.md`。vavd 与桌面 in-process host 都会跑 `TimerScheduler`。
- **Connector 目录**已统一：`CONNECTORS` + `detectConnectors`（含 Vercel）。Files 托盘可打开 Vercel 检测页（只读）。deploy / invoke / merge 与 agent 工具仍未做。

两者正交：connector 解决「能对第三方做什么」；timer session 解决「何时在隔离会话里做、做完留下什么」。合在一起才是「每天定时构建并托管，然后留下 URL 文档」。
