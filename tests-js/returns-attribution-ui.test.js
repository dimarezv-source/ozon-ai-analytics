const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script = fs.readFileSync('dashboard/finance-reconciliation.js', 'utf8');
const page = fs.readFileSync('dashboard/index.html', 'utf8');

test('finance reconciliation renders exact return attribution and unmatched reasons', () => {
  assert.match(script, /returns_attribution/);
  assert.match(script, /reconAttributedReturnRows/);
  assert.match(script, /reconUnmatchedReturnRows/);
  assert.match(script, /missing_posting_number/);
  assert.match(script, /sku_not_in_posting/);
  assert.match(page, /Точное сопоставление возвратов с доставленными товарами/);
  assert.match(page, /Возвраты, требующие проверки/);
});

test('return attribution CSV exports matched and unmatched details', () => {
  assert.match(script, /Возвраты — точное сопоставление/);
  assert.match(script, /Возвраты — без сопоставления/);
});

test('finance reconciliation browser script has valid JavaScript syntax', () => {
  assert.doesNotThrow(() => new vm.Script(script));
});
