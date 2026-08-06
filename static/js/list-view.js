"use strict";
/* list-view.js: 起動処理・DB/テーブル選択・一覧グリッド(仕掛一覧/品質データ)。 */
async function init(){
 try{
 const build=await api('/api/build');document.title='測定伝送システム';
 document.querySelectorAll('.build-badge').forEach(badge=>{
  badge.textContent=build.version?`VER${build.version}`:'バージョン不明';
  badge.title=(build.commit?`コミット: ${build.commit}${build.commit_at?' / '+new Date(build.commit_at).toLocaleString('ja-JP'):''}${build.dirty?'（未コミットの変更あり）':''} / `:'')+'クリックで更新履歴を表示';
  badge.classList.add('build-badge-clickable');
  badge.tabIndex=0;badge.setAttribute('role','button');badge.setAttribute('aria-label','更新履歴を表示');
  badge.onclick=openChangelog;
  badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openChangelog()}};
 });
 const d=await api('/api/catalog');S.catalog=d.databases;
 const nav=$('#nav');
 d.databases.forEach(x=>{
  /* 読み取り専用の業務データ(仕掛・品質データ)だけを「一覧を見る」へ出す。
     ARCHITECTURE.md「マスタ管理の画面形態」: マスタ(role='master')はサイドバーへ独立したナビ項目を作らない。
     「マスタ一覧」(生テーブルの汎用グリッド)と「マスタ管理」(編集画面)が
     別々の入口に分かれていて紛らわしいという指摘のため、生テーブル閲覧は
     マスタ管理画面の中の「テーブル生データ」タブへ統合し、入口を
     「マスタ管理」1つに絞った(S.catalogには従来どおり残すため、
     databaseLabel()やselectDb('MASTER')自体は引き続き動く)。 */
  if(x.role==='master')return;
  let b=document.querySelector(`aside [data-db-key="${x.key}"]`);
  if(!b){
   b=document.createElement('button');b.type='button';b.dataset.dbKey=x.key;
   /* 静的に置いてある兄弟(仕掛・品質データ)と見た目を揃えるためアイコンを付ける。 */
   b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg><span></span>';
   b.className='db nav-item nav-item--view';
   nav?.append(b);
  }
  (b.querySelector('span')||b).textContent=x.label;b.onclick=()=>selectDb(x.key,b);
 });
 const drafts=$('#homeDrafts');if(drafts)drafts.onclick=()=>openRecords('編集中');
 bindAppSettingsControls();await refreshDraftCount();showQuota();
 /* 起動直後の初期画面。使用設備が未登録のうちは絞り込みも対象判定もできず、
    仕掛一覧を取得しても使えないため、先に設備登録へ誘導する。 */
 const initialDbBtn=nav?.querySelector('[data-db-key="SIKALOTNOW"]');
 const equipped=typeof currentConfiguredEquipment==='function'&&currentConfiguredEquipment();
 if(initialDbBtn&&equipped){try{await selectDb('SIKALOTNOW',initialDbBtn)}catch(e){console.warn('初期表示(仕掛一覧)の読み込みに失敗しました',e)}}
 else if(!equipped)$('#grid').innerHTML='<div class="setup-first"><b>最初に使用設備を設定してください</b><span>この端末で使用する設備を登録すると、仕掛一覧を設備で絞り込んで表示できます。上の「使用設備を設定」から登録してください。</span></div>';
 }catch(e){console.error('初期化エラー',e);showToast('初期化の一部に失敗',e.message,8000)}
 finally{bindV32Navigation()}
}
/* バージョンバッジをクリックすると更新履歴の一覧を表示する。 */
let changelogLoaded=false;
async function openChangelog(){
 const modal=$('#changelogModal'),list=$('#changelogList');if(!modal||!list)return;
 modal.hidden=false;
 requestAnimationFrame(()=>$('#closeChangelog')?.focus());
 if(changelogLoaded)return;
 try{
  const data=await api('/api/changelog');
  list.innerHTML=(data.entries||[]).map(e=>`<article class="changelog-entry"><h3>VER${esc(e.version)}</h3><ul>${(e.notes||[]).map(n=>`<li>${esc(n)}</li>`).join('')}</ul></article>`).join('')||'<p class="changelog-loading">更新履歴はまだありません。</p>';
  changelogLoaded=true;
 }catch(error){
  list.innerHTML=`<p class="changelog-loading">更新履歴を読み込めませんでした: ${esc(error?.message||String(error))}</p>`;
 }
}
$('#closeChangelog').onclick=()=>{$('#changelogModal').hidden=true};
function renderTabs(){$('#tabs').innerHTML='';S.tables.forEach(t=>{const b=document.createElement('button');b.className='tab'+(t===S.table?' active':'');b.textContent=t;b.onclick=()=>selectTable(t);$('#tabs').append(b)})}
/* 一覧データの取得。待機表示を出してから読み込む。 */
/* ---------- 一覧データのキャッシュ(docs/ARCHITECTURE.md「共有ファイルを読む
   処理は回数が効く」) ----------
   仕掛(SIKALOTNOW)・品質データ(SIKALOTDEF)は工場側の共有上にあるAccess/SQLite
   で、1回開くたびに接続・列取得・COUNT全走査・本体取得の往復が要る。画面を
   切り替えて戻るたびに全部やり直していたため、切替のたびに待たされていた。
   同じ条件(DB・テーブル・ページ・検索・フィルタ・並び)なら結果を使い回す。

   仕掛は生きたデータなので、無期限に持つと古い在庫を見せ続けることになる。
   TTLで頭を打ち、いつ時点かを画面に出し、「再読込」で必ず取り直せるようにする
   (この3点セットで「速いが嘘はつかない」を成立させる)。 */
const TABLE_CACHE_TTL_MS=180000;   // 3分
const tableCache=new Map();
function tableCacheGet(key){
 const hit=tableCache.get(key);
 if(!hit)return null;
 if(Date.now()-hit.at>TABLE_CACHE_TTL_MS){tableCache.delete(key);return null}
 return hit;
}
function tableCacheSet(key,data){
 tableCache.set(key,{data,at:Date.now()});
 // 際限なく溜めない(条件を変えるたびに1件増えるため)
 if(tableCache.size>40)tableCache.delete(tableCache.keys().next().value);
}
function invalidateTableCache(){
 tableCache.clear();updateListFreshness(null);
 // 分割判定が使う仕掛の生データ問い合わせも一緒に捨てる(一覧だけ新しくして
 // 親ロット判定が古いまま、という食い違いを作らない)。
 if(typeof window.invalidateSplitQueryCache==='function')window.invalidateSplitQueryCache();
}
window.invalidateTableCache=invalidateTableCache;
/* 「いつ時点の一覧か」をヘッダーへ出す。キャッシュから描いたときだけ意味が
   あるので、取り立てのときは非表示にする。 */
function updateListFreshness(at){
 const el=document.querySelector('#listFreshness');if(!el)return;
 // 鮮度は一覧画面の情報。スケジュール画面では一覧は一区画でしかないので、
 // ヘッダー(=作業スケジュール)の隣に出すと何の鮮度か分からない(§9.60)。
 if(!at||document.body.classList.contains('sc-mode')){el.hidden=true;return}
 const min=Math.floor((Date.now()-at)/60000);
 el.hidden=false;
 el.textContent=min<1?'たった今の内容':`${min}分前の内容`;
 el.title='「再読込」で最新を取り直します。';
}
window.updateListFreshness=updateListFreshness;
/* 取得結果を画面状態へ流し込む共通処理(list-view.jsとfilters.jsのload()が共用)。 */
function applyTableData(d){
 Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});
 S.joinQuality=d.joinQuality||null;
 const info=(S.catalog||[]).find(x=>x.key===S.db)||{};
 // 主は画面名(仕掛一覧/品質データ)、副にファイル名。以前はファイル名だけを
 // 出しており、他画面へ移ってもそのまま残っていた(§9.60)。
 // ただしスケジュールの分割表示中(body.sc-mode)は、仕掛一覧は作業スケジュール
 // 画面の中の一区画にすぎない。ここで書き換えると、作業スケジュールを見て
 // いるのにヘッダーだけ「仕掛一覧」になる(実際にそうなっていた)。
 if(!document.body.classList.contains('sc-mode'))setHeaderContext(databaseLabel(S.db),info.file_name||'');
 const tn=$('#tableName');if(tn)tn.textContent=S.table||'';
 S.selectedRows.clear();
}
window.applyTableData=applyTableData;
/* 一覧データ取得の本体(キャッシュ判定→取得→鮮度更新)。filters.jsはクエリの
   組み立てを差し替えるためにload()を丸ごと置き換えているので、そこと
   共通の振る舞いはすべてここへ集約する(片方だけ直して反映されない事故を防ぐ)。
   待機表示はwithWaitingの遅延表示に任せる: キャッシュ命中なら一度も出ないし、
   本当にサーバーを待つときだけ出る。 */
async function fetchTableData(key,force){
 const hit=force?null:tableCacheGet(key);
 if(hit){applyTableData(hit.data);updateListFreshness(hit.at);return}
 const label=databaseLabel(S.db),table=S.table||'テーブル';
 await withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${table}`,
   progress:'検索条件を反映して一覧データを取得しています'},async()=>{
  const d=await api('/api/table?'+key);
  tableCacheSet(key,d);applyTableData(d);updateListFreshness(null);
 });
}
window.fetchTableData=fetchTableData;

async function load(force){
 const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,page_size:$('#pageSize').value,search:$('#search').value});
 // スケジュールモードの仕掛一覧のみ、品質データ(SIKALOTDEF)を結合して表示する
 // (§9.21)。通常の仕掛一覧閲覧では付けない(オプトインでSIKALOTNOW単独表示に
 // 影響を与えない)。
 if(S.db==='SIKALOTNOW'&&window.accessMode?.mode==='schedule')q.set('join_quality','1');
 await fetchTableData(String(q),force);
 renderGrid();
}
/* データベース切替→テーブル選択は、実際に目視できる2段階で待機表示する
   (テーブル構成の確認→列情報・一覧データの取得)。以前は3段階だったが、
   ステップ間に描画の猶予(nextPaint)を与えていない箇所があり、中間の
   ステップが一度も画面に表示されないまま次のステップへ上書きされていた。
   待機表示そのものはwithWaitingの遅延表示に委ねる(§9.46)。キャッシュから
   即座に描ける切替でオーバーレイを出すと、一瞬の点滅と表示待ちの描画
   フレームが挟まるぶん、速くなったのにかえって遅く見えるため。 */
const tablesCache=new Map();   // テーブル構成は運用中に変わらないので保持する
/* 一覧(データ一覧/仕掛/品質データ)。品質データを選んだときだけ品質分析の
   パネルが上に付く(qa-mode)ので、一覧から他の画面へ移るときはそれも一緒に
   畳む。以前はこの後始末を各画面のopenXxxが個別に書いており、
   #qualityAnalysisPanelを実際に隠していたのは実績カレンダーだけだった。 */
WL.registerView({key:'list',exit:()=>{
 document.body.classList.remove('qa-mode','qa-view-raw');
 document.getElementById('qualityAnalysisPanel')?.setAttribute('hidden','');
}});
async function selectDb(k,b){
 /* 利用者の操作で一覧へ移るなら、これが画面の切替そのもの。以前は
    「他の画面を閉じる」処理を各ファイルがselectDbを順に包むモンキーパッチ
    (6箇所)で足しており、読み込み順に依存する連鎖になっていた。
    内部からの呼び出し(スケジュールの分割表示)では切り替えない。 */
 if(!WL.isInternalDbSwitch())WL.enterView('list');
 const label=databaseLabel(k);
 return withWaiting({title:`${label}へ切り替えています`,detail:`接続先を確認しています: ${label}`,
   progress:'テーブル構成を確認しています',step:1},async report=>{
  try{S.db=k;setActiveNav(k);
   let result=tablesCache.get(k);
   if(!result){result=await api(`/api/tables?db=${encodeURIComponent(k)}`);tablesCache.set(k,result)}
   S.tables=result.tables;renderTabs();
   if(S.tables.length)await selectTable(S.tables[0],report);
   else $('#grid').textContent='表示可能なテーブルがありません。';
  }catch(e){$('#grid').innerHTML=`<div class="load-error"><b>${esc(label)}を開けませんでした</b><span>${esc(e.message)}</span></div>`;throw e}
 });
}
/* reportは呼び出し元(selectDb)が待機表示を握っているときだけ渡ってくる。
   単独で呼ばれたとき(タブのクリック)は自分で遅延表示を用意する。 */
async function selectTable(t,report){
 S.table=t;S.page=1;S.sortColumn=null;S.sortDir=null;renderTabs();const label=databaseLabel(S.db);
 if(report){report({detail:`テーブル: ${t}`,progress:'列情報と一覧データを取得しています',step:2});return load()}
 return withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${t}`,
   progress:'列情報と一覧データを取得しています'},()=>load());
}
/* 一覧の列名は仕掛先DBの生カラム名なので、aliasesの候補名のうち
   実際にS.columnsへ含まれているものを探してロット番号・鋳造番号の
   列を特定する(見つからなければ通常表示のまま)。 */
function findColumnFor(key){return (aliases[key]||[]).find(n=>S.columns.includes(n))||null}
// Add an explicit virtual action column instead of writing into the last data column.
function renderGrid(){
 bumpGridGeneration();   // 前の描画に紐づく非同期判定を打ち切る(下のcheck*参照)
 /* ロット問い合わせ(LotDsp)は仕掛一覧・品質データのどちらでも使えるように
    する。「測定」列(測定画面を開く)は仕掛一覧(SIKALOTNOW)専用のまま。
    「予定」列(スケジュールへ追加、§9.5)もSIKALOTNOW専用で、スケジュール
    モードのときだけ出す(押せないボタンを他モードで見せない)。 */
 const isWork=S.db==='SIKALOTNOW',hasLotDsp=S.db==='SIKALOTNOW'||S.db==='SIKALOTDEF';
 const canPlan=isWork&&window.accessMode?.mode==='schedule';
 const lotCol=hasLotDsp?findColumnFor('lotNo'):null,castCol=hasLotDsp?findColumnFor('castingNo'):null;
 const filteredCols=new Set((S.genericFilters||[]).map(f=>f.column));
 // 既にスケジュールへ投入済みのロットは一覧から消す(§9.15新設)。今開いて
 // いる設備の作業スケジュール(schedule-view.js側のscState.entries)に無い
 // ロットだけを残す。対象外(スケジュール画面を開いていない・schedule
 // モードでない等)ではwindow.scScheduledLotSet?.()がnullを返し、
 // フィルタしない(通常の全件表示)。
 const scheduledLots=canPlan?window.scScheduledLotSet?.():null;
 const visibleRows=(scheduledLots&&scheduledLots.size)?S.rows.filter(r=>!scheduledLots.has(pick(r,'lotNo'))):S.rows;
 // スケジュール列表示マスタ(§9.18新設): scheduleモードで設備ごとに選んだ
 // 列だけへ絞る(未設定の設備・schedule以外のモードではnullが返り、
 // 通常どおり全列を表示する)。
 const columnAllowlist=canPlan?window.scColumnAllowlist?.():null;
 const visibleColumns=columnAllowlist?S.columns.filter(c=>columnAllowlist.includes(c)):S.columns;
 // 予定追加ボタン(+予定)は多数の列を横に比較しながら選ぶ運用(§9.5)のため
 // 毎回右端までスクロールさせないよう、選択チェックボックスと並べて最左列へ
 // 置く(§9.15改訂。以前は最右列だった)。
 const t=document.createElement('table');
 t.innerHTML='<thead><tr>'+(canPlan?'<th class="plan-select-head"><input type="checkbox" id="planSelectAll" title="このページの全行を選択/解除"></th><th class="plan-action-head">予定</th>':'')+'<th>#</th>'+(isWork?'<th class="split-flag-head" title="親子管理_子カード／コンマ5本分割_切断巾に実データがある場合「分割あり」と表示します">分割</th>':'')+visibleColumns.map(c=>{
  const filtered=filteredCols.has(c),sorted=S.sortColumn===c,arrow=sorted?(S.sortDir==='desc'?' ▼':' ▲'):'';
  return `<th class="sortable-col ${filtered?'col-filtered':''} ${sorted?'col-sorted':''}" data-sort-col="${esc(c)}" tabindex="0" role="button" aria-label="${esc(c)}列で並び替え" title="クリックで並び替え${filtered?'（絞り込み中の列です）':''}">${esc(c)}${arrow}${filtered?'<i class="col-filter-badge" aria-hidden="true" title="この列にフィルタが適用されています">▼</i>':''}</th>`;
 }).join('')+(isWork?'<th class="measurement-action-head">測定</th>':'')+'</tr></thead>';
 const sortByHeader=th=>{
  const col=th.dataset.sortCol;
  S.sortDir=(S.sortColumn===col&&S.sortDir==='asc')?'desc':'asc';
  S.sortColumn=col;S.page=1;load();
 };
 t.querySelectorAll('th[data-sort-col]').forEach(th=>{
  th.onclick=()=>sortByHeader(th);
  th.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();sortByHeader(th)}};
 });
 const b=document.createElement('tbody');
 // 分割データはあるが子ロットが仕掛から見つからない行(=作業済みで仕掛から
 // 外れている可能性が高い)を、非同期の存在確認後にグリッド上で気づけるように
 // 更新する対象を集める(下のrunLimitedブロック参照)。
 const splitCheckTargets=[];
 // 親側の分割データは無い(=一見「分割なし」)行でも、「ｺﾝﾏ5本ｶｰﾄﾞ区分」が
 // 3の行は分割済みの子ロット自身であるため、親ロットを逆引き検索して
 // 気づけるようにする対象を集める(下のcheckParentLookupRows参照)。
 const parentCheckTargets=[];
 visibleRows.forEach((r,i)=>{
  const tr=document.createElement('tr');
  let splitCell='';
  if(isWork){
   const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(r):{hasSplit:false};
   if(info.hasSplit){
    const patternShort=info.widthPattern==='same'?'同幅':info.widthPattern==='different'?'異幅':'';
    const patternFull=info.widthPattern==='same'?'同一幅分割':info.widthPattern==='different'?'異幅分割':'幅パターン不明';
    /* ロット数と条数は別物なので両方出す(以前は条数をロット数として
       「分割あり(6)」のように表示していた)。セルは狭いので「ロット/条」
       の並びで短く、詳しくはツールチップで言い分ける。 */
    const strips=Number.isFinite(info.stripCount)?info.stripCount:info.lotCount;
    splitCell=`<td class="split-flag-cell split-yes" title="推定 ${info.lotCount}ロット / ${strips}条・${patternFull}（実際の子ロット数・条数・幅は測定画面で確定します）">分割あり(${info.lotCount}ロット/${strips}条)${patternShort?'・'+patternShort:''}</td>`;
    splitCheckTargets.push({tr,row:r});
   }else{
    splitCell='<td class="split-flag-cell split-no">分割なし</td>';
    if(typeof window.isChildCardClassifiedRow==='function'&&window.isChildCardClassifiedRow(r))parentCheckTargets.push({tr,row:r});
   }
  }
  tr.innerHTML=(canPlan?`<td class="plan-select-cell"><input type="checkbox" class="plan-select-checkbox"></td><td class="plan-action-cell"><button type="button" class="plan-action-button" title="この行の設備の作業スケジュールへ追加します">+ 予定</button></td>`:'')+`<td>${(S.page-1)*+$('#pageSize').value+i+1}</td>`+splitCell+visibleColumns.map(c=>{
   if(c===lotCol){const lotVal=r[c];return `<td class="lot-cell"><button type="button" class="lot-dsp-link grid-lot-link" title="クリックでLotDspをこのロット番号で開きます">${esc(lotVal)||'—'}</button></td>`}
   return `<td>${esc(r[c])}</td>`;
  }).join('')+(isWork?'<td class="measurement-action-cell"><button type="button" class="measurement-action-button">開く</button></td>':'');
  if(r===S.selectedRow)tr.classList.add('is-selected');
  if(canPlan&&S.selectedRows.has(r))tr.classList.add('is-plan-selected');
  tr.addEventListener('click',()=>{
   if(S.selectedRow===r)return;
   S.selectedRow=r;
   b.querySelectorAll('tr.is-selected').forEach(x=>x.classList.remove('is-selected'));
   tr.classList.add('is-selected');
  });
  if(isWork){
   tr.classList.add('measurement-row');
   const open=e=>{e.preventDefault();e.stopPropagation();openMeasurement(r).catch(err=>alert('測定画面を開けません: '+err.message))};
   tr.addEventListener('dblclick',open);
   tr.querySelector('.measurement-action-button').onclick=open;
  }
  if(canPlan){
   const planBtn=tr.querySelector('.plan-action-button');
   if(planBtn)planBtn.onclick=e=>{e.preventDefault();e.stopPropagation();window.scheduleAddFromRow?.(r)};
   const checkbox=tr.querySelector('.plan-select-checkbox');
   if(checkbox){
    checkbox.checked=S.selectedRows.has(r);
    checkbox.addEventListener('click',e=>e.stopPropagation());
    checkbox.addEventListener('change',()=>{
     if(checkbox.checked)S.selectedRows.add(r);else S.selectedRows.delete(r);
     tr.classList.toggle('is-plan-selected',checkbox.checked);
     syncPlanSelectAll(visibleRows);renderPlanSelectBar(true);
    });
   }
   // 分割表示(§9.10)でのドラッグ投入。チェックボックスで複数選択済みの
   // 行をドラッグした場合はその選択全体を、そうでなければこの1行だけを
   // 運ぶ(window.__scDragRowsはschedule-view.js側のドロップ処理と共有する
   // 単純なハンドオフ。scheduleAddFromRow等と同じ既存の連携方式)。
   tr.draggable=true;
   tr.addEventListener('dragstart',e=>{
    const dragRows=(S.selectedRows.has(r)&&S.selectedRows.size>1)?Array.from(S.selectedRows):[r];
    window.__scDragRows=dragRows;
    e.dataTransfer.effectAllowed='copy';
    try{e.dataTransfer.setData('text/plain',dragRows.map(x=>pick(x,'lotNo')||'').join('、'))}catch(err){/* 一部ブラウザでのsetData制限は無視する */}
    tr.classList.add('is-row-dragging');
   });
   tr.addEventListener('dragend',()=>{tr.classList.remove('is-row-dragging');window.__scDragRows=null});
  }
  if(hasLotDsp){
   const lotBtn=tr.querySelector('.grid-lot-link');
   if(lotBtn)lotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(pick(r,'lotNo'),castCol?r[castCol]:pick(r,'castingNo'),localStorage.getItem('LotDspLastTabV1')||'1')};
  }
  b.append(tr);
 });
 t.append(b);$('#grid').replaceChildren(t);$('#count').textContent=`全 ${S.count.toLocaleString()}件`;$('#page').textContent=`${S.page}ページ`;$('#prev').disabled=S.page===1;$('#next').disabled=S.page*+$('#pageSize').value>=S.count;
 if(canPlan){
  const selectAll=$('#planSelectAll');
  if(selectAll){
   syncPlanSelectAll(visibleRows);
   selectAll.onchange=()=>{
    visibleRows.forEach(r=>{if(selectAll.checked)S.selectedRows.add(r);else S.selectedRows.delete(r)});
    renderGrid();
   };
  }
 }
 renderPlanSelectBar(canPlan);
 renderListToolbar();
 checkSplitRowsForMissingChildren(splitCheckTargets);
 checkParentLookupRows(parentCheckTargets);
}

/* ---------- 一覧のツールバー ----------
   一覧そのものに属する操作(表示列の選択)と状態(品質データ結合の結果)は、
   一覧と同じ場所へ置く。#gridは分割表示・ポップアップ表示へDOMごと
   移動する(schedule-view.jsのmoveGridTo)ため、このツールバーも#gridの
   直前の兄弟として一緒に動かす。以前は「表示する列の選択」が作業スケジュール
   画面のヘッダーにあり、操作対象(仕掛一覧)から離れていて何に効くのか
   分かりにくかった。 */
function ensureListToolbar(){
 let bar=document.getElementById('listToolbar');
 const grid=$('#grid');
 if(!grid||!grid.parentNode)return null;
 if(!bar){
  bar=document.createElement('div');bar.id='listToolbar';bar.className='list-toolbar';bar.hidden=true;
  bar.innerHTML=`<button type="button" id="listColumnBtn" class="list-toolbar-btn" title="この一覧に表示する列を選びます">☰ 表示列</button>
   <span class="list-join-chip" id="listJoinChip" hidden></span>`;
  grid.parentNode.insertBefore(bar,grid);
  bar.querySelector('#listColumnBtn').onclick=()=>window.openListColumnPicker?.();
 }else if(bar.nextElementSibling!==grid){
  // #gridが別の親(分割/ポップアップ)へ移動したら追従させる。
  grid.parentNode.insertBefore(bar,grid);
 }
 return bar;
}
function renderListToolbar(){
 const bar=ensureListToolbar();if(!bar)return;
 // 表示列の選択は、設備ごとの設定を持つスケジュールモードの仕掛一覧でのみ扱う。
 const canPickColumns=S.db==='SIKALOTNOW'&&window.accessMode?.mode==='schedule'&&!!window.scColumnPickerAvailable?.();
 const btn=bar.querySelector('#listColumnBtn');
 if(btn)btn.hidden=!canPickColumns;
 // 品質データ結合(join_quality)の結果を、成功・失敗どちらも一覧の脇に出す。
 // 以前はサーバー側で黙って素通ししていたため、結合されない理由が分からなかった。
 const chip=bar.querySelector('#listJoinChip');
 const info=S.joinQuality;
 if(chip){
  if(!info){chip.hidden=true;chip.textContent=''}
  else{
   chip.hidden=false;
   const ok=info.applied&&info.matched>0;
   chip.className='list-join-chip '+(ok?'is-ok':'is-warn');
   chip.textContent=ok?`品質データ結合済み ${info.matched}件 / +${info.addedColumns}列`:'品質データ未結合';
   chip.title=ok?`ロット番号・鋳造番号・製造材質が一致した${info.matched}行に、品質データの${info.addedColumns}列を結合しました(照合先: ${info.table||'-'})。重複する列は仕掛情報を優先します。`
                :`品質データを結合できませんでした: ${info.reason||'原因不明'}`;
  }
 }
 bar.hidden=!(canPickColumns||(info&&!chip.hidden));
}
/* 複数選択→スケジュールへ一括投入(§9.5)。ヘッダーの全選択チェックボックスは
   このページの表示行(投入済みでスケジュールから除外表示している行を除く、
   §9.15)のみを対象にする(indeterminate状態で「一部選択中」を示す)。 */
function syncPlanSelectAll(rows){
 const selectAll=$('#planSelectAll');if(!selectAll)return;
 const target=rows||S.rows;
 const total=target.length,checked=target.filter(r=>S.selectedRows.has(r)).length;
 selectAll.checked=total>0&&checked===total;
 selectAll.indeterminate=checked>0&&checked<total;
}
/* 選択件数バー。0件のときは何も出さない(未選択時に常時「0件選択中」と
   出すのは視覚的なノイズになるため、選択が始まってから見せる)。 */
function renderPlanSelectBar(canPlan){
 const grid=$('#grid');if(!grid)return;
 let bar=document.getElementById('planSelectBar');
 const n=S.selectedRows.size;
 if(!canPlan||n===0){bar?.remove();return}
 if(!bar){
  bar=document.createElement('div');bar.id='planSelectBar';bar.className='plan-select-bar';
  grid.insertBefore(bar,grid.firstChild);
 }
 // ドラッグが使いにくい環境(タッチ操作・支援技術)向けに、選択件数バーへ
 // 直接投入ボタンも出す(§9.10。ドラッグと同じ一括追加処理を呼ぶだけの
 // もう1つの入口)。分割表示で対象設備が決まっている時だけ有効にする。
 const target=window.scCurrentDropTarget?.();
 const addBtn=target?`<button type="button" class="plan-select-add" id="planSelectAdd">${esc(target)}へ追加</button>`:'';
 bar.innerHTML=`<span>${n}件選択中</span>${addBtn}<button type="button" class="plan-select-clear" id="planSelectClear">選択解除</button>`;
 $('#planSelectClear').onclick=clearListSelection;
 const add=$('#planSelectAdd');
 if(add)add.onclick=()=>window.scAddSelectedRows?.(Array.from(S.selectedRows));
}
function clearListSelection(){
 if(!S.selectedRows.size)return;
 S.selectedRows.clear();
 renderGrid();
}
window.clearListSelection=clearListSelection;
/* 分割あり行について、子ロットが仕掛に実在するかを確認し、見つからなければ
   グリッド上で気づける表示(⚠子ロット未検出)に切り替える。1行ごとに問い合わせが
   発生するため、同時実行数を絞って一覧の応答性・Access接続への負荷を抑える。 */
/* 一覧を描き直すたびに進む世代番号。分割判定・親ロット判定は描画後に
   非同期で追いつく作りなので、ページ送り・検索・並べ替えで描き直された
   あとに古い応答が返ってくると、既に取り除かれた行へ書き込み続け、
   問い合わせも無駄に走り切る。世代が変わったら打ち切る。 */
let gridGeneration=0;
function bumpGridGeneration(){return ++gridGeneration}
function runLimited(items,limit,worker){
 let idx=0;
 const runners=Array.from({length:Math.min(limit,items.length)},async()=>{
  while(idx<items.length){
   const item=items[idx++];
   try{await worker(item)}catch(e){console.warn(e)}
  }
 });
 return Promise.all(runners);
}
function checkSplitRowsForMissingChildren(targets){
 if(!targets.length||typeof window.findMissingChildLots!=='function')return;
 const gen=gridGeneration;
 runLimited(targets,3,async({tr,row})=>{
  if(gen!==gridGeneration)return;          // 描き直された: この判定はもう不要
  const info=await window.findMissingChildLots(row);
  if(gen!==gridGeneration)return;
  if(!info||!info.missing.length)return;
  const cell=tr.querySelector('.split-flag-cell');if(!cell)return;
  cell.classList.remove('split-yes');cell.classList.add('split-missing');
  cell.textContent=`分割あり・子ロット未検出(${info.missing.length})⚠`;
  cell.title=`次の子ロットが仕掛データに見つかりません: ${info.missing.join('、')}\n作業済み(仕掛から外れている)の可能性が高く、目標幅・公差の一部が欠けたまま測定される恐れがあります。`;
 });
}
/* 親側の分割データが無い(=一見「分割なし」)行でも、「ｺﾝﾏ5本ｶｰﾄﾞ区分」が3の
   行は分割済みの子ロット(子カード)自身である。親ロットを逆引き検索し、
   見つかれば「分割なし(親：xxx)」、見つからなければ「分割なし(子)」に
   切り替えて、仕掛一覧だけで子ロットであることに気づけるようにする。 */
function checkParentLookupRows(targets){
 if(!targets.length||typeof window.findParentLotFor!=='function')return;
 const gen=gridGeneration;
 runLimited(targets,3,async({tr,row})=>{
  if(gen!==gridGeneration)return;          // 描き直された: この判定はもう不要
  const parent=await window.findParentLotFor(row);
  if(gen!==gridGeneration)return;
  const cell=tr.querySelector('.split-flag-cell');if(!cell)return;
  if(parent){
   const parentLotNo=pick(parent,'lotNo');
   cell.textContent=`分割なし(親：${parentLotNo})`;
   cell.title=`このロットは分割済みの子ロット(子カード)です。親ロット「${parentLotNo}」が仕掛に見つかりました。`;
  }else{
   cell.textContent='分割なし(子)';
   cell.title='このロットは分割済みの子ロット(子カード)と判定されましたが、対応する親ロットは仕掛に見つかりませんでした。';
  }
 });
}
/* 検索・ページャ。ボタンは常に最新のload実装を呼ぶ(旧実装は初期のload関数を
   参照し続ける潜在不具合があった)。 */
$('#search').oninput=()=>{clearTimeout(S.t);S.t=setTimeout(()=>{S.page=1;load()},300)};
$('#pageSize').onchange=()=>{S.page=1;load()};
// 「再読込」は必ずサーバーから取り直す(キャッシュを返すと押しても何も
// 起きないように見えるため)。
$('#reload').onclick=()=>{invalidateTableCache();load(true)};
$('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};
$('#next').onclick=()=>{S.page++;load()};
