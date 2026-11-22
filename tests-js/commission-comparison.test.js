const test=require('node:test');
const assert=require('node:assert/strict');
const {compareProductCommissions}=require('../dashboard/commission-comparison.js');
const sales={period:{date_from:'2026-11-01',date_to:'2026-11-07'},products:[
 {sku:'1001',units:2,sales_gmv:2000,fulfillment_type:'FBS'},
 {sku:'2002',units:1,sales_gmv:1000,fulfillment_type:'FBO'}
]};
const catalog=[
 {sku:'1001',sales_percent_fbs:15,sales_percent_fbo:12},
 {sku:'2002',sales_percent_fbs:10,sales_percent_fbo:8}
];
test('compares actual and tariff commission only for same period, SKU, fulfillment and RUB',()=>{
 const finance={period:{date_from:'2026-11-01',date_to:'2026-11-07'},product_commission_summary:[
  {sku:'1001',fulfillment_type:'FBS',currency:'RUB',sale_commission:'290',records:2},
  {sku:'2002',fulfillment_type:'FBO',currency:'RUB',sale_commission:'75',records:1}
 ]};
 const result=compareProductCommissions(sales,finance,catalog);
 assert.equal(result.ok,true);
 assert.equal(result.matched,2);
 assert.equal(result.rows.find(x=>x.sku==='1001').estimated_commission,300);
 assert.equal(result.rows.find(x=>x.sku==='1001').difference,-10);
});
test('refuses to compare different date windows',()=>{
 const finance={period:{date_from:'2026-11-02',date_to:'2026-11-07'},product_commission_summary:[]};
 assert.equal(compareProductCommissions(sales,finance,catalog).reason,'period_mismatch');
});
test('keeps unknown currency and unmatched SKU outside comparable totals',()=>{
 const finance={period:sales.period,product_commission_summary:[
  {sku:'1001',fulfillment_type:'FBS',currency:'EUR',sale_commission:'20',records:1},
  {sku:null,fulfillment_type:null,currency:'RUB',sale_commission:'30',records:2}
 ]};
 const result=compareProductCommissions(sales,finance,catalog);
 assert.equal(result.ok,true);
 assert.equal(result.non_rub_records,1);
 assert.equal(result.actual_unmatched_records,2);
 assert.equal(result.rows.find(x=>x.sku==='1001').status,'estimate_missing');
});
test('keeps missing actual or estimated sides explicit',()=>{
 const finance={period:sales.period,product_commission_summary:[
  {sku:'9999',fulfillment_type:'FBS',currency:'RUB',sale_commission:'40',records:1}
 ]};
 const result=compareProductCommissions(sales,finance,catalog);
 assert.equal(result.rows.find(x=>x.sku==='1001').status,'actual_missing');
 assert.equal(result.rows.find(x=>x.sku==='9999').status,'estimate_missing');
});
