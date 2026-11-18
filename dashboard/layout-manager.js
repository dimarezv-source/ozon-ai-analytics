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
  style.textContent='.layout-drag-handle{position:absolute;top:10px;right:12px;z-index:5;border:1px solid #e7eaf2;background:#fff;color:#737b91;border-radius:8px;padding:7px 10px;font:600 12px/1.2 inherit;cursor:grab;touch-action:none;user-select:none}.layout-drag-handle:active{cursor:grabbing}.layout-sortable{position:relative}.layout-sortable.layout-dragging{opacity:.48;outline:2px dashed #26c6da;outline-offset:3px}.layout-sortable.layout-over{box-shadow:0 0 0 2px #26c6da}.layout-reset{margin-left:auto;white-space:nowrap}.dashboard-presets{display:flex;align-items:center;gap:12px;flex-wrap:wrap}';
  document.head.appendChild(style);
  const reset=document.createElement('button');
  reset.type='button';reset.className='secondary layout-reset';reset.textContent='Сбросить порядок';reset.title='Вернуть исходное расположение разделов';
  bar.appendChild(reset);
  function save(){try{localStorage.setItem(KEY,JSON.stringify(movable().map(n=>n.id)))}catch(_){}}
  function restore(){
   let order;try{order=JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){order=null}
   if(!Array.isArray(order))return;
   const nodes=new Map(movable().map(n=>[n.id,n]));
   order.forEach(id=>{const node=nodes.get(id);if(node){main.appendChild(node);nodes.delete(id)}});
  }
  function placeBeforeOrAfter(source,target,clientY){
   if(!source||!target||source===target||target.parentElement!==main)return false;
   const rect=target.getBoundingClientRect();
   const before=clientY<rect.top+rect.height/2;
   main.insertBefore(source,before?target:target.nextSibling);
   movable().forEach(n=>n.classList.remove('layout-over'));
   target.classList.add('layout-over');
   return true;
  }
  movable().forEach(section=>{
   section.classList.add('layout-sortable');
   const handle=document.createElement('button');
   handle.type='button';handle.className='layout-drag-handle';handle.textContent='⠿ Переместить';
   handle.setAttribute('aria-label','Переместить раздел '+(section.querySelector('h2')?.textContent.trim()||section.id));
   handle.setAttribute('aria-keyshortcuts','ArrowUp ArrowDown');
   handle.title='Перетащи блок или нажми ↑ / ↓, чтобы переместить';
   handle.draggable=false;
   let pointer=null;
   handle.addEventListener('pointerdown',event=>{
    if(event.button!==undefined&&event.button!==0)return;
    pointer={id:event.pointerId,startX:event.clientX,startY:event.clientY,source:section,active:false};
    try{handle.setPointerCapture(event.pointerId)}catch(_){}
   });
   handle.addEventListener('pointermove',event=>{
    if(!pointer||pointer.id!==event.pointerId)return;
    const dx=event.clientX-pointer.startX,dy=event.clientY-pointer.startY;
    if(!pointer.active&&Math.hypot(dx,dy)<6)return;
    pointer.active=true;event.preventDefault();
    section.classList.add('layout-dragging');
    const under=document.elementFromPoint(event.clientX,event.clientY);
    const target=under&&under.closest?under.closest('.layout-sortable'):null;
    if(target&&target!==section)placeBeforeOrAfter(section,target,event.clientY);
   });
   function finish(event){
    if(!pointer||event.pointerId!==pointer.id)return;
    const moved=pointer.active;pointer=null;
    section.classList.remove('layout-dragging');
    movable().forEach(n=>n.classList.remove('layout-over'));
    if(moved)save();
   }
   handle.addEventListener('pointerup',finish);
   handle.addEventListener('pointercancel',finish);
   handle.addEventListener('keydown',event=>{
    if(event.key!=='ArrowUp'&&event.key!=='ArrowDown')return;
    const nodes=movable(),index=nodes.indexOf(section),step=event.key==='ArrowUp'?-1:1,target=nodes[index+step];
    if(!target)return;
    event.preventDefault();
    main.insertBefore(section,step<0?target:target.nextSibling);
    save();handle.focus();
   });
   section.insertBefore(handle,section.firstChild);
  });
  restore();
  reset.addEventListener('click',()=>{try{localStorage.removeItem(KEY)}catch(_){};location.reload()});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();