import type { ImageAttachPlan } from '../../../shared/agentImageInput.ts'
import { imageInputLimits, mergeImageAttachments } from '../../../shared/agentImageInput.ts'
import type { MessageKey, TParams } from '../../../shared/i18n/index.ts'

export type ImageAttachToast =
  | { kind: 'info'; titleKey: 'composer.imageTooLarge'; mb: number }
  | { kind: 'info'; titleKey: 'composer.imagesTooMany'; max: number }
  | { kind: 'info'; titleKey: 'composer.imageTypeUnsupported' }

type Translate = (key: MessageKey, params?: TParams) => string

/** Toast for a rejected/truncated image attach plan, or null when all files stayed. */
export function imageAttachToast(plan: ImageAttachPlan): ImageAttachToast | null {
  if (
    plan.rejectedUnsupported === 0 &&
    plan.droppedForLimit === 0 &&
    plan.rejectedOversize === 0 &&
    plan.rejectedType === 0
  ) {
    return null
  }
  if (plan.rejectedOversize > 0) {
    return {
      kind: 'info',
      titleKey: 'composer.imageTooLarge',
      mb: Math.max(1, Math.round(plan.maxBytes / (1024 * 1024)))
    }
  }
  if (plan.droppedForLimit > 0) {
    return { kind: 'info', titleKey: 'composer.imagesTooMany', max: plan.maxCount }
  }
  return { kind: 'info', titleKey: 'composer.imageTypeUnsupported' }
}

export function imageAttachToastState(
  plan: ImageAttachPlan,
  translate: Translate
): { kind: 'info'; title: string } | null {
  const toast = imageAttachToast(plan)
  if (!toast) return null
  if (toast.titleKey === 'composer.imageTooLarge') {
    return { kind: 'info', title: translate(toast.titleKey, { mb: toast.mb }) }
  }
  if (toast.titleKey === 'composer.imagesTooMany') {
    return { kind: 'info', title: translate(toast.titleKey, { max: toast.max }) }
  }
  return { kind: 'info', title: translate(toast.titleKey) }
}

export function notifyImageAttachPlan(
  showToast: (toast: { kind: 'info'; title: string } | null) => void,
  plan: ImageAttachPlan,
  translate: Translate
): void {
  const toast = imageAttachToastState(plan, translate)
  if (toast) showToast(toast)
}

/** Re-apply host image limits to existing attachments. Null when nothing changed. */
export function trimAttachmentPathsForHost(
  existing: string[],
  host: string | null | undefined
): { paths: string[]; plan: ImageAttachPlan } | null {
  if (existing.length === 0) return null
  const plan = mergeImageAttachments({
    existing: [],
    incoming: existing,
    capability: imageInputLimits(host)
  })
  if (plan.paths.length === existing.length && plan.paths.every((p, i) => p === existing[i])) {
    return null
  }
  return { paths: plan.paths, plan }
}
