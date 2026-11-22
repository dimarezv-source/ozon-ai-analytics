(function(root){
 'use strict';
 const FORMAT='ozon-ai-analytics-settings';
 const VERSION=1;
 const PREFIX='ozon-ai-analytics-';
 const MAX_BYTES=2*1024*1024;
 function collectSettings(storage){
  const source=storage||root.localStorage,entries={};
  for(let i=0;i<source.length;i++){
   const key=source.key(i);
   if(typeof key==='string'&&key.startsWith(PREFIX)){
    const value=source.getItem(key);
    if(typeof value==='string')entries[key]=value;
   }
  }
  return {format:FORMAT,version:VERSION,createdAt:new Date().toISOString(),entries};
 }
 function validateBackup(payload){
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {ok:false,reason:'invalid_document'};
  if(payload.format!==FORMAT||payload.version!==VERSION)return {ok:false,reason:'unsupported_version'};
  if(!payload.entries||typeof payload.entries!=='object'||Array.isArray(payload.entries))return {ok:false,reason:'invalid_entries'};
  const keys=Object.keys(payload.entries);
  if(keys.length>100)return {ok:false,reason:'too_many_entries'};
  let bytes=0;
  for(const key of keys){
   const value=payload.entries[key];
   if(!key.startsWith(PREFIX)||typeof value!=='string')return {ok:false,reason:'invalid_entry'};
   bytes+=key.length+value.length;
   if(bytes>MAX_BYTES)return {ok:false,reason:'backup_too_large'};
   try{JSON.parse(value);}catch(_){return {ok:false,reason:'invalid_setting_json'};}
  }
  return {ok:true,count:keys.length};
 }
 function restoreSettings(payload,storage){
  const valid=validateBackup(payload);
  if(!valid.ok)return valid;
  const target=storage||root.localStorage,previous={};
  try{
   for(const key of Object.keys(payload.entries))previous[key]=target.getItem(key);
   for(const [key,value] of Object.entries(payload.entries))target.setItem(key,value);
   return {ok:true,count:valid.count};
  }catch(_){
   for(const [key,value] of Object.entries(previous)){
    try{if(value===null)target.removeItem(key);else target.setItem(key,value);}catch(__){}
   }
   return {ok:false,reason:'storage_unavailable'};
  }
 }
 function downloadBackup(){
  const backup=collectSettings();
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='ozon-ai-analytics-settings-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
  return Object.keys(backup.entries).length;
 }
 function mount(){
  const main=document.querySelector('.main');
  if(!main||document.getElementById('settingsBackupPanel'))return;
  const panel=document.createElement('section');
  panel.id='settingsBackupPanel';panel.className='card';panel.style.margin='18px 0';
  panel.innerHTML='<div class="sectionhead" style="margin:0 0 10px"><div><h2>Резервная копия настроек</h2><p>Локальные параметры браузера; себестоимость и расходы SKU дополнительно синхронизируются с PostgreSQL</p></div><span class="tag">БРАУЗЕР + POSTGRESQL</span></div><div style="display:flex;gap:9px;flex-wrap:wrap;align-items:center"><button type="button" id="settingsBackupExport" style="border:0;border-radius:9px;padding:10px 14px;background:linear-gradient(110deg,var(--orange),var(--orange2));font-weight:800;cursor:pointer">Скачать копию</button><button type="button" id="settingsBackupImport" class="secondary" style="border:1px solid var(--line);border-radius:9px;padding:10px 14px;background:#fff;color:var(--ink);font-weight:750;cursor:pointer">Восстановить из файла</button><input id="settingsBackupFile" type="file" accept="application/json,.json" hidden></div><p id="settingsBackupStatus" class="hint" role="status" aria-live="polite" style="margin:10px 0 0">Локальные параметры хранятся в этом браузере. Себестоимость и расходы SKU дополнительно сохраняются в PostgreSQL.</p>';
  const footer=main.querySelector('.footer');
  main.insertBefore(panel,footer||null);
  const status=panel.querySelector('#settingsBackupStatus'),file=panel.querySelector('#settingsBackupFile');
  panel.querySelector('#settingsBackupExport').addEventListener('click',()=>{
   try{const count=downloadBackup();status.textContent='Копия скачана. Сохранено разделов настроек: '+count+'. Файл остаётся у тебя.';}
   catch(_){status.textContent='Не удалось создать файл копии в этом браузере.';}
  });
  panel.querySelector('#settingsBackupImport').addEventListener('click',()=>file.click());
  file.addEventListener('change',async()=>{
   const selected=file.files&&file.files[0];if(!selected)return;
   try{
    if(selected.size>MAX_BYTES){status.textContent='Файл больше 2 МБ. Выбери корректную копию.';return;}
    const payload=JSON.parse(await selected.text()),valid=validateBackup(payload);
    if(!valid.ok){status.textContent='Файл не принят: '+valid.reason+'. Текущие настройки не изменены.';return;}
    if(!confirm('Восстановить '+valid.count+' разделов настроек из файла? Совпадающие настройки будут заменены, остальные данные останутся без изменений.'))return;
    const result=restoreSettings(payload);
    if(!result.ok){status.textContent='Не удалось сохранить настройки. Предыдущие значения восстановлены насколько позволило хранилище.';return;}
    status.textContent='Восстановлено разделов: '+result.count+'. Перезагрузи страницу, чтобы применить настройки.';
   }catch(_){status.textContent='Не удалось прочитать файл. Текущие настройки не изменены.';}
   finally{file.value='';}
  });
 }
 const api={FORMAT,VERSION,PREFIX,MAX_BYTES,collectSettings,validateBackup,restoreSettings,mount};
 root.OzonSettingsBackup=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',mount);
})(typeof globalThis!=='undefined'?globalThis:this);
