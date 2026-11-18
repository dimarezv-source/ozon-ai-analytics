'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dashboard/inventory.js'),'utf8');
const window={addEventListener:()=>{},dispatchEvent:()=>{}};
vm.runInNewContext(source,{window,document:{getElementById:()=>null},localStorage:{getItem:()=>null},Intl,Number,Date,Math,JSON,CustomEvent:function(){},fetch:()=>{},console});
const calculate=window.OzonInventoryPlanner.calculateReplenishment;
test('calculates reorder quantity from daily sales, lead time and safety stock',()=>{
 const result=calculate({available:10,dailySales:3,leadDays:5,safetyDays:2});
 assert.equal(result.ok,true);assert.equal(result.targetDays,7);assert.equal(result.recommended,11);
});
test('does not recommend replenishment when stock covers target period',()=>{
 const result=calculate({available:30,dailySales:2,leadDays:5,safetyDays:2});
 assert.equal(result.recommended,0);assert.equal(result.priority,'normal');
});
test('keeps FBO/FBS calculations independent at caller level and rounds units upward',()=>{
 const result=calculate({available:0,dailySales:1.2,leadDays:3,safetyDays:1});
 assert.equal(result.recommended,5);assert.equal(result.priority,'critical');
});
test('does not guess quantity when there are no sales',()=>{
 const result=calculate({available:8,dailySales:0,leadDays:5,safetyDays:7});
 assert.equal(result.ok,false);assert.equal(result.reason,'no_sales');assert.equal(result.recommended,null);
});
test('zero lead and safety days do not create an artificial order',()=>{
 const result=calculate({available:0,dailySales:4,leadDays:0,safetyDays:0});
 assert.equal(result.recommended,0);
});

test('calculates procurement budget only from configured unit costs',()=>{
 const result=window.OzonInventoryPlanner.calculateProcurementBudget([
  {type:'FBO',costKey:'a',result:{recommended:4}},
  {type:'FBS',costKey:'b',result:{recommended:3}},
  {type:'FBO',costKey:'c',result:{recommended:2}}
 ],{
  a:{cost:125},b:{cost:80,costConfigured:true},c:{}
 });
 assert.equal(result.knownBudget,740);
 assert.equal(result.FBO,500);
 assert.equal(result.FBS,240);
 assert.equal(result.missingCostItems,1);
 assert.equal(result.unknownUnits,2);
});
test('accepts explicitly configured zero cost without inventing a purchase budget',()=>{
 const result=window.OzonInventoryPlanner.calculateProcurementBudget([
  {type:'FBO',costKey:'free',result:{recommended:5}}
 ],{free:{cost:0,costConfigured:true}});
 assert.equal(result.knownBudget,0);
 assert.equal(result.missingCostItems,0);
 assert.equal(result.knownUnits,5);
});

test('flags stock with no sales in the selected period without inventing days since last sale',()=>{
 const result=window.OzonInventoryPlanner.calculateFrozenStock([
  {name:'No sales',type:'FBO',available:8,sold:0,periodDays:30,costKey:'a'},
  {name:'Moving',type:'FBS',available:5,sold:30,periodDays:30,costKey:'b'}
 ],{a:{cost:100},b:{cost:50}},60);
 assert.equal(result.items.length,1);assert.equal(result.items[0].reason,'Нет продаж за выбранный период');
 assert.equal(result.items[0].coverage,null);assert.equal(result.frozenUnits,8);assert.equal(result.frozenValue,800);assert.equal(result.FBO,800);
});
test('flags excessive stock coverage and excludes unknown costs from money total',()=>{
 const result=window.OzonInventoryPlanner.calculateFrozenStock([
  {name:'Slow seller',type:'FBS',available:40,sold:10,periodDays:30,costKey:'a'},
  {name:'Unknown cost',type:'FBO',available:12,sold:0,periodDays:30,costKey:'b'}
 ],{a:{cost:75}},60);
 assert.equal(result.items.length,2);assert.equal(result.items[0].coverage,120);assert.equal(result.frozenValue,3000);
 assert.equal(result.missingCostItems,1);assert.equal(result.frozenUnits,52);
});
test('does not classify stock as frozen when coverage is at or below threshold',()=>{
 const result=window.OzonInventoryPlanner.calculateFrozenStock([
  {name:'Healthy',type:'FBO',available:20,sold:20,periodDays:30,costKey:'a'}
 ],{a:{cost:10}},60);
 assert.equal(result.items.length,0);assert.equal(result.frozenValue,0);
});
