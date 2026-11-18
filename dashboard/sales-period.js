(function setupSalesPeriod(){
 const from=document.getElementById('salesFrom'),to=document.getElementById('salesTo'),button=document.getElementById('salesLoad'),message=document.getElementById('salesMessage');
 if(!from||!to||!button)return;
 const today=new Date();const iso=d=>{const y=d.getUTCFullYear(),m=String(d.getUTCMonth()+1).padStart(2,'0'),day=String(d.getUTCDate()).padStart(2,'0');return y+'-'+m+'-'+day;};
 const end=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate()));const start=new Date(end);start.setUTCDate(start.getUTCDate()-30);from.value=iso(start);to.value=iso(end);
 const money=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:2}).format(n)+' ₽';
 const number=n=>new Intl.NumberFormat('ru-RU').format(n);
 async function load(){
  if(!from.value||!to.value){message.textContent='Укажи обе даты.';message.classList.add('error');return;}
  if(to.value<from.value){message.textContent='Дата окончания раньше даты начала.';message.classList.add('error');return;}
  const days=(Date.parse(to.value+'T00:00:00Z')-Date.parse(from.value+'T00:00:00Z'))/86400000;
  if(days>364){message.textContent='Максимальный период — 365 дней.';message.classList.add('error');return;}
  button.disabled=true;button.textContent='Загрузка…';message.classList.remove('error');message.textContent='Запрашиваю доставленные заказы в Ozon…';
  try{
   const response=await fetch('/api/sales?date_from='+encodeURIComponent(from.value)+'&date_to='+encodeURIComponent(to.value),{headers:{'Accept':'application/json'}});
   const data=await response.json();if(!response.ok)throw new Error(data.detail||'Не удалось загрузить продажи.');
   document.querySelector('[data-sales-total]').textContent=money(data.sales_gmv);
   document.querySelector('[data-sales-units]').textContent=number(data.delivered_units);
   document.querySelector('[data-sales-hint]').textContent='Оборот доставленных заказов до возвратов';
   document.querySelector('[data-sales-units-hint]').textContent=number(data.delivered_postings)+' доставленных отправлений';
   const salesBox=document.getElementById('salesBreakdown'),salesRows=document.getElementById('salesBreakdownRows');
   salesRows.innerHTML='';
   for(const item of (data.products||[])){
    const tr=document.createElement('tr');
    const values=[item.name||'Товар без названия',item.sku||'—',number(item.units||0),money(item.sales_gmv||0),data.sales_gmv?((Number(item.sales_gmv||0)/Number(data.sales_gmv))*100).toFixed(1).replace('.',',')+'%':'—'];
    values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=String(value);if(index===1)td.className='muted';tr.appendChild(td)});
    salesRows.appendChild(tr);
   }
   if(!(data.products||[]).length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='За выбранный период доставленных товаров не найдено.';td.className='muted';tr.appendChild(td);salesRows.appendChild(tr)}
   salesBox.style.display='block';
   window.dispatchEvent(new CustomEvent('ozon:sales-loaded',{detail:data}));
   message.textContent='Обновлено: '+data.period.date_from+' — '+data.period.date_to+' UTC · FBO: '+data.fbo_postings+', FBS: '+data.fbs_postings+(data.unpriced_units?' · без цены: '+data.unpriced_units+' шт.':'');
  }catch(error){message.textContent=error.message;message.classList.add('error');}
  finally{button.disabled=false;button.textContent='Показать';}
 }
 button.addEventListener('click',load);
})();
