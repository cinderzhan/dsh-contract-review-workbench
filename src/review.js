export const DEFAULT_RULES = [
  { id: 'parties', title: '合同主体', severity: 'high', keywords: ['甲方', '乙方', '委托方', '受托方', '买方', '卖方'], guidance: '核对双方完整名称、身份和签署权限。' },
  { id: 'scope', title: '标的或服务范围', severity: 'high', keywords: ['标的', '服务内容', '工作范围', '交付物', '产品名称'], guidance: '确认标的、范围和验收对象是否明确。' },
  { id: 'price', title: '价款或费用', severity: 'high', keywords: ['价款', '费用', '合同金额', '总金额', '人民币'], guidance: '核对金额、币种及计价口径。' },
  { id: 'payment', title: '付款安排', severity: 'medium', keywords: ['付款', '支付', '结算'], guidance: '核对支付节点、条件和账户信息。' },
  { id: 'term', title: '期限或生效', severity: 'medium', keywords: ['期限', '生效', '有效期', '履行期间'], guidance: '核对起止时间、生效条件及续期安排。' },
  { id: 'breach', title: '违约责任', severity: 'medium', keywords: ['违约', '赔偿', '损失承担'], guidance: '核对责任触发条件和救济方式。' },
  { id: 'dispute', title: '争议解决', severity: 'medium', keywords: ['争议解决', '仲裁', '管辖法院', '诉讼'], guidance: '核对机构、地点和适用条款。' }
]

export function reviewContract(text, rules = DEFAULT_RULES) {
  const content = String(text || '')
  const issues = []
  for (const rule of rules) {
    const keywords = Array.isArray(rule.keywords) ? rule.keywords.filter(Boolean) : []
    if (!keywords.length) continue
    if (!keywords.some(keyword => content.includes(keyword))) {
      issues.push({ id: `missing:${rule.id}`, ruleId: rule.id, title: `未检索到：${rule.title}`, severity: rule.severity, detail: `${rule.guidance || '请人工核对。'} 本项仅检查关键词是否出现，不能判断条款充分性。`, excerpt: '', line: null, status: 'open', note: '' })
    }
  }
  const lines = content.split(/\r?\n/)
  const placeholder = /\[[^\]\n]{1,60}\]|【[^】\n]{1,60}】|_{3,}|待填写|待补充|TBD/gi
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    for (const match of line.matchAll(placeholder)) {
      issues.push({ id: `placeholder:${index + 1}:${match.index}`, ruleId: 'placeholder', title: '发现待填写内容', severity: 'high', detail: '请确认该位置已填写准确内容。', excerpt: line.trim().slice(0, 180), line: index + 1, status: 'open', note: '' })
    }
  }
  return issues
}
