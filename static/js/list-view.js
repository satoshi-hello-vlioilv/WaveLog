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
 const nav=$('#nav');
 d.databases.forEach(x=>{
  let b=nav?.querySelector(`[data-db-key="${x.key}"]`);
  if(!b){b=document.createElement('button');b.type='button';b.className='db nav-item nav-item--view';b.dataset.dbKey=x.key;b.innerHTML='<span></span>';nav?.append(b)}
  (b.querySelector('span')||b).textContent=x.label;b.onclick=()=>selectDb(x.key,b);
 });
 const drafts=$('#homeDrafts');if(drafts)drafts.onclick=()=>openRecords('編集中');
 bindAppSettingsControls();await refreshDraftCount();showQuota();
 // 起動直後の初期画面は仕掛一覧(SIKALOTNOW)を既定表示とする。
 const initialDbBtn=nav?.querySelector('[data-db-key="SIKALOTNOW"]');
 if(initialDbBtn){try{await selectDb('SIKALOTNOW',initialDbBtn)}catch(e){console.warn('初期表示(仕掛一覧)の読み込みに失敗しました',e)}}
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
async function selectDb(k,b){
 const label=databaseLabel(k);showWaiting(`${label}へ切り替えています`,`接続先を確認しています: ${label}`,'1/3 データベースのテーブル構成を取得しています');await nextPaint();
 try{S.db=k;document.querySelectorAll('.db').forEach(x=>x.classList.remove('active'));b.classList.add('active');const result=await api(`/api/tables?db=${encodeURIComponent(k)}`);S.tables=result.tables;updateWaiting(`${label}の表示対象を確認中`,'2/3 表示可能なテーブルを整理しています');renderTabs();if(S.tables.length)await selectTable(S.tables[0]);else $('#grid').textContent='表示可能なテーブルがありません。'}catch(e){$('#grid').innerHTML=`<div class="load-error"><b>${esc(label)}を開けませんでした</b><span>${esc(e.message)}</span></div>`;throw e}finally{hideSaveOverlay()}
}
async function selectTable(t){
 S.table=t;S.page=1;S.sortColumn=null;S.sortDir=null;renderTabs();const label=databaseLabel(S.db);showWaiting(`${label}を読み込んでいます`,`テーブル: ${t}`,'3/3 列情報と一覧データを取得しています');await nextPaint();try{await load()}finally{hideSaveOverlay()}
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
 S.rows.forEach((r,i)=>{
  const tr=document.createElement('tr');
  let splitCell='';
  if(isWork){
   const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(r):{hasSplit:false};
   if(info.hasSplit){
    const patternShort=info.widthPattern==='same'?'同幅':info.widthPattern==='different'?'異幅':'';
    const patternFull=info.widthPattern==='same'?'同一幅分割':info.widthPattern==='different'?'異幅分割':'幅パターン不明';
    splitCell=`<td class="split-flag-cell split-yes" title="推定${info.lotCount}ロットへの分割・${patternFull}(実際の子ロット数・幅は測定画面で確定します)">分割あり(${info.lotCount})${patternShort?'・'+patternShort:''}</td>`;
   }else{
    splitCell='<td class="split-flag-cell split-no">分割なし</td>';
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
}
/* 検索・ページャ。ボタンは常に最新のload実装を呼ぶ(旧実装は初期のload関数を
   参照し続ける潜在不具合があった)。 */
$('#search').oninput=()=>{clearTimeout(S.t);S.t=setTimeout(()=>{S.page=1;load()},300)};
$('#pageSize').onchange=()=>{S.page=1;load()};
$('#reload').onclick=()=>load();
$('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};
$('#next').onclick=()=>{S.page++;load()};
