(function setupReconciliation(){
 const from=document.getElementById('reconFrom'),to=document.getElementById('reconTo'),btn=document.getElementById('reconLoad'),status=document.getElementById('reconStatus'),rows=document.getElementById('reconRows');
 if(!from||!to||!btn)return;
 const today=new Date(),end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())),start=new Date(end);start.setUTCDate(start.getUTCDate()-6);
 from.value=start.toISOString().slice(0,10);to.value=end.toISOString().slice(0,10);
 const fmt=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(n)||0);
 function cell(tr,v,cls){const td=document.createElement('td');td.textContent=String(v??'—');if(cls)td.className=cls;tr.appendChild(td)}
 async function load(){
  if(!from.value||!to.value||to.value<from.value){status.textContent='Проверь даты.';status.classList.add('error');return}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;if(days>30){status.textContent='Период не должен превышать 31 день.';status.classList.add('error');return}
  btn.disabled=true;btn.textContent='Сверяю…';status.classList.remove('error');status.textContent='Последовательно запрашиваю финансовый API Ozon…';
  try{
   const r=await fetch('/api/finance/reconciliation?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value),{headers:{Accept:'application/json'}}),d=await r.json();if(!r.ok)throw new Error(d.detail||'Ошибка финансового API');
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
   document.getElementById('reconReturnCount').textContent=fmt(d.return_record_count);
   const moneyRows=document.getElementById('reconMoneyRows');moneyRows.replaceChildren();
   const moneyMetrics=d.metrics||{},totalByCurrency=moneyMetrics.total_component_amount_by_currency||{},knownByCurrency=moneyMetrics.known_type_amount_by_currency||{},unknownByCurrency=moneyMetrics.unknown_type_amount_by_currency||{},matchedByCurrency=moneyMetrics.matched_amount_by_currency||{};
   const currencies=[...new Set([...Object.keys(totalByCurrency),...Object.keys(knownByCurrency),...Object.keys(unknownByCurrency),...Object.keys(matchedByCurrency)])].sort();
   const moneyFmt=value=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
   for(const currency of currencies){const total=Number(totalByCurrency[currency]||0),matched=Number(matchedByCurrency[currency]||0),tr=document.createElement('tr');cell(tr,currency==='UNKNOWN_CURRENCY'?'Валюта не указана':currency);cell(tr,moneyFmt(total),'amount');cell(tr,moneyFmt(knownByCurrency[currency]||0),'amount');cell(tr,moneyFmt(unknownByCurrency[currency]||0),'amount');cell(tr,moneyFmt(matched),'amount');cell(tr,moneyFmt(total-matched),'amount');moneyRows.appendChild(tr)}
   if(!currencies.length){const tr=document.createElement('tr');cell(tr,'Нет денежных компонентов за выбранный период.');tr.firstChild.colSpan=6;moneyRows.appendChild(tr)}
   const m=d.metrics||{};document.getElementById('reconCount').textContent=fmt(m.component_count);document.getElementById('reconKnown').textContent=fmt(m.known_type_count);document.getElementById('reconUnknown').textContent=fmt(m.unknown_type_count);document.getElementById('reconRecords').textContent=fmt(d.source_records);document.getElementById('reconMatch').textContent=fmt(m.posting_match_percent)+'%';document.getElementById('reconUnmatched').textContent=fmt(m.posting_unmatched_count);document.getElementById('reconSku').textContent=fmt(m.sku_attributed_count);
   status.textContent='Получено · '+d.period.date_from+' — '+d.period.date_to+' · доставленных отправлений: '+fmt(d.delivered_posting_count)+' · типы из справочника: '+Object.keys(d.dictionary||{}).length;
  }catch(e){status.textContent=e.message;status.classList.add('error')}
  finally{btn.disabled=false;btn.textContent='Сверить период'}
 }
 btn.addEventListener('click',load);
})();
