"use strict";
/* worktime-benchmark.js: 作業時間を過去実績と比較する。
   ------------------------------------------------------------
   明細(用途名・製造材質・製造調質・実績板厚・実績板幅・丈割数・条割数)と
   アプリ登録設備が一致する完了データを端末内IndexedDBから集計し、過去の
   平均作業時間・N数・バラつき(標準偏差)を、測定メイン画面の「作業時間」
   タブに表示する。今回(このロット)の作業時間(または作業中の場合は経過
   時間)との差分も併せて表示する。

   実績板厚・実績板幅は、実測した板厚・板幅の平均値(実績カレンダー機能と
   同じ考え方)を使う。グルーピングの揺れを抑えるため、板厚は小数2桁、
   板幅は小数1桁に丸めて比較する。
   ============================================================ */
(function(){
  if(typeof $!=='function'||typeof idbAll!=='function'||typeof durationMs!=='function')return;

  function avgMeasured(grid,rowLimit,colLimit){
    let sum=0,n=0;const rows=Math.min((grid||[]).length,Math.max(1,rowLimit||0));
    for(let i=0;i<rows;i++){
      const row=grid[i]||[];const cols=Math.min(row.length,Math.max(1,colLimit||0));
      for(let j=0;j<cols;j++){
        const raw=row[j];if(raw===''||raw==null)continue;
        const v=Number(raw);if(Number.isFinite(v)){sum+=v;n++}
      }
    }
    return n>0?sum/n:null;
  }

  function profileOf(x){
    const b=x.basic||{},s=x.settings||{};
    const vc=Math.max(1,+s.verticalCount||1),hc=Math.max(1,+s.horizontalCount||1);
    const avgThk=avgMeasured(x.measurements?.thickness,vc,3),avgWid=avgMeasured(x.measurements?.width,vc,hc);
    if(avgThk==null||avgWid==null)return null;
    return{
      purposeName:b.purposeName||'',mfgMaterial:b.mfgMaterial||'',mfgTemper:b.mfgTemper||'',
      thickness:Math.round(avgThk*100)/100,width:Math.round(avgWid*10)/10,
      verticalCount:vc,horizontalCount:hc,equipment:s.registeredEquipment||''
    };
  }
  function profileKey(p){return p?[p.purposeName,p.mfgMaterial,p.mfgTemper,p.thickness,p.width,p.verticalCount,p.horizontalCount,p.equipment].join('|'):''}

  function stdDev(values,mean){
    if(values.length<2)return 0;
    const variance=values.reduce((a,v)=>a+(v-mean)**2,0)/values.length;
    return Math.sqrt(variance);
  }

  async function benchmarkFor(record){
    const profile=profileOf(record);
    if(!profile)return{profile:null};
    if(!profile.equipment)return{profile,noEquipment:true};
    const key=profileKey(profile);
    const all=await idbAll();
    const matches=all.filter(x=>{
      if(x.id===record.id)return false;
      if(x.status!=='完了')return false;
      const p=profileOf(x);
      return p&&profileKey(p)===key;
    });
    const durations=matches.map(x=>durationMs(x)).filter(ms=>ms!=null&&ms>0).map(ms=>ms/60000);
    const result={profile,n:durations.length};
    if(durations.length){
      const avg=durations.reduce((a,v)=>a+v,0)/durations.length;
      result.avgMin=avg;result.sdMin=stdDev(durations,avg);
    }
    const w=record.workTime||{};
    if(w.startAt&&w.endAt){
      result.currentMin=durationMs(record)/60000;result.currentLive=false;
    }else if(w.startAt){
      result.currentMin=(Date.now()-new Date(w.startAt).getTime())/60000;result.currentLive=true;
    }
    if(result.currentMin!=null&&Number.isFinite(result.avgMin))result.diffMin=result.currentMin-result.avgMin;
    return result;
  }

  function fmtMin(min){
    if(min==null||!Number.isFinite(min))return '-';
    const sign=min<0?'-':'',abs=Math.abs(min),h=Math.floor(abs/60),m=Math.round(abs%60);
    return sign+(h>0?`${h}時間${m}分`:`${m}分`);
  }

  function ensureCard(){
    let card=$('#worktimeBenchmark');
    if(card)return card;
    card=document.createElement('div');card.id='worktimeBenchmark';card.className='worktime-benchmark';
    const hint=$('#workTimeHint');
    if(hint&&hint.parentNode)hint.insertAdjacentElement('afterend',card);
    else document.querySelector('.work-time-panel')?.appendChild(card);
    return card;
  }

  function renderBenchmarkCard(result){
    const card=ensureCard();
    if(!result||!result.profile){
      card.innerHTML='<div class="wtb-empty">実績板厚・板幅が測定されていないため、過去実績とは比較できません。</div>';
      return;
    }
    if(result.noEquipment){
      card.innerHTML='<div class="wtb-empty">使用設備が未登録のため、過去実績とは比較できません。</div>';
      return;
    }
    if(!result.n){
      card.innerHTML='<div class="wtb-empty">同条件(用途名・製造材質・調質・実績板厚幅・丈割数・条割数・使用設備)の完了実績はまだありません。今回が最初の記録になります。</div>';
      return;
    }
    const hasCurrent=result.currentMin!=null;
    const diffCell=hasCurrent&&Number.isFinite(result.diffMin)
      ?`<div class="wtb-cell ${result.diffMin>0?'wtb-slower':'wtb-faster'}"><small>平均比</small><b>${result.diffMin>0?'+':''}${esc(fmtMin(result.diffMin))}</b></div>`
      :'';
    card.innerHTML=`
      <div class="wtb-title">過去実績との比較<small>(同条件 N=${result.n}件)</small></div>
      <div class="wtb-grid">
        <div class="wtb-cell"><small>過去平均</small><b>${esc(fmtMin(result.avgMin))}</b></div>
        <div class="wtb-cell"><small>バラつき(σ)</small><b>±${esc(fmtMin(result.sdMin))}</b></div>
        <div class="wtb-cell"><small>${result.currentLive?'経過(作業中)':'今回'}</small><b>${hasCurrent?esc(fmtMin(result.currentMin)):'未計測'}</b></div>
        ${diffCell}
      </div>`;
  }

  let refreshing=false,pending=false;
  async function refreshBenchmark(){
    if(!S.measure)return;
    if(refreshing){pending=true;return}
    refreshing=true;
    try{
      const result=await benchmarkFor(S.measure);
      if(S.measure)renderBenchmarkCard(result);
    }catch(e){console.warn('作業時間比較の取得に失敗しました',e)}
    finally{
      refreshing=false;
      if(pending){pending=false;refreshBenchmark()}
    }
  }

  let liveTimer=null;
  function ensureLiveTimer(){
    clearInterval(liveTimer);liveTimer=null;
    const w=S.measure?.workTime||{};
    if(w.startAt&&!w.endAt)liveTimer=setInterval(refreshBenchmark,30000);
  }

  let debounceTimer=null;
  function scheduleRefresh(){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>{refreshBenchmark();ensureLiveTimer()},700)}

  if(typeof renderMeasurement==='function'){
    const baseRender=renderMeasurement;
    renderMeasurement=function(){baseRender();refreshBenchmark();ensureLiveTimer()};
  }
  if(typeof markDirty==='function'){
    const baseMarkDirty=markDirty;
    markDirty=function(){baseMarkDirty();scheduleRefresh()};
  }
  if(typeof saveLocal==='function'){
    const baseSaveLocal=saveLocal;
    saveLocal=async function(status){const r=await baseSaveLocal(status);refreshBenchmark();return r};
  }
})();
