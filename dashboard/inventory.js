(function(root){
 'use strict';
 const el=id=>document.getElementById(id);
 const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0);
 const fmtDays=value=>Number.isFinite(value)?(value<1?'< 1 дня':new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(value)+' дн.'):'—';
 const state={products:[],sales:null,stock:null,loading:false};
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
 root.addEventListener('ozon:catalog-loaded',event=>{state.products=Array.isArray(event.detail)?event.detail:[];if(!state.stock)load();else render()});
 root.addEventListener('ozon:sales-loaded',event=>{state.sales=event.detail||null;render()});
 const button=el('inventoryRefresh');if(button)button.addEventListener('click',load);
})(window);
