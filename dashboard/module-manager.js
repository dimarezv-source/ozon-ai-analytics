(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root&&root.document)api.mount(root.document);
})(typeof window!=='undefined'?window:null,function(){
 const MODULES=[
  {id:'sales',title:'Продажи и прибыль',description:'Продажи по товарам, показатели периода и расчётная прибыль.',selectors:['#salesBreakdown','.grid.kpis','#periodProfit']},
  {id:'intelligence',title:'Ozon Intelligence',description:'Рейтинг товаров, покрытие продаж и аналитика прибыльности.',selectors:['#intelligence'],nav:['a[href="#intelligence"]']},
  {id:'risk',title:'Риски магазина',description:'Убыточные позиции, низкая маржа и изменения удержаний.',selectors:['#storeRisk']},
  {id:'inventory',title:'Остатки и склад',description:'FBO/FBS, пополнение, замороженный капитал и приоритет распродажи.',selectors:['#inventory'],nav:['a[href="#inventory"]']},
  {id:'reconciliation',title:'Финансовая сверка',description:'Компоненты начислений, распределение по отправлениям и SKU.',selectors:['#reconciliationPanel','#skuMatrixPanel']},
  {id:'accruals',title:'Фактические начисления',description:'Исходные записи финансового API Ozon без смешивания с прогнозом.',selectors:['#financeAccrualPanel']},
  {id:'unit-economics',title:'Юнит-экономика',description:'Карточки товаров, себестоимость, расходы и симулятор цены.',selectors:['#unit','.catalogtools','#productGrid'],nav:['a[href="#unit"]']},
  {id:'fees',title:'Структура удержаний',description:'Справочная структура известных тарифов и расходов.',selectors:['#fees'],nav:['a[href="#fees"]']},
  {id:'data-quality',title:'Качество данных',description:'Покрытие и полнота загруженных данных.',selectors:['#data'],nav:['a[href="#data"]']}
 ];

 const PRESETS={all:{label:'Всё',enabled:Object.fromEntries(MODULES.map(m=>[m.id,true])),order:[]},sales:{label:'Продажи',enabled:{sales:true,intelligence:true,risk:true,'unit-economics':true,'data-quality':true,inventory:false,reconciliation:false,accruals:false,fees:false},order:['salesBreakdown','periodProfit','intelligence','storeRisk','productGrid']},finance:{label:'Финансы',enabled:{sales:true,reconciliation:true,accruals:true,fees:true,'unit-economics':true,intelligence:false,risk:false,inventory:false,'data-quality':false},order:['periodProfit','reconciliationPanel','skuMatrixPanel','financeAccrualPanel','fees','productGrid']},stock:{label:'Склад',enabled:{inventory:true,sales:true,'unit-economics':true,intelligence:true,risk:false,reconciliation:false,accruals:false,fees:false,'data-quality':true},order:['inventory','salesBreakdown','intelligence','productGrid','data']}};
 const STORAGE_KEY='ozon-ai-analytics-modules-v1';
 function defaults(){return {version:1,enabled:Object.fromEntries(MODULES.map(m=>[m.id,true]))}}
 function normalizeSettings(value){
  const result=defaults();
  if(!value||typeof value!=='object'||value.version!==1||!value.enabled||typeof value.enabled!=='object')return result;
  MODULES.forEach(m=>{if(typeof value.enabled[m.id]==='boolean')result.enabled[m.id]=value.enabled[m.id]});
  return result;
 }
 function setEnabled(settings,id,enabled){
  if(!MODULES.some(m=>m.id===id))return normalizeSettings(settings);
  const next=normalizeSettings(settings);next.enabled[id]=Boolean(enabled);return next;
 }
 function countEnabled(settings){const s=normalizeSettings(settings);return MODULES.filter(m=>s.enabled[m.id]).length}
 function mount(doc){
  const trigger=doc.getElementById('moduleManagerOpen'),dialog=doc.getElementById('moduleManagerDialog'),list=doc.getElementById('moduleManagerList'),count=doc.getElementById('moduleManagerCount');
  if(!trigger||!dialog||!list||trigger.dataset.ready==='true')return;
  trigger.dataset.ready='true';
  let settings=defaults();
  try{settings=normalizeSettings(JSON.parse(doc.defaultView.localStorage.getItem(STORAGE_KEY)||'null'))}catch(_){}
  function apply(){
   MODULES.forEach(m=>{
    const enabled=settings.enabled[m.id];
    m.selectors.forEach(selector=>doc.querySelectorAll(selector).forEach(node=>{node.hidden=!enabled;node.setAttribute('data-module-hidden',enabled?'false':'true')}));
    (m.nav||[]).forEach(selector=>doc.querySelectorAll(selector).forEach(node=>{node.hidden=!enabled;node.setAttribute('aria-hidden',String(!enabled))}));
   });
   count.textContent=countEnabled(settings)+' из '+MODULES.length+' включено';
   try{doc.defaultView.localStorage.setItem(STORAGE_KEY,JSON.stringify(settings))}catch(_){}
   doc.defaultView.dispatchEvent(new doc.defaultView.CustomEvent('ozon:modules-changed',{detail:{enabled:{...settings.enabled}}}));
  }
  function render(){
   list.innerHTML=MODULES.map(m=>'<label class="module-option"><span class="module-option-copy"><strong>'+m.title+'</strong><small>'+m.description+'</small></span><input type="checkbox" data-module-toggle="'+m.id+'" '+(settings.enabled[m.id]?'checked':'')+' aria-label="Включить модуль '+m.title+'"></label>').join('');
   list.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',()=>{
    settings=setEnabled(settings,input.dataset.moduleToggle,input.checked);apply();render();
   }));
  }
  const main=doc.querySelector('.main');
  if(main&&!doc.getElementById('dashboardPresetBar')){
   const bar=doc.createElement('div');bar.id='dashboardPresetBar';bar.className='dashboard-presets';
   bar.innerHTML='<div class="dashboard-presets-copy"><b>Рабочий режим</b><small>Быстро переключай фокус панели</small></div><div class="dashboard-preset-buttons">'+Object.entries(PRESETS).map(([id,p])=>'<button type="button" data-preset="'+id+'">'+p.label+'</button>').join('')+'</div>';
   const period=main.querySelector('.periodbar');if(period)main.insertBefore(bar,period);else main.insertBefore(bar,main.firstChild);
   bar.querySelectorAll('[data-preset]').forEach(btn=>btn.addEventListener('click',()=>{const preset=PRESETS[btn.dataset.preset];settings=defaults();MODULES.forEach(m=>{if(typeof preset.enabled[m.id]==='boolean')settings.enabled[m.id]=preset.enabled[m.id]});apply();bar.querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===btn));try{doc.defaultView.localStorage.setItem('ozon-ai-analytics-preset-v1',btn.dataset.preset)}catch(_){} }));
   try{const saved=doc.defaultView.localStorage.getItem('ozon-ai-analytics-preset-v1');if(saved&&PRESETS[saved])bar.querySelector('[data-preset="'+saved+'"]').click()}catch(_){}
  }
  trigger.addEventListener('click',()=>{render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','')});
  dialog.querySelectorAll('[data-module-close]').forEach(button=>button.addEventListener('click',()=>dialog.close?dialog.close():dialog.removeAttribute('open')));
  const reset=dialog.querySelector('[data-module-reset]');
  if(reset)reset.addEventListener('click',()=>{settings=defaults();apply();render()});
  render();apply();
 }
 return {MODULES,PRESETS,STORAGE_KEY,defaults,normalizeSettings,setEnabled,countEnabled,mount};
});
