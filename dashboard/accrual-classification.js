(function(root){
 const STORAGE_KEY='ozon-ai-analytics-accrual-classifications-v1';
 const ALLOWED=new Set(['expense','income','adjustment','neutral','commission']);
 function loadClassifications(storage){
  try{return JSON.parse((storage||root.localStorage).getItem(STORAGE_KEY)||'{}')||{};}catch(_){return {};}
 }
 function saveClassifications(map,storage){
  try{(storage||root.localStorage).setItem(STORAGE_KEY,JSON.stringify(map||{}));return true;}catch(_){return false;}
 }
 function classificationKey(typeId,currency){return String(typeId??'UNKNOWN')+'|'+String(currency||'').toUpperCase();}
 function buildClassifiedAccruals(finance,classifications){
  const totals=new Map(),byType=new Map();
  const metrics={included_records:0,unclassified_records:0,commission_records:0,neutral_records:0,unmatched_records:0,non_rub_records:0,included_type_count:0};
  const rows=Array.isArray(finance&&finance.posting_product_summary)?finance.posting_product_summary:[];
  for(const row of rows){
   const sku=row&&row.sku!==null&&row.sku!==undefined?String(row.sku):'';
   const fulfillment=String(row&&row.fulfillment_type||'').toUpperCase();
   const currency=String(row&&row.currency||'').toUpperCase();
   if(!sku||(fulfillment!=='FBO'&&fulfillment!=='FBS')){metrics.unmatched_records+=Math.max(1,Number(row&&row.records)||1);continue;}
   const records=Math.max(1,Number(row.records)||1);
   if(currency!=='RUB'){metrics.non_rub_records+=records;continue;}
   const typeId=String(row.type_id??'UNKNOWN'),mapping=classifications&&classifications[classificationKey(typeId,currency)];
   const category=mapping&&ALLOWED.has(mapping.category)?mapping.category:'unclassified';
   if(category==='commission'){metrics.commission_records+=records;continue;}
   if(category==='neutral'){metrics.neutral_records+=records;continue;}
   if(!['expense','income','adjustment'].includes(category)||mapping.commission_confirmed_not_duplicate!==true){
    metrics.unclassified_records+=records;continue;
   }
   const amount=Number(row.amount);
   if(!Number.isFinite(amount))continue;
   const key=fulfillment+'|'+sku;
   totals.set(key,(totals.get(key)||0)+amount);
   const typeKey=classificationKey(typeId,currency),type=byType.get(typeKey)||{type_id:typeId,currency,category,amount:0,records:0};
   type.amount+=amount;type.records+=records;byType.set(typeKey,type);
   metrics.included_records+=records;
  }
  metrics.included_type_count=byType.size;
  return {totals,byType:[...byType.values()],metrics,basis:'Only explicit per-type manual mappings with non-commission confirmation are included. Signed Ozon amounts are preserved. Uses posting_product_summary only; product_fee_summary is not added.'};
 }
 const api={STORAGE_KEY,classificationKey,loadClassifications,saveClassifications,buildClassifiedAccruals};
 root.OzonAccrualClassification=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
