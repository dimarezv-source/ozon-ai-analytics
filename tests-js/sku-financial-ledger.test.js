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
 const splitSales={...sales,products:[...sales.products,{sku:'1001',fulfillment_type:'FBO',units:1,sales_gmv:500}]};
 const result=buildSkuFinancialLedger(splitSales,finance);
 assert.equal(result.rows.find(x=>x.sku==='1001'&&x.fulfillment_type==='FBS').commission_actual_rub,null);
 assert.equal(result.rows.find(x=>x.sku==='1001'&&x.fulfillment_type==='FBO').commission_actual_rub,-20);
 assert.equal(result.metrics.non_rub_commission_records,1);
 assert.equal(result.metrics.non_rub_service_records,1);
});
test('refuses to join different date ranges',()=>{
 const result=buildSkuFinancialLedger(sales,{period:{date_from:'2026-11-02',date_to:'2026-11-07'}});
 assert.equal(result.ok,false);
 assert.equal(result.reason,'period_mismatch');
});

test('keeps missing sales prices out of zero-valued GMV and exposes partial coverage',()=>{
 const partialSales={...sales,products:[
  {sku:'3003',fulfillment_type:'FBS',units:3,sales_gmv:100,unpriced_units:2}
 ]};
 const result=buildSkuFinancialLedger(partialSales,{period:sales.period});
 const row=result.rows[0];
 assert.equal(row.revenue,100);
 assert.equal(row.known_price_units,1);
 assert.equal(row.unpriced_units,2);
 assert.equal(row.coverage.sales,'partial_price_coverage');
 const unknownSales={...sales,products:[
  {sku:'4004',fulfillment_type:'FBO',units:2,sales_gmv:0,unpriced_units:2}
 ]};
 const unknown=buildSkuFinancialLedger(unknownSales,{period:sales.period}).rows[0];
 assert.equal(unknown.revenue,null);
 assert.equal(unknown.coverage.sales,'no_usable_price');
});

test('exposes profit readiness without presenting incomplete inputs as profit',()=>{
 const completeSales={...sales,products:[{sku:'5005',fulfillment_type:'FBS',units:2,sales_gmv:2000}]};
 const finance={period:sales.period,
  product_commission_summary:[{sku:'5005',fulfillment_type:'FBS',currency:'RUB',sale_commission:'-200',records:2}],
  posting_product_summary:[{sku:'5005',fulfillment_type:'FBS',currency:'RUB',amount:'-40',records:1}],
  returns_attribution:{summary:[{sku:'5005',fulfillment_type:'FBS',currency:'RUB',quantity:1,priced_quantity:1,returned_value:'1000',return_records:1}]}
 };
 const row=buildSkuFinancialLedger(completeSales,finance).rows[0];
 assert.equal(row.profit_readiness.status,'insufficient_data');
 assert.equal(row.profit_readiness.can_calculate_profit,false);
 assert.deepEqual(row.profit_readiness.verified_components,['sales_revenue','actual_sale_commission']);
 assert.deepEqual(row.profit_readiness.missing_components,['cost_of_goods']);
 assert.deepEqual(row.profit_readiness.review_components,['unclassified_service_accruals','return_value_is_not_a_confirmed_refund']);
});

test('marks missing sales price and commission as unresolved profit inputs',()=>{
 const row=buildSkuFinancialLedger({period:sales.period,products:[{sku:'6006',fulfillment_type:'FBO',units:1,sales_gmv:0,unpriced_units:1}]},{period:sales.period}).rows[0];
 assert.equal(row.profit_readiness.can_calculate_profit,false);
 assert.deepEqual(row.profit_readiness.verified_components,[]);
 assert.ok(row.profit_readiness.review_components.includes('service_accrual_source_missing'));
});
