import type { ImageAttachPlan } from '../../../shared/agentImageInput.ts'

export type ImageAttachToast =
  | { kind: 'info'; titleKey: 'composer.imageTooLarge'; mb: number }
  | { kind: 'info'; titleKey: 'composer.imagesTooMany'; max: number }
  | { kind: 'info'; titleKey: 'composer.imageTypeUnsupported' }

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
