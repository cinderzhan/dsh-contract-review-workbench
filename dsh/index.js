import Schema from '@deepseek-ai/schemastery'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { ReviewError, readPayload, assertOwner, buildPrompt, normalizeOutput } from './ai.js'
import { modelCatalog, resolveRoute } from './models.js'
export const name = 'dsh-contract-review-workbench'
export const inject = ['connection', 'llm', 'agentDefaultModel', 'desktopWorkbenchOwnership']
export const Config = Schema.object({})
export function apply(ctx) {
  ctx.connection.fetch.register({ path: '/api/contract-review/ai', methods: ['GET', 'POST'], requestBody: 'buffered', async fetch(request) {
    if (request.method === 'GET') {
      try { return Response.json(await modelCatalog(ctx), { headers: { 'cache-control': 'no-store' } }) }
      catch { return Response.json({ error: '无法读取 DSH 模型列表，请稍后重试。' }, { status: 503 }) }
    }
    const controller = new AbortController()
    const abort = () => controller.abort(request.signal.reason)
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
    const timer = setTimeout(() => controller.abort(new Error('AI 审核超过 120 秒，请重试。')), 120000)
    try {
      const data = await readPayload(request)
      await assertOwner(ctx, data.sessionId)
      const route = await resolveRoute(ctx, data.modelSelection)
      const prompt = buildPrompt(data), assembler = new BlockAssembler(); let finished = false
      for await (const chunk of ctx.llm.stream({ ...route, sessionId: data.sessionId, purpose: 'contract-review', system: prompt.system, messages: [createUserMessage({ content: [{ type: 'text', text: prompt.text }], source: { kind: 'contract-review' } })], signal: controller.signal })) {
        if (controller.signal.aborted) throw controller.signal.reason
        if (finished) throw new ReviewError('AI 返回了无效的结束状态。', 502)
        assembler.push(chunk)
        if (chunk.type === 'finish') {
          finished = true
          const kind = chunk.reason?.kind
          if (kind === 'max-tokens') throw new ReviewError('模型达到输出长度上限，审核结果未完成。请减少本次规则或更换输出容量更大的模型后重试。', 502)
          if (kind === 'error') throw new ReviewError('模型服务返回错误，审核未完成。请检查 DSH 模型连接、权限或额度后重试。', 502)
          if (kind === 'aborted') throw new ReviewError('模型调用已中断，请重试。', 502)
          if (kind === 'tool-calls') throw new ReviewError('模型返回了工具调用，未返回审核结果。请更换模型后重试。', 502)
          if (kind !== 'stop') throw new ReviewError('模型返回未知结束状态，审核未完成。', 502)
        }
      }
      if (!finished || controller.signal.aborted) throw new ReviewError('AI 响应中断，请重试。', 502)
      const blocks = assembler.blocks()
      if (blocks.some(b => !['text', 'reasoning'].includes(b.type))) throw new ReviewError('AI 返回了不支持的内容。', 502)
      const result = normalizeOutput(blocks.filter(b => b.type === 'text').map(b => b.text).join(''), data)
      await assertOwner(ctx, data.sessionId)
      return Response.json({ ...result, model: route.model, provider: route.provider }, { headers: { 'cache-control': 'no-store' } })
    } catch (error) {
      const message = controller.signal.aborted ? (request.signal.aborted ? '操作已取消。' : 'AI 审核超过 120 秒，请重试。') : error instanceof ReviewError ? error.message : '模型请求失败，请检查 DSH 模型配置与连接后重试。'
      return Response.json({ error: message }, { status: controller.signal.aborted ? 408 : error instanceof ReviewError ? error.status : 502 })
    } finally { clearTimeout(timer); request.signal.removeEventListener('abort', abort) }
  } })
}
