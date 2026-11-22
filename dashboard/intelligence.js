(function(root){
  function productKey(product){
    return String(product.product_id||product.sku||product.offer_id||'unknown');
  }
  function money(value){
    return new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(value)+' ₽';
  }
  function priceForMargin(product,expenses,fulfillmentType,calculation,targetMarginPercent){
    const commissionRate=Number(fulfillmentType==='FBO'?product.sales_percent_fbo:product.sales_percent_fbs);
    const taxRate=Number(expenses.tax??0);
    if(!Number.isFinite(commissionRate)||!Number.isFinite(taxRate))return null;
    const deductions=calculation.deductions||{};
    const fixedCosts=Object.entries(deductions)
      .filter(([key])=>key!=='commission'&&key!=='tax')
      .reduce((sum,[,value])=>sum+Number(value||0),0);
    const denominator=1-(commissionRate+taxRate+targetMarginPercent)/100;
    if(!Number.isFinite(denominator)||denominator<=0)return null;
    const raw=fixedCosts/denominator;
    if(!Number.isFinite(raw)||raw<=0)return null;
    return Math.ceil(raw*100)/100;
  }
  function buildProductRanking(sales, products, savedCosts, calculator, finance){
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
    const commissionKey=(type,sku)=>type+'|'+String(sku??'');
    const actualCommissionTotals=new Map(),salesGmvTotals=new Map();
    const samePeriod=!!(finance&&finance.period&&sales&&sales.period&&finance.period.date_from===sales.period.date_from&&finance.period.date_to===sales.period.date_to);
    if(samePeriod){
      for(const row of Array.isArray(finance.product_commission_summary)?finance.product_commission_summary:[]){
        const type=String(row.fulfillment_type||'').toUpperCase(),sku=row.sku,amount=Number(row.sale_commission);
        if((type!=='FBO'&&type!=='FBS')||sku===null||sku===undefined||String(row.currency||'').toUpperCase()!=='RUB'||row.sale_commission===null||row.sale_commission===undefined||row.sale_commission===''||!Number.isFinite(amount))continue;
        const key=commissionKey(type,sku);actualCommissionTotals.set(key,(actualCommissionTotals.get(key)||0)+amount);
      }
      for(const sale of rows){
        const type=String(sale.fulfillment_type||'').toUpperCase(),sku=sale.sku,revenue=Number(sale.sales_gmv);
        if((type==='FBO'||type==='FBS')&&sku!==null&&sku!==undefined&&Number.isFinite(revenue)&&revenue>0){const key=commissionKey(type,sku);salesGmvTotals.set(key,(salesGmvTotals.get(key)||0)+revenue);}
      }
    }
    let actualCommissionUnits=0,tariffCommissionUnits=0;
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
      const expenses={
        cost:expense.cost,pack:expense.pack??0,ads:expense.ads??0,transit:expense.transit??0,
        other:expense.other??0,tax:expense.tax??0
      };
      const key=commissionKey(fulfillment,product.sku??sale.sku);
      const actualTotal=actualCommissionTotals.get(key),totalSalesGmv=salesGmvTotals.get(key)||0;
      const hasActualCommission=actualTotal!==undefined&&totalSalesGmv>0&&typeof calculator.calculateProfitWithActualCommission==='function';
      const actualForRow=hasActualCommission?actualTotal*(revenue/totalSalesGmv)/units:null;
      const result=hasActualCommission
        ?calculator.calculateProfitWithActualCommission({fulfillmentType:fulfillment,unitPrice:price,product,expenses,actualCommission:actualForRow})
        :calculate({fulfillmentType:fulfillment,unitPrice:price,product,expenses});
      if(!result.ok){excluded.missingTariff+=units;continue;}
      if(hasActualCommission)actualCommissionUnits+=units;else tariffCommissionUnits+=units;
      const unitProfitExact=result.profitExact??result.profit;
      const lineProfit=Math.round(unitProfitExact*units*100)/100;
      const margin=result.marginPercent;
      const targetMargin=margin<0?0:15;
      const targetPrice=!hasActualCommission&&margin<15?priceForMargin(product,expenses,fulfillment,result,targetMargin):null;
      let targetProfit=null,scenarioLift=null,recommendation='Наблюдать';
      if(margin<0){
        if(hasActualCommission){recommendation='Убыток с учётом фактической комиссии Ozon: проверь себестоимость и остальные расходы';}
        else if(targetPrice!==null){
          const targetResult=calculate({fulfillmentType:fulfillment,unitPrice:targetPrice,product,expenses});
          if(targetResult.ok){
            targetProfit=Math.round((targetResult.profitExact??targetResult.profit)*units*100)/100;
            scenarioLift=Math.round((targetProfit-lineProfit)*100)/100;
            recommendation='Убыток: безубыточная цена ≈ '+money(targetPrice)+'; сценарный эффект '+(scenarioLift>0?'+':'')+money(scenarioLift)+' при тех же продажах';
          }
        }
        if(targetPrice===null)recommendation='Убыток: сократить себестоимость и расходы или пересмотреть тарифную схему';
      }else if(margin<15){
        if(hasActualCommission){recommendation='Маржа ниже 15% с фактической комиссией Ozon: проверь себестоимость и остальные расходы';}
        else if(targetPrice!==null){
          const targetResult=calculate({fulfillmentType:fulfillment,unitPrice:targetPrice,product,expenses});
          if(targetResult.ok){
            targetProfit=Math.round((targetResult.profitExact??targetResult.profit)*units*100)/100;
            scenarioLift=Math.round((targetProfit-lineProfit)*100)/100;
            recommendation='Цена для маржи 15%: ≈ '+money(targetPrice)+'; сценарный эффект '+(scenarioLift>0?'+':'')+money(scenarioLift);
          }
        }
        if(targetPrice===null)recommendation='Снизить расходы: при текущих тарифах целевая маржа недостижима';
      }else if(margin>=25)recommendation=hasActualCommission?'Лидер с фактической комиссией: сохранить экономику':'Лидер: сохранить экономику';
      ranked.push({
        productId:product.product_id??null,sku:product.sku??sale.sku??null,
        offerId:product.offer_id??null,name:product.name||sale.name||'Товар без названия',
        fulfillmentType:fulfillment,units,revenue:Math.round(revenue*100)/100,
        unitPrice:Math.round(price*100)/100,profit:lineProfit,
        profitPerUnit:result.profit,profitPerUnitExact:unitProfitExact,marginPercent:margin,recommendation,
        targetPrice:targetPrice===null?null:Math.round(targetPrice*100)/100,
        targetMarginPercent:targetPrice===null?null:targetMargin,
        scenarioProfit:targetProfit,scenarioProfitLift:scenarioLift,
        scenarioAssumption:'same_units_no_demand_response',
        dataStatus:hasActualCommission?'actual_commission_plus_estimated_costs':'estimate'
      });
      includedUnits+=units;includedRevenue+=revenue;totalProfit+=lineProfit;
    }
    ranked.sort((a,b)=>b.profit-a.profit||b.revenue-a.revenue||a.name.localeCompare(b.name,'ru'));
    return {
      items:ranked,totalUnits,includedUnits,includedRevenue:Math.round(includedRevenue*100)/100,
      estimatedProfit:Math.round(totalProfit*100)/100,
      actualCommissionUnits,tariffCommissionUnits,
      coveragePercent:totalUnits?Math.round(includedUnits/totalUnits*10000)/100:0,
      excluded,source:'delivered_sales_user_costs_and_actual_commission_when_matched',isActualProfit:false
    };
  }
  const api={buildProductRanking,priceForMargin};
  root.OzonIntelligence=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
