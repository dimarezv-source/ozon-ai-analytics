(function(root){
  function compareProductCommissions(sales, finance, catalog){
    const empty={ok:false,reason:'missing_data',rows:[],matched:0,unmatched:0};
    const salesPeriod=sales&&sales.period||{},financePeriod=finance&&finance.period||{};
    if(!sales||!finance||!salesPeriod.date_from||!salesPeriod.date_to||
       salesPeriod.date_from!==financePeriod.date_from||salesPeriod.date_to!==financePeriod.date_to){
      return {...empty,reason:'period_mismatch'};
    }
    const catalogIndex=new Map();
    for(const product of Array.isArray(catalog)?catalog:[]){
      for(const field of ['sku','product_id','offer_id']){
        const value=product&&product[field];
        if(value!==null&&value!==undefined&&String(value)!=='')catalogIndex.set(field+':'+String(value),product);
      }
    }
    const estimates=new Map();
    let estimatedUnmatched=0;
    for(const sale of Array.isArray(sales.products)?sales.products:[]){
      const units=Math.max(0,Number(sale&&sale.units)||0);
      const revenue=Number(sale&&sale.sales_gmv);
      const fulfillment=String(sale&&sale.fulfillment_type||'').toUpperCase();
      if(!units||!Number.isFinite(revenue)||revenue<0||(fulfillment!=='FBO'&&fulfillment!=='FBS'))continue;
      let product=null;
      for(const field of ['sku','product_id','offer_id']){
        const value=sale[field];
        if(value!==null&&value!==undefined&&String(value)!==''){
          product=catalogIndex.get(field+':'+String(value));
          if(product)break;
        }
      }
      const sku=product&&product.sku!==null&&product.sku!==undefined?String(product.sku):String(sale.sku??'');
      const rate=product?Number(fulfillment==='FBO'?product.sales_percent_fbo:product.sales_percent_fbs):NaN;
      if(!product||!sku||!Number.isFinite(rate)||rate<0){estimatedUnmatched+=units;continue;}
      const key=[fulfillment,sku].join('|');
      const row=estimates.get(key)||{fulfillment_type:fulfillment,sku,currency:'RUB',estimated_commission:0,units:0};
      row.estimated_commission+=revenue*rate/100;
      row.units+=units;
      estimates.set(key,row);
    }
    const actuals=new Map();
    let actualUnmatched=0,nonRub=0,missingAmount=0;
    for(const row of Array.isArray(finance.product_commission_summary)?finance.product_commission_summary:[]){
      const rawAmount=row&&row.sale_commission;\n      const amount=Number(rawAmount);
      const sku=row&&row.sku!==null&&row.sku!==undefined?String(row.sku):'';
      const fulfillment=String(row&&row.fulfillment_type||'').toUpperCase();
      const currency=String(row&&row.currency||'').toUpperCase();
      if(!sku||(fulfillment!=='FBO'&&fulfillment!=='FBS')){actualUnmatched+=Number(row&&row.records)||1;continue;}
      if(currency!=='RUB'){nonRub+=Number(row&&row.records)||1;continue;}
      if(rawAmount===null||rawAmount===undefined||rawAmount===''||!Number.isFinite(amount)){missingAmount+=Number(row&&row.records)||1;continue;}
      const key=[fulfillment,sku].join('|');
      const current=actuals.get(key)||{fulfillment_type:fulfillment,sku,currency:'RUB',actual_commission:0,records:0};
      current.actual_commission+=amount;
      current.records+=Number(row.records)||0;
      actuals.set(key,current);
    }
    const keys=new Set([...estimates.keys(),...actuals.keys()]);
    const rows=[];
    for(const key of keys){
      const estimated=estimates.get(key),actual=actuals.get(key);
      rows.push({
        fulfillment_type:(estimated||actual).fulfillment_type,
        sku:(estimated||actual).sku,
        currency:'RUB',
        estimated_commission:estimated?Math.round(estimated.estimated_commission*100)/100:null,
        actual_commission:actual?Math.round(actual.actual_commission*100)/100:null,
        difference:estimated&&actual?Math.round((actual.actual_commission-estimated.estimated_commission)*100)/100:null,
        units:estimated?estimated.units:0,
        records:actual?actual.records:0,
        status:estimated&&actual?'comparable':estimated?'actual_missing':'estimate_missing'
      });
    }
    rows.sort((a,b)=>a.fulfillment_type.localeCompare(b.fulfillment_type)||a.sku.localeCompare(b.sku,'ru'));
    return {
      ok:true,period:{date_from:salesPeriod.date_from,date_to:salesPeriod.date_to},
      rows,matched:rows.filter(row=>row.status==='comparable').length,
      unmatched:rows.filter(row=>row.status!=='comparable').length,
      estimated_unmatched_units:estimatedUnmatched,actual_unmatched_records:actualUnmatched,
      non_rub_records:nonRub,missing_amount_records:missingAmount,
      basis:'Сравнение агрегированных исходных sale_commission Ozon с расчётом по тарифному проценту на GMV доставленных продаж. Разница не является подтверждённым долгом, удержанием или прибылью.'
    };
  }
  const api={compareProductCommissions};
  root.OzonCommissionComparison=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
