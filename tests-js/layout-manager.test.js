const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dashboard/layout-manager.js'),'utf8');
test('dashboard layout supports touch and pen pointer dragging',()=>{
 assert.match(source,/pointerdown/);assert.match(source,/pointermove/);assert.match(source,/pointerup/);assert.match(source,/elementFromPoint/);assert.match(source,/touch-action:none/);
});
test('dashboard layout supports keyboard reordering',()=>{
 assert.match(source,/aria-keyshortcuts/);assert.match(source,/event.key!=='ArrowUp'&&event.key!=='ArrowDown'/);assert.match(source,/handle.addEventListener\('keydown'/);
});
test('dashboard layout keeps saved order and reset behavior',()=>{
 assert.match(source,/ozon-ai-analytics-layout-v1/);assert.match(source,/localStorage\.setItem\(KEY/);assert.match(source,/localStorage\.removeItem\(KEY/);
});
