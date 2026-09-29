import test from 'node:test'
import assert from 'node:assert/strict'
import { highlightSegments } from '../src/highlights.js'

test('all quoted findings highlight without changing contract text', () => {
  const text = '甲方付款，乙方交付，双方验收。'
  const segments = highlightSegments(text, [
    { id: 'payment', quote: '甲方付款' },
    { id: 'delivery', quote: '乙方交付' },
    { id: 'missing', quote: '' },
  ])
  assert.equal(segments.map(segment => segment.text).join(''), text)
  assert.deepEqual(segments.filter(segment => segment.issueIds.length).map(segment => segment.issueIds), [['payment'], ['delivery']])
})

test('overlapping quotes share a marked span and absent quotes remain unmarked', () => {
  const segments = highlightSegments('甲方付款期限', [
    { id: 'first', quote: '甲方付款' },
    { id: 'second', quote: '付款期限' },
    { id: 'absent', quote: '不存在的条款' },
  ])
  assert.deepEqual(segments, [
    { text: '甲方', issueIds: ['first'] },
    { text: '付款', issueIds: ['first', 'second'] },
    { text: '期限', issueIds: ['second'] },
  ])
})

test('two findings citing the same sentence both remain linked to the highlight', () => {
  const segments = highlightSegments('乙方延迟交付。', [
    { id: 'delay', quote: '乙方延迟交付' },
    { id: 'notice', quote: '乙方延迟交付' },
  ])
  assert.deepEqual(segments[0].issueIds, ['delay', 'notice'])
})
