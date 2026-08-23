# Accounts 重设计 · 完整技术实施规划

## 实施进度（2026-08-23）

| WP | 状态 | 说明 |
| --- | --- | --- |
| A1 文件型快照切换 | **已落地** | grok / codex / opencode / pi；`accounts.activate`；登录后/同步时 capture |
| A2 Keychain 切换 | **已落地** | cursor / claude `keychainAdapter` 可 capture/restore；OAuth 前先快照 live 槽；`upsertOAuth` 不再改写真实邮箱 |
| A3 刷新/文案 | 部分 | `needsReauth` / `needsRefresh` / `switching` 文案已加；静默 refresh_token 续期未做 |
| B 多身份额度 | **已落地** | `identitiesOf` + fetcher `token` 上下文按 `host:identity` 拉非 live 额度 |
| C API 余额 | **DeepSeek 已接进 Accounts** | 官方 host 白名单；其它 provider 仍降级为本地用量 |

---

> 交付形态：本文档是**自包含实施规范**，可直接分包给其他模型/工程师执行，
> 无需重新调研代码。每个工作包（WP）标注了精确的文件路径、类型定义、函数签名、
> IPC 改动、测试与验收标准。
>
> 产品目标：把 Settings → Accounts 从「镜像各 CLI 当前的单一登录态」升级为
> 「本机所有 Coding Agent 的多账户中枢」——随时看到每账户余额、一键切换、**不重复 OAuth**。

---

## 0. 背景与根因（实施者必读）

VAV 当前**不持有任何 OAuth 凭证**，只读各 CLI 在本机唯一的 live 槽位。三个产品缺陷：

1. **切换要重登**：`AccountStore.setCurrent`（`src/main/store/AccountStore.ts:182`）只翻转
   `accounts.json` 的 `current` 布尔，从不改写磁盘凭证槽位。CLI 仍读旧槽位 → 被判非 live →
   逼用户重新 OAuth（又覆盖唯一槽位）。
2. **授权过期**：非活跃账户 token 无人续期（无 refresh 逻辑），切走后被
   `applyExclusiveOAuthSignIn`（`src/shared/accounts.ts:348`）强标 `oauthExpired`。
3. **额度只对 live 可见 / API provider 无余额**：`fetchXxxAccountQuota` 一律读唯一 live 凭证；
   `vav_key` 无余额查询接进 Accounts。

### 现有可复用资产（务必复用，勿重造）

| 资产 | 位置 | 用途 |
| --- | --- | --- |
| `SecretStore` safeStorage 加密落盘 | `src/main/store/SecretStore.ts` | 快照加密存储（新增 `secret-oauth-*.bin`） |
| `QuotaService` **已按 `host:identity` 命名空间缓存** | `src/main/quota/QuotaService.ts` | `getState(host, identity)` 已支持任意身份；B 只需多身份遍历 |
| `apiBalance.ts` + `deepseekBalance.ts`（DeepSeek 余额已实现） | `src/shared/apiBalance.ts`, `src/main/quota/deepseekBalance.ts` | C 只需泛化 source + 接进 Accounts（现仅用于 Analysis 面板） |
| 各 host reader 的路径/服务名常量 | `src/main/quota/{grok,codex,claude,cursor,opencode,pi}Usage.ts` | 快照 adapter 复用，勿硬编码 |
| `hostLogin.ts` / `hostLoginArgv.ts` | `src/main/accounts/` | OAuth 登录/登出 argv |

### 各 host 凭证存储模型（决定每 host 可行边界）

| Host | 存储 | 类型 | 读 token | 写回(swap) | 登录 argv |
| --- | --- | --- | --- | --- | --- |
| grok | `~/.grok/auth.json`（按 issuer，认 `auth.x.ai`） | 文件 | ✅ | ✅ 易 | `login --oauth` |
| codex | `~/.codex/auth.json`（`tokens.access_token`+`account_id`） | 文件 | ✅ | ✅ 易 | 无(需补) |
| opencode | `~/.local/share/opencode/auth.json` | 文件 | ✅ | ✅ 易 | 无(需补) |
| pi | `~/.pi/agent/auth.json` | 文件 | ✅(不透明) | ✅ 易 | 无 |
| claude | Keychain `Claude Code-credentials[-<hash>]` + `.credentials.json` | Keychain/文件 | ✅ | ⚠️ 中 | 无(需补) |
| cursor | Keychain `cursor-access-token` | Keychain | ✅ | ⚠️ 中 | `login` |
| devin | `devin auth status`（不透明） | CLI 托管 | ❌ | ❌ | — |
| kiro / cline / antigravity | 暂无 reader | ? | ❓ | ❓ | — |

**通用原则**：凭证落在可读文件/Keychain 条目的 host → 快照+写回可行；CLI 自管不暴露
token 的（devin）→ `swappable=false`，保留「重新登录」回退。这即「provider 有就支持到什么程度」。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Renderer: AccountsSettings.tsx                               │
│  - 切换态: switched / needsReauth / needsRefresh              │
│  - 额度: 所有身份(不止 live) ; 余额行(API provider)          │
└───────────────▲─────────────────────────────┬───────────────┘
                │ IPC                          │ IPC
┌───────────────┴─────────────────────────────▼───────────────┐
│ Main: accounts/service.ts (编排层)                           │
│  buildAccountsPage · activateAccount(新) · captureAfterLogin │
├──────────────┬───────────────────┬──────────────────────────┤
│ AccountStore │ CredentialVault(新)│ QuotaService(扩多身份)    │
│ (元数据)     │  = SecretStore +   │  identitiesOf(新)         │
│              │    HostCredential- │  fetchers(token ctx)      │
│              │    Adapter(新)      │  ApiBalanceService(新/泛化)│
└──────────────┴───────────────────┴──────────────────────────┘
                        │ read/write 槽位
        ~/.grok/auth.json · ~/.codex/auth.json · Keychain ...
```

新增模块目录：`src/main/accounts/credentials/`。

---

## WP-A1 · 凭证快照 + 文件型 host 一键切换（最高优先级）

> 覆盖 grok / codex / opencode / pi。单独交付即可根治「切一次登一次」。

### A1.1 新增：Host 凭证适配器抽象

**新文件** `src/main/accounts/credentials/adapter.ts`：

```ts
import type { CliHostKind } from '@shared/cliHost'

export interface HostCredentialSnapshot {
  /** 槽位原样内容（文件全文或 keychain 明文）。原样保存以抗格式漂移。 */
  payload: string
  /** 存储形态，restore 时据此还原到正确位置。 */
  medium: 'file' | 'keychain'
  /** 邮箱或 token 指纹，用于校验归属。 */
  identity: string | null
  /** token 过期毫秒（能解析时），用于 UI 与刷新判断。 */
  expiresAtMs: number | null
  capturedAt: number
}

export interface HostCredentialAdapter {
  host: CliHostKind
  /** false → 不支持快照切换（devin），UI 回退重新登录。 */
  swappable: boolean
  /** 读取当前槽位，登录后调用做快照。null = 槽位为空/不可读。 */
  capture(): Promise<HostCredentialSnapshot | null>
  /** 把快照写回槽位。文件型原子写(0600)；keychain 用 security -U。 */
  restore(snapshot: HostCredentialSnapshot): Promise<void>
  /** 当前槽位归属的身份指纹（复用现有 readXxxAuthIdentity）。 */
  liveIdentity(): Promise<string | null>
}

export function adapterFor(host: string | null | undefined): HostCredentialAdapter | null
```

**新文件** `src/main/accounts/credentials/fileAdapter.ts`（文件型通用实现）：
- 构造参数：`{ host, path(): string, parseIdentity(raw): string|null, parseExpiry(raw): number|null }`
- `capture`: `readFile(path)` → 组装 snapshot（`medium:'file'`）。
- `restore`: 写临时文件 `path + '.vav.tmp'`（`mode:0o600`）→ `renameSync` 原子替换。
- `liveIdentity`: 复用对应 `readXxxAuthIdentity()`。

**新文件** `src/main/accounts/credentials/keychainAdapter.ts`（WP-A2 才启用，先建骨架）。

**新文件** `src/main/accounts/credentials/index.ts`：注册表
```ts
const ADAPTERS: Partial<Record<CliHostKind, HostCredentialAdapter>> = {
  grok: makeGrokAdapter(),     // file: grokHome()/auth.json
  codex: makeCodexAdapter(),   // file: codexHome()/auth.json
  opencode: makeOpencodeAdapter(), // file: opencodeDataDir()/auth.json
  pi: makePiAdapter()          // file: ~/.pi/agent/auth.json
  // A2 追加 claude/cursor
}
export function adapterFor(host) { return ADAPTERS[host] ?? null }
```
> 复用现有 `grokHome()/codexHome()/opencodeDataDir()` 常量——把它们从各 `*Usage.ts`
> 提到 `src/main/quota/hostPaths.ts` 共享，避免重复定义。

各 host `parseIdentity`/`parseExpiry`：直接复用 `*Usage.ts` 里现成的解析逻辑
（grok 的 `parseExpiresAtMs`、codex 的 `tokens.account_id` 等）。

### A1.2 存储：CredentialVault（扩 SecretStore）

**改** `src/main/store/SecretStore.ts`，新增（镜像现有 `getAccountKey` 那套）：
```ts
private readonly OAUTH_SNAPSHOT_PREFIX = 'secret-oauth-'
setOAuthSnapshot(accountId: string, snapshot: HostCredentialSnapshot): void  // JSON.stringify → encryptString → secret-oauth-<safeId>.bin
getOAuthSnapshot(accountId: string): HostCredentialSnapshot | null
clearOAuthSnapshot(accountId: string): void
```
- 复用 `accountPath` 的 id 净化与 `warmAccountSecrets` 的 warm 机制（新增 warm 扫描 `secret-oauth-` 前缀）。
- 受同一 unlock gate 保护。

### A1.3 数据模型

**改** `src/shared/accounts.ts` — `ProviderAccount` 增字段：
```ts
hasCredentialSnapshot?: boolean       // 是否可本机切换
credentialExpiresAtMs?: number | null // 快照 token 过期时刻
```
在 `coerceAccount`（`AccountStore.ts:442`）补默认值（`=== true` / `number|null`）。

**改** `src/shared/ipc.ts` — `AccountView` 增字段：
```ts
hasCredentialSnapshot: boolean
credentialExpiresAtMs: number | null
```
`toAccountView`（`service.ts:213`）透传。

### A1.4 编排：activateAccount

**新增** `src/main/accounts/service.ts`：
```ts
export type ActivateResult =
  | { kind: 'switched' }
  | { kind: 'alreadyLive' }
  | { kind: 'needsReauth' }   // 无快照 / 不可交换
  | { kind: 'needsRefresh' }  // 快照过期且无法静默续期

export async function activateAccount(input: {
  accountId: string
  accounts: AccountStore
  secrets: SecretStore
}): Promise<ActivateResult>
```
逻辑：
```
account = accounts.get(id); if kind!=='oauth' -> switched (vav_key 无槽位)
adapter = adapterFor(account.oauthHost); if !adapter?.swappable -> needsReauth
live = await adapter.liveIdentity()
if identityMatches(live, account.name) -> alreadyLive
snap = secrets.getOAuthSnapshot(id); if !snap -> needsReauth
if snap.expiresAtMs && snap.expiresAtMs < Date.now()+SKEW -> needsRefresh (A3 前先这样)
// 关键：先快照当前 live，避免覆盖丢失
current = await adapter.capture()
if current?.identity: 找到该 identity 对应的 sibling account 并 secrets.setOAuthSnapshot(siblingId, current)
await adapter.restore(snap)
accounts.setKeyStatus(id, 'ok'); accounts.applyLiveOAuth(host, account.name, true)
-> switched
```

### A1.5 登录后自动快照

**改** `src/main/index.ts` `accountsBeginOAuth` 的 `onFinished`（`:5674` 附近）与
`syncOAuthProfiles` 成功分支：登录成功后
```ts
const adapter = adapterFor(host)
if (adapter?.swappable) {
  const snap = await adapter.capture()
  if (snap) {
    secretStore.setOAuthSnapshot(account.id, snap)
    accountStore.update(account.id, { hasCredentialSnapshot: true, credentialExpiresAtMs: snap.expiresAtMs })
  }
}
```

### A1.6 IPC + 渲染层

**新 IPC** `accountsActivate`（不复用 `accountsSetCurrent`，因为要返回 ActivateResult）：
- `src/shared/ipc.ts`: 常量 `accountsActivate: 'vav:accounts:activate'`；
  `accounts.activate(id: string): Promise<{ page: AccountsPagePayload; result: ActivateResult }>`
- `src/preload/index.ts`: `activate: (id) => ipcRenderer.invoke(IPC.accountsActivate, id)`
- `src/main/index.ts`: handler = `accountStore.setCurrent(id)` + `await activateAccount(...)` +
  `quotaService.refreshHosts([host], true)` → 返回 `{ page: accountsPage(), result }`。

**改** `src/renderer/src/components/settings/AccountsSettings.tsx` `setCurrent`（`:245`）：
```ts
const { page, result } = await window.vav.accounts.activate(account.id)
apply(page)
if (result.kind === 'needsReauth') { /* 提示并高亮 Authorize 按钮 */ }
else if (result.kind === 'needsRefresh') { /* 提示"凭证已过期，需刷新" */ }
else setNotice(t('accounts.switched', {...}))  // switched / alreadyLive 静默成功
```
`AccountInspector` 的 "Authorize with OAuth" 只在 `!hasCredentialSnapshot || needsReauth` 时突出；
有快照的 sibling 不再显示为「已登出」（改 `applyExclusiveOAuthSignIn`：`hasCredentialSnapshot`
的行不打 `oauthExpired`）。

### A1.7 删除清理

**改** `accountsRemove` handler（`index.ts:5634`）：`secretStore.clearOAuthSnapshot(id)`。

### A1.8 测试
- `src/main/accounts/credentials/fileAdapter.test.ts`：capture/restore 往返（临时目录），
  原子写、0600 权限、identity/expiry 解析。
- `src/main/accounts/activateAccount.test.ts`：switched / alreadyLive / needsReauth / needsRefresh
  四分支；切换前必先快照当前 live（用 mock adapter 断言调用顺序）。
- `src/shared/accounts.test.ts`：`applyExclusiveOAuthSignIn` 对 `hasCredentialSnapshot` 行不标过期。

### A1.9 验收
1. grok A 登录 → 切 B（曾登录）→ **不弹 OAuth**，磁盘 `auth.json` 变为 B 的凭证。
2. 切回 A → 仍不重登，A 的凭证从快照还原。
3. codex/opencode/pi 同样往返成功。
4. devin → 切换提示 needsReauth（保持旧行为），不报错。

---

## WP-A2 · Keychain 型 host 切换（claude / cursor）

依赖 A1。

### A2.1 keychainAdapter 实现
**改** `src/main/accounts/credentials/keychainAdapter.ts`：
- 构造参数：`{ host, service(): string, account(): string, parseIdentity, parseExpiry }`
- `capture`: `security find-generic-password -s <service> -a <account> -w`（复用
  `claudeUsage.ts` 的 `keychainService()`/`keychainUser()`、`cursorUsage.ts` 的 `ACCESS_SERVICE`）。
- `restore`: `security add-generic-password -U -s <service> -a <account> -w <payload>`
  （`-U` 覆盖已存在项）。macOS 可能弹授权，属预期。
- claude 需同时兼容 `.credentials.json` 文件回退：keychain 写失败时写文件槽位。

### A2.2 登录 argv 补全
**改** `src/main/accounts/hostLoginArgv.ts`：
```ts
loginArgv: claude → ['/login'] 或对应命令；codex → ['login']；opencode → ['auth','login']
```
> 注意：需先确认各 CLI 实际登录子命令与是否走 loopback（参考 hostLogin.ts 头部注释的
> Grok/Cursor 处理）。不确定的 host 暂不加，保持 sync-only。

### A2.3 测试 & 验收
- keychainAdapter 单测用可注入的 `exec` mock（勿真的写系统 Keychain）。
- 验收：claude/cursor 两账户切换不重登（首次写回可接受一次系统授权弹窗）。

---

## WP-A3 · 过期刷新 & 回退文案

依赖 A1。

### A3.1 刷新策略
- 快照含 refresh_token（grok/claude 结构通常有）→ 写回槽位后由 CLI 下次调用自刷新（最省事方案）。
- 若 host 有独立刷新端点且已知 → 主动静默刷新并回写快照。
- 无法刷新 → `needsReauth`。

### A3.2 UI 文案（`src/shared/i18n/messages.ts` 加键）
- `accounts.needsRefresh`：「凭证已过期，需重新授权刷新」
- `accounts.switchedLocal`：「已切换（本机凭证）」
- `accounts.noLocalSwitch`：「该 Agent 不支持本机快速切换，需重新登录」（devin 等）
- 区分「过期需刷新」与「从未在本机授权」，不再把「被顶掉」误报成登出。

### A3.3 验收
过期账户切换 → 明确提示而非静默失败；文案覆盖三态。

---

## WP-B · 多账户额度（非活跃身份也显示余额）

依赖 A（快照提供非 live token）。**QuotaService 命名空间基础设施已就绪。**

### B.1 QuotaService 多身份化
**改** `src/main/quota/QuotaService.ts`：
- 构造项 `identityOf` → `identitiesOf?: (host) => Promise<Array<{ identity: string; token?: string }>>`
  （保留旧 `identityOf` 兼容，或内部适配）。
- `fetchHost(host)` → `fetchHostIdentity(host, identity, token?)`；`refresh` 遍历
  `identitiesOf(host)` 对每个身份走一次 `fetchHostIdentity`，写各自 `quotaNamespace(host, identity)`。
- `liveIdentity` map 保留（标记哪个是 live，供 UI 默认高亮）。

### B.2 fetcher 接受 token 上下文
**改** `src/main/quota/{claude,codex,cursor,grok,opencode}Usage.ts`：
```ts
export async function fetchGrokAccountQuota(ctx?: { token: string }): Promise<QuotaWindow[]>
```
- 有 `ctx.token` → 用它构造 headers（不读磁盘 live 槽位）；
- 无 → 保持现状读 live 槽位（向后兼容）。
- token 来源：service 层从 `secrets.getOAuthSnapshot(accountId)` 解出（各 host 从 payload
  抽 access_token 的函数放在对应 adapter 里，复用现有解析）。

### B.3 身份枚举来源
**改** `src/main/index.ts` 组装 `identitiesOf`：遍历 `accountStore.listAll()` 中
`kind==='oauth' && hasCredentialSnapshot` 的账户，产出 `{ identity: name, token }`，
外加当前 live 身份。

### B.4 展示放宽
**改** `src/shared/accounts.ts` `accountShowsOAuthQuota`：
```ts
return account.kind !== 'vav_key' && (account.oauthSignedIn || account.hasCredentialSnapshot) && quotaStatus !== 'none'
```
**改** `service.ts` `toAccountView`：`canPoll` 条件从 `signedIn` 放宽为
`signedIn || hasCredentialSnapshot`；quota 用该 account 身份的 ns 取。

### B.5 测试 & 验收
- QuotaService 多身份 fetch 单测（mock fetchers，断言每身份独立缓存）。
- 验收：同 Agent 两账户，切换前后**都**显示各自额度百分比。

---

## WP-C · API Provider 余额（DeepSeek 等，接进 Accounts）

> `apiBalance.ts` + `deepseekBalance.ts` 已实现 DeepSeek 解析，现仅用于 Analysis 面板
> （`buildAnalysisSnapshot` / `lookupVavApiBalance`）。C = 泛化 source + 接进 Accounts。

### C.1 泛化余额 source
**改** `src/shared/apiBalance.ts`：
- `AnalysisApiBalanceSource` 扩为 `'deepseek' | 'xai' | 'openai' | 'siliconflow' | ...`
- 新增按 endpoint host 路由：`balanceUrlFor(endpoint): { source, url } | null`
  （DeepSeek 已有；xAI credits、SiliconFlow `/v1/user/info` 等按需加，未知返回 null）。
- 各 provider 一个 `parseXxxBalance(payload): AnalysisApiBalance | null`。

**新/改** `src/main/quota/apiBalanceService.ts`（把 deepseekBalance 泛化）：
```ts
export async function fetchApiBalance(input: {
  apiKey: string | null; endpoint: string; force?: boolean
}): Promise<AnalysisApiBalance | null>   // 内部按 balanceUrlFor 路由 + 缓存(现有 STALE_MS)
```
只向 provider 官方 host 外呼（沿用 `OFFICIAL_DEEPSEEK_HOSTS` 白名单模式，**严禁把 key 发往 lookalike host**）。

### C.2 接进 Accounts 数据流
**改** `src/shared/ipc.ts` `AccountView` 增：
```ts
balance: { source: string; amount: number; currency: string; available: boolean } | null
```
**改** `service.ts` `toAccountView`：对 `kind==='vav_key'` 且有 key 的账户，填 `balance`
（异步——见 C.3）。
**改** `AccountStore` 或 service 引入 balance 缓存（复用 deepseekBalance 的 module 级缓存思路，
或加 `ApiBalanceService` 单例，键为 `endpoint\napiKeyHash`）。

### C.3 异步刷新管线
- `buildAccountsPage` 是同步的 → balance 走「已缓存则填，未缓存则触发后台 fetch + `onAccountsUpdated` 广播」，
  与 quota 的 `onUpdate → broadcast` 一致。
- 在 `accountsGetPage` 的 refresh 分支里，除 `quotaService.refreshHosts` 外，对可见 vav_key 账户
  触发 `fetchApiBalance`，完成后重发 page。

### C.4 渲染层
**改** `AccountsSettings.tsx`：
- `AccountInspector`：`account.balance` 存在 → 新增一行「余额 {formatApiBalanceAmount}」
  （复用 `apiBalance.ts` 的 `formatApiBalanceAmount` / `apiBalanceProviderLabel`）。
- 列表 chip `rowUsage`：有 balance 优先显示余额，否则回退现有 token 统计。

### C.5 测试 & 验收
- `apiBalance.test.ts`：各 provider parse + `balanceUrlFor` 白名单（lookalike host 返回 null）。
- 验收：DeepSeek 账户填 key → Accounts 显示真实余额；无接口 provider 不报错、只显本地用量。

---

## 2. 分期路线图与依赖

```
WP-A1 (文件型快照切换) ──┬─→ WP-A2 (Keychain 切换)
                         ├─→ WP-A3 (刷新/文案)
                         └─→ WP-B  (多身份额度)
WP-C (API 余额) ── 独立，可与 A 并行
```

| 顺序 | WP | 依赖 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | A1 | 无 | 低 | 单独根治重登；grok/codex 零风险 |
| 2 | C | 无 | 中 | 复用现有 apiBalance，逐 provider 适配 |
| 3 | A2 | A1 | 中 | Keychain 写回，首次可能弹授权 |
| 4 | B | A | 低 | QuotaService 已命名空间化 |
| 5 | A3 | A1 | 低 | 刷新与文案打磨 |

---

## 3. 全局约束（所有 WP 通用）

- **安全**：所有快照经 `safeStorage` 加密（macOS Keychain-backed），与 `secret-*.bin` 同级，受 unlock gate 保护；API key 外呼仅走 provider 官方 host 白名单。
- **原子性**：文件槽位写回用临时文件 + rename，权限 0600；Keychain 用 `-U` 覆盖。
- **不解析重建凭证**：快照存**原样 bytes**，最大程度抗 CLI 版本格式漂移。
- **并发**：切换前若该 host 有活跃 session 应提示或阻止（避免运行中掉凭证）。
- **迁移**：旧 `accounts.json` 无新字段 → 视为「无快照」，首次登录补建；向后兼容。
- **回退**：`swappable=false` 或无快照的 host 保持现有「重新登录」行为，UI 明确标注不支持本机快切。
- **删除**：删账户一并 `clearOAuthSnapshot` + `clearAccountKey`。
- **测试**：新增逻辑均配单测；adapter 的 exec/fs 用 mock，勿触真实 Keychain/磁盘 live 槽位。
- **i18n**：新增文案键同时补 `src/shared/i18n/messages.ts` 的所有 locale。

## 4. 交付物清单（新增/改动文件汇总）

**新增**
- `src/main/accounts/credentials/adapter.ts`（接口 + `adapterFor`）
- `src/main/accounts/credentials/fileAdapter.ts` / `keychainAdapter.ts` / `index.ts`
- `src/main/quota/hostPaths.ts`（共享路径常量）
- `src/main/quota/apiBalanceService.ts`（泛化余额，或改造 deepseekBalance.ts）
- 对应 `*.test.ts`

**改动**
- `src/main/store/SecretStore.ts`（快照读写 + warm）
- `src/shared/accounts.ts`（字段 + `applyExclusiveOAuthSignIn` + `accountShowsOAuthQuota`）
- `src/main/store/AccountStore.ts`（`coerceAccount` 默认值）
- `src/main/accounts/service.ts`（`activateAccount` + `toAccountView` 透传/放宽/balance）
- `src/main/quota/QuotaService.ts`（多身份）
- `src/main/quota/{claude,codex,cursor,grok,opencode}Usage.ts`（token ctx）
- `src/shared/apiBalance.ts`（泛化 source + 路由）
- `src/shared/ipc.ts`（IPC 常量 + `AccountView` 字段 + `accounts.activate`）
- `src/preload/index.ts`（`activate`）
- `src/main/index.ts`（activate handler、登录后快照、identitiesOf、余额刷新、remove 清理）
- `src/renderer/src/components/settings/AccountsSettings.tsx`（切换态、余额、额度可见性）
- `src/shared/i18n/messages.ts`（文案）
