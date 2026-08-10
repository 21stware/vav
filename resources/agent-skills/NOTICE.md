# Third-party Agent Skills — Notices

This directory vendors Agent Skills (SKILL.md packages) so the vav coding agent can
load specialized workflows via the `load_skill` tool.

## Not included (copyright)

Anthropic’s **document creation skills** (`docx`, `pdf`, `pptx`, `xlsx` under
https://github.com/anthropics/skills) are **source-available but not open source**.
Their LICENSE forbids extracting, retaining copies outside Anthropic Services,
creating derivative works, and redistributing. vav does **not** ship those files.

## Included — Apache License 2.0

From [anthropics/skills](https://github.com/anthropics/skills) (example / open-source skills):

- frontend-design
- algorithmic-art
- web-artifacts-builder
- theme-factory
- webapp-testing
- doc-coauthoring
- internal-comms
- mcp-builder
- canvas-design (SKILL.md only; large bundled font files omitted)

Each skill folder retains its `LICENSE.txt` when present. Full Apache-2.0 text is in those files.

### OfficeCLI (binary + skill)

From [iOfficeAI/OfficeCLI](https://github.com/iOfficeAI/OfficeCLI) (Apache-2.0):

- Skill package: `officecli/` (SKILL.md documents the CLI; no install step — VAV ships the binary)
- Native binary: fetched at build time into `resources/bin/officecli` (see `scripts/fetch-officecli.mjs`), packaged as `extraResources`

Prefer `officecli` for OOXML create/edit. MiniMax `docx` / `xlsx` / `pptx` skills remain as fallbacks.

## Included — MIT License

From [MiniMax-AI/skills](https://github.com/MiniMax-AI/skills):

- pptx (upstream: pptx-generator)
- docx (upstream: minimax-docx)
- xlsx (upstream: minimax-xlsx)
- pdf (upstream: minimax-pdf)
- frontend-dev
- fullstack-dev
- gif-sticker (upstream: gif-sticker-maker)
- shader-dev

Copyright (c) 2026 MiniMax — see each folder’s LICENSE and the upstream repository.
Some MiniMax skills credit additional open-source authors (taste-skill, Expo skills, etc.);
see upstream CREDITS.md: https://github.com/MiniMax-AI/skills/blob/main/CREDITS.md

## Usage

Skills are loaded on demand by the agent tool `load_skill`. The catalog is
`catalog.json`. Companion files (references/, scripts/) load with
`load_skill({ name, path: "references/..." })`.
