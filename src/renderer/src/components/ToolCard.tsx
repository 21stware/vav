import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronRight, CircleAlert, Loader2 } from 'lucide-react'
import { normalizeAskQuestions, parseToolInput } from '@shared/askPlan'
import { normalizePlanDocInput, planDocHasBody } from '@shared/planDoc'
import type { MessageKey } from '@shared/i18n'
import {
  TOOL_LABELS,
  type AskQuestion,
  type MessageBlock,
  type ToolCallBlock,
  type ToolName
} from '@shared/types'
import { useSessionStore } from '../state/sessionStore'
import { useT, tt } from '../i18n/useT'
import { extractCiteKeys } from '@shared/mdMarks'
import { isHollowToolCard } from '../lib/assistantProcess'
import { REVEAL_CITE_EVENT } from '../lib/mdMarks'
import { MarkdownView } from './MarkdownView'
import { ReasoningBlock } from './ReasoningBlock'

const TOOL_NAME_KEYS: Partial<Record<ToolName, MessageKey>> = {
  terminal: 'tool.shell',
  fs_read: 'tool.read',
  fs_write: 'tool.write',
  fs_list: 'tool.list',
  web_search: 'tool.webSearch',
  web_fetch: 'tool.webFetch',
  load_skill: 'tool.loadSkill',
  ask_user_question: 'tool.ask',
  request: 'tool.ask',
  switch_mode: 'tool.switchMode',
  task: 'tool.task',
  plan_doc: 'tool.planDoc'
}

function localizedToolName(tool: ToolName, t: ReturnType<typeof useT>): string {
  const key = TOOL_NAME_KEYS[tool]
  return key ? t(key) : (TOOL_LABELS[tool] ?? tool)
}
import { ToolDetail } from './ToolDetail'
import { Button, InlineAlert } from './ui'

/** Collapsed header truncates the argument summary past this length. */
const SUMMARY_MAX = 50

/** Only states worth interrupting the reader for get words. */
function statusLabel(status: ToolCallBlock['status']): string | undefined {
  const map: Partial<Record<ToolCallBlock['status'], Parameters<typeof tt>[0]>> = {
    pending: 'common.pending',
    executing: 'common.running',
    error: 'common.failed',
    skipped: 'common.skipped',
    expired: 'common.expired'
  }
  const key = map[status]
  return key ? tt(key) : undefined
}

/**
 * A tool call in the transcript.
 *
 * Deliberately not a panel: a tool call is a line of the assistant's turn, not
 * a document attached to it. Collapsed it is one row — name, argument, outcome —
 * and the chrome only appears under the pointer. The weight belongs to what the
 * tool produced, which is one click away in {@link ToolDetail}.
 *
 * Expand/collapse defaults follow tool-expand-collapse.rpml: most tools start
 * collapsed; `wait` starts expanded; fire-and-forget terminal is not expandable.
 * Local expand state is not persisted — a new turn remounts cards at defaults.
 *
 * `request` / `ask_user_question` in the `pending` state render as an
 * interactive card instead, because that turn is parked until the user answers
 * (main-chat-awaiting-user.rpml). `plan` renders as a checklist projection.
 */
export const ToolCard = memo(function ToolCard({
  block,
  startCollapsed = false
}: {
  block: ToolCallBlock
  /** Finished thinking-process nest: every step starts closed. */
  startCollapsed?: boolean
}): React.JSX.Element {
  const t = useT()
  const rootRef = useRef<HTMLDivElement>(null)
  const fireAndForget = isFireAndForget(block)
  const [expanded, setExpanded] = useState(() => !startCollapsed && defaultExpanded(block))
  const citeKeys = useMemo(() => extractCiteKeys(block.output || '').join(' '), [block.output])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onReveal = (): void => setExpanded(true)
    el.addEventListener(REVEAL_CITE_EVENT, onReveal)
    return () => el.removeEventListener(REVEAL_CITE_EVENT, onReveal)
  }, [])
  const isInteractive = block.tool === 'request' || block.tool === 'ask_user_question'
  const isApproval =
    block.status === 'pending' && !!block.choices?.length && !isInteractive

  const headline = useMemo(() => summaryFor(block), [block])
  const toolName = localizedToolName(block.tool, t)

  // Plan lives as a tools-panel banner, not in the transcript stream.
  if (block.tool === 'plan' || isHollowToolCard(block)) {
    return <></>
  }

  if (block.tool === 'plan_doc') {
    return <PlanDocCard block={block} />
  }

  if (isInteractive && block.status === 'pending') {
    return <AskCard block={block} />
  }

  if (isApproval) {
    return <ApprovalCard block={block} />
  }

  if (isInteractive && block.tool === 'ask_user_question') {
    return <AskSealed block={block} />
  }

  const label = statusLabel(block.status)
  const canToggle = !fireAndForget && block.status !== 'pending'
  const showDetail = canToggle && expanded
  const backgroundTag = fireAndForget ? backgroundLabel(block) : null

  return (
    <div
      ref={rootRef}
      className={`tool-call${showDetail ? ' expanded' : ''}`}
      data-testid="tool-card"
      data-tool={block.tool}
      data-status={block.status}
      data-expandable={canToggle}
      data-cite-keys={citeKeys || undefined}
    >
      <button
        type="button"
        className="tool-row"
        disabled={!canToggle}
        title={canToggle ? t('tool.toggleDetail') : undefined}
        aria-expanded={canToggle ? showDetail : undefined}
        onClick={() => {
          if (canToggle) setExpanded((value) => !value)
        }}
      >
        {canToggle ? <ChevronRight className="tool-chevron" size={11} /> : <span className="tool-chevron-spacer" />}
        <span className="tool-name" title={toolName}>
          {toolName}
        </span>
        <span className="tool-summary" title={headline}>
          {truncate(headline, SUMMARY_MAX)}
        </span>
        {backgroundTag && <span className="tool-bg-tag">{backgroundTag}</span>}
        {block.status === 'executing' && <Loader2 className="spin tool-mark" size={11} />}
        {block.status === 'completed' && !fireAndForget && <Check className="tool-mark done" size={12} />}
        {block.status === 'error' && <CircleAlert className="tool-mark failed" size={12} />}
        {label && <span className={`tool-state ${block.status}`}>{label}</span>}
      </button>

      {/* Kept mounted and collapsed by grid rows, so reopening mid-close
          retargets from where it is instead of restarting. */}
      {canToggle && (
        <div className="tool-detail" aria-hidden={!showDetail}>
          <div className="tool-detail-inner">
            {showDetail && (
              <>
                <ToolDetail block={block} />
                {block.tool === 'task' && block.children?.length ? (
                  <>
                    <TaskChildren
                      blocks={block.children}
                      live={block.status === 'executing' || block.status === 'pending'}
                    />
                    {block.output.trim() ? (
                      <pre className="story-body task-result">{block.output}</pre>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

/** wait defaults open so the user can follow match progress. */
function defaultExpanded(block: ToolCallBlock): boolean {
  if (block.tool === 'wait') return true
  // Live subagent with work: open so the nested transcript is visible.
  if (
    block.tool === 'task' &&
    (block.status === 'executing' || block.status === 'pending') &&
    (block.children?.length ?? 0) > 0
  ) {
    return true
  }
  return false
}

function TaskChildren({
  blocks,
  live
}: {
  blocks: MessageBlock[]
  live: boolean
}): React.JSX.Element {
  return (
    <div className="task-children" data-testid="task-children">
      {blocks.map((child, index) => {
        if (child.kind === 'reasoning') {
          return (
            <ReasoningBlock
              key={`r${index}`}
              text={child.text}
              live={live && index === blocks.length - 1}
              durationMs={child.durationMs}
            />
          )
        }
        if (child.kind === 'toolCall') {
          return <ToolCard key={child.id} block={child} />
        }
        if (child.kind === 'text' && child.text.trim()) {
          return <MarkdownView key={`t${index}`} source={child.text} />
        }
        return null
      })}
    </div>
  )
}

function isBackgroundPidOutput(output: string): boolean {
  return (
    output.startsWith('后台运行 · pid') ||
    (output.startsWith(tt('tool.background')) && output.includes('pid'))
  )
}

function isFireAndForget(block: ToolCallBlock): boolean {
  if (block.tool !== 'terminal') return false
  const input = parseToolInput(block.input)
  if (input.background === true) return true
  if (isBackgroundPidOutput(block.output)) return true
  try {
    const parsed = JSON.parse(block.output) as { status?: string; pid?: unknown }
    return parsed.status === 'running' && parsed.pid != null
  } catch {
    return false
  }
}

function backgroundLabel(block: ToolCallBlock): string {
  if (isBackgroundPidOutput(block.output)) return block.output
  try {
    const parsed = JSON.parse(block.output) as { pid?: number | string }
    if (parsed.pid != null) return tt('tool.backgroundPid', { pid: parsed.pid })
  } catch {
    /* ignore */
  }
  return tt('tool.background')
}

/** Writes get their edit size on the collapsed row; the path is already there. */
function summaryFor(block: ToolCallBlock): string {
  if (block.tool !== 'fs_write' || !block.output.startsWith('@@')) return block.summary
  let added = 0
  let removed = 0
  for (const line of block.output.split('\n')) {
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return `${block.summary}  +${added} −${removed}`
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function questionsOf(block: ToolCallBlock): AskQuestion[] {
  if (block.questions?.length) return block.questions
  return normalizeAskQuestions(parseToolInput(block.input))
}

function PlanDocCard({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const t = useT()
  const answerTool = useSessionStore((s) => s.answerTool)
  const doc = normalizePlanDocInput(parseToolInput(block.input))
  const pending = block.status === 'pending'
  const [submitting, setSubmitting] = useState<'accept' | 'reject' | null>(null)
  const rejected = block.status === 'skipped'
  const accepted = block.status === 'completed'

  const submit = (kind: 'accept' | 'reject'): void => {
    if (submitting) return
    setSubmitting(kind)
    void (async () => {
      try {
        const ok = await answerTool(
          block.id,
          kind === 'accept' ? t('planDoc.accept') : t('planDoc.reject')
        )
        if (!ok) setSubmitting(null)
      } catch {
        setSubmitting(null)
      }
    })()
  }

  return (
    <div
      className={`plan-doc-card${pending ? ' is-pending' : ''}${accepted ? ' is-accepted' : ''}${rejected ? ' is-rejected' : ''}`}
      data-testid="plan-doc"
      data-status={block.status}
    >
      <div className="plan-doc-head">
        <span className="plan-doc-label">{t('tool.planDoc')}</span>
        <span className="plan-doc-name">{doc.name}</span>
        {pending && <span className="plan-doc-badge">{t('tool.detail.approvalPending')}</span>}
        {accepted && <span className="plan-doc-badge is-done">{t('planDoc.accepted')}</span>}
        {rejected && <span className="plan-doc-badge is-fail">{t('planDoc.rejected')}</span>}
        {block.status === 'executing' && !pending && (
          <Loader2 className="spin plan-doc-spin" size={12} />
        )}
      </div>
      {doc.overview && <div className="plan-doc-overview">{doc.overview}</div>}
      {doc.plan ? (
        <div className="plan-doc-body">
          <MarkdownView source={doc.plan} />
        </div>
      ) : (
        !planDocHasBody(doc) &&
        block.status === 'executing' && <div className="plan-doc-empty">{t('common.loading')}</div>
      )}
      {pending && (
        <div className="plan-doc-actions">
          <Button
            label={t('planDoc.reject')}
            disabled={!!submitting}
            onClick={() => submit('reject')}
          />
          <Button
            label={submitting === 'accept' ? t('common.submitting') : t('planDoc.accept')}
            variant="primary"
            disabled={!!submitting}
            onClick={() => submit('accept')}
          />
        </div>
      )}
    </div>
  )
}

/** Inline Approve / Deny for Auto / Edit tool gates (main-chat.rpml). */
function ApprovalCard({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const t = useT()
  const answerTool = useSessionStore((s) => s.answerTool)
  const [approve = t('common.approve'), deny = t('common.deny')] = block.choices ?? []
  const lines = (block.summary || '').split('\n')
  const toolLabel = localizedToolName(block.tool, t)
  const headline = lines[0] || t('approval.title', { name: toolLabel })
  const editLabel = t('tool.detail.approvalEdit')
  const editable = Boolean(block.askTitle?.length || headline.includes(editLabel))
  const detail = lines.slice(1).join('\n').trim()
  const [draft, setDraft] = useState(() => block.askTitle || detail)
  // Optimistic: dismiss Approve/Deny immediately so a slow IPC / second-tool
  // race never looks like a dead click.
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null)

  const submit = (kind: 'approve' | 'deny', text: string): void => {
    if (submitting) return
    setSubmitting(kind)
    void (async () => {
      try {
        const ok = await answerTool(block.id, text)
        if (!ok) {
          setSubmitting(null)
          return
        }
        // Main drops the card via tool events; if nothing moved after a beat,
        // re-enable so the user can retry instead of staring at a spinner.
        window.setTimeout(() => {
          setSubmitting((current) => (current === kind ? null : current))
        }, 2500)
      } catch {
        setSubmitting(null)
      }
    })()
  }

  if (submitting) {
    return (
      <div
        className="approval-card is-submitting"
        data-testid="approval-card"
        data-status={submitting}
      >
        <div className="approval-head">
          <span className="approval-tool">{toolLabel}</span>
          <span className="approval-badge">
            {submitting === 'deny' ? t('common.deny') : t('common.running')}
          </span>
        </div>
        {detail && <pre className="approval-args">{detail}</pre>}
        <div className="approval-actions">
          <Loader2 className="spin" size={14} />
        </div>
      </div>
    )
  }

  return (
    <div className="approval-card" data-testid="approval-card">
      <div className="approval-head">
        <span className="approval-tool">{toolLabel}</span>
        <span className="approval-badge">
          {editable ? t('tool.detail.approvalEdit') : t('tool.detail.approvalPending')}
        </span>
      </div>
      {editable ? (
        <textarea
          className="text-field approval-edit"
          rows={Math.min(8, Math.max(3, draft.split('\n').length + 1))}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          spellCheck={false}
        />
      ) : (
        detail && <pre className="approval-args">{detail}</pre>
      )}
      <div className="approval-actions">
        <Button label={deny} onClick={() => submit('deny', deny)} />
        <Button
          label={approve}
          variant="primary"
          onClick={() =>
            submit(
              'approve',
              editable && draft.trim() && draft.trim() !== detail ? `${approve}\n${draft}` : approve
            )
          }
        />
      </div>
    </div>
  )
}

function AskCard({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const t = useT()
  const answerTool = useSessionStore((s) => s.answerTool)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (block.tool === 'request') {
    return (
      <div className="ask-card request" data-testid="ask-card">
        <InlineAlert kind="warning" message={block.summary} />
        <div className="ask-actions">
          <Button
            label={t('common.allow')}
            variant="primary"
            onClick={() => void answerTool(block.id, t('common.allow'))}
          />
          <Button
            label={t('common.deny')}
            variant="danger"
            onClick={() => void answerTool(block.id, t('common.deny'))}
          />
        </div>
        <input
          className="text-field"
          placeholder={t('composer.placeholderFollowUp')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && draft.trim()) void answerTool(block.id, draft.trim())
          }}
        />
      </div>
    )
  }

  const questions = questionsOf(block)
  const title =
    questions.length > 1
      ? block.askTitle?.trim() || parseToolInput(block.input).title?.toString() || t('ask.questions', { n: questions.length })
      : null

  // No parseable questions (stale/corrupt tool input) — free-text fallback.
  if (questions.length === 0) {
    return (
      <div className={`ask-card${submitting ? ' submitting' : ''}`} data-testid="ask-card">
        <div className="ask-q">{block.summary || t('tool.ask')}</div>
        {error && <InlineAlert kind="error" message={error} />}
        <textarea
          className="text-area"
          rows={3}
          disabled={submitting}
          placeholder={t('composer.placeholderYourAnswer')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="ask-actions">
          <span className="spacer" />
          <Button
            label={submitting ? t('common.submitting') : t('common.submit')}
            variant="primary"
            disabled={submitting || !draft.trim()}
            onClick={() => {
              if (!draft.trim() || submitting) return
              setSubmitting(true)
              setError(null)
              void answerTool(block.id, draft.trim())
                .catch(() => setError(t('common.submitFailed')))
                .finally(() => setSubmitting(false))
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <MultiAskForm
      title={title}
      questions={questions}
      submitting={submitting}
      error={error}
      onSubmit={async (payload) => {
        setSubmitting(true)
        setError(null)
        try {
          await answerTool(block.id, payload)
        } catch {
          setError(t('common.submitFailed'))
        } finally {
          setSubmitting(false)
        }
      }}
    />
  )
}

function AskSealed({ block }: { block: ToolCallBlock }): React.JSX.Element {
  const t = useT()
  const questions = questionsOf(block)
  const answers = parseAnswers(block.output)
  const cancelled =
    block.status === 'skipped' ||
    block.output === tt('tool.askCancelled') ||
    block.output === '已取消'

  return (
    <div
      className={`ask-card sealed${cancelled ? ' cancelled' : ''}`}
      data-testid="ask-card-sealed"
    >
      {questions.length > 1 && (
        <div className="ask-title">
          {block.askTitle?.trim() || t('ask.questions', { n: questions.length })}
        </div>
      )}
      {cancelled ? (
        <div className="ask-sealed-line">{t('tool.askCancelled')}</div>
      ) : (
        questions.map((question, index) => {
          const value = answers[index]
          return (
            <div className="ask-question" key={index}>
              <div className="ask-q">{question.question}</div>
              <div className="ask-sealed-line">
                <Check size={12} className="ask-sealed-check" />
                {formatAnswer(value)}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

type AnswerValue = string | string[]

/** Sentinel for the per-question free-form “Other” choice. */
const ASK_OTHER = '__vav_other__'

function isQuestionAnswered(
  question: AskQuestion,
  index: number,
  single: Record<number, string>,
  multi: Record<number, string[]>,
  free: Record<number, string>
): boolean {
  const choices = question.choices ?? []
  if (choices.length === 0) return (free[index] ?? '').trim().length > 0
  if (question.multiSelect) {
    const picked = multi[index] ?? []
    if (picked.length === 0) return false
    if (picked.includes(ASK_OTHER)) return (free[index] ?? '').trim().length > 0
    return true
  }
  const picked = single[index]
  if (!picked) return false
  if (picked === ASK_OTHER) return (free[index] ?? '').trim().length > 0
  return true
}

function MultiAskForm({
  title,
  questions,
  submitting,
  error,
  onSubmit
}: {
  title: string | null
  questions: AskQuestion[]
  submitting: boolean
  error: string | null
  onSubmit: (payload: string) => void | Promise<void>
}): React.JSX.Element {
  const t = useT()
  const total = questions.length
  const multiStep = total > 1
  const [step, setStep] = useState(0)
  /** Single-select: chosen preset, or ASK_OTHER. */
  const [single, setSingle] = useState<Record<number, string>>({})
  /** Multi-select: list of presets; may include ASK_OTHER. */
  const [multi, setMulti] = useState<Record<number, string[]>>({})
  /** Free-text for pure free questions, or custom text when Other is selected. */
  const [free, setFree] = useState<Record<number, string>>({})
  const [note, setNote] = useState('')

  // Guard empty list (caller should also filter); never index past end.
  const safeStep = total === 0 ? 0 : Math.min(Math.max(0, step), total - 1)
  const question = questions[safeStep]
  const choices = question?.choices ?? []
  const otherOn = question?.multiSelect
    ? (multi[safeStep] ?? []).includes(ASK_OTHER)
    : single[safeStep] === ASK_OTHER

  const answeredFlags = questions.map((q, i) =>
    isQuestionAnswered(q, i, single, multi, free)
  )
  const currentReady = total > 0 && answeredFlags[safeStep] === true
  const allReady = total > 0 && answeredFlags.every(Boolean)
  const isLast = total === 0 || safeStep >= total - 1

  const submit = (): void => {
    if (!allReady || submitting) return
    const answers = questions.map((q, index) => {
      const opts = q.choices ?? []
      let value: AnswerValue
      if (opts.length === 0) {
        value = (free[index] ?? '').trim()
      } else if (q.multiSelect) {
        const picked = multi[index] ?? []
        const presets = picked.filter((c) => c !== ASK_OTHER)
        const custom = (free[index] ?? '').trim()
        if (picked.includes(ASK_OTHER) && custom) value = [...presets, custom]
        else value = presets
      } else {
        const picked = single[index] ?? ''
        value = picked === ASK_OTHER ? (free[index] ?? '').trim() : picked
      }
      return { questionIndex: index, value }
    })
    const payload: { answers: typeof answers; note?: string } = { answers }
    if (note.trim()) payload.note = note.trim()
    void onSubmit(JSON.stringify(payload))
  }

  const goNext = (): void => {
    if (!currentReady || isLast || total === 0) return
    setStep((s) => Math.min(s + 1, total - 1))
  }

  const goBack = (): void => {
    setStep((s) => Math.max(0, s - 1))
  }

  if (!question) {
    return (
      <div className="ask-card">
        <InlineAlert kind="error" message={t('tool.askCompleteRequired')} />
      </div>
    )
  }

  return (
    <div
      className={`ask-card${submitting ? ' submitting' : ''}${multiStep ? ' multi-step' : ''}`}
      data-testid="ask-card"
    >
      {(title || multiStep) && (
        <div className="ask-head">
          {title && <div className="ask-title">{title}</div>}
          {multiStep && (
            <div className="ask-tabs" role="tablist" aria-label={t('ask.questions', { n: total })}>
              {questions.map((_, index) => {
                const done = answeredFlags[index]
                const active = index === safeStep
                return (
                  <button
                    key={index}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`ask-tab${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
                    disabled={submitting}
                    title={t('tool.askStep', { n: index + 1 })}
                    onClick={() => setStep(index)}
                  >
                    <span className="ask-tab-index">{index + 1}</span>
                    {done && !active ? <Check size={10} className="ask-tab-check" /> : null}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
      {error && <InlineAlert kind="error" message={error} />}

      <div className="ask-question" key={safeStep}>
        <div className="ask-q-row">
          <div className="ask-q">{question.question}</div>
          {choices.length > 0 && (
            <span className="ask-mode-hint">
              {question.multiSelect ? t('tool.askMultiHint') : t('tool.askSingleHint')}
            </span>
          )}
        </div>
        {choices.length === 0 ? (
          <textarea
            className="text-area"
            rows={3}
            disabled={submitting}
            placeholder={t('composer.placeholderYourAnswer')}
            value={free[safeStep] ?? ''}
            onChange={(event) =>
              setFree((prev) => ({ ...prev, [safeStep]: event.target.value }))
            }
          />
        ) : (
          <>
            <div
              className={`ask-choice-list${question.multiSelect ? ' is-multi' : ' is-single'}`}
              role={question.multiSelect ? 'group' : 'radiogroup'}
              aria-label={question.question}
            >
              {choices.map((choice) => {
                if (question.multiSelect) {
                  const selected = (multi[safeStep] ?? []).includes(choice)
                  return (
                    <label
                      key={choice}
                      className={`ask-choice${selected ? ' selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        disabled={submitting}
                        checked={selected}
                        onChange={() =>
                          setMulti((prev) => {
                            const current = prev[safeStep] ?? []
                            const next = selected
                              ? current.filter((item) => item !== choice)
                              : [...current, choice]
                            return { ...prev, [safeStep]: next }
                          })
                        }
                      />
                      <span className="ask-choice-mark" aria-hidden />
                      <span className="ask-choice-label" title={choice}>
                        {choice}
                      </span>
                    </label>
                  )
                }
                const selected = single[safeStep] === choice
                return (
                  <label
                    key={choice}
                    className={`ask-choice${selected ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`ask-${safeStep}`}
                      disabled={submitting}
                      checked={selected}
                      onChange={() =>
                        setSingle((prev) => ({ ...prev, [safeStep]: choice }))
                      }
                    />
                    <span className="ask-choice-mark" aria-hidden />
                    <span className="ask-choice-label" title={choice}>
                      {choice}
                    </span>
                  </label>
                )
              })}
              {question.multiSelect ? (
                <label className={`ask-choice${otherOn ? ' selected' : ''}`}>
                  <input
                    type="checkbox"
                    disabled={submitting}
                    checked={otherOn}
                    onChange={() =>
                      setMulti((prev) => {
                        const current = prev[safeStep] ?? []
                        const next = otherOn
                          ? current.filter((item) => item !== ASK_OTHER)
                          : [...current, ASK_OTHER]
                        return { ...prev, [safeStep]: next }
                      })
                    }
                  />
                  <span className="ask-choice-mark" aria-hidden />
                  <span className="ask-choice-label">{t('tool.askOther')}</span>
                </label>
              ) : (
                <label className={`ask-choice${otherOn ? ' selected' : ''}`}>
                  <input
                    type="radio"
                    name={`ask-${safeStep}`}
                    disabled={submitting}
                    checked={otherOn}
                    onChange={() =>
                      setSingle((prev) => ({ ...prev, [safeStep]: ASK_OTHER }))
                    }
                  />
                  <span className="ask-choice-mark" aria-hidden />
                  <span className="ask-choice-label">{t('tool.askOther')}</span>
                </label>
              )}
            </div>
            {otherOn && (
              <input
                className="text-field ask-other-field"
                disabled={submitting}
                placeholder={t('tool.askOtherPlaceholder')}
                value={free[safeStep] ?? ''}
                onChange={(event) =>
                  setFree((prev) => ({ ...prev, [safeStep]: event.target.value }))
                }
                autoFocus
              />
            )}
          </>
        )}
      </div>

      {isLast && (
        <input
          className="text-field ask-note"
          disabled={submitting}
          placeholder={t('tool.askOptionalNote')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      )}

      <div className="ask-actions">
        {multiStep && safeStep > 0 && (
          <Button
            label={t('tool.askBack')}
            disabled={submitting}
            onClick={goBack}
          />
        )}
        <span className="spacer" />
        {multiStep && !isLast ? (
          <Button
            label={t('tool.askNext')}
            variant="primary"
            disabled={!currentReady || submitting}
            title={currentReady ? undefined : t('tool.askAnswerCurrent')}
            onClick={goNext}
          />
        ) : (
          <Button
            label={submitting ? t('common.submitting') : t('common.submit')}
            variant="primary"
            disabled={!allReady || submitting}
            title={allReady ? undefined : t('tool.askCompleteRequired')}
            onClick={submit}
          />
        )}
      </div>
    </div>
  )
}

function parseAnswers(output: string): AnswerValue[] {
  try {
    const parsed = JSON.parse(output) as { answers?: Array<{ questionIndex?: number; value?: AnswerValue }> }
    if (!Array.isArray(parsed.answers)) return [output]
    const max = Math.max(...parsed.answers.map((row) => row.questionIndex ?? 0), 0)
    const values: AnswerValue[] = Array.from({ length: max + 1 }, () => '')
    for (const row of parsed.answers) {
      if (row.questionIndex == null) continue
      values[row.questionIndex] = row.value ?? ''
    }
    return values
  } catch {
    return [output]
  }
}

function formatAnswer(value: AnswerValue | undefined): string {
  if (value == null || value === '') return tt('common.none')
  if (Array.isArray(value)) return value.length ? value.join(' · ') : tt('tool.detail.notSelected')
  return value
}
