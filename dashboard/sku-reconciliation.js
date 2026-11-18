(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n)||0);
 function buildMatrix(sales,finance){
  const map=new Map();
  const get=(schema,sku)=>{const key=String(schema||'')+':'+String(sku||'');if(!map.has(key))map.set(key,{schema:String(schema||'—'),sku:String(sku||''),units:0,gmv:0,returns:0,fees:new Map(),feeRecords:0});return map.get(key)};
  for(const row of (sales&&sales.products)||[]){if(!row||row.sku==null||row.sku==='')continue;const item=get(row.fulfillment_type,row.sku);item.units+=Math.max(0,Number(row.units)||0);item.gmv+=Math.max(0,Number(row.sales_gmv)||0)}
  for(const row of (finance&&finance.returns_summary)||[]){if(!row||row.sku==null||row.sku==='')continue;const item=get(row.fulfillment_type,row.sku);item.returns+=Math.max(0,Number(row.quantity)||0)}
  let unmatchedFinance=0;
  for(const row of (finance&&finance.product_fee_summary)||[]){
   if(!row||!row.sku)continue;
   if(row.fulfillment_type!=='FBO'&&row.fulfillment_type!=='FBS'){unmatchedFinance++;continue}
   const item=get(row.fulfillment_type,row.sku),currency=String(row.currency||'Валюта не указана');
   const amount=Number(row.amount);if(!Number.isFinite(amount))continue;
   item.fees.set(currency,(item.fees.get(currency)||0)+amount);item.feeRecords+=Number(row.components)||0;
  }
  const rows=[...map.values()].sort((a,b)=>a.schema.localeCompare(b.schema)||a.sku.localeCompare(b.sku,undefined,{numeric:true}));
  return {rows,unmatchedFinance};
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
 async function load(){
  const from=el('reconFrom'),to=el('reconTo'),button=el('skuMatrixLoad'),status=el('skuMatrixStatus');
  if(!from||!to||!from.value||!to.value||to.value<from.value){status.textContent='Проверь даты периода выше.';status.classList.add('error');return}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;
  if(days>30){status.textContent='Для финансовой сверки выбери период не более 31 дня.';status.classList.add('error');return}
  button.disabled=true;button.textContent='Собираю…';status.classList.remove('error');status.textContent='Загружаю продажи и финансовую сверку…';
  try{
   const query='?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value);
   const responses=await Promise.all([fetch('/api/sales'+query,{headers:{Accept:'application/json'}}),fetch('/api/finance/reconciliation'+query,{headers:{Accept:'application/json'}})]);
   const data=await Promise.all(responses.map(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.detail||'Ошибка загрузки данных Ozon');return body}));
   const matrix=buildMatrix(data[0],data[1]);render(matrix);
   const matched=matrix.rows.filter(row=>row.feeRecords>0).length;
   status.textContent='Готово · SKU в матрице: '+matrix.rows.length+' · SKU с финансовыми строками: '+matched+' · групп начислений без точного FBO/FBS совпадения: '+matrix.unmatchedFinance+'. GMV — оценка по цене товара; начисления показаны отдельно по валютам.';
  }catch(error){status.textContent=String(error.message||'Не удалось собрать сверку');status.classList.add('error')}
  finally{button.disabled=false;button.textContent='Собрать матрицу SKU'}
 }
 const api={buildMatrix};
 root.OzonSkuReconciliation=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 const button=typeof document!=='undefined'?el('skuMatrixLoad'):null;if(button)button.addEventListener('click',load);
})(typeof window!=='undefined'?window:globalThis);
