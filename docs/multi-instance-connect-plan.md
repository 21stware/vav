# 多实例 Connect 修复 — 实施规格

> 目标读者：负责落地的实现模型 / 工程师。本文件把修复拆成 5 个可并行分派的工作流（WS），每张任务卡给到「目标 / 涉及文件 / 精确改动 / 关键片段 / 验收 / 回归」。行号为撰写时的当前值，实现前请以实际文件为准（用符号名定位更稳）。

## 0. 背景与目标

VAV 是「一个控制平面 + 多渲染端」的产品矩阵：`vavd` 是核心 headless server（会话 / 密钥 / 文件 / PTY / agent 回合都在它里面），`vav-desktop` / chrome extension / iOS / android 都是它的壳；`vavc`（herdr 式控制客户端）、`vav-cli`/`vavcli`（Claude Code 式 agent CLI）也都连到同一个 vavd。桌面发布版默认内嵌一个 spawned loopback vavd，`vavc` 默认连的就是本机这个默认 vavd 实例。

桌面侧栏底部是一个**横向手风琴**（`SidebarServiceBar`），每一格是一个 vavd 进程（= 一台设备 / 一个连接对象）。切换手风琴同时切换「对话列表内容」和「后台 server」。

**三个要修的问题：**

- **A（legacy）**：connect / 配对仍会打开一个独立窗口。
- **B**：手风琴切换后，Settings 没有跟随当前连接对象。
- **C（多实例核心）**：设置作用域绑错实例——`providers` 应面向**当前连接的 vavd**，`appearance` 应面向**当前 desktop 的 per-connection profile**，但现在两者都写死到「本机默认 vavd / 本机全局」。

**目标模型（一句话）：** 一个主窗口 + 一个手风琴。选中哪个连接，主窗口、Settings、以及所有「面向 vavd 的设置读写」就整体切到那个 vavd 的 daemon client；「面向 desktop 的设置」（尤其 appearance）按 `(本机, 连接对象)` 维度存在本机、默认继承该连接 vavd 自己的样式、本地覆盖不回写远端。配对/连接全部内联，不再开独立窗口。

## 1. 现状架构速览（关键事实）

- **设置分层已存在**：`src/shared/hostSettings.ts` 的 `HOST_SETTINGS_KEYS` 定义了「落在 vavd」的键（`cliAgents` / `defaultAgentId` / `providerListOrder` / `disabledAgentModels` / `defaultAgentModels` / `apiEndpoint` / `defaultModel` / `maxTokens` / web tools / workspace dirs / `swarmModeEnabled` / `logRetentionDays` / vendor tray 开关 …）；其余（appearance、字体、热键、窗口 chrome、`machineAppearances`）留在 client。**这正是目标模型。**
- **设置路由绑死本机**：`registerSettingsIpc` 的 `remote()` 恒等于 `daemonAttach.localShellClient()`（`packages/vav-desktop/src/main/index.ts:6890`），读（`mergedSettings`）、写（`settingsUpdate` 的 hostPatch）、host secret、广播（`publishMergedSettings` `index.ts:6670`）全部走这个固定 client。
- **daemon 端 settings 能力齐全**：`DaemonServer.ts:1189` 起处理 `settings.get/update/reset/setSecret/secretHint/revealSecret`；headless vavd（`packages/vavd/src/vavd.ts:220`）与被控 desktop（`src/main/host/VavControlPlane.ts:1074`）都挂了 `settingsCatalog`。→ 手风琴列出的连接对象都具备 settings plane。
- **单窗口切换已就绪**：`hosts.show`/`openFolder` → `showHostWindow` → `activateMainShellMachine`（`index.ts:5701`）原地激活并发 `IPC.hostsActivate`。切 vavd 本身不开新窗。
- **仍开新窗的只有配对**：`openConnectWindow`（`index.ts:3293-3356`）开独立 `ConnectWindow`，由手风琴 `openMore` 的 `pairDevice`（`SidebarServiceBar.tsx:64` → `window.vav.window.openConnect()`）触发。
- **多窗口 legacy 死代码**：`createWindow({machineId})` 非 local 分支（`index.ts:3136-3148`）+ `hostWindows` map + `hostWindowOf`（`index.ts:3033` 已忽略入参、恒返回 mainWindow）。现无调用者带 machineId。
- **激活态未跨窗**：`activateMainShellMachine` 只 `safeSend` 给 mainWindow；Settings 是独立窗口独立 store，其 `windowMachineId` 由 URL `?machine=` 决定（`sessionStore.ts:679 readWindowMachineId`），Settings 加载不带该参数 → 恒为 `local`。`AppearanceSettings` 的「连接主题」选择器 `themeMachineId`（`AppearanceSettings.tsx:30`）因此默认停在 local。
- **appearance per-connection 只对一半**：`machineAppearances[machineId]` 已存 per-connection 覆盖（本机、不回写远端）；但 `appearanceForMachine`（`src/shared/machineAppearance.ts:11`）无覆盖时回退**本机全局** `settings.theme`，而非「远端 vavd 自己的样式」。

## 2. 决策记录（已确认）

- **D1**：appearance 的「远端 base」= `theme` / `colorTint`（tint）/ `customAccentColor`（accent）/ `surfacePattern`（pattern）。custom pattern 见 WS-4 注意项（远端 custom 图片拿不到，base 侧降级 `none`）。
- **D2**：配对内联到 `Settings → Connect`；配对成功不再关窗，原地刷新列表。
- **D3**：不做「该连接不支持远程配置」的只读 UI（同版本正常使用不会出现）。仅保留最小护栏：激活对象是已连接远端却 `settings.get` 抛错/空时，**丢弃该次 host patch 并轻提示**，不静默回退写本机（防旧版 vavd 串台）。可能落空的三种场景仅为：① 离线/未拨通（可用性，走现有 online 态）；② 版本错配的旧 vavd；③ local in-process（写本机 store 本来就正确，非「不支持」）。
- **D4**：多窗口 legacy 一并删除（清单见 WS-1）。

## 3. 建议实施顺序

**WS-2 → WS-3 → WS-4 → WS-1 → WS-5**。先打通「激活连接」的跨窗共享状态（WS-2），再挂设置路由（WS-3/4），最后拆窗口（WS-1）与交互打磨（WS-5），避免中途 UI 悬空。

---

## WS-2 — 把「当前激活连接」升为全窗口共享状态

**前置于 WS-3/WS-4。**

**目标**：主窗口切连接 → Settings 窗口（及未来任意窗口）同步感知；主进程 settings 路由能拿到「当前激活 machine」。

**涉及文件**：
- `packages/vav-desktop/src/main/index.ts`（`activateMainShellMachine`）
- `packages/vav-desktop/src/renderer/src/state/sessionBridges.ts`（`installHostsBridge` 的 `onActivate`）
- `packages/vav-desktop/src/renderer/src/state/sessionStore.ts`（`switchMachine`、bootstrap 初值）
- 已有可复用：`IPC.hostsActivate`、`IPC.hostsActive`（`registerHostsIpc.ts:77 → windows.activeMachineId() → mainShellMachineId`）、`window.vav.hosts.active()`、`window.vav.hosts.onActivate`

**精确改动**：
1. `activateMainShellMachine`（`index.ts:5708`）把 `safeSend(mainWindow.webContents, IPC.hostsActivate, id)` 改为向**所有窗口**广播（复用现有 `broadcast(IPC.hostsActivate, id)` 工具）。注意仍要保证 mainWindow 收到（geometry/title 逻辑不变）。
2. `switchMachine`（`sessionStore.ts:2194`）增加 light 语义：Settings/Connect 这类 light-bootstrap 窗口切 machine 时**只更新 `windowMachineId`**，跳过 `syncActiveConversationToMachine()`（light store 无对话列表）。实现方式二选一：
   - `switchMachine(machineId, opts?: { light?: boolean })`，light 时不调 sync；或
   - 在 light bootstrap 的 store flag 下让 `syncActiveConversationToMachine` 成为 no-op。
3. Settings/Connect 窗口 bootstrap 后对齐初值：light bootstrap 完成后主动 `await window.vav.hosts.active()`，把 `windowMachineId` 设为当前激活值（否则开 Settings 瞬间停在 local）。放在 `SettingsWindow.tsx` 的 bootstrap effect 里（`ready` 后）即可；`installHostsBridge` 的 `onActivate`（`sessionBridges.ts:66`）已会把后续变化同步进来。

**验收**：
- 主窗口切到 macmini，已打开或新打开的 Settings 顶部与内部作用域立即变为 macmini。
- local ↔ 远端来回切，Settings 的 `windowMachineId` 跟随，且不误触发对话列表重算。

**回归**：`e2e/specs/desktop-vavd-matrix.spec.ts`（Settings chrome / appearance 用例）。

---

## WS-3 — Settings（providers / host settings / secrets）路由到「当前激活连接」的 vavd

**多实例核心。**

**目标**：`Settings → Providers/Agents`、host secret（BYOK）、所有 host-scoped 字段，读写的是**当前激活 vavd** 的 daemon client。

**涉及文件**：
- `packages/vav-desktop/src/main/index.ts`（新增 `activeSettingsClient()`；改 `registerSettingsIpc` 的 `remote`（:6890）与 `publishMergedSettings`（:6670）；在 `activateMainShellMachine` 成功后触发一次 `publishMergedSettings`）
- `src/main/ipc/registerSettingsIpc.ts`（护栏：远端已连却 `settings.get` 空/抛错时，`settingsUpdate` 丢弃 host patch 并回传标记）
- 已有可复用：`daemonAttach.clientOf(id)`（`DaemonAttachService.ts:368`）、`localShellClient()`（:373）、`waitForControlPlane`、`mainShellMachineId`（`index.ts:474`）

**精确改动**：
1. 新增激活连接的 settings client 解析器（`index.ts`）：
   ```ts
   function activeSettingsClient(): DaemonClient | null {
     const id = mainShellMachineId
     if (isLocalMachine(id)) return daemonAttach.localShellClient() ?? null
     return daemonAttach.clientOf(id) ?? null
   }
   ```
2. `registerSettingsIpc` 的 `remote` 从 `() => daemonAttach.localShellClient() ?? null` 改为 `() => activeSettingsClient()`。这样 `mergedSettings`（读）、`settingsUpdate` 的 hostPatch（写）、`setHostSecret/hintHostSecret/revealHostSecret`（`registerSettingsIpc.ts:137-176`）全部跟随激活连接。
3. `publishMergedSettings`（`index.ts:6670`）改用 `activeSettingsClient()`；并在 `activateMainShellMachine` 完成激活后**主动 `void publishMergedSettings()`** 一次（切连接立即重算并广播，UI 不必等下次写）。
4. 切到远端需确保 daemon-role client 已拨通：在 `showHostWindow`/激活远端路径里，若 `clientOf(id)` 尚不存在，触发拨号（复用 `daemonAttach` 现有拨号入口，如 `waitForControlPlane` 之后的 daemon attach），避免切过去瞬间读到空。
5. **D3 护栏**（`registerSettingsIpc.ts` `settingsUpdate`）：当 `remote()` 返回了 client（远端已连）但 `settings.get`/`settings.update` 抛错或返回空对象时，**不要**落 `else if (!client)` 的写本机分支；改为丢弃 host patch、`localPatch` 照常写本机，并在返回值上带一个标记（如 `hostSettingsUnavailable: true`）供渲染层轻提示。local / in-process（`remote()` 返回 null）维持写本机不变。

**验收**：
- 手风琴在 local ↔ macmini 间切换，`Settings → Providers` 列表 / 默认 agent / 模型开关 / `apiEndpoint` / BYOK key hint 全部随之切换且互不污染。
- 在 macmini 改 provider → 只落 macmini 的 vavd state dir；本机默认 vavd 不受影响（用 `vavc settings get` 对两端交叉验证）。
- 旧版 vavd（无 host-settings RPC）：改 provider 时不静默写到本机，出现轻提示。

**回归**：`registerSettingsIpc.test.ts`（补：`mainShellMachineId` 为远端时 `remote()` 走 `clientOf`）；`e2e/specs/remote-daemon.spec.ts`、`vavc-cli.spec.ts`（`vavc settings set/get` 两端隔离）；`e2e/specs/desktop-vavd-matrix.spec.ts`。

**注意**：IPC handler 全局、不区分调用窗口——用 `mainShellMachineId` 作单一事实源即可（WS-2 已让主窗口与 Settings 窗口对「当前连接」认知一致）。写操作有网络往返，`AgentsSettings` 的乐观 list 要确认失败回滚。本 WS 只动 **settings / secrets** plane，fs/pty/plugins 等仍按现有 per-conversation host 路由，不动。

---

## WS-4 — Appearance 的 per-connection 语义（默认继承远端样式 + 本地覆盖不回写）

**目标**：查看 macmini 时默认用 macmini 自己的样式；本机（macair）可对「查看 macmini 时」做本地覆盖，覆盖只存 macair、不回写 macmini。字段范围 = theme / tint / accent / pattern（D1）。

**涉及文件**：
- `src/shared/types.ts`（`MachineAppearance`，:832）
- `src/shared/machineAppearance.ts`（`appearanceForMachine` / `patchMachineAppearance`）
- 远端 appearance base 的来源通道（见下）
- `packages/vav-desktop/src/renderer/src/lib/appearance.ts`（`useAppearance`，:279）
- `packages/vav-desktop/src/renderer/src/components/settings/AppearanceSettings.tsx`（`themeMachineId` / `machineLook` / 各 onChange）
- `packages/vav-desktop/src/renderer/src/components/sidebar/SidebarServiceBar.tsx`（`openMore` 主题子菜单勾选态）

**精确改动**：
1. `MachineAppearance`（`types.ts:832`）新增 pattern 字段：
   ```ts
   export type MachineAppearance = {
     theme?: ThemeMode
     colorTint?: ColorTint
     customAccentColor?: string
     surfacePattern?: SurfacePattern
     customSurfacePatternUrl?: string
     customSurfacePatternSize?: string
   }
   ```
2. 远端 appearance「只读 base」通道——**不要**把这些键加进 `HOST_SETTINGS_KEYS`（那会变成可写回远端，违反「不回写」）。改为独立只读拉取：
   - 复用 `daemonAttach.pullHostCatalog`（`index.ts:2332` 已有拉远端 catalog 机制）或新增一个 `settings.appearanceBase` 只读 RPC，返回该 vavd 自身的 `theme/colorTint/customAccentColor/surfacePattern`。
   - 在渲染层 store 里以 `appearanceBaseByMachine[machineId]` 缓存，随 host attach / activate 刷新。
3. `appearanceForMachine`（`machineAppearance.ts:11`）改签名接收 `base`（该连接远端自身 appearance），解析顺序变为 **本地 override（`machineAppearances[id]`）→ 远端 base → 本机全局**：
   ```ts
   export function appearanceForMachine(
     settings: Pick<AppSettings, 'theme'|'colorTint'|'customAccentColor'|'surfacePattern'|'customSurfacePatternUrl'|'customSurfacePatternSize'|'machineAppearances'>,
     machineId?: string | null,
     base?: Partial<MachineAppearance> | null   // 远端自身样式；local 连接传 null（回退本机全局）
   ): { theme; colorTint; customAccentColor; surfacePattern; customSurfacePatternUrl; customSurfacePatternSize }
   ```
   local 连接 `base = null`，行为与今天一致。
4. `patchMachineAppearance` 纳入 pattern 三字段的清洗（沿用现有「空值不落」规则）。
5. `useAppearance`（`appearance.ts:279`）与 `AppearanceSettings.tsx:41 machineLook` 改用带 base 的解析；pattern swatch 的「当前值」「勾选态」按解析结果显示。写入仍走 `patchMachineAppearance` 到本机 `machineAppearances`（`AppearanceSettings.tsx:122` 已如此），保证不回写远端。
6. `SidebarServiceBar.openMore` 主题子菜单（`SidebarServiceBar.tsx:31-55`）的当前值读取改用带 base 的解析，勾选态才正确。

**验收**：
- 无本地覆盖时：连 macmini 显示 macmini 的 theme/tint/accent/pattern；连 local 显示 macair 全局。
- 在 macair 上对 macmini 改主题/图案 → 只 macair 生效；macmini 本机或另一控制端表现不变。
- pattern 为远端 custom 时，base 侧降级为 `none`（macair 拿不到远端图片文件）；本地 override 仍可设 custom（用 macair 本地图片）。

**回归**：`e2e/specs/desktop-vavd-matrix.spec.ts`（appearance）；如有 `machineAppearance` 单测，补 base 三级解析用例。

**注意（pattern 特有坑）**：`surfacePattern='custom'` 依赖 `customSurfacePatternUrl`，它是指向某台机器本地文件的流 URL。远端 base 的 custom 无法跨机复用 → base 侧降级 `none`；本地 override 的 custom 正常。

---

## WS-1 — 移除 legacy Connect 独立窗口 + 多窗口死代码（D2 / D4）

**目标**：Connect / 配对不再开独立 BrowserWindow，统一走 `Settings → Connect`；清掉单窗口迁移遗留的多窗口死代码。

**涉及文件与精确删除清单**：
- **主进程 `packages/vav-desktop/src/main/index.ts`**：
  - 删 `connectWindow` 变量（:476）。
  - 删 `openConnectWindow` / `hideConnectWindow` / `fitConnectWindow`（3293-3356）。
  - 删/清 `connectWindow` 在 broadcast、焦点、菜单分支的引用（约 1848、2010-2017、2363、2428-2430、7683-7685）。
  - 删多窗口 legacy：`createWindow({machineId})` 非 local 分支（3136-3148）、`hostWindows` map、`closeHostWindow` 中对独立窗口 `destroy` 的分支、`syncHostWindows`（:3042）遍历 `hostWindows` 的逻辑；`hostWindowOf`（:3033）收敛为直接返回 mainWindow（或内联掉）。
- **IPC**：删 `registerWindowIpc.ts` 的 `openConnect/hideConnect/fitConnect`（类型 :13-15、handler :59-63）；删 `WindowIpcActions` 中对应字段；删 `ipc.ts:1487-1490`；删 `preload/index.ts:456-458`。
- **渲染层**：删 `packages/vav-desktop/src/renderer/src/ConnectWindow.tsx`；删 `main.tsx:14`（`lazy(ConnectWindow)`）与 `main.tsx:40`（`view==='connect'`）。
- **手风琴入口**：`SidebarServiceBar.tsx:64` 的 `pairDevice` 从 `window.vav.window.openConnect()` 改为 `useSessionStore.getState().openSettings('connect')`。
- **配对成功不关窗**：`ConnectSettings.tsx:249` 与 :270 的 `void window.vav.window.closeConnect()` 删除，改为原地清空输入 / 刷新列表（`MachinesSection` 已订阅 hosts 变化，通常无需额外动作）。
- **chrome-extension 空实现**：删 `packages/vav-chrome-extension/phone-ui/phoneVav.ts:1766-1770` 的 `openConnect/closeConnect/fitConnect`（保持 `window.vav.window` 接口面与桌面一致）。
- **保留** `ConnectSettings` 组件本身（继续服务 `Settings → Connect`）。

**验收**：
- 任何配对 / 切换路径都不再产生第二个 BrowserWindow（Settings 窗口除外）。
- 手风琴「…」→ pair device 打开的是 `Settings → Connect` 面板；配对成功后停留在该面板并显示新设备。
- `typecheck` 通过（IPC / 类型删除后无悬空引用）。

**回归**：`e2e/specs/desktop-vavd-matrix.spec.ts`（原 "Connect tunnel" 用例改为断言在 Settings 面板内完成配对，不再断言独立窗口）；`e2e/specs/remote-daemon.spec.ts`（配对失败提示 `Pairing failed` 仍在 Settings 内可见）。

---

## WS-5 — 手风琴交互打磨（收尾）

**目标**：让手风琴明确表达「切 server + 切 settings 作用域」。

**涉及文件**：`packages/vav-desktop/src/renderer/src/components/sidebar/SidebarServiceBar.tsx`；必要的 i18n key（`src/shared/i18n/messages.ts`）。

**精确改动**：
1. 展开态 `openMore` 菜单里，除现有 `serviceThemeSettings`（→ appearance）外，新增/明确一个「配置此 vavd」入口 → `openSettings('agents')`，把「providers = vavd」心智显式化。
2. 主题子菜单勾选态用 WS-4 的带 base 解析（见 WS-4 步骤 6）。
3. 复核 `local` 格拼接的 `· connect` 标签（`SidebarServiceBar.tsx:85`）在移除独立 Connect 窗口后的语义与文案。

**验收**：切换 / 配置心智清晰；不引入新窗口；勾选态正确。

---

## 4. 测试矩阵（手动 + e2e）

四种拓扑下分别验证 **providers 作用域** 与 **appearance 默认/覆盖**：
1. local-only（in-process host，无 spawned vavd）
2. local + spawned loopback vavd（发布版默认）
3. local + paired 远端 desktop
4. local + headless vavd（`npx @21stware/vavd`）

关键 e2e 锚点：`desktop-vavd-matrix.spec.ts`、`remote-daemon.spec.ts`、`remote-control.spec.ts`、`vavc-cli.spec.ts`、`registerSettingsIpc.test.ts`、`hostSettings.test.ts`。

## 5. 风险清单

- IPC handler 全局不分窗 → 依赖 `mainShellMachineId` 作单一事实源（WS-2 保证一致性）。
- 远端 settings 读写有网络往返 → 乐观 UI 的失败回滚（尤其 `AgentsSettings`）。
- 版本错配旧 vavd → D3 护栏防静默串台。
- pattern custom 跨机不可复用 → base 降级 `none`（WS-4）。
- 删 IPC / 类型后需全量 `typecheck`，注意 chrome-extension、preload、`WindowIpcActions` 三处接口面同步。
