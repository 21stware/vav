import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildSystemPrompt, osDisplayName } from './systemPrompt.ts'

describe('osDisplayName', () => {
  it('maps known platforms', () => {
    assert.equal(osDisplayName('darwin'), 'macOS')
    assert.equal(osDisplayName('win32'), 'Windows')
    assert.equal(osDisplayName('linux'), 'Linux')
    assert.equal(osDisplayName('freebsd'), 'freebsd')
  })
})

describe('buildSystemPrompt', () => {
  it('names the injected platform and shell', () => {
    const prompt = buildSystemPrompt('/tmp/proj', 'zsh', { platform: 'darwin' })
    assert.match(prompt, /macOS machine/)
    assert.match(prompt, /working directory for this conversation is: \/tmp\/proj/)
    assert.match(prompt, /user's shell is zsh/)
    assert.match(prompt, /<!-- vav-artifact -->/)
    assert.doesNotMatch(prompt, /READ-ONLY SESSION/)
  })

  it('adds read-only and open-file guidance', () => {
    const ro = buildSystemPrompt('/w', 'bash', {
      platform: 'linux',
      fileReadOnly: true,
      openFilePath: '/w/notes.md',
      skillCatalog: 'officecli'
    })
    assert.match(ro, /Linux machine/)
    assert.match(ro, /READ-ONLY SESSION/)
    assert.match(ro, /viewing this file in the preview: \/w\/notes\.md/)
    assert.match(ro, /Bundled catalog:\nofficecli/)
    const pdf = buildSystemPrompt('/w', 'bash', {
      platform: 'win32',
      openFilePath: '/w/a.pdf',
      openFileKind: 'pdf'
    })
    assert.match(pdf, /Windows machine/)
    assert.match(pdf, /load_skill\("pdf"\)/)
  })

  it('names the live database dialect', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'ClickHouse'
    })
    assert.match(prompt, /live ClickHouse database/)
    assert.match(prompt, /sql_query/)
  })

  it('names the open table so "this table" is grounded', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'PostgreSQL',
      dbTitle: 'pfmegrnargs@hh-pgsql-public.ebi.ac.uk',
      dbTable: 'rnacen.xref'
    })
    assert.match(prompt, /pfmegrnargs@hh-pgsql-public\.ebi\.ac\.uk/)
    assert.match(prompt, /rnacen\.xref/)
    assert.match(prompt, /this table/)
  })

  it('says settings are in view when no table is open', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      dbSession: true,
      dbDriver: 'PostgreSQL',
      dbTitle: 'pfmegrnargs@host'
    })
    assert.match(prompt, /connection's settings/)
    assert.doesNotMatch(prompt, /viewing table/)
  })

  it('lists session secret names without values', () => {
    const prompt = buildSystemPrompt('/w', 'zsh', {
      platform: 'darwin',
      sessionSecretNames: ['OPENAI_API_KEY', 'GH_TOKEN']
    })
    assert.match(prompt, /request_for_secret/)
    assert.match(prompt, /OPENAI_API_KEY, GH_TOKEN/)
    assert.doesNotMatch(prompt, /sk-/)
  })
})
