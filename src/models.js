export function selectionFromValue(value) {
  if (!value) return null
  const index = value.indexOf('\u0000')
  if (index < 1 || index === value.length - 1) return null
  return { provider: value.slice(0, index), model: value.slice(index + 1) }
}
export function valueFromSelection(selection) {
  return selection?.provider && selection?.model ? `${selection.provider}\u0000${selection.model}` : ''
}
export function selectedModelLabel(selection, catalog) {
  if (!selection) return catalog?.default ? `${catalog.default.provider} / ${catalog.default.model}` : '尚未读取到 DSH 默认模型'
  const group = catalog?.groups?.find(group => group.id === selection.provider)
  const model = group?.models?.find(model => model.id === selection.model)
  return model ? `${group.name} / ${model.name}` : `${selection.provider} / ${selection.model}`
}
