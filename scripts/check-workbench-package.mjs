import fs from 'node:fs'
import assert from 'node:assert/strict'
const p = JSON.parse(fs.readFileSync('package.json'))
assert.match(p.version, /^\d+\.\d+\.\d+$/)
assert.equal(p.main, p.exports['.'])
assert.equal(p.dsh.client.platform, 'web')
assert.ok(p.dsh.client.inject.includes('dsh-desktop-workbenches'))
for (const file of [p.main, p.exports['./client'], p.dsh.bundle.patch, './dsh/ai.js']) assert.ok(fs.statSync(file).size > 0, file)
assert.ok(fs.readFileSync(p.dsh.bundle.patch, 'utf8').includes(`name: ${p.name}`))
console.log(`PASS ${p.name}@${p.version}: manifest, patch and built entries`)
