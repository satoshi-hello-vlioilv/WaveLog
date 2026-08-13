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
行う。ここは表示に徹する(CLAUDE.mdの「関数の定義は1箇所」、§7.1)。

── このファイルを分割しない理由(docs/REFACTORING_PLAN.md フェーズ3.2) ──
2,600行あるが、実測の結果**分割しない**と決めた。4分割案(core/board/
timeline/split)で測ると、トップレベル定義185個のうち63個(34%)がファイルを
またぐ共有インターフェースになり、しかも依存が双方向になる(core↔split、
core↔timeline、board↔timeline)。`scState`だけで193箇所から参照される。
「1つの大きなファイル」を「読み込み順に依存する63個の暗黙の契約を持つ
4ファイル」に置き換えることになり、フェーズ2で解消したばかりの問題を
作り直してしまう。measurement-worklog.jsの分割(相互参照ゼロ)とは事情が違う。
代わりに下の節目次で辿れるようにする(app.cssと同じ扱い)。

── 節目次 ──
   37 読込結果のキャッシュ(§9.42)      973 予定一覧の取得・描画
  108 パネルDOM                       1324 見積の内訳(§6.8/§9.3)
  206 分割表示(§9.10)                 1343 固定開始日時(§5.1/§7.3)
  373 .sc-sideの折りたたみ(§9.13)     1369 日時ロック(§9.38)
  394 汎用フローティング窓(§9.16)     1384 高密度リスト表示(§9.3)
  455 仕掛一覧のポップアップ(§9.14)   1457 実施中/予定/実績のグルーピング(§9.34)
  519 ドロップ受入(§9.10)             1478 区分と並び順(§9.39)
  577 ビュー排他制御                   1530 まとめ方(§9.40)
  642 全体/個別の表示切替(§9.9)       1785 書込キュー(§9.11)
  730 ロック表示(§9.3)                2007 ドラッグ並べ替え(§7.5/§9.4)
  749 編集セッション(§9.11)           2096 追加パネル(§9.3)
  872 全体俯瞰ボード(§9.9)            2162 設備停止のポップアップ(§9.13)
                                      2208 列表示マスタ(§9.18)
                                      2307 内容欄の項目マスタ
                                      2493 予定から測定を開始(§9.35)
                                      2643 ナビ
*/
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
              canStartWork:false,historyHours:loadHistoryHours(),groupMode:'none'};
 /* ---------- 読込結果のキャッシュ(§9.42) ----------
    共有スケジュールDBと実績バックアップはネットワーク共有上にあり、開くたびに
    読み直すと待たされる。**一度読んだら保持し、画面を開き直しただけでは
    読み直さない**。読み直すのは次の3つだけ:
      - 予定を変える操作をしたとき(追加・削除・並べ替え・ロック・作業開始)
      - ヘッダーの「再計算」を押したとき
      - 設備を切り替えて、その設備をまだ一度も読んでいないとき
    いつ時点の状態かはヘッダーに出す(古い情報を黙って見せないため)。 */
 const scPlanCache=new Map();   // 設備名 -> {entries,anchor,warnings,loadFactor,fetchedAt}
 let scOverviewCache=null;      // {rows,fetchedAt}
 function invalidatePlanCache(equipment){
  if(equipment)scPlanCache.delete(equipment);else scPlanCache.clear();
  scOverviewCache=null;  // 俯瞰ボードの残作業量も変わる
  // 作業可否(§9.51)の判定材料も一緒に捨てる。予定を取り直すのに残コースが
  // 古いままだと、フラグだけ前回の状態で残る。
  if(typeof invalidateWorkable==='function')invalidateWorkable();
 }
 window.invalidateSchedulePlanCache=invalidatePlanCache;
 /* 測定画面(スケジュールの上に重なる)を閉じたときに呼ばれる。作業の開始・
    保存・完了はサーバーのバックアップを変えるが、既に描かれている行はそれを
    知らない。スケジュールを開いたままなら描き直して即時に反映させる。
    開いていなければ何もしない(次に開くときキャッシュ破棄済みなので取り直す)。 */
 WL.refreshScheduleIfOpen=function(){
  if(!document.body.classList.contains('sc-mode'))return;
  if(scState.boardMode==='board')loadOverviewBoard();
  else if(scState.equipment)refreshAll(true);
 };
 function fmtFetchedAt(ts){
  if(!ts)return '';
  const min=Math.floor((Date.now()-ts)/60000);
  const hm=new Date(ts).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});
  return min<1?`${hm} 時点(たった今)`:`${hm} 時点(${min}分前)`;
 }
 function updateFreshnessUi(ts){
  const el=$('#scFreshness');if(!el)return;
  el.hidden=!ts;
  if(ts){el.textContent=fmtFetchedAt(ts);el.title='この時点で読み込んだ内容です。「再計算」で最新を取り直します。'}
 }
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
   <div class="sc-head" id="scHead">
    <div class="sc-head-left">
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
     <label class="sc-history-range" id="scGroupRange" hidden title="タイムラインを日付・勤務・区分でまとめて表示します">
      <span>まとめ</span>
      <select id="scGroupSelect">${SC_GROUP_MODES.map(m=>`<option value="${m.key}">${m.label}</option>`).join('')}</select>
     </label>
     <label class="sc-history-range" id="scHistoryRange" hidden title="完了した予定と実績を、今から何時間前まで表示するかを選びます">
      <span>表示範囲</span>
      <select id="scHistorySelect">${SC_HISTORY_CHOICES.map(h=>`<option value="${h}">直近${h}時間</option>`).join('')}</select>
     </label>
     <span class="sc-freshness" id="scFreshness" hidden></span>
     <span class="sc-field-reorder-note" id="scFieldReorderNote" hidden>現場段取り: 並べ替えのみ可能</span>
     <button type="button" class="sc-split-toggle" id="scContentModalBtn" hidden title="タイムラインの「内容」欄に出す項目と順序を設備ごとに選びます">📝 内容の項目</button>
     <button type="button" class="sc-split-toggle" id="scListModalBtn" hidden title="仕掛一覧をポップアップで表示してドラッグで追加します">⧉ ポップアップ</button>
     <button type="button" class="sc-split-toggle" id="scStopModalBtn" hidden title="設備停止をポップアップから追加します">⛔ 設備停止</button>
     <button type="button" class="sc-split-toggle" id="scPrintBtn" title="いま表示している予定を、現場へ配る形（A4）で印刷します">🖨 印刷</button>
     <button type="button" class="sc-refresh" id="scRefresh">再計算</button>
    </div>
   </div>
   <div class="sc-session-banner" id="scSessionBanner" hidden></div>
   <div class="sc-warnings" id="scWarnings" hidden></div>
   <div class="sc-board" id="scBoard" hidden></div>
   <div class="sc-body" id="scSingleBody">
    <div class="sc-timeline" id="scTimeline"></div>
    <!-- 予定から外す受け皿(§9.116)。**掴んでいる間だけ出す**——常設すると
         「消す場所」が画面に居座り、押し間違いの的になる。掴んで初めて
         現れるので、外す意思があるときにしか目に入らない。 -->
    <div class="sc-drop-remove" id="scDropRemove" hidden aria-hidden="true">
     <span class="sc-drop-remove-icon">🗑</span>
     <span class="sc-drop-remove-text">ここへ落とすと<b>この予定を外します</b>
      <small>確認してから外します。仕掛一覧へ戻るので、また入れ直せます</small></span>
    </div>
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
  $('#scRefresh').onclick=()=>refreshCurrentMode();
  const grp=$('#scGroupSelect');
  scState.groupMode=loadGroupMode();
  grp.value=scState.groupMode;
  grp.onchange=()=>{
   scState.groupMode=grp.value;
   try{localStorage.setItem(SC_GROUP_KEY,scState.groupMode)}catch(err){/* 保存できなくても表示は変わる */}
   renderTimeline();
  };
  const hist=$('#scHistorySelect');
  hist.value=String(scState.historyHours);
  hist.onchange=()=>{
   scState.historyHours=Number(hist.value)||8;
   try{localStorage.setItem(SC_HISTORY_KEY,String(scState.historyHours))}catch(e){/* 保存できなくても表示は変わる */}
   if(scState.equipment)loadPlan(true);
  };
  $('#scEquipmentSelect').onchange=e=>{scState.equipment=e.target.value;switchToSingle()};
  /* 印刷(§9.115)。紙の割り付けは schedule-print.js が持つ。
     **無ければ黙って消さない**——「あれば使う」で書くと、読み込み順を
     間違えた日に機能だけが静かに欠ける(§9.105と同じ罠)。 */
  const printBtn=$('#scPrintBtn');
  if(printBtn)printBtn.onclick=()=>{
   if(typeof WL.schedulePrint?.open==='function')WL.schedulePrint.open();
   else console.error('作業スケジュールの印刷: WL.schedulePrint が見つかりません');
  };
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
  wireRemoveZone();          // 予定から外す受け皿(§9.116)
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
  if(btn){
   // 畳んでいる間は縦書きラベルで「何が畳まれているか」を示す(§9.62)。
   // 矢印だけだと、戻したとき何が出てくるのか分からない。
   btn.innerHTML=splitListCollapsed
    ?'<span aria-hidden="true">▶</span><span class="sc-split-collapse-label">仕掛一覧</span>'
    :'<span aria-hidden="true">◀</span>';
   btn.title=splitListCollapsed?'仕掛一覧を開きます':'仕掛一覧を畳んで作業スケジュールを広げます';
   btn.setAttribute('aria-expanded',String(!splitListCollapsed));
   btn.setAttribute('aria-label',splitListCollapsed?'仕掛一覧を開く':'仕掛一覧を畳む');
  }
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
  const workKey=workDbKey();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&workKey){
   const navBtn=document.querySelector(`aside [data-db-key="${CSS.escape(workKey)}"]`);
   // 分割表示を組み立てるための内部呼び出し。画面の切替ではないので、
   // ここでスケジュール画面が畳まれないようwithInternalDbSwitchで囲う。
   await WL.withInternalDbSwitch(async()=>{
    try{
     if(S.db!==workKey)await selectDb(workKey,navBtn);
     else if(!scSplitJoinApplied&&typeof load==='function')await load();
    }catch(e){/* 一覧が読めなくてもスケジュール自体の表示は継続する */}
   });
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

 /* 汎用フローティングウィンドウは static/js/wl-window.js が持つ(§9.17)。
    ここに置いていたが、スケジュールの状態を一切見ない部品で、
    list-columns.js からも使われている。呼ぶときは WL.makeFloatingWindow。 */

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
   <div class="sc-float-header"><div><h2>仕掛一覧(ドラッグでスケジュールへ追加)</h2></div><button type="button" id="scListModalClose" title="閉じる">×</button></div>
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
  WL.makeFloatingWindow(modal,{storageKey:'scListModalRectV2',defaultWidth:760,defaultHeight:600,defaultTop:80,minWidth:360,minHeight:320});
  return modal;
 }
 async function openListModal(){
  const modal=ensureListModal();
  if(splitWrap)hideSplitList();
  moveGridTo(modal.querySelector('#scListModalBody'));
  modal.hidden=false;listModalOpen=true;
  // body.sc-mode #grid{display:none}(通常モード、@layer mode)を、分割表示の
  // body.sc-mode.sc-split #gridと同じ考え方で上書きする(§9.14)。
  document.body.classList.add('sc-list-modal-open');
  updateSplitToggleUi();
  const workKey2=workDbKey();
  if(typeof S!=='undefined'&&typeof selectDb==='function'&&workKey2&&S.db!==workKey2){
   const navBtn=document.querySelector(`aside [data-db-key="${CSS.escape(workKey2)}"]`);
   /* 分割表示と同じく、モーダルの中身を用意するための内部呼び出し。
      旧実装ではここだけ内部フラグで囲われておらず、S.dbが作業対象以外の
      ときにモーダルを開くと、selectDbのラッパーがexitScheduleView()を呼んで
      背後のスケジュール画面ごと畳んでいた(exitScheduleViewはcloseListModal()
      も呼ぶため、開いたモーダルもその場で閉じる)。通常はS.dbが既に
      作業対象なので表に出ていなかった。 */
   await WL.withInternalDbSwitch(async()=>{
    try{await selectDb(workKey2,navBtn)}catch(e){/* ベストエフォート */}
   });
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
  stopWorkableWatch();   // 画面を出たら可否の裏取りも止める(§9.51)
  if(scSessionHeldFor){releaseSessionFire(scSessionHeldFor);scSessionHeldFor=null}
  scState.sessionHeld=false;scState.sessionHolder=null;scState.sessionError=null;
 }
 window.exitScheduleView=exitScheduleView;

 /* 操作列(#scHead)はヘッダーの#headerViewBarへ移す。画面名はヘッダーが持ち、
    パネルは本文だけを持つ(WL.enterViewのmountViewToolbar参照)。 */
 WL.registerView({key:'schedule',bodyClass:'sc-mode',nav:'openSchedule',toolbar:'#scHead',
  header:['作業スケジュール','設備ごとの作業予定と実績'],exit:exitScheduleView});

 async function openScheduleView(){
  WL.enterView('schedule');
  const panel=ensurePanel();panel.hidden=false;
  WL.syncViewToolbar('schedule');   // 操作列(#scHead)はパネル生成後にヘッダーへ載せる

  const am=window.accessMode||{mode:'edit',canFieldReorder:false,fieldReorderEquipment:''};
  // fullControl: 追加・削除・設備停止投入まで可能なのはscheduleモードだけ
  // (§3.1.1のとおり、現場段取りは並べ替え1操作のみに限定する)。
  scState.fullControl=(am.mode==='schedule');
  // §9.44: 並べ替えの可否は**サーバーと同じ条件**で判定する。以前は
  // canFieldReorderだけを見ていたため、現場段取り可の端末なら
  // 「現場段取り対象設備」が未設定でも/別設備でも行がドラッグでき、
  // 動かした瞬間に403で弾かれていた(画面は「並べ替え可」と表示したまま)。
  // 対象設備は1端末につき1設備で、空欄は「未設定」であって全設備許可ではない
  // (§3.1.1・§3.2)。ここを緩めるとAPI側の縛りと食い違うので合わせるだけにする。
  scState.fieldReorderGranted=(am.mode==='edit'&&!!am.canFieldReorder);
  scState.fieldReorderTarget=String(am.fieldReorderEquipment||'').trim();
  scState.fieldReorderOnly=false;   // 対象設備が決まってから改めて立てる
  scState.editable=scState.fullControl;
  scState.pickerEnabled=(am.mode!=='edit');
  // §9.35: 予定から測定を開始できるのは、実際に測定する端末(編集モード)だけ。
  // scheduleモードは計画専用の端末、viewモードは閲覧専用のため出さない。
  scState.canStartWork=(am.mode==='edit');
  // §9.61: 履歴(実績)の削除は、測定する端末(edit)と計画盤を整える端末
  // (schedule)の両方に許す。サーバー側の許可(access_mode.pyの
  // _ENDPOINT_EXTRA_MODES['measurement.backup_delete'])と必ず揃えること。
  // 閲覧モードには出さない。
  scState.canDeleteHistory=(am.mode==='edit'||am.mode==='schedule');
  if(am.mode==='edit'){
   const eq=currentConfiguredEquipment();
   if(!eq){renderUnconfigured();return}
   scState.equipment=eq;
  }
  applyFieldReorderPermission();
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
  const grpWrap=$('#scGroupRange');if(grpWrap)grpWrap.hidden=inBoard;
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
 /* 現場段取り(並べ替え)の可否を、今表示している設備に対して判定し直す。
    サーバー(routes/schedule.py plan_reorder)と同じく
    「現場段取り可 かつ 現場段取り対象設備 == この設備」でのみ許可する。
    権限はあるのに対象設備が違う/未設定のときは、黙って無効にせず理由を出す
    (マスタ管理で直せる内容なので、何を直せばよいか分かる文言にする)。 */
 function applyFieldReorderPermission(){
  // 対象設備は複数指定・「すべての設備」('*')も書ける。判定はaccess-mode.jsの
  // 共通関数へ寄せる(サーバー側のfield_reorder_equipment_allowsと同じ規則)。
  const matched=scState.fieldReorderGranted
   &&(WL.fieldReorderAllows?.(scState.fieldReorderTarget,scState.equipment)??false);
  scState.fieldReorderOnly=matched;
  scState.editable=scState.fullControl||matched;
  const note=$('#scFieldReorderNote');
  if(!note)return;
  if(matched){
   note.hidden=false;note.classList.remove('is-warn');
   note.textContent='現場段取り: 並べ替えのみ可能';
   note.title='この設備の未着手の予定を並べ替えられます。';
  }else if(scState.fieldReorderGranted){
   note.hidden=false;note.classList.add('is-warn');
   const label=WL.fieldReorderLabel?.(scState.fieldReorderTarget)||'';
   note.textContent=label
    ?`現場段取りの対象設備は「${label}」です`
    :'現場段取りの対象設備が未設定です';
   note.title='マスタ管理 > アクセス権限マスタの「現場段取り対象設備」に'
    +'この設備名を登録すると、並べ替えができるようになります。';
  }else{
   note.hidden=true;note.classList.remove('is-warn');
  }
 }
 async function switchToSingle(){
  scState.boardMode='single';
  applyFieldReorderPermission();
  applyBoardModeUi();
  if(scState.equipment)await refreshAll();
  else renderTimelineMessage('設備を選択してください。');
 }
 // 「再計算」は必ず取り直す(利用者が明示的に最新を求めた操作なので、
 // ここでキャッシュを返すと押しても何も起きないように見える)。
 function refreshCurrentMode(force=true){
  return scState.boardMode==='board'?loadOverviewBoard(force):refreshAll(force);
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
 async function loadOverviewBoard(force){
  if(!force&&scOverviewCache)return loadOverviewBoardInner(false);
  if(typeof withWaiting!=='function')return loadOverviewBoardInner(force);
  return withWaiting({title:'全設備の空き状況を読み込んでいます',detail:'共有スケジュールDBを参照しています',
   progress:'設備ごとの予定を展開して集計しています'},()=>loadOverviewBoardInner(force));
 }
 async function loadOverviewBoardInner(force){
  const board=$('#scBoard');if(!board)return;
  if(!force&&scOverviewCache){
   scState.overview=scOverviewCache.rows;
   renderOverviewBoard();updateFreshnessUi(scOverviewCache.fetchedAt);
   return;
  }
  board.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/overview');
   if(!r.configured){
    board.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   scState.overview=r.equipment||[];
   scOverviewCache={rows:scState.overview,fetchedAt:Date.now()};
   renderOverviewBoard();updateFreshnessUi(scOverviewCache.fetchedAt);
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
/* ---------- 作業可否フラグ(§9.51) ----------
    予定に並んでいても、そのロットがまだこの設備まで流れて来ていないことが
    ある(前工程が終わっていない)。現場の判断基準そのままに、仕掛データの
    **「残仕掛設備ｺｰｽ」がこの設備名で始まっているか**を作業可否とする。

    判定材料の持ち方(§9.67で全面的に見直し)。

    以前は「スナップショットは古くなるから使わない。毎回、現在の仕掛データを
    引いて判定する」という作りだった。これは正しくないうえに遅い:
      - 仕掛一覧から投入したロットは、**投入したその行に残仕掛設備ｺｰｽが
        載っている**。それを使えば往復ゼロで即座に判定できるのに、わざわざ
        仕掛を500件ずつ何ページも辿り直していた(実測10往復・3秒超)。
      - 1件追加するたびに索引を作り直していたため、既に判定済みの行まで
        巻き込んで「?」へ戻り、しばらくしてまた変わる、というちらつきが出た。

    **工程は前へしか進まない**という性質を使うと整理できる:
      - 投入時点で「可」(残仕掛設備ｺｰｽがこの設備で始まる)だったロットは、
        その後この設備から出ていくことはあっても、「まだ来ていない」状態へ
        戻ることはない。**可はそのまま信用してよい**。
      - 逆に「不可」「?」は、工程が進んで到着した可能性があるので取り直す。

    そこで:
      1. 予定投入時に残仕掛設備ｺｰｽをdetailへ保存する(buildScheduleDetailが
         既にaliasキーで保存している)。フラグはまずこれで即座に作る。
      2. 取り直しの対象は**可になっていない行だけ**。全件を引き直さない。
      3. 取り直した値は索引(scWorkable.map)へ**併合**する(作り直さない)。
         作り直すと、前回判定できていた行が一時的に「?」へ戻る。
      4. 対象が少なければロット単位の絞り込み問い合わせだけで済ませる
         (ページ送りより往復が少ないため)。 */
 const WORKABLE_TTL_MS=180000;   // 3分(仕掛一覧のキャッシュ§9.46と同じ考え方)
 let scWorkable={at:0,map:null};
 /* 判定材料の「取り直しが要る」印を付けるだけで、**分かっている値は捨てない**
    (§9.67)。以前はmapごと捨てていたため、予定を1件足すたびに全行が「?」へ
    戻り、仕掛を辿り終えるまで戻らなかった(ちらつきの実体)。
    取り直しの対象はどのみち「可になっていない行」だけなので、既に判定済みの
    値を残しておいても古い判定が居座ることはない。 */
 function invalidateWorkable(){scWorkable={...scWorkable,at:0}}
 /* 仕掛一覧から「ロット番号 -> 残仕掛設備ｺｰｽ」を作る。列表示マスタで
    残仕掛設備ｺｰｽが非表示にされていても判定に要るので include_hidden=1
    を付ける(CLAUDE.md「内部計算用の問い合わせには include_hidden=1」)。 */
 /* 判定材料の集め方(§9.57)。
    以前は仕掛を`page_size=5000`で1回読んで索引にしていたが、サーバー側は
    `page_size`を**500件で頭打ち**にしている(backend/routes/tables.py)。
    仕掛が500件を超える現場では601件目以降が索引に入らず、そこにある予定は
    全部「?」=作業開始不可になっていた(「仕掛データに作業ロットが
    見つからない」として報告された不具合)。

    直し方は「全件を索引にする」ではなく「**予定に載っているロットだけ**を
    確実に埋める」。必要なロット番号は作業予定から分かっているので、
    仕掛を500件ずつ辿り、必要な分が揃った時点で打ち切る。全件を読み切る
    必要はなく、往復数は「必要なロットが見つかるまで」で済む。
    それでも見つからないものは、最後に個別問い合わせで確定させる
    (仕掛に無いことが確定すれば「?」ではなく「不可」にできる)。 */
 const WORKABLE_PAGE_SIZE=500;    // サーバー側の上限(これ以上を要求しても切り詰められる)
 const WORKABLE_MAX_PAGES=40;     // 20000件ぶん。際限なく辿らないための歯止め
 const WORKABLE_FILL_LIMIT=60;    // 個別に補う上限(往復が増えるため)
 /* この件数までなら、ページ送りせずロット単位の絞り込みだけで済ませる。
    1件追加した直後のような「取り直したいのは1〜数件」の場面で、仕掛を
    何ページも辿り直さないための分岐(往復数を必要な分だけに保つ)。 */
 const WORKABLE_DIRECT_MAX=8;
 function entryLotKey(e){return normalizeLotKey(e.lotNo||contentValueOf(e.detail,'lotNo'))}
 /* 予定投入時に保存した残仕掛設備ｺｰｽ(§9.67)。仕掛一覧から投入した行には
    必ず入っている(buildScheduleDetailがalias名・生カラム名の両方で保存)。 */
 function storedCourseOf(e){
  const v=contentValueOf(e&&e.detail,'residualCourse');
  return v===undefined||v===null?'':String(v);
 }
 /* 取り直しが要るロット番号 = 予定の作業行のうち、今「可」になっていないもの。
    可は工程が戻らない限り覆らないので取り直さない(§9.67)。 */
 /* 予定に載っている作業ロットの全体(明示的な再計算で使う)。 */
 function allPlannedWorkLots(){
  const out=new Set();
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業')return;
   const lot=entryLotKey(e);if(lot)out.add(lot);
  });
  return out;
 }
 function lotsNeedingLookup(){
  const out=new Set();
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業')return;
   const lot=entryLotKey(e);
   if(!lot)return;
   if(workableOf(e).state!=='ok')out.add(lot);
  });
  return out;
 }
 /* opts.ignoreTtl   : 鮮度に関わらず取り直す
    opts.revalidateAll: 「可」も含めて全予定を検証し直す。
       利用者が明示的に「再計算」を押したときだけ立てる。工程は前へしか
       進まないので普段は可を再確認しないが、**利用者が最新を求めた操作**
       では情報源そのものを取り直すのが筋(§9.67)。 */
 /* 作業対象の一覧(仕掛)のキー。データソースマスタで役割が「作業」のものを
    使う。**キーの綴りに依存させない**(§9.87)。作業可否の判定材料を引く先と、
    スケジュール画面の中に出す仕掛一覧(分割表示・ポップアップ)の両方が使う。
    役割が決まっていなければ空文字を返すので、呼び出し側は必ず確認すること。 */
 function workDbKey(){return (window.WL&&WL.dataSource&&WL.dataSource.workKey())||''}
 async function loadWorkableIndex(opts){
  const o=(opts===true?{ignoreTtl:true}:(opts||{}));
  const force=!!o.ignoreTtl;
  if(!force&&scWorkable.map&&Date.now()-scWorkable.at<WORKABLE_TTL_MS)return scWorkable.map;
  if(o.revalidateAll){
   // 全件検証: 覚えている値を捨ててから、予定の全作業ロットを対象にする
   scWorkable={...scWorkable,map:new Map()};
  }
  // 索引は**作り直さず併合する**。作り直すと、前回判定できていた行が
  // 一時的に「?」へ戻り、しばらくしてまた変わる、というちらつきになる。
  const map=scWorkable.map instanceof Map?scWorkable.map:new Map();
  let cols=scWorkable.cols||null,table=scWorkable.table||null;
  let pages=0,scanned=0,total=scWorkable.total||0;
  const needed=o.revalidateAll?allPlannedWorkLots():lotsNeedingLookup();
  // 全部「可」で確定しているなら、取り直す理由が無い(往復ゼロ)。
  if(!needed.size){scWorkable={...scWorkable,at:Date.now(),map,cols,table,pages:0,scanned:0,total};return map}
  // 取り直したいのが数件だけなら、ページ送りせずロット単位で引く。
  if(needed.size<=WORKABLE_DIRECT_MAX&&table&&cols&&cols.lotCol&&cols.resCol){
   scWorkable={...scWorkable,at:Date.now(),map,cols,table};
   await fillMissingLots([...needed]);
   return scWorkable.map;
  }
  try{
   // 役割が「作業」のデータソースが無ければ判定材料が引けない。勝手に
   // 「可」にはせず「?」のまま返す(確認できないものを作業させないため)。
   if(!workDbKey()){
    console.warn('作業可否: 役割が「作業」のデータソースが登録されていません');
    scWorkable={at:Date.now(),map,table,cols,pages,scanned,total};
    return map;
   }
   const t=await api('/api/tables?db='+encodeURIComponent(workDbKey()));
   table=(t.tables||[])[0];
   if(table){
    for(let page=1;page<=WORKABLE_MAX_PAGES;page++){
     const q=new URLSearchParams({db:workDbKey(),table,page,page_size:WORKABLE_PAGE_SIZE,
       search:'',include_hidden:'1'});
     const d=await api('/api/table?'+q);
     pages=page;total=Number(d.count||0);
     if(!cols){
      cols={lotCol:(aliases.lotNo||[]).find(n=>(d.columns||[]).includes(n)),
            resCol:(aliases.residualCourse||[]).find(n=>(d.columns||[]).includes(n))};
     }
     const rows=d.rows||[];scanned+=rows.length;
     if(!cols.lotCol||!cols.resCol)break;    // 列が無ければ辿っても意味が無い
     rows.forEach(r=>{
      const lot=normalizeLotKey(r[cols.lotCol]);
      if(!lot)return;
      const course=String(r[cols.resCol]??'');
      map.set(lot,course);
      if(needed.has(lot))rememberCourseOnEntries(lot,course);
      needed.delete(lot);
     });
     // 必要な分が揃った / 最後のページまで来た なら打ち切る
     if(!needed.size||rows.length<WORKABLE_PAGE_SIZE||scanned>=total)break;
    }
   }
  }catch(e){
   // 仕掛が読めないときは判定材料が無い。mapを空で持ち、UIは「不明」を出す
   // (この場合に既定で「可」にすると、確認できないものを作業させてしまう)。
   console.warn('作業可否の判定に使う仕掛一覧を取得できません',e);
  }
  scWorkable={at:Date.now(),map,table,cols,pages,scanned,total};
  if(needed.size)await fillMissingLots([...needed]);
  return scWorkable.map;
 }
 /* 索引で分かった値を、その予定行のdetailへも書き戻す(§9.67)。
    同じセッション内で描き直すたびに索引を引き直さずに済み、
    次にこの設備を開いたときも保存済みの値から即座に判定できる。
    共有DBへは書かない(1件ごとに取得→適用→反映のサイクルが要るため)。 */
 function rememberCourseOnEntries(lot,course){
  (scState.entries||[]).forEach(e=>{
   if(e.kind!=='作業'||entryLotKey(e)!==lot)return;
   if(!e.detail||typeof e.detail!=='object')e.detail={};
   e.detail.residualCourse=course;
  });
 }
 /* 辿っても見つからなかったロットを個別に引いて確定させる。
    全件を引き直すのではなく、判定が要る行だけに絞る。 */
 async function fillMissingLots(missing){
  const {map,table,cols}=scWorkable;
  if(!table||!cols||!cols.lotCol||!cols.resCol||!missing.length)return;
  const targets=missing.slice(0,WORKABLE_FILL_LIMIT);
  let idx=0;
  await Promise.all(Array.from({length:Math.min(3,targets.length)},async()=>{
   while(idx<targets.length){
    const lot=targets[idx++];
    try{
     const q=new URLSearchParams({db:workDbKey(),table,page:1,page_size:1,include_hidden:'1',
      filters:JSON.stringify([{column:cols.lotCol,op:'eq',value:lot}])});
     const d=await api('/api/table?'+q);
     const row=(d.rows||[])[0];
     // 見つからなければ「仕掛に無い」ことが確定するので、空文字で入れて
     // 「?」ではなく「不可」として扱えるようにする。
     const course=row?String(row[cols.resCol]??''):'';
     map.set(lot,course);
     rememberCourseOnEntries(lot,course);
    }catch(e){/* 引けなければ「?」のまま(勝手に可にしない) */}
   }
  }));
  if(missing.length>targets.length){
   console.warn(`作業可否: 判定できなかったロットが${missing.length-targets.length}件あります`);
  }
 }
 function normalizeLotKey(v){return String(v??'').trim().toUpperCase()}
 /* 残仕掛設備ｺｰｽがこの設備名で始まっていれば作業可能。
    戻り値: {state:'ok'|'ng'|'unknown', course:'...'} */
 function workableOf(e){
  const eq=String(scState.equipment||'').trim();
  if(e.kind!=='作業')return {state:'na',course:''};
  if(!eq)return {state:'unknown',course:''};
  const lot=entryLotKey(e);
  const map=scWorkable.map;
  // 取り直した値(索引)があればそちらを優先し、無ければ投入時の保存値を使う。
  // 保存値があるおかげで、仕掛一覧から投入した予定は**往復ゼロで即座に**
  // 判定できる(§9.67)。索引しか見ていなかった頃は、ここが必ず「?」で
  // 始まり、仕掛を何ページも辿り終わるまで変わらなかった。
  let course=null;
  if(lot&&map&&map.has(lot))course=String(map.get(lot)||'');
  else{const stored=storedCourseOf(e);if(stored!=='')course=stored}
  if(course===null)return {state:'unknown',course:''};
  const norm=v=>String(v||'').trim().toUpperCase();
  return {state:norm(course).startsWith(norm(eq))?'ok':'ng',course};
 }
 const WORKABLE_LABEL={
  ok:{text:'可',cls:'is-ok',title:'残仕掛設備ｺｰｽがこの設備で始まっています。作業できます。'},
  ng:{text:'不可',cls:'is-ng',title:'このロットはまだこの設備に仕掛かっていません(残仕掛設備ｺｰｽが別の設備です)。'},
  unknown:{text:'?',cls:'is-unknown',title:'仕掛データに該当ロットが見つからないため、作業できるか確認できません。'},
  na:{text:'—',cls:'is-na',title:'作業以外の予定です。'},
 };

/* 可否の反映は**画面を作り直さない**。renderTimeline()を呼ぶと行が総入れ替えに
    なり、ドラッグ中・詳細を開いている最中・スクロール位置がすべて飛ぶ。
    既にある行の可否セルと開始ボタンだけを差し替える。 */
 function applyWorkableFlags(){
  document.querySelectorAll('.sc-row-line').forEach(row=>{
   const e=row.__scEntry;if(!e)return;
   const w=workableOf(e);
   const label=WORKABLE_LABEL[w.state]||WORKABLE_LABEL.unknown;
   const cell=row.querySelector('.sc-row-workable');
   if(cell){
    cell.textContent=label.text;
    cell.className='sc-row-workable '+label.cls;
    cell.title=w.course?`${label.title}\n残仕掛設備ｺｰｽ: ${w.course}`:label.title;
   }
   row.classList.toggle('sc-row-not-workable',w.state==='ng');
   // 可否が変わったら開始ボタンの有無も合わせる(可になったらすぐ着手できる)
   const canStart=scState.canStartWork&&e.kind==='作業'&&e.state==='予定'
                  &&!e.__pending&&!e.unplanned&&w.state==='ok';
   const actions=row.querySelector('.sc-row-actions');
   const existing=row.querySelector('.sc-row-start');
   if(canStart&&!existing&&actions){
    const btn=document.createElement('button');
    btn.type='button';btn.className='sc-row-btn sc-row-start';
    btn.title='この予定の測定画面を開いて作業を開始します';btn.textContent='▶ 開始';
    btn.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
    actions.prepend(btn);
   }else if(!canStart&&existing){
    existing.remove();
   }
  });
 }
 /* 可でない行は、工程が進めば可へ変わる。利用者に「再読込」を押させずに
    自動で追いつくよう、可でない予定が残っている間だけ裏で取り直す。
    全部可になったら見張る理由が無いので止める(無駄な問い合わせを残さない)。 */
 const WORKABLE_WATCH_MS=120000;   // 2分
 let workableTimer=null;
 function stopWorkableWatch(){if(workableTimer){clearTimeout(workableTimer);workableTimer=null}}
 function scheduleWorkableWatch(){
  stopWorkableWatch();
  const entries=scState.entries||[];
  const pending=entries.some(e=>e.kind==='作業'&&e.state==='予定'&&workableOf(e).state!=='ok');
  if(!pending)return;
  workableTimer=setTimeout(()=>{refreshWorkableInBackground(true,false)},WORKABLE_WATCH_MS);
 }
 async function refreshWorkableInBackground(force,revalidateAll){
  try{
   await loadWorkableIndex({ignoreTtl:!!force,revalidateAll:!!revalidateAll});
   applyWorkableFlags();
   scheduleWorkableWatch();
  }catch(err){console.warn('作業可否の更新に失敗しました',err)}
 }
 /* 仕掛一覧を取り直した直後など、外から可否を更新したいときの入口。 */
 window.refreshScheduleWorkable=refreshWorkableInBackground;
 /* 可否がなぜその値なのかを確認するための状態。全部「?」のときに
    「仕掛が読めていない」のか「該当ロットが無い」のかを切り分ける。 */
 window.scheduleWorkableState=()=>({
  watching:workableTimer!==null,
  indexSize:scWorkable.map?scWorkable.map.size:0,
  fetchedAt:scWorkable.at||null,
  equipment:scState.equipment||'',
  pages:scWorkable.pages||0,        // 仕掛を何ページ辿ったか
  scanned:scWorkable.scanned||0,    // 読んだ行数
  total:scWorkable.total||0,        // 仕掛の総件数
 });

 async function refreshAll(force){
  // キャッシュから出せるならWAITING表示ごと省く(一瞬で出るのにスピナーが
  // 瞬くと、かえって「また読み込んでいる」ように見えるため)。
  const cached=scPlanCache.get(scState.equipment);
  if(!force&&cached&&cached.historyHours===scState.historyHours)return refreshAllInner(()=>{},false);
  if(typeof withWaiting!=='function')return refreshAllInner(()=>{},force);
  return withWaiting({title:'作業スケジュールを読み込んでいます',
   detail:scState.equipment?('設備: '+scState.equipment):'共有スケジュールDBを参照しています',
   progress:'表示設定と予定を取得しています',step:1},report=>refreshAllInner(report,force));
 }
 async function refreshAllInner(report,force){
  // 列表示マスタ(§9.18)はloadPlan()のrenderTimeline()が「内容」欄の組み立てに
  // 使うため、先に取得しておく(後から取得すると初回描画が古い/未設定の
  // プリファレンスのまま出て、直後に列が変わるちらつきが起きる)。
  if(scState.fullControl){await loadScheduleColumnPrefs();await loadScheduleContentPrefs()}
  /* 内容の列の見せ方(並び・幅・表示名・書式・読み替え)も先に取っておく
     (§9.88 段6)。描画時に同期で参照するので、後から取ると初回だけ
     既定の見た目で出て直後に組み替わる。読めなくても既定で出る(fail-open)。 */
  try{await WL.columnLayout.load(timelineTarget())}catch(e){}
  try{await WL.displayRules.load()}catch(e){}
  await loadPlan(force);
  // 作業可否(§9.51)の判定材料は**待たない**。仕掛一覧の取得は共有越しだと
  // 時間がかかることがあり、待つとその間ずっと予定が出ない。先に予定を描き、
  // 可否は取れ次第そのセルだけ差し替える(操作は一切止めない)。
  // 利用者が押した「再計算」(force)では、可も含めて情報源を取り直す。
  // 画面を開いた・設備を切り替えただけのときは可でない行だけを追いかける。
  refreshWorkableInBackground(force,force);
  if(scState.fullControl)await loadStopReasons();
  report({progress:'仕掛一覧を並べて表示しています',step:2});
  await showSplitList();
 }
 function applyPlanResult(r,fetchedAt){
  scState.entries=r.entries||[];scState.anchor=r.anchor;scState.warnings=r.warnings||[];
  scState.planFetchedAt=fetchedAt;
  renderWarnings();renderTimeline();updateFreshnessUi(fetchedAt);
  scheduleWorkableWatch();   // 可でない行が残っていれば裏で追いかける(§9.51)
 }
 async function loadPlan(force){
  if(!scState.equipment)return;
  const cached=scPlanCache.get(scState.equipment);
  // 表示範囲が変わったときは取り直す(サーバー側の合成範囲も変わるため)
  if(!force&&cached&&cached.historyHours===scState.historyHours){
   applyPlanResult(cached,cached.fetchedAt);
   return;
  }
  const timeline=$('#scTimeline');
  timeline.innerHTML='<div class="sc-empty-note">読み込んでいます…</div>';
  try{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(scState.equipment)
    +'&history_hours='+encodeURIComponent(scState.historyHours));
   if(!r.configured){
    timeline.innerHTML='<div class="sc-empty-note">スケジュール機能が設定されていません(config/local.jsonのschedule_share_path未設定)。</div>';
    return;
   }
   const fetchedAt=Date.now();
   scPlanCache.set(scState.equipment,{entries:r.entries||[],anchor:r.anchor,warnings:r.warnings||[],
    loadFactor:r.loadFactor,historyHours:scState.historyHours,fetchedAt});
   applyPlanResult(r,fetchedAt);
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
  return {model:'モデル',override:'手動上書き','stop-reason-master':'設備停止マスタ',remaining:'残り時間',
          'equipment-standard':'設備の標準時間',default:'暫定既定値'}[src]||src||'';
 }
 /* 見積が**実績から出たものではない**ときの説明(§9.114)。数字だけを出すと
    「実績に基づく予測」と読まれてしまうので、何を根拠にしたのかを添える。
    設備の標準時間と暫定既定値は**打つ手が違う**(前者は登録済みの値なので
    直せば効く／後者は設備マスタが未設定)ため、言い分ける。 */
 function estimateNoteOf(src){
  if(src==='equipment-standard')
   return '設備マスタの「1ロットあたり標準時間」です。実績がまだ無いための暫定値で、'
        +'実績がたまると自動で実績由来の見積へ切り替わります。';
  if(src==='default')
   return '実績が無く、設備マスタに標準時間も登録されていないための暫定既定値です。'
        +'マスタ管理 > 設備 で「1ロットあたり標準時間」を登録すると、そちらが使われます。';
  return '';
 }
 function factorSourceLabel(src){
  return {auto:'自動',override:'上書き',unknown:'未知'}[src]||src||'';
 }
 function estimateBreakdownHtml(e){
  const est=e.estimate;
  /* 因子が無い＝実績から出していない見積(§9.114)。**それでも内訳は出す**
     ——「何分か」だけ出して根拠を出さないと、実績に基づく予測と区別が
     付かない。出どころと、どうすれば良くなるかを1行で書く。 */
  if(est&&(!est.factors||!est.factors.length)){
   const note=estimateNoteOf(est.source);
   if(!note)return '';
   return `<div class="sc-detail-block"><div class="sc-detail-heading">見積の根拠</div>`
    +`<div class="sc-estimate-row sc-estimate-base">${esc(fmtMinutes(est.minutes))}`
    +`（${esc(estimateSourceLabel(est.source))}）</div>`
    +`<div class="sc-estimate-row sc-estimate-note">${esc(note)}</div></div>`;
  }
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
  queuePlanOp({op:'update',id,fixedStart:iso,
   onFailure:()=>{entry.fixedStart=previous;if(scState.equipment)renderTimeline()}});
 }

 /* ---------- 日時ロック(§9.38) ----------
    日付を決めて置きたいロットは「鍵をかけて」その日時へ釘付けにする。
    ロックの実体は既存の固定開始日時(fixedStart)そのもので、新しい列も
    保存先も増やしていない。ロックしていない行は従来どおり、現在時刻を
    起点に前から順に詰めて並ぶため、時間が経つほど自動的に後ろへずれる。 */
 function toggleEntryLock(e){
  if(e.fixedStart){updateFixedStart(e.id,'');return}
  // 今この行が置かれている予定日時でそのまま固定する。使う側の頭の中では
  // 「今この位置でいい、これ以上ずらしたくない」なので、日時入力を出して
  // 打ち直させない(細かく変えたい場合は詳細パネルの日時欄で調整できる)。
  const base=e.plannedStart||e.fixedStart;
  if(!base){alert('この予定はまだ予定日時が決まっていないため固定できません。');return}
  updateFixedStart(e.id,fmtLocalInput(base));
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
 /* ---------- 内容を項目ごとの独立した列へ(§9.88 段6) ----------
    以前は選んだ項目を「 / 」で繋いだ1つの文字列だった。1セルに複数の値が
    入ると、桁が揃わず目で追えないうえ、項目ごとの幅も書式も指定できない。
    **1セル1値**にすると、一覧とまったく同じ仕組み(列レイアウトマスタ)が
    そのまま効く——タイムライン専用の設定画面を作らずに済む。
    対象は`timeline:<設備名>`。どの項目を出すかは従来どおり
    スケジュール内容表示マスタが決める(責務を混ぜない)。 */
 const TIMELINE_DEFAULT_KEYS=['lotNo','purposeName','mfgMaterial','mfgTemper'];
 function timelineTarget(){return scState.equipment?`timeline:${scState.equipment}`:''}
 function timelineContentKeys(){
  const items=(scContentPrefs.equipment===scState.equipment)?scContentPrefs.items:null;
  const keys=(items&&items.length)?items.slice():TIMELINE_DEFAULT_KEYS.slice();
  /* 並びと表示/非表示は列レイアウトマスタが上書きする(見出しのD&Dで
     覚えた並び)。記録に無い項目は末尾へ回るので、内容の項目を足しても
     設定は壊れない。 */
  const t=timelineTarget();
  return t?WL.columnLayout.apply(t,keys):keys;
 }
 /* 1行ぶんのセル。作業以外(設備停止)は最初の列へ名称を出し、残りは空にする
    ——列の数を行ごとに変えると桁が合わなくなる。 */
 function timelineContentCells(e){
  const keys=timelineContentKeys();
  const t=timelineTarget();
  if(e.kind!=='作業'){
   const title=(e.title||'設備停止').trim();
   return keys.map((k,i)=>({key:k,text:i===0?title:'',raw:i===0?title:'',color:''}));
  }
  return keys.map(k=>{
   const raw=contentValueOf(e.detail,k);
   const out=WL.cellFormat.cell({raw,format:t?WL.columnLayout.format(t,k):null,
                                 rule:t?WL.columnLayout.rule(t,k):'',
                                 row:e.detail||{},column:k});
   return {key:k,text:out.text,raw:String(raw==null?'':raw),color:out.color};
  });
 }
 function entryContentText(e){
  if(e.kind!=='作業')return (e.title||'設備停止').trim();
  const items=(scContentPrefs.equipment===scState.equipment)?scContentPrefs.items:null;
  if(items&&items.length){
   const parts=items.map(k=>contentValueOf(e.detail,k)).filter(v=>v!==undefined);
   if(parts.length)return parts.map(v=>String(v).trim()).join(' / ');
  }
  /* 既定の組み立て。**値の取り出しはcontentValueOf経由**にする(§9.69)。
     直接e.detail.purposeNameを見ていたため、生カラム名「用途名」でしか
     持っていない予定では空欄になっていた(選択時の経路はcontentValueOfを
     使っており、既定だけが取りこぼす食い違い)。
     欠けている項目は詰めて繋ぐ。テンプレート文字列で空文字を挟むと
     「L0001  A5052」のように**二重空白**が残る(実際にそう出ていた)。 */
  const temper=contentValueOf(e.detail,'mfgTemper');
  const material=contentValueOf(e.detail,'mfgMaterial');
  return [e.lotNo||'-',
          contentValueOf(e.detail,'purposeName'),
          material?`${material}${temper?'-'+temper:''}`:(temper||'')]
   .map(v=>String(v??'').trim()).filter(Boolean).join(' ');
 }
 /* 見出し。内容の欄は項目ごとに分かれるので、**見出しも項目名で出す**
    (「内容」という名前のままでは何が入っているのか分からない)。表示名は
    列レイアウトマスタが持つので、一覧と同じ言葉で出せる。 */
 function rowHeadHtml(){
  const t=timelineTarget();
  const cells=timelineContentKeys().map(k=>{
   /* 見出しの言葉。**まず列レイアウトマスタの表示名**、無ければ項目の
      日本語名(contentItemLabel。alias表の先頭)。生のキー(mfgTemper等)を
      そのまま出すと、選んだ本人以外には何の列か分からない。 */
   const named=t?WL.columnLayout.label(t,k):k;
   const label=(named&&named!==k)?named:contentItemLabel(k);
   return `<span class="sc-row-title-head" data-content-col="${esc(k)}" draggable="true"`
    +` title="${esc(k)}｜ドラッグで並べ替え／右端の取っ手で幅">${esc(label)}`
    +`<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></span>`;
  }).join('');
  return `<div class="sc-row-head">
  <span></span><span>区分</span><span>作業</span><span>日付</span><span>時刻</span><span>勤務</span><span>残り</span>${cells}<span>見積</span><span>実績</span><span>備考</span><span class="sc-actions-head">操作</span>
 </div>`;
 }

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

 /* ---------- 区分(カテゴリ)と並び順(§9.39) ----------
    完了済み・作業中・作業予定の3区分。以前はセクション見出しで分けて
    いたが、行の中の「区分」列で持つ形にした(見出し方式だと、日付や勤務で
    まとめ直したいときに区分の見出しと二重になってしまう)。

    並び順は**時刻の一本道**にする。3区分はそれぞれ代表時刻を持ち、
      完了 : 実績の終了時刻(過去)
      作業中: 実績の開始時刻(過去に始まり、予定終了は常に現在時刻=§9.37)
      予定 : 予定開始時刻(未来)
    なので、単純に時刻順へ並べるだけで「完了 → 作業中 → 予定」になる。
    区分ごとに並びを組み立てる必要は無い。 */
 const SC_CATEGORIES={
  done:{key:'done',label:'完了',icon:'✓'},
  doing:{key:'doing',label:'作業中',icon:'▶'},
  planned:{key:'planned',label:'予定',icon:'○'},
  cancel:{key:'cancel',label:'取消',icon:'✕'},
  stop:{key:'stop',label:'設備停止',icon:'⛔'},
 };
 function categoryOf(e){
  if(e.state==='取消')return SC_CATEGORIES.cancel;
  if(e.state==='完了')return SC_CATEGORIES.done;
  if(e.state==='着手')return SC_CATEGORIES.doing;
  if(e.kind==='設備停止')return SC_CATEGORIES.stop;
  return SC_CATEGORIES.planned;
 }
 /* 行の代表時刻。並び替え・日付/勤務のまとめ・表示範囲の判定すべてが
    これを使う(判定ごとに別の時刻を見ると、まとめた見出しと行の日付が
    食い違う)。 */
 function rowTimeOf(e){
  const iso=(e.state==='完了'||e.state==='取消')
   ?((e.actual&&(e.actual.startAt||e.actual.endAt))||null)
   :(e.plannedStart||null);
  if(!iso)return null;
  const t=new Date(iso).getTime();
  return Number.isNaN(t)?null:t;
 }
 /* 分割ありの親ロットにぶら下がる子ロット(§9.83)。時間を持たない明細行
    なので、タイムラインの並びからは外して親の下へ畳む。ここで混ぜると
    並べ替えの対象にも数えられてしまう(サーバーは親だけを受け付ける)。 */
 function childEntriesByParent(){
  const map=new Map();
  scState.entries.forEach(e=>{
   if(e.parentId==null)return;
   if(!map.has(e.parentId))map.set(e.parentId,[]);
   map.get(e.parentId).push(e);
  });
  return map;
 }
 function visibleEntries(){
  const list=scState.entries.filter(e=>{
   if(e.parentId!=null)return false;
   if(e.state==='完了'||e.state==='取消')return withinHistory(e);
   return true;
  });
  // 時刻の無い行(展開しきれなかった予定など)は末尾へ寄せて順序を保つ
  return list.map((e,i)=>({e,i,t:rowTimeOf(e)}))
   .sort((a,b)=>{
    if(a.t===null&&b.t===null)return a.i-b.i;
    if(a.t===null)return 1;
    if(b.t===null)return -1;
    return a.t===b.t?a.i-b.i:a.t-b.t;
   })
   .map(x=>x.e);
 }

 /* ---------- まとめ方(§9.40) ---------- */
 const SC_GROUP_MODES=[
  {key:'none',label:'まとめない'},
  {key:'date',label:'日付ごと'},
  {key:'shift',label:'勤務ごと'},
  {key:'dateshift',label:'日付＋勤務ごと'},
  {key:'category',label:'区分ごと'},
 ];
 const SC_GROUP_KEY='ScheduleGroupModeV1';
 function loadGroupMode(){
  try{
   const v=localStorage.getItem(SC_GROUP_KEY);
   if(SC_GROUP_MODES.some(m=>m.key===v))return v;
  }catch(err){/* 保存値が壊れていても既定で続行する */}
  return 'none';
 }
 function dateBucketLabel(e){
  const t=rowTimeOf(e);
  return t===null?'日付未定':fmtDateTitle(new Date(t).toISOString());
 }
 function groupBucketOf(e){
  if(scState.groupMode==='date'){
   const v=dateBucketLabel(e);return {key:v,label:v};
  }
  if(scState.groupMode==='shift'){
   const v=e.shift||'';
   return {key:v||'-',label:v||'勤務未設定'};
  }
  if(scState.groupMode==='dateshift'){
   // 日付が変わっても勤務名が同じ(1直→1直)場合に同じまとまりへ吸われないよう、
   // キーは日付と勤務の組で作る。3直のような日跨ぎ勤務でも、行の代表時刻の
   // 日付でまとまるため見出しと行の日付が食い違わない。
   const d=dateBucketLabel(e),v=e.shift||'勤務未設定';
   return {key:d+'\u0001'+v,label:`${d} ${v}`};
  }
  if(scState.groupMode==='category'){
   const c=categoryOf(e);
   return {key:c.key,label:c.label};
  }
  return null;
 }
 function groupHeadHtml(label,count){
  return `<div class="sc-group-head"><span class="sc-group-label">${esc(label)}</span>`
   +`<span class="sc-group-count">${count}件</span></div>`;
 }

/* 内容の列数はマスタ次第で変わるので、**グリッドの定義も一緒に作り直す**。
   CSSは`--sc-content-cols`を差し込むだけにしてあり、他の11列は固定のまま。
   幅の指定が無い項目は`minmax(...,1fr)`で残りを分け合う(1つも無いと
   タイムラインが右端まで伸びない)。 */
 function applyTimelineContentColumns(timeline){
  const t=timelineTarget();
  const keys=timelineContentKeys();
  const cols=keys.map(k=>{
   const w=t?WL.columnLayout.width(t,k):null;
   return w?`${w}px`:'minmax(calc(110px * var(--ui-scale)),1fr)';
  }).join(' ')||'minmax(calc(150px * var(--ui-scale)),1fr)';
  timeline.style.setProperty('--sc-content-cols',cols);
  // 最小幅も列数で変える(11列ぶん + 内容の列)。足りないと桁がずれる。
  timeline.style.setProperty('--sc-row-min',
   `calc(${892+Math.max(1,keys.length)*110}px * var(--ui-scale))`);
 }

 /* 見出しの操作(§9.88 段1と同じ作法)。掴んで並べ替え、右端の取っ手で幅。
    保存先は`timeline:<設備名>`で、一覧とまったく同じ列レイアウトマスタ。
    **保存は全置換**なので、触っていない設定(表示名・書式・読み替え)も
    一緒に送ること。 */
 function bindTimelineHeadTools(timeline){
  const target=timelineTarget();
  if(!target)return;
  const heads=[...timeline.querySelectorAll('.sc-row-head [data-content-col]')];
  if(!heads.length)return;
  const layout=WL.columnLayout.get(target);
  const keys=timelineContentKeys();
  const persist=async(order,widths)=>{
   try{
    await WL.columnLayout.save(target,{order,widths:widths||layout.widths,hidden:layout.hidden,
                                       names:layout.names,formats:layout.formats,rules:layout.rules});
    showToast&&showToast('内容の列を保存しました','この設備のタイムラインで次も同じ形で出ます',2400);
   }catch(e){showToast&&showToast('列の設定を保存できませんでした',e.message,5000)}
  };
  let dragKey=null;
  heads.forEach(h=>{
   h.addEventListener('dragstart',e=>{
    dragKey=h.dataset.contentCol;h.classList.add('col-dragging');
    try{e.dataTransfer.setData('text/plain',dragKey);e.dataTransfer.effectAllowed='move'}catch(_){}
   });
   h.addEventListener('dragend',()=>{
    dragKey=null;h.classList.remove('col-dragging');
    heads.forEach(x=>x.classList.remove('col-drop-before','col-drop-after'));
   });
   h.addEventListener('dragover',e=>{
    if(!dragKey||h.dataset.contentCol===dragKey)return;
    e.preventDefault();
    const r=h.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
    h.classList.toggle('col-drop-after',after);
    h.classList.toggle('col-drop-before',!after);
   });
   h.addEventListener('dragleave',()=>h.classList.remove('col-drop-before','col-drop-after'));
   h.addEventListener('drop',e=>{
    if(!dragKey||h.dataset.contentCol===dragKey)return;
    e.preventDefault();e.stopPropagation();
    const to=h.dataset.contentCol;
    const r=h.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
    const order=keys.slice();
    const from=order.indexOf(dragKey);if(from<0)return;
    order.splice(from,1);
    const at=order.indexOf(to);if(at<0)return;
    order.splice(after?at+1:at,0,dragKey);
    layout.order=order;
    persist(order);
    renderTimeline();
   });
   const grip=h.querySelector('.col-resize');
   if(!grip)return;
   const key=h.dataset.contentCol;
   grip.addEventListener('mousedown',e=>{
    e.preventDefault();e.stopPropagation();
    const startX=e.clientX,startW=h.getBoundingClientRect().width;
    const move=ev=>{
     const w=Math.max(40,Math.min(900,Math.round(startW+(ev.clientX-startX))));
     h.dataset.resizing=String(w);
     const widths={...(layout.widths||{}),[key]:w};
     layout.widths=widths;applyTimelineContentColumns(timeline);
    };
    const up=()=>{
     document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
     const w=Number(h.dataset.resizing||0);delete h.dataset.resizing;
     if(!w)return;
     persist(keys,layout.widths);
    };
    document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
   });
   grip.addEventListener('dblclick',e=>{
    e.preventDefault();e.stopPropagation();
    const widths={...(layout.widths||{})};delete widths[key];
    layout.widths=widths;persist(keys,widths);applyTimelineContentColumns(timeline);
   });
  });
 }

 function renderTimeline(){
  const timeline=$('#scTimeline');
  const list=visibleEntries();
  if(!list.length){
   timeline.innerHTML=scState.entries.length
    ?`<div class="sc-empty-note">表示範囲(直近${scState.historyHours}時間)に該当する予定・実績がありません。表示範囲を広げてください。</div>`
    :'<div class="sc-empty-note">この設備の予定はまだありません。</div>';
   refreshScheduledLotFilter();
   return;
  }
  timeline.innerHTML='';
  // まとめない場合も含め、行は必ず.sc-groupコンテナへ入れる。並べ替え
  // (wireDrag/moveCard/commitDragOrder)はDOMの兄弟関係だけで動くため、
  // まとめた見出しを素の兄弟に挟むと行が見出しを跨いで動いてしまう。
  const buckets=[];
  list.forEach(e=>{
   const b=groupBucketOf(e);
   const key=b?b.key:'__all__';
   let last=buckets[buckets.length-1];
   if(!last||last.key!==key){last={key,label:b?b.label:'',rows:[]};buckets.push(last)}
   last.rows.push(e);
  });
  /* 列見出しは**タイムライン全体で1枚**(§9.84)。以前はまとめの箱ごとに
     入れていたため、日付＋勤務でまとめると18回も繰り返され、
     「まとめ見出し28px + 列見出し21px + 空き12px」が行と行の間に挟まって
     間隔がばらついて見えていた(行どうしは35px)。列の意味は1回説明すれば
     足りる(このファイル冒頭の高密度リストの説明どおり)。sticky なので
     スクロールしても上に残る。 */
  timeline.insertAdjacentHTML('beforeend',rowHeadHtml());
  applyTimelineContentColumns(timeline);
  bindTimelineHeadTools(timeline);
  const kids=childEntriesByParent();
  buckets.forEach(bucket=>{
   const box=document.createElement('div');
   box.className='sc-group';box.dataset.group=bucket.key;
   if(bucket.label)box.insertAdjacentHTML('beforeend',groupHeadHtml(bucket.label,bucket.rows.length));
   let lastEnd=null;
   bucket.rows.forEach(e=>{
    renderEntryRow(box,e,true,()=>lastEnd,v=>{lastEnd=v});
    renderChildRows(box,e,kids.get(e.id)||[]);
   });
   timeline.append(box);
  });
  refreshScheduledLotFilter();
 }

 /* ---------- 子ロットのまとまり(§9.83) ----------
    親のすぐ下へ、既定は畳んだ状態で置く。**.sc-row-line にはしない**
    ——並べ替え(commitDragOrder/moveCard)はその class でDOMを走査するので、
    子を同じ class にすると並べ替えの対象に混ざり、サーバーが受け付ける
    「親だけ」の一覧と食い違って並べ替えが丸ごと通らなくなる。
    開閉は設備ごとに覚える(畳んだつもりが開き直る、の逆も煩わしい)。 */
 const CHILD_OPEN_KEY='scChildOpenV1';
 function childOpenSet(){
  try{return new Set(JSON.parse(localStorage.getItem(CHILD_OPEN_KEY)||'[]'))}
  catch(e){return new Set()}
 }
 function setChildOpen(id,open){
  const s=childOpenSet();
  open?s.add(String(id)):s.delete(String(id));
  try{localStorage.setItem(CHILD_OPEN_KEY,JSON.stringify([...s].slice(-200)))}catch(e){}
 }
 function childSummary(e){
  const d=e.detail||{};
  const bits=[];
  if(d.__childWidth!=null)bits.push(`幅${d.__childWidth}`);
  if(d.__childStrips)bits.push(`${d.__childStrips}条`);
  if(d.__childTol&&d.__childTol.plus!=null)bits.push(`+${d.__childTol.plus}/-${d.__childTol.minus}`);
  if(d.__childMissing)bits.push('⚠仕掛に無し');
  return bits.join(' / ');
 }
 function renderChildRows(box,parent,children){
  if(!children.length)return;
  const open=childOpenSet().has(String(parent.id));
  const wrap=document.createElement('div');
  wrap.className='sc-child-box';
  wrap.dataset.parent=parent.id;
  wrap.hidden=!open;
  children.forEach(c=>{
   const line=document.createElement('div');
   line.className='sc-child-line'+(c.detail&&c.detail.__childMissing?' is-missing':'');
   line.dataset.id=c.id;
   const summary=childSummary(c);
   line.innerHTML=`<span class="sc-child-mark">└</span>`
    +`<span class="sc-child-lot">${esc(c.lotNo||'')}</span>`
    +`<span class="sc-child-info" title="${esc(summary)}">${esc(summary)}</span>`;
   wrap.append(line);
  });
  box.append(wrap);
  /* 親行へ開閉のつまみを差し込む。**内容の欄(.sc-row-title)の中へ**入れる。
     - 素の兄弟として足すと1列ぶんずれて全部の行の桁が合わなくなる
       (行はグリッドで列が決まっている)。
     - 印の欄(.sc-row-flags)は幅が固定でoverflow:hiddenなので、入れても
       切られて**見えない**(実際に最初そうなった。幅は0でないので
       「出ている」と誤判定しやすい)。
     内容の欄は伸縮する唯一の列なので、つまみを縮まない要素として置き、
     文字側だけ省略記号で詰める。ロット番号のすぐ隣に出るので、
     「この行は畳んだ中身を持つ」ことが読み取りやすい。
     行のHTMLを組み立て直さずに済むよう描画後に足す(renderEntryRowは
     他の呼び出し元とも共有しているため)。 */
  const row=box.querySelector(`.sc-row-line[data-id="${CSS.escape(String(parent.id))}"]`);
  if(!row)return;
  row.classList.add('sc-row-has-children');
  // つまみは**最初の内容セル**へ入れる(段6で内容が複数列になった)。
  const title=row.querySelector('.sc-row-title');
  if(!title)return;
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='sc-child-toggle'+(open?' is-open':'');
  btn.title=`分割後の子ロット${children.length}件を${open?'隠す':'表示する'}`;
  btn.innerHTML=`<i>${open?'▾':'▸'}</i>子ロット${children.length}`;
  btn.onclick=ev=>{
   ev.stopPropagation();
   const nowOpen=wrap.hidden;
   wrap.hidden=!nowOpen;
   btn.classList.toggle('is-open',nowOpen);
   btn.querySelector('i').textContent=nowOpen?'▾':'▸';
   btn.title=`分割後の子ロット${children.length}件を${nowOpen?'隠す':'表示する'}`;
   setChildOpen(parent.id,nowOpen);
  };
  const text=document.createElement('span');
  text.className='sc-row-title-text';
  text.textContent=title.textContent;
  title.textContent='';
  title.classList.add('has-children');
  title.append(btn,text);
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

   const cat=categoryOf(e);
   const locked=!!e.fixedStart;
   const row=document.createElement('div');
   row.className='sc-row-line '+stateRowClass(e.state)
    +(e.__pending?' sc-row-pending':'')+(locked?' sc-row-locked':'')+(e.ongoing?' sc-row-ongoing':'');
   row.dataset.id=e.id;
   row.__scEntry=e;   // 作業可否だけ後から差し替えるときの参照(§9.51)
   // ロック(§9.38)された行はその日時に釘付けなので、並べ替えても時刻が
   // 変わらない。動かせるのに何も起きない状態は紛らわしいためドラッグ対象
   // から外す(解除すれば通常のロットと同じように流れる)。
   const canDrag=scState.editable&&e.reorderable&&!e.__pending&&!locked&&!sessionBlocked();
   row.draggable=canDrag;
   if(canDrag)row.tabIndex=0;

   const lotText=entryContentText(e);      // ツールチップ・帳票用の1行要約
   const contentCells=timelineContentCells(e);
   // 完了・取消は予定時刻を持たない(展開対象外)ので、実績の開始/終了を出す。
   // 以前は一律「-」で、実績セクションだけ時刻が全く読めなかった。
   const useActual=(e.state==='完了')&&e.actual&&e.actual.startAt;
   const showStart=useActual?e.actual.startAt:e.plannedStart;
   const showEnd=useActual?e.actual.endAt:e.plannedEnd;
   const dateText=showStart?fmtDateShort(showStart):'-';
   const dateTitle=showStart?fmtDateTitle(showStart):'';
   // 作業中(§9.37)はまだ終わっていない。予定終了は常に現在時刻なので、
   // 終了時刻を数字で出すと「もう終わったように」見える。「継続中」と出す。
   let timeText,timeTitle;
   if(e.ongoing){
    timeText=`${fmtHM(showStart)}〜継続中`;
    timeTitle=`実績開始 ${fmtDateTime(showStart)} / 未完了のため予定終了は現在時刻`;
   }else{
    timeText=showStart?fmtTimeRange(showStart,showEnd):(e.state==='完了'||e.state==='取消'?'-':'未定');
    timeTitle=showStart?`${useActual?'実績 ':''}${fmtDateTime(showStart)} 〜 ${fmtDateTime(showEnd)}`:'';
   }
   const shiftText=e.shift||'-';
   const relText=e.ongoing
    ?'作業中'
    :(e.startsInMinutes!=null?(fmtRelative(e.startsInMinutes)||'今'):'-');
   const estText=e.estimate?fmtCompact(e.estimate.minutes):'-';
   /* 見積が実績由来かどうかを行の中で見分けられるようにする(§9.114)。
      **「実績」「設備の標準時間」「暫定」の3つを言い分ける**——どれも
      同じ数字に見えるが、当たるかどうかの見込みがまるで違う。 */
   const estSrc=(e.estimate&&e.estimate.source)||'';
   const estProvisional=estSrc==='equipment-standard'||estSrc==='default';
   const estNote=estimateNoteOf(estSrc);
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
    locked?`<span class="sc-flag sc-flag-locked" title="固定開始 ${esc(fmtDateTime(e.fixedStart))}">🔒固定</span>`:'',
    e.__pending?'<span class="sc-flag sc-flag-pending" title="サーバーへ反映中です">⏳追加中</span>':'',
    e.overdueMinutes>0?`<span class="sc-flag sc-flag-overdue" title="${Math.round(e.overdueMinutes)}分押しています">⚠${Math.round(e.overdueMinutes)}分</span>`:'',
    e.spansNonWorking?'<span class="sc-flag sc-flag-spans" title="夜間・休日を跨ぎます">🌙</span>':'',
    e.fixedStart?`<span class="sc-flag sc-flag-fixed" title="固定開始 ${fmtDateTime(e.fixedStart)}">📌</span>`:'',
   ].join('');
   const detailHtml=fixedStartHtml(e)+estimateBreakdownHtml(e);
   const canDelete=scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned;
   // §9.35: 編集モード(=実際に測定する端末)なら、予定から直接測定画面を開ける。
   // 開始時刻を打刻すると実績突合(§7.4)でこの行が「実施中」へ移る。
   // §9.51: 作業可否フラグが立っている(残仕掛設備ｺｰｽがこの設備で始まる)
   // 予定だけ開始できる。まだこの設備に来ていないロットを開始させない。
   const workable=workableOf(e);
   const wk=WORKABLE_LABEL[workable.state]||WORKABLE_LABEL.unknown;
   const wkTitle=workable.course?`${wk.title}\n残仕掛設備ｺｰｽ: ${workable.course}`:wk.title;
   const canStart=scState.canStartWork&&e.kind==='作業'&&e.state==='予定'&&!e.__pending&&!e.unplanned
                  &&workable.state==='ok';
   // §9.38: 日時で固定する(ロック)。予定を動かせるモードでのみ操作できる。
   const canLock=scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned;
   // §9.43: 実績のある行(作業中・完了)は帳票を開ける。実績突合で紐づいた
   // 測定データの記録ID(actualRecordId)をそのまま帳票へ渡す。
   const recordId=e.actualRecordId||'';
   const canReport=!!recordId&&(e.state==='着手'||e.state==='完了')&&typeof window.openReportForRecord==='function';
   // 作業中の行はダブルクリックで測定を再開できる(openMeasurementが端末内の
   // 編集中データを見つけて続きから開く)。編集モードの端末だけ。
   const canResume=scState.canStartWork&&e.kind==='作業'&&e.state==='着手';
   // §9.61: 履歴(作業中・完了)の削除。実績はバックアップ(records.sqlite3)の
   // 行から合成されるため、端末内のデータ一覧に無くてもここに残り続ける
   // (別PCで測定した/端末側だけ消えた場合)。実データを消す操作なので
   // 予定の削除とは別のボタンにし、警告を必ず挟む。
   const canDeleteHistory=scState.canDeleteHistory&&!!recordId&&(e.state==='着手'||e.state==='完了');

   row.innerHTML=`
    <span class="sc-row-handle" title="${canDrag?'ドラッグまたはAlt+↑/↓で並べ替え':(locked?'日時を固定中(ロック)':'')}">${canDrag?'⠿':(locked?'🔒':'')}</span>
    <span class="sc-row-cat sc-cat-${cat.key}" title="${esc(e.kind)}・${esc(e.state)}"><i>${cat.icon}</i>${esc(cat.label)}</span>
    <span class="sc-row-workable ${wk.cls}" title="${esc(wkTitle)}">${esc(wk.text)}</span>
    <span class="sc-row-date" title="${esc(dateTitle)}">${esc(dateText)}</span>
    <span class="sc-row-time" title="${esc(timeTitle)}">${esc(timeText)}</span>
    <span class="sc-row-shift" title="勤務形態マスタで設定した名称です">${esc(shiftText)}</span>
    <span class="sc-row-rel">${esc(relText)}</span>
    ${contentCells.map(c=>`<span class="sc-row-title${c.color?' cell-'+c.color:''}" data-content-col="${esc(c.key)}" title="${esc(c.raw||c.text)}">${esc(c.text)}</span>`).join('')}
    <span class="sc-row-est${estProvisional?' sc-est-default':''}${estSrc==='equipment-standard'?' sc-est-standard':''}" title="${esc(estNote)}">${estProvisional?'~':''}${esc(estText)}</span>
    <span class="sc-row-actual">${esc(actualText)}</span>
    <span class="sc-row-flags">${flags}</span>
    <span class="sc-row-actions">
     ${canStart?`<button type="button" class="sc-row-btn sc-row-start" title="この予定の測定画面を開いて作業を開始します">▶ 開始</button>`:''}
     ${canLock?`<button type="button" class="sc-row-btn sc-row-lock${locked?' active':''}" title="${locked?'固定を解除して通常の並びへ戻します':'今の予定日時でこの行を固定します(以降ずれません)'}">${locked?'🔒':'🔓'}</button>`:''}
     ${canResume?`<button type="button" class="sc-row-btn sc-row-resume" title="測定画面を開いて続きから再開します(行のダブルクリックでも開けます)">▶ 再開</button>`:''}
     ${canReport?`<button type="button" class="sc-row-btn sc-row-report" title="このロットの帳票を表示します">📄</button>`:''}
     ${detailHtml?`<button type="button" class="sc-row-btn sc-row-detail-toggle" title="詳細を表示">▾</button>`:''}
     ${canDelete?`<button type="button" class="sc-row-btn sc-row-delete" title="この予定を削除します">🗑</button>`:''}
     ${canDeleteHistory?`<button type="button" class="sc-row-btn sc-row-btn-danger sc-row-delete-history" title="このロットの測定データ（実績）を削除します。取り消せません">🗑 削除</button>`:''}
    </span>`;
   row.classList.toggle('sc-row-not-workable',workable.state==='ng');
   if(canDrag)wireDrag(row);
   const del=row.querySelector('.sc-row-delete');
   if(del)del.onclick=ev=>{ev.stopPropagation();deleteEntry(e.id)};
   const start=row.querySelector('.sc-row-start');
   if(start)start.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
   const lock=row.querySelector('.sc-row-lock');
   if(lock)lock.onclick=ev=>{ev.stopPropagation();toggleEntryLock(e)};
   const resume=row.querySelector('.sc-row-resume');
   if(resume)resume.onclick=ev=>{ev.stopPropagation();startWorkFromEntry(e)};
   const report=row.querySelector('.sc-row-report');
   if(report)report.onclick=ev=>{ev.stopPropagation();openEntryReport(e)};
   const delHist=row.querySelector('.sc-row-delete-history');
   if(delHist)delHist.onclick=ev=>{ev.stopPropagation();deleteHistoryEntry(e)};
   if(canResume){
    row.classList.add('sc-row-resumable');
    row.title='ダブルクリックで測定を再開します';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;  // 行内ボタンの二度押しを再開と誤認しない
     ev.preventDefault();startWorkFromEntry(e);
    };
   }else if(canReport){
    // 完了行はダブルクリックで帳票(データ一覧の行と同じ操作感、
    // records-store.jsのrow.ondblclickに合わせる)。
    row.title='ダブルクリックで帳票を表示します';
    row.ondblclick=ev=>{
     if(ev.target.closest('button'))return;
     ev.preventDefault();openEntryReport(e);
    };
   }
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
  if(typeof renderGrid==='function'&&typeof S!=='undefined'&&WL.dataSource.isWork(S.db))renderGrid();
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
 /* 操作を「記述(op)」として積む(§9.45)。runの閉包で積む従来の形も残すが、
    opで積んだ分は runWriteQueue が**まとめて1リクエスト**へ束ねられる。
    共有DBの書込は1回ごとにロック取得→検証待ち→取得→反映のサイクルを丸ごと
    踏むため(§4.2)、件数ぶん固定費が積み上がっていた(実測1件約1.5秒)。
    desc: {op:'add'|'update'|'delete'|'reorder', ...payload, onSuccess, onFailure} */
 function queuePlanOp(desc){
  const {onSuccess,onFailure,...op}=desc;
  queueScheduleWrite(
   // まとめられなかった場合(scheduleモード以外・単発)はこの経路で個別に投げる。
   async()=>{
    const path={add:'/api/schedule/plan/add',update:'/api/schedule/plan/update',
                delete:'/api/schedule/plan/delete',reorder:'/api/schedule/plan/reorder'}[op.op];
    const {op:_omit,...body}=op;
    const r=await api(path,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId(body))});
    if(onSuccess)onSuccess(r);
    return r;
   },
   onFailure,op,onSuccess);
 }
 function queueScheduleWrite(run,onFailure,op,onSuccess){
  // 予定を変える操作をした時点でキャッシュ(§9.42)は古い。次にこの画面を
  // 開いたときは必ず取り直す。画面上の表示は楽観的更新(§9.11)で既に
  // 反映されているので、ここで読み直しはしない(操作直後に画面を止めない
  // 一方通行の書込、§9.22)。
  invalidatePlanCache(scState.equipment);
  scWriteQueue.push({run,onFailure,attempts:0,op,onSuccess});
  if(scQueueFlushTimer||scQueueRunning)return;
  scQueueFlushTimer=setTimeout(()=>{scQueueFlushTimer=null;runWriteQueue()},150);
 }
 async function runWriteQueue(){
  if(scQueueRunning)return;
  scQueueRunning=true;
  const failures=[];
  try{
   while(scWriteQueue.length){
    // 先頭から「まとめられる操作(op付き)」が続く限り束ねて1リクエストにする。
    // まとめ書込はscheduleモード限定(サーバー側の制限。§9.45のコメント参照)。
    if(scWriteQueue[0].op&&scState.fullControl&&scWriteQueue.length>1){
     const batch=[];
     while(batch.length<scWriteQueue.length&&scWriteQueue[batch.length].op&&batch.length<100)batch.push(scWriteQueue[batch.length]);
     if(batch.length>1){
      let handled=false;
      try{
       const r=await api('/api/schedule/plan/batch',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify(withUserId({ops:batch.map(b=>b.op)}))});
       const results=r.results||[];
       batch.forEach((b,i)=>{
        const one=results[i];
        if(one&&one.ok!==false){if(b.onSuccess)b.onSuccess(one)}
        else{
         const err=Error((one&&one.error)||'反映できませんでした');
         err.__reported=!!b.onFailure;failures.push(err);
         if(b.onFailure){try{b.onFailure(err)}catch(_e){/* ロールバック失敗は無視 */}}
        }
       });
       scWriteQueue.splice(0,batch.length);
       handled=true;
      }catch(e){
       // まとめて失敗(権限不足・他端末編集中・通信不良)。4xxはリトライしても
       // 同じなので、その場で全件諦める。5xx等は個別処理へ落として従来の
       // リトライに任せる(まとめ経路だけで握りつぶさない)。
       const permanent=e&&typeof e.status==='number'&&e.status>=400&&e.status<500&&e.status!==409&&e.status!==423;
       if(permanent){
        batch.forEach(b=>{
         const err=Error(e.message);err.status=e.status;err.__reported=!!b.onFailure;
         failures.push(err);
         if(b.onFailure){try{b.onFailure(err)}catch(_e){/* 同上 */}}
        });
        scWriteQueue.splice(0,batch.length);
        handled=true;
       }
      }
      if(handled)continue;
     }
    }
    const op=scWriteQueue[0];
    try{
     await op.run();
     scWriteQueue.shift();
    }catch(e){
     op.attempts++;
     // 権限不足・入力不正(4xx)は何度やっても同じ結果になる。リトライすると
     // 同じ失敗メッセージが回数ぶん出てしまうため、即座に諦める。
     // 再試行に意味があるのは共有ファイルのロック待ち・一時的な通信不良
     // (423/409/503やネットワーク例外)だけ。
     const permanent=e&&typeof e.status==='number'&&e.status>=400&&e.status<500&&e.status!==409&&e.status!==423;
     if(permanent||op.attempts>=3){
      scWriteQueue.shift();failures.push(e);
      // onFailureを持つ操作は、そちらで利用者へ知らせる責任を持つ。
      if(op.onFailure){
       try{e.__reported=true;op.onFailure(e)}catch(err){/* ロールバック自体の失敗はここでは無視(諦めたことは既にfailuresへ記録済み) */}
      }
     }
     else await sleep(700*op.attempts);
    }
   }
  }finally{
   scQueueRunning=false;
   // onFailureで個別に知らせた分は、ここで重ねて出さない(同じ内容の通知が
    // 二重に並ぶ)。まとめ通知は「個別の知らせ先を持たない操作」が失敗した
    // ときだけ出す。
   const unreported=failures.filter(f=>!f.__reported);
   if(unreported.length){
    const msg=unreported.length===1?unreported[0].message:`${unreported.length}件の変更を反映できませんでした`;
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
  queuePlanOp({op:'delete',id,
   onFailure:()=>{
    // リトライを使い切って諦めた時だけロールバックする(§9.22)。以前は
    // 失敗するたびに毎回ロールバックしていたため、1回目失敗→ロールバック→
    // 2回目成功、という順で実際にはサーバー側は削除済みなのに画面へ復活
    // したまま二度と消えない不整合が起こり得た。
    if(scState.entries.every(x=>x.id!==removed.id)){scState.entries.splice(Math.min(idx,scState.entries.length),0,removed);renderTimeline()}
   }});
 }

 /* 履歴(作業中・完了)の削除(§9.61)。
    予定の削除(deleteEntry)と違い、**測定データそのもの**を消す操作なので
    別扱いにしてある。消す先が2つあることに注意:
      1. この端末の中(IndexedDB+ミラー) … 端末で測定したデータならここにある
      2. バックアップ(records.sqlite3)  … スケジュールが実績突合に使うのはこちら
    スケジュールに居座るのに「データ一覧には無い」行は、1が無くて2だけが
    残っている状態(別PCで測定した/端末側だけ消えた)。どちらの場合も消える
    ように、端末内にあればreliableDelete(1と2の両方を消す)、無ければ
    バックアップだけを直接消す。 */
 async function deleteHistoryEntry(e){
  const recordId=e.actualRecordId||'';
  if(!recordId)return;
  const lot=e.lotNo||contentValueOf(e.detail,'lotNo')||recordId;
  const stateLabel=e.state==='着手'?'作業中':'完了';
  const ok=await confirmModal({
   eyebrow:'DELETE MEASUREMENT RECORD',
   title:'この実績を削除します',
   danger:true,confirmLabel:'削除する',
   bodyHtml:`<p class="confirm-modal-message">ロット <b>${esc(lot)}</b> の実績（${esc(stateLabel)}）を削除します。</p>
    <ul class="confirm-modal-points">
     <li>削除するのは<b>測定データそのもの</b>です。作業スケジュールの行だけを消すのではありません。</li>
     <li>この端末に残っている場合はデータ一覧からも消え、バックアップ（db/records.sqlite3）からも消えます。</li>
     <li><b>元に戻せません。</b></li>
    </ul>`});
  if(!ok)return;
  await withWaiting({title:'実績を削除しています',detail:`ロット ${lot}`,
    progress:'端末内データとバックアップから削除しています'},async()=>{
   let removed=false;
   // 端末内にあるか(あれば端末＋バックアップの両方を消すreliableDeleteを使う)
   try{
    if(typeof reliableGet==='function'&&await reliableGet(recordId)){
     await reliableDelete(recordId);removed=true;
     if(typeof refreshDraftCount==='function')await refreshDraftCount();
    }
   }catch(err){console.warn('端末内データの削除に失敗',err)}
   if(!removed){
    // 端末には無い(別PCで測定した等)。バックアップ行だけを消す。
    await api('/api/measurement/backup/delete',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[recordId]})});
   }
   invalidatePlanCache();
   await loadPlan(true);
  });
  showToast('実績を削除しました',`ロット ${lot}`,4000);
 }

 /* ---------- ドラッグ並べ替え(§7.5・§9.4) + Alt+↑/↓ ---------- */
 /* ---------- 予定から外す受け皿(§9.116) ----------
    行を掴んで下端の帯へ落とすと、その予定を外す。**掴んでいる間だけ出す**
    ——常設すると「消す場所」が画面に居座り、並べ替えのたびに押し間違いの的に
    なる。外せない行(実施中・完了・計画外・現場段取り権限)では**そもそも出さない**
    ——出しておいて落としたら断る、では掴んだ手間が無駄になる。
    消す確認は deleteEntry() が持っているものをそのまま通す(確認の文言と
    取り消しの作法を2つに増やさない)。 */
 function removableEntry(id){
  const e=(scState.entries||[]).find(x=>String(x.id)===String(id));
  if(!e)return null;
  return (scState.fullControl&&e.state==='予定'&&!e.__pending&&!e.unplanned)?e:null;
 }
 function showRemoveZone(id){
  const z=$('#scDropRemove');if(!z)return;
  if(!removableEntry(id)){z.hidden=true;return}
  z.hidden=false;z.classList.remove('is-over');
 }
 function hideRemoveZone(){
  const z=$('#scDropRemove');if(!z)return;
  z.hidden=true;z.classList.remove('is-over');
 }
 function wireRemoveZone(){
  const z=$('#scDropRemove');if(!z||z.dataset.wired)return;
  z.dataset.wired='1';
  z.addEventListener('dragover',e=>{
   if(!scState.dragId||!removableEntry(scState.dragId))return;
   e.preventDefault();e.dataTransfer.dropEffect='move';
   z.classList.add('is-over');
  });
  z.addEventListener('dragleave',e=>{if(e.target===z)z.classList.remove('is-over')});
  z.addEventListener('drop',e=>{
   /* **idは持ち主の型で渡す。** 掴んだidは dataset 由来の**文字列**だが、
      deleteEntry() は `e.id===id` で探すので、文字列のまま渡すと
      見つからず**確認だけ出て何も消えない**（実際にそうなっていた）。
      引き当てた行の id をそのまま渡す。 */
   const entry=removableEntry(scState.dragId);
   if(!entry)return;
   const id=entry.id;
   e.preventDefault();e.stopPropagation();
   /* **並べ替えとして確定させない。** 帯へ来るまでに行のdragoverでDOMが
      動いているが、commitDragOrder()は呼ばない(外すのが目的なので、
      途中で通り過ぎた位置を保存する意味が無い)。deleteEntry()が
      renderTimeline()を呼ぶので、見た目は状態から作り直される。 */
   hideRemoveZone();
   deleteEntry(id);
  });
 }

 function wireDrag(card){
  // idは文字列のまま扱う。計画外実績(§9.33)の合成idは'actual:<記録ID>'で
  // 数値化するとNaNになり、比較もMap引きも静かに壊れる。
  card.addEventListener('dragstart',e=>{
   scState.dragId=card.dataset.id;card.classList.add('sc-dragging');e.dataTransfer.effectAllowed='move';
   showRemoveZone(card.dataset.id);
  });
  card.addEventListener('dragend',()=>{card.classList.remove('sc-dragging');scState.dragId=null;hideRemoveZone()});
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
  /* **表示順と予定順は同じではない。** タイムラインは時刻順に並べる
     (§9.39)ため、ロック(§9.38)された予定が固定日時どおりの位置へ割り込む。
     画面の並びをそのまま送ると、その割り込み位置が予定順として保存されて
     しまい、ロックを外した瞬間に意図しない順序になる。
     そこで「ロック行は予定順の位置に据え置き、動かせる行(=ロックしていない
     予定)だけを画面の並びで差し替える」形で新しい予定順を組み立てる。
     plan_reorderは並べ替え対象の全件と過不足なく一致するIDを要求するため
     (部分並べ替えは受け付けない)、ロック行も必ず含める。 */
  const previousEntries=scState.entries.slice();
  const byId=new Map(scState.entries.map(e=>[String(e.id),e]));
  const planOrder=scState.entries.filter(e=>e.reorderable);
  const domIds=[...$('#scTimeline').querySelectorAll('.sc-row-line')].map(c=>c.dataset.id);
  const movableDom=domIds.map(id=>byId.get(id)).filter(e=>e&&e.reorderable&&!e.fixedStart);
  const movablePlan=planOrder.filter(e=>!e.fixedStart);
  if(movableDom.length!==movablePlan.length){
   // 想定外(描画と状態がずれている)。順序を壊すより何もしない方が安全。
   console.warn('並べ替え対象の件数が画面と一致しないため、並べ替えを中止しました',
    movableDom.length,movablePlan.length);
   renderTimeline();
   return;
  }
  let mi=0;
  const nextPlan=planOrder.map(e=>e.fixedStart?e:movableDom[mi++]);
  const ids=nextPlan.map(e=>e.id);
  // 画面をブロックしないよう、ローカルの並びも先に更新しておく(§9.11)。
  // 並べ替え対象の位置(スロット)はそのままに、中身だけ新しい順序へ差し替える。
  const rest=scState.entries.filter(e=>!e.reorderable);
  const slots=scState.entries.map(e=>e.reorderable);
  let ri=0,pi=0;
  scState.entries=slots.map(isPlan=>isPlan?nextPlan[pi++]:rest[ri++]);
  const equipment=scState.equipment;
  // 失敗したときに元へ戻せるよう、書き換える前の並びを控えておく。
  const previousOrder=previousEntries;
  queuePlanOp({op:'reorder',equipment,orderedIds:ids,
   onFailure:e=>{
    // 通知は諦めた時に1回だけ(runWriteQueueのリトライ中に出すと同じ文言が
    // 回数ぶん並ぶ)。サーバーが受け付けなかった並びを画面に残さないよう、
    // 元の順序へ戻してから知らせる。
    if(scState.equipment===equipment){scState.entries=previousOrder;renderTimeline()}
    showToast&&showToast('並べ替えできませんでした',(e&&e.message)||'',7000);
   }});
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
  queuePlanOp({op:'add',equipment:target,kind:'設備停止',position:'end',stopReasonId:reasonId,
   onSuccess:r=>resolveOptimisticEntry(entry,r),onFailure:()=>discardOptimisticEntry(entry)});
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
   <div class="sc-float-header"><div><h2>設備停止を追加</h2></div><button type="button" id="scStopModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scStopModalBody"></div>
   <div class="sc-float-resize" title="ドラッグでサイズ変更"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scStopModalClose').onclick=()=>closeStopModal();
  WL.makeFloatingWindow(modal,{storageKey:'scStopModalRectV1',defaultWidth:360,defaultHeight:420,defaultTop:80,minWidth:260,minHeight:200});
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
   <div class="sc-float-header"><div><h2>仕掛一覧に表示する列</h2></div><button type="button" id="scColumnModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scColumnModalBody"></div>
   <div class="sc-float-foot" id="scColumnModalFoot"></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scColumnModalClose').onclick=()=>closeColumnModal();
  WL.makeFloatingWindow(modal,{storageKey:'scColumnModalRectV2',defaultWidth:360,defaultHeight:500,defaultTop:80,minWidth:300,minHeight:300});
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
   <div class="sc-float-header"><div><h2>「内容」欄に出す項目</h2></div><button type="button" id="scContentModalClose" title="閉じる">×</button></div>
   <div class="sc-float-body" id="scContentModalBody"></div>
   <div class="sc-float-foot" id="scContentModalFoot"></div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(modal);
  modal.querySelector('#scContentModalClose').onclick=()=>closeContentModal();
  WL.makeFloatingWindow(modal,{storageKey:'scContentModalRectV2',defaultWidth:460,defaultHeight:520,defaultTop:80,minWidth:340,minHeight:300});
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
 /* 帳票を開く(§9.43)。帳票ビューはrecord id(測定データの記録ID)で引くので、
    実績突合で紐づいたactualRecordIdをそのまま渡す。帳票側の「戻る」は
    データ一覧へ戻る既定の動きのままにしておく(スケジュールへ戻す独自の
    導線を足すと、report-dashboard.js側のrpReturnToの状態管理が二重になる)。 */
 async function openEntryReport(e){
  const id=e.actualRecordId;
  if(!id||typeof window.openReportForRecord!=='function'){
   alert('この行には帳票を開ける測定データが紐づいていません。');
   return;
  }
  try{
   await window.openReportForRecord(id);
  }catch(err){
   alert('帳票を開けません: '+(err&&err.message?err.message:err));
  }
 }
 async function startWorkFromEntry(e){
  if(typeof openMeasurement!=='function'){alert('測定画面を開けません。');return}
  /* §9.51: まだこの設備に仕掛かっていないロットは開始させない。ボタン自体
     出していないが、ダブルクリック等の別経路からも来るので二重に確かめる
     (「予定」から始めるときだけ。着手済みの再開は対象外)。 */
  if(e.state==='予定'){
   const w=workableOf(e);
   if(w.state!=='ok'){
    alert(w.state==='ng'
     ?`このロットはまだ${scState.equipment}に仕掛かっていないため作業を開始できません。\n残仕掛設備ｺｰｽ: ${w.course||'(不明)'}`
     :'仕掛データに該当ロットが見つからないため、作業できるか確認できません。仕掛一覧を再読込してからお試しください。');
    return;
   }
  }
  const row=entryMeasurementRow(e);
  if(!(typeof pick==='function'?pick(row,'lotNo'):row.lotNo)){
   alert('この予定にはロット番号が記録されていないため、測定画面を開けません。');
   return;
  }
  try{
   await openMeasurement(row);
   // 開始時刻を打刻すればこの予定は「作業中」へ移る。次にスケジュールを
   // 開いたときに必ず取り直せるよう、キャッシュを捨てておく(§9.42)。
   invalidatePlanCache(scState.equipment);
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
 function planAddPayload(target,row,children){
  const p=withUserId({equipment:target,kind:'作業',position:'end',
   lotNo:pick(row,'lotNo')||'',inspectionNo:pick(row,'inspectionNo')||'',castingNo:pick(row,'castingNo')||'',detail:buildScheduleDetail(row)});
  if(children&&children.length)p.children=children;
  return p;
 }
 /* ---------- 分割ありの親ロット(§9.83) ----------
    予定へ入れた「そのタイミングで」子ロットの仕掛データを引き、親に
    ぶら下げて一緒に登録する。あとから引き直すのではなく投入時に固める
    のは、予定は「その時点の見え方を固定したスナップショット」だから
    (buildScheduleDetailと同じ考え方)。子ロットは仕掛から外れることが
    あるので、後で引くと消えていることがある。 */
 async function childPayloadFor(row){
  const api=window.WL&&window.WL.split;
  if(!api||!api.hasSplit(row))return [];
  let kids=[];
  try{kids=await api.childRowsForRow(row)}
  catch(e){console.warn('子ロットを取得できませんでした',e);return []}
  return kids.map(k=>({
   lotNo:k.lot,
   inspectionNo:k.row?(pick(k.row,'inspectionNo')||''):'',
   castingNo:k.row?(pick(k.row,'castingNo')||''):'',
   // 子ロット自身の仕掛行があればそれを、無ければ分かっている範囲だけを
   // スナップショットする。__で始まるキーは仕掛の実カラム名と衝突しない。
   detail:Object.assign(k.row?buildScheduleDetail(k.row):{lotNo:k.lot},
                        {__childLot:true,__childWidth:k.width,__childStrips:k.strips,
                         __childTol:k.tol,__childMissing:!!k.missing}),
  }));
 }
 // 子ロットの仮表示。親の直後に並べる(サーバーの並びと同じ)。
 function makeOptimisticChildren(parentEntry,children){
  return (children||[]).map(c=>makeOptimisticEntry('作業',{
   lotNo:c.lotNo,title:c.lotNo,detail:c.detail,
   parentId:parentEntry.id,reorderable:false,
  }));
 }
 async function addRowToSchedule(row,equipment){
  const target=equipment||scState.equipment;
  if(!target){showToast&&showToast('設備を選択してください','',3200);return}
  const children=await childPayloadFor(row);
  if(target!==scState.equipment){
   // 今開いていない設備への追加(§9.5): 楽観描画の対象タイムラインが無い
   // ため従来どおり即時反映する。
   try{
    await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row,children))});
    showToast&&showToast('予定へ追加しました',childAddedNote(target,children),3200);
   }catch(e){showToast&&showToast('追加に失敗しました',e.message,5000)}
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
  scState.entries.push(entry);
  const kidEntries=makeOptimisticChildren(entry,children);
  scState.entries.push(...kidEntries);
  renderTimeline();
  queuePlanOp({op:'add',...planAddPayload(target,row,children),
   onSuccess:r=>{kidEntries.forEach(k=>{k.parentId=r.id});resolveOptimisticEntry(entry,r)},
   onFailure:()=>{kidEntries.forEach(discardOptimisticEntry);discardOptimisticEntry(entry)}});
  if(children.length)showToast&&showToast('予定へ追加しました',childAddedNote(target,children),3600);
 }
 function childAddedNote(target,children){
  if(!children||!children.length)return `${target}の予定に追加しました`;
  const missing=children.filter(c=>c.detail&&c.detail.__childMissing).length;
  return `${target}の予定に追加しました（子ロット${children.length}件を含む`
   +(missing?`／うち${missing}件は仕掛に見つかりません`:'')+'）';
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
  // 分割ありの行だけ子ロットを引く(§9.83)。先頭5桁が同じ親が並んでいても
  // searchByLotPrefix側でキャッシュが効くので、往復は実質1ロット1回以下。
  const childrenOf=new Map();
  let childTotal=0;
  for(const row of rows){
   const kids=await childPayloadFor(row);
   if(kids.length){childrenOf.set(row,kids);childTotal+=kids.length}
  }
  const withKids=n=>childTotal?`${n}（子ロット${childTotal}件を含む）`:n;
  if(target!==scState.equipment){
   let okCount=0;const failedLots=[];
   for(const row of rows){
    try{
     await api('/api/schedule/plan/add',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(planAddPayload(target,row,childrenOf.get(row)))});
     okCount++;
    }catch(e){failedLots.push(pick(row,'lotNo')||'?')}
   }
   if(failedLots.length)showToast&&showToast(`${okCount}/${rows.length}件を追加しました`,`失敗したロット: ${failedLots.join('・')}`,7000);
   else showToast&&showToast('一括追加しました',withKids(`${target}の予定へ${okCount}件追加しました`),3800);
   window.clearListSelection?.();
   return;
  }
  if(sessionBlocked()){showToast&&showToast('追加できません',sessionHolderMessage(),4000);return}
  rows.forEach(row=>{
   const entry=makeOptimisticEntry('作業',{lotNo:pick(row,'lotNo')||'',detail:buildScheduleDetail(row)});
   scState.entries.push(entry);
   const kids=childrenOf.get(row)||[];
   const kidEntries=makeOptimisticChildren(entry,kids);
   scState.entries.push(...kidEntries);
   queuePlanOp({op:'add',...planAddPayload(target,row,kids),
    onSuccess:r=>{kidEntries.forEach(k=>{k.parentId=r.id});resolveOptimisticEntry(entry,r)},
    onFailure:()=>{kidEntries.forEach(discardOptimisticEntry);discardOptimisticEntry(entry)}});
  });
  renderTimeline();
  showToast&&showToast(`${rows.length}件をキューへ追加しました`,withKids(`${target}の予定へ反映中です…`),3200);
  window.clearListSelection?.();
 }

 /* ---------- 印刷への受け渡し(§9.115) ----------
    紙の割り付けは schedule-print.js が持つ。ここが渡すのは**いま画面に
    出ている状態そのもの**で、印刷のために取り直さない——取り直すと画面と
    紙で件数が食い違い、どちらが正か分からなくなる(現場は紙を見て動くので、
    画面と違う紙が出るのが一番困る)。

    別ファイルから触れるのはこの4つだけにしておく。scStateやentryContentText
    をそのまま公開すると、印刷側から画面の状態を書き換えられてしまう。 */
 WL.scheduleView={
  equipment:()=>scState.equipment||'',
  /* 写しを渡す(印刷側が並べ替えても画面の並びを壊さない)。 */
  entries:()=>(scState.entries||[]).slice(),
  /* 内容欄の文字は**画面と同じ組み立て**を通す。設備ごとに選んだ項目・
     読み替え・書式がそのまま紙にも乗る(紙だけ別の組み立てにしない)。 */
  contentTextOf:e=>entryContentText(e),
  equipmentNames:()=>{
   const items=(typeof equipmentMasterState!=='undefined'?equipmentMasterState.items:[])||[];
   const names=items.map(x=>String(x.name||'').trim()).filter(Boolean);
   return names.length?names:(scState.equipment?[scState.equipment]:[]);
  },
  /* 他の設備ぶんは画面が持っていないので取りに行く。**表示範囲は画面と
     同じ値**を使う(紙だけ違う範囲で出すと突き合わせられない)。 */
  fetchEntries:async name=>{
   const r=await api('/api/schedule/plan?equipment='+encodeURIComponent(name)
    +'&history_hours='+encodeURIComponent(scState.historyHours));
   return r.entries||[];
  },
 };

 /* ---------- ナビ ----------
    「作業スケジュール」は全モードで常時表示するため(§9.1)、動的注入
    (calendar-view.js/report-dashboard.jsの分析系ボタンと同じ方式)ではなく
    templates/index.htmlに静的に置いたボタンへ直接配線する。 */
 const navBtn=document.getElementById('openSchedule');
 if(navBtn)navBtn.onclick=()=>openScheduleView().catch(e=>console.error(e));
})();
