(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(n)||0);
 function buildMatrix(sales,finance){
  const map=new Map();
  const get=(schema,sku)=>{const key=String(schema||'')+':'+String(sku||'');if(!map.has(key))map.set(key,{schema:String(schema||'—'),sku:String(sku||''),units:0,gmv:0,returns:0,fees:new Map(),feeRecords:0});return map.get(key)};
  for(const row of (sales&&sales.products)||[]){if(!row||row.sku==null||row.sku==='')continue;const item=get(row.fulfillment_type,row.sku);item.units+=Math.max(0,Number(row.units)||0);item.gmv+=Math.max(0,Number(row.sales_gmv)||0)}
  for(const row of (finance&&finance.returns_attribution&&finance.returns_attribution.summary)||[]){if(!row||row.sku==null||row.sku==='')continue;const schema=String(row.fulfillment_type||'').toUpperCase();if(schema!=='FBO'&&schema!=='FBS')continue;const item=get(schema,row.sku);item.returns+=Math.max(0,Number(row.quantity)||0)}
  let unmatchedFinance=0;
  for(const row of (finance&&finance.posting_product_summary)||[]){
   if(!row||!row.sku)continue;
   if(row.fulfillment_type!=='FBO'&&row.fulfillment_type!=='FBS'){unmatchedFinance++;continue}
   const item=get(row.fulfillment_type,row.sku),currency=String(row.currency||'Валюта не указана');
   const amount=Number(row.amount);if(!Number.isFinite(amount))continue;
   item.fees.set(currency,(item.fees.get(currency)||0)+amount);item.feeRecords+=Number(row.records)||0;
  }
  const rows=[...map.values()].sort((a,b)=>a.schema.localeCompare(b.schema)||a.sku.localeCompare(b.sku,undefined,{numeric:true}));
  return {rows,unmatchedFinance,unmatchedReturns:Math.max(0,Number(finance&&finance.returns_attribution&&finance.returns_attribution.unmatched_count)||0)};
 }
 function toCsv(matrix,period){
  const currencies=[...new Set((matrix.rows||[]).flatMap(item=>[...item.fees.keys()]))].sort((a,b)=>a.localeCompare(b));
  const header=['SKU','Схема','Продано, шт.','GMV, оценка','Возвраты, шт.',...currencies.map(currency=>'Начисления '+currency),'Финансовых строк'];
  const records=[header];
  for(const item of matrix.rows||[]){
   records.push([item.sku,item.schema,item.units,item.gmv,item.returns,...currencies.map(currency=>item.fees.has(currency)?item.fees.get(currency):''),item.feeRecords]);
  }
  const quote=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
  return String.fromCharCode(0xFEFF)+records.map(record=>record.map(quote).join(';')).join(String.fromCharCode(13,10));
 }
 function downloadCsv(matrix,period){
  const csv=toCsv(matrix,period),blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  const from=(period&&period.date_from)||'period',to=(period&&period.date_to)||'period';
  link.href=url;link.download='ozon-sku-reconciliation-'+from+'_'+to+'.csv';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function render(matrix){
  const body=el('skuMatrixRows');if(!body)return;body.replaceChildren();
  for(const item of matrix.rows){
   const tr=document.createElement('tr');
   const fees=[...item.fees.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([currency,amount])=>fmt(amount)+' '+currency).join(' · ')||'Нет строк с явным SKU';
   const values=[item.sku,item.schema,fmt(item.units),fmt(item.gmv),fmt(item.returns),fees,fmt(item.feeRecords)];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index>=2)td.className='num';tr.appendChild(td)});
   body.appendChild(tr);
  }
  if(!matrix.rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='Нет общих строк по SKU. Проверь выбранный период и наличие SKU в ответах Ozon.';tr.appendChild(td);body.appendChild(tr)}
 }
 let lastMatrix=null,lastPeriod=null;
 async function load(){
  const from=el('reconFrom'),to=el('reconTo'),button=el('skuMatrixLoad'),status=el('skuMatrixStatus');
  if(!from||!to||!from.value||!to.value||to.value<from.value){status.textContent='Проверь даты периода выше.';status.classList.add('error');return}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;
  if(days>30){status.textContent='Для финансовой сверки выбери период не более 31 дня.';status.classList.add('error');return}
  lastMatrix=null;lastPeriod=null;const exportButton=el('skuMatrixExport');if(exportButton)exportButton.disabled=true;button.disabled=true;button.textContent='Собираю…';status.classList.remove('error');status.textContent='Загружаю продажи и финансовую сверку…';
  try{
   const query='?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value);
   const responses=await Promise.all([fetch('/api/sales'+query,{headers:{Accept:'application/json'}}),fetch('/api/finance/reconciliation'+query,{headers:{Accept:'application/json'}})]);
   const data=await Promise.all(responses.map(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.detail||'Ошибка загрузки данных Ozon');return body}));
   const matrix=buildMatrix(data[0],data[1]);lastMatrix=matrix;lastPeriod={date_from:from.value,date_to:to.value};render(matrix);if(exportButton)exportButton.disabled=!matrix.rows.length;
   const matched=matrix.rows.filter(row=>row.feeRecords>0).length;
   status.textContent='Готово · SKU в матрице: '+matrix.rows.length+' · SKU с финансовыми строками: '+matched+' · групп начислений без точного FBO/FBS совпадения: '+matrix.unmatchedFinance+' · возвратов без точного совпадения: '+matrix.unmatchedReturns+'. Возвраты в матрице — только точные совпадения по отправлению и SKU. GMV — оценка; начисления отдельно по валютам.';
  }catch(error){status.textContent=String(error.message||'Не удалось собрать сверку');status.classList.add('error')}
  finally{button.disabled=false;button.textContent='Собрать матрицу SKU'}
 }
 const api={buildMatrix,toCsv};
 root.OzonSkuReconciliation=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 const button=typeof document!=='undefined'?el('skuMatrixLoad'):null;if(button)button.addEventListener('click',load);
 const exportButton=typeof document!=='undefined'?el('skuMatrixExport'):null;
 if(exportButton)exportButton.addEventListener('click',()=>{if(!lastMatrix||!lastMatrix.rows.length)return;downloadCsv(lastMatrix,lastPeriod)});
 ['reconFrom','reconTo'].forEach(id=>{const field=typeof document!=='undefined'?el(id):null;if(field)field.addEventListener('change',()=>{if(exportButton)exportButton.disabled=true;lastMatrix=null;lastPeriod=null})});
})(typeof window!=='undefined'?window:globalThis);
