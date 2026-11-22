(function setupReconciliation(){
 const from=document.getElementById('reconFrom'),to=document.getElementById('reconTo'),btn=document.getElementById('reconLoad'),status=document.getElementById('reconStatus'),rows=document.getElementById('reconRows');
 if(!from||!to||!btn)return;
 const exportBtn=document.getElementById('reconExport');let lastData=null;
 function csvCell(value){return '"'+String(value??'').replace(/"/g,'""')+'"'}
 function buildCsv(data){
  const lines=[['Раздел','Поле 1','Поле 2','Поле 3','Поле 4','Поле 5','Поле 6','Поле 7','Поле 8']];
  const add=(section,values)=>lines.push([section,...values].concat(Array(Math.max(0,8-values.length)).fill('')));
  add('Период',[data.period?.date_from,data.period?.date_to]);
  const m=data.metrics||{};
  add('Показатели',['Компонентов',m.component_count,'Известных типов',m.known_type_count,'Неизвестных типов',m.unknown_type_count,'Совпадение, %',m.posting_match_percent]);
  add('Показатели',['Совпало компонентов',m.posting_match_count,'Без совпадения',m.posting_unmatched_count,'С явным SKU',m.sku_attributed_count,'Без SKU',m.sku_unattributed_count]);
  const groups=[
   ['Сводка по типам',data.summary||[],r=>[r.label,r.type_id,r.currency,r.amount,r.records,r.matched_records,r.unmatched_records]],
   ['По схеме FBO/FBS',data.fulfillment_summary||[],r=>[r.fulfillment_type,r.label,r.type_id,r.currency,r.amount,r.components]],
   ['Без распределения',data.unmatched_summary||[],r=>[r.label,r.type_id,r.currency,r.amount,r.components]],
   ['Комиссии с SKU',data.product_fee_summary||[],r=>[r.fulfillment_type,r.sku,r.offer_id,r.label,r.type_id,r.currency,r.amount,r.components]],
   ['Начисления по отправлениям',data.posting_product_summary||[],r=>[r.fulfillment_type,r.sku,r.label,r.type_id,r.currency,r.amount,r.records,r.reported_quantity]],
   ['Возвраты',data.returns_summary||[],r=>[r.name,r.fulfillment_type,r.sku,r.return_type,r.quantity,r.currency,r.returned_value,r.priced_quantity]],
   ['Возвраты — точное сопоставление',data.returns_attribution?.summary||[],r=>[r.fulfillment_type,r.sku,r.return_type,r.quantity,r.currency,r.returned_value,r.priced_quantity,r.return_records]],
   ['Возвраты — без сопоставления',data.returns_attribution?.unmatched_events||[],r=>[r.return_id,r.posting_number,r.sku,r.unmatched_reason,r.quantity,r.currency,r.returned_value]],
   ['Исходные компоненты',data.components||[],r=>[r.posting_number,r.fulfillment_type,r.sku,r.label,r.type_id,r.currency,r.amount,r.posting_match]]
  ];
  for(const [section,items,project] of groups){add(section,['','','']);for(const item of items)add(section,project(item))}
  return String.fromCharCode(65279)+lines.map(row=>row.map(csvCell).join(';')).join(String.fromCharCode(13,10));
 }
 function exportCsv(){
  if(!lastData)return;
  const blob=new Blob([buildCsv(lastData)],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='ozon-finance-reconciliation-'+(lastData.period?.date_from||'from')+'_'+(lastData.period?.date_to||'to')+'.csv';
  document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 if(exportBtn)exportBtn.addEventListener('click',exportCsv);

 const today=new Date(),end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())),start=new Date(end);start.setUTCDate(start.getUTCDate()-6);
 from.value=start.toISOString().slice(0,10);to.value=end.toISOString().slice(0,10);
 const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n)||0);
 function cell(tr,v,cls){const td=document.createElement('td');td.textContent=String(v??'—');if(cls)td.className=cls;tr.appendChild(td)}
 async function load(){
  if(!from.value||!to.value||to.value<from.value){status.textContent='Проверь даты.';status.classList.add('error');return}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;if(days>30){status.textContent='Период не должен превышать 31 день.';status.classList.add('error');return}
  lastData=null;if(exportBtn)exportBtn.disabled=true;btn.disabled=true;btn.textContent='Сверяю…';status.classList.remove('error');status.textContent='Последовательно запрашиваю финансовый API Ozon…';
  try{
   const r=await fetch('/api/finance/reconciliation?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value),{headers:{Accept:'application/json'}}),d=await r.json();if(!r.ok)throw new Error(d.detail||'Ошибка финансового API');
   lastData=d;if(exportBtn)exportBtn.disabled=false;
   rows.replaceChildren();
   for(const item of (d.summary||[])){const tr=document.createElement('tr');cell(tr,item.label||'Неизвестный тип');cell(tr,item.type_id,'muted');cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.amount),'amount');cell(tr,item.records);rows.appendChild(tr)}
   if(!d.summary?.length){const tr=document.createElement('tr');cell(tr,'Компоненты за период не найдены.');tr.firstChild.colSpan=5;rows.appendChild(tr)}
   const fboRows=document.getElementById('reconFulfillmentRows'),unmatchedRows=document.getElementById('reconUnmatchedRows');fboRows.replaceChildren();unmatchedRows.replaceChildren();
   for(const item of (d.fulfillment_summary||[])){const tr=document.createElement('tr');cell(tr,item.fulfillment_type);cell(tr,item.label||'Неизвестный тип');cell(tr,item.type_id,'muted');cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.amount),'amount');cell(tr,item.components);fboRows.appendChild(tr)}
   if(!(d.fulfillment_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Нет точных совпадений с доставленными отправлениями.');tr.firstChild.colSpan=6;fboRows.appendChild(tr)}
   for(const item of (d.unmatched_summary||[])){const tr=document.createElement('tr');cell(tr,item.label||'Неизвестный тип');cell(tr,item.type_id,'muted');cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.amount),'amount');cell(tr,item.components);unmatchedRows.appendChild(tr)}
   if(!(d.unmatched_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Все компоненты имеют точное совпадение с доставленными отправлениями.');tr.firstChild.colSpan=5;unmatchedRows.appendChild(tr)}
   const productRows=document.getElementById('reconProductRows');productRows.replaceChildren();
   for(const item of (d.product_fee_summary||[])){const tr=document.createElement('tr');cell(tr,item.fulfillment_type||'Не сопоставлено');cell(tr,item.sku,'muted');cell(tr,item.offer_id||'—');cell(tr,item.label||('ID '+item.type_id));cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.amount),'amount');cell(tr,item.components);productRows.appendChild(tr)}
   if(!(d.product_fee_summary||[]).length){const tr=document.createElement('tr');cell(tr,'В ответе Ozon нет компонентов с явным SKU.');tr.firstChild.colSpan=7;productRows.appendChild(tr)}
   const postingSkuRows=document.getElementById('reconPostingSkuRows');postingSkuRows.replaceChildren();
   for(const item of (d.posting_product_summary||[])){const tr=document.createElement('tr');cell(tr,item.fulfillment_type);cell(tr,item.sku,'muted');cell(tr,item.label||('ID '+item.type_id));cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.amount),'amount');cell(tr,item.records);cell(tr,item.reported_quantity);postingSkuRows.appendChild(tr)}
   if(!(d.posting_product_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Ozon не вернул начислений с явным SKU по отправлениям за период.');tr.firstChild.colSpan=7;postingSkuRows.appendChild(tr)}
   const returnRows=document.getElementById('reconReturnRows');returnRows.replaceChildren();
   for(const item of (d.returns_summary||[])){const tr=document.createElement('tr');cell(tr,item.name||'Товар без названия');cell(tr,item.fulfillment_type);cell(tr,item.sku,'muted');cell(tr,item.return_type);cell(tr,item.quantity);cell(tr,item.currency||'Неизвестна');cell(tr,fmt(item.returned_value)+' · цена для '+fmt(item.priced_quantity)+'/'+fmt(item.quantity)+' шт.','amount');returnRows.appendChild(tr)}
   if(!(d.returns_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Возвраты за период не найдены.');tr.firstChild.colSpan=7;returnRows.appendChild(tr)}
   const attribution=d.returns_attribution||{},matchCounts=document.getElementById('reconReturnMatchCounts');
   if(matchCounts)matchCounts.textContent='Точно сопоставлено: '+fmt(attribution.matched_count)+' · Требуют проверки: '+fmt(attribution.unmatched_count);
   const attributedRows=document.getElementById('reconAttributedReturnRows');if(attributedRows)attributedRows.replaceChildren();
   for(const item of (attribution.summary||[])){const tr=document.createElement('tr');cell(tr,item.fulfillment_type);cell(tr,item.sku,'muted');cell(tr,item.return_type);cell(tr,item.quantity);cell(tr,item.currency||'Не указана');cell(tr,(item.returned_value===null?'Нет цены':fmt(item.returned_value))+' · цена для '+fmt(item.priced_quantity)+' шт.','amount');cell(tr,item.return_records);attributedRows?.appendChild(tr)}
   if(attributedRows&&!(attribution.summary||[]).length){const tr=document.createElement('tr');cell(tr,'Нет возвратов с точным совпадением отправления и SKU.');tr.firstChild.colSpan=7;attributedRows.appendChild(tr)}
   const unmatchedReturnRows=document.getElementById('reconUnmatchedReturnRows');if(unmatchedReturnRows)unmatchedReturnRows.replaceChildren();
   const reasonLabels={missing_posting_number:'Нет номера отправления',missing_sku:'Нет SKU',posting_not_in_delivered_period:'Отправление не найдено среди доставленных за период',sku_not_in_posting:'SKU отсутствует в составе отправления'};
   for(const item of (attribution.unmatched_events||[])){const tr=document.createElement('tr');cell(tr,item.return_id||'—');cell(tr,item.posting_number||'—');cell(tr,item.sku||'—','muted');cell(tr,reasonLabels[item.unmatched_reason]||item.unmatched_reason||'Причина не указана');cell(tr,item.quantity);cell(tr,item.currency||'Не указана');cell(tr,item.returned_value===null?'Нет цены':fmt(item.returned_value),'amount');unmatchedReturnRows?.appendChild(tr)}
   if(unmatchedReturnRows&&!(attribution.unmatched_events||[]).length){const tr=document.createElement('tr');cell(tr,'Несопоставленных возвратов нет.');tr.firstChild.colSpan=7;unmatchedReturnRows.appendChild(tr)}
   document.getElementById('reconReturnCount').textContent=fmt(d.return_record_count);
   const moneyRows=document.getElementById('reconMoneyRows');moneyRows.replaceChildren();
   const moneyMetrics=d.metrics||{},totalByCurrency=moneyMetrics.total_component_amount_by_currency||{},knownByCurrency=moneyMetrics.known_type_amount_by_currency||{},unknownByCurrency=moneyMetrics.unknown_type_amount_by_currency||{},matchedByCurrency=moneyMetrics.matched_amount_by_currency||{};
   const currencies=[...new Set([...Object.keys(totalByCurrency),...Object.keys(knownByCurrency),...Object.keys(unknownByCurrency),...Object.keys(matchedByCurrency)])].sort();
   const moneyFmt=value=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
   for(const currency of currencies){const total=Number(totalByCurrency[currency]||0),matched=Number(matchedByCurrency[currency]||0),tr=document.createElement('tr');cell(tr,currency==='UNKNOWN_CURRENCY'?'Валюта не указана':currency);cell(tr,moneyFmt(total),'amount');cell(tr,moneyFmt(knownByCurrency[currency]||0),'amount');cell(tr,moneyFmt(unknownByCurrency[currency]||0),'amount');cell(tr,moneyFmt(matched),'amount');cell(tr,moneyFmt(total-matched),'amount');moneyRows.appendChild(tr)}
   if(!currencies.length){const tr=document.createElement('tr');cell(tr,'Нет денежных компонентов за выбранный период.');tr.firstChild.colSpan=6;moneyRows.appendChild(tr)}
   const m=d.metrics||{};document.getElementById('reconCount').textContent=fmt(m.component_count);document.getElementById('reconKnown').textContent=fmt(m.known_type_count);document.getElementById('reconUnknown').textContent=fmt(m.unknown_type_count);document.getElementById('reconRecords').textContent=fmt(d.source_records);document.getElementById('reconMatch').textContent=fmt(m.posting_match_percent)+'%';document.getElementById('reconUnmatched').textContent=fmt(m.posting_unmatched_count);document.getElementById('reconSku').textContent=fmt(m.sku_attributed_count);
   status.textContent='Получено · '+d.period.date_from+' — '+d.period.date_to+' · доставленных отправлений: '+fmt(d.delivered_posting_count)+' · типы из справочника: '+Object.keys(d.dictionary||{}).length;
   window.dispatchEvent(new CustomEvent('ozon:finance-reconciliation-loaded',{detail:d}));
  }catch(e){status.textContent=e.message;status.classList.add('error')}
  finally{btn.disabled=false;btn.textContent='Сверить период'}
 }
 btn.addEventListener('click',load);
})();
