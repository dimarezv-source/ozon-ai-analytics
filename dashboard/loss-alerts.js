(function(root){
  'use strict';
  const money=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0}).format(Number(value)||0)+' ₽';
  const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(value)||0);
  const daysText=value=>Number.isFinite(Number(value))?(Number(value)<1?'< 1 дня':number(value)+' дн.'):'—';
  const currencyMoney=(value,currency)=>{const code=String(currency||'').toUpperCase();try{return new Intl.NumberFormat('ru-RU',{style:'currency',currency:code,maximumFractionDigits:2}).format(Number(value));}catch(_){return number(value)+' '+(code||'ед.');}};
  const el=id=>document.getElementById(id);
  let latestRanking=null, latestSales=null, feeRequestKey='';
  function row(title,detail,severity){
    const item=document.createElement('article');
    item.className='risk-item '+severity;
    const heading=document.createElement('b');heading.textContent=title;item.appendChild(heading);
    const copy=document.createElement('p');copy.textContent=detail;item.appendChild(copy);
    return item;
  }
  function render(){
    const list=el('riskAlerts'),risk=el('riskLevel'),count=el('riskCount'),summary=el('riskSummary');
    if(!list||!risk||!count||!summary)return;
    list.replaceChildren();
    const items=latestRanking&&Array.isArray(latestRanking.items)?latestRanking.items:[];
    const alerts=[];
    for(const item of items){
      const profit=Number(item.profit),margin=Number(item.marginPercent);
      if(Number.isFinite(profit)&&profit<0){
        alerts.push({severity:'critical',title:'Убыточный товар · '+(item.name||'Без названия'),
          detail:'SKU '+(item.sku??'—')+' · '+item.fulfillmentType+' · расчётный результат '+money(profit)+' за '+item.units+' шт. Проверь себестоимость, цену и расходы. Автоматического изменения цены нет.'});
      }else if(Number.isFinite(margin)&&margin<10){
        alerts.push({severity:'warning',title:'Низкая маржа · '+(item.name||'Без названия'),
          detail:'SKU '+(item.sku??'—')+' · маржа '+number(margin)+'%. Проверь цену, рекламу, упаковку и дополнительные расходы.'});
      }
    }
    const feeAlerts=Array.isArray(root.__ozonFeeAlerts)?root.__ozonFeeAlerts:[];
    alerts.push(...feeAlerts);
    const critical=alerts.filter(a=>a.severity==='critical').length;
    const warnings=alerts.filter(a=>a.severity==='warning').length;
    const coverage=Number(latestRanking&&latestRanking.coveragePercent)||0;
    if(!latestRanking){
      risk.textContent='Нет данных';risk.dataset.level='unknown';
      summary.textContent='Загрузи продажи за период и каталог, чтобы оценить риски.';
    }else if(!items.length){
      risk.textContent='Недостаточно данных';risk.dataset.level='unknown';
      summary.textContent='Нет товаров с полной себестоимостью и тарифами. Риск магазина пока нельзя достоверно оценить.';
    }else if(critical){
      risk.textContent='Высокий';risk.dataset.level='high';
      summary.textContent='Критических сигналов: '+critical+' · предупреждений: '+warnings+' · покрытие продаж: '+number(coverage)+'%.';
    }else if(warnings){
      risk.textContent='Средний';risk.dataset.level='medium';
      summary.textContent='Критических сигналов нет · предупреждений: '+warnings+' · покрытие продаж: '+number(coverage)+'%.';
    }else{
      risk.textContent='Низкий';risk.dataset.level='low';
      summary.textContent='Критических сигналов и предупреждений не найдено · покрытие продаж: '+number(coverage)+'%. Это не гарантия отсутствия рисков.';
    }
    count.textContent=String(alerts.length);
    if(!alerts.length){
      list.appendChild(row('Пока нет подтверждённых сигналов','Проверка работает по товарам, для которых заполнена себестоимость и доступны тарифы.','neutral'));
    }else{
      for(const alert of alerts){
        list.appendChild(row(alert.title,alert.detail,alert.severity));
      }
    }
  }
  async function compareFees(sales){
    const from=sales&&sales.period&&sales.period.date_from,to=sales&&sales.period&&sales.period.date_to;
    if(!from||!to)return;
    const start=Date.parse(from+'T00:00:00Z'),end=Date.parse(to+'T00:00:00Z');
    const days=Math.round((end-start)/86400000)+1;
    const key=from+'|'+to;
    if(feeRequestKey===key)return;
    feeRequestKey=key;
    root.__ozonFeeAlerts=[];
    if(days<1||days>31){
      root.__ozonFeeAlerts.push({severity:'neutral',title:'Изменения удержаний не проверены',
        detail:'Сравнение начислений доступно для периодов до 31 дня. Выбранный период: '+days+' дней.'});
      render();return;
    }
    const previousEnd=new Date(start-86400000),previousStart=new Date(start-days*86400000);
    const iso=d=>new Date(d).toISOString().slice(0,10);
    try{
      const query=(a,b)=>fetch('/api/finance/reconciliation?date_from='+a+'&date_to='+b,{headers:{Accept:'application/json'}}).then(async response=>{
        const data=await response.json();if(!response.ok)throw new Error(data.detail||'Ошибка сверки');
        return data;
      });
      const current=await query(from,to);const previous=await query(iso(previousStart),iso(previousEnd));
      const old=new Map((previous.summary||[]).map(item=>[String(item.type_id)+'|'+String(item.currency),item]));
      const types=current.dictionary||{};
      for(const item of current.summary||[]){
        const prior=old.get(String(item.type_id)+'|'+String(item.currency));
        const amount=Number(item.amount),before=Number(prior&&prior.amount);
        const label=item.label||types[String(item.type_id)]?.name||types[String(item.type_id)]?.description;
        if(!label){
          root.__ozonFeeAlerts.push({severity:'warning',title:'Неизвестное удержание · ID '+item.type_id,
            detail:'Сумма '+currencyMoney(amount,item.currency)+'. Смысл типа не предполагается — проверь справочник начислений Ozon.'});
        }
        if(prior&&Number.isFinite(amount)&&Number.isFinite(before)&&before!==0){
          const delta=amount-before,change=Math.abs(delta)/Math.abs(before)*100;
          if(change>=50&&Math.abs(delta)>=100){
            root.__ozonFeeAlerts.push({severity:'warning',title:'Заметно изменилось удержание · '+(label||('ID '+item.type_id)),
              detail:'Было '+currencyMoney(before,item.currency)+', стало '+currencyMoney(amount,item.currency)+'; изменение '+(delta>0?'+':'')+currencyMoney(delta,item.currency)+' ('+number(change)+'%). Проверь детализацию и сопоставимость периодов.'});
          }
        }
      }
    }catch(error){
      feeRequestKey='';
      root.__ozonFeeAlerts.push({severity:'neutral',title:'Сверка удержаний пока недоступна',
        detail:'Не удалось сравнить текущий и предыдущий период. '+String(error.message||'Проверь API и выбранные даты.')});
    }
    render();renderActionCenter();
  }
  root.addEventListener('ozon:ranking-updated',event=>{
    latestRanking=event.detail||null;render();renderActionCenter();
  });
  root.addEventListener('ozon:sales-loaded',event=>{
    latestSales=event.detail||null;compareFees(latestSales);renderActionCenter();
  });
  root.addEventListener('ozon:catalog-loaded',()=>{render();renderActionCenter()});
  root.addEventListener('ozon:inventory-updated',event=>{latestStock=event.detail||null;renderActionCenter()});
  root.addEventListener('storage',render);

  // Daily action center: combines existing profit, fee and stock signals without changing Ozon data.
  let latestStock=null;
  function installActionCenter(){
    if(el('actionCenter')||!el('intelligence'))return;
    const style=document.createElement('style');
    style.textContent=`
      .action-center{margin:0 0 18px;overflow:hidden;border:1px solid #dfe5f1;background:linear-gradient(125deg,#fff 0%,#fbf9ff 55%,#effbfc 100%)}
      .action-head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
      .action-head h2{margin:0;font-size:18px;letter-spacing:-.3px}
      .action-head p{margin:5px 0 0;color:var(--muted);font-size:12px}
      .action-score{border-radius:30px;padding:7px 12px;font-size:11px;font-weight:850;background:#e8f3ff;color:#1764a5;border:1px solid #cfe4fa}
      .action-score[data-level="high"]{background:#fff0f0;color:#b42335;border-color:#ffd2d7}
      .action-score[data-level="medium"]{background:#fff6e8;color:#99600b;border-color:#ffe2ae}
      .action-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:15px 0}
      .action-stat{padding:12px;border-radius:12px;background:#fff;border:1px solid var(--line);min-width:0}
      .action-stat small{display:block;color:var(--muted);font-size:10px;margin-bottom:6px}
      .action-stat strong{font-size:clamp(17px,2vw,23px);font-weight:850;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      .action-list{display:grid;gap:8px}
      .action-item{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:11px;align-items:start;padding:12px 13px;background:#fff;border:1px solid var(--line);border-radius:11px}
      .action-mark{width:8px;height:8px;border-radius:50%;margin-top:5px;background:#26a17b}
      .action-item.critical .action-mark{background:#d65363}.action-item.warning .action-mark{background:#e3a23c}
      .action-item b{display:block;font-size:12px;line-height:1.4}.action-item p{margin:4px 0 0;color:#687087;font-size:11px;line-height:1.5}
      .action-link{color:#5961a7;text-decoration:none;font-size:11px;font-weight:800;white-space:nowrap;padding:5px 0}
      .action-link:hover{text-decoration:underline}
      .action-empty{padding:15px;border:1px dashed #d8dce8;border-radius:11px;color:var(--muted);font-size:12px;background:#ffffffa8}
      .action-foot{margin:10px 0 0;color:var(--muted);font-size:10px;line-height:1.5}
      @media(max-width:760px){.action-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.action-item{grid-template-columns:8px minmax(0,1fr)}.action-link{grid-column:2}}
    `;
    document.head.appendChild(style);
    const panel=document.createElement('section');panel.className='card action-center';panel.id='actionCenter';
    panel.innerHTML='<div class="action-head"><div><h2>План действий на сегодня</h2><p>Приоритеты из экономики, остатков и финансовых начислений</p></div><span class="action-score" id="actionLevel" data-level="unknown">Ожидаем данные</span></div>'+
      '<div class="action-stats"><div class="action-stat"><small>Срочные задачи</small><strong id="actionCritical">—</strong></div><div class="action-stat"><small>Предупреждения</small><strong id="actionWarnings">—</strong></div><div class="action-stat"><small>Покрытие экономики</small><strong id="actionCoverage">—</strong></div><div class="action-stat"><small>Расчётная прибыль</small><strong id="actionProfit">—</strong></div></div>'+
      '<div class="action-list" id="actionItems"><div class="action-empty">Загрузи продажи и остатки — соберём список приоритетов.</div></div>'+
      '<p class="action-foot">Подсказки основаны только на доступных данных. Прибыль и покрытие — оценки; изменение цен и остатки в кабинете Ozon автоматически не меняются.</p>';
    el('intelligence').parentNode.insertBefore(panel,el('intelligence'));
  }
  function renderActionCenter(){
    installActionCenter();
    const list=el('actionItems');if(!list)return;
    const ranked=latestRanking&&Array.isArray(latestRanking.items)?latestRanking.items:[];
    const stock=latestStock&&Array.isArray(latestStock.items)?latestStock.items:[];
    const fees=Array.isArray(root.__ozonFeeAlerts)?root.__ozonFeeAlerts:[];
    const actions=[];
    for(const item of ranked){
      const margin=Number(item.marginPercent),profit=Number(item.profit);
      if(Number.isFinite(profit)&&profit<0)actions.push({level:'critical',title:'Остановить утечку: '+(item.name||'убыточный товар'),detail:'SKU '+(item.sku??'—')+' · '+item.fulfillmentType+' · расчётный минус '+money(profit)+'. Проверь себестоимость, расходы и целевую цену.',href:'#unit',link:'Открыть юнит-экономику'});
      else if(Number.isFinite(margin)&&margin<15)actions.push({level:'warning',title:'Поднять маржу: '+(item.name||'товар'),detail:'SKU '+(item.sku??'—')+' · маржа '+number(margin)+'%. Сверь закупку, рекламу, упаковку и цену.',href:'#unit',link:'Проверить расходы'});
    }
    for(const item of stock){
      if(item.level==='critical')actions.push({level:'critical',title:'Нет доступного остатка · '+item.name,detail:item.type+' · '+(item.sku?'SKU '+item.sku:'товар')+'. Проверь пополнение или доступность товара.',href:'#inventory',link:'Открыть остатки'});
      else if(item.level==='warning')actions.push({level:'warning',title:'Запас скоро закончится · '+item.name,detail:item.type+' · доступно '+number(item.available)+' шт. · ориентир '+daysText(item.coverage)+'.',href:'#inventory',link:'Проверить остатки'});
    }
    for(const item of fees){
      if(item.severity==='critical'||item.severity==='warning')actions.push({level:item.severity,title:item.title,detail:item.detail,href:'#reconciliationPanel',link:'Открыть сверку'});
    }
    const critical=actions.filter(x=>x.level==='critical').length,warnings=actions.filter(x=>x.level==='warning').length;
    const set=(id,value)=>{const node=el(id);if(node)node.textContent=value};
    set('actionCritical',String(critical));set('actionWarnings',String(warnings));
    set('actionCoverage',latestRanking?number(latestRanking.coveragePercent)+'%':'—');
    set('actionProfit',latestRanking&&latestRanking.includedUnits?money(latestRanking.estimatedProfit):'—');
    const level=el('actionLevel');
    if(level){level.dataset.level=critical?'high':warnings?'medium':latestRanking?'low':'unknown';level.textContent=critical?'Нужны действия':warnings?'Есть задачи':latestRanking?'Критичных сигналов нет':'Ожидаем данные'}
    list.replaceChildren();
    actions.sort((a,b)=>(a.level==='critical'?0:1)-(b.level==='critical'?0:1));
    for(const item of actions.slice(0,8)){
      const article=document.createElement('article');article.className='action-item '+item.level;
      const mark=document.createElement('i');mark.className='action-mark';
      const content=document.createElement('div'),heading=document.createElement('b'),copy=document.createElement('p');
      heading.textContent=item.title;copy.textContent=item.detail;content.append(heading,copy);
      const link=document.createElement('a');link.className='action-link';link.href=item.href;link.textContent=item.link;
      article.append(mark,content,link);list.appendChild(article);
    }
    if(!actions.length){
      const empty=document.createElement('div');empty.className='action-empty';
      empty.textContent=latestRanking?'По загруженным данным срочных проблем не найдено. Проверь полноту себестоимости и обнови остатки.':'Для рекомендаций нужны продажи, каталог и заполненная себестоимость.';
      list.appendChild(empty);
    }
    if(actions.length>8){const more=document.createElement('div');more.className='action-foot';more.textContent='Ещё сигналов: '+(actions.length-8)+'. Полный список смотри в разделах ниже.';list.appendChild(more)}
  }

  root.OzonRiskDashboard={render};
  render();
})(window);
