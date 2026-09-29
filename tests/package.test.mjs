import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')

test('DSH manifest and patch point to the built entries', () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  assert.equal(manifest.main, './dsh/index.js')
  assert.equal(manifest.exports['.'], manifest.main)
  assert.equal(manifest.exports['./client'], './lib/client.js')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('dsh-desktop-workbenches'))
  assert.match(patch, /name: dsh-contract-review-workbench/)
})

test('single-file client registers one removable workbench provider', () => {
  let declaration
  let descriptor
  let panel
  let dispose
  const style = { dataset: {}, textContent: '', remove() {} }
  let currentStyle
  const React = { createElement() {} }
  runInNewContext(client, {
    window: { __ModuleLoader__: { load(value) { declaration = value } } },
    document: { querySelector() { return currentStyle }, createElement() { return style }, head: { append(node) { currentStyle = node } } },
    globalThis: {}, Date, Math, URL, Blob, setTimeout
  })
  assert.equal(declaration.id, manifest.name)
  const plugin = declaration.factory(name => { assert.equal(name, 'react'); return React })
  assert.deepEqual(Array.from(plugin.inject), ['desktopWorkbenches'])
  plugin.apply({
    effect(callback) { dispose = callback() },
    desktopWorkbenches: { register(value, Component) { descriptor = value; panel = Component; return () => { descriptor = null } } }
  })
  assert.equal(descriptor.title, '合同审核工作台')
  assert.equal(descriptor.id, undefined)
  assert.equal(descriptor.customFrame, true)
  assert.match(descriptor.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/)
  assert.equal(typeof panel, 'function')
  dispose()
  assert.equal(descriptor, null)
})
