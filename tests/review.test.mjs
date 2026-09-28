import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_RULES, reviewContract } from '../src/review.js'

test('reports missing clause topics without inventing contract findings', () => {
  const text = '甲方：甲公司\n乙方：乙公司\n合同金额：人民币100元\n付款方式：验收后支付。'
  const issues = reviewContract(text)
  assert.ok(issues.some(issue => issue.id === 'missing:scope'))
  assert.ok(issues.some(issue => issue.id === 'missing:dispute'))
  assert.ok(!issues.some(issue => issue.id === 'missing:parties'))
  assert.ok(!issues.some(issue => issue.id === 'missing:price'))
  assert.ok(issues.every(issue => issue.status === 'open'))
})

test('finds placeholders with real line evidence', () => {
  const issues = reviewContract('甲方：【待填写】\n乙方：乙公司\n期限：____', [])
  assert.ok(issues.some(issue => issue.line === 1 && issue.excerpt.includes('甲方')))
  assert.ok(issues.some(issue => issue.line === 3 && issue.excerpt.includes('____')))
})

test('custom rules use any listed keyword and avoid false missing alerts', () => {
  const rule = { id: 'privacy', title: '保密义务', severity: 'medium', keywords: ['保密', '商业秘密'], guidance: '核对期限。' }
  assert.equal(reviewContract('双方应保守商业秘密。', [rule]).length, 0)
  assert.equal(reviewContract('双方遵守约定。', [rule])[0].id, 'missing:privacy')
  assert.equal(DEFAULT_RULES.length, 7)
})
