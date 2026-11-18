(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0);
 const fmtDays=value=>Number.isFinite(value)?(value<1?'< 1 дня':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value)+' дн.'):'—';
 const state={products:[],sales:null,stock:null,loading:false,leadDays:0,safetyDays:0,frozenThresholdDays:60,replenishmentItems:[],clearanceItems:[]};
 const SETTINGS_KEY='ozonInventoryReplenishmentSettings';
 const COSTS_KEY='ozon-ai-analytics-costs-v1';
 const money=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(value)||0))+' ₽';
 function calculateFrozenStock(items,costs,thresholdDays){
  const result={items:[],frozenUnits:0,frozenValue:0,knownValueItems:0,missingCostItems:0,FBO:0,FBS:0};
  const threshold=Math.max(1,Number(thresholdDays)||60);
  for(const item of items||[]){
   const available=Math.max(0,Number(item.available)||0);if(!available)continue;
   const sold=Math.max(0,Number(item.sold)||0),days=Math.max(0,Number(item.periodDays)||0);
   const noSales=days>0&&sold===0,coverage=days>0&&sold>0?available/(sold/days):null;
   if(!noSales&&!(coverage!==null&&coverage>threshold))continue;
   const saved=(costs||{})[item.costKey]||{},raw=saved.cost,known=saved.costConfigured===true||(raw!==null&&raw!==undefined&&raw!==''&&Number(raw)>0),cost=Number(raw);
   const costKnown=known&&Number.isFinite(cost)&&cost>=0,value=costKnown?available*cost:null;
   result.items.push({...item,available,sold,coverage,costKnown,unitCost:costKnown?cost:null,frozenValue:value,reason:noSales?'Нет продаж за выбранный период':'Покрытие больше '+threshold+' дн.'});
   result.frozenUnits+=available;
   if(costKnown){result.frozenValue+=value;result.knownValueItems++;if(item.type==='FBO'||item.type==='FBS')result[item.type]+=value}else result.missingCostItems++;
  }
  result.items.sort((a,b)=>(b.frozenValue??-1)-(a.frozenValue??-1)||b.available-a.available||a.name.localeCompare(b.name,'ru'));
  return result;
 }
 function calculateClearanceRanking(items){
  return (items||[]).map(item=>({...item})).sort((a,b)=>{
   if(a.costKnown!==b.costKnown)return a.costKnown?-1:1;
   if(a.costKnown&&b.costKnown&&(b.frozenValue??0)!==(a.frozenValue??0))return (b.frozenValue??0)-(a.frozenValue??0);
   const ac=a.coverage===null?Infinity:Number(a.coverage)||0,bc=b.coverage===null?Infinity:Number(b.coverage)||0;
   return bc-ac||b.available-a.available||String(a.name||'').localeCompare(String(b.name||''),'ru');
  }).map((item,index)=>({...item,rank:index+1}));
 }
 function calculateProcurementBudget(items,costs){
  const result={knownBudget:0,missingCostItems:0,knownUnits:0,unknownUnits:0,FBO:0,FBS:0};
  for(const item of items||[]){
   const units=Math.max(0,Number(item.result&&item.result.recommended)||0);if(!units)continue;
   const saved=(costs||{})[item.costKey]||{};
   const raw=saved.cost,known=saved.costConfigured===true||(raw!==null&&raw!==undefined&&raw!==''&&Number(raw)>0);
   const cost=Number(raw);
   if(!known||!Number.isFinite(cost)||cost<0){result.missingCostItems++;result.unknownUnits+=units;continue;}
   const amount=cost*units;result.knownBudget+=amount;result.knownUnits+=units;
   if(item.type==='FBO'||item.type==='FBS')result[item.type]+=amount;
  }
  return result;
 }
 root.OzonInventoryPlanner={calculateReplenishment,calculateProcurementBudget,calculateFrozenStock,calculateClearanceRanking};
 function matches(a,b){
  for(const field of ['sku','product_id','offer_id']){
   const x=a&&a[field],y=b&&b[field];
   if(x!==null&&x!==undefined&&y!==null&&y!==undefined&&String(x)!==''&&String(x)===String(y))return true;
  }
  return false;
 }
 function periodDays(){
  const p=state.sales&&state.sales.period;if(!p)return 0;
  const a=Date.parse(p.date_from+'T00:00:00Z'),b=Date.parse(p.date_to+'T00:00:00Z');
  return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.floor((b-a)/86400000)+1:0;
 }
 function unitsSold(product,schema){
  return (state.sales&&Array.isArray(state.sales.products)?state.sales.products:[])
   .filter(row=>String(row.fulfillment_type||'').toUpperCase()===schema&&matches(product,row))
   .reduce((sum,row)=>sum+Math.max(0,Number(row.units)||0),0);
 }
 function calculateReplenishment(input){
  const available=Math.max(0,Number(input.available)||0),dailySales=Number(input.dailySales),leadDays=Math.max(0,Number(input.leadDays)||0),safetyDays=Math.max(0,Number(input.safetyDays)||0);
  if(!Number.isFinite(dailySales)||dailySales<=0)return {ok:false,reason:'no_sales',available,daysCover:null,targetDays:leadDays+safetyDays,recommended: null};
  const daysCover=available/dailySales,targetDays=leadDays+safetyDays;
  const recommended=Math.max(0,Math.ceil(dailySales*targetDays-available));
  return {ok:true,available,dailySales,daysCover,targetDays,recommended,priority:available===0?'critical':daysCover<=leadDays?'urgent':daysCover<=targetDays?'soon':'normal'};
 }
 root.OzonInventoryPlanner={calculateReplenishment,calculateProcurementBudget,calculateFrozenStock,calculateClearanceRanking};
 function loadSettings(){
  try{const v=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'{}');state.leadDays=Math.max(0,Number(v.leadDays)||0);state.safetyDays=Math.max(0,Number(v.safetyDays)||0);state.frozenThresholdDays=Math.min(3650,Math.max(1,Number(v.frozenThresholdDays)||60))}catch(_){}
  const lead=el('replenishmentLeadDays'),safety=el('replenishmentSafetyDays'),threshold=el('frozenThresholdDays');
  if(lead)lead.value=String(state.leadDays);if(safety)safety.value=String(state.safetyDays);if(threshold)threshold.value=String(state.frozenThresholdDays);
 }
 function saveSettings(){
  const lead=el('replenishmentLeadDays'),safety=el('replenishmentSafetyDays');
  state.leadDays=Math.max(0,Number(lead&&lead.value)||0);state.safetyDays=Math.max(0,Number(safety&&safety.value)||0);
  const threshold=el('frozenThresholdDays');state.frozenThresholdDays=Math.min(3650,Math.max(1,Number(threshold&&threshold.value)||60));
  try{localStorage.setItem(SETTINGS_KEY,JSON.stringify({leadDays:state.leadDays,safetyDays:state.safetyDays,frozenThresholdDays:state.frozenThresholdDays}))}catch(_){}
  render();
 }
 function renderReplenishment(products){
  const body=el('replenishmentRows');if(!body)return;body.replaceChildren();
  const days=periodDays(),items=[];
  if(days>0){
   for(const product of products){
    const catalog=state.products.find(item=>matches(product,item));
    const name=(catalog&&catalog.name)||product.name||product.offer_id||('Товар '+(product.product_id??''));
    for(const stock of (product.stocks||[])){
     const type=String(stock.type||'').toUpperCase();if(type!=='FBO'&&type!=='FBS')continue;
     const present=Math.max(0,Number(stock.present)||0),reserved=Math.max(0,Number(stock.reserved)||0),available=Math.max(0,present-reserved);
     const sold=unitsSold(product,type),daily=sold/days;
     const result=calculateReplenishment({available,dailySales:daily,leadDays:state.leadDays,safetyDays:state.safetyDays});
     items.push({name,type,available,result,sku:product.sku||'',offer:product.offer_id||'',costKey:String(product.product_id||product.sku||product.offer_id||'unknown')});
    }
   }
  }
  const rank={critical:0,urgent:1,soon:2,normal:3};
  items.sort((a,b)=>{
   const ar=a.result.ok?rank[a.result.priority]:4,br=b.result.ok?rank[b.result.priority]:4;
   return ar-br||(a.result.daysCover??Infinity)-(b.result.daysCover??Infinity)||a.name.localeCompare(b.name,'ru');
  });
  state.replenishmentItems=items.filter(item=>item.result.ok&&item.result.recommended>0);
  const totalUnits=state.replenishmentItems.reduce((sum,item)=>sum+item.result.recommended,0);
  const fboUnits=state.replenishmentItems.filter(item=>item.type==='FBO').reduce((sum,item)=>sum+item.result.recommended,0);
  const fbsUnits=state.replenishmentItems.filter(item=>item.type==='FBS').reduce((sum,item)=>sum+item.result.recommended,0);
  const urgentCount=state.replenishmentItems.filter(item=>item.result.priority==='critical'||item.result.priority==='urgent').length;
  let savedCosts={};try{savedCosts=JSON.parse(localStorage.getItem(COSTS_KEY)||'{}')}catch(_){}
  const budget=calculateProcurementBudget(state.replenishmentItems,savedCosts);
  [['replenishmentSkuCount',state.replenishmentItems.length],['replenishmentUnitCount',totalUnits],['replenishmentFboCount',fboUnits],['replenishmentFbsCount',fbsUnits],['replenishmentUrgentCount',urgentCount],['replenishmentBudgetValue',money(budget.knownBudget)],['replenishmentBudgetMissing',budget.missingCostItems+' поз. без себестоимости']].forEach(([id,value])=>{const node=el(id);if(node)node.textContent=value});
  const exportButton=el('replenishmentExport');if(exportButton)exportButton.disabled=state.replenishmentItems.length===0;
  for(const item of items){
   const tr=document.createElement('tr');
   const label=item.name+' · '+(item.sku?'SKU '+item.sku:item.offer);
   const r=item.result;
   const recommendation=!r.ok?'Нет данных':r.recommended===0?'Пока не требуется':number(r.recommended)+' шт.';
   const priority=!r.ok?'Недостаточно данных':r.priority==='critical'?'Критично':r.priority==='urgent'?'Срочно':r.priority==='soon'?'Подготовить':'Запас достаточный';
   const values=[label,item.type,number(item.available),r.ok?fmtDays(r.daysCover):'—',r.ok?number(r.dailySales.toFixed(1))+' шт./день':'—',recommendation,priority];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index>=2)td.className='num';if(index===5&&r.ok&&r.recommended>0)td.classList.add('replenishment-qty');tr.appendChild(td)});
   body.appendChild(tr);
  }
  if(!days||!items.length){
   const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;
   td.textContent=!days?'Сначала выбери период и загрузи продажи — расчёт пополнения появится здесь.':'Нет позиций FBO/FBS для расчёта.';
   td.className='hint';tr.appendChild(td);body.appendChild(tr);
  }
  renderFrozenStock(products,days);
  const summary=el('replenishmentSummary');
  if(summary)summary.textContent=days?'Расчёт по '+days+' дн. продаж · срок поставки: '+number(state.leadDays)+' дн. · страховой запас: '+number(state.safetyDays)+' дн.':'Ожидаем данные продаж за выбранный период.';
 }
 function exportReplenishment(){
  const items=state.replenishmentItems;if(!items.length)return;
  const period=state.sales&&state.sales.period||{};
  let savedCosts={};try{savedCosts=JSON.parse(localStorage.getItem(COSTS_KEY)||'{}')}catch(_){}
  const rows=[['Товар','SKU','Offer ID','Схема','Доступно, шт.','Продажи в день, шт.','Покрытие, дней','Срок поставки, дней','Страховой запас, дней','Рекомендуемый заказ, шт.','Себестоимость за единицу, ₽','Бюджет закупки, ₽','Приоритет']];
  const priority={critical:'Критично',urgent:'Срочно',soon:'Подготовить',normal:'Запас достаточный'};
  items.forEach(item=>{const saved=savedCosts[item.costKey]||{},raw=saved.cost,known=saved.costConfigured===true||(raw!==null&&raw!==undefined&&raw!==''&&Number(raw)>0),cost=Number(raw);const valid=known&&Number.isFinite(cost)&&cost>=0;rows.push([item.name,item.sku,item.offer,item.type,item.available,Number(item.result.dailySales.toFixed(2)),Number(item.result.daysCover.toFixed(1)),state.leadDays,state.safetyDays,item.result.recommended,valid?cost:'',valid?Math.round(cost*item.result.recommended):'',priority[item.result.priority]||''])});
  const csv='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='ozon-plan-popolneniya-'+(period.date_from||'period')+'-'+(period.date_to||'')+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 function renderFrozenStock(products,days){
  const body=el('frozenStockRows');if(!body)return;body.replaceChildren();
  if(!days){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='Выбери период и загрузи продажи — тогда можно оценить залежавшийся остаток.';td.className='hint';tr.appendChild(td);body.appendChild(tr);return}
  let savedCosts={};try{savedCosts=JSON.parse(localStorage.getItem(COSTS_KEY)||'{}')}catch(_){}
  const rows=[];
  for(const product of products||[]){
   const catalog=state.products.find(item=>matches(product,item));
   const name=(catalog&&catalog.name)||product.name||product.offer_id||('Товар '+(product.product_id??''));
   const costKey=String(product.product_id||product.sku||product.offer_id||'unknown');
   for(const stock of product.stocks||[]){
    const type=String(stock.type||'').toUpperCase();if(type!=='FBO'&&type!=='FBS')continue;
    const present=Math.max(0,Number(stock.present)||0),reserved=Math.max(0,Number(stock.reserved)||0),available=Math.max(0,present-reserved);
    rows.push({name,type,available,sold:unitsSold(product,type),periodDays:days,costKey,sku:product.sku||'',offer:product.offer_id||''});
   }
  }
  const result=calculateFrozenStock(rows,savedCosts,state.frozenThresholdDays);
  const clearance=calculateClearanceRanking(result.items);state.clearanceItems=clearance;
  [['frozenValue',money(result.frozenValue)],['frozenUnits',number(result.frozenUnits)],['frozenPositions',number(result.items.length)],['frozenMissingCosts',number(result.missingCostItems)],['frozenFboValue',money(result.FBO)],['frozenFbsValue',money(result.FBS)]].forEach(([id,value])=>{const node=el(id);if(node)node.textContent=value});
  const clearanceBody=el('clearanceRows');if(clearanceBody){clearanceBody.replaceChildren();for(const item of clearance){
   const tr=document.createElement('tr');const values=[item.rank,item.name+' · '+(item.sku?'SKU '+item.sku:item.offer),item.type,number(item.available),item.coverage===null?'Нет продаж':fmtDays(item.coverage),item.costKnown?money(item.unitCost):'Не указана',item.costKnown?money(item.frozenValue):'Не рассчитано',item.costKnown?'Приоритет распродажи':'Уточнить себестоимость'];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===0||index>=3&&index<=6)td.className='num';if(index===7&&!item.costKnown)td.className='hint';tr.appendChild(td)});clearanceBody.appendChild(tr);
  }if(!clearance.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='Нет товаров для приоритетной распродажи по выбранному порогу.';td.className='hint';tr.appendChild(td);clearanceBody.appendChild(tr)}}
  const clearanceExport=el('clearanceExport');if(clearanceExport)clearanceExport.disabled=!clearance.length;
  const clearanceCount=el('clearanceCount');if(clearanceCount)clearanceCount.textContent=number(clearance.length);
  const clearanceCapital=el('clearanceCapital');if(clearanceCapital)clearanceCapital.textContent=money(clearance.reduce((sum,item)=>sum+(item.costKnown?item.frozenValue:0),0));
  const clearanceUnknown=el('clearanceUnknown');if(clearanceUnknown)clearanceUnknown.textContent=number(clearance.filter(item=>!item.costKnown).length);
  for(const item of result.items){
   const tr=document.createElement('tr'),label=item.name+' · '+(item.sku?'SKU '+item.sku:item.offer);
   const values=[label,item.type,number(item.available),number(item.sold),item.coverage===null?'Нет продаж':fmtDays(item.coverage),item.costKnown?money(item.unitCost):'Не указана',item.costKnown?money(item.frozenValue):'Не рассчитано',item.reason];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index>=2&&index<=6)td.className='num';if(index===6&&item.costKnown)td.classList.add('frozen-value');tr.appendChild(td)});
   body.appendChild(tr);
  }
  if(!result.items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=8;td.textContent='По выбранному порогу залежавшихся остатков не найдено.';td.className='hint';tr.appendChild(td);body.appendChild(tr)}
  const note=el('frozenStockNote');if(note)note.textContent='Проверка по '+days+' дн. продаж. Залежавшимся считается остаток без продаж за выбранный период или с покрытием более '+state.frozenThresholdDays+' дн. Сумма учитывает только заполненную себестоимость; резерв вычтен.';
 }
 function exportClearance(){
  const items=state.clearanceItems||[];if(!items.length)return;
  const rows=[['Место','Товар','SKU','Offer ID','Схема','Доступно, шт.','Продано за период, шт.','Покрытие, дней','Себестоимость / шт., ₽','Связано денег, ₽','Рекомендация']];
  items.forEach(item=>rows.push([item.rank,item.name,item.sku||'',item.offer||'',item.type,item.available,item.sold,item.coverage===null?'':Number(item.coverage.toFixed(1)),item.costKnown?item.unitCost:'',item.costKnown?Math.round(item.frozenValue):'',item.costKnown?'Приоритет распродажи':'Уточнить себестоимость']));
  const csv='\\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(';')).join('\\r\\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='ozon-prioritet-rasprodazhi.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 }
 function render(){
  if(!state.stock)return;
  const products=Array.isArray(state.stock.products)?state.stock.products:[];
  const body=el('inventoryRows');if(!body)return;body.replaceChildren();
  const totals={FBO:0,FBS:0,reserved:0,empty:0},display=[];
  for(const product of products){
   const catalog=state.products.find(item=>matches(product,item));
   const name=(catalog&&catalog.name)||product.name||product.offer_id||('Товар '+(product.product_id??''));
   for(const stock of (product.stocks||[])){
    const type=String(stock.type||'').toUpperCase();if(type!=='FBO'&&type!=='FBS')continue;
    const present=Math.max(0,Number(stock.present)||0),reserved=Math.max(0,Number(stock.reserved)||0),available=Math.max(0,present-reserved);
    const days=periodDays(),sold=unitsSold(product,type),daily=days?sold/days:0,coverage=daily>0?available/daily:NaN;
    let signal='Нет продаж для оценки',level='unknown';
    if(available===0){signal='Нет остатка';level='critical'}
    else if(Number.isFinite(coverage)&&coverage<=7){signal='Скоро закончится';level='warning'}
    else if(Number.isFinite(coverage)){signal='Запас есть';level='ok'}
    else{signal='Остаток есть';level='unknown'}
    totals[type]+=available;totals.reserved+=reserved;if(available===0)totals.empty++;
    display.push({name,type,present,reserved,available,coverage,signal,level,sku:product.sku||'',offer:product.offer_id||''});
   }
  }
  const rank={critical:0,warning:1,unknown:2,ok:3};
  display.sort((a,b)=>rank[a.level]-rank[b.level]||(a.coverage??Infinity)-(b.coverage??Infinity)||a.name.localeCompare(b.name,'ru'));
  for(const item of display){
   const tr=document.createElement('tr');
   const values=[item.name+' · '+(item.sku?'SKU '+item.sku:item.offer),item.type,number(item.present),number(item.reserved),number(item.available),fmtDays(item.coverage)];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index>=2)td.className='num';tr.appendChild(td)});
   const td=document.createElement('td'),badge=document.createElement('span');badge.className='stock-signal '+item.level;badge.textContent=item.signal;td.appendChild(badge);tr.appendChild(td);body.appendChild(tr);
  }
  if(!display.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.textContent='Ozon не вернул остатки FBO/FBS для текущего каталога.';td.className='hint';tr.appendChild(td);body.appendChild(tr)}
  el('stockFbo').textContent=number(totals.FBO);el('stockFbs').textContent=number(totals.FBS);
  el('stockReserved').textContent=number(totals.reserved);el('stockEmpty').textContent=number(totals.empty);
  const days=periodDays();
  el('inventoryStatus').textContent='Обновлено: '+new Date().toLocaleString('ru-RU')+' · товаров: '+products.length+' · '+(days?'скорость продаж рассчитана за '+days+' дн.':'загрузи продажи за период для оценки покрытия');
  renderReplenishment(products);
  root.dispatchEvent(new CustomEvent('ozon:inventory-updated',{detail:{
   items:display.filter(item=>item.level==='critical'||item.level==='warning').map(item=>({
    name:item.name,type:item.type,sku:item.sku,available:item.available,coverage:item.coverage,level:item.level
   })),
   totals:{FBO:totals.FBO,FBS:totals.FBS,reserved:totals.reserved,empty:totals.empty},
   updatedAt:new Date().toISOString()
  }}));
 }
 async function load(){
  if(state.loading)return;state.loading=true;
  const button=el('inventoryRefresh'),status=el('inventoryStatus');
  if(button){button.disabled=true;button.textContent='Загрузка…'}
  status.textContent='Запрашиваю остатки FBO/FBS из Ozon…';status.classList.remove('error');
  try{
   const response=await fetch('/api/stocks',{headers:{Accept:'application/json'}});
   const data=await response.json();if(!response.ok)throw new Error(data.detail||'Не удалось получить остатки');
   if(data.status!=='ok'||!Array.isArray(data.products))throw new Error('Некорректный ответ Ozon');
   state.stock=data;render();
  }catch(error){status.textContent=String(error.message||'Ошибка загрузки остатков');status.classList.add('error')}
  finally{state.loading=false;if(button){button.disabled=false;button.textContent='Обновить остатки'}}
 }
 loadSettings();
 ['replenishmentLeadDays','replenishmentSafetyDays','frozenThresholdDays'].forEach(id=>{const input=el(id);if(input)input.addEventListener('change',saveSettings)});
 root.addEventListener('ozon:catalog-loaded',event=>{state.products=Array.isArray(event.detail)?event.detail:[];if(!state.stock)load();else render()});
 root.addEventListener('ozon:sales-loaded',event=>{state.sales=event.detail||null;render()});
 root.addEventListener('ozon:costs-updated',()=>render());
 const button=el('inventoryRefresh');if(button)button.addEventListener('click',load);
 const exportButton=el('replenishmentExport');if(exportButton)exportButton.addEventListener('click',exportReplenishment);
 const clearanceExport=el('clearanceExport');if(clearanceExport)clearanceExport.addEventListener('click',exportClearance);
})(window);
