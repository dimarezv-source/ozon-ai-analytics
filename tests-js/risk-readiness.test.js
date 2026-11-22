const test=require('node:test');
const assert=require('node:assert/strict');
const {assessRisk}=require('../dashboard/risk-readiness.js');
test('does not report low risk when sales coverage is incomplete',()=>{
 const result=assessRisk({hasRanking:true,itemCount:3,coveragePercent:42.5,critical:0,warnings:0});
 assert.equal(result.level,'unknown');
 assert.equal(result.label,'Неполная оценка');
 assert.match(result.summary,/42,5%/);
});
test('keeps critical signals visible even with incomplete coverage',()=>{
 const result=assessRisk({hasRanking:true,itemCount:2,coveragePercent:30,critical:1,warnings:2});
 assert.equal(result.level,'high');
 assert.match(result.summary,/покрытие продаж: 30,0%/);
});
test('reports low risk only with complete sales coverage and no alerts',()=>{
 const result=assessRisk({hasRanking:true,itemCount:4,coveragePercent:100,critical:0,warnings:0});
 assert.equal(result.level,'low');
});
test('distinguishes missing data from insufficient cost coverage',()=>{
 assert.equal(assessRisk({hasRanking:false}).level,'unknown');
 assert.equal(assessRisk({hasRanking:true,itemCount:0,coveragePercent:0}).label,'Недостаточно данных');
});
