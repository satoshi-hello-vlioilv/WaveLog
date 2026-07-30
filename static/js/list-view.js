"use strict";
/* list-view.js: 起動処理・DB/テーブル選択・一覧グリッド(仕掛一覧/品質データ)。 */
async function init(){
 try{
 const build=await api('/api/build');document.title='測定伝送システム';
 document.querySelectorAll('.build-badge').forEach(badge=>{
  badge.textContent=build.version?`VER${build.version}`:'バージョン不明';
  badge.title=(build.commit?`コミット: ${build.commit}${build.commit_at?' / '+new Date(build.commit_at).toLocaleString('ja-JP'):''}${build.dirty?'（未コミットの変更あり）':''} / `:'')+'クリックで更新履歴を表示';
  badge.classList.add('build-badge-clickable');
  badge.onclick=openChangelog;
 });
 const d=await api('/api/catalog');S.catalog=d.databases;
 const nav=$('#nav'),adminNav=$('#adminNav'),maintBtn=$('#openMasterMaint');
 d.databases.forEach(x=>{
  /* 置き場所はroleで決める。読み取り専用の業務データ(仕掛・品質データ)は
     「一覧を見る」、マスタは編集画面(マスタ管理)と並べて「管理」へ入れる。
     以前は全て「表示切替」へ入れていたため、性質の違う一覧と分析ビューが
     混在し、「マスタ」と「マスタ管理」も別グループに離れて紛らわしかった。 */
  const master=x.role==='master',host=master?adminNav:nav;
  let b=document.querySelector(`aside [data-db-key="${x.key}"]`);
  if(!b){
   b=document.createElement('button');b.type='button';b.dataset.dbKey=x.key;
   /* 静的に置いてある兄弟(仕掛・品質データ)と見た目を揃えるためアイコンを付ける。 */
   b.innerHTML='<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg><span></span>';
   b.className='db nav-item '+(master?'nav-item--admin':'nav-item--view');
   if(master&&maintBtn)host?.insertBefore(b,maintBtn);else host?.append(b);
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
async function load(){
 const label=databaseLabel(S.db),table=S.table||'テーブル';
 if($('#saveOverlay').hidden){showWaiting(`${label}を更新しています`,`テーブル: ${table}`,'検索条件を反映して一覧データを取得しています');await nextPaint()}
 try{
  const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,page_size:$('#pageSize').value,search:$('#search').value});const d=await api('/api/table?'+q);Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});const info=S.catalog.find(x=>x.key===S.db);$('#fileName').textContent=info.file_name;$('#tableName').textContent=S.table;renderGrid();
 }finally{hideSaveOverlay()}
}
/* データベース切替→テーブル選択は、実際に目視できる2段階で待機表示する
   (テーブル構成の確認→列情報・一覧データの取得)。以前は3段階だったが、
   ステップ間に描画の猶予(nextPaint)を与えていない箇所があり、中間の
   ステップが一度も画面に表示されないまま次のステップへ上書きされていた。 */
async function selectDb(k,b){
 const label=databaseLabel(k);showWaiting(`${label}へ切り替えています`,`接続先を確認しています: ${label}`,'テーブル構成を確認しています',1);await nextPaint();
 try{S.db=k;setActiveNav(k);const result=await api(`/api/tables?db=${encodeURIComponent(k)}`);S.tables=result.tables;renderTabs();if(S.tables.length)await selectTable(S.tables[0]);else $('#grid').textContent='表示可能なテーブルがありません。'}catch(e){$('#grid').innerHTML=`<div class="load-error"><b>${esc(label)}を開けませんでした</b><span>${esc(e.message)}</span></div>`;throw e}finally{hideSaveOverlay()}
}
async function selectTable(t){
 S.table=t;S.page=1;S.sortColumn=null;S.sortDir=null;renderTabs();const label=databaseLabel(S.db);
 if($('#saveOverlay').hidden){showWaiting(`${label}を読み込んでいます`,`テーブル: ${t}`,'列情報と一覧データを取得しています');await nextPaint()}
 else{updateWaiting(`テーブル: ${t}`,'列情報と一覧データを取得しています',2);await nextPaint()}
 try{await load()}finally{hideSaveOverlay()}
}
/* 一覧の列名は仕掛先DBの生カラム名なので、aliasesの候補名のうち
   実際にS.columnsへ含まれているものを探してロット番号・鋳造番号の
   列を特定する(見つからなければ通常表示のまま)。 */
function findColumnFor(key){return (aliases[key]||[]).find(n=>S.columns.includes(n))||null}
// Add an explicit virtual action column instead of writing into the last data column.
function renderGrid(){
 /* ロット問い合わせ(LotDsp)は仕掛一覧・品質データのどちらでも使えるように
    する。「測定」列(測定画面を開く)は仕掛一覧(SIKALOTNOW)専用のまま。 */
 const isWork=S.db==='SIKALOTNOW',hasLotDsp=S.db==='SIKALOTNOW'||S.db==='SIKALOTDEF';
 const lotCol=hasLotDsp?findColumnFor('lotNo'):null,castCol=hasLotDsp?findColumnFor('castingNo'):null;
 const filteredCols=new Set((S.genericFilters||[]).map(f=>f.column));
 const t=document.createElement('table');
 t.innerHTML='<thead><tr><th>#</th>'+(isWork?'<th class="split-flag-head" title="親子管理_子カード／コンマ5本分割_切断巾に実データがある場合「分割あり」と表示します">分割</th>':'')+S.columns.map(c=>{
  const filtered=filteredCols.has(c),sorted=S.sortColumn===c,arrow=sorted?(S.sortDir==='desc'?' ▼':' ▲'):'';
  return `<th class="sortable-col ${filtered?'col-filtered':''} ${sorted?'col-sorted':''}" data-sort-col="${esc(c)}" title="クリックで並び替え${filtered?'（絞り込み中の列です）':''}">${esc(c)}${arrow}${filtered?'<i class="col-filter-badge" aria-hidden="true" title="この列にフィルタが適用されています">▼</i>':''}</th>`;
 }).join('')+(isWork?'<th class="measurement-action-head">測定</th>':'')+'</tr></thead>';
 t.querySelectorAll('th[data-sort-col]').forEach(th=>th.onclick=()=>{
  const col=th.dataset.sortCol;
  S.sortDir=(S.sortColumn===col&&S.sortDir==='asc')?'desc':'asc';
  S.sortColumn=col;S.page=1;load();
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
 S.rows.forEach((r,i)=>{
  const tr=document.createElement('tr');
  let splitCell='';
  if(isWork){
   const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(r):{hasSplit:false};
   if(info.hasSplit){
    const patternShort=info.widthPattern==='same'?'同幅':info.widthPattern==='different'?'異幅':'';
    const patternFull=info.widthPattern==='same'?'同一幅分割':info.widthPattern==='different'?'異幅分割':'幅パターン不明';
    splitCell=`<td class="split-flag-cell split-yes" title="推定${info.lotCount}ロットへの分割・${patternFull}(実際の子ロット数・幅は測定画面で確定します)">分割あり(${info.lotCount})${patternShort?'・'+patternShort:''}</td>`;
    splitCheckTargets.push({tr,row:r});
   }else{
    splitCell='<td class="split-flag-cell split-no">分割なし</td>';
    if(typeof window.isChildCardClassifiedRow==='function'&&window.isChildCardClassifiedRow(r))parentCheckTargets.push({tr,row:r});
   }
  }
  tr.innerHTML=`<td>${(S.page-1)*+$('#pageSize').value+i+1}</td>`+splitCell+S.columns.map(c=>{
   if(c===lotCol){const lotVal=r[c];return `<td class="lot-cell"><button type="button" class="lot-dsp-link grid-lot-link" title="クリックでLotDspをこのロット番号で開きます">${esc(lotVal)||'—'}</button></td>`}
   return `<td>${esc(r[c])}</td>`;
  }).join('')+(isWork?'<td class="measurement-action-cell"><button type="button" class="measurement-action-button">開く</button></td>':'');
  if(r===S.selectedRow)tr.classList.add('is-selected');
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
  if(hasLotDsp){
   const lotBtn=tr.querySelector('.grid-lot-link');
   if(lotBtn)lotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(pick(r,'lotNo'),castCol?r[castCol]:pick(r,'castingNo'),localStorage.getItem('LotDspLastTabV1')||'1')};
  }
  b.append(tr);
 });
 t.append(b);$('#grid').replaceChildren(t);$('#count').textContent=`全 ${S.count.toLocaleString()}件`;$('#page').textContent=`${S.page}ページ`;$('#prev').disabled=S.page===1;$('#next').disabled=S.page*+$('#pageSize').value>=S.count;
 checkSplitRowsForMissingChildren(splitCheckTargets);
 checkParentLookupRows(parentCheckTargets);
}
/* 分割あり行について、子ロットが仕掛に実在するかを確認し、見つからなければ
   グリッド上で気づける表示(⚠子ロット未検出)に切り替える。1行ごとに問い合わせが
   発生するため、同時実行数を絞って一覧の応答性・Access接続への負荷を抑える。 */
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
 runLimited(targets,3,async({tr,row})=>{
  const info=await window.findMissingChildLots(row);
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
 runLimited(targets,3,async({tr,row})=>{
  const parent=await window.findParentLotFor(row);
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
$('#reload').onclick=()=>load();
$('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};
$('#next').onclick=()=>{S.page++;load()};
