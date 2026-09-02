declare global {
  interface Window {
    vav: {
      bootstrap(): Promise<{
        about: { version: string; userDataPath: string }
        resolvedLocale: string
        settings?: { apiKeyPresent?: boolean }
      }>
      window: {
        openSettings(view?: string, agentId?: string): Promise<void>
        closeSettings(): Promise<void>
        openTokenUsage(conversationId: string): Promise<void>
        peekPopupMenu(): Promise<{ id?: string; label?: string; checked?: boolean }[] | null>
        choosePopupMenu(idOrLabel: string): Promise<boolean>
        dismissPopupMenu(): Promise<boolean>
      }
      settings: {
        get(): Promise<{ apiKeyPresent: boolean }>
        setApiKey(key: string): Promise<{ hint: string | null }>
      }
      accounts: {
        createDraft(input: {
          agentId: string
          kind: string
          endpoint?: string
        }): Promise<{ id: string }>
        updateVav(
          id: string,
          patch: { apiKey?: string; alias?: string; endpoint?: string }
        ): Promise<unknown>
        setCurrent(id: string): Promise<unknown>
      }
      hosts: {
        pair(payload: string): Promise<{ ok: true; host: { id: string } } | { ok: false; error: string }>
        list(): Promise<{ id: string; online?: boolean; name?: string; controlPlane?: boolean }[]>
        pairing(): string | null
      }
      conversations: {
        get(id: string): Promise<{
          messages: { role?: string; content?: string }[]
          title?: string
          archived?: boolean
          pinned?: boolean
          resultUnseen?: boolean
          workingDirectory?: string | null
          machineId?: string | null
          acpSession?: {
            currentModeId?: string | null
            configOptions?: { id: string; currentValue: string | boolean; category?: string }[]
          } | null
          approvalMode?: string
        } | null>
      }
      agent: {
        send(id: string, text: string, attachments: string[]): Promise<unknown>
      }
    }
  }
}

export {}
