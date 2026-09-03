import { normalizeAskQuestions, normalizePlanSteps } from '@shared/askPlan'
import { TOOL_LABELS } from '@shared/types'
import { cap } from './toolSummarize'
import { Type, defineTool, failure, park, type ToolHost } from './toolHost'

export function createInteractiveTools(host: ToolHost) {
  const request = defineTool({
    name: 'request',
    label: TOOL_LABELS.request,
    description:
      'Pause the turn and ask the user to approve an action or supply free-form input. Use before anything destructive or ambiguous.',
    parameters: Type.Object({
      instruction: Type.String({
        description: 'What you need the user to approve or provide.'
      })
    }),
    execute: (id, params) => park(host.ask(id, params.instruction)),
    executionMode: 'sequential'
  })

  // Hard cap: long choice lists feel like a survey. Other is always available in UI.
  const ASK_CHOICES_MAX = 4
  const askChoices = Type.Optional(
    Type.Array(Type.String(), {
      maxItems: ASK_CHOICES_MAX,
      description: `2–${ASK_CHOICES_MAX} short preset answers only. The UI always adds Other — do not invent filler options.`
    })
  )

  const askQuestionItem = Type.Object({
    question: Type.String({ description: 'The question text.' }),
    choices: askChoices,
    multiSelect: Type.Optional(
      Type.Boolean({
        description: 'When true with choices, the user may select multiple options (checkboxes).'
      })
    )
  })

  const askUserQuestion = defineTool({
    name: 'ask_user_question',
    label: TOOL_LABELS.ask_user_question,
    description:
      'Pause the turn and ask the user one or more questions (VAV tool, not a pi built-in). Prefer 1–3 questions. For each question give 2–4 short choices max (single- or multi-select); the UI always offers Other — never pad with joke/filler options. Free-text only when choices do not apply. Prefer one `questions` array for related prompts.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: 'Card title when asking several questions.' })),
      question: Type.Optional(Type.String({ description: 'Single-question form.' })),
      choices: askChoices,
      multiSelect: Type.Optional(
        Type.Boolean({ description: 'When true with choices, allow selecting multiple options.' })
      ),
      questions: Type.Optional(
        Type.Array(askQuestionItem, {
          maxItems: 5,
          description: 'Related questions (max 5). One question per step in the UI.'
        })
      )
    }),
    execute: async (id, params) => {
      const questions = normalizeAskQuestions(params as Record<string, unknown>)
      if (questions.length === 0) return failure('缺少 question / questions 参数')
      const summary =
        questions.length === 1
          ? questions[0].question
          : String((params as { title?: string }).title ?? `${questions.length} 个问题`)
      return park(
        host.ask(id, summary, {
          questions,
          askTitle: (params as { title?: string }).title,
          choices: questions.length === 1 ? questions[0].choices : undefined,
          multiSelect: questions.length === 1 ? questions[0].multiSelect : undefined
        })
      )
    },
    executionMode: 'sequential'
  })

  const loadSkill = defineTool({
    name: 'load_skill',
    label: TOOL_LABELS.load_skill,
    description: [
      'Load a specialized Agent Skill (instructions, workflows, and optional scripts) to improve quality on a domain task.',
      'Call this BEFORE generating or heavily editing: Markdown/docs, PPTX, XLSX, DOCX, PDF, web UI, dashboards, charts, image/shader work, or multi-file app structure.',
      'Omit name (or pass list:true) to list the catalog. Pass name to load SKILL.md. Pass path for a companion file under that skill (e.g. references/editing.md).',
      'Optional url= fetches a remote SKILL.md from allowlisted hosts (raw.githubusercontent.com / github.com) when the user provides a skill URL — prefer bundled skills.'
    ].join(' '),
    parameters: Type.Object({
      name: Type.Optional(
        Type.String({
          description:
            'Skill id (preferred) or name, e.g. "officecli", "pptx", "xlsx", "docx", "pdf", "frontend-design", "doc-coauthoring".'
        })
      ),
      path: Type.Optional(
        Type.String({
          description:
            'Optional relative path inside the skill folder after loading the main skill (e.g. "references/design-system.md").'
        })
      ),
      list: Type.Optional(
        Type.Boolean({
          description: 'When true (or when name is omitted), return the skill catalog only.'
        })
      ),
      url: Type.Optional(
        Type.String({
          description:
            'Optional remote https URL to a SKILL.md (GitHub raw or blob). Allowlisted hosts only.'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.skills) return failure('Skill service is unavailable')
      const listOnly = params.list === true || (!params.name && !params.url)
      if (listOnly) {
        const cat = host.skills.catalog()
        const lines = [
          cat.note ? `Note: ${cat.note}` : '',
          `Available skills (${cat.skills.length}):`,
          ...cat.skills.map((s) => {
            const tags = s.tags?.length ? ` [${s.tags.join(', ')}]` : ''
            return `- ${s.id}${tags} (${s.license}): ${s.description}`
          }),
          '',
          'Load one with load_skill({ name: "<id>" }). Load a companion with path: "references/…".'
        ].filter(Boolean)
        const text = lines.join('\n')
        return {
          content: [{ type: 'text', text: cap(text) }],
          details: { display: text, summary: `${cat.skills.length} skills` }
        }
      }

      if (params.url) {
        const remote = await host.skills.loadRemote(String(params.url))
        if ('error' in remote) return failure(remote.error)
        const text = remote.content
        return {
          content: [{ type: 'text', text: cap(text) }],
          details: {
            display: text,
            summary: `remote · ${remote.id}${remote.truncated ? ' · truncated' : ''}`
          }
        }
      }

      const name = String(params.name ?? '').trim()
      if (!name) return failure('Missing name (or set list:true)')
      const loaded = host.skills.loadLocal(
        name,
        params.path != null ? String(params.path) : null,
        host.workdir
      )
      if ('error' in loaded) return failure(loaded.error)
      const footer =
        loaded.companionFiles.length > 0
          ? `\n\n## Companion files (load with path=)\n${loaded.companionFiles
              .slice(0, 60)
              .map((f) => `- ${f}`)
              .join('\n')}${loaded.companionFiles.length > 60 ? `\n…+${loaded.companionFiles.length - 60} more` : ''}`
          : ''
      const text = loaded.content + footer
      return {
        content: [{ type: 'text', text: cap(text) }],
        details: {
          display: text,
          summary: `${loaded.id}/${loaded.path}${loaded.truncated ? ' · truncated' : ''}`
        }
      }
    }
  })

  const plan = defineTool({
    name: 'plan',
    label: TOOL_LABELS.plan,
    description: [
      'Create or update the visible multi-step checklist for this turn.',
      'Call once at the start with all steps pending (or one executing).',
      'Call again whenever a step changes: mark finished work done, set exactly one step executing while you work on it.',
      'Before your final user-facing answer — when the overall task is complete — call plan one last time with every completed step status "done".',
      'Do not stop the turn while steps you finished are still pending; the UI only updates when you call this tool.',
      'If you abandon remaining work, mark those steps "skipped" (or "error") instead of leaving them pending.',
      'Exactly one step may be "executing" at a time.'
    ].join(' '),
    parameters: Type.Object({
      title: Type.String({ description: 'Short plan title shown in the card header.' }),
      steps: Type.Array(
        Type.Object({
          id: Type.String(),
          title: Type.String(),
          status: Type.Union([
            Type.Literal('pending'),
            Type.Literal('executing'),
            Type.Literal('done'),
            Type.Literal('error'),
            Type.Literal('skipped')
          ]),
          subtitle: Type.Optional(Type.String())
        }),
        { minItems: 1 }
      )
    }),
    async execute(_id, params) {
      const title = String(params.title ?? 'Plan').trim() || 'Plan'
      const steps = normalizePlanSteps(params.steps)
      const done = steps.filter((step) => step.status === 'done').length
      const open = steps.filter(
        (step) => step.status === 'pending' || step.status === 'executing'
      ).length
      const summary = `Plan · ${title} (${done}/${steps.length})`
      // Reminder stays in model-facing content so the next step of the loop
      // still sees incomplete checklist items after a partial update.
      const reminder =
        open > 0
          ? `\n${open} step(s) still open. Before your final answer, call plan again so finished work is "done" (or "skipped" if abandoned).`
          : '\nAll steps closed.'
      return {
        content: [{ type: 'text', text: summary + reminder }],
        details: { display: summary }
      }
    }
  })

  const switchMode = defineTool({
    name: 'switch_mode',
    label: TOOL_LABELS.switch_mode,
    description: [
      'Switch the file-preview session from Read to Edit so write tools (`fs_write`, mutating shell) can run.',
      'Only available while the session is Read. Under Auto approval the user must Approve; Bypass runs immediately.',
      'Call this before attempting file edits when the session is Read. After success, proceed with writes in the same turn.',
      'If the format cannot edit in-place (PDF / HEIC / legacy Office / ZIP), tell the user to convert or Save As instead.'
    ].join(' '),
    parameters: Type.Object({
      mode: Type.Literal('edit'),
      reason: Type.Optional(
        Type.String({
          description: 'Short reason shown on the approval card (what you need to change).'
        })
      )
    }),
    async execute(_id, params) {
      if (!host.setFileReadOnly) {
        return failure('Switch mode is unavailable in this session.')
      }
      if (!host.isFileReadOnly?.()) {
        return {
          content: [{ type: 'text', text: 'Already in Edit mode. Write tools are available.' }],
          details: { display: '已是 Edit 模式' }
        }
      }
      if (params.mode !== 'edit') {
        return failure('Only mode "edit" is supported.')
      }
      const err = host.setFileReadOnly(false)
      if (err) return failure(err)
      const note = typeof params.reason === 'string' ? params.reason.trim() : ''
      const text = note
        ? `Switched to Edit mode (${note}). You may now use fs_write and mutating shell commands.`
        : 'Switched to Edit mode. You may now use fs_write and mutating shell commands.'
      return {
        content: [{ type: 'text', text }],
        details: { display: note ? `切换到 Edit · ${note}` : '切换到 Edit' }
      }
    }
  })

  return { request, askUserQuestion, loadSkill, plan, switchMode }
}
