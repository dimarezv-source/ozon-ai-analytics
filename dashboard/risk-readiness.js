(function(root){
 'use strict';
 function assessRisk(input){
  const coverage=Number(input&&input.coveragePercent)||0;
  const critical=Math.max(0,Number(input&&input.critical)||0);
  const warnings=Math.max(0,Number(input&&input.warnings)||0);
  if(!input||!input.hasRanking)return {label:'Нет данных',level:'unknown',summary:'Загрузи продажи за период и каталог, чтобы оценить риски.'};
  if(!input.itemCount)return {label:'Недостаточно данных',level:'unknown',summary:'Нет товаров с полной себестоимостью и тарифами. Риск магазина пока нельзя достоверно оценить.'};
  if(critical)return {label:'Высокий',level:'high',summary:'Критических сигналов: '+critical+' · предупреждений: '+warnings+' · покрытие продаж: '+coverage.toFixed(1)+'%.'};
  if(warnings)return {label:'Средний',level:'medium',summary:'Критических сигналов нет · предупреждений: '+warnings+' · покрытие продаж: '+coverage.toFixed(1)+'%.'};
  if(coverage<100)return {label:'Неполная оценка',level:'unknown',summary:'Подтверждённых критических сигналов нет, но экономика рассчитана только для '+coverage.toFixed(1)+'% продаж. Нельзя считать риск магазина низким, пока не проверены исключённые товары.'};
  return {label:'Низкий',level:'low',summary:'Критических сигналов и предупреждений не найдено · покрытие продаж: '+coverage.toFixed(1)+'%. Это не гарантия отсутствия рисков.'};
 }
 const api={assessRisk};root.OzonRiskReadiness=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
