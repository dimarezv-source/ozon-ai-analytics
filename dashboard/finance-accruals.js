(function setupFinanceAccruals(){
 const panel=document.getElementById('financeAccrualPanel');if(!panel)return;
 const from=document.getElementById('accrualFrom'),to=document.getElementById('accrualTo'),button=document.getElementById('accrualLoad');
 const status=document.getElementById('accrualStatus'),summary=document.getElementById('accrualSummary'),tbody=document.getElementById('accrualRows');
 const feeSummaryRows=document.getElementById('accrualFeeSummaryRows');
 const postingSummaryRows=document.getElementById('accrualPostingSummaryRows');
 const utcToday=new Date();const fmt=d=>d.toISOString().slice(0,10);
 const end=new Date(Date.UTC(utcToday.getUTCFullYear(),utcToday.getUTCMonth(),utcToday.getUTCDate()));
 const start=new Date(end);start.setUTCDate(start.getUTCDate()-6);from.value=fmt(start);to.value=fmt(end);
 const safe=v=>v===null||v===undefined||v===''?'—':String(v);
 const numberFormat=v=>new Intl.NumberFormat('ru-RU').format(Number(v)||0);
 const money=v=>{if(!v||typeof v!=='object'||!('amount'in v))return null;return safe(v.amount)+' '+safe(v.currency)};
 function inspectRecord(record){
  const amounts=[],typeIds=new Set();
  function walk(value,path){
   if(Array.isArray(value)){value.forEach((item,index)=>walk(item,path+'['+index+']'));return}
   if(!value||typeof value!=='object')return;
   const formatted=money(value);
   if(formatted){amounts.push(path+': '+formatted);return}
   const hasTypedAccrued=value.type_id!==undefined&&value.accrued&&typeof value.accrued==='object'&&'amount'in value.accrued;
   for(const [key,child] of Object.entries(value)){
    if(key==='fee_components'||(hasTypedAccrued&&key==='accrued'))continue;
    if(key==='type_id'&&child!==null&&child!==undefined)typeIds.add(String(child));
    walk(child,path?path+'.'+key:key);
   }
  }
  walk(record,'');
  return {amounts,typeIds:[...typeIds]};
 }
 function components(record,types){
  const paired=Array.isArray(record.fee_components)?record.fee_components:[];
  const found=inspectRecord(record);
  const feeLines=paired.map(item=>{
   const type=types[String(item.type_id)]||{};
   const label=type.description||type.name||('Тип ID '+item.type_id);
   return label+': '+safe(item.amount)+' '+safe(item.currency);
  });
  const lines=[...feeLines,...found.amounts];
  return lines.length?lines.join('\n'):'Суммы не распознаны — смотри исходную запись';
 }
 function cell(tr,value,className){const td=document.createElement('td');td.textContent=value;if(className)td.className=className;tr.appendChild(td);return td}
 async function load(){
  if(!from.value||!to.value){status.textContent='Укажи обе даты.';status.classList.add('error');return}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;
  if(days<0||days>30){status.textContent='Период должен быть от 1 до 31 дня.';status.classList.add('error');return}
  button.disabled=true;button.textContent='Загружаю…';status.classList.remove('error');status.textContent='Запрашиваю начисления Ozon…';
  try{
   const response=await fetch('/api/finance/accruals?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value),{headers:{Accept:'application/json'}});
   const data=await response.json();if(!response.ok)throw new Error(data.detail||'Не удалось получить начисления.');
   let fulfillmentByPosting={},reconciliationWarning='';
   try{
    const salesResponse=await fetch('/api/sales?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value),{headers:{Accept:'application/json'}});
    if(!salesResponse.ok)throw new Error('HTTP '+salesResponse.status);
    const salesData=await salesResponse.json();
    for(const item of (salesData.delivered_posting_refs||[])){
     if(item&&item.posting_number&&['FBO','FBS'].includes(item.fulfillment_type))fulfillmentByPosting[item.posting_number]=item.fulfillment_type;
    }
   }catch(_){reconciliationWarning=' Не удалось загрузить продажи для определения FBO/FBS: схема в таблице не подтверждена.';}
   const types=data.accrual_types||{};tbody.replaceChildren();feeSummaryRows.replaceChildren();postingSummaryRows.replaceChildren();
   for(const item of (data.posting_fee_summary||[])){
    const tr=document.createElement('tr');const type=types[String(item.type_id)]||{};
    cell(tr,fulfillmentByPosting[item.posting_number]||'Не сопоставлено');cell(tr,safe(item.posting_number));cell(tr,type.description||type.name||('Тип ID '+item.type_id));
    cell(tr,String(item.type_id),'muted');cell(tr,safe(item.currency));cell(tr,safe(item.amount),'amount');
    cell(tr,numberFormat(item.count));postingSummaryRows.appendChild(tr);
   }
   if(!(data.posting_fee_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Нет начислений с явным номером отправления.');tr.firstChild.colSpan=7;postingSummaryRows.appendChild(tr)}
   
   for(const item of (data.fee_summary||[])){
    const tr=document.createElement('tr');const type=types[String(item.type_id)]||{};
    cell(tr,type.description||type.name||('Тип ID '+item.type_id));
    cell(tr,String(item.type_id),'muted');cell(tr,safe(item.currency));
    cell(tr,safe(item.amount),'amount');cell(tr,numberFormat(item.count));feeSummaryRows.appendChild(tr);
   }
   if(!(data.fee_summary||[]).length){const tr=document.createElement('tr');cell(tr,'Нет компонентов для сводки.');tr.firstChild.colSpan=5;feeSummaryRows.appendChild(tr)}

   for(const record of (data.accruals||[])){
    const tr=document.createElement('tr');
    const found=inspectRecord(record);
    const directType=record.operation_type_id??record.accrual_type_id??record.type_id??null;
    if(directType!==null)found.typeIds.unshift(String(directType));
    const uniqueTypeIds=[...new Set(found.typeIds)];
    const typeLabels=uniqueTypeIds.map(id=>types[id]?.name||('ID '+id));
    cell(tr,safe(record.date));
    cell(tr,safe(record.accrued_category||record.category||'—'));
    const typeCell=cell(tr,typeLabels.length?typeLabels.join(', '):safe(record.operation_type_name||record.operation_name||'—'));
    if(uniqueTypeIds.some(id=>!types[id]?.name))typeCell.title='Часть типов отсутствует в справочнике Ozon: '+uniqueTypeIds.filter(id=>!types[id]?.name).join(', ');
    cell(tr,components(record,types),'amount');
    const detail=cell(tr,'');const details=document.createElement('details');const summaryEl=document.createElement('summary');summaryEl.textContent='Показать JSON';const pre=document.createElement('pre');pre.className='accrual-json';pre.textContent=JSON.stringify(record,null,2);details.append(summaryEl,pre);detail.appendChild(details);
    tbody.appendChild(tr);
   }
   if(!(data.accruals||[]).length){const tr=document.createElement('tr');cell(tr,'За этот период начислений не найдено.');tr.firstChild.colSpan=5;tbody.appendChild(tr)}
   summary.textContent='Записей: '+(data.record_count??(data.accruals||[]).length)+' · период: '+data.period.date_from+' — '+data.period.date_to+' · справочник типов: '+Object.keys(types).length;
   status.textContent='Загружено из Ozon.'+reconciliationWarning;
  }catch(error){status.textContent=error.message;status.classList.add('error')}
  finally{button.disabled=false;button.textContent='Загрузить начисления'}
 }
 button.addEventListener('click',load);
})();
