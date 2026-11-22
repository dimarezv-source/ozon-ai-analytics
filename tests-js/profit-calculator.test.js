const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateProfit, simulatePrice } = require('../dashboard/profit-calculator.js');
const product={
 sales_percent_fbo:12,sales_percent_fbs:15,acquiring:2,
 delivery_to_customer:30,first_mile_min:10,first_mile_max:20,
 transit_min:10,transit_max:20,return_flow:40,
 fbo_delivery_to_customer:15,fbo_transit_min:5,fbo_transit_max:15,fbo_return_flow:50
};

test('FBO includes FBO delivery and transit, excludes FBS-only logistics',()=>{
 const r=calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product,expenses:{cost:500,pack:10,ads:20,transit:0,other:5,tax:6}});
 assert.equal(r.ok,true);assert.equal(r.deductions.commission,120);
 assert.equal(r.deductions.firstMile,0);assert.equal(r.deductions.delivery,15);
 assert.equal(r.deductions.marketplaceTransit,10);assert.equal(r.deductions.additionalTransit,0);
 assert.equal(r.deductions.tax,60);assert.equal(r.profit,258);
 assert.equal(r.returnFlowTariff,50);assert.equal(r.returnFlowIncluded,false);
});
test('FBS includes first mile, delivery and average transit once',()=>{
 const r=calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product,expenses:{cost:500,pack:10,ads:20,transit:7,other:5,tax:6}});
 assert.equal(r.ok,true);assert.equal(r.deductions.commission,150);
 assert.equal(r.deductions.firstMile,15);assert.equal(r.deductions.delivery,30);
 assert.equal(r.deductions.marketplaceTransit,15);assert.equal(r.deductions.additionalTransit,7);
 assert.equal(r.deductions.tax,60);assert.equal(r.profit,186);
});
test('negative profit remains negative',()=>{
 const r=calculateProfit({fulfillmentType:'FBS',unitPrice:100,product,expenses:{cost:500}});
 assert.equal(r.ok,true);assert.equal(r.profit,-477);assert.equal(r.marginPercent,-477);
});
test('zero and invalid prices are rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:0,product}).reason,'invalid_price');
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:NaN,product}).reason,'invalid_price');
});
test('missing FBS tariffs are rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product:{...product,first_mile_max:null}}).reason,'missing_tariff');
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product:{...product,transit_min:null}}).reason,'missing_tariff');
});
test('missing FBO tariff is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product:{...product,fbo_delivery_to_customer:null}}).reason,'missing_tariff');
});
test('missing commission is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product:{...product,sales_percent_fbo:null}}).reason,'missing_tariff');
});
test('negative or nonnumeric expenses are rejected instead of silently clamped',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product,expenses:{cost:-10}}).reason,'invalid_expense');
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product,expenses:{ads:'oops'}}).reason,'invalid_expense');
 assert.equal(calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product,expenses:{tax:101}}).reason,'invalid_expense');
});
test('missing return tariff stays unknown and is never charged as zero',()=>{
 const r=calculateProfit({fulfillmentType:'FBS',unitPrice:1000,product:{...product,return_flow:null}});
 assert.equal(r.ok,true);assert.equal(r.returnFlowTariff,null);assert.equal(r.returnFlowIncluded,false);
});
test('unknown fulfillment is rejected',()=>{
 assert.equal(calculateProfit({fulfillmentType:'FBY',unitPrice:1000,product}).reason,'unknown_fulfillment');
});

test('price simulator compares current and scenario price with unchanged costs and tariffs',()=>{
 const r=simulatePrice({fulfillmentType:'FBS',currentPrice:1000,scenarioPrice:1200,product,expenses:{cost:500,pack:10,ads:20,transit:7,other:5,tax:6}});
 assert.equal(r.ok,true);
 assert.equal(r.current.profit,186);
 assert.equal(r.scenario.profit,344);
 assert.equal(r.deltaProfitPerUnit,158);
 assert.equal(r.deltaMarginPoints,10.07);
 assert.equal(r.scenarioAssumption,'same_costs_and_tariffs_no_demand_response');
});
test('price simulator rejects an invalid scenario price without changing the baseline',()=>{
 const r=simulatePrice({fulfillmentType:'FBO',currentPrice:1000,scenarioPrice:0,product,expenses:{cost:500}});
 assert.equal(r.ok,false);
 assert.equal(r.reason,'invalid_scenario_price');
 assert.equal(r.current.ok,true);
});

test('keeps exact per-unit profit while preserving whole-ruble display compatibility',()=>{
 const r=calculateProfit({fulfillmentType:'FBO',unitPrice:1000.49,product:{...product,sales_percent_fbo:12.25,acquiring:2.25,fbo_delivery_to_customer:15.25,fbo_transit_min:5.25,fbo_transit_max:15.25},expenses:{cost:500.25,pack:10.25,ads:20.25,other:5.25,tax:6.25}});
 assert.equal(r.ok,true);assert.equal(Number.isInteger(r.profit),true);assert.ok(Number.isFinite(r.profitExact));assert.notEqual(r.profitExact,r.profit);assert.equal(r.marginPercent,Math.round(r.profitExact/1000.49*10000)/100);
 const sim=simulatePrice({fulfillmentType:'FBO',currentPrice:1000.49,scenarioPrice:1100.49,product,expenses:{cost:500.25}});
 assert.equal(sim.ok,true);assert.equal(Number.isInteger(sim.deltaProfitPerUnit),true);
});


test('legacy tax percentage is explicitly identified as a manual expense, not statutory tax',()=>{
 const r=calculateProfit({fulfillmentType:'FBO',unitPrice:1000,product,expenses:{cost:500,tax:6}});
 assert.equal(r.ok,true);
 assert.equal(r.deductions.tax,60);
 assert.equal(r.manualTaxAdjustment,60);
 assert.equal(r.statutoryTax,null);
 assert.equal(r.statutoryTaxCalculated,false);
 assert.equal(r.taxTreatment,'manual_legacy_expense');
});
