(function(root){
 'use strict';
 function prioritizeActions(actions){
  return (Array.isArray(actions)?actions:[]).map((action,index)=>({...action,_index:index,impact:Number.isFinite(Number(action.impact))?Math.max(0,Number(action.impact)):0}))
   .sort((a,b)=>{
    const level=(a.level==='critical'?0:a.level==='warning'?1:2)-(b.level==='critical'?0:b.level==='warning'?1:2);
    return level||b.impact-a.impact||a._index-b._index;
   }).map(({_index,...action})=>action);
 }
 const api={prioritizeActions};
 root.OzonActionPrioritizer=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
