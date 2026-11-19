const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
