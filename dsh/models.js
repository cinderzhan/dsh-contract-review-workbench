import { ReviewError } from './ai.js'

export async function modelCatalog(ctx) {
  const fallback = ctx.agentDefaultModel.currentSelection()
  const providers = ctx.llm.listProviders()
  const settled = await Promise.all(providers.map(async provider => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      return { id: provider.id, name: provider.name || provider.id, models: models.map(model => ({ id: model.id, name: model.name || model.id })) }
    } catch { return null }
  }))
  return { default: { provider: fallback.provider, model: fallback.model }, groups: settled.filter(group => group?.models.length) }
}

export async function resolveRoute(ctx, choice) {
  if (!choice) {
    const route = ctx.agentDefaultModel.currentSelection()
    if (!route?.provider || !route?.model) throw new ReviewError('请先在 DSH 中配置可用模型。', 409)
    return route
  }
  const provider = ctx.llm.listProviders().find(item => item.id === choice.provider)
  if (!provider) throw new ReviewError('所选模型服务已不可用，请重新选择审核模型。', 409)
  let models
  try { models = await ctx.llm.listModels(provider.id) }
  catch { throw new ReviewError('无法读取所选模型，请检查 DSH 模型连接。', 409) }
  if (!models.some(item => item.id === choice.model)) throw new ReviewError('所选模型已不可用，请重新选择审核模型。', 409)
  return { provider: choice.provider, model: choice.model }
}
