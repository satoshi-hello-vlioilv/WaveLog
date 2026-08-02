"use strict";
/* schedule-view.js: 作業スケジュール画面(順次作業表示、docs/SCHEDULE_MODE_DESIGN.md §9)。

既存のcal-mode/rp-mode/db-modeと同じ「メイン画面の表示切り替え」方式で、
#grid の兄弟要素としてパネルを差し込みbody.sc-modeで他要素を隠す
(report-dashboard.js/calendar-view.jsと同じ実装パターン)。

モード別の差分(§9.6):
  edit     自端末の使用設備で固定表示(設備セレクタ無し)。現場段取り可否が
           真の端末だけドラッグ並べ替え可(§9.4.1の簡易表示、追加パネル等は出さない)
  view     全設備選択可(▾)。読み取り専用
  schedule 全設備選択可(▾)。追加・並べ替え・設備停止投入が可能

時刻展開・実績突合はbackend/schedule_calc.py(GET /api/schedule/plan)が
行う。ここは表示に徹する(CLAUDE.mdの「関数の定義は1箇所」、§7.1)。 */
(function(){
 if(typeof $!=='function')return;

 let scState={equipment:'',entries:[],anchor:null,warnings:[],configured:true,
              editable:false,pickerEnabled:false,stopReasons:[],dragId:null};
 let scLockTimer=null;

 function fmtDateTime(iso){
  if(!iso)return '-';
  const d=new Date(iso);
  return Number.isNaN(d.getTime())?'-':d.toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 }
 function fmtRelative(minutes){
  if(minutes===null||minutes===undefined)return '';
  const m=Math.round(minutes);
  if(m<=0)return '今';
  if(m<60)return `${m}分後`;
  if(m<1440)return `${Math.floor(m/60)}時間${m%60?(m%60)+'分':''}後`;
  const days=Math.floor(m/1440),rem=m%1440;
  return `${days}日${rem?Math.floor(rem/60)+'時間':''}後`;
 }
 function fmtMinutes(m){
  if(m===null||m===undefined)return '-';
  const v=Math.round(m);
  if(v<60)return `${v}分`;
  return `${Math.floor(v/60)}時間${v%60?(v%60)+'分':''}`;
 }
 function fmtLocalInput(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
 }

 /* ---------- パネルDOM ---------- */
 function ensurePanel(){
  let panel=$('#schedulePanel');if(panel)return panel;
  panel=document.createElement('section');panel.className='sc-panel';panel.id='schedulePanel';panel.hidden=true;
  panel.innerHTML=`
   <div class="sc-head">
    <div class="sc-head-left">
     <b class="sc-title">作業スケジュール</b>
     <select class="sc-equipment-select" id="scEquipmentSelect" hidden></select>
     <span class="sc-equipment-fixed" id="scEquipmentFixed" hidden></span>
     <span class="sc-lock-badge" id="scLockBadge" hidden></span>
    </div>
    <div class="sc-head-right">
     <span class="sc-field-reorder-note" id="scFieldReorderNote" hidden>現場段取り: 並べ替えのみ可能</span>
     <button type="button" class="sc-refresh" id="scRefresh">再計算</button>
     <button type="button" class="sc-close" id="scClose" title="閉じる">×</button>
    </div>
   </div>
   <div class="sc-warnings" id="scWarnings" hidden></div>
   <div class="sc-body">
    <div class="sc-timeline" id="scTimeline"></div>
    <div class="sc-side" id="scSide" hidden>
     <div class="sc-side-section">
      <div class="sc-side-title">仕掛から追加</div>
      <div class="sc-add-from-list" id="scAddFromList"><div class="sc-empty-note">仕掛一覧で行を選択してください</div></div>
     </div>
     <div class="sc-side-section">
      <div class="sc-side-title">設備停止を追加</div>
      <div class="sc-stop-buttons" id="scStopButtons"><div class="sc-empty-note">設備停止マスタが未登録です</div></div>
     </div>
    </div>
   </div>`;
  const grid=$('#grid');
  if(grid&&grid.parentNode)grid.parentNode.insertBefore(panel,grid);else document.body.appendChild(panel);
  $('#scClose').onclick=exitScheduleView;
  $('#scRefresh').onclick=()=>refreshAll();
  $('#scEquipmentSelect').onchange=e=>{scState.equipment=e.target.value;refreshAll()};
  return panel;
 }

 /* ---------- ビュー排他制御 ---------- */
 function exitScheduleView(){
  if(!document.body.classList.contains('sc-mode'))return;
  document.body.classList.remove('sc-mode');
  document.getElementById('schedulePanel')?.setAttribute('hidden','');
  document.getElementById('openSchedule')?.classList.remove('active');
  stopLockPolling();
 }
 window.exitScheduleView=exitScheduleView;
 if(typeof selectDb==='function'){const oldSelectDb=selectDb;selectDb=async function(k,b){exitScheduleView();return oldSelectDb(k,b)}}

 async function openScheduleView(){
  window.exitCalendarView?.();
  document.body.classList.remove('qa-mode','qa-view-raw');
  document.getElementById('reportPanel')?.setAttribute('hidden','');document.body.classList.remove('rp-mode');
  document.getElementById('dashboardPanel')?.setAttribute('hidden','');document.body.classList.remove('db-mode');
  document.getElementById('recordModal')?.setAttribute('hidden','');
  document.getElementById('measureModal')?.setAttribute('hidden','');
  document.querySelectorAll('#nav button.db,#analysisNav button.db,#planNav button.db').forEach(b=>b.classList.remove('active'));
  document.body.classList.add('sc-mode');
  document.getElementById('openSchedule')?.classList.add('active');
  const panel=ensurePanel();panel.hidden=false;

  const am=window.accessMode||{mode:'edit',canFieldReorder:false,fieldReorderEquipment:''};
  // fullControl: 追加・削除・設備停止投入まで可能なのはscheduleモードだけ
  // (§3.1.1のとおり、現場段取りは並べ替え1操作のみに限定する)。
  scState.fullControl=(am.mode==='schedule');
  scState.editable=scState.fullControl||(am.mode==='edit'&&am.canFieldReorder);
  scState.fieldReorderOnly=(am.mode==='edit'&&am.canFieldReorder);
  scState.pickerEnabled=(am.mode!=='edit');
  $('#scFieldReorderNote').hidden=!scState.fieldReorderOnly;
  $('#scSide').hidden=!scState.fullControl;

  if(am.mode==='edit'){
   const eq=currentConfiguredEquipment();
   if(!eq){renderUnconfigured();return}
   scState.equipment=eq;
  }
  await renderEquipmentControl(am);
  if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
  startLockPolling();
 }
 window.openScheduleView=openScheduleView;

 function renderUnconfigured(){
  $('#scTimeline').innerHTML='<div class="sc-empty-note">使用設備が未登録です。まず使用設備を設定してください。</div>';
  $('#scEquipmentFixed').hidden=true;$('#scEquipmentSelect').hidden=true;
 }

 async function renderEquipmentControl(am){
  const sel=$('#scEquipmentSelect'),fixed=$('#scEquipmentFixed');
  if(scState.pickerEnabled){
   fixed.hidden=true;sel.hidden=false;
   if(typeof loadEquipmentMaster==='function')await loadEquipmentMaster();
   const items=(typeof equipmentMasterState!=='undefined'?equipmentMasterState.items:[])||[];
   sel.innerHTML='<option value="">設備を選択...</option>'+items.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('');
   sel.value=scState.equipment||'';
  }else{
   sel.hidden=true;fixed.hidden=false;
   fixed.textContent=`設備: ${scState.equipment}(使用設備)`;
  }
 }

 /* ---------- ロック表示(§9.3、数秒間隔でポーリング) ---------- */
 async function refreshLockBadge(){
  try{
   const r=await api('/api/schedule/lock-status');
   const badge=$('#scLockBadge');if(!badge)return;
   if(r.configured&&r.locked){
    badge.hidden=false;badge.textContent=`編集中: ${r.holderLogin||'?'}@${r.holderPc||'?'}`;
   }else{
    badge.hidden=true;
   }
  }catch(e){/* ロック表示はベストエフォート */}
 }
 function startLockPolling(){
  stopLockPolling();
  refreshLockBadge();
  scLockTimer=setInterval(refreshLockBadge,5000);
 }
 function stopLockPolling(){if(scLockTimer){clearInterval(scLockTimer);scLockTimer=null}}

 /* ---------- 予定一覧の取得・描画 ---------- */
 async function refreshAll(){
  await loadPlan();
  if(scState.fullControl)await loadStopReasons();
 }
 async function loadPlan(){
  if(!scState.equipment)return;
  const timeline=$('#scTimeline');
  timeline.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(scState.equipment));
   if(!r.configured){
    timeline.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   scState.entries=r.entries||[];scState.anchor=r.anchor;scState.warnings=r.warnings||[];
   renderWarnings();renderTimeline();
  }catch(e){
   timeline.innerHTML=`<div class="sc-empty-note">予定を取得できませんでした: ${esc(e.message)}</div>`;
  }
 }

 function renderWarnings(){
  const box=$('#scWarnings');
  if(!scState.warnings.length){box.hidden=true;box.innerHTML='';return}
  box.hidden=false;
  box.innerHTML=scState.warnings.map(w=>`<div class="sc-warning">⚠ ${esc(w)}</div>`).join('');
 }

 function renderTimelineMessage(msg){
  $('#scTimeline').innerHTML=`<div class="sc-empty-note">${esc(msg)}</div>`;
 }

 /* ---------- 見積の内訳(§6.8・§9.3、負荷率モデルの根拠を開示) ---------- */
 function estimateSourceLabel(src){
  return {model:'モデル',override:'手動上書き','stop-reason-master':'設備停止マスタ',remaining:'残り時間',default:'暫定既定値'}[src]||src||'';
 }
 function factorSourceLabel(src){
  return {auto:'自動',override:'上書き',unknown:'未知'}[src]||src||'';
 }
 function renderEstimateBreakdown(e){
  const est=e.estimate;
  if(!est||!est.factors||!est.factors.length)return '';
  const baseLine=est.base?`<div class="sc-estimate-row sc-estimate-base">基準時間 T0=${fmtMinutes(est.base.T0)}(実績${est.base.n}件)</div>`:'';
  const rangeLine=(est.low!=null&&est.high!=null)?`<div class="sc-estimate-row sc-estimate-range">予測区間 ${fmtMinutes(est.low)} 〜 ${fmtMinutes(est.high)}</div>`:'';
  const rows=est.factors.map(f=>
   `<div class="sc-estimate-factor sc-ef-source-${esc(f.source)}"><span class="sc-ef-key">${esc(f.key)}</span><span class="sc-ef-level">${esc(f.level)}</span>`+
   `<span class="sc-ef-value">×${f.value}</span><span class="sc-ef-n">n=${f.n}</span><span class="sc-ef-source">${factorSourceLabel(f.source)}</span></div>`
  ).join('');
  return `<button type="button" class="sc-estimate-toggle" data-target="scEstimateDetail-${e.id}">見積の内訳 ▾</button>
   <div class="sc-estimate-detail" id="scEstimateDetail-${e.id}" hidden>${baseLine}${rangeLine}${rows}</div>`;
 }

 function stateBadgeClass(state){
  if(state==='完了')return 'sc-state-done';
  if(state==='着手')return 'sc-state-active';
  if(state==='取消')return 'sc-state-cancel';
  return 'sc-state-planned';
 }

 function renderTimeline(){
  const timeline=$('#scTimeline');
  if(!scState.entries.length){
   timeline.innerHTML='<div class="sc-empty-note">この設備の予定はまだありません。</div>';
   return;
  }
  timeline.innerHTML='';
  let lastEnd=null;
  scState.entries.forEach(e=>{
   if(e.plannedStart&&lastEnd){
    const gapMin=(new Date(e.plannedStart)-new Date(lastEnd))/60000;
    if(gapMin>1){
     const isFixedGap=e.fixedStart&&Math.abs(new Date(e.fixedStart)-new Date(e.plannedStart))<60000;
     const div=document.createElement('div');
     div.className='sc-gap-divider';
     div.textContent=`── ${fmtMinutes(gapMin)}の空き (${fmtDateTime(lastEnd)}〜${fmtDateTime(e.plannedStart)})${isFixedGap?' ・固定開始時刻待ち':''} ──`;
     timeline.append(div);
    }
   }
   if(e.plannedEnd)lastEnd=e.plannedEnd;
   const card=document.createElement('article');
   card.className='sc-card '+stateBadgeClass(e.state);
   card.dataset.id=e.id;
   const canDrag=scState.editable&&e.reorderable;
   card.draggable=canDrag;
   if(canDrag)card.tabIndex=0;
   const kindLabel=e.kind==='設備停止'?'設備停止':'作業';
   const lotLine=e.kind==='作業'
    ?`${esc(e.lotNo||'-')} ${esc(e.detail?.purposeName||'')} ${esc(e.detail?.mfgMaterial||'')}${e.detail?.mfgTemper?'-'+esc(e.detail.mfgTemper):''}`
    :esc(e.title||'設備停止');
   const timeLine=e.plannedStart
    ?`${fmtDateTime(e.plannedStart)} 〜 ${fmtDateTime(e.plannedEnd)}${e.state==='予定'?` (${fmtRelative(e.startsInMinutes)})`:''}`
    :(e.state==='完了'||e.state==='取消'?'':'時刻を特定できません');
   const estimateLine=e.estimate?`見積 ${fmtMinutes(e.estimate.minutes)}${e.estimate.source==='default'?' ('+estimateSourceLabel('default')+')':''}`:'';
   let actualLine='';
   if(e.actual){
    if(e.state==='着手')actualLine=`経過 ${fmtMinutes(e.actual.elapsedMinutes)}`;
    else if(e.state==='完了')actualLine=`実績 ${fmtMinutes(e.actual.minutes)}${e.actual.varianceMinutes!=null?`(差${e.actual.varianceMinutes>=0?'+':''}${Math.round(e.actual.varianceMinutes)}分)`:''}`;
   }
   const overdue=e.overdueMinutes>0?`<span class="sc-overdue">${Math.round(e.overdueMinutes)}分押しています</span>`:'';
   const spans=e.spansNonWorking?'<span class="sc-spans">夜間・休日を跨ぎます</span>':'';
   card.innerHTML=`
    <div class="sc-card-handle" title="${canDrag?'ドラッグで並べ替え':''}">${canDrag?'⠿':(e.state==='着手'?'🔒':'')}</div>
    <div class="sc-card-body">
     <div class="sc-card-top"><span class="sc-kind">${esc(kindLabel)}</span><span class="sc-state">${esc(e.state)}</span></div>
     <div class="sc-card-title">${lotLine}</div>
     <div class="sc-card-time">${timeLine}</div>
     <div class="sc-card-meta">${estimateLine}${actualLine?' / '+actualLine:''}${overdue}${spans}</div>
     ${renderFixedStartControl(e)}
     ${renderEstimateBreakdown(e)}
    </div>
    ${scState.fullControl&&e.state==='予定'?'<button type="button" class="sc-card-delete" title="削除">削除</button>':''}`;
   if(canDrag)wireDrag(card);
   const del=card.querySelector('.sc-card-delete');
   if(del)del.onclick=ev=>{ev.stopPropagation();deleteEntry(e.id)};
   const fsInput=card.querySelector('.sc-fixed-start-input');
   if(fsInput)fsInput.onchange=()=>updateFixedStart(e.id,fsInput.value);
   const fsClear=card.querySelector('.sc-fixed-start-clear');
   if(fsClear)fsClear.onclick=ev=>{ev.stopPropagation();updateFixedStart(e.id,'')};
   const toggle=card.querySelector('.sc-estimate-toggle');
   if(toggle)toggle.onclick=ev=>{
    ev.stopPropagation();
    const detail=document.getElementById(toggle.dataset.target);
    if(!detail)return;
    detail.hidden=!detail.hidden;
    toggle.textContent='見積の内訳 '+(detail.hidden?'▾':'▴');
   };
   timeline.append(card);
  });
 }

 /* ---------- 固定開始日時(§5.1・§7.3、フェーズ6) ---------- */
 function renderFixedStartControl(e){
  if(scState.fullControl&&e.state==='予定'){
   return `<div class="sc-fixed-start">
    <label>固定開始<input type="datetime-local" class="sc-fixed-start-input" data-id="${e.id}" value="${fmtLocalInput(e.fixedStart)}"></label>
    ${e.fixedStart?`<button type="button" class="sc-fixed-start-clear" data-id="${e.id}" title="固定開始日時を解除">解除</button>`:''}
   </div>`;
  }
  if(e.fixedStart)return `<div class="sc-fixed-start-readonly">固定開始 ${fmtDateTime(e.fixedStart)}</div>`;
  return '';
 }
 async function updateFixedStart(id,localValue){
  const iso=localValue?new Date(localValue).toISOString():null;
  try{
   await api('/api/schedule/plan/update',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({id,fixedStart:iso}))});
   await loadPlan();
  }catch(e){showToast&&showToast('固定開始日時の更新に失敗しました',e.message,5000)}
 }

 async function deleteEntry(id){
  if(typeof confirmModal==='function'){
   const ok=await confirmModal({message:'この予定を削除します。よろしいですか？'});
   if(!ok)return;
  }
  try{
   await api('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id}))});
   await loadPlan();
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
 }

 /* ---------- ドラッグ並べ替え(§7.5・§9.4) + Alt+↑/↓ ---------- */
 function reorderableIds(){return scState.entries.filter(e=>e.reorderable).map(e=>e.id)}

 function wireDrag(card){
  card.addEventListener('dragstart',e=>{scState.dragId=+card.dataset.id;card.classList.add('sc-dragging');e.dataTransfer.effectAllowed='move'});
  card.addEventListener('dragend',()=>{card.classList.remove('sc-dragging');scState.dragId=null});
  card.addEventListener('dragover',e=>{
   if(scState.dragId==null)return;
   e.preventDefault();
   const target=card;if(+target.dataset.id===scState.dragId)return;
   const rect=target.getBoundingClientRect();
   const before=(e.clientY-rect.top)<rect.height/2;
   const dragEl=$('.sc-card[data-id="'+scState.dragId+'"]');
   if(!dragEl)return;
   target.parentNode.insertBefore(dragEl,before?target:target.nextSibling);
  });
  card.addEventListener('drop',e=>{e.preventDefault();commitDragOrder()});
  card.addEventListener('keydown',e=>{
   if(!e.altKey)return;
   if(e.key==='ArrowUp'){e.preventDefault();moveCard(card,-1)}
   else if(e.key==='ArrowDown'){e.preventDefault();moveCard(card,1)}
  });
 }
 function moveCard(card,dir){
  const sibling=dir<0?card.previousElementSibling:card.nextElementSibling;
  if(!sibling||!sibling.classList.contains('sc-card'))return;
  if(dir<0)card.parentNode.insertBefore(card,sibling);
  else card.parentNode.insertBefore(sibling,card);
  card.focus();
  commitDragOrder();
 }
 async function commitDragOrder(){
  const ids=[...document.querySelectorAll('#scTimeline .sc-card')].map(c=>+c.dataset.id).filter(id=>reorderableIds().includes(id));
  try{
   await api('/api/schedule/plan/reorder',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:scState.equipment,orderedIds:ids}))});
   await loadPlan();
  }catch(e){
   showToast&&showToast('並べ替えに失敗しました',e.message,5000);
   await loadPlan();
  }
 }

 /* ---------- 追加パネル(scheduleモードのみ、§9.3) ---------- */
 async function loadStopReasons(){
  try{
   const r=await api('/api/schedule/stop-reason-master?equipment='+encodeURIComponent(scState.equipment));
   scState.stopReasons=(r.items||[]);
   renderStopButtons();
  }catch(e){/* 追加パネルは補助機能のためベストエフォート */}
 }
 function renderStopButtons(){
  const box=$('#scStopButtons');if(!box)return;
  if(!scState.stopReasons.length){box.innerHTML='<div class="sc-empty-note">設備停止マスタが未登録です</div>';return}
  box.innerHTML=scState.stopReasons.map(s=>{
   const isSudden=s.name==='突発停止';
   return `<button type="button" class="sc-stop-button${isSudden?' is-disabled':''}" data-id="${s.id}" ${isSudden?'title="発生時は計画担当へ連絡してください"':''}>${esc(s.name)}${s.standardMinutes?` (${fmtMinutes(s.standardMinutes)})`:''}</button>`;
  }).join('');
  box.querySelectorAll('.sc-stop-button').forEach(btn=>{
   if(btn.classList.contains('is-disabled')){btn.disabled=true;return}
   btn.onclick=async()=>{
    try{
     await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(withUserId({equipment:scState.equipment,kind:'設備停止',position:'end',stopReasonId:+btn.dataset.id}))});
     await loadPlan();
    }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
   };
  });
 }

 function renderAddFromListPanel(){
  const box=$('#scAddFromList');if(!box)return;
  if(typeof S==='undefined'||S.db!=='SIKALOTNOW'||!S.selectedRow){
   box.innerHTML='<div class="sc-empty-note">仕掛一覧で行を選択してください</div>';return;
  }
  const row=S.selectedRow;
  box.innerHTML=`<div class="sc-add-row"><b>${esc(pick(row,'lotNo')||'-')}</b> ${esc(pick(row,'purposeName')||'')} ${esc(pick(row,'mfgMaterial')||'')}
   <button type="button" class="sc-add-row-button" id="scAddSelectedRow">この設備の予定へ</button></div>`;
  const btn=$('#scAddSelectedRow');
  if(btn)btn.onclick=()=>addRowToSchedule(row,scState.equipment);
 }
 window.scRefreshAddFromListPanel=function(){if(document.body.classList.contains('sc-mode'))renderAddFromListPanel()};

 async function addRowToSchedule(row,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  const detail={};
  Object.keys(aliases).forEach(k=>{const v=pick(row,k);if(v!==undefined&&v!==null&&v!=='')detail[k]=v});
  try{
   await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:target,kind:'作業',position:'end',
     lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail}))});
   showToast&&showToast('予定へ追加しました',`${target}の予定に追加しました`,3200);
   if(scState.equipment===target)await loadPlan();
  }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
 }
 window.scheduleAddFromRow=function(row){addRowToSchedule(row,pick(row,'equipment')||'')};

 /* ---------- ナビ ----------
    「作業スケジュール」は全モードで常時表示するため(§9.1)、動的注入
    (calendar-view.js/report-dashboard.jsの分析系ボタンと同じ方式)ではなく
    templates/index.htmlに静的に置いたボタンへ直接配線する。 */
 const navBtn=document.getElementById('openSchedule');
 if(navBtn)navBtn.onclick=()=>openScheduleView().catch(e=>console.error(e));
})();
