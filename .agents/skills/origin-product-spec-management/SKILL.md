---
name: origin-product-spec-management
description: Read, author, validate, and stay in sync with OriginAI product design specs written in RPML. Prefer OriginAI MCP tools when connected; otherwise use the originai CLI. Use when reading a project's design specs, implementing code from them, tracking release diffs, writing specs back from a codebase, or checking that code matches the defined product.
---

# Origin Product Spec Management

This skill connects [OriginAI](https://getoriginai.com) product design specs to your
coding agent. Origin specs are **RPML** documents — each `.rpml` file is one
screen/region describing every state, permission variant, and edge case in a
single annotated layout.

**Tools (preferred order):**
1. **Origin MCP tools** — when `get_diff`, `list_documents`, `whoami`, etc. are
   available in this session, **use them**. Do not shell out to the CLI for the
   same operation. (Claude Code plugin runs local `originai mcp`; remote clients
   may use `https://mcp.getoriginai.com`.)
2. **`originai` CLI** (`bunx originai` / `npx originai`) — fallback when MCP is
   not connected (Codex, Pi, Hermes, OpenCode, skills.sh installs, CI). Never
   invent raw HTTP/curl against the API.

## Setup

**Once per machine (auth):**
```bash
npx originai login
# stores token in ~/.origin/settings.json — never commit
```

**Once per product repo (bind project + optional skill files):**
```bash
npx originai link --project 2303bf76-9a83-45ca-ba34-2bf04b35de6b
# or: --skill / --claude-code / --codex / --cursor / --all
```

Project config is in `.origin.json` (committed, no secrets):
```json
{
  "api_url": "https://vehcxhxmmfasujqtwdat.supabase.co/functions/v1/origin-api",
  "project_id": "2303bf76-9a83-45ca-ba34-2bf04b35de6b",
  "release_hash": null,
  "sync_readme_badge": false
}
```
(`sync_readme_badge` is optional — omit until the user has been asked; `true` keeps the README badge updated on `sync`.)


**Token model**
- **Humans (default):** `npx originai login` → `~/.origin/settings.json`.
  Claude Code plugin MCP uses local `originai mcp`, which reads this store.
- **CI / headless / remote-only MCP hosts:** `ORIGIN_TOKEN=oat_…`
  (create under Origin Settings → Access tokens). Never commit.
- Diagnose: `npx originai doctor`.

## Sync model (how the repo and Origin stay in sync)

`.origin.json` binds this repo to one Origin project and carries the sync pointer:

- `project_id` — the bound Origin project.
- `release_hash` — the last **published release** this repo synced to. This is
  the anchor for two-way sync. Origin shows every release's hash in its UI, so
  the hash in `.origin.json` tells you exactly which release the code reflects.
- `proposal_id` — optional **implementation bind**. Set it only when this
  repo's next GitHub PR is implementing that change request. The GitHub App then
  reviews `code diff` against `release hash <> proposal`. `write-document`
  never writes this field — staging a spec correction is not an implementation
  bind. Set it with `get-proposal-diff <id> --bind`, or by editing
  `.origin.json`. `sync` clears it only after a new release hash exists
  (the request was applied or closed, then published). Clear it yourself
  before a PR that only implements a published release.

All read commands (`list-documents`, `get-document`, `grep`, `find`, `get-diff`)
read the **latest published release snapshot** by default — never the live
workspace. So you always work against formally released specs, not in-progress
edits. Pass `--read-type workspace` to read the live `rpml_files` tree instead
(use this when indexing a pre-release project — see Workflow C), or
`--release-tag <hash>` to pin a read to a specific published release.

**Before staging anything, call `list-proposals --status all`** (or MCP
`list_proposals` with `status: 'all'`). If a similar change was dismissed, read
`dismiss_reason` and do not file the same Change Request again. If your previous
batch was applied, the spec has moved — re-read before continuing. Agents are
not notified when a token-authored change is decided; asking is the only channel.

What you can observe: `list-proposals` adds `decided_items[]` (each with
`decision` and `dismiss_reason`) to every change request that has a decision,
`get-proposal <id>` shows the same per item plus write-wave `batches[]` and
unified `diff`s (`--with-content` adds bodies), `list-proposal-comments <id>`
returns the discussion, and `list-proposal-reviews <id>` returns Ready / Not
ready conclusions (a stale row was recorded before the latest write).

**Writes after a release become Change Requests.** There is no
`create_change_request` tool — the first `write-document` / MCP `write_document`
creates the CR (`suggested: true` + `proposal_id`). Reads still default to the
latest published release. Report that to the user. Keep writing to the same CR
by passing `proposal_id` on `write-document` (or MCP `proposal_id`). Use
`--new-proposal` / `new_proposal: true` to open a second CR — never to
split README vs screens of the same indexing pass. One indexing pass is one
Change Request. Do **not** copy
that id into `.origin.json` unless this repo is about to implement it in code.
`commit-proposal` seals the current write-wave without marking the set ready;
`describe-proposal` writes the Change Request **message** a human reads:
**Issue** (`title` = one line, `note` = the problem), **Decisions** (what
you chose and why) and **Changelog** (which documents changed and what each
change does) in `rationale`. Do not leave this empty. `submit-proposal`
seals the wave **and** marks the set ready (and can take the same fields).
Use `comment-proposal` for follow-up discussion. You may stage, describe,
commit, submit, and comment — **never apply, dismiss, or record a conclusion**.
Direct writes only happen when the project has **no release yet**, or when
`project_write_mode` is `direct` (rare).

There are two directions, and knowing which one you are in matters:

- **Origin → repo (pull & implement).** If `.origin.json` has `proposal_id`,
  run `get-diff` (it becomes `get_proposal_diff`: release <> that change
  set) or MCP `get_proposal_diff`. Otherwise run `get-diff` between
  published releases. The response always includes a unified `diff`. **Read
  `diff` first.** Then `sync` to advance `release_hash` only after the
  change is a published release (apply in Origin, publish, then sync). Do
  **not** script a `get-document` loop over the diff ids.
  This is Workflow A/B below.

- **Repo → Origin (index & write).** If the Origin project has **no release yet**,
  read the codebase, author RPML content, `validate --content`, then
  `write-document --content` to push it **directly to Origin** — do **not** save
  `.rpml` files locally. Needs a read-write token. If this repo is unbound,
  `create-project` then `npx originai link --project <id>`. Read back what you
  wrote with `list-documents --read-type workspace` (the default release read
  returns 404 until a release is published). The user then publishes a release
  in Origin, producing a new hash your next `get-diff` will sync to.
  **After the first release, `write-document` creates a Change Request** — a
  human applies it in Origin. Always `list-proposals --status all` first.
  Indexing a released project is **one** Change Request (README + every
  screen). Do not submit after the README. `describe-proposal` then
  `submit-proposal` when the whole pass is done.
  This is Workflow C (pre-release) or Workflow D (after a release) below.

Always keep `.origin.json` committed so every teammate shares the same sync
pointer; never commit the token.

## Release badge (optional README) — how to add it

Public release pages ship a badge image:
`https://spec.getoriginai.com/<project_id>/<release_hash>/badge-dark.svg`
(also `badge-light.svg`).

**Use HTML for the link** (`<a target="_blank" rel="noopener noreferrer">`
wrapping `<img>`), not `[![…](…)](…)` — CommonMark cannot open a new tab.
GitHub and most Markdown hosts allow this subset.

**Never add or edit the badge silently.** Follow this procedure when the user
asks for a badge, or after a successful `sync` if `.origin.json` has no
`sync_readme_badge` field yet (ask once, then stop asking).

### Step-by-step (agent)

1. **Read** `.origin.json` and take `project_id` + `release_hash`.
   - If `release_hash` is `null`, run `bunx originai get-diff` (or MCP
     `get_diff`) and use the response `to_hash` as the release hash. If there
     is no published release yet, tell the user to publish in Origin first —
     do not invent a hash.
2. **Ask the user** (quote this intent):  
   “Add an OriginAI release badge to `README.md` and keep it updated on
   `originai sync`? (yes / no)”
3. **On decline**: set in `.origin.json`: `"sync_readme_badge": false`
   (keep other fields). Commit if appropriate. Stop.
4. **On agree**:
   - Set `"sync_readme_badge": true` in `.origin.json` (merge; do not wipe
     `api_url` / `project_id` / `release_hash`).
   - Ensure root `README.md` exists (create a minimal one if missing).
   - Insert or replace this **exact** marker block (substitute real ids from
     step 1; prefer `badge-dark`). The `<a target="_blank">` is required:

```md
<!-- originai-release-badge:start -->
<a href="https://spec.getoriginai.com/PROJECT_ID/RELEASE_HASH" target="_blank" rel="noopener noreferrer"><img src="https://spec.getoriginai.com/PROJECT_ID/RELEASE_HASH/badge-dark.svg" alt="OriginAI" /></a>
<!-- originai-release-badge:end -->
```

   - Place the block after the first `#` heading, or at the top of the file.
   - If the markers already exist, replace only the content between them.
5. **Optional**: run `bunx originai sync` so a newer CLI can refresh the same
   marker block when `release_hash` advances. If sync asks about the badge and
   the field is already set, it will not ask again.
6. Show the user the badge Markdown and remind them to commit
   `.origin.json` + `README.md`.

### Rules

- Do **not** set `sync_readme_badge` without an explicit yes/no from the user.
- Do **not** edit README badge content when `sync_readme_badge` is `false`.
- When `sync_readme_badge` is `true` and you advance `release_hash` via sync,
  update the marker block to the new hash (or rely on `originai sync` to do it).

## Understanding RPML (read this before authoring)

RPML replaces time with space: one `.rpml` = one `<page>` with exactly one
`<view>`, snapshot built from RPML primitives, `data-pin="N"` on every meaningful
region, and a matching top-level `<annotation id="N">` per pin. Conditional states
go in `<enum>`; cross-cutting notes in `<annotation-global>`. Read the bundled
references **in `rpml/`** (do not re-derive them):

- `rpml/references/spec-summary.md` — root structure, attributes, rules at a glance.
- `rpml/references/element-index.md` — every element + its attributes.
- `rpml/references/practise.md` — the authoring method (IA-first, visual-weight mapping, update restructure, recursive decomposition, coverage matrix).
- `rpml/references/example-reference.rpml` — a complete worked example (the quality bar).
- `rpml/prompts/generate-rpml.md` — author a new `.rpml` from requirements/code (IA gate before layout).
- `rpml/prompts/rpml-to-code.md` — extract a spec from `.rpml` and implement it.
- `rpml/prompts/rpml-diff-impact.md` — classify what changed between two versions.
- `rpml/prompts/review-rpml.md` — check an existing `.rpml` for completeness.

## Tools & commands

**Never construct raw HTTP (curl/fetch) to Origin yourself.** Use MCP tools or
the `originai` CLI only.

### A. Origin MCP (preferred when connected)

Local bridge (Claude plugin default): `npx originai mcp` (uses `originai login`).
Remote HTTP (advanced/CI): `https://mcp.getoriginai.com` with Bearer `ORIGIN_TOKEN`.
Tool names match origin-api actions (snake_case). Pass `project_id` from
`.origin.json` when required. Default reads = latest **published release**.

| MCP tool | Use for |
|----------|---------|
| `whoami` | Token owner + project count |
| `list_projects` | Owned projects + latest release hash |
| `create_project` | New empty project |
| `list_documents` | File tree (`read_type`: release\|workspace) |
| `get_document` | One file + content |
| `get_diff` | Unified diff between hashes; default embeds to-side content. Prefer this over looping `get_document`. |
| `grep_documents` / `find_documents` | Search content / names |
| `write_document` / `delete_document` / `delete_documents` | Workspace writes. After a release these **create or extend a Change Request** (`suggested: true` + `proposal_id`). There is no `create_change_request` tool. Pass `proposal_id` or `new_proposal`. |
| `list_proposals` / `get_proposal` / `get_proposal_diff` / `describe_proposal` / `submit_proposal` / `commit_proposal` | Change review loop; describe_proposal writes Issue / Decisions / Changelog; release <> proposal diff |
| `comment_proposal` / `list_proposal_comments` / `list_proposal_reviews` | Discuss a change request; read Ready / Not ready (agents never conclude) |
| `validate` | RPML check (`source` and/or `file_id`) |
| `search_shots` / `get_shot` / `list_shot_facets` | Layout shots. MCP: `search_shots`. In-app agent uses `retrieve_shots` (same catalog, different name). Pick by platform / business / IA; widget galleries are composition only |
| `sync_origin_json` | Compute the `.origin.json` pointer to write after implementing a published release |
| `list_webhooks` / `create_webhook` / `delete_webhook` | Outbound events (`release.published`, `proposal.decided`, `proposal.commented`) |

After implementing a release, call MCP `sync_origin_json` and write `origin_json` into `.origin.json`, or run CLI `bunx originai sync`.

### B. OriginAI CLI (fallback)

Prefer `bunx originai <command>` (~40ms) over `npx originai` (~1.2s).

| Command | Description |
|---------|-------------|
| `list-projects` | List accessible projects |
| `create-project --name "<n>" [--description "<d>"]` | Create a new empty project (read-write) |
| `list-documents` | File tree from latest release (or `--read-type workspace` for the live tree) |
| `get-document --id <file-id>` | Get single document with content |
| `get-diff` (`diff`) | Diff to implement. Bound `proposal_id` → release <> proposal; else last sync vs latest release. |
| `sync` | Advance `release_hash` to the latest release (after implementing a diff) |
| `grep --pattern "<regex>" -p <project-id>` | Search content across files in latest release |
| `find --file-pattern "<regex>" -p <project-id>` | Find files by name in latest release |
| `validate --content "<rpml>"` (`-c`) | Validate an inline RPML string **locally** (no network, no token) |
| `validate --id <file-id>` (`-i`) | Validate a released document (remote — reads latest release) |
| `write-document --name "<name>" --content "<rpml>"` | Create/update file (`--proposal <id>` / `--new-proposal`) |
| `write-document --id <id> --name "<name>" --content "<rpml>"` | Update existing file |
| `delete-document --id <file-id>` | Delete file (read-write token) |
| `delete-documents --ids <id1>,<id2>,...` | Batch delete files (read-write token) |
| `list-proposals --status all` | Change requests (call before staging). Decided sets carry `decided_items[]` with `dismiss_reason` |
| `get-proposal <id> [--with-content]` | Items, batches, diffs, purpose; `--with-content` adds bodies |
| `get-proposal-diff <id> [--bind]` | Release <> proposal; `--bind` writes `.origin.json` `proposal_id` |
| `describe-proposal <id> --title "…" [--note "…" --rationale "…" ]` | Change request message: Issue (`title`/`note`), Decisions + Changelog (`rationale`) |
| `submit-proposal <id> --title "…"` | Mark ready. Same Issue / Decisions / Changelog fields if not described yet |
| `commit-proposal <id> [--note "…" ]` | Seal the current write-wave without marking ready |
| `comment-proposal <id> --body "…" [--item <itemId>]` | Discuss a change (never conclude) |
| `list-proposal-comments <id>` | Read the discussion on a change request |
| `list-proposal-reviews <id>` | Ready / Not ready conclusions |

Short aliases: `ls`, `ls-docs`, `get`, `create`, `write`, `delete`/`rm`, `diff`.
Flags: `-p` project, `-i` id, `-n` name, `-c` content. Project-scoped commands
need `-p` or `.origin.json`.

**CLI output:** data commands print pure JSON on stdout (pipe to `jq`); tips go
to stderr.

All reads default to the **latest published release**. `--read-type workspace`
(or MCP `read_type: "workspace"`) for live pre-release trees.

## Workflows

Pick the entry that matches how you arrived. **Both directions are first-class.**

- **Repo → Origin** (existing codebase; empty or unbound project): **C**. If
  unbound, `create-project` then `npx originai link --project <id>`.
- **Origin → repo** (implement a published release): **A** / **B**.
- **After a release, update specs from code or an agent:** **D**.
- GitHub `originai / spec-review` is a **check, not a merge gate** (findings
  are informational / `neutral`).

**A. Understand a project's specs → implement**
1. If `.origin.json` has `proposal_id`, `get-diff` / MCP `get_proposal_diff` (release <> that change request). Otherwise `get-diff` (last release vs latest). Response includes `summary` + `files[]` with unified **`diff`**. **Implement from `diff` first**.
2. `get-document` only for an unchanged dependency; prefer `grep`/`find` to locate it. Follow `rpml/prompts/rpml-to-code.md`.
3. `sync` to advance `release_hash` once the code reflects the latest release.
4. **Release badge (optional):** if `.origin.json` has no `sync_readme_badge` yet, follow **Release badge** above — ask the user, then write the flag + README marker block (never silently).

**B. Track a new release → implement the diff (scenario: spec changed)**
1. `get-diff` returns added/modified/renamed/deleted files with **unified `diff` (+/- markers) always**, plus to-side full `content` by default (omit bodies with `--content-mode none`).
2. Classify impact per `rpml/prompts/rpml-diff-impact.md`, then implement only what changed — apply each file's `diff` first; use `content` when you need the full to-side body.
3. `sync` to advance `release_hash` once implemented.
4. If `sync_readme_badge` is `true`, refresh the README badge marker block to the new `release_hash` (see **Release badge**).

**C. Index a codebase → write specs directly to Origin (no local files)**

Judge the project phase by running `list-projects` (check `latest_release`) and,
if a release exists, `list-documents`:

- **Empty project (no release, no documents)** — If this repo is not linked,
  `create-project` then `npx originai link --project <id>` so `.origin.json`
  exists. Initialize **fully** in one pass. Write `README.rpml` **first** — it
  is the product-design document (`mode="doc"`), not a prototype screen. Author
  it from your understanding of the codebase, `validate --content`, then
  `write-document --name "README.rpml" --content "<rpml>"` to push it to Origin.

  Then **immediately continue**: for every page/route listed in the README's
  page/route planning, author one `.rpml` prototype screen spec, `validate
  --content`, and `write-document` it to Origin. Do **not** stop and wait after
  the README — drive the whole initialization to completion in this pass. Only
  pause if the user explicitly asks to review the README before screens.

  `README.rpml` must cover: product overview, functional modules, page/route
  planning (complete and self-consistent — include login/signup flow, admin
  screens, and core product logic with no gaps), key interaction flows
  (`<diagram>` with Mermaid), and roles/permissions if applicable. For mobile
  pages, include tab structure and main UX flow descriptions. The page/route
  planning section is the worklist for the screen specs you write next — make
  it exhaustive, because every entry becomes a `.rpml`.

  Skeleton:
  ```html
  <page title="Product Name - Product Design Document" mode="doc">
    <doc-heading level="1">Product Name</doc-heading>
    <doc-paragraph>Overview…</doc-paragraph>
    <doc-list type="bullet">
      <doc-list-item>Product flow</doc-list-item>
    </doc-list>
    <diagram> // core user flow
flowchart LR
  A[User login] --> B[Enter home]
    </diagram>
    <diagram> // core feature conversion
flowchart LR
  A[User login] --> B[Enter home]
    </diagram>
    <doc-list type="bullet">
      <doc-list-item>Feature breakdown by priority</doc-list-item>
    </doc-list>
  </page>
  ```

  After writing all specs, run `list-documents --read-type workspace` and
  confirm every page/route in the README has a corresponding `.rpml`. Report
  what was written and any gaps to the user, and remind them to publish a
  release in Origin.

- **Only README.rpml exists** — Continue the initialization: author the
  remaining prototype screen specs (one `.rpml` per page/route the README
  planned that hasn't been written yet), validate + write each, until every
  planned page exists in Origin. Don't wait to be asked — drive it to
  completion, then report and remind the user to publish a release.

- **Prototype screens already exist, no release yet** — Keep writing the
  workspace directly: create, update, or delete specs as needed, then remind
  the user to publish.

- **A release already exists** — Do **not** write the workspace directly.
  Follow **Workflow D**, still as **one** Change Request for the whole
  index: README + every screen, then submit once. Do not submit after the
  README and do not pass `new_proposal` to split them.

For every spec you author:
0. **Retrieve → constrain.** `list_shot_facets` returns a path array. Pick by platform / business / IA, then MCP `search_shots` (in-app agent: `retrieve_shots`) with those paths — listed paths always have data. Use the hit's IA (`summary`, `primary_action`, `ia_text`) and RPML recipe as the structural standard. Widget galleries are composition only.
1. Read the relevant code; author RPML content following
   `rpml/prompts/generate-rpml.md` and the references (IA gate before layout).
2. `validate --content "<rpml>"` — **local** check, no network needed. Fix
   every error before writing. Do **not** save `.rpml` files locally; keep the
   content inline and write directly.
3. `write-document --name "<name>.rpml" --content "<rpml>"` (read-write token).
   Use `create-project` then `npx originai link --project <id>` if no project
   is bound yet.
   Before the first release this writes the workspace directly. After a release,
   follow Workflow D: keep staging into the same CR; submit only when the
   whole pass is complete — do not submit after the README.

**Before the first release**, remind the user to **publish** — default reads
(`list-documents`, `get-diff`, etc.) cannot see workspace content until a
release exists. To read back what you just wrote, use
`list-documents --read-type workspace` / `get-document --read-type workspace
--id <id>`.

**D. Iterate specs after a release (change request loop)**

Once a release exists, writes from agents no longer mutate the workspace. There is
no `create_change_request` tool. Use this loop every time you update specs
(new screen, confirmed code/spec gap, copy fix). `suggested: true` is success.

1. **Read decisions first.** `list-proposals --status all` (MCP `list_proposals`
   with `status: "all"`). If a similar change was dismissed, read
   `dismiss_reason` and do not file the same dismissed Change Request unless you
   addressed the feedback.
2. **Read the current spec from the release** (`get-document` / `grep` /
   `find` — default release reads). Do not assume live workspace content.
3. Author RPML, `validate --content`, then `write-document` (or MCP
   `write_document`). Expect `suggested: true` and a `proposal_id`.
4. Keep staging into the **same** request: pass `proposal_id` / `--proposal`
   on later writes (including deletes). Use `--new-proposal` /
   `new_proposal: true` only for a second, unrelated set — never to split
   README vs screens of the same indexing pass. One indexing pass is one
   Change Request: write README.rpml first, then every screen, all on this
   id. Do not submit after the README.
5. **Describe** with `describe-proposal` / `describe_proposal`: Issue
   (`title`, `note`), Decisions + Changelog (`rationale`). Do not leave this
   empty. Safe to call before more documents; it does not finish the CR.
6. **Submit** with `submit-proposal` / `submit_proposal` when the whole
   pass is done (README + every planned screen). Optionally
   `comment-proposal` for follow-up. You may stage, describe, commit,
   submit, and comment — **never apply, dismiss, or record a conclusion**.
7. Tell the user: open **Change requests** in Origin, apply or dismiss, then
   **publish a new release**. Staging is not publishing; default reads stay on
   the old snapshot until they publish.
8. After they publish: `get-diff` → implement code → `sync`. Bind
   `.origin.json` `proposal_id` with `get-proposal-diff <id> --bind` **only**
   when this repo's next PR implements that request. Do **not** copy a staging
   id into `.origin.json` just because you wrote it.

**E. Consistency review (scenario: code has behavior not defined in the specs)**
This is guidance for *you, the agent* to perform — Origin does not auto-detect
gaps. When you notice code implementing a feature/behavior:
1. Search the released specs for it: `grep --pattern "<feature>"` and
   `find --file-pattern "<screen>"`.
2. If no spec covers it, treat it as an **undefined product behavior**. Do NOT
   silently invent or assume the intended design.
3. Report a clear analysis to the user: what the code does, which screen/spec it
   would belong to, and why it appears undefined. Ask whether it should be
   specced, changed, or removed.
4. Only after the user confirms the intended behavior, author the spec
   (`rpml/prompts/generate-rpml.md` → `validate` → `write-document`). Before a
   release this writes the workspace; after a release follow **Workflow D**.

Always `validate --content` RPML before `write-document`. Validation runs
**locally** (no network, no token). Never save `.rpml` files locally — author
content inline and write directly to Origin.

