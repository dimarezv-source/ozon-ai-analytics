(function(){
 'use strict';
 const KEY='ozon-ai-analytics-layout-v1';
 function init(){
  const main=document.querySelector('.main');
  const bar=document.getElementById('dashboardPresetBar');
  if(!main||!bar||main.dataset.layoutReady==='true')return;
  main.dataset.layoutReady='true';
  const movable=()=>Array.from(main.children).filter(node=>node.tagName==='SECTION'&&node.id);
  const style=document.createElement('style');
  style.textContent='.layout-drag-handle{position:absolute;top:10px;right:12px;z-index:5;border:1px solid #e7eaf2;background:#fff;color:#737b91;border-radius:8px;padding:5px 9px;font:600 12px/1.2 inherit;cursor:grab;touch-action:none}.layout-drag-handle:active{cursor:grabbing}.layout-sortable{position:relative}.layout-sortable.layout-dragging{opacity:.48;outline:2px dashed #26c6da;outline-offset:3px}.layout-sortable.layout-over{box-shadow:0 0 0 2px #26c6da}.layout-reset{margin-left:auto;white-space:nowrap}.dashboard-presets{display:flex;align-items:center;gap:12px;flex-wrap:wrap}';
  document.head.appendChild(style);
  const reset=document.createElement('button');
  reset.type='button';reset.className='secondary layout-reset';reset.textContent='Сбросить порядок';reset.title='Вернуть исходное расположение разделов';
  bar.appendChild(reset);
  let dragged=null;
  function save(){try{localStorage.setItem(KEY,JSON.stringify(movable().map(n=>n.id)))}catch(_){}}
  function restore(){
   let order;try{order=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){order=null}
   if(!Array.isArray(order))return;
   const nodes=new Map(movable().map(n=>[n.id,n]));
   order.forEach(id=>{const node=nodes.get(id);if(node){main.appendChild(node);nodes.delete(id)}});
  }
  movable().forEach(section=>{
   section.classList.add('layout-sortable');
   const handle=document.createElement('button');
   handle.type='button';handle.className='layout-drag-handle';handle.textContent='⠿ Переместить';
   handle.setAttribute('aria-label','Перетащить раздел '+(section.querySelector('h2')?.textContent.trim()||section.id));
   handle.draggable=true;
   handle.addEventListener('dragstart',event=>{dragged=section;section.classList.add('layout-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',section.id)});
   handle.addEventListener('dragend',()=>{section.classList.remove('layout-dragging');movable().forEach(n=>n.classList.remove('layout-over'));dragged=null;save()});
   section.addEventListener('dragover',event=>{if(!dragged||dragged===section)return;event.preventDefault();event.dataTransfer.dropEffect='move';section.classList.add('layout-over')});
   section.addEventListener('dragleave',event=>{if(!section.contains(event.relatedTarget))section.classList.remove('layout-over')});
   section.addEventListener('drop',event=>{
    event.preventDefault();section.classList.remove('layout-over');
    if(!dragged||dragged===section)return;
    const rect=section.getBoundingClientRect();
    main.insertBefore(dragged,event.clientY<rect.top+rect.height/2?section:section.nextSibling);
    save();
   });
   section.insertBefore(handle,section.firstChild);
  });
  restore();
  reset.addEventListener('click',()=>{try{localStorage.removeItem(KEY)}catch(_){};location.reload()});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();