import test from 'node:test'
import assert from 'node:assert/strict'
import { selectionFromValue, valueFromSelection, selectedModelLabel } from '../src/models.js'
test('model choice round-trips provider and model and labels default', () => {
  const selected = { provider: 'provider', model: 'model-with/slash' }
  assert.deepEqual(selectionFromValue(valueFromSelection(selected)), selected)
  assert.equal(selectionFromValue(''), null)
  assert.equal(selectedModelLabel(null, { default: selected }), 'provider / model-with/slash')
  assert.equal(selectedModelLabel(selected, { groups: [{ id: 'provider', name: '服务商', models: [{ id: 'model-with/slash', name: '审核模型' }] }] }), '服务商 / 审核模型')
})
