#!/usr/bin/env node
/**
 * Seeds Application Support with five file-session demos for marketing
 * screenshots (each opened as a standalone file-preview window):
 *   PDF + summary + mermaid
 *   PPTX + modification toolcall
 *   CSV + Vega-Lite + PDF report
 *   DOCX/XLSX + editing
 *   Markdown + modification toolcall
 */
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(homedir(), 'Library/Application Support/vav')
const convPath = join(dataDir, 'conversations.json')
const settingsPath = join(dataDir, 'settings.json')
const fileSessionsDir = join(dataDir, 'file-sessions')
const fileIndexPath = join(fileSessionsDir, 'index.json')
const samplesDir = join(root, 'docs/marketing-samples')
const now = Date.now()

function id() {
  return randomUUID()
}

function pathHash(path) {
  return createHash('sha256').update(path).digest('hex').slice(0, 24)
}

function identityFor(path) {
  const hash = pathHash(path)
  const info = statSync(path)
  const inodeKey = `${info.dev}:${info.ino}`
  const fileId = `ino-${createHash('sha256').update(inodeKey).digest('hex').slice(0, 20)}`
  return { fileId, inodeKey, pathHash: hash }
}

function baseConv(title, updatedOffset, extras = {}) {
  return {
    id: id(),
    title,
    createdAt: now - updatedOffset - 86_400_000,
    updatedAt: now - updatedOffset,
    workingDirectory: root,
    model: 'deepseek-v4-flash',
    tokensUsed: 12_000,
    tokenLimit: 200_000,
    pinned: false,
    pinTime: null,
    duplicateSourceId: null,
    duplicateSourceTitle: null,
    archived: false,
    archivedAt: null,
    approvalMode: 'auto',
    messages: [],
    activeLeafId: null,
    tokenHistory: [],
    cacheCreatedAt: null,
    cacheExpiresAt: null,
    fileId: null,
    fileReadOnly: false,
    agentBinaryName: null,
    focusedFilePath: null,
    compactions: [],
    ...extras
  }
}

function fileSession(path, title, messages, extras = {}) {
  const identity = identityFor(path)
  const a = messages[messages.length - 1]?.id ?? id()
  const conv = baseConv(title, extras.updatedOffset ?? 30 * 60_000, {
    workingDirectory: dirname(path),
    fileId: identity.fileId,
    fileReadOnly: extras.fileReadOnly ?? false,
    focusedFilePath: path,
    activeLeafId: a,
    tokensUsed: extras.tokensUsed ?? 14_000,
    updatedAt: now - (extras.updatedOffset ?? 30 * 60_000) + 60_000,
    messages,
    cacheCreatedAt: now - 10 * 60_000,
    cacheExpiresAt: now + 50 * 60_000
  })
  return { conv, identity, path }
}

const pdfPath = join(samplesDir, 'ops-brief.pdf')
const pptxPath = join(samplesDir, 'q3-ops-review.pptx')
const csvPath = join(samplesDir, 'orders.csv')
const xlsxPath = join(samplesDir, 'orders.xlsx')
const docxPath = join(samplesDir, 'partner-brief.docx')
const mdPath = join(samplesDir, 'install-notes.md')

for (const p of [pdfPath, pptxPath, csvPath, xlsxPath, docxPath, mdPath]) {
  if (!existsSync(p)) {
    console.error('missing sample file', p)
    process.exit(1)
  }
}

// 1) PDF + agent summary + mermaid
const pdfU = id()
const pdfA = id()
const pdfSession = fileSession(
  pdfPath,
  'Ops brief → summary + flow',
  [
    {
      id: pdfU,
      parentId: null,
      role: 'user',
      content: 'Summarize this brief for stand-up, then sketch the follow-up flow as Mermaid.',
      blocks: [],
      createdAt: now - 20 * 60_000
    },
    {
      id: pdfA,
      parentId: pdfU,
      role: 'assistant',
      content: 'Stand-up summary and a follow-up flow.',
      createdAt: now - 19 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            '**Stand-up**\n\n' +
            '- APAC led shipped revenue this month.\n' +
            '- Pending: AMER WIDGET-A restock, EMEA WIDGET-C.\n' +
            '- Next: cut a region × SKU list from the live sheet.\n\n' +
            '```mermaid\n' +
            'flowchart LR\n' +
            '  A[Read brief] --> B[Region cut]\n' +
            '  B --> C{Pending?}\n' +
            '  C -->|Yes| D[Restock ticket]\n' +
            '  C -->|No| E[Close loop]\n' +
            '  D --> E\n' +
            '```'
        }
      ]
    }
  ],
  { updatedOffset: 18 * 60_000, fileReadOnly: true, tokensUsed: 8_200 }
)

// 2) PPTX + modification toolcall
const pptxU = id()
const pptxA = id()
const tPptxSkill = id()
const tPptxWrite = id()
const pptxSession = fileSession(
  pptxPath,
  'Rename slide 2 in the deck',
  [
    {
      id: pptxU,
      parentId: null,
      role: 'user',
      content: 'Rename slide 2 to “Where we’re blocked” and tighten the three bullets.',
      blocks: [],
      createdAt: now - 28 * 60_000
    },
    {
      id: pptxA,
      parentId: pptxU,
      role: 'assistant',
      content: 'Updated slide 2 title and bullets in the PPTX.',
      createdAt: now - 27 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tPptxSkill,
          tool: 'load_skill',
          summary: 'Load skill: pptx',
          input: JSON.stringify({ name: 'pptx' }),
          output: 'Loaded skill “pptx”.\nSKILL_DIR=resources/agent-skills/pptx\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tPptxWrite,
          tool: 'fs_write',
          summary: 'Write q3-ops-review.pptx',
          input: JSON.stringify({
            path: 'q3-ops-review.pptx',
            content: '…slide 2 title → Where we’re blocked…'
          }),
          output: 'Wrote q3-ops-review.pptx (3 slides)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Applied in the deck:\n\n' +
            '- Slide 2 title → **Where we’re blocked**\n' +
            '- Bullets trimmed to APAC lead / two pending rows / exclude cancelled\n\n' +
            'Preview should refresh — scroll to slide 2 to confirm.'
        }
      ]
    }
  ],
  { updatedOffset: 26 * 60_000, fileReadOnly: false, tokensUsed: 11_400 }
)

// 3) CSV + vega-lite + PDF report
const csvU = id()
const csvA = id()
const tCsvSkill = id()
const tCsvPdf = id()
const csvSession = fileSession(
  csvPath,
  'Chart regions + PDF report',
  [
    {
      id: csvU,
      parentId: null,
      role: 'user',
      content: 'Plot shipped revenue by region, then write a one-page PDF report.',
      blocks: [],
      createdAt: now - 24 * 60_000
    },
    {
      id: csvA,
      parentId: csvU,
      role: 'assistant',
      content: 'Vega-Lite chart and PDF report written.',
      createdAt: now - 23 * 60_000,
      blocks: [
        {
          kind: 'text',
          text:
            'Shipped-only totals from `orders.csv`:\n\n' +
            '```vega-lite\n' +
            JSON.stringify(
              {
                $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
                data: {
                  values: [
                    { region: 'APAC', revenue: 31312 },
                    { region: 'EMEA', revenue: 10950 },
                    { region: 'AMER', revenue: 13825 }
                  ]
                },
                mark: { type: 'bar', cornerRadiusEnd: 2 },
                encoding: {
                  x: { field: 'region', type: 'nominal', title: null },
                  y: { field: 'revenue', type: 'quantitative', title: 'Shipped $' },
                  color: { value: '#1a1a1a' }
                },
                width: 320,
                height: 160
              },
              null,
              2
            ) +
            '\n```'
        },
        {
          kind: 'toolCall',
          id: tCsvSkill,
          tool: 'load_skill',
          summary: 'Load skill: pdf',
          input: JSON.stringify({ name: 'pdf' }),
          output: 'Loaded skill “pdf”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tCsvPdf,
          tool: 'fs_write',
          summary: 'Write docs/ops-q3.pdf',
          input: JSON.stringify({ path: 'docs/ops-q3.pdf' }),
          output: 'Wrote PDF report to docs/ops-q3.pdf (1 page)',
          status: 'completed'
        },
        {
          kind: 'text',
          text: 'Report saved to `docs/ops-q3.pdf` — open it in a file session to review.'
        }
      ]
    }
  ],
  { updatedOffset: 22 * 60_000, fileReadOnly: true, tokensUsed: 13_800 }
)

// 4) XLSX + editing (DOCX sibling session also seeded)
const xlsxU = id()
const xlsxA = id()
const tXlsxSkill = id()
const tXlsxWrite = id()
const xlsxSession = fileSession(
  xlsxPath,
  'Add restock_units column',
  [
    {
      id: xlsxU,
      parentId: null,
      role: 'user',
      content: 'Add a restock_units column on Orders for pending rows, then refresh By region.',
      blocks: [],
      createdAt: now - 16 * 60_000
    },
    {
      id: xlsxA,
      parentId: xlsxU,
      role: 'assistant',
      content: 'Added restock_units and refreshed By region.',
      createdAt: now - 15 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tXlsxSkill,
          tool: 'load_skill',
          summary: 'Load skill: xlsx',
          input: JSON.stringify({ name: 'xlsx' }),
          output: 'Loaded skill “xlsx”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tXlsxWrite,
          tool: 'fs_write',
          summary: 'Write orders.xlsx',
          input: JSON.stringify({
            path: 'orders.xlsx',
            content: '…Orders.restock_units + By region…'
          }),
          output: 'Wrote orders.xlsx (2 sheets)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Edits applied:\n\n' +
            '- **Orders:** `restock_units` = units when `status=pending`, else blank\n' +
            '- **By region:** shipped totals unchanged; pending units called out\n\n' +
            'Flip sheets in the preview to verify.'
        }
      ]
    }
  ],
  { updatedOffset: 14 * 60_000, fileReadOnly: false, tokensUsed: 12_600 }
)

const docxU = id()
const docxA = id()
const tDocxSkill = id()
const tDocxWrite = id()
const docxSession = fileSession(
  docxPath,
  'Rewrite section 2 for FAQ',
  [
    {
      id: docxU,
      parentId: null,
      role: 'user',
      content: 'Rewrite section 2 as partner-facing FAQ bullets.',
      blocks: [],
      createdAt: now - 12 * 60_000
    },
    {
      id: docxA,
      parentId: docxU,
      role: 'assistant',
      content: 'Rewrote section 2 in the DOCX.',
      createdAt: now - 11 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tDocxSkill,
          tool: 'load_skill',
          summary: 'Load skill: docx',
          input: JSON.stringify({ name: 'docx' }),
          output: 'Loaded skill “docx”.\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tDocxWrite,
          tool: 'fs_write',
          summary: 'Write partner-brief.docx',
          input: JSON.stringify({ path: 'partner-brief.docx' }),
          output: 'Wrote partner-brief.docx',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Section 2 is now FAQ-style:\n\n' +
            '- **Q: What’s pending in AMER?** A: WIDGET-A × 200 — confirm with warehouse.\n' +
            '- **Q: EMEA WIDGET-C?** A: 22 units — expedite or drop from Q3 target.\n' +
            '- **Q: Cancelled rows?** A: Exclude AMER WIDGET-B from fulfillment totals.'
        }
      ]
    }
  ],
  { updatedOffset: 10 * 60_000, fileReadOnly: false, tokensUsed: 9_800 }
)

// 5) Markdown + modification toolcall
const mdU = id()
const mdA = id()
const tMdRead = id()
const tMdWrite = id()
const mdSession = fileSession(
  mdPath,
  'Clarify Gatekeeper steps',
  [
    {
      id: mdU,
      parentId: null,
      role: 'user',
      content: 'Clarify the macOS Gatekeeper steps and add a one-line tip under CLI.',
      blocks: [],
      createdAt: now - 8 * 60_000
    },
    {
      id: mdA,
      parentId: mdU,
      role: 'assistant',
      content: 'Updated install-notes.md.',
      createdAt: now - 7 * 60_000,
      blocks: [
        {
          kind: 'toolCall',
          id: tMdRead,
          tool: 'fs_read',
          summary: 'Read install-notes.md',
          input: JSON.stringify({ path: 'install-notes.md' }),
          output: '# Install notes\n\n## macOS\n…',
          status: 'completed'
        },
        {
          kind: 'toolCall',
          id: tMdWrite,
          tool: 'fs_write',
          summary: 'Write install-notes.md',
          input: JSON.stringify({ path: 'install-notes.md' }),
          output: 'Wrote install-notes.md (42 lines)',
          status: 'completed'
        },
        {
          kind: 'text',
          text:
            'Changes:\n\n' +
            '- macOS: spelled out **Privacy & Security → Open Anyway** after the first block.\n' +
            '- CLI: tip — `vav .` uses the folder you’re already in.\n\n' +
            'Preview should show the new wording under **macOS** and **CLI**.'
        }
      ]
    }
  ],
  { updatedOffset: 6 * 60_000, fileReadOnly: false, tokensUsed: 7_400 }
)

// Light sidebar filler (not used in gallery)
const filler = baseConv('Payment webhook idempotency', 2 * 60 * 60_000, {
  pinned: true,
  pinTime: now - 60_000,
  tokensUsed: 40_000,
  messages: []
})

const sessions = [pdfSession, pptxSession, csvSession, xlsxSession, docxSession, mdSession]
const conversations = [filler, ...sessions.map((s) => s.conv)]

const fileIndex = { version: 1, byId: {}, byInode: {}, byPathHash: {} }
for (const session of sessions) {
  const { identity, path, conv } = session
  fileIndex.byId[identity.fileId] = {
    fileId: identity.fileId,
    inodeKey: identity.inodeKey,
    path,
    pathHash: identity.pathHash,
    activeSessionId: conv.id,
    sessionIds: [conv.id]
  }
  fileIndex.byInode[identity.inodeKey] = identity.fileId
  fileIndex.byPathHash[identity.pathHash] = identity.fileId
}

mkdirSync(dataDir, { recursive: true })
mkdirSync(fileSessionsDir, { recursive: true })
if (existsSync(convPath)) copyFileSync(convPath, `${convPath}.bak-marketing`)
if (existsSync(fileIndexPath)) copyFileSync(fileIndexPath, `${fileIndexPath}.bak-marketing`)

writeFileSync(convPath, JSON.stringify({ version: 1, conversations }, null, 2))
writeFileSync(fileIndexPath, JSON.stringify(fileIndex, null, 2))

if (existsSync(settingsPath)) {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  settings.theme = 'light'
  settings.locale = 'en'
  settings.fileViewMode = 'tree'
  settings.sidebarGroupingMode = 'workspace'
  settings.defaultModel = 'deepseek-v4-flash'
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2))
}

const manifest = {
  previews: {
    pdf: { path: pdfPath, title: pdfSession.conv.title, sessionId: pdfSession.conv.id },
    pptx: { path: pptxPath, title: pptxSession.conv.title, sessionId: pptxSession.conv.id },
    csv: { path: csvPath, title: csvSession.conv.title, sessionId: csvSession.conv.id },
    xlsx: { path: xlsxPath, title: xlsxSession.conv.title, sessionId: xlsxSession.conv.id },
    docx: { path: docxPath, title: docxSession.conv.title, sessionId: docxSession.conv.id },
    md: { path: mdPath, title: mdSession.conv.title, sessionId: mdSession.conv.id }
  }
}
writeFileSync(join(samplesDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

console.log(convPath)
console.log('fileSessions', sessions.length)
console.log('manifest', join(samplesDir, 'manifest.json'))
