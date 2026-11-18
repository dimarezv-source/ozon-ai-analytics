const test=require('node:test');
const assert=require('node:assert/strict');
const {MODULES,defaults,normalizeSettings,setEnabled,countEnabled}=require('../dashboard/module-manager.js');

test('registers unique modules with selectors',()=>{
 const ids=MODULES.map(module=>module.id);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(MODULES.length>=8);
 for(const module of MODULES){assert.ok(module.title);assert.ok(module.selectors.length)}
});

test('all modules are enabled by default and settings are normalized',()=>{
 const settings=defaults();
 assert.equal(countEnabled(settings),MODULES.length);
 const normalized=normalizeSettings({version:1,enabled:{inventory:false,unknown:false}});
 assert.equal(normalized.enabled.inventory,false);
 assert.equal(normalized.enabled.sales,true);
 assert.equal('unknown' in normalized.enabled,false);
});

test('module toggle changes only the selected module and ignores unknown ids',()=>{
 const initial=defaults();
 const changed=setEnabled(initial,'inventory',false);
 assert.equal(changed.enabled.inventory,false);
 assert.equal(changed.enabled.sales,true);
 assert.equal(initial.enabled.inventory,true);
 assert.deepEqual(setEnabled(changed,'not-a-module',true),changed);
});

test('invalid or old settings fall back to safe defaults',()=>{
 assert.equal(countEnabled(normalizeSettings({version:99,enabled:{}})),MODULES.length);
 assert.equal(countEnabled(normalizeSettings(null)),MODULES.length);
});
