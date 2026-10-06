import { create } from 'zustand'

type OnboardingPreviewState = {
  /** Dev-only: replay the first-launch tour over the running app. */
  open: boolean
  setOpen: (open: boolean) => void
}

export const useOnboardingPreview = create<OnboardingPreviewState>((set) => ({
  open: false,
  setOpen(open) {
    set({ open })
  }
}))
