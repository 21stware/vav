/**
 * Skills listed in the built-in agent system prompt.
 * Everything else stays on disk and still loads via `load_skill` if asked.
 */
export const DEFAULT_PROMPT_SKILL_IDS = [
  'officecli',
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'doc-coauthoring',
  'frontend-design',
  'frontend-dev',
  'fullstack-dev'
] as const

const ALLOW = new Set<string>(DEFAULT_PROMPT_SKILL_IDS)

export function isDefaultPromptSkill(id: string): boolean {
  return ALLOW.has(id)
}

export function skillsForPrompt<T extends { id: string }>(skills: T[]): T[] {
  return skills.filter((skill) => ALLOW.has(skill.id))
}
