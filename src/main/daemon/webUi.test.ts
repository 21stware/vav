import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { assembleWebUiHtml, phoneUiDir, phoneUiMime, readPhoneUiFile } from './webUi.ts'

describe('webUi', () => {
  it('maps phone-ui filenames to HTTP types', () => {
    assert.equal(phoneUiMime('phone.css'), 'text/css; charset=utf-8')
    assert.equal(phoneUiMime('phone.js'), 'text/javascript; charset=utf-8')
    assert.equal(phoneUiMime('index.html'), 'text/html; charset=utf-8')
    assert.equal(phoneUiMime('icon.png'), 'image/png')
    assert.equal(phoneUiMime('phone.js.map'), 'application/json; charset=utf-8')
    assert.equal(phoneUiMime('data.bin'), 'application/octet-stream')
  })

  it('falls back to the stub page when no bundle is on disk', () => {
    const html = assembleWebUiHtml('/no/such/phone-ui')
    assert.match(html, /data-phone="web"/)
    assert.match(html, /phone\.js/)
    assert.match(html, /phone\.css/)
  })

  it('reads a file from a phone-ui directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-phone-ui-'))
    try {
      writeFileSync(join(dir, 'phone.js'), 'window.vav = 1\n')
      assert.equal(readPhoneUiFile('phone.js', dir), 'window.vav = 1\n')
      assert.equal(readPhoneUiFile('missing.js', dir), null)
      assert.equal(readPhoneUiFile('phone.js', '/no/such'), null)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('finds the built phone UI from the repo', () => {
    const dir = phoneUiDir()
    assert.ok(dir, 'run npm run build:phone-ui')
    assert.ok(readPhoneUiFile('phone.js', dir) || readPhoneUiFile('index.html', dir))
  })

  it('prefers index.html from the given directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vav-phone-html-'))
    try {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), '<html data-phone="test"></html>')
      assert.match(assembleWebUiHtml(dir), /data-phone="test"/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
