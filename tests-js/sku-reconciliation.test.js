const test=require('node:test');
const assert=require('node:assert/strict');
const {buildMatrix}=require('../dashboard/sku-reconciliation.js');

test('joins sales, returns and posting accruals by exact SKU and fulfillment scheme',()=>{
 const result=buildMatrix({products:[
  {sku:'100',fulfillment_type:'FBO',units:3,sales_gmv:300},
  {sku:'100',fulfillment_type:'FBS',units:2,sales_gmv:180}
 ]},{returns_summary:[
  {sku:'100',fulfillment_type:'FBO',quantity:1}
 ],product_fee_summary:[
  {sku:'100',fulfillment_type:'FBO',currency:'RUB',amount:'-20',components:2}
 ]});
 assert.equal(result.rows.length,2);
 const fbo=result.rows.find(row=>row.schema==='FBO');
 const fbs=result.rows.find(row=>row.schema==='FBS');
 assert.equal(fbo.units,3);assert.equal(fbo.gmv,300);assert.equal(fbo.returns,1);
 assert.equal(fbo.fees.get('RUB'),-20);assert.equal(fbo.feeRecords,2);
 assert.equal(fbs.units,2);assert.equal(fbs.returns,0);assert.equal(fbs.fees.size,0);
});

test('keeps financial currencies separate and does not allocate unmatched rows',()=>{
 const result=buildMatrix({products:[]},{posting_product_summary:[
  {sku:'55',fulfillment_type:'FBO',currency:'RUB',amount:'10',components:1},
  {sku:'55',fulfillment_type:'FBO',currency:'KZT',amount:'20',records:1},
  {sku:'55',fulfillment_type:'UNMATCHED',currency:'RUB',amount:'999',records:1}
 ]});
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].fees.get('RUB'),10);
 assert.equal(result.rows[0].fees.get('KZT'),20);
 assert.equal(result.unmatchedFinance,1);
});

test('does not guess SKU from product name or include rows without explicit SKU',()=>{
 const result=buildMatrix({products:[{name:'same name',units:5,sales_gmv:500,fulfillment_type:'FBO'}]},
  {returns_summary:[{name:'same name',quantity:2,fulfillment_type:'FBO'}]});
 assert.equal(result.rows.length,0);
});
