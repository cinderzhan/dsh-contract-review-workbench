import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPatches, validatePatches, normalizeRecord, makeRecord, TEMPLATES } from '../src/workflow.js'

test('only accepted revisions enter export; preview includes pending and preserves original', () => {
  const original = '甲方付款。乙方交付。'
  const patches = validatePatches(original, [
    { id:'1', original:'甲方付款。', replacement:'甲方验收后付款。', status:'accepted' },
    { id:'2', original:'乙方交付。', replacement:'乙方按期交付。', status:'pending' },
    { id:'3', original:'', replacement:'双方协商争议。', status:'rejected' },
  ])
  assert.equal(applyPatches(original, patches), '甲方验收后付款。乙方交付。')
  assert.equal(applyPatches(original, patches, {preview:true}), '甲方验收后付款。乙方按期交付。')
  assert.equal(original, '甲方付款。乙方交付。')
})
test('ambiguous, missing, overlapping and duplicate insertion patches fail atomically', () => {
  assert.throws(() => validatePatches('甲方甲方', [{original:'甲方',replacement:'乙方'}]), /重复/)
  assert.throws(() => validatePatches('甲方', [{original:'丙方',replacement:'乙方'}]), /未匹配/)
  assert.throws(() => validatePatches('abcdef', [{original:'abc',replacement:'A'}, {original:'bcde',replacement:'B'}]), /重叠/)
  assert.throws(() => validatePatches('abc', [{original:'',replacement:'A'}, {original:'',replacement:'B'}]), /重叠/)
})
test('deletion and new missing clause insertion work', () => {
  assert.equal(applyPatches('abc', [{original:'b',replacement:'',status:'accepted'}]), 'ac')
  assert.equal(applyPatches('abc', [{original:'',replacement:'新增条款',status:'accepted'}]), 'abc\n\n新增条款')
})
test('legacy contracts, findings and notes survive migration', () => {
  const old = {id:'old',name:'采购',text:'正文',memo:'保留备注',reviewedAt:'昨天',sessionIds:['harness-session'],issues:[{id:'x',excerpt:'原文',status:'confirmed',note:'人工判断'}]}
  const migrated = normalizeRecord(old)
  assert.equal(migrated.id, 'old'); assert.equal(migrated.memo, '保留备注')
  assert.equal(migrated.issues[0].note, '人工判断'); assert.equal(migrated.issues[0].quote, '原文')
  assert.equal(migrated.reviewKind, 'basic'); assert.equal(migrated.stage, 3)
  assert.deepEqual(migrated.sessionIds, ['harness-session'])
  assert.equal(migrated.workspaceSessionId, '')
})
test('rule edits do not mutate built-in templates or another document', () => {
  const first = makeRecord('A', 'A.txt'), second = makeRecord('B', 'B.txt')
  first.rules[0].enabled = false; first.rules[0].title = '我的规则'
  assert.equal(second.rules[0].enabled, true)
  assert.equal(TEMPLATES[0].rules[0].title, '主体与签署')
})
