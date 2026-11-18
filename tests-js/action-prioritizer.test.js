const test=require('node:test');
const assert=require('node:assert/strict');
const {prioritizeActions}=require('../dashboard/action-prioritizer.js');

test('prioritizes critical actions before warnings and sorts by financial impact within each level',()=>{
 const result=prioritizeActions([
  {level:'warning',title:'warning high',impact:900},
  {level:'critical',title:'critical low',impact:100},
  {level:'critical',title:'critical high',impact:500},
  {level:'warning',title:'warning low',impact:20}
 ]);
 assert.deepEqual(result.map(x=>x.title),['critical high','critical low','warning high','warning low']);
});

test('keeps stable order for equal impacts and treats invalid impacts as zero',()=>{
 const result=prioritizeActions([
  {level:'warning',title:'first',impact:NaN},
  {level:'warning',title:'second',impact:null},
  {level:'warning',title:'third',impact:-5}
 ]);
 assert.deepEqual(result.map(x=>x.title),['first','second','third']);
});
