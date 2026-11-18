const test=require('node:test');
const assert=require('node:assert/strict');
const {buildProductRanking}=require('../dashboard/intelligence.js');
const {calculateProfit}=require('../dashboard/profit-calculator.js');
const product={
 product_id:101,sku:9001,offer_id:'A-1',name:'Товар А',
 sales_percent_fbo:10,sales_percent_fbs:12,acquiring:1,
 delivery_to_customer:10,first_mile_min:2,first_mile_max:4,transit_min:4,transit_max:6,
 fbo_delivery_to_customer:8,fbo_transit_min:2,fbo_transit_max:4
};
const costs={'101':{cost:50,pack:2,ads:3,transit:0,other:0,tax:0}};
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
 assert.equal(result.source,'delivered_sales_and_user_costs');
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
