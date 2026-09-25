import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { createVavApi } from '@shared/createVavApi'
import type { Platform } from '@shared/platform'

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

const api = createVavApi({
  platform: process.platform as Platform,
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  send: (channel, ...args) => {
    ipcRenderer.send(channel, ...args)
  },
  subscribe,
  pathForFile: (file) => webUtils.getPathForFile(file)
})

contextBridge.exposeInMainWorld('vav', api)
