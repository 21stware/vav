import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LOCAL_MACHINE_ID } from '@shared/workspaceHost.ts'
import { WEB_PREVIEW_CHAT_ID, WEB_PREVIEW_WORKSPACE } from './scenes.ts'
import { applyWebPreviewDocument, createFixtureVav } from './fixtureVav.ts'

describe('web preview fixture vav', () => {
  it('boots chat scene with an unlocked keychain and a live session', async () => {
    const vav = createFixtureVav({ scene: 'chat' })
    assert.equal(vav.platform, 'darwin')
    const status = await vav.secrets.status()
    assert.equal(status.needsUnlock, false)
    assert.equal(status.unlocked, true)
    const data = await vav.bootstrap()
    assert.equal(data.activeConversationId, WEB_PREVIEW_CHAT_ID)
    assert.equal(data.settings.apiKeyPresent, true)
    assert.equal(data.hosts[0]?.id, LOCAL_MACHINE_ID)
    const conversation = await vav.conversations.get(WEB_PREVIEW_CHAT_ID)
    assert.ok(conversation)
    assert.equal(conversation.messages.length, 4)
    const agent = await vav.agent.status(WEB_PREVIEW_CHAT_ID)
    assert.equal(agent.phase, 'idle')
  })

  it('keeps empty scene first-run (no key, no sessions)', async () => {
    const vav = createFixtureVav({ scene: 'empty' })
    const data = await vav.bootstrap()
    assert.equal(data.settings.apiKeyPresent, false)
    assert.equal(data.conversations.length, 0)
    assert.equal(data.activeConversationId, '')
    assert.equal(data.apiKeyHint, null)
  })

  it('lists the fixture workspace and inspects README', async () => {
    const vav = createFixtureVav({ scene: 'chat' })
    const listing = await vav.files.list(WEB_PREVIEW_WORKSPACE, 'name', true)
    assert.equal(listing.error, undefined)
    assert.ok(listing.entries.some((entry) => entry.name === 'README.md'))
    const readme = await vav.files.inspect(`${WEB_PREVIEW_WORKSPACE}/README.md`)
    assert.equal(readme.kind, 'text')
    assert.match(readme.text ?? '', /Preview project/)
  })

  it('persists settings patches and mints a new session', async () => {
    const vav = createFixtureVav({ scene: 'home' })
    const next = await vav.settings.update({ theme: 'dark' })
    assert.equal(next.theme, 'dark')
    assert.equal((await vav.settings.get()).theme, 'dark')
    const created = await vav.conversations.create()
    assert.match(created.id, /^preview-new-/)
    assert.equal(created.title, 'New session')
    const listed = await vav.conversations.list()
    assert.equal(listed[0]?.id, created.id)
  })

  it('exposes analysis and screenshot permission for Settings', async () => {
    const vav = createFixtureVav({ scene: 'settings' })
    const snapshot = await vav.settings.analysis()
    assert.equal(snapshot.usage.hosts.length, 0)
    assert.equal(await vav.files.screenshotPermission(), 'granted')
    assert.equal((await vav.computer.status()).available, false)
  })

  it('does not throw on unused preload methods', async () => {
    const vav = createFixtureVav({ scene: 'chat' })
    const off = vav.logs.onChanged(() => undefined)
    assert.equal(typeof off, 'function')
    off()
    await assert.doesNotReject(() => vav.notifications.permission())
    assert.equal(vav.files.pathForFile({ name: 'x' } as File), '')
  })

  it('marks the document as web preview without vibrancy', () => {
    const doc = {
      documentElement: {
        dataset: { vibrancy: 'true', theme: 'dark' } as Record<string, string>,
        style: { background: '', setProperty() {} }
      },
      title: 'vav',
      head: { appendChild(node: { id?: string }) { this.last = node } } as {
        appendChild: (node: { id?: string }) => void
        last?: { id?: string }
      },
      body: {
        appendChild(node: { className?: string }) {
          this.last = node
        }
      } as { appendChild: (node: { className?: string }) => void; last?: { className?: string } },
      getElementById: () => null,
      querySelector: () => null,
      createElement: (tag: string) => ({ tag, id: '', textContent: '', className: '' })
    }
    applyWebPreviewDocument(doc as unknown as Document)
    assert.equal(doc.documentElement.dataset.webPreview, 'true')
    assert.equal(doc.documentElement.dataset.observeLive, 'false')
    assert.equal(doc.documentElement.dataset.vibrancy, undefined)
    assert.equal(doc.title, 'vav (web preview)')
    applyWebPreviewDocument(doc as unknown as Document, { live: true })
    assert.equal(doc.documentElement.dataset.observeLive, 'true')
    assert.equal(doc.title, 'vav (live observe)')
  })
})
