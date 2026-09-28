import test from 'node:test'
import assert from 'node:assert/strict'
import { insertAssistantContext } from '../src/bridge.js'
const owner = 'cinderzhan/dsh-contract-review-workbench'
test('Assistant preserves selected draft text and only inserts context without submitting', () => {
  let captured
  const input = { state: { getSnapshot: () => ({ draft: 'existing', phase: 'idle' }) }, actions: { captureInsertion: () => ({ start: 1, end: 5, version: 7 }), insertText: (...args) => { captured = args; return true } } }
  const service = { currentSession: () => 's', state: { active: owner, sessionBindings: { s: owner } }, ctx: { sessions: { scope: () => ({}) }, get: () => ({ input: { for: () => input } }) } }
  assert.equal(insertAssistantContext(service, owner, 'contract'), 's')
  assert.deepEqual(captured, ['\n\ncontract\n\n', { start: 5, end: 5, version: 7 }])
  service.state.active = 'other'
  assert.throws(() => insertAssistantContext(service, owner, 'contract'))
})
