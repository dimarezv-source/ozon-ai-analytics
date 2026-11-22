const test=require('node:test');
const assert=require('node:assert/strict');
const {buildProductRanking}=require('../dashboard/intelligence.js');
const {classificationKey}=require('../dashboard/accrual-classification.js');
const {calculateProfit}=require('../dashboard/profit-calculator.js');
const product={
 product_id:101,sku:9001,offer_id:'A-1',name:'Товар А',
 sales_percent_fbo:10,sales_percent_fbs:12,acquiring:1,
 delivery_to_customer:10,first_mile_min:2,first_mile_max:4,transit_min:4,transit_max:6,
 fbo_delivery_to_customer:8,fbo_transit_min:2,fbo_transit_max:4
};
const costs={'101':{cost:50,costConfigured:true,pack:2,ads:3,transit:0,other:0,tax:0}};
const sales={products:[
 {product_id:'101',sku:'9001',units:2,sales_gmv:200,fulfillment_type:'FBS'},
 {product_id:'101',sku:'9001',units:1,sales_gmv:100,fulfillment_type:'FBO'}
]};

test('ranks FBO and FBS separately and computes estimated profit from saved costs',()=>{
 const result=buildProductRanking(sales,[product],costs,{calculateProfit});
 assert.equal(result.items.length,2);
 assert.equal(result.items[0].fulfillmentType,'FBS');
 assert.equal(result.items[1].fulfillmentType,'FBO');
 assert.equal(result.totalUnits,3);
 assert.equal(result.includedUnits,3);
 assert.equal(result.coveragePercent,100);
 assert.equal(result.isActualProfit,false);
 assert.equal(result.source,'delivered_sales_user_costs_and_actual_commission_when_matched');
 assert.ok(Number.isFinite(result.estimatedProfit));
});

test('does not call missing unit cost zero profit; marks units excluded',()=>{
 const result=buildProductRanking(sales,[product],{}, {calculateProfit});
 assert.equal(result.items.length,0);
 assert.equal(result.excluded.missingCost,3);
 assert.equal(result.includedUnits,0);
});

test('tracks unmatched, unpriced and unknown fulfillment separately',()=>{
 const result=buildProductRanking({products:[
  {sku:'NOPE',units:2,sales_gmv:20,fulfillment_type:'FBS'},
  {sku:'9001',units:3,sales_gmv:0,fulfillment_type:'FBS'},
  {sku:'9001',units:4,sales_gmv:40,fulfillment_type:'FBY'}
 ]},[product],costs,{calculateProfit});
 assert.equal(result.excluded.unmatched,2);
 assert.equal(result.excluded.unpriced,3);
 assert.equal(result.excluded.unknownFulfillment,4);
});

test('flags loss-making products with a corrective recommendation',()=>{
 const highCost={'101':{cost:500}};
 const result=buildProductRanking({products:[{sku:'9001',units:1,sales_gmv:100,fulfillment_type:'FBS'}]},[product],highCost,{calculateProfit});
 assert.ok(result.items[0].profit<0);
 assert.match(result.items[0].recommendation,/Убыток/);
});

test('never labels estimated product profit as actual profit',()=>{
 const result=buildProductRanking(sales,[product],costs,{calculateProfit});
 assert.equal(result.isActualProfit,false);
 assert.equal(result.items.every(item=>item.dataStatus==='estimate'),true);
});

test('accepts an explicitly confirmed zero cost for free products',()=>{
 const freeCosts={'101':{cost:0,costConfigured:true}};
 const result=buildProductRanking(sales,[product],freeCosts,{calculateProfit});
 assert.equal(result.includedUnits,3);
 assert.equal(result.excluded.missingCost,0);
});
test('does not treat an unconfirmed default zero as known product cost',()=>{
 const defaultCosts={'101':{cost:0,costConfigured:false}};
 const result=buildProductRanking(sales,[product],defaultCosts,{calculateProfit});
 assert.equal(result.includedUnits,0);
 assert.equal(result.excluded.missingCost,3);
});

test('calculates a break-even price for a loss-making SKU and shows a same-volume scenario',()=>{
 const highCost={'101':{cost:500,costConfigured:true}};
 const result=buildProductRanking({products:[{sku:'9001',units:1,sales_gmv:100,fulfillment_type:'FBS'}]},[product],highCost,{calculateProfit});
 const item=result.items[0];
 assert.ok(item.profit<0);
 assert.ok(item.targetPrice>item.unitPrice);
 assert.equal(item.targetMarginPercent,0);
 assert.ok(Math.abs(item.scenarioProfit)<0.02);
 assert.ok(item.scenarioProfitLift>0);
 assert.match(item.recommendation,/безубыточная цена/);
 assert.equal(item.scenarioAssumption,'same_units_no_demand_response');
});

test('suggests a target price for 15 percent margin without promising demand will remain unchanged',()=>{
 const lowMargin={'101':{cost:60,costConfigured:true,pack:2,ads:3,transit:0,other:0,tax:0}};
 const result=buildProductRanking({products:[{sku:'9001',units:2,sales_gmv:200,fulfillment_type:'FBS'}]},[product],lowMargin,{calculateProfit});
 const item=result.items[0];
 assert.ok(item.marginPercent<15);
 assert.equal(item.targetMarginPercent,15);
 assert.ok(item.targetPrice>item.unitPrice);
 assert.ok(item.scenarioProfitLift>0);
 assert.match(item.recommendation,/Цена для маржи 15%/);
});


test('aggregates exact unit profit before rounding SKU totals',()=>{
 const fractionalProduct={...product,sales_percent_fbs:12.25,acquiring:1.25,delivery_to_customer:10.25,first_mile_min:2.25,first_mile_max:4.25,transit_min:4.25,transit_max:6.25};
 const fractionalSales={products:[{product_id:'101',sku:'9001',units:3,sales_gmv:300.99,fulfillment_type:'FBS'}]};
 const fractionalCosts={'101':{cost:50.25,costConfigured:true,pack:2.25,ads:3.25,transit:0,other:0,tax:0}};
 const result=buildProductRanking(fractionalSales,[fractionalProduct],fractionalCosts,{calculateProfit});
 const expected=calculateProfit({fulfillmentType:'FBS',unitPrice:300.99/3,product:fractionalProduct,expenses:{cost:50.25,pack:2.25,ads:3.25,transit:0,other:0,tax:0}});
 assert.equal(result.includedUnits,3);
 assert.equal(result.items[0].profit,Math.round(expected.profitExact*3*100)/100);
});


test('uses signed actual Ozon commission in intelligence ranking when periods and SKU match',()=>{
 const finance={period:{date_from:'2026-11-01',date_to:'2026-11-07'},product_commission_summary:[
  {sku:'9001',fulfillment_type:'FBS',currency:'RUB',sale_commission:'-30',records:2},
  {sku:'9001',fulfillment_type:'FBO',currency:'RUB',sale_commission:'-5',records:1}
 ]};
 const calculator={calculateProfit,calculateProfitWithActualCommission:require('../dashboard/profit-calculator.js').calculateProfitWithActualCommission};
 const result=buildProductRanking({...sales,period:finance.period},[product],costs,calculator,finance);
 assert.equal(result.actualCommissionUnits,3);
 assert.equal(result.tariffCommissionUnits,0);
 assert.equal(result.items.every(item=>item.dataStatus==='actual_commission_plus_estimated_costs'),true);
 const fbs=result.items.find(item=>item.fulfillmentType==='FBS');
 const baseline=calculateProfit({fulfillmentType:'FBS',unitPrice:100,product,expenses:{cost:50,pack:2,ads:3,transit:0,other:0,tax:0}});
 assert.equal(fbs.profit,Math.round((baseline.profitExact+12-15)*2*100)/100);
});

test('ignores actual commission from mismatched finance periods',()=>{
 const finance={period:{date_from:'2026-10-01',date_to:'2026-10-07'},product_commission_summary:[{sku:'9001',fulfillment_type:'FBS',currency:'RUB',sale_commission:'-30'}]};
 const calculator={calculateProfit,calculateProfitWithActualCommission:require('../dashboard/profit-calculator.js').calculateProfitWithActualCommission};
 const result=buildProductRanking({...sales,period:{date_from:'2026-11-01',date_to:'2026-11-07'}},[product],costs,calculator,finance);
 assert.equal(result.actualCommissionUnits,0);
 assert.equal(result.tariffCommissionUnits,3);
});

test('applies only manually confirmed non-commission signed accruals to product ranking',()=>{
 const period={date_from:'2026-11-01',date_to:'2026-11-07'};
 const finance={period,product_commission_summary:[{sku:'9001',fulfillment_type:'FBS',currency:'RUB',sale_commission:'-30',records:2}],posting_product_summary:[
  {sku:'9001',fulfillment_type:'FBS',currency:'RUB',type_id:'77',amount:'-20',records:2},
  {sku:'9001',fulfillment_type:'FBS',currency:'RUB',type_id:'78',amount:'5',records:1},
  {sku:'9001',fulfillment_type:'FBS',currency:'RUB',type_id:'79',amount:'-30',records:2}
 ]};
 const map={
  [classificationKey('77','RUB')]:{category:'expense',commission_confirmed_not_duplicate:true},
  [classificationKey('78','RUB')]:{category:'income',commission_confirmed_not_duplicate:true},
  [classificationKey('79','RUB')]:{category:'commission',commission_confirmed_not_duplicate:false}
 };
 const original=global.localStorage;
 global.localStorage={getItem:()=>JSON.stringify(map)};
 try{
  const calculator={calculateProfit,calculateProfitWithActualCommission:require('../dashboard/profit-calculator.js').calculateProfitWithActualCommission};
  const result=buildProductRanking({...sales,period},[product],costs,calculator,finance);
  const base=buildProductRanking({...sales,period},[product],costs,calculator,{...finance,posting_product_summary:[]});
  assert.equal(result.includedUnits,base.includedUnits);
  assert.equal(result.items.length,base.items.length);
  assert.ok(Math.abs((result.estimatedProfit-base.estimatedProfit)-(-15))<0.02);
  assert.equal(result.classifiedAccrualMetrics.included_records,3);
 }finally{global.localStorage=original;}
});
test('unconfirmed accrual classification never changes ranked profit',()=>{
 const period={date_from:'2026-11-01',date_to:'2026-11-07'};
 const finance={period,posting_product_summary:[{sku:'9001',fulfillment_type:'FBS',currency:'RUB',type_id:'88',amount:'-999',records:1}]};
 const original=global.localStorage;
 global.localStorage={getItem:()=>JSON.stringify({[classificationKey('88','RUB')]:{category:'expense',commission_confirmed_not_duplicate:false}})};
 try{
  const result=buildProductRanking({...sales,period},[product],costs,{calculateProfit},finance);
  const base=buildProductRanking({...sales,period},[product],costs,{calculateProfit},{...finance,posting_product_summary:[]});
  assert.equal(result.estimatedProfit,base.estimatedProfit);
 }finally{global.localStorage=original;}
});
