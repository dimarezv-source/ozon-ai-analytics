(function(root){
  function calculateProfit(input){
    const type=String(input.fulfillmentType||'').toUpperCase();
    if(type!=='FBO'&&type!=='FBS')return {ok:false,reason:'unknown_fulfillment'};
    const product=input.product||{},expenses=input.expenses||{};
    const fields=type==='FBO'?['sales_percent_fbo','acquiring']:['sales_percent_fbs','acquiring','delivery_to_customer','first_mile_min','first_mile_max'];
    for(const field of fields){
      const value=product[field];
      if(value===null||value===undefined||value===''||!Number.isFinite(Number(value)))return {ok:false,reason:'missing_tariff',field};
      if(Number(value)<0)return {ok:false,reason:'invalid_tariff',field};
    }
    const price=Number(input.unitPrice);
    if(!Number.isFinite(price)||price<=0)return {ok:false,reason:'invalid_price'};
    const cost=key=>Math.max(0,Number(expenses[key])||0);
    const commissionRate=Number(type==='FBO'?product.sales_percent_fbo:product.sales_percent_fbs);
    const commission=price*commissionRate/100, acquiring=Number(product.acquiring);
    const firstMile=type==='FBS'?(Number(product.first_mile_min)+Number(product.first_mile_max))/2:0;
    const delivery=type==='FBS'?Number(product.delivery_to_customer):0;
    const transit=type==='FBS'?cost('transit'):0, tax=price*cost('tax')/100;
    const deductions={commission,acquiring,firstMile,delivery,cost:cost('cost'),pack:cost('pack'),ads:cost('ads'),transit,other:cost('other'),tax};
    const total=Object.values(deductions).reduce((sum,value)=>sum+value,0);
    return {ok:true,fulfillmentType:type,unitPrice:price,deductions,profit:price-total,marginPercent:(price-total)/price*100};
  }
  root.OzonProfitCalculator={calculateProfit};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.OzonProfitCalculator;
})(typeof globalThis!=='undefined'?globalThis:this);
