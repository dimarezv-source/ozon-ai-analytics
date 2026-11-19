(function(){
 const grid=document.getElementById('productGrid'),status=document.querySelector('.status'),notice=document.getElementById('liveNotice');
 const money=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Math.round(Number(n)||0))+' ₽';
 const pct=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2})+'%':'—';
 const safeKey=p=>String(p.product_id||p.sku||p.offer_id||'unknown');
 const storageKey='ozon-ai-analytics-costs-v1';
 let products=[];
 let periodSales=null;
 function loadCosts(){try{return JSON.parse(localStorage.getItem(storageKey)||'{}')}catch(_){return {}}}
 function saveCosts(){try{localStorage.setItem(storageKey,JSON.stringify(loadCosts()))}catch(_){}}
 function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
 function updatePeriodProfit(){
  const box=document.getElementById('periodProfit');
  if(!box||!periodSales)return;
  const totalUnits=Number(periodSales.delivered_units)||0;
  const rows=Array.isArray(periodSales.products)?periodSales.products:[];
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  if(!totalUnits){
   box.classList.remove('positive','negative');
   set('periodProfitValue','—');set('periodProfitCaption','За выбранный период доставленных продаж нет');
   set('periodProfitMargin','—');set('periodProfitRevenue',money(0));set('periodProfitCoverage','0 из 0 шт.');
   set('periodProfitFbo','—');set('periodProfitFbs','—');set('periodRevenueSplit','—');
   set('periodProfitNote','Когда появятся доставленные заказы, здесь рассчитаем прибыль отдельно для FBO и FBS.');
   renderIntelligence();
   return;
  }
  const catalogById=new Map();
  for(const p of products)for(const field of ['sku','product_id','offer_id']){
   const value=p[field];if(value!==null&&value!==undefined&&String(value)!=='')catalogById.set(field+':'+String(value),p);
  }
  const saved=loadCosts();
  const totals={FBO:{profit:0,revenue:0,units:0},FBS:{profit:0,revenue:0,units:0}};
  let unmatchedUnits=0,missingCostUnits=0,missingTariffUnits=0,unpricedUnits=0,unknownTypeUnits=0;
  for(const sale of rows){
   const units=Math.max(0,Number(sale.units)||0),salesGmv=Math.max(0,Number(sale.sales_gmv)||0);
   if(!units)continue;
   const type=String(sale.fulfillment_type||'').toUpperCase();
   if(!totals[type]){unknownTypeUnits+=units;continue;}
   if(!salesGmv){unpricedUnits+=units;continue;}
   let product=null;
   for(const field of ['sku','product_id','offer_id']){
    const value=sale[field];if(value!==null&&value!==undefined&&String(value)!==''){product=catalogById.get(field+':'+String(value));if(product)break;}
   }
   if(!product){unmatchedUnits+=units;continue;}
   const required=type==='FBO'?['sales_percent_fbo','acquiring','fbo_delivery_to_customer','fbo_transit_min','fbo_transit_max']:['sales_percent_fbs','acquiring','delivery_to_customer','first_mile_min','first_mile_max','transit_min','transit_max'];
   if(required.some(field=>product[field]===null||product[field]===undefined||!Number.isFinite(Number(product[field])))){missingTariffUnits+=units;continue;}
   const unitPrice=salesGmv/units,values=saved[safeKey(product)]||{};
   const costKnown=values.costConfigured===true||(values.cost!==null&&values.cost!==undefined&&values.cost!==''&&Number(values.cost)>0);
   if(!costKnown){missingCostUnits+=units;continue;}
   const cost=values.cost??0,pack=values.pack??0;
   const ads=values.ads??0,transit=values.transit??0;
   const other=values.other??0,taxRate=values.tax??0;
   const calculation=window.OzonProfitCalculator.calculateProfit({
    fulfillmentType:type,unitPrice,product,
    expenses:{cost,pack,ads,transit,other,tax:taxRate}
   });
   if(!calculation.ok){missingTariffUnits+=units;continue;}
   totals[type].profit+=calculation.profit*units;totals[type].revenue+=salesGmv;totals[type].units+=units;
  }
  const profit=totals.FBO.profit+totals.FBS.profit,revenue=totals.FBO.revenue+totals.FBS.revenue;
  const includedUnits=totals.FBO.units+totals.FBS.units,margin=revenue?profit/revenue*100:0;
  box.classList.toggle('positive',profit>0);box.classList.toggle('negative',profit<0);
  set('periodProfitValue',includedUnits?((profit>0?'+':'')+money(profit)):'—');
  set('periodProfitCaption',includedUnits?'За '+periodSales.period.date_from+' — '+periodSales.period.date_to+' · UTC':'Недостаточно данных для расчёта прибыли');
  set('periodProfitMargin',includedUnits?margin.toFixed(1).replace('.',',')+'%':'—');
  set('periodProfitRevenue',money(revenue));
  set('periodProfitCoverage',includedUnits+' из '+totalUnits+' шт. ('+(includedUnits/totalUnits*100).toFixed(0)+'%)');
  set('periodProfitFbo',totals.FBO.units?((totals.FBO.profit>0?'+':'')+money(totals.FBO.profit)):'Нет данных');
  set('periodProfitFbs',totals.FBS.units?((totals.FBS.profit>0?'+':'')+money(totals.FBS.profit)):'Нет данных');
  set('periodRevenueSplit',money(totals.FBO.revenue)+' / '+money(totals.FBS.revenue));
  let note='FBO: комиссия FBO + эквайринг + доставка клиенту + транзит (среднее диапазона). FBS: комиссия FBS + эквайринг + первая миля + доставка клиенту + транзит (среднее диапазона). Себестоимость, упаковка, реклама, дополнительные расходы и ручное налоговое удержание берутся из карточек товара. Это поле не рассчитывает законный налог по режиму.';
  note+=' Для FBO отдельные услуги фулфилмента и хранения не включены, если их нет в доступных тарифах API. Возвраты и фактические начисления не учтены.';
  const excluded=unmatchedUnits+missingCostUnits+missingTariffUnits+unpricedUnits+unknownTypeUnits;
  if(excluded)note+=' Исключено: '+excluded+' шт. — без себестоимости: '+missingCostUnits+', без цены: '+unpricedUnits+', товар не найден: '+unmatchedUnits+', нет тарифа: '+missingTariffUnits+', неизвестная схема: '+unknownTypeUnits+'.';
  set('periodProfitNote',note);
  renderIntelligence();
 }
  function renderIntelligence(){
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  const rows=document.getElementById('intelRows');if(!rows)return;
  if(!periodSales||!window.OzonIntelligence||!window.OzonProfitCalculator){
   set('intelProfit','—');set('intelProducts','—');set('intelCoverage','—');set('intelLosses','—');
   rows.innerHTML='<tr><td colspan="7" class="hint">Загрузи продажи за выбранный период.</td></tr>';return;
  }
  const ranking=window.OzonIntelligence.buildProductRanking(periodSales,products,loadCosts(),window.OzonProfitCalculator);
  set('intelProfit',ranking.includedUnits?((ranking.estimatedProfit>0?'+':'')+money(ranking.estimatedProfit)):'—');
  set('intelProducts',String(ranking.items.length));
  set('intelCoverage',ranking.coveragePercent.toLocaleString('ru-RU',{maximumFractionDigits:1})+'%');
  set('intelLosses',String(ranking.items.filter(item=>item.profit<0).length));
  rows.replaceChildren();
  for(const item of ranking.items){
   const tr=document.createElement('tr');
   const values=[item.name+' · SKU '+(item.sku??'—'),item.fulfillmentType,String(item.units),money(item.revenue),(item.profit>0?'+':'')+money(item.profit),(item.marginPercent>0?'+':'')+item.marginPercent.toFixed(1).replace('.',',')+'%',item.recommendation];
   values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===4)td.className='num '+(item.profit<0?'loss':'gain');if(index===2||index===3)td.classList.add('num');tr.appendChild(td)});
   rows.appendChild(tr);
  }
  if(!ranking.items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.className='hint';td.textContent='Пока нет товаров с полными тарифами и заполненной себестоимостью.';tr.appendChild(td);rows.appendChild(tr)}
  window.dispatchEvent(new CustomEvent('ozon:ranking-updated',{detail:ranking}));
  const ex=ranking.excluded;
  set('intelStatus','Учтено '+ranking.includedUnits+' из '+ranking.totalUnits+' шт. · исключено: без себестоимости '+ex.missingCost+', без тарифа '+ex.missingTariff+', товар не найден '+ex.unmatched+', без цены '+ex.unpriced+', неизвестная схема '+ex.unknownFulfillment+'. Прибыль предварительная, не фактическая выплата Ozon.');
 }
 window.addEventListener('ozon:sales-loaded',event=>{periodSales=event.detail;updatePeriodProfit()});
 function makeCard(p){
  const key=safeKey(p),costs=loadCosts()[key]||{},price=Number(p.price)||0,commission=Number(p.sales_percent_fbs)||0;
  const firstMin=Number(p.first_mile_min)||0,firstMax=Number(p.first_mile_max)||0;
  const acq=Number(p.acquiring)||0,delivery=Number(p.delivery_to_customer)||0;
  const card=document.createElement('article');card.className='card product';card.dataset.key=key;card.dataset.costConfigured=(costs.costConfigured===true||(costs.cost!==null&&costs.cost!==undefined&&Number(costs.cost)>0))?'true':'false';
  const fboCommission=Number(p.sales_percent_fbo)||0;
  const metrics=[['Комиссия FBS · '+pct(commission),money(price*commission/100)],['Комиссия FBO · '+pct(fboCommission),p.sales_percent_fbo==null?'—':money(price*fboCommission/100)],['Эквайринг',p.acquiring==null?'—':money(acq)],['Доставка клиенту',p.delivery_to_customer==null?'—':money(delivery)]];
  card.innerHTML='<div class="producttop"><div><div class="sku">SKU '+esc(p.sku??'—')+' · ID '+esc(p.product_id??'—')+'</div><h3>'+esc(p.name||p.offer_id||'Товар без названия')+'</h3><div class="productmeta">Offer ID: '+esc(p.offer_id??'—')+'</div></div><div class="price">'+(price?money(price):'Цена не указана')+'</div></div>'+
   '<div class="productbody"><div class="field"><label>Схема продаж для расчёта</label><select data-fulfillment><option value="FBS">FBS · со своего склада</option><option value="FBO">FBO · со склада Ozon</option></select></div><div class="metrics">'+metrics.map(m=>'<div class="metric"><small>'+m[0]+'</small><b>'+m[1]+'</b></div>').join('')+'</div>'+
   '<div class="costgrid">'+[['cost','Закупка / себестоимость, ₽'],['pack','Упаковка, ₽'],['ads','Реклама на 1 заказ, ₽'],['transit','Доп. логистика сверх тарифов Ozon, ₽'],['other','Прочие расходы, ₽'],['tax','Ручное налоговое удержание, % (не налоговый расчёт)']].map(([k,label])=>'<div class="field '+(k==='other'||k==='tax'?'wide':'')+'"><label>'+label+'</label><input data-key="'+k+'" type="number" min="0" step="0.01" value="'+esc(costs[k]??'0')+'"></div>').join('')+'</div>'+
   '<div class="result"><div><small>Расчётный остаток с единицы после введённых расходов*</small><strong data-out="profit">—</strong></div><div class="pct" data-out="margin">—</div></div>'+
   '<div class="price-simulator"><div><div class="price-simulator-title">Симулятор цены</div><label>Новая цена, ₽</label><input data-sim-price type="number" min="0.01" step="0.01" value="'+(price?esc(price):'')+'" placeholder="Введи цену"></div><div class="price-simulator-results"><div class="price-simulator-result"><small>Прибыль / шт.</small><b data-sim-out="profit">—</b></div><div class="price-simulator-result"><small>Маржа</small><b data-sim-out="margin">—</b></div><div class="price-simulator-result"><small>Разница к текущей</small><b data-sim-out="delta">—</b></div><div class="price-simulator-note" data-sim-out="status">Сценарий: те же расходы и тарифы, без прогноза изменения спроса. Текущая цена Ozon не меняется.</div></div></div>'+
   '<div class="productmeta" data-out="basis">Тарифы из Seller API · первая миля '+(p.first_mile_min==null?'—':money(firstMin)+'–'+money(firstMax))+' · FBS транзит '+(p.transit_min==null?'—':money(p.transit_min)+'–'+money(p.transit_max))+' · FBS возврат '+(p.return_flow==null?'—':money(p.return_flow))+' · FBO доставка '+(p.fbo_delivery_to_customer==null?'—':money(p.fbo_delivery_to_customer))+' · FBO транзит '+(p.fbo_transit_min==null?'—':money(p.fbo_transit_min)+'–'+money(p.fbo_transit_max))+' · FBO возврат '+(p.fbo_return_flow==null?'—':money(p.fbo_return_flow))+'</div></div>';
  function calc(){
   const vals={};card.querySelectorAll('input[data-key]').forEach(i=>vals[i.dataset.key]=i.value===''?0:Number(i.value));vals.costConfigured=card.dataset.costConfigured==='true';
   const fulfillmentType=card.querySelector('[data-fulfillment]').value;const calculation=window.OzonProfitCalculator.calculateProfit({fulfillmentType,unitPrice:price,product:p,expenses:vals});
   const valid=calculation.ok,profit=valid?calculation.profit:0,margin=valid?calculation.marginPercent:0;
   card.querySelector('[data-out=profit]').textContent=!valid?(calculation.reason==='missing_tariff'?'Нужны тарифы':'Проверь расходы'):price?money(profit):'Нет цены';
   const out=card.querySelector('[data-out=margin]');out.textContent=!valid?'Неполные данные':(margin>=0?'+':'')+margin.toFixed(1).replace('.',',')+'%';out.style.color=!valid?'#c58b2b':profit>=0?'#ffb080':'#ff7770';
   const all=loadCosts();all[key]=vals;try{localStorage.setItem(storageKey,JSON.stringify(all))}catch(_){}
    window.dispatchEvent(new CustomEvent('ozon:costs-updated'));
   card.dataset.profit=valid?String(profit):'';card.dataset.margin=valid?String(margin):'';
   const scenarioInput=card.querySelector('[data-sim-price]'),scenarioPrice=scenarioInput&&scenarioInput.value!==''?Number(scenarioInput.value):NaN;
   const scenario=window.OzonProfitCalculator.simulatePrice({fulfillmentType,currentPrice:price,scenarioPrice,product:p,expenses:vals});
   const simProfit=card.querySelector('[data-sim-out=profit]'),simMargin=card.querySelector('[data-sim-out=margin]'),simDelta=card.querySelector('[data-sim-out=delta]'),simStatus=card.querySelector('[data-sim-out=status]');
   if(scenario.ok){
    simProfit.textContent=money(scenario.scenario.profit);
    simMargin.textContent=(scenario.scenario.marginPercent>=0?'+':'')+scenario.scenario.marginPercent.toFixed(1).replace('.',',')+'%';
    simDelta.textContent=(scenario.deltaProfitPerUnit>0?'+':'')+money(scenario.deltaProfitPerUnit);
    [simProfit,simMargin,simDelta].forEach(node=>{const value=Number(node.textContent.replace(/[^0-9,.-]/g,'').replace(',','.'));node.classList.toggle('positive',value>=0);node.classList.toggle('negative',value<0)});
    simStatus.textContent='Изменение прибыли на единицу; спрос и объём продаж не прогнозируются. Цена в кабинете Ozon не меняется.';
   }else{
    simProfit.textContent='—';simMargin.textContent='—';simDelta.textContent='—';
    simStatus.textContent=scenario.reason==='invalid_current_price'?'Нет текущей цены для сравнения.':'Введи корректную цену больше нуля. Расчёт не меняет цену в Ozon.';
   }
   updatePeriodProfit();
  }
  card.querySelectorAll('input[data-key]').forEach(i=>{i.addEventListener('input',()=>{if(i.dataset.key==='cost')card.dataset.costConfigured='true';calc()});if(i.dataset.key==='cost')i.addEventListener('focus',()=>{card.dataset.costConfigured='true';calc()})});card.querySelector('[data-sim-price]').addEventListener('input',calc);card.querySelector('[data-fulfillment]').addEventListener('change',calc);calc();return card;
 }
 function render(){
  const q=(document.getElementById('productSearch').value||'').toLowerCase().trim();
  grid.innerHTML='';let shown=0;
  for(const p of products){const hay=[p.name,p.sku,p.product_id,p.offer_id].join(' ').toLowerCase();if(q&&!hay.includes(q))continue;grid.appendChild(makeCard(p));shown++}
  document.getElementById('catalogCountHint').textContent='Показано '+shown+' из '+products.length+' товаров';
  if(!shown)grid.innerHTML='<div class="empty">Ничего не найдено. Измени поисковый запрос.</div>';
 }
 async function refresh(){
  status.innerHTML='<i class="dot" style="background:#d39a37"></i>Обновление данных…';
  try{
   const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),75000);
   let r;try{r=await fetch('/api/dashboard',{headers:{Accept:'application/json'},signal:controller.signal})}finally{clearTimeout(timer)}
   const data=await r.json();if(!r.ok)throw new Error(data.detail||'Не удалось загрузить каталог');
   if(data.status!=='ok'||!Array.isArray(data.products))throw new Error('Некорректный ответ Seller API');
   products=data.products;render();updatePeriodProfit();window.dispatchEvent(new CustomEvent('ozon:catalog-loaded',{detail:products}));
   document.querySelector('[data-catalog-count]').textContent=String(data.products_count);
   const commissionsFbs=products.map(p=>Number(p.sales_percent_fbs)).filter(n=>Number.isFinite(n)&&n>0);
   const commissionsFbo=products.map(p=>Number(p.sales_percent_fbo)).filter(n=>Number.isFinite(n)&&n>0);
   document.querySelector('[data-commission-average-fbs]').textContent=commissionsFbs.length?pct(commissionsFbs.reduce((a,b)=>a+b,0)/commissionsFbs.length):'—';
   document.querySelector('[data-commission-average-fbo]').textContent=commissionsFbo.length?pct(commissionsFbo.reduce((a,b)=>a+b,0)/commissionsFbo.length):'—';
   status.innerHTML='<i class="dot"></i>Ozon API · данные обновлены';
   notice.innerHTML='<b>Каталог и тарифы получены из Ozon</b>Расходы и себестоимость хранятся локально в этом браузере. Расчёт прибыли предварительный: первая миля усредняется по диапазону, транзит, возвраты и фактические начисления требуют отдельной сверки.';
  }catch(e){if(e.name==='AbortError')e=new Error('Ozon не ответил за 75 секунд. Проверь статус Render и доступ API.');status.innerHTML='<i class="dot" style="background:#c58b2b"></i>API недоступен';notice.innerHTML='<b>Не удалось обновить каталог</b>'+esc(e.message)+' · проверь соединение и доступ к Ozon API.';grid.innerHTML='<div class="empty">Нет актуальных данных. Обнови страницу позже.</div>'}
 }
 document.getElementById('productSearch').addEventListener('input',render);
 document.getElementById('refreshCatalog').addEventListener('click',refresh);
 document.getElementById('clearCosts').addEventListener('click',()=>{if(!confirm('Удалить сохранённые расходы для всех товаров в этом браузере?'))return;localStorage.removeItem(storageKey);render()});
 document.getElementById('exportEconomics').addEventListener('click',()=>{
  const rows=[['Товар','SKU','Product ID','Offer ID','Схема','Цена','Комиссия FBS %','Комиссия FBO %','Себестоимость','Упаковка','Реклама','Доп. транзит','Прочее','Налог %','Остаток/шт','Маржа %']];
  for(const card of grid.querySelectorAll('.product')){const p=products.find(x=>safeKey(x)===card.dataset.key);if(!p)continue;const v={};card.querySelectorAll('input[data-key]').forEach(i=>v[i.dataset.key]=Number(i.value)||0);rows.push([p.name,p.sku,p.product_id,p.offer_id,card.querySelector('[data-fulfillment]').value,p.price,p.sales_percent_fbs,p.sales_percent_fbo,v.cost,v.pack,v.ads,v.transit,v.other,v.tax,card.dataset.profit,card.dataset.margin])}
  const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ozon-unit-economics.csv';a.click();URL.revokeObjectURL(url);
 });
 refresh();
})();
