import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isTrustedIpcSender } from './ipcTrust.ts'

const appUrl = 'file:///app/index.html'
const isApp = (url: string): boolean => url.startsWith('file:')

function sender(opts: {
  destroyed?: boolean
  url?: string
  frame?: { url?: string } | null
  frameIsMain?: boolean
}): Parameters<typeof isTrustedIpcSender>[0] {
  const main = { id: 1 }
  const frame = opts.frame === undefined ? { url: opts.url ?? appUrl } : opts.frame
  return {
    sender: {
      isDestroyed: () => !!opts.destroyed,
      mainFrame: main,
      getURL: () => opts.url ?? appUrl
    },
    senderFrame: opts.frameIsMain === false ? { url: 'about:srcdoc' } : frame
  }
}

describe('isTrustedIpcSender', () => {
  it('accepts the app renderer main frame', () => {
    const main = { id: 1 }
    const event = {
      sender: {
        isDestroyed: () => false,
        mainFrame: main,
        getURL: () => appUrl
      },
      senderFrame: main as { url?: string }
    }
    // Same object identity as mainFrame
    event.senderFrame = event.sender.mainFrame as { url?: string }
    ;(event.senderFrame as { url?: string }).url = appUrl
    assert.equal(isTrustedIpcSender(event, isApp), true)
  })

  it('rejects destroyed senders and guest frames', () => {
    assert.equal(isTrustedIpcSender(sender({ destroyed: true }), isApp), false)
    const main = { id: 1 }
    const guest = { url: 'about:srcdoc' }
    const event = {
      sender: {
        isDestroyed: () => false,
        mainFrame: main,
        getURL: () => appUrl
      },
      senderFrame: guest
    }
    assert.equal(isTrustedIpcSender(event, isApp), false)
  })

  it('rejects a non-app URL even on the main frame', () => {
    const main = { url: 'https://evil.example/' }
    const event = {
      sender: {
        isDestroyed: () => false,
        mainFrame: main,
        getURL: () => 'https://evil.example/'
      },
      senderFrame: main
    }
    assert.equal(isTrustedIpcSender(event, isApp), false)
  })
})
