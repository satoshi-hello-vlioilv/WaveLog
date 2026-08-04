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
              boardMode:'single',boardWindowHours:24,overview:[],overviewSort:'order',
              sessionHeld:false,sessionHolder:null};
 let scLockTimer=null;
 // ---------- 編集セッション(§9.11新設)・書込キュー ----------
 let scSessionTimer=null,scSessionHeldFor=null,scTempIdSeq=0;
 let scWriteQueue=[],scQueueRunning=false,scQueueFlushTimer=null;
 // ---------- 仕掛一覧の高密度表示(§9.12新設、既定=高密度) ----------
 let scDenseList=(()=>{try{return (localStorage.getItem('scListDenseV1')??'1')!=='0'}catch(e){return true}})();
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));

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
     <button type="button" class="sc-dense-toggle" id="scDenseToggle" hidden title="仕掛一覧の表示密度を切り替えます">▤ 高密度</button>
     <button type="button" class="sc-split-toggle" id="scSplitToggle" hidden title="仕掛一覧を隣に表示してドラッグで追加します">◫ 仕掛一覧</button>
     <button type="button" class="sc-split-toggle" id="scListModalBtn" hidden title="仕掛一覧をポップアップで表示してドラッグで追加します">⧉ ポップアップ</button>
     <button type="button" class="sc-split-toggle" id="scStopModalBtn" hidden title="設備停止をポップアップから追加します">⛔ 設備停止</button>
     <button type="button" class="sc-refresh" id="scRefresh">再計算</button>
     <button type="button" class="sc-close" id="scClose" title="閉じる">×</button>
    </div>
   </div>
   <div class="sc-session-banner" id="scSessionBanner" hidden></div>
   <div class="sc-warnings" id="scWarnings" hidden></div>
   <div class="sc-board" id="scBoard" hidden></div>
   <div class="sc-body" id="scSingleBody">
    <div class="sc-timeline" id="scTimeline"></div>
    <div class="sc-side" id="scSide" hidden>
     <div class="sc-side-section" id="scSplitHint">
      <p class="sc-drop-hint">左の仕掛一覧からロットをドラッグ、またはチェックボックスで複数選択してこのパネルへドロップすると、この設備の予定へ追加されます。</p>
     </div>
     <div class="sc-side-section">
      <button type="button" class="sc-side-section-toggle" id="scStopSectionToggle">
       <span class="sc-side-title">設備停止を追加</span><span class="sc-collapse-chevron">▾</span>
      </button>
      <div class="sc-stop-groups" id="scStopButtons" hidden><div class="sc-empty-note">設備停止マスタが未登録です</div></div>
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
  $('#scSplitToggle').onclick=()=>toggleSplitList();
  $('#scListModalBtn').onclick=()=>listModalOpen?closeListModal():openListModal();
  $('#scStopModalBtn').onclick=()=>stopModalOpen?closeStopModal():openStopModal();
  $('#scDenseToggle').onclick=()=>toggleListDensity();
  $('#scStopSectionToggle').onclick=()=>{
   const box=$('#scStopButtons');if(!box)return;
   box.hidden=!box.hidden;
   $('#scStopSectionToggle').classList.toggle('open',!box.hidden);
  };
  panel.querySelectorAll('.sc-board-window-btn').forEach(btn=>{
   btn.onclick=()=>{
    scState.boardWindowHours=+btn.dataset.hours;
    panel.querySelectorAll('.sc-board-window-btn').forEach(b=>b.classList.toggle('active',b===btn));
    renderOverviewBoard();
   };
  });
  wireDropTarget(panel);
  return panel;
 }

 /* ---------- 分割表示(§9.10): 仕掛一覧(#grid)をスケジュールパネルの隣へ ----------
    list-view.jsが持つ仕掛一覧の描画(検索・並替・絞り込み・複数選択・分割
    検出)をそのまま流用し、比較用の一覧を新しく作り直さない(CLAUDE.mdの
    「関数の定義は1箇所」)。#grid・#genericFilterBarはDOM上の位置を一時的に
    .sc-split-wrapへ移すだけで、要素自体・IDは変えないため他モードの
    display:none切替やid参照には影響しない。元の位置はコメントノード
    (splitAnchor)で覚えておき、分割解除時に戻す。 */
 // #grid・#genericFilterBarは常に同じDOMノードを「今どこに表示するか」だけ
 // 動かす(list-view.jsの検索・並替・ドラッグ機能を再実装しない、CLAUDE.mdの
 // 「関数の定義は1箇所」)。行き先は分割表示(splitWrap)とポップアップ表示
 // (#scListModal)の2種類あるため、元の位置をコメントノード(gridAnchor)で
 // 覚えておく共通処理をmoveGridTo/returnGridHomeへ切り出した。
 let gridAnchor=null,gridHost=null;
 function ensureGridAnchor(){
  if(gridAnchor)return gridAnchor;
  const grid=document.getElementById('grid');
  if(!grid||!grid.parentNode)return null;
  gridAnchor=document.createComment('sc-grid-anchor');
  grid.parentNode.insertBefore(gridAnchor,grid);
  return gridAnchor;
 }
 function moveGridTo(host){
  if(!ensureGridAnchor()||!host)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar');
  if(filterBar)host.appendChild(filterBar);
  if(grid)host.appendChild(grid);
  gridHost=host;
 }
 function returnGridHome(){
  if(!gridHost||!gridAnchor)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar');
  const main=gridAnchor.parentNode;
  if(filterBar)main.insertBefore(filterBar,gridAnchor);
  if(grid)main.insertBefore(grid,gridAnchor);
  gridHost=null;
 }

 let splitWrap=null,splitListVisible=true;
 function ensureSplitWrap(){
  if(splitWrap)return splitWrap;
  const panel=document.getElementById('schedulePanel');
  if(!ensureGridAnchor()||!panel)return null;
  splitWrap=document.createElement('div');splitWrap.className='sc-split-wrap';
  gridAnchor.parentNode.insertBefore(splitWrap,gridAnchor);
  moveGridTo(splitWrap);
  splitWrap.appendChild(panel);
  return splitWrap;
 }
 function teardownSplitWrap(){
  if(!splitWrap)return;
  const panel=document.getElementById('schedulePanel');
  const main=gridAnchor.parentNode;
  returnGridHome();
  if(panel)main.insertBefore(panel,gridAnchor);
  splitWrap.remove();
  splitWrap=null;
 }
 // scheduleモードで1設備のタイムラインを見ている間だけ、仕掛一覧を隣に出す
 // (全体俯瞰ボード・editモード等では対象設備が定まらない/追加できないため
 // 意味が無い)。splitListVisibleは「◫ 仕掛一覧」トグルでの利用者の選択を
 // 覚えておく(毎回自動で出すと、狭い画面では逆に使いにくいという声を
 // 想定した保険)。
 async function showSplitList(){
  if(!scState.fullControl||scState.boardMode!=='single'||!scState.equipment||!splitListVisible)return;
  if(listModalOpen)closeListModal();
  ensureSplitWrap();
  document.body.classList.add('sc-split');
  applyListDensity();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&S.db!=='SIKALOTNOW'){
   const navBtn=document.querySelector('aside [data-db-key="SIKALOTNOW"]');
   try{await selectDb('SIKALOTNOW',navBtn)}catch(e){/* 一覧が読めなくてもスケジュール自体の表示は継続する */}
  }
 }
 function hideSplitList(){
  document.body.classList.remove('sc-split');
  teardownSplitWrap();
 }
 function toggleSplitList(){
  splitListVisible=!splitListVisible;
  if(splitListVisible)showSplitList();else hideSplitList();
  updateSplitToggleUi();
 }
 function updateSplitToggleUi(){
  const applicable=scState.fullControl&&scState.boardMode==='single';
  const splitBtn=$('#scSplitToggle');
  if(splitBtn){splitBtn.hidden=!applicable;splitBtn.classList.toggle('active',applicable&&splitListVisible)}
  const modalBtn=$('#scListModalBtn');
  if(modalBtn){modalBtn.hidden=!applicable;modalBtn.classList.toggle('active',listModalOpen)}
  const denseBtn=$('#scDenseToggle');
  if(denseBtn)denseBtn.hidden=!applicable;
  updateDenseToggleUi();
 }

 /* ---------- 仕掛一覧のポップアップ表示(§9.14新設) ----------
    折りたたみ(splitListVisible=false)や画面が狭い時でも、分割表示へ
    切り替えずに一覧からドラッグで追加できるようにする代替の入口。
    #grid自体は同時に1箇所にしか置けないため、開くときは分割表示を畳む。 */
 let listModalOpen=false;
 function ensureListModal(){
  let modal=document.getElementById('scListModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal sc-float-modal';modal.id='scListModal';modal.hidden=true;
  modal.innerHTML=`<div class="settings-dialog sc-float-dialog">
   <header><div><small>SIKALOTNOW</small><h2>仕掛一覧(ドラッグでスケジュールへ追加)</h2></div><button type="button" id="scListModalClose">×</button></header>
   <div class="sc-float-body" id="scListModalBody"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.sc-float-dialog').addEventListener('click',e=>e.stopPropagation());
  modal.addEventListener('click',()=>closeListModal());
  modal.querySelector('#scListModalClose').onclick=()=>closeListModal();
  return modal;
 }
 async function openListModal(){
  const modal=ensureListModal();
  if(splitWrap){splitListVisible=false;hideSplitList()}
  moveGridTo(modal.querySelector('#scListModalBody'));
  applyListDensity();
  modal.hidden=false;listModalOpen=true;
  // body.sc-mode #grid{display:none!important}(通常モード)を、分割表示の
  // body.sc-mode.sc-split #gridと同じ考え方で上書きする(§9.14)。
  document.body.classList.add('sc-list-modal-open');
  updateSplitToggleUi();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&S.db!=='SIKALOTNOW'){
   const navBtn=document.querySelector('aside [data-db-key="SIKALOTNOW"]');
   try{await selectDb('SIKALOTNOW',navBtn)}catch(e){/* ベストエフォート */}
  }
 }
 function closeListModal(){
  const modal=document.getElementById('scListModal');
  if(!modal||modal.hidden)return;
  modal.hidden=true;listModalOpen=false;
  document.body.classList.remove('sc-list-modal-open');
  returnGridHome();
  updateSplitToggleUi();
 }

 /* ---------- 仕掛一覧の高密度表示(§9.12新設) ----------
    スケジュールのタイムライン(.sc-row-line)と同程度の密度で仕掛一覧を
    表示できるようにする。#grid自体は再描画のたびに中身(table)を作り直す
    (list-view.js renderGrid())ため、#grid要素自身に持たせたクラスで
    CSS側だけを切り替える(再描画に依存しない)。既定は高密度。 */
 function applyListDensity(){
  const grid=document.getElementById('grid');
  if(grid)grid.classList.toggle('sc-dense',scDenseList);
 }
 function toggleListDensity(){
  scDenseList=!scDenseList;
  try{localStorage.setItem('scListDenseV1',scDenseList?'1':'0')}catch(e){/* 保存できなくても表示自体は切り替える */}
  applyListDensity();updateDenseToggleUi();
 }
 function updateDenseToggleUi(){
  const btn=$('#scDenseToggle');if(!btn)return;
  btn.classList.toggle('active',scDenseList);
  btn.textContent=scDenseList?'▤ 高密度':'▦ 通常密度';
 }

 /* ---------- ドロップ受入(§9.10): 仕掛一覧の行をタイムラインへドラッグ ----------
    list-view.js側がwindow.__scDragRowsへドラッグ中の行(複数選択時はその
    全体)を置く単純なハンドオフ。パネル全体を受け皿にし、タイムライン・
    側パネルどちらへ落としても同じ追加処理を呼ぶ(的を小さくしない)。 */
 function wireDropTarget(panel){
  if(panel.dataset.dropWired)return;
  panel.dataset.dropWired='1';
  panel.classList.add('sc-drop-target');
  const dropApplicable=()=>scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment&&!sessionBlocked();
  panel.addEventListener('dragover',e=>{
   if((!window.__scDragRows&&!window.__scDragStopReason)||!dropApplicable())return;
   e.preventDefault();
   e.dataTransfer.dropEffect='copy';
   panel.classList.add('sc-drop-active');
  });
  panel.addEventListener('dragleave',e=>{if(e.target===panel)panel.classList.remove('sc-drop-active')});
  panel.addEventListener('drop',e=>{
   // 設備停止ボタン(§9.13)からのドラッグ&ドロップ。位置に関わらず末尾へ追加する
   // (クリック追加と同じ挙動、タイムライン上の特定位置への挿入は行わない)。
   if(window.__scDragStopReason){
    e.preventDefault();
    panel.classList.remove('sc-drop-active');
    const reason=window.__scDragStopReason;window.__scDragStopReason=null;
    if(dropApplicable())addStopReasonToSchedule(reason.id,reason.name);
    return;
   }
   if(!window.__scDragRows)return;
   e.preventDefault();
   panel.classList.remove('sc-drop-active');
   const rows=window.__scDragRows;window.__scDragRows=null;
   if(!rows||!rows.length||!scState.equipment)return;
   if(rows.length===1)addRowToSchedule(rows[0],scState.equipment);
   else addRowsToSchedule(rows,scState.equipment);
  });
 }
 // list-view.jsの選択件数バー(plan-select-bar)から、ドラッグ無しでも同じ
 // 一括追加を呼べるようにする入口(タッチ操作・支援技術向け、§9.10)。
 window.scCurrentDropTarget=function(){
  return (scState.fullControl&&scState.boardMode==='single'&&scState.equipment)?scState.equipment:'';
 };
 window.scAddSelectedRows=function(rows){
  if(!rows||!rows.length||!scState.equipment)return;
  if(rows.length===1)addRowToSchedule(rows[0],scState.equipment);
  else addRowsToSchedule(rows,scState.equipment);
 };

 /* ---------- ビュー排他制御 ---------- */
 function exitScheduleView(){
  if(!document.body.classList.contains('sc-mode'))return;
  document.body.classList.remove('sc-mode');
  document.getElementById('schedulePanel')?.setAttribute('hidden','');
  document.getElementById('openSchedule')?.classList.remove('active');
  closeListModal();closeStopModal();
  hideSplitList();
  stopLockPolling();
  stopSessionHeartbeat();
  if(scSessionHeldFor){releaseSessionFire(scSessionHeldFor);scSessionHeldFor=null}
  scState.sessionHeld=false;scState.sessionHolder=null;
 }
 window.exitScheduleView=exitScheduleView;
 if(typeof selectDb==='function'){
  const oldSelectDb=selectDb;
  selectDb=async function(k,b){
   // scheduleモードで仕掛一覧(SIKALOTNOW)へ切り替える場合は、分割表示
   // (§9.10)としてスケジュール画面の隣に出すため、画面自体は閉じない
   // (ただし既にポップアップ表示(§9.14)で開いている場合はそちらを崩さない)。
   if(k==='SIKALOTNOW'&&scState.fullControl&&scState.boardMode==='single'&&scState.equipment){
    if(!listModalOpen){splitListVisible=true;ensureSplitWrap();document.body.classList.add('sc-split');applyListDensity();updateSplitToggleUi()}
    return oldSelectDb(k,b);
   }
   exitScheduleView();
   return oldSelectDb(k,b);
  };
 }

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
  const stopBtn=$('#scStopModalBtn');if(stopBtn)stopBtn.hidden=!scState.fullControl||inBoard;
  document.querySelectorAll('.sc-board-window-btn').forEach(btn=>btn.classList.toggle('active',+btn.dataset.hours===scState.boardWindowHours));
  updateSplitToggleUi();
  // 全体俯瞰ボードや対象設備が無い状態では分割表示(§9.10)の意味が無いため
  // 畳む(仕掛一覧を隣に出したまま設備を切り替えても違和感が無いよう、
  // 個別タイムライン表示中はshowSplitList側で改めて出す)。
  if(inBoard){hideSplitList();closeListModal();closeStopModal()}
  syncSession();
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

 /* ---------- 編集セッション(§9.11新設) ----------
    「設備単位で同時に1人しか編集作業に入れない」ための助言的ロック
    (backend/schedule_sync.pyのacquire_session系)。1設備のタイムラインを
    開いている間だけ保持し、25秒おきに延長(サーバー側TTLは90秒、数回分の
    取りこぼしを許容する余裕を持たせてある)。他端末が保持中の場合は
    バナーを出し、追加・削除・並べ替え・設備停止投入を止める(下記
    sessionBlocked()、実際の書込APIもrequire_session()で二重に弾く)。 */
 function sessionApplicable(){
  return scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment;
 }
 function sessionBlocked(){
  return sessionApplicable()&&!scState.sessionHeld;
 }
 async function acquireSessionOnce(){
  const eq=scState.equipment;
  try{
   await api('/api/schedule/session/acquire',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:eq})});
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scState.sessionHeld=true;scState.sessionHolder=null;
  }catch(e){
   if(scState.equipment!==eq)return;
   scState.sessionHeld=false;
   scState.sessionHolder=e.sessionLockedBy||null;
  }
  renderSessionBanner();
 }
 function startSessionHeartbeat(){
  stopSessionHeartbeat();
  scSessionHeldFor=scState.equipment;
  acquireSessionOnce();
  scSessionTimer=setInterval(acquireSessionOnce,25000);
 }
 function stopSessionHeartbeat(){
  if(scSessionTimer){clearInterval(scSessionTimer);scSessionTimer=null}
 }
 function releaseSessionFire(equipment){
  // タブを閉じる際にも呼ばれるため、確実性を優先してsendBeacon(base.jsの
  // notifyTabClosedと同じ考え方)を使い、非対応環境ではfetchへフォールバック
  // する。応答は待たない(ベストエフォート)。
  if(!equipment)return;
  try{
   const ok=navigator.sendBeacon&&navigator.sendBeacon('/api/schedule/session/release',
    new Blob([JSON.stringify({equipment})],{type:'application/json'}));
   if(ok)return;
  }catch(e){/* フォールバックへ */}
  try{
   api('/api/schedule/session/release',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment})}).catch(()=>{});
  }catch(e){/* ベストエフォート */}
 }
 async function syncSession(){
  if(scSessionHeldFor&&scSessionHeldFor!==scState.equipment){
   stopSessionHeartbeat();
   releaseSessionFire(scSessionHeldFor);
   scSessionHeldFor=null;
  }
  if(!sessionApplicable()){
   stopSessionHeartbeat();
   if(scState.sessionHeld||scState.sessionHolder){scState.sessionHeld=false;scState.sessionHolder=null;renderSessionBanner()}
   return;
  }
  if(scSessionTimer)return; // 既にこの設備でハートビート中
  startSessionHeartbeat();
 }
 function renderSessionBanner(){
  const box=$('#scSessionBanner');if(!box)return;
  if(!sessionApplicable()||scState.sessionHeld||!scState.sessionHolder){
   box.hidden=true;box.innerHTML='';
   applyWriteControlsEnabled(true);
   return;
  }
  const h=scState.sessionHolder;
  box.hidden=false;
  box.innerHTML=`<span>⚠ ${esc(scState.equipment)}は${esc(h.loginId||'?')}@${esc(h.pcName||'?')}が編集中です。追加・削除・並べ替えは今は操作できません(閲覧のみ)。</span><button type="button" id="scSessionRetry">再試行</button>`;
  const retryBtn=$('#scSessionRetry');if(retryBtn)retryBtn.onclick=()=>acquireSessionOnce();
  applyWriteControlsEnabled(false);
 }
 function applyWriteControlsEnabled(enabled){
  const panel=document.getElementById('schedulePanel');
  if(panel)panel.classList.toggle('sc-session-locked',!enabled);
 }
 // タブを閉じる時に保持中のセッションを解放する(base.jsのnotifyTabClosedと
 // 同じ二重登録方針。pagehideが本来カバーする範囲の方が広いが、ブラウザ
 // 実装差の保険としてunloadでも同じ通知を送る)。
 function releaseSessionOnUnload(){if(scSessionHeldFor)releaseSessionFire(scSessionHeldFor)}
 window.addEventListener('pagehide',releaseSessionOnUnload);
 window.addEventListener('unload',releaseSessionOnUnload);

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
  await showSplitList();
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
  if(e.__pending)return ''; // サーバー未反映(§9.11の楽観的追加)の間はまだ予定IDが無く更新できない
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
   row.className='sc-row-line '+stateRowClass(e.state)+(e.__pending?' sc-row-pending':'');
   row.dataset.id=e.id;
   const canDrag=scState.editable&&e.reorderable&&!e.__pending&&!sessionBlocked();
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
    e.__pending?'<span class="sc-flag sc-flag-pending" title="サーバーへ反映中です">⏳追加中</span>':'',
    e.overdueMinutes>0?`<span class="sc-flag sc-flag-overdue" title="${Math.round(e.overdueMinutes)}分押しています">⚠${Math.round(e.overdueMinutes)}分</span>`:'',
    e.spansNonWorking?'<span class="sc-flag sc-flag-spans" title="夜間・休日を跨ぎます">🌙</span>':'',
    e.fixedStart?`<span class="sc-flag sc-flag-fixed" title="固定開始 ${fmtDateTime(e.fixedStart)}">📌</span>`:'',
   ].join('');
   const detailHtml=fixedStartHtml(e)+estimateBreakdownHtml(e);
   const canDelete=scState.fullControl&&e.state==='予定'&&!e.__pending;

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

 /* ---------- 書込キュー(§9.11新設): 画面描画を先行させ、実際のAPI呼び出しは
    バックグラウンドで直列に処理する ----------
    共有スケジュールDBは§4.2の取得→適用→反映サイクルを1リクエストごとに
    踏むため並列化はできない(既存の一括追加が直列awaitだった理由と同じ)。
    以前はその直列awaitを画面のクリック/ドロップ操作自身がブロックして
    いたため、20件を超える一括追加で体感速度が悪化していた。ここでは
    「画面へは即座に反映し、実際の書込はキューに積んで後追いで処理する」
    方式に変え、ユーザー操作をAPI応答待ちで止めない。編集セッション
    (§9.11のsyncSession)が同一設備の同時編集を防いでいるため、キューが
    捌き切る前に他端末の変更と衝突する心配もない。失敗したオペレーションは
    数回リトライしてから諦め、キューが空になった時点でloadPlan()により
    サーバー側の最終状態で描き直して正規化する。 */
 function queueScheduleWrite(run){
  scWriteQueue.push({run,attempts:0});
  if(scQueueFlushTimer||scQueueRunning)return;
  scQueueFlushTimer=setTimeout(()=>{scQueueFlushTimer=null;runWriteQueue()},150);
 }
 async function runWriteQueue(){
  if(scQueueRunning)return;
  scQueueRunning=true;
  const failures=[];
  try{
   while(scWriteQueue.length){
    const op=scWriteQueue[0];
    try{
     await op.run();
     scWriteQueue.shift();
    }catch(e){
     op.attempts++;
     if(op.attempts>=3){scWriteQueue.shift();failures.push(e)}
     else await sleep(700*op.attempts);
    }
   }
  }finally{
   scQueueRunning=false;
   if(failures.length){
    const msg=failures.length===1?failures[0].message:`${failures.length}件の変更を反映できませんでした`;
    showToast&&showToast('一部の変更を反映できませんでした',msg,7000);
   }
   if(scState.equipment)await loadPlan(); // サーバー側の最終状態で正規化する
  }
 }
 function makeOptimisticEntry(kind,fields){
  return Object.assign({
   id:'tmp-'+(++scTempIdSeq),kind,state:'予定',reorderable:true,
   plannedStart:null,plannedEnd:null,startsInMinutes:null,
   estimate:null,actual:null,overdueMinutes:0,spansNonWorking:false,fixedStart:null,
   lotNo:'',title:'',detail:{},__pending:true,
  },fields);
 }

 async function deleteEntry(id){
  if(typeof confirmModal==='function'){
   const ok=await confirmModal({message:'この予定を削除します。よろしいですか？'});
   if(!ok)return;
  }
  const idx=scState.entries.findIndex(e=>e.id===id);
  if(idx===-1)return;
  const [removed]=scState.entries.splice(idx,1);
  renderTimeline();
  queueScheduleWrite(async()=>{
   try{
    await api('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id}))});
   }catch(e){
    if(scState.entries.every(x=>x.id!==removed.id)){scState.entries.splice(Math.min(idx,scState.entries.length),0,removed);renderTimeline()}
    throw e;
   }
  });
 }

 /* ---------- ドラッグ並べ替え(§7.5・§9.4) + Alt+↑/↓ ---------- */
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
 function commitDragOrder(){
  // ドラッグは既にDOM上の並びを直接動かしている(wireDrag/moveCard)ため、
  // 画面上は既に確定した見た目になっている。scState.entries自体もこの
  // DOM順に合わせて並べ直しておくことで、キュー処理中に追加・削除の
  // 再描画が挟まってもドラッグ結果が消えない(§9.11)。実際のAPI呼び出しは
  // バックグラウンドの書込キューへ積み、画面をブロックしない。
  const allIds=[...document.querySelectorAll('#scTimeline .sc-row-line')].map(c=>+c.dataset.id);
  const byId=new Map(scState.entries.map(e=>[e.id,e]));
  const ids=allIds.filter(id=>{const e=byId.get(id);return e&&e.reorderable});
  scState.entries=allIds.map(id=>byId.get(id)).filter(Boolean);
  const equipment=scState.equipment;
  queueScheduleWrite(async()=>{
   try{
    await api('/api/schedule/plan/reorder',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId({equipment,orderedIds:ids}))});
   }catch(e){
    showToast&&showToast('並べ替えに失敗しました',e.message,5000);
    throw e;
   }
  });
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
   const reasonId=+btn.dataset.id;
   const reason=scState.stopReasons.find(s=>s.id===reasonId);
   const label=(reason&&reason.name)||btn.textContent.trim();
   // ドラッグ&ドロップでの追加(§9.13): list-view.jsの仕掛行と同じ
   // window.__scDragRows方式のハンドオフを、設備停止ボタン専用にもう1系統
   // 用意する(wireDropTarget側で判別)。
   btn.draggable=true;
   btn.addEventListener('dragstart',e=>{
    window.__scDragStopReason={id:reasonId,name:label};
    e.dataTransfer.effectAllowed='copy';
    try{e.dataTransfer.setData('text/plain',label)}catch(err){/* 一部ブラウザでのsetData制限は無視する */}
    btn.classList.add('is-row-dragging');
   });
   btn.addEventListener('dragend',()=>{btn.classList.remove('is-row-dragging');window.__scDragStopReason=null});
   btn.onclick=()=>addStopReasonToSchedule(reasonId,label);
  });
 }
 function addStopReasonToSchedule(reasonId,label){
  if(!scState.equipment)return;
  if(sessionBlocked()){
   showToast&&showToast('追加できません',sessionHolderMessage(),4000);
   return;
  }
  const target=scState.equipment;
  scState.entries.push(makeOptimisticEntry('設備停止',{title:label}));
  renderTimeline();
  queueScheduleWrite(()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(withUserId({equipment:target,kind:'設備停止',position:'end',stopReasonId:reasonId}))}));
  showToast&&showToast('設備停止を追加しました',`${target}の予定に追加しました(${label})`,3200);
 }

 /* ---------- 設備停止のポップアップ表示(§9.13新設) ----------
    常時表示だと視野(タイムラインの縦幅)を圧迫するという指摘のため、
    .sc-side内は折りたたみ既定(上のensurePanelでhidden属性を付与済み)にし、
    ヘッダーの「⛔ 設備停止」ボタンから素早く開けるフローティングモーダルを
    追加の入口として用意する。#scStopButtons自体を場所だけ動かす(仕掛一覧の
    ポップアップ、moveGridTo/returnGridHomeと同じ考え方。renderStopButtons()の
    描画・イベント配線を2重に持たない)。 */
 let stopModalOpen=false,stopAnchor=null;
 function ensureStopAnchor(){
  if(stopAnchor)return stopAnchor;
  const box=document.getElementById('scStopButtons');
  if(!box||!box.parentNode)return null;
  stopAnchor=document.createComment('sc-stop-anchor');
  box.parentNode.insertBefore(stopAnchor,box);
  return stopAnchor;
 }
 function ensureStopModal(){
  let modal=document.getElementById('scStopModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='record-modal sc-float-modal';modal.id='scStopModal';modal.hidden=true;
  modal.innerHTML=`<div class="settings-dialog sc-float-dialog sc-float-dialog-narrow">
   <header><div><small>STOP REASON</small><h2>設備停止を追加</h2></div><button type="button" id="scStopModalClose">×</button></header>
   <div class="sc-float-body" id="scStopModalBody"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.sc-float-dialog').addEventListener('click',e=>e.stopPropagation());
  modal.addEventListener('click',()=>closeStopModal());
  modal.querySelector('#scStopModalClose').onclick=()=>closeStopModal();
  return modal;
 }
 function openStopModal(){
  if(!ensureStopAnchor())return;
  const modal=ensureStopModal();
  const box=document.getElementById('scStopButtons');
  if(box){box.hidden=false;modal.querySelector('#scStopModalBody').appendChild(box)}
  modal.hidden=false;stopModalOpen=true;
  $('#scStopModalBtn')?.classList.add('active');
 }
 function closeStopModal(){
  const modal=document.getElementById('scStopModal');
  if(!modal||modal.hidden)return;
  const box=document.getElementById('scStopButtons');
  if(box&&stopAnchor)stopAnchor.parentNode.insertBefore(box,stopAnchor);
  modal.hidden=true;stopModalOpen=false;
  $('#scStopModalBtn')?.classList.remove('active');
 }

 function buildScheduleDetail(row){
  const detail={};
  Object.keys(aliases).forEach(k=>{const v=pick(row,k);if(v!==undefined&&v!==null&&v!=='')detail[k]=v});
  return detail;
 }
 function sessionHolderMessage(){
  const h=scState.sessionHolder;
  return h?`${scState.equipment}は${h.loginId||'?'}@${h.pcName||'?'}が編集中です`:`${scState.equipment}は他端末が編集中です`;
 }
 function planAddPayload(target,row){
  return withUserId({equipment:target,kind:'作業',position:'end',
   lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail:buildScheduleDetail(row)});
 }
 async function addRowToSchedule(row,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  if(target!==scState.equipment){
   // 今開いていない設備への追加(§9.5): 楽観描画の対象タイムラインが無い
   // ため従来どおり即時反映する。
   try{
    await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))});
    showToast&&showToast('予定へ追加しました',`${target}の予定に追加しました`,3200);
   }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  scState.entries.push(makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)}));
  renderTimeline();
  queueScheduleWrite(()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))}));
 }
 window.scheduleAddFromRow=function(row){addRowToSchedule(row,pick(row,'equipment')||'')};

 // 一括追加(§9.5・§9.11改訂): 開いている設備への一括追加は、画面へは全件を
 // 即座に反映し、実際のAPI呼び出しはバックグラウンドの書込キューへ積んで
 // 順次処理する(体感速度のため。共有DBの取得→適用→反映サイクル自体は
 // 直列のまま変わらない)。開いていない設備への一括追加は、失敗集計を
 // その場で示すため引き続き直列awaitする。
 async function addRowsToSchedule(rows,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  if(target!==scState.equipment){
   let okCount=0;const failedLots=[];
   for(const row of rows){
    try{
     await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))});
     okCount++;
    }catch(e){failedLots.push(pick(row,'lotNo')||'?')}
   }
   if(failedLots.length)showToast&&showToast(`${okCount}/${rows.length}件を追加しました`,`失敗したロット: ${failedLots.join('・')}`,7000);
   else showToast&&showToast('一括追加しました',`${target}の予定へ${okCount}件追加しました`,3800);
   window.clearListSelection?.();
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  rows.forEach(row=>{
   scState.entries.push(makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)}));
   queueScheduleWrite(()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))}));
  });
  renderTimeline();
  showToast&&showToast(`${rows.length}件をキューへ追加しました`,`${target}の予定へ反映中です…`,3200);
  window.clearListSelection?.();
 }

 /* ---------- ナビ ----------
    「作業スケジュール」は全モードで常時表示するため(§9.1)、動的注入
    (calendar-view.js/report-dashboard.jsの分析系ボタンと同じ方式)ではなく
    templates/index.htmlに静的に置いたボタンへ直接配線する。 */
 const navBtn=document.getElementById('openSchedule');
 if(navBtn)navBtn.onclick=()=>openScheduleView().catch(e=>console.error(e));
})();
