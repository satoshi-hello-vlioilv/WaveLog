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

 // historyHours(§9.34「表示範囲」): 完了した予定・計画外実績を、今から
 // 何時間前までさかのぼって表示するか。既定8時間。同じ値をサーバーへも
 // 送り、計画外実績(§9.33)の合成範囲と画面の表示範囲を必ず一致させる
 // (画面だけで絞ると「サーバーが返したのに出ない」行が生まれて紛らわしい)。
 const SC_HISTORY_CHOICES=[2,4,8,24,72];
 const SC_HISTORY_KEY='ScheduleHistoryHoursV1';
 function loadHistoryHours(){
  try{
   const v=Number(localStorage.getItem(SC_HISTORY_KEY));
   if(SC_HISTORY_CHOICES.includes(v))return v;
  }catch(e){/* 保存値が壊れていても既定で続行する */}
  return 8;
 }
 let scState={equipment:'',entries:[],anchor:null,warnings:[],configured:true,
              editable:false,pickerEnabled:false,stopReasons:[],dragId:null,
              boardMode:'single',boardWindowHours:24,overview:[],overviewSort:'order',
              sessionHeld:false,sessionHolder:null,sessionError:null,
              canStartWork:false,historyHours:loadHistoryHours()};
 let scLockTimer=null;
 // ---------- 編集セッション(§9.11新設)・書込キュー ----------
 let scSessionTimer=null,scSessionHeldFor=null,scTempIdSeq=0;
 let scWriteQueue=[],scQueueRunning=false,scQueueFlushTimer=null;
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
     <label class="sc-history-range" id="scHistoryRange" hidden title="完了した予定と実績を、今から何時間前まで表示するかを選びます">
      <span>表示範囲</span>
      <select id="scHistorySelect">${SC_HISTORY_CHOICES.map(h=>`<option value="${h}">直近${h}時間</option>`).join('')}</select>
     </label>
     <span class="sc-field-reorder-note" id="scFieldReorderNote" hidden>現場段取り: 並べ替えのみ可能</span>
     <button type="button" class="sc-split-toggle" id="scContentModalBtn" hidden title="タイムラインの「内容」欄に出す項目と順序を設備ごとに選びます">📝 内容の項目</button>
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
    <button type="button" class="sc-side-tab" id="scSideToggle" hidden title="設備停止・案内パネルの表示/非表示">◀</button>
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
  const hist=$('#scHistorySelect');
  hist.value=String(scState.historyHours);
  hist.onchange=()=>{
   scState.historyHours=Number(hist.value)||8;
   try{localStorage.setItem(SC_HISTORY_KEY,String(scState.historyHours))}catch(e){/* 保存できなくても表示は変わる */}
   if(scState.equipment)loadPlan();
  };
  $('#scEquipmentSelect').onchange=e=>{scState.equipment=e.target.value;switchToSingle()};
  $('#scModeBoard').onclick=()=>switchToBoard();
  $('#scModeSingle').onclick=()=>switchToSingle();
  $('#scListModalBtn').onclick=()=>listModalOpen?closeListModal():openListModal();
  $('#scStopModalBtn').onclick=()=>stopModalOpen?closeStopModal():openStopModal();
  $('#scContentModalBtn').onclick=()=>contentModalOpen?closeContentModal():openContentModal();
  $('#scSideToggle').onclick=()=>toggleSideCollapsed();
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
 // 一覧に属する3点(絞り込みバー・ツールバー・表本体)は必ずこの順で一緒に動かす。
 // #listToolbarはlist-view.jsが#gridの直前へ差し込むため、移動時に置いていくと
 // 元の画面に取り残されて「一覧が無いのにツールバーだけ残る」ことになる。
 function moveGridTo(host){
  if(!ensureGridAnchor()||!host)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar'),toolbar=document.getElementById('listToolbar');
  if(filterBar)host.appendChild(filterBar);
  if(toolbar)host.appendChild(toolbar);
  if(grid)host.appendChild(grid);
  gridHost=host;
 }
 function returnGridHome(){
  if(!gridHost||!gridAnchor)return;
  const grid=document.getElementById('grid'),filterBar=document.getElementById('genericFilterBar'),toolbar=document.getElementById('listToolbar');
  const main=gridAnchor.parentNode;
  if(filterBar)main.insertBefore(filterBar,gridAnchor);
  if(toolbar)main.insertBefore(toolbar,gridAnchor);
  if(grid)main.insertBefore(grid,gridAnchor);
  gridHost=null;
 }

 // リサイズ可能な分割バー(§9.12改訂・§9.17新設)。以前は境界から離れた
 // ヘッダーの「◫ 仕掛一覧」ボタンで表示/非表示するだけだったが、「ボタン式で
 // 直感的でない」「作業スケジュール欄を広く取りたい」という指摘のため、
 // 境界線そのものをドラッグでリサイズでき、中央のボタンでワンクリック
 // 折りたたみもできる分割バー(.sc-split-divider)へ作り直した。仕掛一覧の
 // 幅・折りたたみ状態はlocalStorageへ保存する。既定幅は380px(スケジュール
 // パネル側=1frが残り全部を取るため、パネルの方が確実に広くなる)。
 let splitListWidth=(()=>{try{const v=+localStorage.getItem('scSplitListWidthV1');return v>0?v:380}catch(e){return 380}})();
 let splitListCollapsed=(()=>{try{return localStorage.getItem('scSplitListCollapsedV1')==='1'}catch(e){return false}})();
 let splitWrap=null;
 /* 分割表示を組み立てるためにこちらから呼ぶselectDb()と、利用者がサイドバーを
    押して画面を移動するselectDb()を区別するためのフラグ(下のselectDbラッパー
    参照)。利用者の操作では必ずスケジュール画面から出るようにするため。 */
 let scInternalDbSwitch=false;
 // §9.22: 品質データ結合(join_quality=1)はlist-view.jsのload()がscheduleモード
 // かどうかで自動的に付け外しする。showSplitList()は元々S.db!=='SIKALOTNOW'の
 // 時しか再取得しなかったため、既にSIKALOTNOWを開いた状態(例:編集モードで
 // 見ていた後にscheduleモードへ切替、あるいは他設備のタイムラインから
 // 戻ってきた場合)でスケジュール分割表示に入ると、join_quality無しで取得済み
 // の古いデータのまま据え置かれ、品質列が出ないままになる不具合があった。
 // この分割表示に入った直後の1回だけload()を強制し、以降(同じ分割表示を
 // 保ったままの再描画)は無駄な再取得をしない。
 let scSplitJoinApplied=false;
 function ensureSplitDivider(){
  let divider=splitWrap.querySelector('.sc-split-divider');
  if(divider)return divider;
  divider=document.createElement('div');divider.className='sc-split-divider';
  divider.innerHTML='<button type="button" class="sc-split-collapse-btn" title="仕掛一覧の表示/非表示"></button>';
  splitWrap.appendChild(divider);
  divider.querySelector('.sc-split-collapse-btn').onclick=e=>{e.stopPropagation();toggleSplitListCollapsed()};
  divider.addEventListener('mousedown',e=>{
   if(e.target.closest('button')||splitListCollapsed)return;
   e.preventDefault();
   const startX=e.clientX,startW=splitListWidth;
   divider.classList.add('dragging');
   function onMove(ev){
    splitListWidth=Math.min(Math.max(240,startW+(ev.clientX-startX)),Math.round(window.innerWidth*0.7));
    applySplitListWidth();
   }
   function onUp(){
    document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
    divider.classList.remove('dragging');
    try{localStorage.setItem('scSplitListWidthV1',String(splitListWidth))}catch(err){/* 保存できなくても表示自体は継続する */}
   }
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  });
  return divider;
 }
 function applySplitListWidth(){
  if(splitWrap)splitWrap.style.setProperty('--sc-list-w',splitListWidth+'px');
 }
 function updateSplitCollapseUi(){
  if(!splitWrap)return;
  splitWrap.classList.toggle('sc-list-collapsed',splitListCollapsed);
  const btn=splitWrap.querySelector('.sc-split-collapse-btn');
  if(btn){btn.textContent=splitListCollapsed?'▶':'◀';btn.title=splitListCollapsed?'仕掛一覧を表示':'仕掛一覧を隠す'}
 }
 function toggleSplitListCollapsed(){
  splitListCollapsed=!splitListCollapsed;
  try{localStorage.setItem('scSplitListCollapsedV1',splitListCollapsed?'1':'0')}catch(e){/* 保存できなくても表示自体は継続する */}
  updateSplitCollapseUi();
 }
 function ensureSplitWrap(){
  if(splitWrap)return splitWrap;
  const panel=document.getElementById('schedulePanel');
  if(!ensureGridAnchor()||!panel)return null;
  splitWrap=document.createElement('div');splitWrap.className='sc-split-wrap';
  gridAnchor.parentNode.insertBefore(splitWrap,gridAnchor);
  moveGridTo(splitWrap);
  splitWrap.appendChild(panel);
  ensureSplitDivider();
  applySplitListWidth();
  updateSplitCollapseUi();
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
 // scheduleモードで1設備のタイムラインを見ている間、仕掛一覧を隣に出す
 // (全体俯瞰ボード・editモード等では対象設備が定まらない/追加できないため
 // 意味が無い)。表示自体の有無ではなく分割バーの折りたたみ(上記
 // splitListCollapsed)で利用者が幅を調整する方針にしたため、ここは常に
 // 分割レイアウトを組み立てる(ポップアップ表示中は先に畳む)。
 async function showSplitList(){
  if(!scState.fullControl||scState.boardMode!=='single'||!scState.equipment)return;
  if(listModalOpen)closeListModal();
  ensureSplitWrap();
  document.body.classList.add('sc-split');
  if(typeof S!=='undefined'&&typeof selectDb==='function'){
   const navBtn=document.querySelector('aside [data-db-key="SIKALOTNOW"]');
   // 内部からの切替なのでスケジュール画面は閉じない(上のscInternalDbSwitch)。
   scInternalDbSwitch=true;
   try{
    if(S.db!=='SIKALOTNOW')await selectDb('SIKALOTNOW',navBtn);
    else if(!scSplitJoinApplied&&typeof load==='function')await load();
   }catch(e){/* 一覧が読めなくてもスケジュール自体の表示は継続する */}
   finally{scInternalDbSwitch=false}
   scSplitJoinApplied=true;
  }
 }
 function hideSplitList(){
  document.body.classList.remove('sc-split');
  teardownSplitWrap();
  scSplitJoinApplied=false;
 }
 function updateSplitToggleUi(){
  const applicable=scState.fullControl&&scState.boardMode==='single';
  const modalBtn=$('#scListModalBtn');
  if(modalBtn){modalBtn.hidden=!applicable;modalBtn.classList.toggle('active',listModalOpen)}
  const contentBtn=$('#scContentModalBtn');
  if(contentBtn){contentBtn.hidden=!applicable;contentBtn.classList.toggle('active',contentModalOpen)}
 }

 /* ---------- .sc-side(案内文+設備停止)の折りたたみ(§9.13改訂) ----------
    「常時表示だとスケジュールの視野を圧迫する」との指摘のため、.sc-side
    全体を折りたたみ可能にし、既定を折りたたみにした。境界に常時見える
    細いタブ(#scSideToggle)を置き、ヘッダーの離れたボタンより発見しやすい
    位置で開閉できるようにする(§9.13で追加した内側の#scStopSectionToggleは
    「設備停止を追加」節だけの開閉として維持し、こちらは.sc-side自体の
    開閉というもう1段上の階層)。 */
 let scSideCollapsed=(()=>{try{return (localStorage.getItem('scSideCollapsedV1')??'1')==='1'}catch(e){return true}})();
 function updateSideUi(){
  const applicable=scState.fullControl&&scState.boardMode==='single';
  const tab=$('#scSideToggle'),side=$('#scSide');
  if(tab)tab.hidden=!applicable;
  if(side)side.hidden=!applicable||scSideCollapsed;
  if(tab){tab.textContent=scSideCollapsed?'◀':'▶';tab.title=scSideCollapsed?'案内・設備停止パネルを表示':'案内・設備停止パネルを隠す'}
 }
 function toggleSideCollapsed(){
  scSideCollapsed=!scSideCollapsed;
  try{localStorage.setItem('scSideCollapsedV1',scSideCollapsed?'1':'0')}catch(e){/* 保存できなくても表示自体は継続する */}
  updateSideUi();
 }

 /* ---------- 汎用フローティングウィンドウ(§9.16新設) ----------
    仕掛一覧・設備停止のポップアップ表示に使う共通基盤。既存の.record-modal
    (全画面シェード+中央ダイアログ)はシェードが背景を覆うため、ウィンドウの
    外側=タイムラインへドラッグ&ドロップできないという不具合があった
    (実際に報告された不具合)。ここでは全画面シェードを持たず、ヘッダーの
    ドラッグで移動・右下角のドラッグでリサイズできる「浮いた」ウィンドウに
    し、背景(タイムライン)は常に操作可能なままにする。位置・大きさは
    localStorageへ保存し次回も再現する。 */
 function makeFloatingWindow(el,opts){
  const o=Object.assign({storageKey:'',defaultWidth:520,defaultHeight:480,defaultTop:86,defaultRight:24,minWidth:300,minHeight:220},opts||{});
  const header=el.querySelector('.sc-float-header');
  const resizeHandle=el.querySelector('.sc-float-resize');
  let rect={width:o.defaultWidth,height:o.defaultHeight,top:o.defaultTop,left:null};
  try{
   const saved=o.storageKey&&JSON.parse(localStorage.getItem(o.storageKey)||'null');
   if(saved&&typeof saved==='object')rect=Object.assign(rect,saved);
  }catch(e){/* 保存値が壊れていても既定値で開始する */}
  function clampToViewport(){
   // ウィンドウ全体(右下角の抽出ハンドル・閉じるボタン含む)が画面外へ
   // 出てしまうと、以後リサイズも移動もできなくなり実質操作不能になる。
   // 固定マージンではなく実際の幅・高さを差し引いて上限を決める。
   rect.width=Math.min(rect.width,Math.max(o.minWidth,window.innerWidth-20));
   rect.height=Math.min(rect.height,Math.max(o.minHeight,window.innerHeight-20));
   const maxLeft=Math.max(0,window.innerWidth-rect.width);
   const maxTop=Math.max(0,window.innerHeight-rect.height);
   if(rect.left!=null)rect.left=Math.min(Math.max(0,rect.left),maxLeft);
   rect.top=Math.min(Math.max(0,rect.top),maxTop);
  }
  function applyRect(){
   clampToViewport();
   el.style.width=rect.width+'px';
   el.style.height=rect.height+'px';
   el.style.top=rect.top+'px';
   if(rect.left==null){el.style.left='';el.style.right=o.defaultRight+'px'}
   else{el.style.left=rect.left+'px';el.style.right=''}
  }
  function save(){try{if(o.storageKey)localStorage.setItem(o.storageKey,JSON.stringify(rect))}catch(e){/* 保存できなくても表示自体は継続する */}}
  function dragToMove(startEvent){
   if(startEvent.target.closest('button'))return;
   startEvent.preventDefault();
   const startX=startEvent.clientX,startY=startEvent.clientY;
   const startBox=el.getBoundingClientRect();
   const startLeft=startBox.left,startTop=startBox.top;
   function onMove(ev){rect.left=startLeft+(ev.clientX-startX);rect.top=startTop+(ev.clientY-startY);applyRect()}
   function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);save()}
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  }
  function dragToResize(startEvent){
   startEvent.preventDefault();startEvent.stopPropagation();
   const startX=startEvent.clientX,startY=startEvent.clientY;
   const startW=rect.width,startH=rect.height;
   function onMove(ev){rect.width=Math.max(o.minWidth,startW+(ev.clientX-startX));rect.height=Math.max(o.minHeight,startH+(ev.clientY-startY));applyRect()}
   function onUp(){document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);save()}
   document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);
  }
  if(header)header.addEventListener('mousedown',dragToMove);
  if(resizeHandle)resizeHandle.addEventListener('mousedown',dragToResize);
  window.addEventListener('resize',()=>applyRect());
  applyRect();
 }

 /* ---------- 仕掛一覧のポップアップ表示(§9.14新設) ----------
    折りたたみ・画面が狭い時でも、分割表示へ切り替えずに一覧からドラッグで
    追加できるようにする代替の入口。#grid自体は同時に1箇所にしか置けない
    ため、開くときは分割表示を畳む。 */
 let listModalOpen=false;
 function ensureListModal(){
  let modal=document.getElementById('scListModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scListModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><small>SIKALOTNOW</small><h2>仕掛一覧(ドラッグでスケジュールへ追加)</h2></div><button type="button" id="scListModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scListModalBody"></div>
   <!-- 下端の細い帯。一覧(#grid)の横スクロールバーとリサイズのつまみが
        同じ位置に重なると、角をドラッグしてもスクロールバーを掴んでしまい
        大きさを変えられない(行数が多いほど確実に重なる)。つまみ用の行を
        確保するために必ず置くこと。 -->
   <div class="sc-float-foot sc-list-foot"><span>行をドラッグ、または複数選択してタイムラインへドロップすると予定に追加されます</span></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  // 閉じたら分割表示が適用条件を満たしていればそちらへ戻す(該当しなければ
  // showSplitList()内部で無視される)。exitScheduleView/全体ボード切替からの
  // closeListModal()はこのクリックハンドラを経由しないため、無関係な場面で
  // 分割表示を再構築してしまうことはない。
  modal.querySelector('#scListModalClose').onclick=()=>{closeListModal();showSplitList()};
  makeFloatingWindow(modal,{storageKey:'scListModalRectV2',defaultWidth:760,defaultHeight:600,defaultTop:80,minWidth:360,minHeight:320});
  return modal;
 }
 async function openListModal(){
  const modal=ensureListModal();
  if(splitWrap)hideSplitList();
  moveGridTo(modal.querySelector('#scListModalBody'));
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

 /* 仕掛一覧の表示密度は、作業スケジュール画面だけの「高密度」トグルから
    アプリ全体の表示サイズ5段階(base.jsのapplyUiSize、html[data-ui-size])へ
    統合した。行の高さ・余白・文字サイズはapp.cssの --row-h ・--row-pad-y ・
    --row-pad-x ・--fs 系トークンが --ui-scale を掛けて決めるため、この画面
    固有の切替は不要になった。 */

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
 // 既にスケジュールへ投入済みのロットを仕掛一覧から消す(§9.15新設、
 // list-view.js renderGrid()から参照)。今開いている設備のscState.entries
 // (種別='作業'のみ、設備停止にロット番号は無い)に含まれるロット番号を
 // 返す。楽観的追加(__pending)の間もすぐ一覧から消えてほしいため、ここは
 // pendingかどうかを区別しない。
 window.scScheduledLotSet=function(){
  if(!scState.fullControl||scState.boardMode!=='single'||!scState.equipment)return null;
  const set=new Set();
  scState.entries.forEach(e=>{if(e.kind==='作業'&&e.lotNo)set.add(String(e.lotNo))});
  return set;
 };

 /* ---------- ビュー排他制御 ---------- */
 function exitScheduleView(){
  if(!document.body.classList.contains('sc-mode'))return;
  document.body.classList.remove('sc-mode');
  document.getElementById('schedulePanel')?.setAttribute('hidden','');
  document.getElementById('openSchedule')?.classList.remove('active');
  closeListModal();closeStopModal();closeColumnModal();closeContentModal();
  hideSplitList();
  stopLockPolling();
  stopSessionHeartbeat();
  if(scSessionHeldFor){releaseSessionFire(scSessionHeldFor);scSessionHeldFor=null}
  scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;
 }
 window.exitScheduleView=exitScheduleView;
 /* 分割表示を組み立てるためにこちらから呼ぶselectDb()と、利用者が
    サイドバーを押して画面を移動するselectDb()を区別するためのフラグ。
    以前は「scheduleモード+設備選択済みならSIKALOTNOWへの切替では画面を
    閉じない」という特例で分けていたが、これだと利用者がサイドバーの
    「仕掛（現在）」を押して一覧へ移動したつもりでも、スケジュールパネルと
    幅調整の分割バーが残ったままになる(サイドバーは画面の切替である、という
    docs/ARCHITECTURE.md「画面の開き方・閉じ方の約束」に反する。実際に
    「スケジュールの幅位置調整スライダーが他の画面へ侵食する」として
    報告された不具合)。判定を「呼び出し元が内部かどうか」に変え、利用者の
    操作では必ずスケジュール画面から出るようにした。 */
 if(typeof selectDb==='function'){
  const oldSelectDb=selectDb;
  selectDb=async function(k,b){
   if(!scInternalDbSwitch)exitScheduleView();
   return oldSelectDb(k,b);
  };
 }

 async function openScheduleView(){
  window.exitCalendarView?.();
  window.exitMasterMaint?.();
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
  // §9.35: 予定から測定を開始できるのは、実際に測定する端末(編集モード)だけ。
  // scheduleモードは計画専用の端末、viewモードは閲覧専用のため出さない。
  scState.canStartWork=(am.mode==='edit');
  $('#scFieldReorderNote').hidden=!scState.fieldReorderOnly;

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
  const histWrap=$('#scHistoryRange');if(histWrap)histWrap.hidden=inBoard;
  if(scState.pickerEnabled)$('#scEquipmentSelect').hidden=inBoard;
  updateSideUi();
  const stopBtn=$('#scStopModalBtn');if(stopBtn)stopBtn.hidden=!scState.fullControl||inBoard;
  document.querySelectorAll('.sc-board-window-btn').forEach(btn=>btn.classList.toggle('active',+btn.dataset.hours===scState.boardWindowHours));
  updateSplitToggleUi();
  // 全体俯瞰ボードや対象設備が無い状態では分割表示(§9.10)の意味が無いため
  // 畳む(仕掛一覧を隣に出したまま設備を切り替えても違和感が無いよう、
  // 個別タイムライン表示中はshowSplitList側で改めて出す)。
  if(inBoard){hideSplitList();closeListModal();closeStopModal();closeColumnModal();closeContentModal()}
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
 // 「他端末がこの設備を編集中」と確定できた場合(423+sessionLockedBy)だけ
 // 操作を止める。ネットワーク不調・タイムアウト等、確定できないエラーでは
 // 操作を止めない(fail-open)。schedule_share_pathは工場ネットワーク共有上に
 // あり、CLAUDE.mdに記録の通り遅延・一時的な接続不調が実際に起きる環境の
 // ため、「原因不明のエラー=安全側でブロック」にすると、ネットワークが
 // 少し不安定なだけで無言のまま追加・削除・並べ替え・ドラッグが一切効かなく
 // なるという、この機能が解決したかった「遅い」より遥かに悪い状態になって
 // しまう(実際に報告された不具合。#scSessionBannerも表示されないまま
 // 固まって見える点が特に悪い)。データ本体の整合性はwith_write()側の
 // ロック+改訂番号チェックが最終防御として引き続き機能するため、この
 // セッション機構が失敗してもデータが壊れることはない。
 function sessionBlocked(){
  return sessionApplicable()&&!scState.sessionHeld&&!!scState.sessionHolder;
 }
 async function acquireSessionOnce(){
  const eq=scState.equipment;
  try{
   await api('/api/schedule/session/acquire',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:eq})});
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scState.sessionHeld=true;scState.sessionHolder=null;scState.sessionError=null;
  }catch(e){
   if(scState.equipment!==eq)return;
   scState.sessionHeld=false;
   if(e.sessionLockedBy&&(e.sessionLockedBy.loginId||e.sessionLockedBy.pcName)){
    // 明確に他端末が保持中と判定できた場合だけブロック対象にする。
    scState.sessionHolder=e.sessionLockedBy;scState.sessionError=null;
   }else{
    // 原因不明(ネットワーク不調・タイムアウト・設定未完了等)。ブロックは
    // しないが、状況が分かるよう控えめな警告だけは出す(renderSessionBanner)。
    scState.sessionHolder=null;scState.sessionError=e.message||String(e);
   }
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
   if(scState.sessionHeld||scState.sessionHolder||scState.sessionError){
    scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;renderSessionBanner();
   }
   return;
  }
  if(scSessionTimer)return; // 既にこの設備でハートビート中
  startSessionHeartbeat();
 }
 function renderSessionBanner(){
  const box=$('#scSessionBanner');if(!box)return;
  if(!sessionApplicable()||scState.sessionHeld){
   box.hidden=true;box.innerHTML='';box.className='sc-session-banner';
   applyWriteControlsEnabled(true);
   return;
  }
  if(scState.sessionHolder){
   // 他端末が保持中と確定できた場合のみ操作を止める(sessionBlocked()と同じ判定)。
   const h=scState.sessionHolder;
   box.hidden=false;box.className='sc-session-banner sc-session-banner-blocked';
   box.innerHTML=`<span>⚠ ${esc(scState.equipment)}は${esc(h.loginId||'?')}@${esc(h.pcName||'?')}が編集中です。追加・削除・並べ替えは今は操作できません(閲覧のみ)。</span><button type="button" id="scSessionRetry">再試行</button>`;
   $('#scSessionRetry').onclick=()=>acquireSessionOnce();
   applyWriteControlsEnabled(false);
   return;
  }
  if(scState.sessionError){
   // 原因不明のエラー。操作は止めない(fail-open)が、編集セッションが
   // 正しく機能していない可能性を控えめに伝える(閉じるだけで消せる)。
   box.hidden=false;box.className='sc-session-banner sc-session-banner-warn';
   box.innerHTML=`<span>編集セッションの取得に失敗しました(${esc(scState.sessionError)})。他端末との同時編集チェックが一時的に効かない可能性がありますが、操作は継続できます。</span><button type="button" id="scSessionRetry">再試行</button><button type="button" id="scSessionDismiss" title="閉じる">×</button>`;
   $('#scSessionRetry').onclick=()=>acquireSessionOnce();
   $('#scSessionDismiss').onclick=()=>{box.hidden=true};
   applyWriteControlsEnabled(true);
   return;
  }
  box.hidden=true;box.innerHTML='';box.className='sc-session-banner';
  applyWriteControlsEnabled(true);
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
 // 共有スケジュールDBはネットワーク共有上にあり、設備数だけ予定を展開する
 // ため数秒かかることがある。パネル内の「読み込んでいます…」だけだと画面
 // 全体では無反応に見えるので、WAITING表示も併せて出す(withWaitingは
 // 速いときには出ないため、ローカル検証時の操作感は変わらない)。
 async function loadOverviewBoard(){
  if(typeof withWaiting!=='function')return loadOverviewBoardInner();
  return withWaiting({title:'全設備の空き状況を読み込んでいます',detail:'共有スケジュールDBを参照しています',
   progress:'設備ごとの予定を展開して集計しています'},()=>loadOverviewBoardInner());
 }
 async function loadOverviewBoardInner(){
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
  if(typeof withWaiting!=='function')return refreshAllInner(()=>{});
  return withWaiting({title:'作業スケジュールを読み込んでいます',
   detail:scState.equipment?('設備: '+scState.equipment):'共有スケジュールDBを参照しています',
   progress:'表示設定と予定を取得しています',step:1},report=>refreshAllInner(report));
 }
 async function refreshAllInner(report){
  // 列表示マスタ(§9.18)はloadPlan()のrenderTimeline()が「内容」欄の組み立てに
  // 使うため、先に取得しておく(後から取得すると初回描画が古い/未設定の
  // プリファレンスのまま出て、直後に列が変わるちらつきが起きる)。
  if(scState.fullControl){await loadScheduleColumnPrefs();await loadScheduleContentPrefs()}
  await loadPlan();
  if(scState.fullControl)await loadStopReasons();
  report({progress:'仕掛一覧を並べて表示しています',step:2});
  await showSplitList();
 }
 async function loadPlan(){
  if(!scState.equipment)return;
  const timeline=$('#scTimeline');
  timeline.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(scState.equipment)
    +'&history_hours='+encodeURIComponent(scState.historyHours));
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
 function updateFixedStart(id,localValue){
  // §9.22: 他の書込と同様、書込キュー経由の一方通行にする(直接await→
  // loadPlan()だと、この操作だけ編集中に表示が一瞬消える対象として残って
  // しまうため)。楽観的にローカルへ反映し、失敗した時だけ元へ戻す。
  const iso=localValue?new Date(localValue).toISOString():null;
  const entry=scState.entries.find(e=>e.id===id);
  if(!entry)return;
  const previous=entry.fixedStart;
  entry.fixedStart=iso;renderTimeline();
  queueScheduleWrite(
   ()=>api('/api/schedule/plan/update',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({id,fixedStart:iso}))}),
   ()=>{entry.fixedStart=previous;if(scState.equipment)renderTimeline()}
  );
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
 // 年月日カラム(§9.20新設)。時刻とは別枠で常時表示する(以前は時刻セルの
 // title(ツールチップ)にしか出ておらず、一覧性が悪いという指摘のため)。
 const WEEKDAY_JA=['日','月','火','水','木','金','土'];
 function fmtDateShort(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
 }
 function fmtDateTitle(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}(${WEEKDAY_JA[d.getDay()]})`;
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
 /* 「内容」欄の組み立て。設備ごとの「スケジュール内容表示マスタ」
    (scContentPrefs、/api/schedule-content-master)で選んだ項目を、選んだ順に
    並べて1行の要約にする。値はe.detail(buildScheduleDetailが生カラム名でも
    alias名でも引けるようスナップショット済み)から取る。
    未設定の設備は、ロット番号・用途名・製造材質・調質の既定組み立てへ
    フォールバックする(どの設備・どの仕掛データ構成でも成立する既定値)。
    以前は仕掛一覧の表示列マスタを流用していたため、一覧に出したい列数
    (10列など)がそのまま内容欄の要素数になってしまい実用にならなかった。 */
 function entryContentText(e){
  if(e.kind!=='作業')return (e.title||'設備停止').trim();
  const items=(scContentPrefs.equipment===scState.equipment)?scContentPrefs.items:null;
  if(items&&items.length){
   const parts=items.map(k=>contentValueOf(e.detail,k)).filter(v=>v!==undefined);
   if(parts.length)return parts.map(v=>String(v).trim()).join(' / ');
  }
  return `${e.lotNo||'-'} ${e.detail?.purposeName||''} ${e.detail?.mfgMaterial||''}${e.detail?.mfgTemper?'-'+e.detail.mfgTemper:''}`.trim();
 }
 const ROW_HEAD_HTML=`<div class="sc-row-head">
  <span></span><span></span><span>日付</span><span>時刻</span><span>勤務</span><span>残り</span><span>内容</span><span>見積</span><span>実績</span><span>備考</span><span>操作</span>
 </div>`;

 /* ---------- 実施中/予定/実績のグルーピング(§9.34) ----------
    以前は予定・実施中・完了が1本の並びに混ざっており、「今どれをやって
    いるのか」「さっき何が終わったのか」を目で追う必要があった。状態で
    3つに切り分け、それぞれ見出しを付ける。
      実施中: 着手(計画済み・計画外の両方)。今この設備を塞いでいるもの
      予定  : 未着手。時刻順にそのまま
      実績  : 完了・取消。表示範囲(historyHours)内のものだけ
    完了/取消はplannedStart/Endを持たない(終端状態は展開対象外)ため、
    表示範囲の判定にはactual.endAtを使う。actualも無い取消は、履歴の
    末尾に残す(消してしまうと「取り消したはずの予定が見当たらない」と
    なるため)。 */
 function historyCutoff(){
  return Date.now()-(scState.historyHours||8)*3600000;
 }
 function withinHistory(e){
  const at=e.actual&&(e.actual.endAt||e.actual.startAt);
  if(!at)return true;
  const t=new Date(at).getTime();
  return Number.isNaN(t)?true:t>=historyCutoff();
 }
 function groupEntries(entries){
  const running=[],planned=[],history=[];
  entries.forEach(e=>{
   if(e.state==='着手')running.push(e);
   else if(e.state==='完了'||e.state==='取消'){if(withinHistory(e))history.push(e)}
   else planned.push(e);
  });
  // 実績は新しい順(直前に終わったものが一番上)
  history.sort((a,b)=>{
   const ta=new Date((a.actual&&(a.actual.endAt||a.actual.startAt))||0).getTime()||0;
   const tb=new Date((b.actual&&(b.actual.endAt||b.actual.startAt))||0).getTime()||0;
   return tb-ta;
  });
  return {running,planned,history};
 }
 function groupHeadHtml(label,count,note){
  return `<div class="sc-group-head"><span class="sc-group-label">${esc(label)}</span>`
   +`<span class="sc-group-count">${count}件</span>`
   +(note?`<span class="sc-group-note">${esc(note)}</span>`:'')+`</div>`;
 }

 function renderTimeline(){
  const timeline=$('#scTimeline');
  const groups=groupEntries(scState.entries);
  const total=groups.running.length+groups.planned.length+groups.history.length;
  if(!total){
   timeline.innerHTML=scState.entries.length
    ?`<div class="sc-empty-note">表示範囲(直近${scState.historyHours}時間)に該当する予定・実績がありません。表示範囲を広げてください。</div>`
    :'<div class="sc-empty-note">この設備の予定はまだありません。</div>';
   refreshScheduledLotFilter();
   return;
  }
  timeline.innerHTML='';
  // 各セクションは必ず専用のコンテナへ入れる。並べ替え(wireDrag/moveCard/
  // commitDragOrder)はDOMの兄弟関係でしか動かないため、素の兄弟として
  // 並べると「予定」の行を「実績」の位置へドラッグできてしまう。
  const section=(key,label,list,note,showGaps)=>{
   if(!list.length)return;
   const box=document.createElement('div');
   box.className='sc-group';box.dataset.group=key;
   box.insertAdjacentHTML('beforeend',groupHeadHtml(label,list.length,note));
   box.insertAdjacentHTML('beforeend',ROW_HEAD_HTML);
   let lastEnd=null;
   list.forEach(e=>renderEntryRow(box,e,showGaps,()=>lastEnd,v=>{lastEnd=v}));
   timeline.append(box);
  };
  section('running','実施中',groups.running,groups.running.some(e=>e.unplanned)?'計画外の作業も含みます':'',false);
  section('planned','予定',groups.planned,'',true);
  section('history','実績',groups.history,`直近${scState.historyHours}時間`,false);
  refreshScheduledLotFilter();
 }

 function renderEntryRow(timeline,e,showGaps,getLastEnd,setLastEnd){
  {
   const lastEnd=getLastEnd();
   if(showGaps&&e.plannedStart&&lastEnd){
    const gapMin=(new Date(e.plannedStart)-new Date(lastEnd))/60000;
    if(gapMin>1){
     const isFixedGap=e.fixedStart&&Math.abs(new Date(e.fixedStart)-new Date(e.plannedStart))<60000;
     const div=document.createElement('div');
     div.className='sc-gap-divider';
     div.textContent=`── ${fmtMinutes(gapMin)}の空き・${fmtDateTime(lastEnd)}〜${fmtDateTime(e.plannedStart)}${isFixedGap?'・固定開始時刻待ち':''} ──`;
     timeline.append(div);
    }
   }
   if(e.plannedEnd)setLastEnd(e.plannedEnd);

   const row=document.createElement('div');
   row.className='sc-row-line '+stateRowClass(e.state)+(e.__pending?' sc-row-pending':'');
   row.dataset.id=e.id;
   const canDrag=scState.editable&&e.reorderable&&!e.__pending&&!sessionBlocked();
   row.draggable=canDrag;
   if(canDrag)row.tabIndex=0;

   const lotText=entryContentText(e);
   // 完了・取消は予定時刻を持たない(展開対象外)ので、実績の開始/終了を出す。
   // 以前は一律「-」で、実績セクションだけ時刻が全く読めなかった。
   const useActual=(e.state==='完了')&&e.actual&&e.actual.startAt;
   const showStart=useActual?e.actual.startAt:e.plannedStart;
   const showEnd=useActual?e.actual.endAt:e.plannedEnd;
   const dateText=showStart?fmtDateShort(showStart):'-';
   const dateTitle=showStart?fmtDateTitle(showStart):'';
   const timeText=showStart?fmtTimeRange(showStart,showEnd):(e.state==='完了'||e.state==='取消'?'-':'未定');
   const timeTitle=showStart?`${useActual?'実績 ':''}${fmtDateTime(showStart)} 〜 ${fmtDateTime(showEnd)}`:'';
   const shiftText=e.shift||'-';
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
    e.unplanned?'<span class="sc-flag sc-flag-unplanned" title="予定に無い実績です(仕掛一覧から直接開始した作業など)">計画外</span>':'',
    e.__pending?'<span class="sc-flag sc-flag-pending" title="サーバーへ反映中です">⏳追加中</span>':'',
    e.overdueMinutes>0?`<span class="sc-flag sc-flag-overdue" title="${Math.round(e.overdueMinutes)}分押しています">⚠${Math.round(e.overdueMinutes)}分</span>`:'',
    e.spansNonWorking?'<span class="sc-flag sc-flag-spans" title="夜間・休日を跨ぎます">🌙</span>':'',
    e.fixedStart?`<span class="sc-flag sc-flag-fixed" title="固定開始 ${fmtDateTime(e.fixedStart)}">📌</span>`:'',
   ].join('');
   const detailHtml=fixedStartHtml(e)+estimateBreakdownHtml(e);
   const canDelete=scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned;
   // §9.35: 編集モード(=実際に測定する端末)なら、予定から直接測定画面を開ける。
   // 開始時刻を打刻すると実績突合(§7.4)でこの行が「実施中」へ移る。
   const canStart=scState.canStartWork&&e.kind==='作業'&&e.state==='予定'&&!e.__pending&&!e.unplanned;

   row.innerHTML=`
    <span class="sc-row-handle" title="${canDrag?'ドラッグまたはAlt+↑/↓で並べ替え':''}">${canDrag?'⠿':(e.state==='着手'?'🔒':'')}</span>
    <span class="sc-row-icon" title="${esc(e.kind)}・${esc(e.state)}">${stateIcon(e.kind,e.state)}</span>
    <span class="sc-row-date" title="${esc(dateTitle)}">${esc(dateText)}</span>
    <span class="sc-row-time" title="${esc(timeTitle)}">${esc(timeText)}</span>
    <span class="sc-row-shift" title="勤務形態マスタで設定した名称です">${esc(shiftText)}</span>
    <span class="sc-row-rel">${esc(relText)}</span>
    <span class="sc-row-title" title="${esc(lotText)}">${esc(lotText)}</span>
    <span class="sc-row-est${estDefault?' sc-est-default':''}" title="${estDefault?'実績データが無いための暫定既定値です':''}">${estDefault?'~':''}${esc(estText)}</span>
    <span class="sc-row-actual">${esc(actualText)}</span>
    <span class="sc-row-flags">${flags}</span>
    <span class="sc-row-actions">
     ${canStart?`<button type="button" class="sc-row-btn sc-row-start" title="この予定の測定画面を開いて作業を開始します">▶ 開始</button>`:''}
     ${detailHtml?`<button type="button" class="sc-row-btn sc-row-detail-toggle" title="詳細を表示">▾</button>`:''}
     ${canDelete?`<button type="button" class="sc-row-btn sc-row-delete" title="削除">🗑</button>`:''}
    </span>`;
   if(canDrag)wireDrag(row);
   const del=row.querySelector('.sc-row-delete');
   if(del)del.onclick=ev=>{ev.stopPropagation();deleteEntry(e.id)};
   const start=row.querySelector('.sc-row-start');
   if(start)start.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
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
  }
 }
 // scState.entriesが変わるたびに、既にスケジュール投入済みのロットが仕掛
 // 一覧から消える(§9.15)よう#gridを再描画する。SIKALOTNOWを見ていない
 // 時は無駄なので、S.dbで確認してから呼ぶ。
 function refreshScheduledLotFilter(){
  if(typeof renderGrid==='function'&&typeof S!=='undefined'&&S.db==='SIKALOTNOW')renderGrid();
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
    数回リトライしてから諦める。諦めた操作だけonFailureでロールバックする
    (§9.22改訂、下記)。
    以前はキューが空になるたびloadPlan()でサーバー側の最終状態に描き直して
    いたが、これが「書込完了→再読込→再描画」という一往復を挟むため、
    ロック保持中(1人だけが編集している最中)でも表示が一瞬消える体感になって
    いた(読み込み中プレースホルダを一旦挟むため)。編集セッションは設備単位で
    同時に1人しか入れない設計(schedule_sync.pyのacquire_session)のため、
    自分が保持している間は他端末とのデータ競合が起きようがない。そこで
    書込を一方通行にし、セッション対象(sessionApplicable())の間は自動再読込
    をしない。読み込みは編集モードに入るタイミング(openScheduleView/
    refreshAll等の既存呼び出し)や、他端末編集中の閲覧時(sessionApplicable()
    がfalseの場面)にのみ行う。この間、削除・並べ替え直後に他の予定の見積/
    残り時間等サーバー側の再計算値が古いままになるのは許容する
    (次に編集モードへ入った時点で正規化される)。 */
 function queueScheduleWrite(run,onFailure){
  scWriteQueue.push({run,onFailure,attempts:0});
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
     if(op.attempts>=3){
      scWriteQueue.shift();failures.push(e);
      try{op.onFailure&&op.onFailure(e)}catch(err){/* ロールバック自体の失敗はここでは無視(諦めたことは既にfailuresへ記録済み) */}
     }
     else await sleep(700*op.attempts);
    }
   }
  }finally{
   scQueueRunning=false;
   if(failures.length){
    const msg=failures.length===1?failures[0].message:`${failures.length}件の変更を反映できませんでした`;
    showToast&&showToast('一部の変更を反映できませんでした',msg,7000);
   }
   if(scState.equipment&&!sessionApplicable())await loadPlan(); // 自分が編集中の設備以外(=他端末編集中の閲覧時)だけ最終状態で正規化する
  }
 }
 // 楽観的追加(makeOptimisticEntry)で割り当てた仮ID(tmp-N)を、書込キューでの
 // サーバー反映後に本来のIDへ差し替える。削除・並べ替えボタンは__pending中は
 // 無効化してあるため、この差し替えが完了するまでは対象にならない
 // (§9.22、上のrunWriteQueueコメント参照)。
 function resolveOptimisticEntry(entry,result){
  entry.id=result.id;entry.__pending=false;
  if(scState.equipment)renderTimeline();
 }
 // 追加が最終的に失敗した(リトライを使い切った)場合、楽観的に足しておいた
 // 仮エントリを取り消す。
 function discardOptimisticEntry(entry){
  const idx=scState.entries.indexOf(entry);
  if(idx!==-1){scState.entries.splice(idx,1);if(scState.equipment)renderTimeline()}
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
  queueScheduleWrite(
   ()=>api('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(withUserId({id}))}),
   ()=>{
    // リトライを使い切って諦めた時だけロールバックする(§9.22)。以前は
    // 失敗するたびに毎回ロールバックしていたため、1回目失敗→ロールバック→
    // 2回目成功、という順で実際にはサーバー側は削除済みなのに画面へ復活
    // したまま二度と消えない不整合が起こり得た。
    if(scState.entries.every(x=>x.id!==removed.id)){scState.entries.splice(Math.min(idx,scState.entries.length),0,removed);renderTimeline()}
   }
  );
 }

 /* ---------- ドラッグ並べ替え(§7.5・§9.4) + Alt+↑/↓ ---------- */
 function wireDrag(card){
  // idは文字列のまま扱う。計画外実績(§9.33)の合成idは'actual:<記録ID>'で
  // 数値化するとNaNになり、比較もMap引きも静かに壊れる。
  card.addEventListener('dragstart',e=>{scState.dragId=card.dataset.id;card.classList.add('sc-dragging');e.dataTransfer.effectAllowed='move'});
  card.addEventListener('dragend',()=>{card.classList.remove('sc-dragging');scState.dragId=null});
  card.addEventListener('dragover',e=>{
   if(scState.dragId==null)return;
   e.preventDefault();
   const target=card;if(target.dataset.id===scState.dragId)return;
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
  // 並べ替えの対象は「予定」セクションだけ。実施中・実績の行まで拾うと、
  // 表示上の並び(実施中→予定→実績)をそのまま予定の順序としてサーバーへ
  // 送ってしまう。
  const host=$('#scTimeline .sc-group[data-group="planned"]')||$('#scTimeline');
  const domIds=[...host.querySelectorAll('.sc-row-line')].map(c=>c.dataset.id);
  const byId=new Map(scState.entries.map(e=>[String(e.id),e]));
  const dragged=domIds.map(id=>byId.get(id)).filter(Boolean);
  const ids=dragged.filter(e=>e.reorderable).map(e=>e.id);
  const draggedSet=new Set(dragged.map(e=>String(e.id)));
  const others=scState.entries.filter(e=>!draggedSet.has(String(e.id)));
  scState.entries=[...others.filter(e=>e.state==='着手'),...dragged,...others.filter(e=>e.state!=='着手')];
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
  const entry=makeOptimisticEntry('設備停止',{title:label});
  scState.entries.push(entry);
  renderTimeline();
  queueScheduleWrite(
   ()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:target,kind:'設備停止',position:'end',stopReasonId:reasonId}))}).then(r=>resolveOptimisticEntry(entry,r)),
   ()=>discardOptimisticEntry(entry)
  );
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
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scStopModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><small>STOP REASON</small><h2>設備停止を追加</h2></div><button type="button" id="scStopModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scStopModalBody"></div>
   <div class="sc-float-resize" title="ドラッグでサイズ変更"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scStopModalClose').onclick=()=>closeStopModal();
  makeFloatingWindow(modal,{storageKey:'scStopModalRectV1',defaultWidth:360,defaultHeight:420,defaultTop:80,minWidth:260,minHeight:200});
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

 /* ---------- 設備ごとのスケジュール列表示マスタ(§9.18新設) ----------
    分割/ポップアップ表示の仕掛一覧に出す列を設備ごとに選べるようにする
    (backend/repositories/master_repo.pyのSCHEDULE_COLUMN_TABLE)。1件も
    選ばれていない設備は「未設定=全列表示」(他マスタと同じ互換ポリシー)。
    list-view.js renderGrid()はwindow.scColumnAllowlist()を呼んでフィルタ
    する(関数の定義は1箇所、列フィルタ自体の実装はlist-view.js側のみ)。 */
 let scColumnPrefs={equipment:'',columns:null};
 async function loadScheduleColumnPrefs(){
  if(!scState.equipment){scColumnPrefs={equipment:'',columns:null};return}
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule-column-master?equipment='+encodeURIComponent(eq));
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scColumnPrefs={equipment:eq,columns:(r.columns&&r.columns.length)?r.columns:null};
  }catch(e){
   if(scState.equipment!==eq)return;
   scColumnPrefs={equipment:eq,columns:null}; // 取得に失敗しても全列表示にフォールバックする(fail-open)
  }
  refreshScheduledLotFilter();
 }
 window.scColumnAllowlist=function(){
  if(!scState.fullControl||!scState.equipment||scColumnPrefs.equipment!==scState.equipment)return null;
  return scColumnPrefs.columns;
 };

 /* 仕掛一覧の表示列を選ぶウィンドウ。ボタンは一覧側のツールバー
    (list-view.jsの#listColumnBtn)にあり、ここは実装だけを持つ
    (操作対象=仕掛一覧の近くにボタンを置くため。以前はスケジュール
    ヘッダーにあり、何に効く設定なのか分かりにくかった)。 */
 let columnModalOpen=false;
 function ensureColumnModal(){
  let modal=document.getElementById('scColumnModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scColumnModal';modal.hidden=true;
  modal.innerHTML=`
   <div class="sc-float-header"><div><small>LIST COLUMNS</small><h2>仕掛一覧に表示する列</h2></div><button type="button" id="scColumnModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scColumnModalBody"></div>
   <div class="sc-float-foot" id="scColumnModalFoot"></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scColumnModalClose').onclick=()=>closeColumnModal();
  makeFloatingWindow(modal,{storageKey:'scColumnModalRectV2',defaultWidth:360,defaultHeight:500,defaultTop:80,minWidth:300,minHeight:300});
  return modal;
 }
 function renderColumnModalBody(){
  const body=document.getElementById('scColumnModalBody');if(!body)return;
  if(!scState.equipment){body.innerHTML='<div class="sc-empty-note">設備を選択してください。</div>';return}
  const allCols=(typeof S!=='undefined'?S.columns:null)||[];
  if(!allCols.length){body.innerHTML='<div class="sc-empty-note">仕掛一覧を先に開いてください(列名の取得が必要です)。</div>';return}
  const selected=(scColumnPrefs.equipment===scState.equipment&&scColumnPrefs.columns)?new Set(scColumnPrefs.columns):null;
  body.innerHTML=`<p class="sc-drop-hint">${esc(scState.equipment)}の仕掛一覧に出す列を選びます(設備ごとに保存)。1つも選ばなければ全列を表示します。タイムラインの「内容」欄はこことは別に、ヘッダーの「内容の項目」で選びます。</p>
   <div class="sc-column-list">${allCols.map(c=>`<label class="sc-column-item"><input type="checkbox" value="${esc(c)}"${(!selected||selected.has(c))?' checked':''}> ${esc(c)}</label>`).join('')}</div>`;
  // 保存はスクロール領域の外(固定フッター)へ置く。
  const foot=document.getElementById('scColumnModalFoot');
  if(foot){
   foot.innerHTML=`<span class="sc-column-count" id="scColumnCount"></span>
    <div class="sc-content-foot-actions">
     <button type="button" id="scColumnSelectAll">全選択</button>
     <button type="button" id="scColumnClearAll">選択解除</button>
     <button type="button" id="scColumnSave" class="sc-column-save">保存</button>
    </div>`;
   const count=()=>{const el=document.getElementById('scColumnCount');if(el)el.textContent=`${body.querySelectorAll('.sc-column-item input:checked').length} / ${allCols.length} 列を表示`};
   foot.querySelector('#scColumnSelectAll').onclick=()=>{body.querySelectorAll('.sc-column-item input').forEach(i=>{i.checked=true});count()};
   foot.querySelector('#scColumnClearAll').onclick=()=>{body.querySelectorAll('.sc-column-item input').forEach(i=>{i.checked=false});count()};
   foot.querySelector('#scColumnSave').onclick=saveColumnSelection;
   body.querySelectorAll('.sc-column-item input').forEach(i=>i.onchange=count);
   count();
  }
 }
 async function saveColumnSelection(){
  const body=document.getElementById('scColumnModalBody');if(!body||!scState.equipment)return;
  const allCols=(typeof S!=='undefined'?S.columns:null)||[];
  const checked=[...body.querySelectorAll('.sc-column-item input:checked')].map(i=>i.value);
  // 全列にチェックが入ったままなら「未設定(全列表示)」として保存する
  // (空配列。1件も無ければ全列表示という他マスタと同じ互換ポリシーに合わせる)。
  const toSave=checked.length>=allCols.length?[]:checked;
  const eq=scState.equipment;
  try{
   await api('/api/schedule-column-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:eq,columns:toSave}))});
   scColumnPrefs={equipment:eq,columns:toSave.length?toSave:null};
   showToast&&showToast('表示列を保存しました',`${eq}の仕掛一覧に反映します`,3200);
   refreshScheduledLotFilter();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 function openColumnModal(){
  ensureColumnModal();
  renderColumnModalBody();
  document.getElementById('scColumnModal').hidden=false;columnModalOpen=true;
 }
 function closeColumnModal(){
  const modal=document.getElementById('scColumnModal');
  if(!modal||modal.hidden)return;
  modal.hidden=true;columnModalOpen=false;
 }
 // 一覧側ツールバー(list-view.js)からの入口。
 window.openListColumnPicker=()=>{columnModalOpen?closeColumnModal():openColumnModal()};
 window.scColumnPickerAvailable=()=>scState.fullControl&&scState.boardMode==='single'&&!!scState.equipment;

 /* ---------- 設備ごとの「内容」欄の項目(スケジュール内容表示マスタ) ----------
    タイムライン各行の「内容」に何をどの順で出すかを選ぶ。仕掛一覧の表示列
    (上のスケジュール列表示マスタ)とは目的も選ぶ数も違うため別マスタにした
    (backend/repositories/master_repo.pyのSCHEDULE_CONTENT_TABLE)。
    選んだ順序がそのまま表示順になるので、追加順を保った配列で扱う。 */
 let scContentPrefs={equipment:'',items:null};
 async function loadScheduleContentPrefs(){
  if(!scState.equipment){scContentPrefs={equipment:'',items:null};return}
  const eq=scState.equipment;
  try{
   const r=await api('/api/schedule-content-master?equipment='+encodeURIComponent(eq));
   if(scState.equipment!==eq)return; // 応答が届く前に設備が切り替わっていたら結果を捨てる
   scContentPrefs={equipment:eq,items:(r.items&&r.items.length)?r.items:null};
  }catch(e){
   if(scState.equipment!==eq)return;
   scContentPrefs={equipment:eq,items:null}; // 取得に失敗しても既定の組み立てへフォールバック(fail-open)
  }
 }
 let contentModalOpen=false,contentDraft=[],contentFilter='';
 function ensureContentModal(){
  let modal=document.getElementById('scContentModal');
  if(modal)return modal;
  modal=document.createElement('div');modal.className='sc-float-win';modal.id='scContentModal';modal.hidden=true;
  // 主要動作(保存)はスクロール領域の外(.sc-float-foot)へ固定で置く。
  // 以前は本文の末尾に置いていたため、候補が多い設備では最後まで
  // スクロールしないと保存ボタンが見えず見逃しやすかった。
  modal.innerHTML=`
   <div class="sc-float-header"><div><small>CONTENT</small><h2>「内容」欄に出す項目</h2></div><button type="button" id="scContentModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scContentModalBody"></div>
   <div class="sc-float-foot" id="scContentModalFoot"></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scContentModalClose').onclick=()=>closeContentModal();
  makeFloatingWindow(modal,{storageKey:'scContentModalRectV2',defaultWidth:460,defaultHeight:520,defaultTop:80,minWidth:340,minHeight:300});
  return modal;
 }
 /* 未設定のときに「内容」欄を組み立てている既定の項目(entryContentTextの
    フォールバックと同じ並び)。指定が無い設備でもピッカーを開いた時点で
    “今表示されているもの”が選択済みで見えるようにするための初期値。 */
 const DEFAULT_CONTENT_ITEMS=['lotNo','purposeName','mfgMaterial','mfgTemper'];
 // 生カラム名(用途名など)はそのまま、alias名(purposeNameなど)は日本語の
 // 代表名で見せる(利用者にとってはaliasの英字名に馴染みが無いため)。
 function contentItemLabel(k){
  const names=(typeof aliases!=='undefined'&&aliases[k])||null;
  return names&&names.length?names[0]:k;
 }
 function sameItems(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i])}
 /* 予定に保存されている仕掛データのスナップショット(detail)は、投入した時期に
    よってキーの流儀が違う。古い予定はalias名だけ(purposeName等)、新しい予定は
    alias名と生カラム名(用途名等)の両方を持つ。利用者がどちらの名前で選んでも
    値が引けるよう、aliases表(base.js)で相互に読み替える。
    これが無いと、古い予定しか無い設備では「項目を変えても内容欄が全く変わらない」
    (該当キーが1つも引けず既定の組み立てへフォールバックし続ける)という
    見え方になる。実際に報告された不具合。 */
 function contentValueOf(detail,key){
  if(!detail)return undefined;
  const ok=v=>v!==undefined&&v!==null&&String(v).trim()!=='';
  if(ok(detail[key]))return detail[key];
  if(typeof aliases==='undefined')return undefined;
  const names=aliases[key];
  if(names){                       // keyがalias名 -> 生カラム名を順に試す
   for(const n of names)if(ok(detail[n]))return detail[n];
   return undefined;
  }
  for(const ak of Object.keys(aliases)){   // keyが生カラム名 -> alias名を試す
   if(aliases[ak].includes(key)&&ok(detail[ak]))return detail[ak];
  }
  return undefined;
 }
 /* 候補の正規化。「用途名」と「purposeName」のように同じ意味の項目が2つ並ぶと
    どちらを選ぶべきか分からず、しかも片方は古い予定で引けない。alias表に
    載っている項目はalias名へ寄せて1つにまとめる(表示は日本語名)。 */
 function canonicalContentKey(k){
  if(typeof aliases==='undefined')return k;
  if(aliases[k])return k;
  for(const ak of Object.keys(aliases))if(aliases[ak].includes(k))return ak;
  return k;
 }

 // 選択候補: 今表示している仕掛一覧の全列 + 既に予定へ入っている行が持つ
 // detailのキー(過去に別の列構成で投入した予定も編集できるようにするため)。
 function contentCandidateKeys(){
  // 今表示している仕掛一覧の全列 + 既に予定へ入っている行が持つdetailのキー
  // (過去に別の列構成で投入した予定も編集できるように)+ 既定の項目
  // (予定がまだ1件も無い設備でも既定を選べるように)。
  const raw=[...(typeof S!=='undefined'&&Array.isArray(S.columns)?S.columns:[])];
  scState.entries.forEach(e=>{if(e.detail)raw.push(...Object.keys(e.detail))});
  raw.push(...DEFAULT_CONTENT_ITEMS);
  const seen=new Set(),out=[];
  raw.forEach(k=>{const c=canonicalContentKey(k);if(!seen.has(c)){seen.add(c);out.push(c)}});
  return out;
 }
 // 保存前でも結果が分かるよう、先頭の予定を使って「内容」欄の見え方を作る。
 function contentPreviewText(items){
  const sample=scState.entries.find(e=>e.kind==='作業'&&e.detail&&Object.keys(e.detail).length);
  if(!items.length)return '(既定の組み立て)';
  if(!sample)return items.map(contentItemLabel).join(' / ');
  const parts=items.map(k=>contentValueOf(sample.detail,k)).filter(v=>v!==undefined);
  return parts.length?parts.map(v=>String(v).trim()).join(' / '):'(この予定には該当データがありません)';
 }
 function renderContentModalBody(){
  const body=document.getElementById('scContentModalBody'),foot=document.getElementById('scContentModalFoot');
  if(!body||!foot)return;
  if(!scState.equipment){body.innerHTML='<div class="sc-empty-note">設備を選択してください。</div>';foot.innerHTML='';return}
  const candidates=contentCandidateKeys();
  const chosen=contentDraft;
  const q=String(contentFilter||'').trim().toLowerCase();
  const rest=candidates.filter(k=>!chosen.includes(k))
   .filter(k=>!q||contentItemLabel(k).toLowerCase().includes(q)||String(k).toLowerCase().includes(q));
  const isDefault=sameItems(chosen,DEFAULT_CONTENT_ITEMS);
  body.innerHTML=`<p class="sc-drop-hint">${esc(scState.equipment)}のタイムライン「内容」欄に出す項目を、出したい順に選びます。${isDefault?'いまは既定と同じ組み合わせです。':''}<br>※予定に入れた時点の仕掛データを保存して表示しているため、その項目をまだ持っていない古い予定は既定の表示のままになります(新しく追加した予定から反映されます)。</p>
   <div class="sc-content-chosen-head">表示する項目<small>上から順に並びます</small></div>
   <div class="sc-content-chosen" id="scContentChosen">${
     chosen.length?chosen.map((k,i)=>`<div class="sc-content-item" data-i="${i}"><span class="sc-content-ord">${i+1}</span><span class="sc-content-name" title="${esc(k)}">${esc(contentItemLabel(k))}</span>
       <button type="button" data-act="up" title="上へ"${i===0?' disabled':''}>▲</button>
       <button type="button" data-act="down" title="下へ"${i===chosen.length-1?' disabled':''}>▼</button>
       <button type="button" data-act="del" title="外す">×</button></div>`).join('')
     :'<div class="sc-empty-note">未選択（既定の組み立てで表示します）</div>'}</div>
   <div class="sc-content-chosen-head">追加できる項目
     <input type="search" id="scContentFilter" class="sc-content-filter" placeholder="項目名で絞り込み" value="${esc(contentFilter||'')}" autocomplete="off"></div>
   <div class="sc-column-list" id="scContentRest">${rest.map(k=>`<button type="button" class="sc-content-add" data-key="${esc(k)}" title="${esc(k)}">＋ ${esc(contentItemLabel(k))}</button>`).join('')||'<div class="sc-empty-note">該当する項目がありません</div>'}</div>`;

  // 保存はスクロールの外(固定フッター)。押す前に結果が分かるようプレビューを添える。
  foot.innerHTML=`<div class="sc-content-preview"><span class="sc-content-preview-label">表示例</span><b>${esc(contentPreviewText(chosen))}</b></div>
   <div class="sc-content-foot-actions">
    <button type="button" id="scContentDefault" title="既定の組み合わせに戻します">既定に戻す</button>
    <button type="button" id="scContentClear">すべて外す</button>
    <button type="button" id="scContentSave" class="sc-column-save">保存</button>
   </div>`;

  body.querySelectorAll('#scContentChosen .sc-content-item').forEach(el=>{
   const i=+el.dataset.i;
   el.querySelectorAll('button[data-act]').forEach(b=>{
    b.onclick=()=>{
     const act=b.dataset.act;
     if(act==='del')contentDraft.splice(i,1);
     else if(act==='up'&&i>0)contentDraft.splice(i-1,0,contentDraft.splice(i,1)[0]);
     else if(act==='down'&&i<contentDraft.length-1)contentDraft.splice(i+1,0,contentDraft.splice(i,1)[0]);
     renderContentModalBody();
    };
   });
  });
  body.querySelectorAll('.sc-content-add').forEach(b=>{b.onclick=()=>{contentDraft.push(b.dataset.key);renderContentModalBody()}});
  const filter=body.querySelector('#scContentFilter');
  if(filter)filter.oninput=()=>{
   contentFilter=filter.value;
   const pos=filter.selectionStart;
   renderContentModalBody();
   const again=document.getElementById('scContentFilter');
   if(again){again.focus();try{again.setSelectionRange(pos,pos)}catch(e){/* 位置復元は補助的なもの */}}
  };
  foot.querySelector('#scContentClear').onclick=()=>{contentDraft=[];renderContentModalBody()};
  foot.querySelector('#scContentDefault').onclick=()=>{contentDraft=[...DEFAULT_CONTENT_ITEMS];renderContentModalBody()};
  foot.querySelector('#scContentSave').onclick=saveContentSelection;
 }
 async function saveContentSelection(){
  if(!scState.equipment)return;
  const eq=scState.equipment;
  // 既定と同じ並びなら「未設定」として保存する。表示のされ方は変わらないのに
  // 設定済み扱いになると、既定側を後から変えても追随しなくなるため。
  const toSave=sameItems(contentDraft,DEFAULT_CONTENT_ITEMS)?[]:[...contentDraft];
  try{
   await api('/api/schedule-content-master',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({equipment:eq,items:toSave}))});
   scContentPrefs={equipment:eq,items:toSave.length?toSave:null};
   showToast&&showToast('内容欄の項目を保存しました',toSave.length?`${eq}: ${toSave.join(' / ')}`:`${eq}: 既定の組み立てに戻しました`,3600);
   if(scState.entries.length)renderTimeline();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 function openContentModal(){
  ensureContentModal();
  // 未設定なら「今表示されている既定の組み立て」を選択済みの状態で開く
  // (何も選ばれていない空の画面から始めさせない)。
  contentDraft=(scContentPrefs.equipment===scState.equipment&&scContentPrefs.items)?[...scContentPrefs.items]:[...DEFAULT_CONTENT_ITEMS];
  contentFilter='';
  renderContentModalBody();
  document.getElementById('scContentModal').hidden=false;contentModalOpen=true;
  updateSplitToggleUi();
 }
 function closeContentModal(){
  const modal=document.getElementById('scContentModal');
  if(!modal||modal.hidden)return;
  modal.hidden=true;contentModalOpen=false;
  updateSplitToggleUi();
 }

 /* ---------- 予定から測定を開始する(§9.35) ----------
    予定行のdetailは、投入時点の仕掛データをそのままスナップショットした
    もの(buildScheduleDetail、alias名と生カラム名の両方を持つ)なので、
    仕掛一覧の行と同じようにopenMeasurement()へ渡せる。
    ここで新しい測定画面の入口を作らないこと(測定画面の準備・端末内
    データの再開・使用設備の照合はすべてopenMeasurement()が持っている。
    別経路を足すと設備照合を通らない開き方ができてしまう)。 */
 function entryMeasurementRow(e){
  const row=Object.assign({},e.detail||{});
  // 測定画面側(blankMeasure/requireEquipmentBeforeMeasurement等)は値を必ず
  // pick(row,key)で取り出す。pick()はaliases[key]に並ぶ**生カラム名**しか
  // 見ない(alias名そのもの、例えばrow.lotNoは探さない)ため、alias名だけを
  // 持つdetail(投入時期によってはこの流儀)をそのまま渡すと1項目も引けず
  // 「ロット番号が記録されていない」になる。ここで生カラム名の側へ必ず
  // 書き戻してから渡す。
  const put=(key,val)=>{
   if(val===undefined||val===null||String(val).trim()==='')return;
   (aliases[key]||[]).forEach(n=>{
    if(row[n]===undefined||row[n]===null||row[n]==='')row[n]=val;
   });
  };
  Object.keys(aliases).forEach(k=>put(k,contentValueOf(e.detail,k)));
  // detailが古くて欠けている場合に備え、予定行が持つ3項目で補う。
  put('lotNo',e.lotNo);put('castingNo',e.castingNo);put('inspectionNo',e.inspectionNo);
  return row;
 }
 async function startWorkFromEntry(e){
  if(typeof openMeasurement!=='function'){alert('測定画面を開けません。');return}
  const row=entryMeasurementRow(e);
  if(!(typeof pick==='function'?pick(row,'lotNo'):row.lotNo)){
   alert('この予定にはロット番号が記録されていないため、測定画面を開けません。');
   return;
  }
  try{
   await openMeasurement(row);
  }catch(err){
   alert('測定画面を開けません: '+(err&&err.message?err.message:err));
  }
 }

 function buildScheduleDetail(row){
  // §6の換算係数モデルはalias化された既知フィールド(mfgMaterial等)を前提に
  // しているため、従来どおりそちらも残す。あわせて§9.18改訂で「内容」欄を
  // 汎用化するため、スケジュール列表示マスタが選ぶ生カラム名でも値を
  // 引けるよう、S.columns(今表示中の仕掛一覧の全列)もそのまま(生カラム名を
  // キーに)スナップショットへ含める。どの設備・どの仕掛データ構成でも
  // 対応できるようにするための汎用化(alias一覧に無い列も選べる)。
  const detail={};
  Object.keys(aliases).forEach(k=>{const v=pick(row,k);if(v!==undefined&&v!==null&&v!=='')detail[k]=v});
  if(typeof S!=='undefined'&&Array.isArray(S.columns)){
   S.columns.forEach(c=>{
    const v=row[c];
    if(v!==undefined&&v!==null&&v!=='')detail[c]=v;
   });
  }
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
  const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
  scState.entries.push(entry);
  renderTimeline();
  queueScheduleWrite(
   ()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))}).then(r=>resolveOptimisticEntry(entry,r)),
   ()=>discardOptimisticEntry(entry)
  );
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
   const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
   scState.entries.push(entry);
   queueScheduleWrite(
    ()=>api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row))}).then(r=>resolveOptimisticEntry(entry,r)),
    ()=>discardOptimisticEntry(entry)
   );
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
