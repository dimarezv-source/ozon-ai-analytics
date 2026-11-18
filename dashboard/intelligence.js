(function(root){
  function productKey(product){
    return String(product.product_id||product.sku||product.offer_id||'unknown');
  }
  function buildProductRanking(sales, products, savedCosts, calculator){
    const rows=Array.isArray(sales&&sales.products)?sales.products:[];
    const catalog=Array.isArray(products)?products:[];
    const costs=savedCosts&&typeof savedCosts==='object'?savedCosts:{};
    const calculate=calculator&&calculator.calculateProfit;
    if(typeof calculate!=='function')throw new TypeError('Profit calculator is required');
    const index=new Map();
    for(const product of catalog){
      for(const field of ['sku','product_id','offer_id']){
        const value=product&&product[field];
        if(value!==null&&value!==undefined&&String(value)!=='')index.set(field+':'+String(value),product);
      }
    }
    const ranked=[],excluded={unmatched:0,missingCost:0,missingTariff:0,unpriced:0,unknownFulfillment:0};
    let totalUnits=0,includedUnits=0,includedRevenue=0,totalProfit=0;
    for(const sale of rows){
      const units=Math.max(0,Number(sale&&sale.units)||0);
      if(!units)continue;
      totalUnits+=units;
      const revenue=Number(sale.sales_gmv);
      if(!Number.isFinite(revenue)||revenue<=0){excluded.unpriced+=units;continue;}
      const fulfillment=String(sale.fulfillment_type||'').toUpperCase();
      if(fulfillment!=='FBO'&&fulfillment!=='FBS'){excluded.unknownFulfillment+=units;continue;}
      let product=null;
      for(const field of ['sku','product_id','offer_id']){
        const value=sale[field];
        if(value!==null&&value!==undefined&&String(value)!==''){
          product=index.get(field+':'+String(value));
          if(product)break;
        }
      }
      if(!product){excluded.unmatched+=units;continue;}
      const key=productKey(product),expense=costs[key]||{};
      if((expense.costConfigured!==true&&!(expense.cost!==null&&expense.cost!==undefined&&expense.cost!==''&&Number(expense.cost)>0))||!Number.isFinite(Number(expense.cost))||Number(expense.cost)<0){
        excluded.missingCost+=units;continue;
      }
      const price=revenue/units;
      const result=calculate({fulfillmentType:fulfillment,unitPrice:price,product,expenses:{
        cost:expense.cost,pack:expense.pack??0,ads:expense.ads??0,transit:expense.transit??0,
        other:expense.other??0,tax:expense.tax??0
      }});
      if(!result.ok){excluded.missingTariff+=units;continue;}
      const lineProfit=Math.round(result.profit*units*100)/100;
      const margin=result.marginPercent;
      let recommendation='Наблюдать';
      if(lineProfit<0)recommendation='Убыток: пересмотреть цену и расходы';
      else if(margin<10)recommendation='Низкая маржа: проверить цену';
      else if(margin>=25)recommendation='Лидер: сохранить экономику';
      ranked.push({
        productId:product.product_id??null,sku:product.sku??sale.sku??null,
        offerId:product.offer_id??null,name:product.name||sale.name||'Товар без названия',
        fulfillmentType:fulfillment,units,revenue:Math.round(revenue*100)/100,
        unitPrice:Math.round(price*100)/100,profit:lineProfit,
        profitPerUnit:result.profit,marginPercent:margin,recommendation,
        dataStatus:'estimate'
      });
      includedUnits+=units;includedRevenue+=revenue;totalProfit+=lineProfit;
    }
    ranked.sort((a,b)=>b.profit-a.profit||b.revenue-a.revenue||a.name.localeCompare(b.name,'ru'));
    return {
      items:ranked,totalUnits,includedUnits,includedRevenue:Math.round(includedRevenue*100)/100,
      estimatedProfit:Math.round(totalProfit*100)/100,
      coveragePercent:totalUnits?Math.round(includedUnits/totalUnits*10000)/100:0,
      excluded,source:'delivered_sales_and_user_costs',isActualProfit:false
    };
  }
  const api={buildProductRanking};
  root.OzonIntelligence=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
