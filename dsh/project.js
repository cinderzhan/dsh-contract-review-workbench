import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ReviewError, assertOwner } from './ai.js'

const ROOT = '合同审核工作台'
const MAX_BODY = 1024 * 1024

async function readProjectRequest(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new ReviewError('保存请求缺少内容。')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_BODY) { await reader.cancel(); throw new ReviewError('项目资料超过 1 MB，无法保存。', 413) }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  let data
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new ReviewError('保存请求的 JSON 无效。') }
  const record = data?.record
  if (typeof data?.sessionId !== 'string' || !data.sessionId || data.sessionId.length > 200 || !record || typeof record !== 'object' || Array.isArray(record) || !/^[a-zA-Z0-9_-]{1,100}$/.test(record.id || '') || typeof record.text !== 'string' || record.text.length > 60000 || typeof data.report !== 'string' || data.report.length > 200000 || typeof data.revisionText !== 'string' || data.revisionText.length > 120000) throw new ReviewError('项目资料格式无效或内容过长。')
  if (record.projectFolderConfirmed !== true || record.workspaceSessionId !== data.sessionId) throw new ReviewError('请先在上传合同步骤选择项目文件夹。', 409)
  return data
}

async function directory(parent, name) {
  const target = path.join(parent, name)
  try { await mkdir(target) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const stat = await lstat(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ReviewError('项目文件夹不是安全的目录，请另选位置。', 409)
  return target
}

async function atomicText(directoryPath, name, content) {
  const destination = path.join(directoryPath, name)
  const temporary = path.join(directoryPath, `.${randomUUID()}.tmp`)
  let handle
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.close()
    handle = undefined
    await rename(temporary, destination)
  } finally {
    await handle?.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
}

export async function saveProject(ctx, request) {
  try {
    const { sessionId, record, report, revisionText } = await readProjectRequest(request)
    await assertOwner(ctx, sessionId)
    const workspaces = await ctx.workspaceRegistry.list()
    const workspace = workspaces.find(item => Array.isArray(item.sessionIds) && item.sessionIds.includes(sessionId))
    if (!workspace || !path.isAbsolute(workspace.path || '')) throw new ReviewError('所选项目文件夹不可用，请在上传合同步骤重新选择。', 409)
    const root = await directory(workspace.path, ROOT)
    const project = await directory(root, record.id)
    // Recheck ownership just before writing, since the Desktop can switch workbenches.
    await assertOwner(ctx, sessionId)
    await atomicText(project, '合同原文.txt', record.text)
    await atomicText(project, '项目状态.json', JSON.stringify(record, null, 2) + '\n')
    if (record.reviewedAt && report) await atomicText(project, '审核记录.md', report)
    else await unlink(path.join(project, '审核记录.md')).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (Array.isArray(record.patches) && record.patches.some(item => item.status === 'accepted')) await atomicText(project, '修订稿.txt', revisionText)
    else await unlink(path.join(project, '修订稿.txt')).catch(error => { if (error.code !== 'ENOENT') throw error })
    return Response.json({ saved: true, relativePath: `${ROOT}/${record.id}` }, { headers: { 'cache-control': 'no-store' } })
  } catch (error) {
    const known = error instanceof ReviewError
    return Response.json({ error: known ? error.message : '无法保存项目资料，请检查文件夹权限与剩余空间后重试。' }, { status: known ? error.status : 500 })
  }
}
