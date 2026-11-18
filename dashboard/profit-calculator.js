(function(root){
  function calculateProfit(input){
    const type=String(input.fulfillmentType||'').toUpperCase();
    if(type!=='FBO'&&type!=='FBS')return {ok:false,reason:'unknown_fulfillment'};
    const product=input.product||{},expenses=input.expenses||{};
    const fields=type==='FBO'
      ?['sales_percent_fbo','acquiring','fbo_delivery_to_customer','fbo_transit_min','fbo_transit_max']
      :['sales_percent_fbs','acquiring','delivery_to_customer','first_mile_min','first_mile_max','transit_min','transit_max'];
    for(const field of fields){
      const value=product[field];
      if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return {ok:false,reason:'missing_tariff',field};
      if(Number(value)<0)return {ok:false,reason:'invalid_tariff',field};
    }
    const price=Number(input.unitPrice);
    if(!Number.isFinite(price)||price<=0)return {ok:false,reason:'invalid_price'};
    const expenseKeys=['cost','pack','ads','transit','other','tax'];
    const normalized={};
    for(const key of expenseKeys){
      const raw=expenses[key]??0, value=Number(raw);
      if(raw!==''&&(!Number.isFinite(value)||value<0))return {ok:false,reason:'invalid_expense',field:key};
      normalized[key]=value||0;
    }
    if(normalized.tax>100)return {ok:false,reason:'invalid_expense',field:'tax'};
    const commissionRate=Number(type==='FBO'?product.sales_percent_fbo:product.sales_percent_fbs);
    const commission=price*commissionRate/100, acquiring=Number(product.acquiring);
    const firstMile=type==='FBS'?(Number(product.first_mile_min)+Number(product.first_mile_max))/2:0;
    const delivery=Number(type==='FBO'?product.fbo_delivery_to_customer:product.delivery_to_customer);
    const transitMin=Number(type==='FBO'?product.fbo_transit_min:product.transit_min);
    const transitMax=Number(type==='FBO'?product.fbo_transit_max:product.transit_max);
    const marketplaceTransit=(transitMin+transitMax)/2;
    const tax=price*normalized.tax/100;
    const deductions={
      commission,acquiring,firstMile,delivery,marketplaceTransit,
      cost:normalized.cost,pack:normalized.pack,ads:normalized.ads,
      additionalTransit:normalized.transit,other:normalized.other,tax
    };
    const total=Object.values(deductions).reduce((sum,value)=>sum+value,0);
    const profit=Math.round(price-total);
    const returnFlowRaw=type==='FBO'?product.fbo_return_flow:product.return_flow;
    const returnFlow=returnFlowRaw===null||returnFlowRaw===undefined||returnFlowRaw===''?null:Number(returnFlowRaw);
    return {
      ok:true,fulfillmentType:type,unitPrice:price,deductions,
      returnFlowTariff:returnFlow!==null&&Number.isFinite(returnFlow)?returnFlow:null,
      returnFlowIncluded:false,
      profit,marginPercent:Math.round(profit/price*10000)/100
    };
  }
  function simulatePrice(input){
    const currentPrice=Number(input.currentPrice),scenarioPrice=Number(input.scenarioPrice);
    const common={fulfillmentType:input.fulfillmentType,product:input.product,expenses:input.expenses};
    const current=calculateProfit({...common,unitPrice:currentPrice});
    if(!current.ok)return {ok:false,reason:'invalid_current_price',current};
    const scenario=calculateProfit({...common,unitPrice:scenarioPrice});
    if(!scenario.ok)return {ok:false,reason:'invalid_scenario_price',current,scenario};
    return {
      ok:true,current,scenario,
      deltaProfitPerUnit:Math.round(scenario.profit-current.profit),
      deltaMarginPoints:Math.round((scenario.marginPercent-current.marginPercent)*100)/100,
      scenarioAssumption:'same_costs_and_tariffs_no_demand_response'
    };
  }
  root.OzonProfitCalculator={calculateProfit,simulatePrice};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.OzonProfitCalculator;
})(typeof globalThis!=='undefined'?globalThis:this);
