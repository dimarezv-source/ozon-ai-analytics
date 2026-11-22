const test=require('node:test');
const assert=require('node:assert/strict');
const {collectSettings,validateBackup,restoreSettings,PREFIX}=require('../dashboard/settings-backup.js');
function memoryStorage(seed={}){
 const data=new Map(Object.entries(seed));
 return {get length(){return data.size;},key(i){return [...data.keys()][i]??null;},getItem(k){return data.has(k)?data.get(k):null;},setItem(k,v){data.set(k,String(v));},removeItem(k){data.delete(k);},dump(){return Object.fromEntries(data);}};
}
test('exports only app-owned settings and leaves unrelated browser data out',()=>{
 const storage=memoryStorage({[PREFIX+'costs-v1']:'{"sku":{"cost":12}}',[PREFIX+'accrual-classifications-v1']:'{}','other-app-secret':'do-not-export'});
 const backup=collectSettings(storage);
 assert.equal(Object.keys(backup.entries).length,2);
 assert.equal(backup.entries[PREFIX+'costs-v1'],'{"sku":{"cost":12}}');
 assert.equal(validateBackup(backup).ok,true);
});
test('restores app settings without deleting unrelated keys',()=>{
 const storage=memoryStorage({[PREFIX+'costs-v1']:'{"old":true}','unrelated':'keep'});
 const payload={format:'ozon-ai-analytics-settings',version:1,entries:{[PREFIX+'costs-v1']:'{"new":true}',[PREFIX+'accrual-classifications-v1']:'{}'}};
 assert.deepEqual(restoreSettings(payload,storage),{ok:true,count:2});
 assert.equal(storage.getItem(PREFIX+'costs-v1'),'{"new":true}');
 assert.equal(storage.getItem('unrelated'),'keep');
});
test('rejects foreign keys and malformed setting JSON before changing storage',()=>{
 const storage=memoryStorage({[PREFIX+'costs-v1']:'{"safe":true}'});
 const payload={format:'ozon-ai-analytics-settings',version:1,entries:{'other-app-key':'{}'}};
 assert.equal(validateBackup(payload).ok,false);
 assert.equal(storage.getItem(PREFIX+'costs-v1'),'{"safe":true}');
});
test('rejects unknown backup versions and oversized payloads',()=>{
 assert.equal(validateBackup({format:'ozon-ai-analytics-settings',version:99,entries:{}}).reason,'unsupported_version');
 assert.equal(validateBackup({format:'ozon-ai-analytics-settings',version:1,entries:{[PREFIX+'x']:'"'+('x'.repeat(2*1024*1024))+'"'}}).reason,'backup_too_large');
});
