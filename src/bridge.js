const OWNER = 'cinderzhan/dsh-contract-review-workbench'
export async function requestAI(service, action, payload, { signal } = {}) {
  const active = () => service.state.active === OWNER && service.state.added.includes(OWNER)
  if (!active()) throw new Error('请先打开合同审核工作台。')
  signal?.throwIfAborted()
  let sessionId = service.currentSession()
  if (!sessionId || service.state.sessionBindings[sessionId] !== OWNER || (payload.otherSessionIds || []).includes(sessionId)) {
    sessionId = await service.newSession()
    signal?.throwIfAborted()
    if (!sessionId) throw new Error('未创建审核会话，操作已取消。')
  }
  const valid = () => active() && service.currentSession() === sessionId && service.state.sessionBindings[sessionId] === OWNER
  if (!valid()) throw new Error('会话已切换，请在当前合同工作台重新操作。')
  const response = await service.request('/api/contract-review/ai', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, action, sessionId }), signal })
  signal?.throwIfAborted()
  if (!valid()) throw new Error('会话已切换，已丢弃旧会话的审核结果。')
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `AI 请求失败（${response.status}）。`)
  signal?.throwIfAborted()
  if (!valid()) throw new Error('会话已切换，已丢弃旧会话的审核结果。')
  return { ...result, sessionId }
}

export function insertAssistantContext(service, owner, contextText) {
  const sessionId = service.currentSession()
  if (!sessionId || owner !== OWNER || service.state.active !== owner || service.state.sessionBindings[sessionId] !== owner) throw new Error('请先打开当前合同的审核会话。')
  const scope = service.ctx.sessions.scope(sessionId)
  const conversation = service.ctx.get('conversation')
  if (!scope || !conversation?.input?.for) throw new Error('审核助手尚未准备好，请稍后重试。')
  const input = conversation.input.for(scope)
  const snapshot = input.state.getSnapshot()
  if (snapshot.phase === 'submitting' || snapshot.phase === 'adjudicating') throw new Error('请等待当前消息处理完成。')
  const span = input.actions.captureInsertion()
  const inserted = input.actions.insertText(`${snapshot.draft ? '\n\n' : ''}${contextText}\n\n`, { ...span, start: span.end })
  if (!inserted) throw new Error('草稿已变化，请重新带入上下文。')
  return sessionId
}
