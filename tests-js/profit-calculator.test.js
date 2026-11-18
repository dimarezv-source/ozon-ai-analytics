const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfit } = require('./profit-calculator.js');
const product={sales_percent_fbo:12,sales_percent_fbs:15,acquiring:2,delivery_to_customer:30,first_mile_min:10,first_mile_max:20};

test('FBO excludes FBS logistics and transit',()=>{
 const r=calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product,expenses:{cost:500,pack:10,ads:20,transit:99,other:5,tax:6}});
 assert.equal(r.ok,true);assert.equal(r.deductions.commission,120);assert.equal(r.deductions.firstMile,0);assert.equal(r.deductions.delivery,0);assert.equal(r.deductions.transit,0);assert.equal(r.profit,283);
});
test('FBS includes average first mile, delivery and transit once',()=>{
 const r=calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product,expenses:{cost:500,pack:10,ads:20,transit:15,other:5,tax:6}});
 assert.equal(r.ok,true);assert.equal(r.deductions.commission,150);assert.equal(r.deductions.firstMile,15);assert.equal(r.deductions.delivery,30);assert.equal(r.deductions.transit,15);assert.equal(r.profit,193);
});
test('negative profit remains negative',()=>{
 const r=calculateProfit({fulfillmentType:'FBS',unitPrice:100,product,expenses:{cost:500}});
 assert.equal(r.ok,true);assert.equal(r.profit,-462);assert.equal(r.marginPercent,-462);
});
test('zero and invalid prices are rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:0,product}).reason,'invalid_price');
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:NaN,product}).reason,'invalid_price');
});
test('missing FBS tariff is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product:{...product,first_mile_max:null}}).reason,'missing_tariff');
});
test('missing FBO commission is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product:{...product,sales_percent_fbo:null}}).reason,'missing_tariff');
});
test('unknown fulfillment is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBY',unitPrice:1000,product}).reason,'unknown_fulfillment');
});
