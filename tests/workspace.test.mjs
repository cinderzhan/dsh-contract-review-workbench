import test from 'node:test'
import assert from 'node:assert/strict'
import { requestAI } from '../src/bridge.js'

const owner = 'cinderzhan/dsh-contract-review-workbench'
function mockService({ current = 'default-session' } = {}) {
  let session = current
  const calls = []
  const service = {
    state: { active: owner, added: [owner], sessionBindings: { 'default-session': owner, 'chosen-session': owner } },
    currentSession: () => session,
    newWorkspaceSession: async () => { calls.push('picker'); throw new Error('Unexpected picker') },
    ensureSession: async ({ sessionId }) => { calls.push(`restore:${sessionId}`); session = sessionId },
    request: async (_path, options) => { calls.push('request'); return { ok: true, json: async () => ({ action: JSON.parse(options.body).action }) } },
  }
  return { service, calls }
}
const payload = { sessionIds: ['chosen-session'], projectSessionId: 'chosen-session', projectFolderConfirmed: true, otherSessionIds: [] }

test('AI review requires a folder selected on upload page', async () => {
  const { service, calls } = mockService()
  await assert.rejects(requestAI(service, 'review', { sessionIds: [], otherSessionIds: [] }), /上传合同页选择项目文件夹/)
  assert.deepEqual(calls, [])
})

test('review reuses the selected current session', async () => {
  const { service, calls } = mockService({ current: 'chosen-session' })
  const result = await requestAI(service, 'review', payload)
  assert.equal(result.sessionId, 'chosen-session')
  assert.deepEqual(calls, ['request'])
})

test('review restores the saved project session without reopening a directory picker', async () => {
  const { service, calls } = mockService()
  const result = await requestAI(service, 'revise', payload)
  assert.equal(result.sessionId, 'chosen-session')
  assert.deepEqual(calls, ['restore:chosen-session', 'request'])
})
