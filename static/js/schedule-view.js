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
              editable:false,pickerEnabled:false,stopReasons:[],dragId:null,
              boardMode:'single',boardWindowHours:24,overview:[],overviewSort:'order'};
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
 // 高密度リスト(§9.3改訂)用の短縮時間表記。「見積」「実績」等、ヘッダーで
 // 単位の文脈が既に分かっている列でだけ使う(h:mm・分単位はfmtMinutesと
 // 使い分け、見積の内訳などの詳細表示は従来どおりfmtMinutesの文言を使う)。
 function fmtCompact(m){
  if(m===null||m===undefined)return '-';
  const v=Math.round(m);
  const h=Math.floor(v/60),mm=v%60;
  return h>0?`${h}:${String(mm).padStart(2,'0')}`:`${mm}分`;
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
     <div class="sc-mode-toggle" id="scModeToggle" hidden>
      <button type="button" class="sc-mode-toggle-btn" id="scModeBoard" data-mode="board">▦ 全体</button>
      <button type="button" class="sc-mode-toggle-btn" id="scModeSingle" data-mode="single">☰ 個別</button>
     </div>
     <select class="sc-equipment-select" id="scEquipmentSelect" hidden></select>
     <span class="sc-equipment-fixed" id="scEquipmentFixed" hidden></span>
     <span class="sc-lock-badge" id="scLockBadge" hidden></span>
    </div>
    <div class="sc-head-right">
     <div class="sc-board-window" id="scBoardWindow" hidden>
      <button type="button" class="sc-board-window-btn" data-hours="24">24時間</button>
      <button type="button" class="sc-board-window-btn" data-hours="48">48時間</button>
     </div>
     <span class="sc-field-reorder-note" id="scFieldReorderNote" hidden>現場段取り: 並べ替えのみ可能</span>
     <button type="button" class="sc-refresh" id="scRefresh">再計算</button>
     <button type="button" class="sc-close" id="scClose" title="閉じる">×</button>
    </div>
   </div>
   <div class="sc-warnings" id="scWarnings" hidden></div>
   <div class="sc-board" id="scBoard" hidden></div>
   <div class="sc-body" id="scSingleBody">
    <div class="sc-timeline" id="scTimeline"></div>
    <div class="sc-side" id="scSide" hidden>
     <div class="sc-side-section">
      <div class="sc-side-title">仕掛から追加</div>
      <p class="sc-side-hint">ロット番号の一部を入力すると、この画面から直接追加できます。</p>
      <input type="text" class="sc-lot-search-input" id="scLotSearch" placeholder="ロット番号で検索...">
      <div class="sc-lot-search-results" id="scLotSearchResults"></div>
      <div class="sc-add-from-list" id="scAddFromList"></div>
     </div>
     <div class="sc-side-section">
      <div class="sc-side-title">設備停止を追加</div>
      <div class="sc-stop-groups" id="scStopButtons"><div class="sc-empty-note">設備停止マスタが未登録です</div></div>
     </div>
    </div>
   </div>`;
  const grid=$('#grid');
  if(grid&&grid.parentNode)grid.parentNode.insertBefore(panel,grid);else document.body.appendChild(panel);
  $('#scClose').onclick=exitScheduleView;
  $('#scRefresh').onclick=()=>refreshCurrentMode();
  $('#scEquipmentSelect').onchange=e=>{scState.equipment=e.target.value;switchToSingle()};
  $('#scModeBoard').onclick=()=>switchToBoard();
  $('#scModeSingle').onclick=()=>switchToSingle();
  panel.querySelectorAll('.sc-board-window-btn').forEach(btn=>{
   btn.onclick=()=>{
    scState.boardWindowHours=+btn.dataset.hours;
    panel.querySelectorAll('.sc-board-window-btn').forEach(b=>b.classList.toggle('active',b===btn));
    renderOverviewBoard();
   };
  });
  wireLotSearch();
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
  // schedule/viewモードでは、設備を1つ選ぶ前に「全設備の中でどこが空いて
  // いるか」を見せる俯瞰ボードを既定表示にする(§9.9)。editモードは自設備
  // 固定のため俯瞰ボードの意味が無く、常に個別タイムラインのみ。
  scState.boardMode=scState.pickerEnabled?'board':'single';
  await renderEquipmentControl(am);
  applyBoardModeUi();
  if(scState.boardMode==='board')await loadOverviewBoard();
  else if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
  startLockPolling();
 }
 window.openScheduleView=openScheduleView;

 /* ---------- 全体/個別の表示切替(§9.9) ---------- */
 function applyBoardModeUi(){
  const inBoard=scState.boardMode==='board';
  const toggle=$('#scModeToggle');if(toggle)toggle.hidden=!scState.pickerEnabled;
  $('#scModeBoard').classList.toggle('active',inBoard);
  $('#scModeSingle').classList.toggle('active',!inBoard);
  $('#scBoard').hidden=!inBoard;
  $('#scSingleBody').hidden=inBoard;
  $('#scBoardWindow').hidden=!inBoard;
  if(scState.pickerEnabled)$('#scEquipmentSelect').hidden=inBoard;
  $('#scSide').hidden=!scState.fullControl||inBoard;
  document.querySelectorAll('.sc-board-window-btn').forEach(btn=>btn.classList.toggle('active',+btn.dataset.hours===scState.boardWindowHours));
  // 仕掛一覧側で先に行を選択してからこの画面を開いた場合でも、追加パネルが
  // 静的な初期表示のまま取り残されないよう、表示状態が変わるたびに同期する。
  if(!inBoard&&scState.fullControl)renderAddFromListPanel();
 }
 async function switchToBoard(){
  if(!scState.pickerEnabled)return;
  scState.boardMode='board';
  applyBoardModeUi();
  await loadOverviewBoard();
 }
 async function switchToSingle(){
  scState.boardMode='single';
  applyBoardModeUi();
  if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
 }
 function refreshCurrentMode(){
  return scState.boardMode==='board'?loadOverviewBoard():refreshAll();
 }

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

 /* ---------- 全体俯瞰ボード(§9.9) ----------
    設備ごとに1行、右側へ「残作業量」を色分けした帯(次24/48時間の
    ミニタイムライン)を並べる。時刻計算はGET /api/schedule/overview
    (backend/schedule_calc.expand_plan()を設備分ループしたもの)に
    一本化し、ここでは色分け・幅計算などの表示ロジックのみを行う
    (CLAUDE.mdの「関数の定義は1箇所」、§7.1と同じ方針)。 */
 function loadLevelClass(pendingMinutes){
  if(!pendingMinutes)return 'sc-lv-0';
  if(pendingMinutes<=120)return 'sc-lv-1';
  if(pendingMinutes<=360)return 'sc-lv-2';
  return 'sc-lv-3';
 }
 async function loadOverviewBoard(){
  const board=$('#scBoard');if(!board)return;
  board.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/overview');
   if(!r.configured){
    board.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   scState.overview=r.equipment||[];
   renderOverviewBoard();
  }catch(e){
   board.innerHTML=`<div class="sc-empty-note">俯瞰ボードを取得できませんでした: ${esc(e.message)}</div>`;
  }
 }
 function overviewRows(){
  const rows=scState.overview.slice();
  if(scState.overviewSort==='busy')rows.sort((a,b)=>(b.pendingMinutes||0)-(a.pendingMinutes||0));
  return rows;
 }
 function renderOverviewBoard(){
  const board=$('#scBoard');if(!board)return;
  if(!scState.overview.length){board.innerHTML='<div class="sc-empty-note">設備マスタが未登録です。</div>';return}
  const windowHours=scState.boardWindowHours;
  const windowMs=windowHours*3600000;
  const now=Date.now();
  const ticks=[];
  for(let h=0;h<=windowHours;h+=(windowHours>24?12:6))ticks.push(h);
  const axis=`<div class="sc-board-axis"><span class="sc-board-axis-label">設備</span><span class="sc-board-axis-track">${
    ticks.map(h=>`<span class="sc-board-axis-tick" style="left:${(h/windowHours*100).toFixed(2)}%">${h===0?'今':h+'h'}</span>`).join('')
   }</span></div>`;
  const rows=overviewRows().map(row=>{
   const lv=loadLevelClass(row.pendingMinutes);
   const swatchText=row.pendingMinutes?`残 ${fmtMinutes(row.pendingMinutes)}・${row.pendingCount}件`:'空き';
   const activeChip=row.active?'<span class="sc-board-active-chip">● 稼働中</span>':'';
   const overdueChip=row.maxOverdueMinutes>0?`<span class="sc-board-overdue-chip">⚠ 遅延 ${fmtMinutes(row.maxOverdueMinutes)}</span>`:'';
   const blocks=row.blocks.map(b=>{
    const start=new Date(b.plannedStart).getTime(),end=new Date(b.plannedEnd).getTime();
    const left=Math.max(0,(start-now)/windowMs*100);
    const right=Math.min(100,(end-now)/windowMs*100);
    if(right<=0||left>=100)return '';
    const width=Math.max(right-left,0.6);
    const cls=b.kind==='設備停止'?'sc-board-block-stop':(b.state==='着手'?'sc-board-block-active':'sc-board-block-planned');
    const title=`${esc(b.kind)} ${esc(b.lotNo||b.title||'')} ${fmtDateTime(b.plannedStart)}〜${fmtDateTime(b.plannedEnd)}`;
    return `<span class="sc-board-block ${cls}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${title}"></span>`;
   }).join('');
   return `<div class="sc-board-row" data-equipment="${esc(row.equipment)}" tabindex="0">
    <span class="sc-board-name">${esc(row.equipment)}</span>
    <span class="sc-board-swatch ${lv}">${esc(swatchText)}</span>
    <span class="sc-board-track">${blocks}</span>
    <span class="sc-board-flags">${activeChip}${overdueChip}</span>
    <span class="sc-board-chevron">›</span>
   </div>`;
  }).join('');
  board.innerHTML=`
   <div class="sc-board-toolbar">
    <div class="sc-board-sort">
     <button type="button" class="sc-board-sort-btn${scState.overviewSort==='order'?' active':''}" data-sort="order">表示順</button>
     <button type="button" class="sc-board-sort-btn${scState.overviewSort==='busy'?' active':''}" data-sort="busy">混雑順</button>
    </div>
   </div>
   ${axis}
   <div class="sc-board-rows">${rows}</div>`;
  board.querySelectorAll('.sc-board-sort-btn').forEach(btn=>{
   btn.onclick=()=>{scState.overviewSort=btn.dataset.sort;renderOverviewBoard()};
  });
  board.querySelectorAll('.sc-board-row').forEach(row=>{
   const go=()=>{scState.equipment=row.dataset.equipment;$('#scEquipmentSelect').value=scState.equipment;switchToSingle()};
   row.onclick=go;
   row.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go()}};
  });
 }

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

 /* ---------- 見積の内訳(§6.8・§9.3、換算係数モデルの根拠を開示) ---------- */
 function estimateSourceLabel(src){
  return {model:'モデル',override:'手動上書き','stop-reason-master':'設備停止マスタ',remaining:'残り時間',default:'暫定既定値'}[src]||src||'';
 }
 function factorSourceLabel(src){
  return {auto:'自動',override:'上書き',unknown:'未知'}[src]||src||'';
 }
 function estimateBreakdownHtml(e){
  const est=e.estimate;
  if(!est||!est.factors||!est.factors.length)return '';
  const baseLine=est.base?`<div class="sc-estimate-row sc-estimate-base">基準時間 T0=${fmtMinutes(est.base.T0)}(実績${est.base.n}件)</div>`:'';
  const rangeLine=(est.low!=null&&est.high!=null)?`<div class="sc-estimate-row sc-estimate-range">予測区間 ${fmtMinutes(est.low)} 〜 ${fmtMinutes(est.high)}</div>`:'';
  const rows=est.factors.map(f=>
   `<div class="sc-estimate-factor sc-ef-source-${esc(f.source)}"><span class="sc-ef-key">${esc(f.key)}</span><span class="sc-ef-level">${esc(f.level)}</span>`+
   `<span class="sc-ef-value">×${f.value}</span><span class="sc-ef-n">n=${f.n}</span><span class="sc-ef-source">${factorSourceLabel(f.source)}</span></div>`
  ).join('');
  return `<div class="sc-detail-block"><div class="sc-detail-heading">見積の内訳</div>${baseLine}${rangeLine}${rows}</div>`;
 }

 /* ---------- 固定開始日時(§5.1・§7.3、フェーズ6) ---------- */
 function fixedStartHtml(e){
  if(scState.fullControl&&e.state==='予定'){
   return `<div class="sc-detail-block"><div class="sc-detail-heading">固定開始日時</div>
    <div class="sc-fixed-start">
     <input type="datetime-local" class="sc-fixed-start-input" data-id="${e.id}" value="${fmtLocalInput(e.fixedStart)}">
     ${e.fixedStart?`<button type="button" class="sc-fixed-start-clear" data-id="${e.id}" title="固定開始日時を解除">解除</button>`:''}
    </div></div>`;
  }
  if(e.fixedStart)return `<div class="sc-detail-block"><div class="sc-detail-heading">固定開始日時</div><div class="sc-fixed-start-readonly">${fmtDateTime(e.fixedStart)}</div></div>`;
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

 /* ---------- 高密度リスト表示(§9.3改訂) ----------
    「リスト形式並みの高密度、1ロット1行、20行程度見えるように」という
    要望に合わせ、従来の縦長カード(.sc-card)から表形式の1行(.sc-row-line)へ
    作り直した。列の意味はヘッダー行(ROW_HEAD_HTML)で1回だけ説明し、
    各行では値だけを詰めて出す。固定開始・見積の内訳は情報量が多く常時
    出すと行が伸びるため、1つの「▾ 詳細」トグルへ統合して折りたたむ
    (既定は閉、開くとその行の下に内訳ブロックが伸びる)。 */
 function fmtHM(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
 }
 function fmtTimeRange(startIso,endIso){
  if(!startIso)return '-';
  const startText=fmtHM(startIso);
  if(!endIso)return startText+'〜';
  const sameDay=new Date(startIso).toDateString()===new Date(endIso).toDateString();
  return `${startText}〜${fmtHM(endIso)}${sameDay?'':'(翌)'}`;
 }
 function stateIcon(kind,state){
  if(kind==='設備停止')return '⛔';
  return {'予定':'○','着手':'▶','完了':'✓','取消':'✕'}[state]||'○';
 }
 function stateRowClass(state){
  if(state==='完了')return 'sc-row-done';
  if(state==='着手')return 'sc-row-active';
  if(state==='取消')return 'sc-row-cancel';
  return 'sc-row-planned';
 }
 const ROW_HEAD_HTML=`<div class="sc-row-head">
  <span></span><span></span><span>時刻</span><span>残り</span><span>内容</span><span>見積</span><span>実績</span><span>備考</span><span>操作</span>
 </div>`;

 function renderTimeline(){
  const timeline=$('#scTimeline');
  if(!scState.entries.length){
   timeline.innerHTML='<div class="sc-empty-note">この設備の予定はまだありません。</div>';
   return;
  }
  timeline.innerHTML='';
  timeline.insertAdjacentHTML('beforeend',ROW_HEAD_HTML);
  let lastEnd=null;
  scState.entries.forEach(e=>{
   if(e.plannedStart&&lastEnd){
    const gapMin=(new Date(e.plannedStart)-new Date(lastEnd))/60000;
    if(gapMin>1){
     const isFixedGap=e.fixedStart&&Math.abs(new Date(e.fixedStart)-new Date(e.plannedStart))<60000;
     const div=document.createElement('div');
     div.className='sc-gap-divider';
     div.textContent=`── ${fmtMinutes(gapMin)}の空き・${fmtDateTime(lastEnd)}〜${fmtDateTime(e.plannedStart)}${isFixedGap?'・固定開始時刻待ち':''} ──`;
     timeline.append(div);
    }
   }
   if(e.plannedEnd)lastEnd=e.plannedEnd;

   const row=document.createElement('div');
   row.className='sc-row-line '+stateRowClass(e.state);
   row.dataset.id=e.id;
   const canDrag=scState.editable&&e.reorderable;
   row.draggable=canDrag;
   if(canDrag)row.tabIndex=0;

   const lotText=(e.kind==='作業'
    ?`${e.lotNo||'-'} ${e.detail?.purposeName||''} ${e.detail?.mfgMaterial||''}${e.detail?.mfgTemper?'-'+e.detail.mfgTemper:''}`
    :(e.title||'設備停止')).trim();
   const timeText=e.plannedStart?fmtTimeRange(e.plannedStart,e.plannedEnd):(e.state==='完了'||e.state==='取消'?'-':'未定');
   const timeTitle=e.plannedStart?`${fmtDateTime(e.plannedStart)} 〜 ${fmtDateTime(e.plannedEnd)}`:'';
   const relText=e.startsInMinutes!=null?(fmtRelative(e.startsInMinutes)||'今'):'-';
   const estText=e.estimate?fmtCompact(e.estimate.minutes):'-';
   const estDefault=e.estimate&&e.estimate.source==='default';
   let actualText='-';
   if(e.actual){
    if(e.state==='着手')actualText=fmtCompact(e.actual.elapsedMinutes)+' 経過';
    else if(e.state==='完了'){
     const v=e.actual.varianceMinutes;
     actualText=fmtCompact(e.actual.minutes)+(v!=null?`(${v>=0?'+':''}${Math.round(v)})`:'');
    }
   }
   const flags=[
    e.overdueMinutes>0?`<span class="sc-flag sc-flag-overdue" title="${Math.round(e.overdueMinutes)}分押しています">⚠${Math.round(e.overdueMinutes)}分</span>`:'',
    e.spansNonWorking?'<span class="sc-flag sc-flag-spans" title="夜間・休日を跨ぎます">🌙</span>':'',
    e.fixedStart?`<span class="sc-flag sc-flag-fixed" title="固定開始 ${fmtDateTime(e.fixedStart)}">📌</span>`:'',
   ].join('');
   const detailHtml=fixedStartHtml(e)+estimateBreakdownHtml(e);
   const canDelete=scState.fullControl&&e.state==='予定';

   row.innerHTML=`
    <span class="sc-row-handle" title="${canDrag?'ドラッグまたはAlt+↑/↓で並べ替え':''}">${canDrag?'⠿':(e.state==='着手'?'🔒':'')}</span>
    <span class="sc-row-icon" title="${esc(e.kind)}・${esc(e.state)}">${stateIcon(e.kind,e.state)}</span>
    <span class="sc-row-time" title="${esc(timeTitle)}">${esc(timeText)}</span>
    <span class="sc-row-rel">${esc(relText)}</span>
    <span class="sc-row-title" title="${esc(lotText)}">${esc(lotText)}</span>
    <span class="sc-row-est${estDefault?' sc-est-default':''}" title="${estDefault?'実績データが無いための暫定既定値です':''}">${estDefault?'~':''}${esc(estText)}</span>
    <span class="sc-row-actual">${esc(actualText)}</span>
    <span class="sc-row-flags">${flags}</span>
    <span class="sc-row-actions">
     ${detailHtml?`<button type="button" class="sc-row-btn sc-row-detail-toggle" title="詳細を表示">▾</button>`:''}
     ${canDelete?`<button type="button" class="sc-row-btn sc-row-delete" title="削除">🗑</button>`:''}
    </span>`;
   if(canDrag)wireDrag(row);
   const del=row.querySelector('.sc-row-delete');
   if(del)del.onclick=ev=>{ev.stopPropagation();deleteEntry(e.id)};
   timeline.append(row);

   if(detailHtml){
    const detail=document.createElement('div');
    detail.className='sc-row-detail';
    detail.hidden=true;
    detail.innerHTML=detailHtml;
    timeline.append(detail);
    const toggle=row.querySelector('.sc-row-detail-toggle');
    toggle.onclick=ev=>{
     ev.stopPropagation();
     detail.hidden=!detail.hidden;
     toggle.textContent=detail.hidden?'▾':'▴';
     toggle.classList.toggle('active',!detail.hidden);
    };
    const fsInput=detail.querySelector('.sc-fixed-start-input');
    if(fsInput)fsInput.onchange=()=>updateFixedStart(e.id,fsInput.value);
    const fsClear=detail.querySelector('.sc-fixed-start-clear');
    if(fsClear)fsClear.onclick=ev=>{ev.stopPropagation();updateFixedStart(e.id,'')};
   }
  });
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
   const dragEl=$('.sc-row-line[data-id="'+scState.dragId+'"]');
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
 // 高密度リスト化(§9.3改訂)により、行(.sc-row-line)の直後には折りたたみ
 // 済みの詳細パネル(.sc-row-detail)が兄弟要素として挟まることがあるため、
 // 単純なprevious/nextElementSiblingでは隣の「行」に届かないことがある。
 // 詳細パネル・非稼働帯の区切り(.sc-gap-divider)を読み飛ばして次の行を探す。
 function adjacentRow(el,dir){
  let s=dir<0?el.previousElementSibling:el.nextElementSibling;
  while(s&&!s.classList.contains('sc-row-line'))s=dir<0?s.previousElementSibling:s.nextElementSibling;
  return s;
 }
 function moveCard(card,dir){
  const sibling=adjacentRow(card,dir);
  if(!sibling)return;
  if(dir<0)card.parentNode.insertBefore(card,sibling);
  else card.parentNode.insertBefore(sibling,card);
  card.focus();
  commitDragOrder();
 }
 async function commitDragOrder(){
  const ids=[...document.querySelectorAll('#scTimeline .sc-row-line')].map(c=>+c.dataset.id).filter(id=>reorderableIds().includes(id));
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
 // 分類ごとのアイコン・表示順(§5.3の分類マスタ選択肢 保全/段取り/待ち/突発/空欄と対応)。
 // 固定順で並べることで、設備停止マスタの登録順に依存せず毎回同じ位置に見える。
 const STOP_CATEGORY_ORDER=['保全','段取り','待ち','突発',''];
 const STOP_CATEGORY_ICON={'保全':'🔧','段取り':'🔄','待ち':'⏳','突発':'⚡','':'📋'};
 const STOP_CATEGORY_LABEL={'保全':'保全','段取り':'段取り','待ち':'待ち','突発':'突発','':'その他'};
 function renderStopButtons(){
  const box=$('#scStopButtons');if(!box)return;
  if(!scState.stopReasons.length){box.innerHTML='<div class="sc-empty-note">設備停止マスタが未登録です</div>';return}
  const groups=new Map();
  scState.stopReasons.forEach(s=>{
   const cat=STOP_CATEGORY_ORDER.includes(s.category)?s.category:'';
   if(!groups.has(cat))groups.set(cat,[]);
   groups.get(cat).push(s);
  });
  box.innerHTML=STOP_CATEGORY_ORDER.filter(cat=>groups.has(cat)).map(cat=>{
   const items=groups.get(cat).map(s=>{
    const isSudden=s.name==='突発停止';
    return `<button type="button" class="sc-stop-button${isSudden?' is-disabled':''}" data-id="${s.id}" ${isSudden?'title="発生時は計画担当へ連絡してください"':''}>${esc(s.name)}${s.standardMinutes?` (${fmtMinutes(s.standardMinutes)})`:''}</button>`;
   }).join('');
   return `<div class="sc-stop-group">
    <div class="sc-stop-group-title"><span class="sc-stop-group-icon">${STOP_CATEGORY_ICON[cat]}</span>${esc(STOP_CATEGORY_LABEL[cat])}</div>
    <div class="sc-stop-buttons">${items}</div>
   </div>`;
  }).join('');
  box.querySelectorAll('.sc-stop-button').forEach(btn=>{
   if(btn.classList.contains('is-disabled')){btn.disabled=true;return}
   btn.onclick=async()=>{
    const label=btn.textContent.trim();
    try{
     await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(withUserId({equipment:scState.equipment,kind:'設備停止',position:'end',stopReasonId:+btn.dataset.id}))});
     await loadPlan();
     showToast&&showToast('設備停止を追加しました',`${scState.equipment}の予定に追加しました(${label})`,3200);
    }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
   };
  });
 }

 // 複数選択(§9.5、list-view.jsのS.selectedRows)があればそちらを優先し、
 // 無ければ従来どおり単一選択(S.selectedRow)を使う(後方互換)。
 function selectedListRows(){
  if(typeof S==='undefined'||S.db!=='SIKALOTNOW')return [];
  if(S.selectedRows&&S.selectedRows.size)return Array.from(S.selectedRows);
  return S.selectedRow?[S.selectedRow]:[];
 }
 // 仕掛一覧で選択中の行があれば、検索欄の下に「もう1つの追加手段」として
 // 出す(検索が主導線・こちらは仕掛一覧側で先に絞り込み/複数選択していた
 // 場合の補助)。何も選択が無ければ何も出さない(検索欄が常時使えるため、
 // 従来の「まず一覧で行を選択してください」という前提の案内文は不要)。
 function renderAddFromListPanel(){
  const box=$('#scAddFromList');if(!box)return;
  const rows=selectedListRows();
  if(!rows.length){box.innerHTML='';return}
  if(rows.length===1){
   const row=rows[0];
   box.innerHTML=`<div class="sc-add-row-divider">仕掛一覧で選択中の行</div>
    <div class="sc-add-row"><b>${esc(pick(row,'lotNo')||'-')}</b> ${esc(pick(row,'purposeName')||'')} ${esc(pick(row,'mfgMaterial')||'')}
    <button type="button" class="sc-add-row-button" id="scAddSelectedRow">この設備の予定へ</button></div>`;
   const btn=$('#scAddSelectedRow');
   if(btn)btn.onclick=()=>addRowToSchedule(row,scState.equipment);
   return;
  }
  const lots=rows.map(r=>esc(pick(r,'lotNo')||'-')).join('・');
  box.innerHTML=`<div class="sc-add-row-divider">仕掛一覧で選択中の行</div>
   <div class="sc-add-row sc-add-row-bulk">
   <b>${rows.length}件選択中</b>
   <div class="sc-add-bulk-lots">${lots}</div>
   <button type="button" class="sc-add-row-button" id="scAddSelectedRows">この設備へ一括追加(${rows.length}件)</button>
  </div>`;
  const btn=$('#scAddSelectedRows');
  if(btn)btn.onclick=()=>addRowsToSchedule(rows,scState.equipment);
 }
 window.scRefreshAddFromListPanel=function(){if(document.body.classList.contains('sc-mode'))renderAddFromListPanel()};

 /* ---------- ロット検索追加(§9.5改訂) ----------
    「仕掛一覧で行を選択→スケジュール画面を開き直して確認」という間接的な
    導線がわかりにくいという指摘を受け、この画面の中だけでロット番号検索→
    追加まで完結できるようにした。仕掛一覧が使うのと同じ
    GET /api/table?db=SIKALOTNOW(§9.5既存の一覧取得API)をそのまま使い、
    検索ロジックを再実装しない(CLAUDE.mdの「関数の定義は1箇所」)。
    S.db/S.tableは仕掛一覧側の表示状態そのものなので、ここで書き換えると
    一覧画面へ戻ったときの表示が壊れる。SIKALOTNOWのテーブル名だけを
    このモジュール内に個別キャッシュして使う。 */
 let sikalotnowTable=null;
 let lotSearchTimer=null;
 async function resolveSikalotnowTable(){
  if(sikalotnowTable)return sikalotnowTable;
  try{
   const r=await api('/api/tables?db=SIKALOTNOW');
   sikalotnowTable=(r.tables&&r.tables[0])||null;
  }catch(e){sikalotnowTable=null}
  return sikalotnowTable;
 }
 async function searchWorkList(query){
  const table=await resolveSikalotnowTable();
  if(!table)return [];
  const q=new URLSearchParams({db:'SIKALOTNOW',table,page:1,page_size:8,search:query});
  const r=await api('/api/table?'+q);
  return r.rows||[];
 }
 function renderLotSearchResults(rows,query){
  const box=$('#scLotSearchResults');if(!box)return;
  if(!query){box.innerHTML='';return}
  if(!rows.length){box.innerHTML='<div class="sc-empty-note">該当するロットが見つかりません。</div>';return}
  box.innerHTML=rows.map((row,i)=>`<div class="sc-lot-result">
    <div class="sc-lot-result-info"><b>${esc(pick(row,'lotNo')||'-')}</b> ${esc(pick(row,'purposeName')||'')} ${esc(pick(row,'mfgMaterial')||'')}</div>
    <button type="button" class="sc-lot-result-add" data-idx="${i}">＋追加</button>
   </div>`).join('');
  box.querySelectorAll('.sc-lot-result-add').forEach(btn=>{
   btn.onclick=async()=>{
    btn.disabled=true;
    await addRowToSchedule(rows[+btn.dataset.idx],scState.equipment);
    const input=$('#scLotSearch');if(input)input.value='';
    renderLotSearchResults([],'');
   };
  });
 }
 function wireLotSearch(){
  const input=$('#scLotSearch');if(!input||input.dataset.wired)return;
  input.dataset.wired='1';
  input.oninput=()=>{
   clearTimeout(lotSearchTimer);
   const q=input.value.trim();
   if(!q){renderLotSearchResults([],'');return}
   lotSearchTimer=setTimeout(async()=>{
    if(!scState.equipment){renderLotSearchResults([],q);$('#scLotSearchResults').innerHTML='<div class="sc-empty-note">先に設備を選択してください。</div>';return}
    const rows=await searchWorkList(q).catch(()=>[]);
    renderLotSearchResults(rows,q);
   },300);
  };
 }

 function buildScheduleDetail(row){
  const detail={};
  Object.keys(aliases).forEach(k=>{const v=pick(row,k);if(v!==undefined&&v!==null&&v!=='')detail[k]=v});
  return detail;
 }
 async function addRowToSchedule(row,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  try{
   await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:target,kind:'作業',position:'end',
     lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail:buildScheduleDetail(row)}))});
   showToast&&showToast('予定へ追加しました',`${target}の予定に追加しました`,3200);
   if(scState.equipment===target)await loadPlan();
  }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
 }
 window.scheduleAddFromRow=function(row){addRowToSchedule(row,pick(row,'equipment')||'')};

 // 一括追加(§9.5): 共有スケジュールDBは§4.2の取得→適用→反映サイクルを
 // 1リクエストごとに踏むため、並列で撃つとロック競合(423)が起きやすい。
 // 直列に1件ずつawaitし、失敗したロットだけ後で分かるように集計する。
 async function addRowsToSchedule(rows,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  let okCount=0;const failedLots=[];
  for(const row of rows){
   try{
    await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId({equipment:target,kind:'作業',position:'end',
      lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail:buildScheduleDetail(row)}))});
    okCount++;
   }catch(e){failedLots.push(pick(row,'lotNo')||'?')}
  }
  if(failedLots.length)showToast&&showToast(`${okCount}/${rows.length}件を追加しました`,`失敗したロット: ${failedLots.join('・')}`,7000);
  else showToast&&showToast('一括追加しました',`${target}の予定へ${okCount}件追加しました`,3800);
  window.clearListSelection?.();
  if(scState.equipment===target)await loadPlan();
 }

 /* ---------- ナビ ----------
    「作業スケジュール」は全モードで常時表示するため(§9.1)、動的注入
    (calendar-view.js/report-dashboard.jsの分析系ボタンと同じ方式)ではなく
    templates/index.htmlに静的に置いたボタンへ直接配線する。 */
 const navBtn=document.getElementById('openSchedule');
 if(navBtn)navBtn.onclick=()=>openScheduleView().catch(e=>console.error(e));
})();
