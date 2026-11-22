const test=require('node:test');
const assert=require('node:assert/strict');
const {buildClassifiedAccruals,classificationKey}=require('../dashboard/accrual-classification.js');
const finance={posting_product_summary:[
 {sku:'1001',fulfillment_type:'FBS',currency:'RUB',type_id:'11',amount:'-60',records:2},
 {sku:'1001',fulfillment_type:'FBS',currency:'RUB',type_id:'12',amount:'25',records:1},
 {sku:'1001',fulfillment_type:'FBS',currency:'RUB',type_id:'13',amount:'-450',records:3},
 {sku:'1001',fulfillment_type:'FBS',currency:'RUB',type_id:'14',amount:'-10',records:1},
 {sku:'1001',fulfillment_type:'FBS',currency:'KZT',type_id:'11',amount:'-5',records:1},
 {sku:'1001',fulfillment_type:'UNMATCHED',currency:'RUB',type_id:'11',amount:'-8',records:1}
],product_fee_summary:[{sku:'1001',fulfillment_type:'FBS',currency:'RUB',type_id:'11',amount:'-60',records:2}]};
test('includes only explicitly confirmed non-commission RUB accruals and preserves signed amounts',()=>{
 const map={
  [classificationKey('11','RUB')]:{category:'expense',commission_confirmed_not_duplicate:true},
  [classificationKey('12','RUB')]:{category:'income',commission_confirmed_not_duplicate:true},
  [classificationKey('13','RUB')]:{category:'commission',commission_confirmed_not_duplicate:false},
  [classificationKey('14','RUB')]:{category:'adjustment',commission_confirmed_not_duplicate:false}
 };
 const result=buildClassifiedAccruals(finance,map);
 assert.equal(result.totals.get('FBS|1001'),-35);
 assert.equal(result.metrics.included_records,3);
 assert.equal(result.metrics.commission_records,3);
 assert.equal(result.metrics.unclassified_records,1);
 assert.equal(result.metrics.non_rub_records,1);
 assert.equal(result.metrics.unmatched_records,1);
 assert.equal(result.metrics.included_type_count,2);
});
test('unclassified, unconfirmed, neutral and already-counted commission rows do not affect profit',()=>{
 const result=buildClassifiedAccruals(finance,{
  [classificationKey('11','RUB')]:{category:'expense',commission_confirmed_not_duplicate:false},
  [classificationKey('12','RUB')]:{category:'neutral',commission_confirmed_not_duplicate:true},
  [classificationKey('13','RUB')]:{category:'commission',commission_confirmed_not_duplicate:true}
 });
 assert.equal(result.totals.size,0);
});
test('uses only posting product summary, never parallel product fee summary',()=>{
 const result=buildClassifiedAccruals(finance,{[classificationKey('11','RUB')]:{category:'expense',commission_confirmed_not_duplicate:true}});
 assert.equal(result.totals.get('FBS|1001'),-60);
});
