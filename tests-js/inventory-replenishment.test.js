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
