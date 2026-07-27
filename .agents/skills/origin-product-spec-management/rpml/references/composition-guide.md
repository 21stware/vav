# RPML Composition Guide

**Audience:** agents generating RPML, and humans reviewing structure.  
**Role:** decision layer between the element catalog and full-page few-shots.  
**Not a substitute for:** `practise.md` (decomposition), `element-index.md` (API), or a complete annotated `.rpml` (pin/annotation depth).

The playground **Primitives Gallery** (Webapp → Gallery, desktop) and **Mobile Widget Gallery** (Mobile → Gallery, `device="mobile"`) show what components look like in fragments. This file says **which structure to choose** and **which full screens to copy**.

---

## 1. Layer model (non-negotiable)

```text
page / view / viewport / app-shell     → screen chrome & device
list / section / panel / form          → content blocks (semantic)
  list-item / form-item / …            → rows & fields (semantic)
flex-layout / layout (grid)            → geometry only (no business meaning)
ios-*                                  → iOS HIG chrome when device=mobile (prefer inside app-shell)
overlay-stage + modal|drawer|sheet     → dimmed stage + dialog (always pair)
```

| Layer | Responsibility | Do not |
| --- | --- | --- |
| Semantic containers | Express *what* (list of messages, settings group) | Encode ad-hoc spacing as the only structure |
| Layout primitives | Express *how spaced* (gap, columns, align) | Fake lists, cards-as-pages, or navigation |
| Platform (`ios-*`) | Match system look on mobile | Use for desktop admin shells |

---

## 2. Decision table (prefer left)

| Need | Prefer | Avoid |
| --- | --- | --- |
| Stack of similar rows (mail, chat, quotes, settings, orders) | `list` + `list-item` | `panel` + `flex-layout` per row |
| iOS Settings / system grouped lists | `ios-list` + `ios-list-item` | Generic list with fake chevrons only |
| Sidebar app navigation | `nav-item` inside `sidebar` / `app-shell` | Bare `list-item` without shell |
| Mobile screen chrome | `app-shell height="auto"` + `ios-navbar` / body / `ios-tabbar` | Outer `flex-layout` only for stacking chrome |
| Filter chips above a table/list | `filter-bar` | Hand-rolled chip row only |
| Page columns / dashboard tiles | `layout columns="…"` | Nested flex for every grid |
| Local alignment inside a card | `flex-layout` | New semantic component for one gap |
| Modal / confirm | `overlay-stage` > `modal` | Bare `modal` floating in a column |
| Mobile bottom sheet | `overlay-stage side="bottom"` > `sheet` | Absolute CSS |
| Desktop side panel | `drawer` (optionally in `overlay-stage side="…"`) | Wide `panel` pretending to be a drawer |
| Table of records | `table` + `table-row` (or `data-table`) | `list` of fake columns |
| Marketing / docs prose | `mode="doc"` + `doc-*` | Snapshot canvas for pure text |
| Agent transcript | `chat` + agent primitives | Full-width rows; never wrap turns in chat bubbles |

**List-item composition (generic list):**

```xml
<list inset header="Today">
  <list-item title="Alice" subtitle="Hey — still on for 7?" detail="6:32 PM" badge="2" chevron>
    <avatar initials="AL" size="40"></avatar>
  </list-item>
  <list-item title="AAPL" subtitle="Apple Inc." detail="198.42">
    <tag label="+1.24%" color="green"></tag>
  </list-item>
  <list-item icon="bell" title="Notifications" chevron>
    <toggle state="on"></toggle>
  </list-item>
</list>
```

- **Leading:** `avatar` / `icon` / `image-placeholder` / `status-dot`, or `icon="…"`.
- **Body:** `title`/`label` + `subtitle`.
- **Trailing:** `detail`, `badge`, `chevron`, or children (`tag`, `toggle`, `button`, …).

---

## 3. Few-shot index (study these, don’t invent chrome)

Open the playground (`bun run dev` → preview). Prefer **whole screens** over gallery fragments when generating a page.

### Mobile — group **Patterns** (primary few-shots)

| Screen | Use when generating… |
| --- | --- |
| iOS Settings (System) | System settings, preference groups, icon rows + switches |
| Messages — Conversation List | Chat inbox, notification list with avatar + preview |
| Mail — Inbox | Email / ticket queues (sender, subject, time) |
| Contacts — List | Address book, A–Z sections |
| Phone — Recents | Call log, activity rows with status |
| Watchlist — Quotes | Dense data rows, market / metrics lists |
| Stock — Quote Detail | Detail hero + chart + stats + dual CTA |
| Commerce — Home Feed | E-commerce browse, product grid |
| Profile — User Detail | User/profile header + stats + tabs |
| Moments — Social Feed | Social timeline, image posts |
| Music — Library & Now Playing Mini | Media library + mini player |
| Wallet — Cards & Activity | Balance card + transaction list |
| Home — Dashboard | App home, quick actions, recent activity |
| Search — Results | Search + filters + ranked hits |
| Notifications | Notification center / activity inbox |
| Empty State | Canonical empty + CTA |
| Form — Edit Profile | Settings-style edit form |
| Success — Order Placed | Post-action success / receipt |
| Error / Offline | Load failure + retry |

### Mobile — group **App Flows**

| Screen | Use when… |
| --- | --- |
| Login / Sign-up | Auth |
| Settings | App settings (not full iOS Settings) |
| Checkout / Cart | Cart + summary + pay bar |

### Web — playground **Webapp** product screens

| Screen | Use when… |
| --- | --- |
| Linear — Issue List / Inbox | Desktop issue queues |
| Stripe — Dashboard / Payments | Admin metrics + tables |
| Shopify Admin — Orders | Commerce back-office |
| Gmail / Superhuman — Inbox | Desktop mail |
| GitHub — PR / Diff | Dev workflows |
| Notion — Editor / Database | Docs + tables |

### Web — **Gallery / Primitives Gallery**

Use for **local composition** (how a filter+table card looks, how plan-cards sit together).  
Do **not** treat the multi-column gallery page as a product IA template.

### Mobile — **Gallery / Mobile Widget Gallery**

The mobile counterpart of the Primitives Gallery, in the **Mobile** tab. Each card shows **one bare widget or mobile-specific molecule** at `pane` level (no phone shell — the card is not a full `device="mobile"` page), so you can recall a control's shape and attributes. Coverage:

- **Chrome / nav** — `ios-navbar` (large / back), `ios-tabbar`, `toolbar` (bottom actions), large-title + `ios-segmented`.
- **Controls** — `ios-search`, `ios-segmented`, `ios-switch`, `ios-stepper`, `ios-button` (filled/tinted/plain/block), `slider` row, `chip` filter row, `rating`, `pin-input` OTP, and a composed **amount keypad** (`heading` + 3-col `button` grid + `ios-button`).
- **Rows** — `ios-list` (grouped), rich `ios-list-item`, notification rows, `chat` transcript (`user-message`/`agent-message` full-width), story/avatar rail.
- **Content molecules** — balance hero + quick actions, `stat-card` KPIs, mini `chart`, product tile, media rail, `progress`/`quota-bar`, `carousel`.
- **Overlays / feedback** — `ios-action-sheet`, `ios-alert`, `sheet`, `context-menu`, `sonner`/`toast`, `banner`/`header-notification`, permission prompt, `result`, `empty`.
- **AI** — mobile `chat` + `composer`.

Molecules with no dedicated primitive (amount keypad, balance hero, quick-action grid, story rail) are **composed** from `layout`/`flex-layout`/`button`/`avatar`/`panel`. One widget per card — it is a widget catalog, not a product IA template. Prefer **Mobile → Patterns** full screens for IA, and wrap chrome in `app-shell` when building an actual screen.

### Annotated depth bar

| Artifact | Use when… |
| --- | --- |
| `references/example-reference.rpml` | Full pin/annotation/enum depth (service desk) |
| `examples/03-list-with-filter.rpml` | List + filters |
| `examples/05-dashboard.rpml` | Dashboard |
| `examples/02-form-page.rpml` | Form-heavy screen |
| **Preview → Primitives → Layout Patterns** | Copy-paste recipes: multi-column form, modal form, inline field row, bento, dashboard grid, info header, master-detail |

When authoring complex forms or dashboards, **open Layout Patterns first** and adapt a recipe rather than inventing a single-column stack.

---

## 4. Screen skeletons (copy structure, replace content)

### A. Desktop app shell + list

```xml
<page title="Inbox" route="/inbox" description="Loaded inbox, first row selected">
  <view device="desktop">
    <viewport device="desktop">
      <app-shell>
        <sidebar width="220">…nav-item…</sidebar>
        <navigator height="52">…</navigator>
        <flex-layout direction="column" gap="0" flex="1">
          <filter-bar search="Search…" filters="Status,Owner"></filter-bar>
          <list>…list-item…</list>
        </flex-layout>
      </app-shell>
    </viewport>
  </view>
  <!-- annotations… -->
</page>
```

### A2. Large form (multi-column — do not stack every field)

**Problem:** 8+ fields as a single-column `<form>` looks tall and sparse.  
**Pattern:** put the form in a constrained panel, use `columns="2"` (desktop) or keep 1 column on mobile, and mark full-width fields with `span="all"`.

```xml
<page title="编辑资料" route="/settings/profile" description="双列表单，已填">
  <view device="desktop">
    <viewport device="desktop">
      <panel padding="32" elevation="1">
        <!-- max readable width: wrap form in a layout column, not full 1440 -->
        <layout columns="minmax(0,720px)" justify="center">
          <form columns="2" gap="16">
            <form-item label="姓名" required>
              <input state="filled" value="Oboo Cheng"></input>
            </form-item>
            <form-item label="邮箱" required>
              <input state="filled" value="oboo@example.com"></input>
            </form-item>
            <form-item label="手机">
              <input state="filled" value="138****0000"></input>
            </form-item>
            <form-item label="角色">
              <select state="filled" value="管理员" options="成员,管理员,只读"></select>
            </form-item>
            <form-item label="简介" span="all">
              <textarea state="filled" rows="3" value="产品设计…"></textarea>
            </form-item>
            <form-item span="all">
              <button label="保存" variant="primary"></button>
              <button label="取消" variant="secondary"></button>
            </form-item>
          </form>
        </layout>
      </panel>
    </viewport>
  </view>
</page>
```

Rules:
- Desktop / tablet wide forms → `form columns="2"` (or `3` for very dense admin).
- Mobile → single column (omit `columns` or use default).
- Textarea, address, submit row, section headers → `form-item span="all"`.
- Prefer a **max-width column** (~640–800px) centered in the viewport; full-bleed single-column forms on desktop look stretched and “long”.
- Group with `ios-list` / cards only when the product is settings-style; otherwise multi-column `form` is enough.

### B. Mobile app shell + list + tab bar

Prefer `<app-shell height="auto">` so `ios-navbar` / body / `ios-tabbar` are first-class chrome (same role as desktop sidebar + navigator). Do not hand-roll an outer column flex just for chrome stacking.

```xml
<page title="流水" route="/ledger" description="当前在「流水」Tab">
  <view device="mobile">
    <viewport device="mobile" height="auto">
      <app-shell height="auto">
        <ios-navbar title="流水" large></ios-navbar>
        <ios-segmented options="全部,支出,收入" active="全部"></ios-segmented>
        <scroll-area>
          <ios-list header="本月">
            <ios-list-item label="餐饮" detail="-¥52.00" icon="utensils" chevron></ios-list-item>
          </ios-list>
        </scroll-area>
        <!-- active = THIS page's tab (index or label), not always 0 -->
        <ios-tabbar items="首页,流水,报表,我的" icons="home,list,bar-chart-2,user" active="流水"></ios-tabbar>
      </app-shell>
    </viewport>
  </view>
</page>
```

### B2. Action sheet with money (children, not comma-CSV)

```xml
<!-- In an annotation enum-item, not the main snapshot chrome -->
<ios-action-sheet title="选择账户">
  <ios-list-item icon="building" label="招商银行" detail="¥52,360"></ios-list-item>
  <ios-list-item icon="wallet" label="微信钱包" detail="¥3,870"></ios-list-item>
  <ios-list-item icon="banknote" label="现金" detail="¥1,200"></ios-list-item>
</ios-action-sheet>
```

List-attr rule (also in generate-rpml): short tokens → `,`; items that may contain commas/money → `|` or **children**. Never `actions="招商 · ¥52,360,微信 · ¥3,870"`.

### C. Overlay as trigger → result (static)

In the **main snapshot**, show the **trigger** (button, row).  
In the **annotation enum**, show the **result** (`overlay-stage` + `modal` / `sheet`).  
Do not rely on click handlers.

---

## 5. Anti-patterns (reject in review)

1. **Pseudo-list:** repeating `<panel><flex-layout>…` instead of `list`/`list-item`.  
2. **Layout as product UI:** `div`-like nesting of flex only, no list/form/table semantics.  
3. **Orphan overlays:** `modal`/`sheet` without `overlay-stage` in fragments meant to show dimmed UI.  
4. **Comma-CSV with money/long text:** `actions`/`content` using `,` while items contain thousands separators — use children or `|`.  
5. **Empty segmented / hard-coded tab `active="0"`** on every mobile page.  
4. **Absolute / fixed** positioning for chrome RPUI already owns.  
5. **Empty shell snapshot** as the only state (no data, no selection, no error enum).  
6. **Brand cosplay** (copying IG/TikTok chrome) when the product is a tool/SaaS — prefer **Patterns**.  
7. **Hard min-widths** / desktop tables forced into mobile viewports without `density="compact"`.  
8. **HTML product controls** (`<button>`, `<input>`, raw `<div>` UI).  

---

## 6. How to use this in a generation prompt

**Minimal pack (recommended):**

1. This file (`composition-guide.md`) — decisions.  
2. One full few-shot closest to the target (from §3).  
3. `element-index.md` rows only for components you will use.  
4. `practise.md` for state coverage when the screen is non-trivial.

**Do not** paste the entire Primitives Gallery HTML into the model context.

**Do** say explicitly:

> Prefer Mobile **Patterns** and Web **product** screens for structure. Use Primitives Gallery only to recall a control’s attributes. Row stacks must use `list`/`list-item` (or `ios-list` on iOS settings). `flex-layout`/`layout` are geometry only.

---

## 7. Gallery map (fragments → intent)

| Gallery card theme | Teaches |
| --- | --- |
| App Shell — Sidebar Nav | Desktop chrome |
| Filter Bar + Data Table | Ops tables |
| Inbox / Settings lists | list-item slots |
| Sign-in / Checkout / Advanced inputs | Forms |
| Overlay Stage / Sheet + Drawer | Dialogs in-flow |
| Agent Conversation | Agent primitives |
| iOS Settings Fragment | ios-* grouping |
| Doc Mode Fragment | mode=doc typography |
| Plan Cards / Analytics / Kanban | Domain widgets |

When a card and a Pattern disagree, **Pattern (full page) wins** for IA; Gallery wins for control-level detail.
