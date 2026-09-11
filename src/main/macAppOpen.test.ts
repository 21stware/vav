import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  packagedMacCliLauncher,
  packagedMacOpenDirectoryHelper,
  shSingleQuote
} from './macAppOpen.ts'

describe('packagedMacCliLauncher', () => {
  const script = packagedMacCliLauncher('/Applications/VAV.app', 'Usage: vav [path]\n')

  it('activates the bundle without starting a second Chromium', () => {
    assert.match(script, /^#!\/bin\/sh/)
    assert.match(script, /open -a "\$APP"/)
    assert.doesNotMatch(script, /open -n/)
    assert.doesNotMatch(script, /--args/)
    assert.doesNotMatch(script, /--vav-workdir/)
  })

  it('hands a path to the running app as a document, not argv', () => {
    assert.match(script, /open -a "\$APP" "\$TARGET"/)
    assert.match(script, /APP="\/Applications\/VAV\.app"/)
    assert.match(script, /Usage: vav \[path\]/)
  })
})

describe('packagedMacOpenDirectoryHelper', () => {
  it('opens the folder in the running app without -n', () => {
    const script = packagedMacOpenDirectoryHelper('/Applications/VAV.app')
    assert.match(script, /^#!\/bin\/sh/)
    assert.match(script, /open -a '\/Applications\/VAV\.app' "\$f"/)
    assert.doesNotMatch(script, /open -n/)
    assert.doesNotMatch(script, /--args/)
    assert.doesNotMatch(script, /--vav-workdir/)
  })

  it('quotes a bundle path that contains spaces', () => {
    const script = packagedMacOpenDirectoryHelper('/Apps/VAV Copy.app')
    assert.match(script, /open -a '\/Apps\/VAV Copy\.app' "\$f"/)
    assert.equal(shSingleQuote("it's"), `'it'\\''s'`)
  })
})
