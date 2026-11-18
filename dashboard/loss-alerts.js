(function(root){
  'use strict';
  const money=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(Number(value)||0)+' ₽';
  const number=value=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(Number(value)||0);
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
      root.__ozonFeeAlerts.push({severity:'neutral',title:'Сверка удержаний пока недоступна',
        detail:'Не удалось сравнить текущий и предыдущий период. '+String(error.message||'Проверь API и выбранные даты.')});
    }
    render();
  }
  root.addEventListener('ozon:ranking-updated',event=>{
    latestRanking=event.detail||null;render();
  });
  root.addEventListener('ozon:sales-loaded',event=>{
    latestSales=event.detail||null;compareFees(latestSales);
  });
  root.addEventListener('ozon:catalog-loaded',render);
  root.addEventListener('storage',render);
  root.OzonRiskDashboard={render};
  render();
})(window);
