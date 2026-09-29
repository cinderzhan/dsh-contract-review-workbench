import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { saveProject } from '../dsh/project.js'
import { OWNER } from '../dsh/ai.js'

const record = (id = 'contract-1') => ({ id, sourceName: '虚构合同.txt', text: '甲方付款。乙方交付。', reviewedAt: '2026-09-29', issues: [{ title: '付款时间不明', status: 'open' }], patches: [{ status: 'accepted' }], workspaceSessionId: 's1', projectFolderConfirmed: true })
const request = (body, signal) => new Request('http://localhost/api/contract-review/project', { method: 'POST', body: JSON.stringify(body), signal })
const body = () => ({ sessionId: 's1', record: record(), report: '# 审核记录\n\n付款时间不明', revisionText: '甲方在七日内付款。乙方交付。' })
const ctx = folder => ({ desktopWorkbenchOwnership: { read: async () => ({ added: [OWNER], sessionBindings: { s1: OWNER } }) }, workspaceRegistry: { list: () => [{ id: 'w1', path: folder, sessionIds: ['s1'] }] } })

test('selected workspace owns automatic contract, report, revision and state files', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'contract-workbench-project-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const result = await saveProject(ctx(folder), request(body()))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).relativePath, '合同审核工作台/contract-1')
  const project = path.join(folder, '合同审核工作台', 'contract-1')
  assert.equal(await readFile(path.join(project, '合同原文.txt'), 'utf8'), body().record.text)
  assert.equal(await readFile(path.join(project, '审核记录.md'), 'utf8'), body().report)
  assert.equal(await readFile(path.join(project, '修订稿.txt'), 'utf8'), body().revisionText)
  assert.deepEqual(JSON.parse(await readFile(path.join(project, '项目状态.json'), 'utf8')), body().record)
  assert.deepEqual((await readdir(project)).sort(), ['修订稿.txt', '合同原文.txt', '审核记录.md', '项目状态.json'])
})

test('server rejects unowned session, unrelated folder and traversal ids before writing', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'contract-workbench-project-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const unrelated = { ...ctx(folder), workspaceRegistry: { list: () => [{ path: folder, sessionIds: ['other'] }] } }
  assert.equal((await saveProject(unrelated, request(body()))).status, 409)
  const unowned = { ...ctx(folder), desktopWorkbenchOwnership: { read: async () => ({ added: [OWNER], sessionBindings: {} }) } }
  assert.equal((await saveProject(unowned, request(body()))).status, 403)
  assert.equal((await saveProject(ctx(folder), request({ ...body(), record: record('../escape') }))).status, 400)
  assert.equal((await saveProject(ctx(folder), request({ ...body(), record: { ...record(), projectFolderConfirmed: false } }))).status, 409)
  assert.deepEqual(await readdir(folder), [])
})

test('symlink project directory is rejected and request size is bounded', async t => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'contract-workbench-project-'))
  const outside = await mkdtemp(path.join(os.tmpdir(), 'contract-workbench-outside-'))
  t.after(async () => { await rm(folder, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) })
  await symlink(outside, path.join(folder, '合同审核工作台'))
  assert.equal((await saveProject(ctx(folder), request(body()))).status, 409)
  assert.deepEqual(await readdir(outside), [])
  const tooLarge = { ...body(), extra: 'x'.repeat(1024 * 1024) }
  assert.equal((await saveProject(ctx(folder), request(tooLarge))).status, 413)
})
