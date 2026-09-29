import test from 'node:test'
import assert from 'node:assert/strict'
import { requestAI } from '../src/bridge.js'

const owner = 'cinderzhan/dsh-contract-review-workbench'

function mockService({ current = 'default-session', chosen = 'chosen-session' } = {}) {
  let session = current
  const calls = []
  const service = {
    state: { active: owner, added: [owner], sessionBindings: { 'default-session': owner, 'chosen-session': owner } },
    currentSession: () => session,
    newSession: async () => { calls.push('implicit'); return 'default-session' },
    newWorkspaceSession: async () => { calls.push('picker'); if (chosen) session = chosen; return chosen },
    request: async (_path, options) => { calls.push('request'); return { ok: true, json: async () => ({ action: JSON.parse(options.body).action }) } },
  }
  return { service, calls }
}

test('first AI review chooses a directory even when Desktop has a default workspace', async () => {
  const { service, calls } = mockService()
  const result = await requestAI(service, 'review', { sessionIds: [], otherSessionIds: [] })
  assert.equal(result.sessionId, 'chosen-session')
  assert.deepEqual(calls, ['picker', 'request'])
})

test('review reuses only the current session linked to this contract', async () => {
  const { service, calls } = mockService({ current: 'default-session' })
  const result = await requestAI(service, 'revise', { sessionIds: ['default-session'], otherSessionIds: [] })
  assert.equal(result.sessionId, 'default-session')
  assert.deepEqual(calls, ['request'])
})

test('canceling the directory picker sends no AI request and creates no implicit session', async () => {
  const { service, calls } = mockService({ chosen: null })
  await assert.rejects(requestAI(service, 'review', { sessionIds: [], otherSessionIds: [] }), { name: 'AbortError' })
  assert.deepEqual(calls, ['picker'])
})
