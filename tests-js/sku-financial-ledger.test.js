const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSkuFinancialLedger}=require('../dashboard/sku-financial-ledger.js');
const sales={period:{date_from:'2026-11-01',date_to:'2026-11-07'},products:[
 {sku:'1001',fulfillment_type:'FBS',units:3,sales_gmv:3000},
 {sku:'2002',fulfillment_type:'FBO',units:1,sales_gmv:800}
]};
test('joins actual commission, posting service accruals and returns by SKU and fulfillment',()=>{
 const finance={period:sales.period,
  product_commission_summary:[{sku:'1001',fulfillment_type:'FBS',currency:'RUB',sale_commission:'-450',records:3}],
  posting_product_summary:[{sku:'1001',fulfillment_type:'FBS',currency:'RUB',amount:'-90',records:2}],
  product_fee_summary:[{sku:'1001',fulfillment_type:'FBS',currency:'RUB',amount:'-90',components:2}],
  returns_attribution:{summary:[{sku:'1001',fulfillment_type:'FBS',currency:'RUB',quantity:1,priced_quantity:1,returned_value:'1000',return_records:1}]}
 };
 const result=buildSkuFinancialLedger(sales,finance);
 const row=result.rows.find(x=>x.sku==='1001');
 assert.equal(row.revenue,3000);
 assert.equal(row.commission_actual_rub,-450);
 assert.equal(row.service_fee_raw_rub,-90);
 assert.equal(row.return_quantity,1);
 assert.equal(row.return_value_rub,1000);
 assert.equal(result.metrics.commission_matched_skus,1);
 assert.equal(result.metrics.service_fee_skus,1);
});
test('does not turn absent source rows into zero expenses or commissions',()=>{
 const result=buildSkuFinancialLedger(sales,{period:sales.period});
 const row=result.rows.find(x=>x.sku==='2002');
 assert.equal(row.commission_actual_rub,null);
 assert.equal(row.service_fee_raw_rub,null);
 assert.equal(row.coverage.commission,'no_source_row');
 assert.equal(row.coverage.service_fees,'no_source_row');
});
test('keeps fulfillment types separate and excludes non-RUB source rows',()=>{
 const finance={period:sales.period,
  product_commission_summary:[
   {sku:'1001',fulfillment_type:'FBS',currency:'EUR',sale_commission:'-10',records:1},
   {sku:'1001',fulfillment_type:'FBO',currency:'RUB',sale_commission:'-20',records:1}
  ],
  posting_product_summary:[{sku:'1001',fulfillment_type:'FBS',currency:'KZT',amount:'-5',records:1}]
 };
 const result=buildSkuFinancialLedger(sales,finance);
 assert.equal(result.rows.find(x=>x.fulfillment_type==='FBS').commission_actual_rub,null);
 assert.equal(result.rows.find(x=>x.fulfillment_type==='FBO').commission_actual_rub,-20);
 assert.equal(result.metrics.non_rub_commission_records,1);
 assert.equal(result.metrics.non_rub_service_records,1);
});
test('refuses to join different date ranges',()=>{
 const result=buildSkuFinancialLedger(sales,{period:{date_from:'2026-11-02',date_to:'2026-11-07'}});
 assert.equal(result.ok,false);
 assert.equal(result.reason,'period_mismatch');
});
