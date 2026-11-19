(function(root){
  const TAX_RULES_VERSION='2026.11';
  const regimes={
    usn_income:{label:'УСН · доходы',taxpayerTypes:['ip','llc'],base:'revenue',defaultRate:6,minRate:1,maxRate:6,minimumTaxRate:0,regionalRate:true,description:'Налог с доходов. Региональная ставка может быть ниже при выполнении условий.'},
    usn_profit:{label:'УСН · доходы минус расходы',taxpayerTypes:['ip','llc'],base:'profit',defaultRate:15,minRate:5,maxRate:15,minimumTaxRate:1,regionalRate:true,description:'Налог с разницы доходов и учитываемых расходов; минимальный налог — 1% доходов.'},
    ausn_income:{label:'АУСН · доходы',taxpayerTypes:['ip','llc'],base:'revenue',defaultRate:8,minRate:8,maxRate:8,minimumTaxRate:0,regionalRate:false,description:'Доступность зависит от региона и условий эксперимента.'},
    ausn_profit:{label:'АУСН · доходы минус расходы',taxpayerTypes:['ip','llc'],base:'profit',defaultRate:20,minRate:20,maxRate:20,minimumTaxRate:3,regionalRate:false,description:'Минимальный налог — 3% доходов.'},
    osno_company:{label:'ОСНО · налог на прибыль организации',taxpayerTypes:['llc'],base:'profit',defaultRate:25,minRate:25,maxRate:25,minimumTaxRate:0,regionalRate:false,description:'Общая ставка налога на прибыль организаций; отдельные категории имеют специальные правила.'},
    esxn:{label:'ЕСХН',taxpayerTypes:['ip','llc'],base:'profit',defaultRate:6,minRate:0,maxRate:6,minimumTaxRate:0,regionalRate:true,description:'Только при соблюдении критериев сельхозтоваропроизводителя; региональные ставки и льготы проверяются отдельно.'},
    psn:{label:'ПСН',taxpayerTypes:['ip'],base:'fixed',defaultRate:null,minRate:null,maxRate:null,minimumTaxRate:0,regionalRate:true,description:'Стоимость патента зависит от региона, вида деятельности и физических показателей; корректно распределяется только из суммы патента.'},
    npd:{label:'НПД · самозанятость',taxpayerTypes:['individual','ip'],base:'receipt_type',defaultRate:null,minRate:4,maxRate:6,minimumTaxRate:0,regionalRate:false,description:'Не подходит для перепродажи закупленных товаров. Допустим только для собственных товаров/работ/услуг при соблюдении ограничений.'}
  };
  const vatOptions=[
    {value:'exempt',label:'Освобождение от НДС',rate:0,deductInputVat:false},
    {value:'standard_22',label:'НДС 22% · с вычетами',rate:22,deductInputVat:true},
    {value:'standard_10',label:'НДС 10% · категории по НК РФ',rate:10,deductInputVat:true},
    {value:'zero',label:'НДС 0% · только предусмотренные операции',rate:0,deductInputVat:true},
    {value:'usn_5',label:'НДС 5% · УСН, без вычетов',rate:5,deductInputVat:false},
    {value:'usn_7',label:'НДС 7% · УСН, без вычетов',rate:7,deductInputVat:false}
  ];
  function getRegimeOptions(taxpayerType){
    return Object.entries(regimes).filter(([,r])=>r.taxpayerTypes.includes(taxpayerType)).map(([id,r])=>({id,...r}));
  }
  function validateProfile(profile){
    if(!profile||!regimes[profile.regime])return {ok:false,reason:'unknown_regime'};
    const rule=regimes[profile.regime];
    if(!rule.taxpayerTypes.includes(profile.taxpayerType))return {ok:false,reason:'incompatible_taxpayer'};
    if(profile.regime==='npd'&&profile.businessModel==='resale')return {ok:false,reason:'npd_resale_prohibited'};
    if(profile.regime==='psn')return {ok:false,reason:'fixed_patent_requires_period_amount'};
    if(profile.regime==='osno_company'&&profile.taxpayerType!=='llc')return {ok:false,reason:'company_only'};
    const rate=Number(profile.rate??rule.defaultRate);
    if(!Number.isFinite(rate)||rate<rule.minRate||rate>rule.maxRate)return {ok:false,reason:'rate_out_of_range',min:rule.minRate,max:rule.maxRate};
    if(profile.vatMode&&!vatOptions.some(x=>x.value===profile.vatMode))return {ok:false,reason:'unknown_vat_mode'};
    if(['usn_income','usn_profit','ausn_income','ausn_profit'].includes(profile.regime)&&profile.vatMode==='standard_10')return {ok:false,reason:'vat_10_requires_eligible_goods'};
    if(['usn_income','usn_profit'].includes(profile.regime)&&['usn_5','usn_7'].includes(profile.vatMode)===false&&profile.vatMode&&profile.vatMode.startsWith('usn_'))return {ok:false,reason:'invalid_usn_vat_mode'};
    return {ok:true,rate,rule};
  }
  function calculateTaxPerUnit(input){
    const profile=input&&input.profile||{};
    const valid=validateProfile(profile);
    if(!valid.ok)return {ok:false,reason:valid.reason};
    const revenue=Number(input.revenuePerUnit),deductible=Number(input.deductibleExpensesPerUnit||0);
    if(!Number.isFinite(revenue)||revenue<0||!Number.isFinite(deductible)||deductible<0)return {ok:false,reason:'invalid_tax_base'};
    const base=valid.rule.base==='revenue'?revenue:Math.max(0,revenue-deductible);
    const ordinary=base*valid.rate/100;
    const minimum=revenue*(valid.rule.minimumTaxRate||0)/100;
    const tax=Math.max(ordinary,minimum);
    return {ok:true,regime:profile.regime,taxpayerType:profile.taxpayerType,baseType:valid.rule.base,basePerUnit:base,rate:valid.rate,taxPerUnit:Math.round(tax*100)/100,ordinaryTaxPerUnit:Math.round(ordinary*100)/100,minimumTaxPerUnit:Math.round(minimum*100)/100,minimumTaxApplied:minimum>ordinary,vatMode:profile.vatMode||'not_configured',vatSeparate:true,warning:'Оценка на единицу товара. Итоговый налог зависит от налогового периода, совокупных доходов/расходов, вычетов, взносов и региональных условий.'};
  }
  root.OzonTaxEngine={TAX_RULES_VERSION,regimes,vatOptions,getRegimeOptions,validateProfile,calculateTaxPerUnit};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.OzonTaxEngine;
})(typeof globalThis!=='undefined'?globalThis:this);
