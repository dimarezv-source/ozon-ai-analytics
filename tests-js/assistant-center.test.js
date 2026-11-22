const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dashboard = fs.readFileSync(path.join(__dirname, '../dashboard/index.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '../dashboard/assistant-center.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../app/main.py'), 'utf8');

test('AI center has a central avatar, side panels and Russian text input', () => {
  assert.match(dashboard, /id="assistantCenter"/);
  assert.match(dashboard, /class="assistant-avatar"/);
  assert.match(dashboard, /id="assistantLeftContent"/);
  assert.match(dashboard, /id="assistantRightContent"/);
  assert.match(dashboard, /id="assistantInput"/);
  assert.match(dashboard, /id="assistantMic"/);
});

test('voice input is opt-in and has a text fallback', () => {
  assert.match(script, /recognition\.start\(\)/);
  assert.match(script, /webkitSpeechRecognition/);
  assert.match(script, /Голосовой ввод не поддерживается/);
  assert.match(script, /recognition\.lang = 'ru-RU'/);
  assert.match(script, /assistantStop/);
});

test('recognized requests can only navigate to an allow-listed existing dashboard section', () => {
  assert.match(script, /const destinations = \[/);
  assert.match(script, /findDestination/);
  assert.match(script, /querySelector\(item\.selector\)/);
  assert.doesNotMatch(script, /eval\s*\(/);
  assert.doesNotMatch(script, /new Function/);
});

test('assistant script is served behind dashboard authentication', () => {
  assert.match(app, /async def assistant_center_script\(_: None = Depends\(require_dashboard_auth\)\)/);
  assert.match(app, /ASSISTANT_CENTER_FILE/);
});

test('AI center renders live data from existing dashboard events', () => {
  assert.match(script, /ozon:sales-loaded/);
  assert.match(script, /ozon:ranking-updated/);
  assert.match(script, /ozon:inventory-updated/);
  assert.match(script, /renderLiveData/);
  assert.match(script, /Только товары с полными исходными данными/);
  assert.match(script, /не фактическая выплата Ozon/);
  assert.match(script, /fulfillment_summary/);
  assert.match(script, /Разбивка /);
  assert.match(script, /точно сопоставленным отправлениям/);
});


test('finance assistant answers commission questions by exact FBO/FBS and SKU attribution', () => {
  assert.match(script, /function answerFinanceQuestion\(query\)/);
  assert.match(script, /product_commission_summary/);
  assert.match(script, /row\.fulfillment_type === fulfillment/);
  assert.match(script, /String\(row\.sku\) === sku/);
  assert.match(script, /исходный знак Ozon/);
});

test('finance assistant includes only manually confirmed RUB SKU expenses', () => {
  assert.match(script, /OzonAccrualClassification/);
  assert.match(script, /commission_confirmed_not_duplicate === true/);
  assert.match(script, /String\(row\.currency \|\| ''\)\.toUpperCase\(\) === 'RUB'/);
  assert.match(script, /не буду автоматически называть расходами/);
});

test('finance assistant never labels preliminary product economics as actual net profit', () => {
  assert.match(script, /Предварительная расчётная прибыль/);
  assert.match(script, /не фактическая чистая прибыль/);
});


test('AI center script parses as valid JavaScript before deployment', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: 'assistant-center.js' }));
});
