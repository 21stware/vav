/** MV3 globals used by the phone-ui extension transport. */
interface ChromeRuntimePort {
  postMessage: (msg: unknown) => void
  onMessage: { addListener: (fn: (msg: never) => void) => void }
  onDisconnect: { addListener: (fn: () => void) => void }
}

interface ChromeRuntime {
  id?: string
  connect: (info: { name: string }) => ChromeRuntimePort
}

declare const chrome: { runtime: ChromeRuntime }
