(function(root){
 const finite=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));
 const key=(schema,sku)=>String(schema||'')+'|'+String(sku||'');
 function buildSkuFinancialLedger(sales,finance){
  const empty={ok:false,reason:'missing_data',rows:[],metrics:{sales_skus:0,commission_matched_skus:0,service_fee_skus:0,return_skus:0,unmatched_service_records:0,non_rub_commission_records:0,non_rub_service_records:0}};
  const sp=sales&&sales.period||{},fp=finance&&finance.period||{};
  if(!sales||!finance||!sp.date_from||!sp.date_to||sp.date_from!==fp.date_from||sp.date_to!==fp.date_to)return {...empty,reason:'period_mismatch'};
  const rows=new Map();
  let unkeyedSalesUnits=0;
  for(const sale of Array.isArray(sales.products)?sales.products:[]){
   const units=Math.max(0,Number(sale&&sale.units)||0);
   if(!units)continue;
   const sku=sale&&sale.sku!==null&&sale.sku!==undefined?String(sale.sku):'';
   const schema=String(sale&&sale.fulfillment_type||'').toUpperCase();
   if(!sku||(schema!=='FBO'&&schema!=='FBS')){unkeyedSalesUnits+=units;continue;}
   const id=key(schema,sku);
   const row=rows.get(id)||{sku,fulfillment_type:schema,units:0,revenue:0,known_price_units:0,unpriced_units:0,commission_actual_rub:null,commission_records:0,service_fee_raw_rub:null,service_fee_records:0,return_quantity:0,return_priced_quantity:0,return_records:0,return_value_rub:null,coverage:{}};
   row.units+=units;
   if(finite(sale.sales_gmv)){row.revenue+=Number(sale.sales_gmv);row.known_price_units+=Math.max(0,units-Math.max(0,Number(sale.unpriced_units)||0));}
   row.unpriced_units+=Math.max(0,Number(sale.unpriced_units)||0);
   rows.set(id,row);
  }
  let unmatchedServiceRecords=0,nonRubCommissionRecords=0,nonRubServiceRecords=0;
  const commissionBuckets=new Map();
  for(const item of Array.isArray(finance.product_commission_summary)?finance.product_commission_summary:[]){
   const sku=item&&item.sku!==null&&item.sku!==undefined?String(item.sku):'';
   const schema=String(item&&item.fulfillment_type||'').toUpperCase();
   const records=Math.max(1,Number(item&&item.records)||1);
   if(!sku||(schema!=='FBO'&&schema!=='FBS'))continue;
   if(String(item.currency||'').toUpperCase()!=='RUB'){nonRubCommissionRecords+=records;continue;}
   if(!finite(item.sale_commission))continue;
   const id=key(schema,sku),bucket=commissionBuckets.get(id)||{amount:0,records:0};
   bucket.amount+=Number(item.sale_commission);bucket.records+=records;commissionBuckets.set(id,bucket);
  }
  for(const [id,bucket] of commissionBuckets){
   const row=rows.get(id);if(!row)continue;
   row.commission_actual_rub=bucket.amount;row.commission_records=bucket.records;
  }
  // Use posting_product_summary only. product_fee_summary is a second view of
  // accrual components and must not be added again.
  const serviceBuckets=new Map();
  for(const item of Array.isArray(finance.posting_product_summary)?finance.posting_product_summary:[]){
   const sku=item&&item.sku!==null&&item.sku!==undefined?String(item.sku):'';
   const schema=String(item&&item.fulfillment_type||'').toUpperCase();
   const records=Math.max(1,Number(item&&item.records)||1);
   if(!sku||(schema!=='FBO'&&schema!=='FBS')){unmatchedServiceRecords+=records;continue;}
   if(String(item.currency||'').toUpperCase()!=='RUB'){nonRubServiceRecords+=records;continue;}
   if(!finite(item.amount))continue;
   const id=key(schema,sku),bucket=serviceBuckets.get(id)||{amount:0,records:0};
   bucket.amount+=Number(item.amount);bucket.records+=records;serviceBuckets.set(id,bucket);
  }
  for(const [id,bucket] of serviceBuckets){
   const row=rows.get(id);if(!row)continue;
   row.service_fee_raw_rub=bucket.amount;row.service_fee_records=bucket.records;
  }
  const returnBuckets=new Map();
  const returns=finance.returns_attribution||{};
  for(const item of Array.isArray(returns.summary)?returns.summary:[]){
   const sku=item&&item.sku!==null&&item.sku!==undefined?String(item.sku):'';
   const schema=String(item&&item.fulfillment_type||'').toUpperCase();
   if(!sku||(schema!=='FBO'&&schema!=='FBS'))continue;
   const id=key(schema,sku),bucket=returnBuckets.get(id)||{quantity:0,priced:0,records:0,value:0,valueKnown:false};
   bucket.quantity+=Math.max(0,Number(item.quantity)||0);
   bucket.priced+=Math.max(0,Number(item.priced_quantity)||0);
   bucket.records+=Math.max(0,Number(item.return_records)||0);
   if(String(item.currency||'').toUpperCase()==='RUB'&&finite(item.returned_value)){
    bucket.value+=Number(item.returned_value);bucket.valueKnown=true;
   }
   returnBuckets.set(id,bucket);
  }
  for(const [id,bucket] of returnBuckets){
   const row=rows.get(id);if(!row)continue;
   row.return_quantity=bucket.quantity;row.return_priced_quantity=bucket.priced;row.return_records=bucket.records;
   row.return_value_rub=bucket.valueKnown?bucket.value:null;
  }
  const result=[...rows.values()].map(row=>{
   row.revenue=row.known_price_units?Math.round(row.revenue*100)/100:null;
   if(row.commission_actual_rub!==null)row.commission_actual_rub=Math.round(row.commission_actual_rub*100)/100;
   if(row.service_fee_raw_rub!==null)row.service_fee_raw_rub=Math.round(row.service_fee_raw_rub*100)/100;
   if(row.return_value_rub!==null)row.return_value_rub=Math.round(row.return_value_rub*100)/100;
   // Profit is deliberately not calculated from incomplete or semantically ambiguous inputs.
   // Cost of goods is not part of this ledger; raw accruals and return values are not
   // treated as expenses/refunds without verified source semantics.
   row.profit_readiness={
    status:'insufficient_data',
    can_calculate_profit:false,
    verified_components:[
     ...(row.coverage.sales==='complete_price_coverage'?['sales_revenue']:[]),
     ...(row.commission_actual_rub!==null?['actual_sale_commission']:[])
    ],
    missing_components:['cost_of_goods'],
    review_components:[
     ...(row.service_fee_raw_rub!==null?['unclassified_service_accruals']:['service_accrual_source_missing']),
     ...(row.return_records>0?['return_value_is_not_a_confirmed_refund']:[])
    ]
   };
   row.coverage={
    sales:row.unpriced_units>0?(row.known_price_units>0?'partial_price_coverage':'no_usable_price'):'complete_price_coverage',
    commission:row.commission_actual_rub===null?'no_source_row':'matched',
    service_fees:row.service_fee_raw_rub===null?'no_source_row':'matched',
    returns:row.return_records?'matched':'no_source_row'
   };
   return row;
  }).sort((a,b)=>a.fulfillment_type.localeCompare(b.fulfillment_type)||a.sku.localeCompare(b.sku,'ru'));
  return {ok:true,period:{date_from:sp.date_from,date_to:sp.date_to},rows:result,unkeyed_sales_units:unkeyedSalesUnits,metrics:{
   sales_skus:result.length,
   commission_matched_skus:result.filter(x=>x.commission_actual_rub!==null).length,
   service_fee_skus:result.filter(x=>x.service_fee_raw_rub!==null).length,
   return_skus:result.filter(x=>x.return_records>0).length,
   unmatched_service_records:unmatchedServiceRecords,
   non_rub_commission_records:nonRubCommissionRecords,
   non_rub_service_records:nonRubServiceRecords
  },basis:'Sales GMV from delivered postings. Sale commission from explicit posting product commission fields. Service accruals from posting_product_summary only; the parallel product_fee_summary view is deliberately not added. Amounts are source amounts and are not semantically classified or converted into profit. Returns require exact posting and SKU attribution; product-price values are indicators, not confirmed refunds or losses.'};
 }
 const api={buildSkuFinancialLedger};root.OzonSkuFinancialLedger=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
