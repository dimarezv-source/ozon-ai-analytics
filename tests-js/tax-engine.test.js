const test=require('node:test');
const assert=require('node:assert/strict');
const tax=require('../dashboard/tax-engine.js');

test('2026 federal baseline rates are exposed for selectable regimes',()=>{
 assert.equal(tax.regimes.usn_income.defaultRate,6);
 assert.equal(tax.regimes.usn_profit.defaultRate,15);
 assert.equal(tax.regimes.ausn_income.defaultRate,8);
 assert.equal(tax.regimes.ausn_profit.defaultRate,20);
 assert.equal(tax.regimes.osno_company.defaultRate,25);
});
test('taxpayer type limits regime choices',()=>{
 assert.deepEqual(tax.getRegimeOptions('ip').map(x=>x.id),['usn_income','usn_profit','ausn_income','ausn_profit','esxn','psn','npd']);
 assert.equal(tax.validateProfile({taxpayerType:'individual',regime:'osno_company',rate:25}).reason,'incompatible_taxpayer');
});
test('USN income tax is calculated from revenue, not product profit',()=>{
 const r=tax.calculateTaxPerUnit({profile:{taxpayerType:'ip',regime:'usn_income',rate:6},revenuePerUnit:1000,deductibleExpensesPerUnit:800});
 assert.equal(r.ok,true);assert.equal(r.basePerUnit,1000);assert.equal(r.taxPerUnit,60);
});
test('USN income less expenses applies the minimum tax floor',()=>{
 const r=tax.calculateTaxPerUnit({profile:{taxpayerType:'llc',regime:'usn_profit',rate:15},revenuePerUnit:1000,deductibleExpensesPerUnit:990});
 assert.equal(r.ok,true);assert.equal(r.ordinaryTaxPerUnit,1.5);assert.equal(r.minimumTaxPerUnit,10);
 assert.equal(r.taxPerUnit,10);assert.equal(r.minimumTaxApplied,true);
});
test('AUSN income less expenses applies its 3 percent minimum tax',()=>{
 const r=tax.calculateTaxPerUnit({profile:{taxpayerType:'ip',regime:'ausn_profit',rate:20},revenuePerUnit:1000,deductibleExpensesPerUnit:990});
 assert.equal(r.ok,true);assert.equal(r.taxPerUnit,30);assert.equal(r.minimumTaxApplied,true);
});
test('regional USN rate can be manually adjusted only inside statutory federal range',()=>{
 assert.equal(tax.validateProfile({taxpayerType:'ip',regime:'usn_income',rate:1}).ok,true);
 assert.equal(tax.validateProfile({taxpayerType:'ip',regime:'usn_income',rate:0.5}).reason,'rate_out_of_range');
 assert.equal(tax.validateProfile({taxpayerType:'ip',regime:'usn_profit',rate:4}).reason,'rate_out_of_range');
});
test('NPD is blocked for resale of purchased goods',()=>{
 assert.equal(tax.validateProfile({taxpayerType:'ip',regime:'npd',businessModel:'resale',rate:6}).reason,'npd_resale_prohibited');
});
test('PSN fixed tax is not falsely allocated to a SKU',()=>{
 assert.equal(tax.validateProfile({taxpayerType:'ip',regime:'psn'}).reason,'fixed_patent_requires_period_amount');
});
test('VAT is configured separately from profit tax',()=>{
 const r=tax.calculateTaxPerUnit({profile:{taxpayerType:'llc',regime:'osno_company',rate:25,vatMode:'standard_22'},revenuePerUnit:1000,deductibleExpensesPerUnit:500});
 assert.equal(r.ok,true);assert.equal(r.taxPerUnit,125);assert.equal(r.vatMode,'standard_22');assert.equal(r.vatSeparate,true);
});
test('negative and nonnumeric tax bases are rejected',()=>{
 assert.equal(tax.calculateTaxPerUnit({profile:{taxpayerType:'ip',regime:'usn_income'},revenuePerUnit:-1}).reason,'invalid_tax_base');
 assert.equal(tax.calculateTaxPerUnit({profile:{taxpayerType:'ip',regime:'usn_income'},revenuePerUnit:'bad'}).reason,'invalid_tax_base');
});
