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
 WL.dataSource.setCatalog(d);
 renderDbNav();
 const drafts=$('#homeDrafts');if(drafts)drafts.onclick=()=>openRecords('編集中');
 bindAppSettingsControls();await refreshDraftCount();showQuota();
 /* 起動直後の初期画面。使用設備が未登録のうちは絞り込みも対象判定もできず、
    仕掛一覧を取得しても使えないため、先に設備登録へ誘導する。
    **どの一覧を最初に出すかはキーで決め打ちしない**(§9.87)。役割が「作業」の
    データソース、無ければ一覧の先頭を開く。 */
 const nav=$('#nav');
 const initialKey=WL.dataSource.workKey()||(WL.dataSource.views()[0]||{}).key||'';
 const initialDbBtn=initialKey?nav?.querySelector(`[data-db-key="${CSS.escape(initialKey)}"]`):null;
 const equipped=typeof currentConfiguredEquipment==='function'&&currentConfiguredEquipment();
 if(initialDbBtn&&equipped){try{await selectDb(initialKey,initialDbBtn)}catch(e){console.warn('初期表示(仕掛一覧)の読み込みに失敗しました',e)}}
 else if(!equipped)$('#grid').innerHTML='<div class="setup-first"><b>最初に使用設備を設定してください</b><span>この端末で使用する設備を登録すると、仕掛一覧を設備で絞り込んで表示できます。上の「使用設備を設定」から登録してください。</span></div>';
 }catch(e){console.error('初期化エラー',e);showToast('初期化の一部に失敗',e.message,8000)}
 finally{bindV32Navigation()}
}
/* ---------- 行間(§9.88) ----------
   一覧全体の密度。列ごとの設定とは別物なので、保存先も別
   (一覧表示設定マスタ)。段階(1〜5)で持ち、実際の余白は --row-gap へ流す。
   **1本のつまみで行の高さが決まる**構造にしてあるので(§9.88 段0)、
   ここはその値を差し替えるだけで済む。 */
const ROW_GAP_STEPS={1:'2px',2:'3px',3:'4px',4:'6px',5:'9px'};
let rowGapValue=3;
function applyRowGap(step){
 rowGapValue=Math.max(1,Math.min(5,Number(step)||3));
 const grid=document.querySelector('#grid');
 if(!grid)return;
 const v=ROW_GAP_STEPS[rowGapValue];
 /* **--row-pad-y も一緒に差し替える。** :root で
    `--row-pad-y: var(--row-gap)` と定義してあるが、カスタムプロパティは
    定義した場所で値が解決されるため、子孫で --row-gap を上書きしても
    --row-pad-y は :root の値のまま(実際にこれで効かなかった)。 */
 grid.style.setProperty('--row-gap',v);
 grid.style.setProperty('--row-pad-y',v);
}
async function saveRowGap(step){
 applyRowGap(step);
 const target=listLayoutTarget();if(!target)return;
 try{
  await api('/api/list-view-master',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(withUserId({target,rowGap:rowGapValue}))});
 }catch(e){showToast&&showToast('行間を保存できませんでした',e.message,5000)}
}
async function loadRowGap(){
 const target=listLayoutTarget();if(!target)return;
 try{
  const r=await api('/api/list-view-master?target='+encodeURIComponent(target));
  applyRowGap(r.rowGap);
  const el=document.querySelector('#listRowGap');if(el)el.value=String(rowGapValue);
 }catch(e){/* 読めなくても既定の密度で出す(fail-open) */}
}
WL.rowGap={apply:applyRowGap,save:saveRowGap,load:loadRowGap,value:()=>rowGapValue};

/* ---------- 見出しの操作: 列の並べ替えと列幅(§9.88) ----------
   よく使う操作は設定画面を開かずに表の上で完結させる。**離した時点で保存**し、
   確認は出さない(すぐ元に戻せる操作なので、確認は邪魔になるだけ)。
   保存するのは「今見えている並び」ではなく**許可された全列の並び**。
   見えている分だけ保存すると、非表示にしていた列の位置が失われる。 */
function bindColumnHeaderTools(table,target,visibleColumns,allColumns){
 if(!target)return;
 const layout=WL.columnLayout.get(target);
 const heads=[...table.querySelectorAll('th[data-sort-col]')];

 /* 覚えている並びを、許可された全列に対して作り直す。 */
 const fullOrder=()=>{
  const known=(layout.order||[]).filter(c=>allColumns.includes(c));
  return [...known,...allColumns.filter(c=>!known.includes(c))];
 };
 /* 保存は全置換なので、**触っていない設定も一緒に送る**こと。
    並びだけを送ると、表示名や書式が黙って消える(全置換で行ごと作り直すため)。 */
 const persist=async(order,widths)=>{
  try{
   await WL.columnLayout.save(target,{order,widths:widths||layout.widths,hidden:layout.hidden,
                                      names:layout.names,formats:layout.formats});
   showToast&&showToast('表示の並びを保存しました','この一覧を次に開いたときも同じ並びで出ます',2400);
  }catch(e){showToast&&showToast('並びを保存できませんでした',e.message,5000)}
 };

 // ---- 並べ替え(ヘッダーを掴んで左右へ) ----
 let dragCol=null;
 heads.forEach(th=>{
  th.addEventListener('dragstart',e=>{
   dragCol=th.dataset.sortCol;th.classList.add('col-dragging');
   try{e.dataTransfer.setData('text/plain',dragCol);e.dataTransfer.effectAllowed='move'}catch(_){}
  });
  th.addEventListener('dragend',()=>{
   dragCol=null;th.classList.remove('col-dragging');
   heads.forEach(x=>x.classList.remove('col-drop-before','col-drop-after'));
  });
  th.addEventListener('dragover',e=>{
   if(!dragCol||th.dataset.sortCol===dragCol)return;
   e.preventDefault();
   // 掴んだ列を、この列の左右どちらへ落とすかを線で見せる
   const r=th.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
   th.classList.toggle('col-drop-after',after);
   th.classList.toggle('col-drop-before',!after);
  });
  th.addEventListener('dragleave',()=>th.classList.remove('col-drop-before','col-drop-after'));
  th.addEventListener('drop',e=>{
   if(!dragCol||th.dataset.sortCol===dragCol)return;
   e.preventDefault();e.stopPropagation();
   const to=th.dataset.sortCol;
   const r=th.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
   const order=fullOrder();
   const from=order.indexOf(dragCol);if(from<0)return;
   order.splice(from,1);
   let at=order.indexOf(to);if(at<0)return;
   order.splice(after?at+1:at,0,dragCol);
   layout.order=order;
   persist(order);
   renderGrid();
  });
 });

 // ---- 列幅(右端の取っ手を引く) ----
 heads.forEach(th=>{
  const grip=th.querySelector('.col-resize');if(!grip)return;
  const col=th.dataset.sortCol;
  grip.addEventListener('mousedown',e=>{
   e.preventDefault();e.stopPropagation();     // 並び替え・ドラッグへ渡さない
   const cg=table.querySelector('colgroup');
   const lead=cg?cg.children.length-visibleColumns.length-((table.querySelector('.measurement-action-head'))?1:0):0;
   const target2=cg?cg.children[lead+visibleColumns.indexOf(col)]:null;
   const startX=e.clientX,startW=th.getBoundingClientRect().width;
   const move=ev=>{
    const w=Math.max(40,Math.min(900,Math.round(startW+(ev.clientX-startX))));
    if(target2)target2.style.width=w+'px';
    th.dataset.resizing=String(w);
   };
   const up=()=>{
    document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
    const w=Number(th.dataset.resizing||0);delete th.dataset.resizing;
    if(!w)return;
    const widths={...(layout.widths||{}),[col]:w};
    layout.widths=widths;persist(fullOrder(),widths);
   };
   document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
  });
  // ダブルクリックで既定(内容なり)へ戻す
  grip.addEventListener('dblclick',e=>{
   e.preventDefault();e.stopPropagation();
   const widths={...(layout.widths||{})};delete widths[col];
   layout.widths=widths;persist(fullOrder(),widths);renderGrid();
  });
  grip.addEventListener('click',e=>{e.stopPropagation()});   // 並び替えを誘発しない
 });
}
WL.bindColumnHeaderTools=bindColumnHeaderTools;

/* 「一覧を見る」のボタンを、データソースマスタの内容そのままに組み直す(§9.87)。
   ------------------------------------------------------------
   **左メニューはカタログが唯一の正**。以前はindex.htmlに仕掛・品質データの
   ボタンを直接置き、カタログには「無ければ足す」だけをしていた。そのため
   マスタでキーを変えると、
     ・古いキーの静的ボタンが残る(押すと「データベース指定が不正です」)
     ・マスタの行から作られたボタンが別に増える(同じ名前が2つ並ぶ)
   という状態になった(実機で発生、再現済み)。**消す処理が無いのが原因**
   なので、毎回この関数が全部作り直す。
   マスタ(role='master')は出さない。生テーブルの閲覧は「マスタ管理」画面の
   「テーブル生データ」タブへ統合済みで、入口を1つに絞ってあるため
   (S.catalogには残るので databaseLabel()/selectDb('MASTER') は動く)。 */
const DB_NAV_ICONS={
 /* 役割で選ぶ。キーの綴りに依存させない。 */
 work:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
 quality:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
 other:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
};
function renderDbNav(){
 const nav=$('#nav');if(!nav)return;
 const views=WL.dataSource.views();
 const wanted=new Set(views.map(x=>x.key));
 // カタログに無いボタンは消す。**これが無いと重複と「不正です」が残る。**
 nav.querySelectorAll('[data-db-key]').forEach(b=>{
  if(!wanted.has(b.dataset.dbKey))b.remove();
 });
 // 並べる基準はグループ見出し。その直後から順に置く。
 let prev=nav.querySelector('.nav-group-label')||null;
 views.forEach(x=>{
  let b=nav.querySelector(`[data-db-key="${CSS.escape(x.key)}"]`);
  if(!b){
   b=document.createElement('button');b.type='button';b.dataset.dbKey=x.key;
   b.className='db nav-item nav-item--view';
   b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"></svg><span></span>';
  }
  const icon=WL.dataSource.isWork(x.key)?DB_NAV_ICONS.work
            :WL.dataSource.isQuality(x.key)?DB_NAV_ICONS.quality:DB_NAV_ICONS.other;
  const svg=b.querySelector('.nav-icon');if(svg)svg.innerHTML=icon;
  (b.querySelector('span')||b).textContent=x.label;
  b.title=`${x.label}（キー: ${x.key} / ファイル: ${x.file_name||'—'}）`;
  b.onclick=()=>selectDb(x.key,b);
  // マスタの表示順どおりに並べ直す(行を入れ替えたら画面もその順になる)。
  if(prev)prev.after(b);else nav.prepend(b);
  prev=b;
 });
 return views.length;
}
// 新しく公開するものは名前空間へ入れる(CLAUDE.md「window.*への新規公開」)。
WL.renderDbNav=renderDbNav;

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
/* この一覧の列レイアウト(並び・幅・表示)を覚えておくスコープ(§9.88)。
   モードで分けない——同じ表を見ているのに並びが変わると混乱するため。 */
function listLayoutTarget(){return (S.db&&S.table)?`list:${S.db}:${S.table}`:''}

async function fetchTableData(key,force){
 // 列レイアウトは描画時に同期で参照するので、取得と一緒に用意しておく
 // (読めなくても既定の並びで一覧は出る)。
 try{await WL.columnLayout.load(listLayoutTarget())}catch(e){}
 try{await loadRowGap()}catch(e){}
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
 // スケジュールモードの作業対象一覧のみ、品質データを結合して表示する
 // (§9.21)。通常の閲覧では付けない(オプトインで単独表示に影響を与えない)。
 // どちらが作業対象/品質かはデータソースマスタの役割で決まる(§9.87)。
 if(WL.dataSource.isWork(S.db)&&window.accessMode?.mode==='schedule')q.set('join_quality','1');
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
    する。「測定」列(測定画面を開く)は**役割が「作業」のデータソース**専用。
    「予定」列(スケジュールへ追加、§9.5)も同じで、スケジュールモードの
    ときだけ出す(押せないボタンを他モードで見せない)。判定はキーの文字列
    ではなくデータソースマスタの役割で行う(§9.87)。 */
 const isWork=WL.dataSource.isWork(S.db),hasLotDsp=WL.dataSource.hasLot(S.db);
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
 const allowed=columnAllowlist?S.columns.filter(c=>columnAllowlist.includes(c)):S.columns;
 // 利用者が決めた並び・非表示を重ねる(§9.88)。記録に無い列は末尾へ回るので、
 // データ側の項目が増えても設定は壊れない。
 const layoutTarget=listLayoutTarget();
 const visibleColumns=WL.columnLayout.apply(layoutTarget,allowed);
 // 予定追加ボタン(+予定)は多数の列を横に比較しながら選ぶ運用(§9.5)のため
 // 毎回右端までスクロールさせないよう、選択チェックボックスと並べて最左列へ
 // 置く(§9.15改訂。以前は最右列だった)。
 /* 書式(§9.88 段3)は列ごとに1度だけ引いて、セルの描画で使い回す。
    数値の書式を当てた列は**列ごと**右づめにする(桁を縦に揃えて読むため)。
    値ごとに決めると、数値として読めない値が1つ混ざった列で揃い方が乱れる。 */
 const colFmt=new Map(visibleColumns.map(c=>[c,WL.columnLayout.format(layoutTarget,c)]));
 const numCol=c=>colFmt.get(c)?.kind==='number';
 const t=document.createElement('table');
 t.innerHTML='<thead><tr>'+(canPlan?'<th class="plan-select-head"><input type="checkbox" id="planSelectAll" title="このページの全行を選択/解除"></th><th class="plan-action-head">予定</th>':'')+'<th>#</th>'+(isWork?'<th class="split-flag-head" title="親子管理_子カード／コンマ5本分割_切断巾に実データがある場合「分割あり」と表示します">分割</th>':'')+visibleColumns.map(c=>{
  const filtered=filteredCols.has(c),sorted=S.sortColumn===c,arrow=sorted?(S.sortDir==='desc'?' ▼':' ▲'):'';
  /* 見出しは3役: クリックで並び替え / 掴んで左右へ動かすと列の並べ替え /
     右端の取っ手を引くと列幅。**取っ手はクリックを飲み込む**(引くつもりが
     並び替わると操作を取り消せない)。 */
  return `<th class="sortable-col ${numCol(c)?'col-num':''} ${filtered?'col-filtered':''} ${sorted?'col-sorted':''}" data-sort-col="${esc(c)}" draggable="true" tabindex="0" role="button" aria-label="${esc(WL.columnLayout.label(layoutTarget,c))}列で並び替え" title="${esc(c)}｜クリックで並び替え／ドラッグで列の入れ替え${filtered?'（絞り込み中の列です）':''}">${esc(WL.columnLayout.label(layoutTarget,c))}${arrow}${filtered?'<i class="col-filter-badge" aria-hidden="true" title="この列にフィルタが適用されています">▼</i>':''}<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></th>`;
 }).join('')+(isWork?'<th class="measurement-action-head">測定</th>':'')+'</tr></thead>';
 // 幅はcolgroupで与える。thへ直接書くと、セル側の内容で押し広げられる。
 if(visibleColumns.length){
  const lead=(canPlan?2:0)+1+(isWork?1:0);       // 選択/予定 + # + 分割
  const cg=document.createElement('colgroup');
  for(let i=0;i<lead;i++)cg.appendChild(document.createElement('col'));
  visibleColumns.forEach(c=>{
   const col=document.createElement('col');
   const w=WL.columnLayout.width(layoutTarget,c);
   if(w)col.style.width=w+'px';
   cg.appendChild(col);
  });
  if(isWork)cg.appendChild(document.createElement('col'));
  t.insertBefore(cg,t.firstChild);
 }
 bindColumnHeaderTools(t,layoutTarget,visibleColumns,allowed);
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
   /* 書式(§9.88 段3)を通してから出す。整形できない値は生のまま出るので、
      書式の指定を間違えても値が消えることはない。 */
   const shown=WL.cellFormat.value(colFmt.get(c),r[c]);
   const raw=String(r[c]==null?'':r[c]);
   return `<td${numCol(c)?' class="col-num"':''}${shown!==raw?` title="${esc(raw)}"`:''}>${esc(shown)}</td>`;
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
  /* 行間(§9.88)は**動かした瞬間に反映**する。数値を入れて確定させる形にすると、
     どの値が自分に合うのかを試せない(見て決めるものなので、見ながら動かす)。
     保存は離した時点で1回だけ(動かしている間ずっと書きに行かない)。 */
  bar.innerHTML=`<button type="button" id="listColumnBtn" class="list-toolbar-btn" title="この一覧に表示する列を選びます">☰ 表示列</button>
   <label class="list-rowgap" title="行の間隔を変えます（この一覧ごとに覚えます）"><span>行間</span>
    <input type="range" id="listRowGap" min="1" max="5" step="1" value="3" aria-label="行の間隔"></label>
   <span class="list-join-chip" id="listJoinChip" hidden></span>`;
  grid.parentNode.insertBefore(bar,grid);
  /* 列の設定はこの一覧の設定パネルへ集約する(§9.88 段2)。名前・並び・幅・
     表示を1箇所で決められるので、ボタンの行き先もここ1つでよい。 */
  bar.querySelector('#listColumnBtn').onclick=()=>WL.listColumns?.toggle();
  const gap=bar.querySelector('#listRowGap');
  gap.addEventListener('input',()=>applyRowGap(Number(gap.value)));
  gap.addEventListener('change',()=>saveRowGap(Number(gap.value)));
  // ツールバーは描き直されることがある。作った直後に今の値を入れておかないと
  // 見た目(既定)と実際の行間がずれる。
  gap.value=String(rowGapValue);applyRowGap(rowGapValue);
 }else if(bar.nextElementSibling!==grid){
  // #gridが別の親(分割/ポップアップ)へ移動したら追従させる。
  grid.parentNode.insertBefore(bar,grid);
 }
 return bar;
}
function renderListToolbar(){
 const bar=ensureListToolbar();if(!bar)return;
 // 読み込んだ行間を毎回反映する(一覧を切り替えるとスコープごと変わる)。
 const gapEl=bar.querySelector('#listRowGap');
 if(gapEl){gapEl.value=String(rowGapValue);applyRowGap(rowGapValue)}
 // 表示列の選択は、設備ごとの設定を持つスケジュールモードの仕掛一覧でのみ扱う。
 // 列の設定はどの一覧でも使える(§9.88)。以前はスケジュールモードの
 // 仕掛一覧だけだったが、並び・幅・表示名はどの一覧でも要る。
 const canPickColumns=!!(S.db&&S.table);
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
/* ---------- RNE抽出の実行と進捗表示（§9.78） ----------
   抽出は数十秒かかる背景処理。画面は覆わず(操作を止めない)、ヘッダーの下に
   細い進捗帯を出す。**終わったジョブ数で数える**ので、バーは実際の進み方を
   表す(backend/rne_scheduler.py が実行中でも jobs[] を更新する)。
   ポーリングは1秒間隔。取りこぼしても最後に必ず状態を読み直して締める。 */
window.WL=window.WL||{};
WL.rne=(()=>{
 const POLL_MS=1000, MAX_WAIT_MS=10*60*1000;
 const el=id=>document.getElementById(id);
 const status=()=>api('/api/rne-extract/status');
 function show(on){const b=el('rneProgress');if(b)b.hidden=!on}
 function paint(st,note){
  const jobs=st?.jobs||[];
  const done=jobs.filter(j=>j&&j.running===false).length;
  const total=jobs.length||1;
  const pct=Math.min(100,Math.round(done/total*100));
  const bar=el('rneProgressBar'),fill=bar?.querySelector('i');
  if(fill)fill.style.setProperty('--rne-pct',pct+'%');
  if(bar)bar.setAttribute('aria-valuenow',String(pct));
  const p=el('rneProgressPct');if(p)p.textContent=pct+'%';
  const t=el('rneProgressTitle');
  if(t)t.textContent=note||`RNEファイルから作成しています（${done}/${jobs.length||'?'}）`;
  const box=el('rneProgressJobs');
  if(box)box.innerHTML=jobs.map(j=>{
   const cls=j.running?'is-running':(j.ok?'is-ok':'is-ng');
   const mark=j.running?'…':(j.ok?'✓':'×');
   const detail=j.running?'抽出中':(j.ok?`${j.rows??'-'}行`:(j.error||'失敗'));
   return `<span class="rne-job ${cls}"><b>${mark}</b>${esc(j.name)} <small>${esc(String(detail))}</small></span>`;
  }).join('');
 }
 async function runWithProgress(){
  show(true);paint({jobs:[]},'抽出を開始しています');
  try{
   await api('/api/rne-extract/run',{method:'POST'});
  }catch(e){
   show(false);showToast?.('RNEからの作成を開始できませんでした',e.message,7000);return false;
  }
  const until=Date.now()+MAX_WAIT_MS;
  let last=null;
  while(Date.now()<until){
   await new Promise(r=>setTimeout(r,POLL_MS));
   try{last=await status()}catch(_){continue}
   paint(last);
   if(!last.running)break;
  }
  // 実行中フラグが立つ前に1周目を読むことがあるので、最後にもう一度締める。
  try{last=await status();paint(last)}catch(_){}
  const jobs=last?.jobs||[];
  const ng=jobs.filter(j=>j&&j.running===false&&!j.ok);
  if(ng.length){
   showToast?.('RNEからの作成に失敗しました',ng.map(j=>`${j.name}: ${j.error}`).join(' / '),9000);
  }else{
   showToast?.('RNEファイルから作成しました',
     jobs.map(j=>`${j.name} ${j.rows??'-'}行`).join(' / '),4200);
  }
  setTimeout(()=>show(false),1200);   // 100%を一瞬見せてから畳む
  return !ng.length;
 }
 return {status,runWithProgress};
})();

/* ---------- 再読込（読み直し方を選ぶ、§9.78） ----------
   仕掛・品質データは「共有にある元データを取り直す」だけでなく、
   RNE(Navigator問い合わせ定義)から作り直すこともできる。以前は後者への
   入口がマスタ管理 > パス設定の中にしか無く、一覧を見ている人からは
   辿り着けなかった。モードバッジ・表示サイズと同じポップオーバーで
   「どちらをするか」を選ばせる(押す前に選択肢が見える形に揃える)。 */
/* RNEから作り直せるのは、抽出定義(RNEファイル)を持つデータソース。
   キーで決め打ちしない(§9.87)。 */
function rneTargetDbs(){return WL.dataSource.views().map(x=>x.key)}
/* 「再読込」は、**共有からの写しを取り直してから**読み直す(§9.89)。
   画面が読んでいるのは手元の写しなので、写しを更新せずに読み直しても
   同じ内容が出るだけ。押した人の期待(最新が見たい)と食い違う。
   写しの更新は共有への往復を伴うので待つが、失敗しても読み直しは行う
   (共有が不調でも、手元の写しで一覧は出る)。 */
async function reloadList(){
 try{await api('/api/db-mirror/refresh',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({wait:true})})}
 catch(e){console.warn('共有からの写しを更新できませんでした',e)}
 invalidateTableCache();load(true);
}

function closeReloadMenu(){
 document.getElementById('reloadMenu')?.remove();
 $('#reload')?.setAttribute('aria-expanded','false');
 document.removeEventListener('click',onReloadOutside,true);
}
function onReloadOutside(e){
 const menu=document.getElementById('reloadMenu');
 if(menu&&!menu.contains(e.target)&&!e.target.closest('#reload'))closeReloadMenu();
}
async function openReloadMenu(anchor){
 closeReloadMenu();
 const menu=document.createElement('div');
 menu.className='access-mode-menu reload-menu';menu.id='reloadMenu';
 menu.innerHTML=`<button type="button" data-reload-action="list">`
  +`<span>一覧を再読込</span><small>いま読んでいる場所から取り直します</small></button>`;
 document.body.append(menu);
 // 位置の決め方はモードバッジ・表示サイズのポップオーバーと同じ(base.js)。
 const place=()=>{
  const r=anchor.getBoundingClientRect();
  menu.style.top=`${r.bottom+6}px`;
  menu.style.left=`${Math.max(8,r.right-menu.offsetWidth)}px`;
 };
 place();
 menu.querySelector('[data-reload-action="list"]').onclick=()=>{closeReloadMenu();reloadList()};
 $('#reload').setAttribute('aria-expanded','true');
 requestAnimationFrame(()=>document.addEventListener('click',onReloadOutside,true));

 /* RNEからの作成は、この一覧が対象で、かつ抽出資材が置いてある端末だけ。
    出せない理由がある場合も**黙って隠さず**、無効の項目として理由を出す
    (「あるはずの機能が無い」と探させないため)。 */
 if(!rneTargetDbs().includes(S.db))return;
 const btn=document.createElement('button');
 btn.type='button';btn.dataset.reloadAction='rne';
 btn.innerHTML='<span>RNEファイルから作成して再読込</span><small>確認しています…</small>';
 btn.disabled=true;menu.append(btn);place();
 let st=null;
 try{st=await WL.rne.status()}catch(e){st=null}
 if(!document.getElementById('reloadMenu'))return;     // 待っている間に閉じられた
 const small=btn.querySelector('small');
 if(!st){small.textContent='抽出の状態を確認できませんでした';return}
 if(st.running){small.textContent='いま抽出中です。完了までお待ちください';return}
 if(!st.canRun){
  const miss=(st.assets?.rneMissing||[]).join(' / ');
  small.textContent=miss?`抽出定義が未配置です（${miss}）`:'接続情報(symnavim.conf)が未配置です';
  return;
 }
 btn.disabled=false;
 small.textContent='Navigatorから抽出し直してから読み込みます（数十秒）';
 btn.onclick=async()=>{closeReloadMenu();await WL.rne.runWithProgress();reloadList()};
}
$('#reload').onclick=e=>{
 if(document.getElementById('reloadMenu')){closeReloadMenu();return}
 openReloadMenu(e.currentTarget);
};
$('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};
$('#next').onclick=()=>{S.page++;load()};
