/* list-view.js: 起動処理・DB/テーブル選択・一覧グリッド(仕掛一覧/品質データ)。
   **このファイルは閉じている**（§9.355・REVIEW 3-17）——外へ出す面は末尾の `WL.list`。 */
(function(){
"use strict";
async function init(){
 try{
 /* **一覧を出すまでの往復を減らす**(§9.93)。以前は
    `build → catalog → 件数バッジ → 使用量 → 一覧` と直列で、
    実測すると一覧の取得が始まるのは表示開始から631ms地点だった。
    共有フォルダ越しの実機では1往復が数百msになるため、直列に並べた数だけ
    そのまま待ち時間になる。**互いに依存しないものは束ねて投げる。**
    バージョンバッジと件数バッジは一覧の表示に必要ないので、
    待たずに進める(遅れて入っても画面は崩れない)。 */
 const catalogPromise=api('/api/catalog');
 const buildPromise=api('/api/build').catch(e=>{console.warn('版数の取得に失敗',e);return{}});
 const build=await buildPromise;document.title='測定伝送システム';
 /* **更新は届いたが再起動していない**ことを画面に出す(§9.200)。
    JS/CSSはリクエストのたびにディスクから配られるが、Pythonはプロセス
    起動時に読み込んだきり。再起動を忘れると新しい画面が古いサーバーへ
    話しかけ、新設したAPIが404で返る（実機で報告）。原因が画面から
    分からないのがいちばんの問題なので、**気づく場所と打つ手を同じ場所に**
    出す。判定できなかった(null)ときは何も出さない——「分からない」を
    「要再起動」と同じに扱わない。 */
 const restartBox=document.getElementById('restartNeeded');
 if(restartBox){
  const need=build.restartNeeded===true;
  restartBox.hidden=!need;
  if(need){
   restartBox.innerHTML='<b>⚠ 更新が届いています</b>'
    +'<small>アプリを再起動するまで、新しい機能はサーバー側に反映されません'
    +'（保存できない・404と出る場合はこれが原因です）。</small>'
    +'<small>'+WL.RESTART_HOW+'</small>';
   restartBox.title='プログラムのファイルが、いま動いているアプリの起動より後に更新されています。';
  }
  WL.versionNotice.paint();   // 再起動待ちの間は版の知らせを伏せる（§9.515）
 }
 document.querySelectorAll('.build-badge').forEach(badge=>{
  badge.textContent=build.version?`VER${build.version}`:'バージョン不明';
  badge.title=(build.commit?`コミット: ${build.commit}${build.commit_at?' / '+new Date(build.commit_at).toLocaleString('ja-JP'):''}${build.dirty?'（未コミットの変更あり）':''} / `:'')+'クリックで更新履歴を表示';
  badge.classList.add('build-badge-clickable');
  badge.tabIndex=0;badge.setAttribute('role','button');badge.setAttribute('aria-label','更新履歴を表示');
  badge.onclick=openChangelog;
  badge.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openChangelog()}};
 });
 const d=await catalogPromise;S.catalog=d.databases;
 WL.dataSource.setCatalog(d);
 renderDbNav();
 const drafts=$('#homeDrafts');if(drafts)drafts.onclick=()=>WL.records.openRecords('編集中');
 WL.records.bindAppSettingsControls();
 /* 件数バッジと保存領域の使用量は**一覧の表示を待たせない**。どちらも
    数字が少し遅れて入るだけで、画面の組み立てには影響しない。 */
 WL.records.refreshDraftCount().catch(e=>console.warn('件数バッジの更新に失敗',e));
 WL.records.showQuota();
 /* 起動直後の初期画面。使用設備が未登録のうちは絞り込みも対象判定もできず、
    仕掛一覧を取得しても使えないため、先に設備登録へ誘導する。
    **どの一覧を最初に出すかはキーで決め打ちしない**(§9.87)。役割が「作業」の
    データソース、無ければ一覧の先頭を開く。 */
 const nav=$('#nav');
 const initialKey=WL.dataSource.workKey()||(WL.dataSource.views()[0]||{}).key||'';
 const initialDbBtn=initialKey?nav?.querySelector(`[data-db-key="${CSS.escape(initialKey)}"]`):null;
 const equipped=typeof currentConfiguredEquipment==='function'&&currentConfiguredEquipment();
 if(initialDbBtn&&equipped){try{await selectDb(initialKey,initialDbBtn)}catch(e){console.warn('初期表示(仕掛一覧)の読み込みに失敗しました',e)}}
 /* **見出しは繰り返さない**（§9.343、画面基準8）。「最初に使用設備を
    設定してください」は上の帯（`#equipmentSetupBanner`）が既に言っており、
    押すボタンもそちらにある。ここは**この場所に何が出るか**だけを言う
    ——空の器が「壊れているのか、まだ何も無いのか」を答えるのが役目。 */
 else if(!equipped)$('#grid').innerHTML='<div class="setup-first"><span>使用設備を設定すると、ここに仕掛一覧が出ます。</span></div>';
 }catch(e){console.error('初期化エラー',e);showToast('初期化の一部に失敗',e.message,8000)}
 finally{WL.records.bindV32Navigation()}
}
/* ---------- 行間(§9.88) ----------
   一覧全体の密度。列ごとの設定とは別物なので、保存先も別
   (一覧表示設定マスタ)。段階(1〜5)で持ち、実際の余白は --row-gap へ流す。
   **1本のつまみで行の高さが決まる**構造にしてあるので(§9.88 段0)、
   ここはその値を差し替えるだけで済む。 */
/* **詰める側へ寄せてある**(§9.90)。以前は 2/3/4/6/9px だったが、行の高さが
   `--ctl-h-xs(26px固定) + 余白×2 + 罫線` だったため、最密でも31pxより
   詰まらず「小さくする方向に調整できない」状態だった。行の高さを文字から
   作る形へ変えた(00-base.css)ので、ここが素直に効く。
   最密(1)で約22px、既定(3)で約28px、最疎(5)で約42px。 */
const ROW_GAP_STEPS={1:'1px',2:'2px',3:'4px',4:'7px',5:'11px'};
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
 /* いまの行間を字でも言う（§9.476・つまみの位置だけでは「どれくらいか」を推測させる）。 */
 const w=document.getElementById('listRowGapVal');if(w)w.textContent=ROW_GAP_WORDS[rowGapValue];
}
const ROW_GAP_WORDS={1:'いちばん詰める',2:'詰める',3:'ふつう',4:'広め',5:'いちばん広い'};
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
 }catch(e){WL.quiet.note('読めなくても既定の密度で出す(fail-open)',e)}
}
WL.rowGap={apply:applyRowGap,save:saveRowGap,load:loadRowGap,value:()=>rowGapValue};

/* ---------- 並び順(§9.88 段5) ----------
   複数キーで並べられるようにし、その組み合わせに名前を付けて保存する
   （「いつも使う並び」）。フィルタの登録条件とまったく同じ構成にしてある
   ——同じ形の機能は同じ操作で使えるべきで、覚えることを増やさない。

   見出しのクリックは**1キーへの置き換え**、Shift+クリックは**キーの追加**。
   既定を置き換えにしてあるのは、日々の操作のほとんどが「この列で並べたい」
   だから。2つ目以降が要る場面は少ないので、そちらに修飾キーを割り当てる。 */
const listSort=(()=>{
 let keys=[];                        // [{column,dir}] 先頭が第一キー
 const clean=list=>(Array.isArray(list)?list:[]).map(x=>({
   column:String(x&&x.column||'').trim(),
   dir:String(x&&x.dir||'').toLowerCase()==='desc'?'desc':'asc',
  })).filter((x,i,a)=>x.column&&a.findIndex(y=>y.column===x.column)===i).slice(0,4);
 return {
  keys:()=>keys.map(k=>({...k})),
  set(list){keys=clean(list)},
  clear(){keys=[]},
  dirOf:col=>(keys.find(k=>k.column===col)||{}).dir||'',
  rankOf:col=>{const i=keys.findIndex(k=>k.column===col);return i<0?0:i+1},
  /* 見出しのクリック。add=false は置き換え、add=true は追加(Shift+クリック)。
     同じ列をもう一度押したら向きが変わる。 */
  toggle(col,add){
   const at=keys.findIndex(k=>k.column===col);
   const flip=at>=0?(keys[at].dir==='asc'?'desc':'asc'):'asc';
   if(!add){keys=[{column:col,dir:flip}];return}
   if(at>=0)keys[at]={column:col,dir:flip};
   else keys=clean([...keys,{column:col,dir:'asc'}]);
  },
  remove(col){keys=keys.filter(k=>k.column!==col)},
 };
})();
WL.listSort=listSort;

/* いつも使う並びの保存・再利用。対象はフィルタと同じ「DB×テーブル×モード」。 */
const sortPresets=(()=>{
 let items=[],picked=null;
 const mode=()=>window.accessMode?.mode==='schedule'?'schedule':'';
 async function load(){
  items=[];
  if(!S.db||!S.table)return items;
  try{
   const q=new URLSearchParams({db:S.db,table:S.table,mode:mode()});
   const r=await api('/api/sort-presets?'+q);
   items=(r.items||[]).sort((a,b)=>(b.uses||0)-(a.uses||0)||a.name.localeCompare(b.name,'ja'));
  }catch(e){WL.quiet.note('読めなくても並び替えそのものは使える(fail-open)',e)}
  return items;
 }
 return {load,all:()=>items,picked:()=>picked,setPicked:v=>{picked=v},
         find:id=>items.find(x=>String(x.id)===String(id))||null,
         mode};
})();

/* 並び順のツールバー。今の並びを見せ、いつも使う並びを選び、保存する。
   選ぶ・保存する・消すは**1つのメニューの中**に置く(§9.90)。 */
function bindSortControls(bar){
 const btn=bar.querySelector('#listSortPresetBtn');
 const menu=bar.querySelector('#listSortMenu');
 if(!btn||!menu)return;
 const closeMenu=()=>{menu.hidden=true;btn.setAttribute('aria-expanded','false')};
 btn.onclick=e=>{
  e.stopPropagation();
  if(!menu.hidden){closeMenu();return}
  renderSortMenu();menu.hidden=false;btn.setAttribute('aria-expanded','true');
 };
 document.addEventListener('click',e=>{if(!menu.hidden&&!menu.contains(e.target))closeMenu()});
 menu.addEventListener('click',async e=>{
  const act=e.target.closest('[data-act]');if(!act)return;
  e.stopPropagation();
  const id=act.dataset.id||'';
  if(act.dataset.act==='use'){
   sortPresets.setPicked(id||null);
   const p=sortPresets.find(id);
   if(p){
    WL.listSort.set(p.sorts||[]);
    // 使った回数を数えて、よく使うものが上に来るようにする(フィルタと同じ)。
    api('/api/sort-presets/use',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify(withUserId({id:p.id}))}).catch(WL.quiet('並べ替えの利用回数を送れない（候補の並びが変わらないだけ）'));
   }
   closeMenu();S.page=1;renderSortBar();load();return;
  }
  if(act.dataset.act==='clear'){
   sortPresets.setPicked(null);WL.listSort.clear();
   closeMenu();S.page=1;renderSortBar();load();return;
  }
  if(act.dataset.act==='save'){closeMenu();await saveCurrentSort();return}
  if(act.dataset.act==='del'){closeMenu();await deleteSortPreset(id);return}
 });
 async function saveCurrentSort(){
  const keys=WL.listSort.keys();
  if(!keys.length){
   showToast&&showToast('保存する並び順がありません','見出しをクリックして並べ替えてから保存してください',3600);return;
  }
  const label=keys.map(k=>`${WL.columnLayout.label(listLayoutTarget(),k.column)}${k.dir==='desc'?'↓':'↑'}`).join(' → ');
  const name=await promptModal({title:'並び順に名前を付けて保存します',message:label,
   label:'並び順の名前',confirmLabel:'保存'});
  if(name===null)return;
  const nm=String(name).trim();
  if(!nm){showToast&&showToast('名前を入れてください','次に選ぶときの目印になります',3200);return}
  try{
   const r=await api('/api/sort-presets',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({name:nm,db:S.db,table:S.table,mode:sortPresets.mode(),sorts:keys}))});
   await sortPresets.load();
   sortPresets.setPicked(String(r.id||''));
   renderSortBar();
   showToast&&showToast(r.registered?'並び順を登録しました':'登録済みの並び順を更新しました',nm,2600);
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }
 async function deleteSortPreset(id){
  const p=sortPresets.find(id);
  if(!p)return;
  if(!await confirmModal({message:`並び順「${p.name}」を削除します。よろしいですか？`,danger:true}))return;
  try{
   await api('/api/sort-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(withUserId({id:p.id}))});
   await sortPresets.load();
   if(String(sortPresets.picked()||'')===String(id))sortPresets.setPicked(null);
   renderSortBar();
   showToast&&showToast('並び順を削除しました',p.name,2400);
  }catch(e){showToast&&showToast('削除に失敗しました',e.message,5000)}
 }
}

/* いつも使う並びのメニュー。**今の状態→選ぶ→作る**の順に並べる
   (フィルタの登録条件と同じ並び。同じ形の機能は同じ操作で使えるべき)。 */
function renderSortMenu(){
 const menu=document.getElementById('listSortMenu');if(!menu)return;
 const cur=String(sortPresets.picked()||'');
 const items=sortPresets.all();
 const target=listLayoutTarget();
 const now=WL.listSort.keys();
 const nowLabel=now.length
  ? now.map(k=>`${WL.columnLayout.label(target,k.column)}${k.dir==='desc'?'↓':'↑'}`).join(' → ')
  : '指定なし';
 menu.innerHTML=`
  <div class="lsm-now">今の並び<b>${esc(nowLabel)}</b></div>
  <div class="lsm-list">${items.length?items.map(p=>`
    <div class="lsm-item${String(p.id)===cur?' is-on':''}">
     <button type="button" class="lsm-use" data-act="use" data-id="${esc(String(p.id))}"
      title="${esc(p.sorts?.map(s=>WL.columnLayout.label(target,s.column)+(s.dir==='desc'?'↓':'↑')).join(' → ')||'')}">
      ${String(p.id)===cur?'●':'○'} ${esc(p.name)}</button>
     <button type="button" class="lsm-del" data-act="del" data-id="${esc(String(p.id))}" title="この並びを削除">×</button>
    </div>`).join('')
   :'<div class="lsm-empty">まだ登録がありません。見出しをクリックして並べ替えてから「今の並びを保存」を押します。</div>'}</div>
  <div class="lsm-actions">
   <button type="button" data-act="save">今の並びを保存…</button>
   <button type="button" data-act="clear"${now.length?'':' disabled'}>並びを解除</button>
  </div>`;
}

/* 今の並びを見せる。**列名ではなく表示名で出す**(§9.88 段2)——画面に出て
   いる見出しと同じ言葉でないと、どの列のことか分からない。 */
function renderSortBar(){
 const box=document.getElementById('listSort');if(!box)return;
 box.hidden=!(S.db&&S.table);
 const keys=WL.listSort.keys(),target=listLayoutTarget();
 const chips=document.getElementById('listSortKeys');
 if(chips){
  chips.innerHTML=keys.length?keys.map((k,i)=>
   `<button type="button" class="list-sort-chip" data-col="${esc(k.column)}"
     title="クリックで昇順／降順を入れ替え、×でこのキーを外します">${
     keys.length>1?`<b>${i+1}</b>`:''}${esc(WL.columnLayout.label(target,k.column))}${
     k.dir==='desc'?' ▼':' ▲'}<i class="list-sort-x" data-col="${esc(k.column)}" title="このキーを外す">×</i></button>`
  ).join(''):'<span class="list-sort-none" title="見出しをクリックすると並べ替えます。Shift+クリックで2つ目のキーを足せます。">指定なし</span>';
  chips.querySelectorAll('.list-sort-chip').forEach(el=>{
   el.onclick=e=>{
    const col=el.dataset.col;
    if(e.target.classList.contains('list-sort-x'))WL.listSort.remove(col);
    else WL.listSort.toggle(col,true);
    S.page=1;renderSortBar();load();
   };
  });
 }
 /* ボタンには**選んでいる並びの名前**を出す。何も選んでいなければ役割名。
    固定幅のselectをやめたので、長い名前でも途中で切れない(§9.90)。 */
 const btn=document.getElementById('listSortPresetBtn');
 if(btn){
  const p=sortPresets.find(sortPresets.picked());
  btn.classList.toggle('is-on',!!p);
  btn.innerHTML=p?`★ ${esc(p.name)}<i>▾</i>`:'★ いつも使う並び<i>▾</i>';
 }
 const menu=document.getElementById('listSortMenu');
 if(menu&&!menu.hidden)renderSortMenu();
}
WL.listSortBar={render:renderSortBar,presets:sortPresets};

/* ---------- 見出しの操作: 列の並べ替えと列幅(§9.88) ----------
   よく使う操作は設定画面を開かずに表の上で完結させる。**離した時点で保存**し、
   確認は出さない(すぐ元に戻せる操作なので、確認は邪魔になるだけ)。
   保存するのは「今見えている並び」ではなく**許可された全列の並び**。
   見えている分だけ保存すると、非表示にしていた列の位置が失われる。 */
/* ---------- 列幅の取っ手（表でもグリッドでも使う。§9.164） ----------
   掴む→追う→離す→保存 という手順はどの一覧でも同じで、違うのは
   **引いている最中の見せ方**だけ（表はcolgroupの`<col>`、CSSグリッドは
   トラックの組み直し）。同じ処理を一覧ごとに書き写すと、直したときに
   片方だけ直った状態になる（`compactToleranceScale`が3ファイルにあって
   真ん中が死んでいたのと同じ壊れ方）。
     locked      … 固定した列（§9.119）。取っ手は残すが掴めない
     startWidth()… 掴んだ時点の幅(px)
     preview(w)  … 引いている最中の見せ方（保存しない）
     commit(w)   … 離したときの保存
     reset()     … ダブルクリック＝自動（内容なり）へ戻す */
const GRIP_W_MIN=40,GRIP_W_MAX=900;
/* ---------- 引いている最中は邪魔をしない(§9.197、利用者の指摘) ----------
   「列幅がうまく掴めない／自由に動かせない」の原因は2つあった。
     ①掴める帯が細い（スケジュール表だけ6px。一覧・データ一覧は10px）
     ②離した瞬間に保存し、そのあいだに別の見張り（共有スケジュールの
       取り込み。10秒ごと）が表を組み直して**掴んでいた見出しごと
       入れ替わっていた**——次に掴んだときの「掴んだ時点の幅」は
       消えた要素から測るので0になり、幅が下限へ飛ぶ。
   そこで**「触っている最中か」を1箇所が答える**ようにして
   （`WL.columnResize.busy()`）、周りの自動処理はそれを見て待つ。
   保存は**離してから0.3秒落ち着いてから**にまとめる——続けて微調整した
   ときに1回で済み、引いている最中に通信が挟まらない。
   0.3秒は「1アクションの終わり」の目安（利用者の指示）。 */
const GRIP_SETTLE_MS=300;
let gripHeld=0,gripSaving=0,gripCalmUntil=0;
function gripBusy(){return gripHeld>0||gripSaving>0||Date.now()<gripCalmUntil}
/* ---------- 掴んでいる最中の自動描き直しは待たせる（§9.211 ①、利用者の指示） --
   「今動かしている列幅が正。読み込みが起こるのは初回と手動のときだけ」。
   `busy()`を見ていたのは共有スケジュールの自動再読込**1箇所だけ**で、
   表そのものを作り直す経路（全件読み終わり・結合の後追い・予定を描いた
   ついでの仕掛一覧の描き直し・データ一覧の定期同期）は素通しだった。
   表を作り直すと**取っ手が綴じ込んだ見出しごと入れ替わる**ので、
   掴んだままの手は空を切る（`startWidth()`が0を返して動かなくなる）。

   **止めるのではなく後で必ず1回走らせる**——止めると「予定へ入れたロットが
   仕掛一覧から消える」等の機能がそのまま落ちる。同じ鍵で重ねて頼まれたら
   最後の1つだけ残す（描き直しは何度やっても同じ結果なので）。 */
const gripDeferred=new Map();
let gripDeferTimer=null;
function gripRunDeferred(){
 if(gripBusy())return;
 clearInterval(gripDeferTimer);gripDeferTimer=null;
 const jobs=[...gripDeferred.values()];gripDeferred.clear();
 jobs.forEach(fn=>{try{fn()}catch(e){console.warn('列幅の操作後の描き直しに失敗',e)}});
}
function deferWhileResizing(key,fn){
 if(!gripBusy()){fn();return false}
 gripDeferred.set(key,fn);
 if(!gripDeferTimer)gripDeferTimer=setInterval(gripRunDeferred,80);
 return true;
}
/* ---------- 掴んだ側が動く（§9.208 ⑦、利用者の指摘） ----------
   「幅を狭めるとき、右端が見えていると**左側全体が近づいてくる**」。
   原因は器のスクロール位置。右端まで送った状態で列を細くすると、表が
   縮んだぶん`scrollLeft`の上限も下がり、**ブラウザが位置を切り詰める**
   ので、掴んだ縁はその場に残り、左の列だけが右へ流れる。
   直し方は2つで一組:
     ① 引いている間、`scrollLeft`を**掴んだ時点の値に固定する**
     ② そのために足りないぶんだけ、器の右へ**便宜上の余白**を置く
        （利用者の許可済み。「右端の余白が必要であれば設けても構わない」）
   余白は**必要な量だけ**にして、左へ戻れば自然に消える（`scroll`で
   はみ出しが無くなった時点で外す）——常設すると、収まっている表にまで
   意味の無い空白が付く。 */
const SPARE_CLASS='col-resize-spare',SPARE_BOUND='__wlSpareBound';
function gripScroller(el){
 for(let p=el&&el.parentElement;p;p=p.parentElement){
  const cs=getComputedStyle(p);
  if(/(auto|scroll)/.test(cs.overflowX)&&p.scrollWidth>p.clientWidth)return p;
 }
 return null;
}
/* 余白は**器の子として1枚置く**。`padding-right`では作れない——器の内側の
   幅が縮み、`fr`で組んだ行（データ一覧）は**列そのものが細くなる**ので、
   狭めた量ぶん表が縮んでしまい位置が保てない（実測でそうなった）。 */
function spareEl(sc){return sc?sc.querySelector(':scope > .'+SPARE_CLASS):null}
function spareOf(sc){const el=spareEl(sc);return el?Number(el.dataset.spare)||0:0}
function clearSpare(sc){const el=spareEl(sc);if(el)el.remove()}
function setSpare(sc,base,px){
 if(!sc)return;
 const v=Math.max(0,Math.round(px));
 if(!v){clearSpare(sc);return}
 let el=spareEl(sc);
 if(!el){
  el=document.createElement('div');
  el.className=SPARE_CLASS;el.setAttribute('aria-hidden','true');
  sc.appendChild(el);
 }
 el.dataset.spare=String(v);el.dataset.base=String(Math.round(base));
 el.style.width=Math.round(base+v)+'px';
 if(!sc[SPARE_BOUND]){
  sc[SPARE_BOUND]=true;
  /* 左へ戻って余白が要らなくなったら外す。**掴んでいる最中は外さない**
     （引いている途中で足元の余白が消えると、そこで位置が飛ぶ）。 */
  sc.addEventListener('scroll',()=>{
   if(gripHeld)return;
   const cur=spareEl(sc);if(!cur)return;
   if(sc.scrollLeft+sc.clientWidth<=(Number(cur.dataset.base)||0)+1)clearSpare(sc);
  });
 }
}
WL.columnResize={busy:gripBusy,settleMs:GRIP_SETTLE_MS,scroller:gripScroller,spare:spareOf,
                 defer:deferWhileResizing};
function bindColumnWidthGrip(grip,o){
 if(!grip||!o)return;
 /* 幅を固定した列は掴めない(§9.119)。**印は残す**——取っ手ごと消すと、
    固定しているのか壊れているのかが分からない。 */
 if(o.locked){
  grip.classList.add('is-locked');
  grip.title='この列は幅を固定しています（列の設定で解けます）';
  grip.addEventListener('mousedown',e=>{e.preventDefault();e.stopPropagation()});
  grip.addEventListener('click',e=>{e.stopPropagation()});
  return;
 }
 let saveTimer=null;
 grip.addEventListener('mousedown',e=>{
  e.preventDefault();e.stopPropagation();     // 並び替え・ドラッグへ渡さない
  /* 続けて掴んだら、前の回の保存待ちはやめる（最後の幅だけを1回送る）。 */
  clearTimeout(saveTimer);saveTimer=null;
  const startX=e.clientX;
  /* **掴んだ時点の幅は0になり得る**——表が組み直された直後は取っ手の持ち主が
     入れ替わっている。0のまま使うと幅が下限へ飛ぶので、そのときは動かさない
     （下の`w`が入らないので保存もしない）。 */
  const startW=Math.max(0,Math.round(o.startWidth()||0));
  let w=0;
  /* 掴んだ時点の横位置を覚え、細くできるぶんだけ右へ余白を確保しておく
     （§9.208 ⑦）。**掴む前に置く**——引き始めてからでは、最初の1pxで
     すでに位置が切り詰められている。 */
  const sc=gripScroller(grip),keep=sc?sc.scrollLeft:0;
  if(sc){
   /* 素の中身の幅を測ってから、細くできるぶん（下限まで）を足す。 */
   clearSpare(sc);
   setSpare(sc,sc.scrollWidth,Math.max(0,startW-GRIP_W_MIN));
   sc.scrollLeft=keep;
  }
  gripHeld++;document.body.classList.add('col-resizing');
  const move=ev=>{
   if(!startW)return;
   w=Math.max(GRIP_W_MIN,Math.min(GRIP_W_MAX,Math.round(startW+(ev.clientX-startX))));
   o.preview(w);
   /* 掴んだ側が動くように、器の横位置は**動かさない**。 */
   if(sc&&sc.scrollLeft!==keep)sc.scrollLeft=keep;
  };
  const up=()=>{
   document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
   gripHeld=Math.max(0,gripHeld-1);
   if(!gripHeld)document.body.classList.remove('col-resizing');
   /* 余白は**まだ要るぶんだけ**残す。全部外すと、離した瞬間に位置が
      切り詰められて左の列がまとめて動く（引いている間の見え方と食い違う）。 */
   if(sc){
    clearSpare(sc);
    const content=sc.scrollWidth;
    setSpare(sc,content,Math.max(0,keep+sc.clientWidth-content));
    sc.scrollLeft=keep;
   }
   /* 離してからも少しのあいだは「触っている」——ここで見張りが表を
      組み直すと、続けて隣の列を掴もうとした手が空を切る。 */
   gripCalmUntil=Date.now()+GRIP_SETTLE_MS;
   if(!w)return;
   const width=w;
   saveTimer=setTimeout(()=>{
    saveTimer=null;gripSaving++;
    Promise.resolve().then(()=>o.commit(width)).catch(WL.quiet('列幅を保存できない（画面の幅はそのまま）'))
     .then(()=>{gripSaving=Math.max(0,gripSaving-1);gripCalmUntil=Date.now()+GRIP_SETTLE_MS});
   },GRIP_SETTLE_MS);
  };
  document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
 });
 // ダブルクリックで既定(内容なり)へ戻す
 grip.addEventListener('dblclick',e=>{e.preventDefault();e.stopPropagation();o.reset()});
 grip.addEventListener('click',e=>{e.stopPropagation()});   // 並び替えを誘発しない
}
WL.columnWidthGrip=bindColumnWidthGrip;

function bindColumnHeaderTools(table,target,visibleColumns,allColumns){
 if(!target)return;
 /* ---------- 控えは束縛しない（§9.211 ①、利用者の指摘） ----------
    `save()`はキャッシュを**新しいオブジェクトへ差し替える**（§9.113）ので、
    ここで`const layout=...`と束縛すると、**1回保存した時点で写しは
    キャッシュから外れた孤児**になる。以降の並べ替え・列幅はその孤児を
    土台に全置換保存するため、あいだに別の経路（右クリックメニュー・
    設定パネル・プリセットの取り込み）で変えた設定が黙って戻る。
    **毎回`live()`で取り直すこと。** 束縛を復活させない。 */
 const live=()=>WL.columnLayout.get(target);
 /* ---------- 掴む対象は「1本の並びの全部」（§9.239 ⑤-1、利用者の指摘
    「この『分割』カラムについては幅変更ができません」） ----------
    以前はここが`th[data-sort-col]`で、**データ列にしか付いていない属性**を
    見ていた。番号・ボタンの列（`#`/`分割`/`測定`/`予定`/選択）は
    §9.106で「データ列と同じ1本の並び」に載り、§9.105で「出す/出さない」を
    持ち、右クリックのメニュー（`th[data-col]`で配線）も**幅の3つの状態を
    出していた**のに、**取っ手だけが無かった**——押せるのに何も起きない
    メニューが残っていた（§4）。並びに載っているものは全部掴める。
    **並べ替え（クリックで昇降順）だけは`th[data-sort-col]`のまま**
    ——番号・ボタンの列は値を持たないので、並べ替えの対象にならない。 */
 const heads=[...table.querySelectorAll('th[data-col]')];

 /* 覚えている並びを、許可された全列に対して作り直す。

    **数えるのは`listColumnKeys()`の1本の並び(§9.106)**——`allColumns`は
    データ列だけなので、それを基準にすると番号・ボタンの列
    (`#`/`分割`/`測定`/`予定`)が保存する並びから丸ごと落ちる。落ちると
    次に開いたとき`apply()`が「知らない列」として**末尾へ回す**ので、
    **列幅を少し引いただけで#・分割・測定が右端へ飛ぶ**(§9.110。実機で
    「列の移動が正しく反映されない」として報告された)。 */
 const fullOrder=()=>{
  const all=WL.listColumnKeys(allColumns);
  /* **いま出せない列も並びから落とさない**（§9.216 ②）。
     `listColumnKeys()`が返す顔ぶれは**場面で変わる**——`__select__`/`__plan__`は
     スケジュールモードだけ、`__split__`/`__measure__`は仕掛だけ、結合で
     足された列は結合が当たったときだけ。以前はここで`all`に無い列を
     **黙って捨てて**いたので、
       ・編集モードで見出しを1回ドラッグ → 選択・予定の列が並びから消える
         → スケジュールモードへ戻すと「知らない列」として右端へ飛ぶ（§9.110）
       ・結合が1回失敗した状態で列幅を引く → 結合列の並びが全部消える
     という形で、**触っていない設定が黙って戻る**。並べ替えに要るのは
     「掴んだ列を動かす」ことだけなので、知らない列はその場に残しておけばよい
     ——実際に描くときは`healedColumnOrder()`が今ある列へ当てはめ直す。 */
  const stored=(live().order||[]);
  const kept=stored.filter((c,i)=>stored.indexOf(c)===i);
  return [...kept,...all.filter(c=>!kept.includes(c))];
 };
 /* **触った項目だけを送る**(§9.212 ②③)。以前は全置換だったので、
    「触っていない設定も一緒に送る」必要があり、**1つでも書き漏らすと
    その設定だけが黙って消えていた**（`formulas`を渡していなかったため、
    見出しを1回ドラッグしただけで計算式の列が全部消えた・§9.113。
    `sorts`でも同じことが起きた・§9.211 ①）。今は`patch()`が
    「送ったキーだけ書く」ので、**渡さない＝そのまま残る**。
    材料は**保存済み(`WL.columnLayout.saved`)**から取ること——`get()`は
    列の設定パネルの未保存の下書きを含むので、そこから作ると
    **パネルで触っただけの内容までマスタへ入る**（§9.212 ③）。
    保存の成否は`WL.saveState`が画面へ出す（§9.212 ④）。 */
 const persist=async(order,widths,locks)=>{
  const cur=WL.columnLayout.saved(target);
  const wrote={order,widths:widths||cur.widths,locks:locks||cur.locks};
  try{
   await WL.columnLayout.patch(target,wrote);
  }catch(e){showToast&&showToast('並びを保存できませんでした',e.message,5000)}
 };

 // ---- 並べ替え(ヘッダーを掴んで左右へ) ----
 let dragCol=null;
 heads.forEach(th=>{
  th.addEventListener('dragstart',e=>{
   dragCol=th.dataset.col;th.classList.add('col-dragging');
   try{e.dataTransfer.setData('text/plain',dragCol);e.dataTransfer.effectAllowed='move'}catch(_){WL.quiet.note('掴んだ印を渡せない（押す道は残る）',_)}
  });
  th.addEventListener('dragend',()=>{
   dragCol=null;th.classList.remove('col-dragging');
   heads.forEach(x=>x.classList.remove('col-drop-before','col-drop-after'));
  });
  th.addEventListener('dragover',e=>{
   if(!dragCol||th.dataset.col===dragCol)return;
   e.preventDefault();
   // 掴んだ列を、この列の左右どちらへ落とすかを線で見せる
   const r=th.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
   th.classList.toggle('col-drop-after',after);
   th.classList.toggle('col-drop-before',!after);
  });
  th.addEventListener('dragleave',()=>th.classList.remove('col-drop-before','col-drop-after'));
  th.addEventListener('drop',e=>{
   if(!dragCol||th.dataset.col===dragCol)return;
   e.preventDefault();e.stopPropagation();
   const to=th.dataset.col;
   const r=th.getBoundingClientRect(),after=(e.clientX-r.left)>r.width/2;
   const order=fullOrder();
   const from=order.indexOf(dragCol);if(from<0)return;
   order.splice(from,1);
   let at=order.indexOf(to);if(at<0)return;
   order.splice(after?at+1:at,0,dragCol);
   /* 掴んでいる最中の見え方は`hold()`（§9.212 ③）。**保存には行かない**
      ——保存は`persist()`が「触った項目だけ」を送る。 */
   WL.columnLayout.hold(target,{order});
   persist(order).finally(()=>WL.columnLayout.release(target));
   renderGrid();
  });
 });

 // ---- 列幅(右端の取っ手を引く。手順はWL.columnWidthGripが持つ) ----
 heads.forEach(th=>{
  const grip=th.querySelector('.col-resize');if(!grip)return;
  const col=th.dataset.col;
  /* colgroupは**1本の並び(§9.106)と1対1**になったので、見出しの位置を
     そのまま使える。以前は「先頭の何列ぶんか」を数え直しており、
     番号・ボタンの出し入れで基準がずれる作りだった。 */
  /* **今そこに在る表から引く**（§9.211 ①）。表は`replaceChildren`で丸ごと
     作り直されるので、綴じ込んだ`table`/`th`は簡単に孤児になる——孤児を
     測ると幅0になり、掴んでも動かない（スケジュール表の取っ手は既に
     キーで引き直しており、そちらは再描画に耐えていた）。 */
  const liveTable=()=>table.isConnected?table:(document.querySelector('#grid table')||table);
  const liveTh=()=>liveTable().querySelector(`thead th[data-col="${CSS.escape(col)}"]`)||th;
  const colEl=()=>{
   const t=liveTable();
   const cg=t.querySelector('colgroup');
   const at=[...t.querySelectorAll('thead th')].indexOf(liveTh());
   return (cg&&at>=0)?cg.children[at]:null;
  };
  WL.columnWidthGrip(grip,{
   locked:WL.columnLayout.locked(target,col),
   startWidth:()=>liveTh().getBoundingClientRect().width,
   /* **引いている幅がそのまま「今の幅」**（利用者の指示）。見た目は
      `<col>`へ即入れ、同じ値をキャッシュへも当てておく（`stage`＝保存
      しない）——引いている最中に表が組み直されても幅が戻らない。
      **表そのものの幅も一緒に動かすこと**（§9.211 ①）。
      `renderGridInner()`は`t.style.width`へ**列幅の合計**を入れている
      （§9.119。入れないとcolgroupより見出しの文字幅が勝つ）。合計を
      据え置いたまま1列だけ細くすると、`table-layout:fixed`は
      **余ったぶんを全列へ比例配分する**ので、掴んでいない列が一斉に太り、
      次の描き直しで元へ戻る——「掴んだもの以外が詰まる／戻される」の
      正体その2。合計は毎回`<col>`から数え直す（差分を積むとずれる）。 */
   preview:w=>{
    const c=colEl();if(c)c.style.width=w+'px';
    const t=liveTable(),cg=t&&t.querySelector('colgroup');
    if(cg){
     let total=0;
     [...cg.children].forEach(x=>{total+=parseFloat(x.style.width)||0});
     if(total>0)t.style.width=total+'px';
    }
    const cur=live();
    /* 掴んでいる最中は`hold()`（§9.212 ③）。**保存済みにも下書きにも
       触らない**ので、途中の値がマスタへ行くことはない。 */
    WL.columnLayout.hold(target,{widths:{...(cur.widths||{}),[col]:w}});
   },
   commit:w=>{const widths={...(live().widths||{}),[col]:w};
              persist(fullOrder(),widths).finally(()=>WL.columnLayout.release(target))},
   reset:()=>{const widths={...(live().widths||{})};delete widths[col];
              WL.columnLayout.hold(target,{widths});
              persist(fullOrder(),widths).finally(()=>{WL.columnLayout.release(target);renderGrid()})},
  });
 });

 // ---- 右クリックで出す小さなメニュー(§9.110) ----
 /* 列を1つ隠すためだけに設定パネルを開かせない。**押した列がそこにある**
    ので、「この列を隠す」は迷いようがない。戻す操作も同じ場所へ置く
    ——隠した本人が次に探すのはここなので、「戻せる場所が別にある」と
    覚えさせない。 */
 table.querySelectorAll('thead th[data-col]').forEach(th=>{
  th.addEventListener('contextmenu',e=>{
   e.preventDefault();e.stopPropagation();
   openColumnHeaderMenu(e,th.dataset.col,target,allColumns);
  });
 });
}
WL.bindColumnHeaderTools=bindColumnHeaderTools;

/* 閉じる道は`WL.popMenu`の1本（§9.448）。外クリック・Escの配線と
   「閉じたら器を消す」は`open()`へ渡した`onClose`が受け持つ。 */
function closeColumnHeaderMenu(){
 WL.popMenu.close();
 document.querySelector('.col-head-menu')?.remove();
}
/* 幅の状態の呼び名(§9.119)。**画面の言葉を1箇所に持つ**——メニューと
   設定パネルで違う言い方をすると、同じものだと分からなくなる。 */
const WIDTH_MODE_LABEL={auto:'内容に合わせる（自動）',manual:'手で決めた幅',locked:'固定（動かさない）'};
/* 呼び名は**1箇所**。データ一覧の見出しも同じ言葉を出す（§9.164）。
   別々に書くと、同じ状態が画面によって違う言い方になる。 */
WL.columnWidthModeLabel=WIDTH_MODE_LABEL;
/* 見出しの右クリックの**差し替え口**（§9.164。§9.120の列の設定パネルと
   同じ考え方）。画面に固定されていたのは5点だけ——どの列があるか／名前／
   いまの幅／描き直し方／設定パネルの開き方。答えない口は仕掛一覧の
   ふるまいのままなので、**既定の口を渡さない呼び出しは今までどおり**。
   `persist`だけは口が持てる——データ一覧は「一度も保存していないうちは
   既定の15列」という約束があり（§9.162）、並びを初めて保存する瞬間に
   隠す列を種まきしないと、候補44列が黙って全部並ぶ。 */
function headMenuSource(target,allColumns,src){
 const o=src||{};
 return {
  keys:()=>(o.keys?o.keys():WL.listColumnKeys(allColumns)),
  label:k=>(o.label?o.label(k)
            :(WL.isVirtualColumn(k)?WL.virtualColumnLabel(k):WL.columnLayout.label(target,k))),
  currentWidthOf:k=>{
   if(o.currentWidthOf)return Math.round(Number(o.currentWidthOf(k))||0);
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(k)}"]`);
   return th?Math.round(th.getBoundingClientRect().width):0;
  },
  refresh:()=>{o.refresh?o.refresh():renderGrid()},
  openPanel:()=>{o.openPanel?o.openPanel():document.getElementById('listColumnBtn')?.click()},
  persist:o.persist||null,
  /* **いま隠している列も口が答えられる**(§9.197)。既定で出さない列がある
     表（スケジュール表の監査4列・日付(太陽暦)）では、保存値の`hidden`に
     その列が**入っていない**——既定として畳んでいるだけなので。保存値の
     ままで「この列を隠す」を保存すると、畳んでいたはずの列がそこで
     出てしまう（実際にそうなった）。 */
  hiddenOf:()=>(o.hiddenOf?[...o.hiddenOf()]:[...(WL.columnLayout.get(target).hidden||[])]),
 };
}
/* 色の段を組み立てる(§9.239 ⑤-3)。見本は**面**で出すが、選べる色の名前は
   必ず`title`に入れる（色だけで意味を伝えない・§3）。いま付いている色は
   枠で示すだけでなく、上の1行に**名前で**書く。 */
function tintSectionHtml(target,col){
 /* **公開漏れは黙って素通しになる**（§CLAUDE）。「あれば使う」で書くと、
    公開し忘れても例外が出ず機能だけが静かに欠ける。 */
 if(!window.WL||!WL.columnTint){
  console.error('見出しの右クリック: WL.columnTint が見つかりません（base.jsの公開漏れ）');
  return '';
 }
 const now=WL.columnTint.get(target,col);
 const total=WL.columnTint.count(target);
 const swatch=k=>`<button type="button" class="chm-tint${now===k?' is-on':''}" data-tint="${esc(k)}"`
   +` style="--chm-tint:${WL.columnTint.PALETTE[k].bg};--chm-tint-line:${WL.columnTint.PALETTE[k].line}"`
   +` title="${esc(WL.columnTint.label(k))} — ${esc(WL.columnTint.note(k))}"`
   +` aria-label="${esc(WL.columnTint.label(k))}"><i></i><span>${esc(WL.columnTint.label(k))}</span></button>`;
 return `<div class="chm-sep"></div>`
  +`<div class="chm-label" title="この端末だけの、一時的な目印です。マスタには保存しないので、他のPCには出ません。アプリを閉じると消えます。">`
  +`色: ${now?esc(WL.columnTint.label(now)):'なし'}<i class="chm-why">この端末だけ・一時的（列を動かすときの目印）</i></div>`
  +`<div class="chm-tints">${WL.columnTint.keys().map(swatch).join('')}</div>`
  +(now?`<button type="button" class="chm-tint-off">この列の色を外す</button>`:'')
  +(total?`<button type="button" class="chm-tint-clear">すべての色を外す（${total}列）</button>`:'');
}
function openColumnHeaderMenu(ev,col,target,allColumns,src){
 closeColumnHeaderMenu();
 if(!target||!col)return;
 const S2=headMenuSource(target,allColumns,src);
 /* 戻せる列は**列の並び順**で出す（§9.216 ①）。`hiddenOf()`が返す順は
    保存された配列の順（＝隠した順でも並び順でもない）なので、既定で
    畳んでいる列が多い表（データ一覧は29列）では、**いま隠した列が
    どこにあるか分からない**。並び順なら「元あった場所のあたり」を
    探せばよく、上限で切っても先頭の列から順に並ぶ。 */
 const hiddenAll=S2.hiddenOf(),hiddenSet=new Set(hiddenAll),ordered=S2.keys();
 const hidden=[...ordered.filter(k=>hiddenSet.has(k)),
               ...hiddenAll.filter(k=>!ordered.includes(k))];
 const nameOf=k=>S2.label(k);
 const menu=document.createElement('div');
 menu.className='wl-menu col-head-menu';
 const item=(label,cls)=>`<button type="button" class="${cls||''}">${esc(label)}</button>`;
 /* 隠している列は**この場で戻せる**。多いときは全部は並べない
    (メニューが画面を覆うと、それ自体が操作の邪魔になる)。 */
 const RESTORE_MAX=10;
 const shown=hidden.slice(0,RESTORE_MAX);
 menu.innerHTML=
  `<div class="chm-head" title="${esc(col)}">${esc(nameOf(col))}</div>`
  +item('この列を隠す','chm-hide')
  /* 幅の3つの状態(§9.119)。**いまどれなのかを文で出す**——「自動に戻す」が
     押せるだけでは、今が自動なのか手動なのかが分からない。 */
  +`<div class="chm-label">幅: ${esc(WIDTH_MODE_LABEL[WL.columnLayout.widthMode(target,col)]||'')}</div>`
  +item('幅を内容に合わせる（自動）','chm-autofit')
  +item(WL.columnLayout.locked(target,col)?'幅の固定を解く':'いまの幅で固定する','chm-lock')
  /* ---------- 一時的な色(§9.239 ⑤-3、利用者の指示) ----------
     列を動かすあいだ見失わないための目印。**マスタへ保存しない**ので、
     ここで「この端末だけ・一時的」と文字で言い切る（黙って付くと
     「誰かが設定した色」と読まれる）。**解除は必ず同じ場所**に置く。
     色だけで伝えないので、今の色は名前で出し、外す側にも件数を添える
     ——別の列のメニューを開いただけでも「3列に色が付いている」ことが
     分かるので、付けたまま忘れられない。 */
  +tintSectionHtml(target,col)
  +(hidden.length?`<div class="chm-sep"></div><div class="chm-label">隠している列（${hidden.length}）</div>`
    +shown.map(k=>`<button type="button" class="chm-show" data-key="${esc(k)}">${esc(nameOf(k))}</button>`).join('')
    +(hidden.length>shown.length?`<div class="chm-more">ほか${hidden.length-shown.length}件は「表示列」から</div>`:'')
    +item('すべての列を表示','chm-all'):'')
  +`<div class="chm-sep"></div>`+item('表示列の設定を開く…','chm-panel');
 document.body.appendChild(menu);
 /* 置き場所・外クリック・Esc・矢印キー・`role`は`WL.popMenu`の1箇所（§9.448）。 */
 WL.popMenu.open(menu,{at:{x:ev.clientX,y:ev.clientY},owner:target,
   onClose:()=>{document.querySelector('.col-head-menu')?.remove()}});

 /* **触った項目だけを送る**(§9.212 ②③)。材料は保存済みから取る
    ——`get()`は列の設定パネルの未保存の下書きを含むので、そこから作ると
    パネルで触っただけの内容までマスタへ入る。
    `hidden`は**口が答える「いま隠している列」**(§9.197)。保存値だけを
    見ると、既定で畳んでいる列が幅を1回変えた拍子に出てしまうので、
    並び・非表示は毎回こちらで作り直して送る。 */
 const persist=async patch=>{
  if(S2.persist){await S2.persist(patch);S2.refresh();return}
  const v=WL.columnLayout.saved(target);
  const all=S2.keys();
  /* **いま出せない列も並びから落とさない**（§9.248 ③、利用者の報告
     「一覧表関係の表示列が一部表示されなかったり消えていることがあります」）。
     以前はここが`(v.order||[]).filter(c=>all.includes(c))`で、**その瞬間に
     画面へ出ている列だけ**を残していた。`S2.keys()`の顔ぶれは場面で変わる
     ——結合が当たっていない・別のモードで開いた・内容欄のマスタがまだ
     届いていない、のどれでも縮む。そこで右クリックのメニューから
     幅や表示を1つ変えると、**居なかった列が保存済みの並びから丸ごと消える**。
     並びから消えた列は次に出てきたとき「知らない列」として末尾へ回るので、
     利用者からは「列の順番が勝手に変わった／列が消えた」と見える。
     `bindColumnHeaderTools`の`fullOrder()`は§9.216 ②で同じ理由から既に
     直してあったが、**こちらの経路（右クリックのメニュー）は直っていなかった**。
     並べ替えに要るのは「触った列を動かす」ことだけなので、知らない列は
     その場に残す——実際に描くときは`S2.keys()`側が今ある列へ当てはめ直す。 */
  const stored=(v.order||[]);
  const kept=stored.filter((c,i)=>stored.indexOf(c)===i);
  await WL.columnLayout.patch(target,{order:[...kept,...all.filter(c=>!kept.includes(c))],
                                      hidden:S2.hiddenOf(),...patch});
  S2.refresh();
 };
 menu.querySelector('.chm-hide').onclick=async()=>{
  closeColumnHeaderMenu();
  const next=[...new Set([...S2.hiddenOf(),col])];
  /* **最後の1列まで隠せてしまうと、戻す取っ掛かりが画面から消える。**
     見出しが1つも無い表は右クリックする場所も無い。 */
  const visible=S2.keys().filter(k=>!next.includes(k));
  if(!visible.length){showToast&&showToast('最後の1列は隠せません','「表示列」から設定してください',4000);return}
  await persist({hidden:next});
  showToast&&showToast(`「${nameOf(col)}」を隠しました`,'見出しの右クリックから戻せます',3000);
 };
 menu.querySelector('.chm-autofit').onclick=async()=>{
  closeColumnHeaderMenu();
  const v=WL.columnLayout.get(target);
  const widths={...(v.widths||{})};delete widths[col];
  /* **固定も一緒に解く。** 幅を持たない「固定」は動かしようが無いので、
     残すと「固定と出ているのに何も効いていない」列になる。 */
  await persist({widths,locks:(v.locks||[]).filter(k=>k!==col)});
 };
 /* いまの幅で固定する / 固定を解く。固定するときに幅が無ければ、
    **いま画面に出ている幅**をそのまま手動の幅として書き留める
    ——「固定した」のに次に開くと自動で別の幅になるのでは固定ではない。 */
 menu.querySelector('.chm-lock').onclick=async()=>{
  closeColumnHeaderMenu();
  const v=WL.columnLayout.get(target);
  const locks=new Set(v.locks||[]);
  const widths={...(v.widths||{})};
  if(locks.has(col)){locks.delete(col)}
  else{
   locks.add(col);
   if(widths[col]==null){
    /* **いま画面に出ている幅**は口が答える（§9.162で入れた口を使う）。
       `#grid`の見出しからしか読まない実装だと、仕掛一覧以外では必ず
       既定値になり「固定した幅が違う」ことになる。 */
    const w=S2.currentWidthOf(col);
    if(w>0)widths[col]=w;
   }
  }
  await persist({widths,locks:[...locks]});
 };
 menu.querySelectorAll('.chm-show').forEach(b=>{
  b.onclick=async()=>{
   closeColumnHeaderMenu();
   /* 戻すときも**いま隠している列**から引く（保存値だけを見ると、既定で
      畳んでいる列がここで一緒に出てしまう。§9.197）。 */
   await persist({hidden:S2.hiddenOf().filter(k=>k!==b.dataset.key)});
  };
 });
 menu.querySelector('.chm-all')?.addEventListener('click',async()=>{
  closeColumnHeaderMenu();await persist({hidden:[]});
 });
 /* 色（一時的）。**描き直さない**——`WL.columnTint`が1枚の`<style>`を
    書き換えるだけなので、横スクロールの位置も選択も失われない。 */
 /* 付け外ししたら**常時出るチップも同時に直す**（§9.175）。表そのものは
    描き直さない（`columnTint`が`<style>`を1枚書き換えるだけ）。 */
 const syncChip=()=>{const bar=document.getElementById('listToolbar');
                     if(bar&&typeof renderTintChip==='function')renderTintChip(bar)};
 menu.querySelectorAll('.chm-tint').forEach(b=>{
  b.onclick=()=>{closeColumnHeaderMenu();WL.columnTint.set(target,col,b.dataset.tint);syncChip()};
 });
 menu.querySelector('.chm-tint-off')?.addEventListener('click',()=>{
  closeColumnHeaderMenu();WL.columnTint.set(target,col,'');syncChip();
 });
 menu.querySelector('.chm-tint-clear')?.addEventListener('click',()=>{
  closeColumnHeaderMenu();WL.columnTint.clearAll(target);syncChip();
 });
 menu.querySelector('.chm-panel').onclick=()=>{
  closeColumnHeaderMenu();
  S2.openPanel();
 };
}
WL.openColumnHeaderMenu=openColumnHeaderMenu;

/* 「元データ」のボタンを、データソースマスタの内容そのままに組み直す(§9.87)。
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
   (S.catalogには残るので WL.base.databaseLabel()/selectDb('MASTER') は動く)。 */
const DB_NAV_ICONS={
 /* 役割で選ぶ。キーの綴りに依存させない。 */
 work:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
 quality:'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
 other:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/>',
};
/* 役割ごとの「何が見られるか」（§9.447）。綴りはサーバーの`PURPOSE_*`と同じ。
   **役割を増やしたらここにも1行足す**——載っていない役割は`__other`に倒れる
   ので黙って壊れはしないが、その行だけ用途を言わない説明になる。 */
const DB_NAV_WHAT={
 '仕掛':'作業対象のロット一覧。測定を始める・作業予定へ入れるのはここから選びます',
 '品質':'ロットの品質データ。測定画面の品質情報と帳票がここを読みます',
 '実績':'前工程の実績。仕掛から消えたロットはここと突き合わせます',
 'スケジュール':'作業予定の本体（共有スケジュールDB）',
 __other:'元データの一覧（読むだけ）',
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
  /* 説明は**「何が見られるか」が先**（§9.447）。以前は`（キー: SIKALOTNOW /
     ファイル: sikalotnow_test.sqlite3）`とだけ書いており、**現場の人に
     ファイル名は意味を持たない**。出どころを言うのは正しい（§CLAUDE 6）が、
     先に来るのは用途のほう。用途は**役割（purpose）から引く**ので、
     データソースを1行足せば説明も付いてくる（画面へ書き足さない）。 */
  b.title=`${x.label}｜${DB_NAV_WHAT[x.purpose]||DB_NAV_WHAT.__other}`
   +`\n出どころ: ${x.file_name||'—'}（キー ${x.key}）`;
  b.onclick=()=>selectDb(x.key,b);
  // マスタの表示順どおりに並べ直す(行を入れ替えたら画面もその順になる)。
  if(prev)prev.after(b);else nav.prepend(b);
  prev=b;
 });
 renderRestartPendingNote(nav,prev);
 return views.length;
}
/* 再起動待ちの変更を**一覧の側でも言う**(§9.183)。
   マスタで名称や読み込み先を直しても、効くのはサーバー再起動後。
   以前は読み込み先ぶんだけをマスタ管理画面が出しており、**名称の変更は
   誰も何も言わなかった**ため、左のボタンが古い名前のまま残っているのを見て
   「マスタで直したのに反映されない」と受け取られた。
   **出すのは待ちがあるときだけ**（常設すると読み流される）、**次にする
   ことを1つ指す**（押すとその設定を開く）。 */
function renderRestartPendingNote(nav,after){
 const items=WL.dataSource.restartPending();
 let note=nav.querySelector('#navRestartPending');
 if(!items.length){if(note)note.remove();return}
 if(!note){
  note=document.createElement('button');
  note.type='button';note.id='navRestartPending';note.className='nav-restart-note';
 }
 const KIND={label:'名称',path:'読み込み先',new:'追加した一覧',gone:'無効にした一覧'};
 const lines=items.map(x=>`${x.label||x.key}: ${KIND[x.kind]||'設定'}${
   x.kind==='label'?`（いまは「${x.now}」）`:''}`);
 note.innerHTML=`<b>${items.length}件が再起動待ち</b>`
  +`<small>${esc(lines[0])}${items.length>1?` ほか${items.length-1}件`:''}</small>`
  +`<small class="nav-restart-how">アプリを再起動すると反映されます（押すと設定を開きます）</small>`;
 note.title=lines.join('\n');
 note.onclick=()=>{
  if(typeof openMasterMaint==='function')openMasterMaint('dataSource');
 };
 if(after)after.after(note);else nav.appendChild(note);
}
// 新しく公開するものは名前空間へ入れる(CLAUDE.md「window.*への新規公開」)。
WL.renderDbNav=renderDbNav;

/* ---------- 更新履歴（§9.286 ⑦、利用者の報告） ----------
   「更新履歴の<b>みたいなタグが出ているので修正をお願いします。更新履歴は
    モーダルを大きくし読みやすくわかりやすいように再構成してください」

   タグが出ていたのは、説明文に**生のHTMLを書いていた**から（§9.276 ④）。
   `esc()`は字のまま出すのが正しいので、直すのは**書くほうの綴り**
   ——`**強調**`とバッククォート囲みへ寄せ、解くのは`WL.markup()`の1箇所
   （§9.163。`hintHtml()`も同じここを通る）。

   窓の作りは「左＝版のレール／右＝中身」。389版・1292行あるので、
   **探す・跳ぶ手立てが無いと縦に送るしかない**（§CLAUDE 画面基準 2）。
   レールには版と**その版の一言**（先頭の強調）を出す——番号だけでは
   どれが目当ての版か読めない。**いま動いている版には文字で印を付ける**
   （§CLAUDE 画面基準 3）。 */
let changelogLoaded=false,clEntries=[],clNow='',clDevCount=0;
/* 「開発の記録」は既定で伏せる（§9.336、REVIEW 3-12）。現場の人が開く画面に
   テストの名前・§番号・中のファイル名が並ぶのをやめるため。**消さずに伏せる**
   ので、ボタン1つでいつでも出せる（§4）。**分けているのはサーバー**
   （`changelog_data`の判定）で、画面は`e.dev`を読むだけ（§9.163）。
   置き場はこの端末（読み方の好み・§9.199）。 */
const CL_DEV_KEY='ChangelogShowDevV1';
function clShowDev(){try{return localStorage.getItem(CL_DEV_KEY)==='1'}
 catch(e){return WL.quiet.note('更新履歴の見え方の覚えを読めない（既定＝伏せるで続く）',e),false}}
function clSetShowDev(on){
 try{localStorage.setItem(CL_DEV_KEY,on?'1':'0')}
 catch(e){WL.quiet.note('更新履歴の見え方を覚えられない（この回だけ効く）',e)}
 clRender();
}
/* 先頭の強調（`**…**`）＝その版の見出し。無ければ最初の1文。
   **レールにしか出さない**（中身にも出すと同じ文が2箇所に並ぶ・§CLAUDE 8）。 */
function clLead(entry){
 const first=String((entry.notes||[])[0]||'');
 const m=first.match(/\*\*([^*]+)\*\*/);
 const t=(m?m[1]:first).replace(/`/g,'');
 const i=t.indexOf('。');
 return (i>=0?t.slice(0,i):t).trim();
}
function clMatches(entry,q){
 if(!q)return true;
 if(String(entry.version||'').toLowerCase().includes(q))return true;
 return (entry.notes||[]).some(n=>String(n).toLowerCase().includes(q));
}
/* 当たった言葉を光らせる。**印を解いたあとのHTMLへ当てない**——タグの中の
   文字にも当たってHTMLが壊れる。`WL.markup()`が作るのは`<b>`/`<code>`だけ
   なので、**タグの外側だけ**を対象にする。 */
function clHighlight(html,q){
 if(!q)return html;
 const needle=esc(q).toLowerCase();
 if(!needle)return html;
 return html.split(/(<[^>]*>)/).map(part=>{
  if(part.startsWith('<'))return part;
  let out='',rest=part;
  for(;;){
   const at=rest.toLowerCase().indexOf(needle);
   if(at<0){out+=rest;break}
   out+=rest.slice(0,at)+'<mark>'+rest.slice(at,at+needle.length)+'</mark>';
   rest=rest.slice(at+needle.length);
  }
  return out;
 }).join('');
}
function clRender(){
 const list=$('#changelogList'),rail=$('#changelogRail');if(!list||!rail)return;
 const q=String($('#changelogSearch')?.value||'').trim().toLowerCase();
 const dev=clShowDev();
 /* **いま動いている版だけは伏せない**——開発の記録の版であっても、
    「いまどれが動いているか」は現場が確かめる唯一の手掛かり（§9.316 の
    起動の状況もこの版で見分ける）。伏せると印の付いた版が画面から消える。 */
 const shown=dev?clEntries:clEntries.filter(e=>!e.dev||e.version===clNow);
 const hit=shown.filter(e=>clMatches(e,q));
 const notes=hit.reduce((n,e)=>n+(e.notes||[]).length,0);
 rail.innerHTML=hit.length?hit.map(e=>{
  const now=e.version===clNow;
  return `<button type="button" class="cl-rail-row" data-cl-ver="${esc(e.version)}"
    title="${esc('VER'+e.version+'　'+clLead(e))}"><b>VER${esc(e.version)}${
    now?' <em>いま</em>':''}</b><small>${esc(clLead(e))||'&nbsp;'}</small></button>`;
 }).join(''):'<p class="cl-rail-empty">当たる版がありません。</p>';
 list.innerHTML=hit.length?hit.map(e=>{
  const now=e.version===clNow;
  return `<article class="changelog-entry${now?' is-now':''}" data-cl-entry="${esc(e.version)}">
   <h3>VER${esc(e.version)}${now?'<i class="cl-now">いま動いている版</i>':''}
    <span>${(e.notes||[]).length}件</span></h3>
   <ul>${(e.notes||[]).map(n=>`<li>${clHighlight(WL.markup(n),q)}</li>`).join('')}</ul>
  </article>`;
 }).join(''):`<p class="changelog-loading">「${esc(q)}」に当たる更新履歴はありませんでした。</p>`;
 const hits=$('#changelogHits');
 // **いまどちらを見ているかを必ず文字で出す**（§3）。伏せている件数も言う。
 const hidden=clEntries.filter(e=>e.dev&&e.version!==clNow).length;
 const tail=clDevCount?(dev?`（開発の記録 ${clDevCount}版 を含む）`
                           :`（開発の記録 ${hidden}版 は伏せています）`):'';
 if(hits)hits.textContent=(q?`${hit.length}版 / ${notes}件が当たりました（全${shown.length}版）`
                            :`全${shown.length}版 / ${notes}件`)+tail;
 const devBtn=$('#changelogDev');
 if(devBtn){
  devBtn.hidden=!clDevCount;
  devBtn.textContent=dev?`開発の記録を伏せる（${clDevCount}版）`
                        :`開発の記録も出す（${hidden}版）`;
  devBtn.setAttribute('aria-pressed',dev?'true':'false');
  devBtn.title=dev?'構造の改善だけの版（画面の動きが変わらない版）も出しています。'
                  :'構造の改善だけの版（画面の動きが変わらない版）を伏せています。';
 }
 const clr=$('#changelogClear');if(clr)clr.hidden=!q;
 rail.querySelectorAll('[data-cl-ver]').forEach(b=>{
  b.onclick=()=>clJumpTo(b.dataset.clVer);
 });
 clMarkActive(hit[0]?.version||'');
}
function clMarkActive(version){
 $('#changelogRail')?.querySelectorAll('[data-cl-ver]').forEach(b=>{
  b.classList.toggle('is-active',b.dataset.clVer===version);
 });
}
function clJumpTo(version){
 const main=$('#changelogList');
 const el=main?.querySelector(`[data-cl-entry="${CSS.escape(version)}"]`);
 if(!el||!main)return;
 main.scrollTop+=el.getBoundingClientRect().top-main.getBoundingClientRect().top;
 clMarkActive(version);
 const row=$('#changelogRail')?.querySelector(`[data-cl-ver="${CSS.escape(version)}"]`);
 row?.scrollIntoView({block:'nearest'});
}
/* いま画面に出ている版をレールで示す（読んでいる場所が分かる）。
   **1フレームに1回へまとめる**——スクロールのたびに389行を触ると重い。 */
let clSpy=0;
function clOnScroll(){
 if(clSpy)return;
 clSpy=requestAnimationFrame(()=>{
  clSpy=0;
  const main=$('#changelogList');if(!main)return;
  const top=main.getBoundingClientRect().top+2;
  const found=[...main.querySelectorAll('[data-cl-entry]')]
    .find(el=>el.getBoundingClientRect().bottom>top);
  if(found)clMarkActive(found.dataset.clEntry);
 });
}
/* 窓の題の下の1行。**古い版の端末では「最新版・この端末の版・すること」**を
   言う（§9.515）——版のバッジの隣の知らせを押して来た人の、次の一手。
   開くたびに書き直す（知らせは開いたあとにも届く）。 */
function clPaintSub(){
 const sub=$('#changelogSub');if(!sub)return;
 const n=WL.versionNotice.behind()?WL.versionNotice.state():null;
 sub.classList.toggle('is-behind',!!n);
 sub.textContent=n
  ?`運用中の最新版は VER${n.latestVersion} です（この端末は VER${n.myVersion}）。`
   +'新しい版のファイルが届いていれば、アプリを終了して update.bat を実行してから開き直してください。'
   +'届いていなければ、配布の担当者へ伝えてください。'
  :clNow?`いま動いているのは VER${clNow} です。左の一覧から版へ跳べます。`
  :changelogLoaded?'左の一覧から版へ跳べます。':'読み込んでいます…';
}
async function openChangelog(){
 const modal=$('#changelogModal'),list=$('#changelogList');if(!modal||!list)return;
 modal.hidden=false;
 clPaintSub();
 requestAnimationFrame(()=>$('#changelogSearch')?.focus());
 if(changelogLoaded)return;
 try{
  const data=await api('/api/changelog');
  clEntries=(data.entries||[]).filter(e=>e&&e.version);
  clNow=String(data.version||'');
  clDevCount=Number(data.devCount||0);
  clPaintSub();
  if(!clEntries.length){
   list.innerHTML='<p class="changelog-loading">更新履歴はまだありません。</p>';
   changelogLoaded=true;return;
  }
  clRender();
  changelogLoaded=true;
 }catch(error){
  list.innerHTML=`<p class="changelog-loading">更新履歴を読み込めませんでした: ${esc(error?.message||String(error))}</p>`;
 }
}
$('#closeChangelog').onclick=()=>{$('#changelogModal').hidden=true};
if($('#changelogDev'))$('#changelogDev').onclick=()=>clSetShowDev(!clShowDev());
/* 打っている最中に器を作り直さない（§9.117）——検索欄は最初から在り、
   描き直すのはレールと中身だけ。 */
$('#changelogSearch')?.addEventListener('input',()=>{if(changelogLoaded)clRender()});
$('#changelogClear')?.addEventListener('click',()=>{
 const el=$('#changelogSearch');if(!el)return;
 el.value='';clRender();el.focus();
});
$('#changelogList')?.addEventListener('scroll',clOnScroll);
/* ---------- 表の切り替えはバッジ1つ（§9.288 ⑤、利用者の指示） ----------
   「『仕掛』と『_更新情報』というテーブルを別に読んでいますが、実質『仕掛』
    しか使いません。…ファイル名など書いてある部分の横にバッジ型のポップ
    オーバーボタンとしてテーブル名を表示し、必要なら表示テーブルを
    切り替えられるように…タブを消し…1行節約してください」
   「品質情報も全く同じで1行節約したいです。」
   「汎用のデータ読み出し機能もあるので、その場合もテーブル名はバッジ型
    ポップオーバーメニューで対応するように。」

   **器（`#tabs`）はそのまま**にして、置き場だけヘッダーのタイトル帯へ移した
   （`templates/index.html`）——`body.xx-mode #tabs{display:none}`という
   既存の約束（§9.288 ⑥）がそのまま効くので、画面ごとの書き分けが増えない。
   **1つしか無いときは押せなくして理由を書く**（§4）——押しても何も起きない
   ボタンを残さない。 */
let tableMenuEl=null;
function closeTableMenu(){
 tableMenuEl?.remove();tableMenuEl=null;
 document.getElementById('tableBadge')?.setAttribute('aria-expanded','false');
 document.removeEventListener('click',onTableOutside,true);
 document.removeEventListener('keydown',onTableEsc,true);
}
function onTableOutside(e){
 if(tableMenuEl&&!tableMenuEl.contains(e.target)&&!e.target.closest('#tableBadge'))closeTableMenu();
}
function onTableEsc(e){if(WL.modal.escCloses(e))closeTableMenu()}
function openTableMenu(anchor){
 if(tableMenuEl){closeTableMenu();return}
 const list=S.tables||[];
 const menu=document.createElement('div');
 menu.className='wl-menu access-mode-menu hd-table-menu';menu.id='tableMenu';
 menu.setAttribute('role','menu');
 menu.innerHTML='<p class="hd-table-head">表を選ぶ<small>'
  +`${esc(WL.base.databaseLabel(S.db))} の中の表 ${list.length}件。ふだんは変える必要はありません</small></p>`
  +list.map(t=>'<button type="button" role="menuitemradio" class="hd-table-pick'
    +(t===S.table?' is-current':'')+`" aria-checked="${t===S.table?'true':'false'}" data-table="${esc(t)}">`
    +'<i class="hd-table-mark" aria-hidden="true"></i>'
    +`<span>${esc(t)}</span></button>`).join('');
 document.body.append(menu);
 tableMenuEl=menu;
 /* **器の外（body直下）へ`position:fixed`**（§9.201）。画面の外へ出さない。 */
 const r=anchor.getBoundingClientRect();
 menu.style.top=`${r.bottom+6}px`;
 menu.style.left=`${Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))}px`;
 menu.querySelectorAll('[data-table]').forEach(b=>b.onclick=()=>{
  const t=b.dataset.table;closeTableMenu();
  if(t!==S.table)selectTable(t);
 });
 anchor.setAttribute('aria-expanded','true');
 requestAnimationFrame(()=>{
  document.addEventListener('click',onTableOutside,true);
  document.addEventListener('keydown',onTableEsc,true);
 });
}
/* 表の切り替え札を描いたあとに足す（汎用フィルタの帯）は `onTabs`（§9.352）。 */
function renderTabs(){renderTabsCore();runListHooks('tabs')}
function renderTabsCore(){
 const box=document.getElementById('tabs');if(!box)return;
 closeTableMenu();
 const list=S.tables||[];
 box.innerHTML='';
 /* **表がまだ無いときは出さない**——「—」のバッジは何も語らない。 */
 if(!list.length){box.hidden=true;return}
 box.hidden=false;
 const one=list.length<2;
 const b=document.createElement('button');
 b.type='button';b.id='tableBadge';b.className='hd-table-badge';
 b.setAttribute('aria-haspopup','true');b.setAttribute('aria-expanded','false');
 b.innerHTML='<span class="hd-table-key">表</span><b>'+esc(S.table||list[0])+'</b>'
  +(one?'':'<i aria-hidden="true">▾</i>');
 b.disabled=one;
 b.title=one
  ? `この接続先の表は「${S.table||list[0]}」の1つだけです。`
  : `この接続先の表 ${list.length}件から選べます（いまは「${S.table}」）。押すと切り替えられます。`;
 b.onclick=e=>{e.preventDefault();openTableMenu(b)};
 box.append(b);
}
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
/* `at` は「いつ取ったことにするか」。既定は今——**渡すのは検証だけ**（§9.355）。
   以前は網が内部の `tableCache`（Map）を直に触って `at` を書き換えており、
   ファイルを閉じた瞬間に触れなくなった。**内部を晒すより、意味のある引数で受ける。** */
function tableCacheSet(key,data,at){
 tableCache.set(key,{data,at:Number.isFinite(at)?at:Date.now()});
 // 際限なく溜めない(条件を変えるたびに1件増えるため)
 if(tableCache.size>40)tableCache.delete(tableCache.keys().next().value);
}
function invalidateTableCache(){
 tableCache.clear();updateListFreshness(null);
 /* 仕掛の在席の控え（§9.368）も一緒に捨てる。取り直した一覧はもう最新なので、
    「消えた」と決めたロットを伏せ続ける理由が無い——残すと「一覧には出ている
    のに見えない」が作れる。 */
 WL.scheduleView?.forgetWorkPresence?.();
 // 分割判定が使う仕掛の生データ問い合わせも一緒に捨てる(一覧だけ新しくして
 // 親ロット判定が古いまま、という食い違いを作らない)。
 if(typeof window.invalidateSplitQueryCache==='function')window.invalidateSplitQueryCache();
}
window.invalidateTableCache=invalidateTableCache;
/* ---------- 「いま見ているのはいつのデータか」（§9.286 ④） ----------
   利用者の指示「任意で更新を掛けたいというのと、今見ているのがいつのデータか
   わかるような表示も一覧表確認時に見えるようにお願いしたいです」

   以前ここに出ていたのは**この端末の写し（tableCache）の古さ**で、しかも
   キャッシュから描いたときだけ出ていた——取り立てのときは何も出ず、
   元データがいつのものかは**どこにも書いていなかった**。

   出すのは**元データの更新時刻**（サーバーの`source.at`）。手元の写しを
   読んでいるかどうか・いつ取り込んだかは`title`へ落とす（§9.234 ①）。
   **分からないときは「不明」と書く**——「たった今」に倒すと嘘になる（§3）。
   押すと再読込のメニューが開く（読む場所と打つ手を同じ場所に置く）。 */
let listSourceInfo=null;      // 直近の /api/table が答えた元データの素性
function fmtStamp(sec){
 if(!sec)return '';
 const d=new Date(sec*1000);
 if(Number.isNaN(d.getTime()))return '';
 const p=n=>String(n).padStart(2,'0');
 return `${d.getMonth()+1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function agoText(ms){
 const min=Math.floor(ms/60000);
 if(min<1)return 'たった今';
 if(min<60)return `${min}分前`;
 const h=Math.floor(min/60);
 return h<24?`${h}時間前`:`${Math.floor(h/24)}日前`;
}
function updateListFreshness(at){
 const el=document.querySelector('#listFreshness');if(!el)return;
 const info=listSourceInfo||null;
 const stamp=fmtStamp(info&&info.at);
 el.hidden=false;
 /* **本文は「元データ ◯/◯ ◯◯:◯◯」だけ**（§CLAUDE 画面基準 3・8）。
    写しかどうか・取込時刻・画面の写しの古さは説明へ回す。 */
 /* 元に**写していない新しい版**がある（手動のとき・§9.463）。色だけで言わない。 */
 const newer=!!(info&&info.newer);
 el.innerHTML=`<span class="lf-key">元データ</span>`
   +`<b class="lf-val">${esc(stamp||'時刻不明')}</b>`
   +(newer?`<span class="lf-new">新しい版あり</span>`:'')
   +`<span class="lf-act" aria-hidden="true">⟳</span>`;
 el.classList.toggle('is-unknown',!stamp);
 el.classList.toggle('is-newer',newer);
 const lines=[];
 lines.push(stamp?`いま出している行は、元データの ${stamp} 時点の内容です。`
                 :'元データの更新時刻を読み取れませんでした。');
 if(info&&info.mirrored){
  lines.push(`共有の元ファイルを手元へ写して読んでいます`
    +(info.copiedAt?`（取り込み ${fmtStamp(info.copiedAt)}）`:'')+'。');
  if(info.checkedAt)lines.push(`最後に共有を確かめたのは ${agoText(Date.now()-info.checkedAt*1000)}。`);
 }else if(info){
  lines.push('置き場のファイルをそのまま読んでいます。');
 }
 /* 画面の写し（`tableCache`）から描いたときは、そのことも言う——同じ
    「古さ」でも打つ手が違う（§CLAUDE 6）。 */
 if(at)lines.push(`画面に出ているのは ${agoText(Date.now()-at)}に読み込んだ内容です。`);
 if(newer)lines.push('元に新しい版があります（写しの更新が「手動」のため、まだ取り込んでいません）。');
 else if(info&&info.mode==='manual')lines.push('写しの更新は「手動」です（共通設定 > どこから読むか）。');
 lines.push('押すと共有から取り込み直せます。');
 el.title=lines.join('\n');
}
window.updateListFreshness=updateListFreshness;
/* 取得結果を画面状態へ流し込む共通処理(list-view.jsとfilters.jsのload()が共用)。 */
function applyTableData(d){
 /* 元データの素性（§9.286 ④）。**一覧と同じ応答から取る**——別の口で
    取りに行くと、一覧と鮮度が別のタイミングの話になりうる。 */
 if(d&&Object.prototype.hasOwnProperty.call(d,'source'))listSourceInfo=d.source||null;
 Object.assign(S,{columns:d.columns,rows:d.rows,count:d.count});
 S.joinQuality=d.joinQuality||null;
 const info=(S.catalog||[]).find(x=>x.key===S.db)||{};
 // 主は画面名(仕掛一覧/品質データ)、副にファイル名。以前はファイル名だけを
 // 出しており、他画面へ移ってもそのまま残っていた(§9.60)。
 // ただしスケジュールの分割表示中(body.sc-mode)は、仕掛一覧は作業スケジュール
 // 画面の中の一区画にすぎない。ここで書き換えると、作業スケジュールを見て
 // いるのにヘッダーだけ「仕掛一覧」になる(実際にそうなっていた)。
 if(!document.body.classList.contains('sc-mode'))WL.base.setHeaderContext(WL.base.databaseLabel(S.db),info.file_name||'');
 const tn=$('#tableName');if(tn)tn.textContent=S.table||'';
 S.selectedRows.clear();
 /* **当てられなかった並べ替えは黙って捨てない**(§9.187)。設定したのに
    別の並びで出ているのに何も言わないと、設定が効かないのか、そういう
    並びなのかが区別できない。 */
 if(d.sortNote)showToast&&showToast('並べ替えの設定を当てられませんでした',d.sortNote,7000);
}
window.applyTableData=applyTableData;
/* 一覧データ取得の本体(キャッシュ判定→取得→鮮度更新)。**読み込みの経路は
   この1本だけ**で、拡張したい側は`WL.listHooks`へ登録する(§9.93。以前は
   filters.jsがload()を丸ごと置き換えており、片方だけ直して反映されない事故が
   3回起きた)。
   待機表示はwithWaitingの遅延表示に任せる: キャッシュ命中なら一度も出ないし、
   本当にサーバーを待つときだけ出る。 */
/* この一覧の列レイアウト(並び・幅・表示)を覚えておくスコープ(§9.88)。
   モードで分けない——同じ表を見ているのに並びが変わると混乱するため。 */
function listLayoutTarget(){return (S.db&&S.table)?`list:${S.db}:${S.table}`:''}

async function fetchTableData(key,force){
 /* **見せ方の設定と一覧データは同時に取りに行く**(§9.93)。
    以前は4つの設定を1つずつ`await`してから一覧を取りに行っており、
    実測すると一覧の取得が始まるのは表示開始から631ms地点で、その前に
    往復が9本並んでいた。共有フォルダ越しの実機では1往復が数百msになる
    ため、ここだけで数秒を失う。設定はどれも一覧データに依存しないので、
    **束ねて並列に投げ、揃うのを待つ**。どれが読めなくても既定の見せ方で
    一覧は出す(fail-open)。 */
 const settings=Promise.all([
  WL.columnLayout.load(listLayoutTarget()).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),
  WL.displayRules.load().catch(WL.quiet('表示ルールを取れない（読み替え無しで出す）')),
  sortPresets.load().catch(WL.quiet('並べ替えの登録を取れない（素の並びで出す）')),
  loadRowGap().catch(WL.quiet('行間の設定を取れない（既定で出す）')),
 ]);
 const hit=force?null:tableCacheGet(key);
 if(hit){await settings;applyTableData(hit.data);updateListFreshness(hit.at);return}
 const label=WL.base.databaseLabel(S.db),table=S.table||'テーブル';
 await WL.records.withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${table}`,
   progress:'サーバーが読み出しています'},async(report)=>{
  /* 一覧データの取得も**設定と同時に**始める。描く直前に両方が揃っていれば
     よく、順番に待つ理由が無い。 */
  const data=fetchWithBreakdown('/api/table?'+key,report);
  await settings;
  const d=await data;
  tableCacheSet(key,d);applyTableData(d);updateListFreshness(null);
 });
}
/* ---------- 全件の続きを裏で読む(§9.95) ----------
   1ページ目は普通に出したうえで、2ページ目以降を**待たせずに**読み続ける。
   ・1回ぶんが小さい(500件)ので、受け取って解く時間も小さく刻まれる
   ・読んでいる間もスクロール・切替・測定を開くことができる
   ・**画面を切り替えたら止める**(世代が変わったら次を頼まない)
   全部そろってから1度だけ描き直す。描き直しの前後で**見ている位置を保つ**
   ——読み終わった拍子に先頭へ飛ぶと、探していた行を見失う。 */
let allRowsRun=0;
function stopAllRowsLoad(){allRowsRun++}
/* 件数の表示。全件で**まだ途中**のときだけ、どこまで読めたかを添える
   (「全2,003件」とだけ出ていると、下まで見たつもりで見落とす)。 */
/* ---------- ページめくり（§9.286 ②） ----------
   利用者の報告「表示件数制限がある場合は…フィルタした後に他のデータに
   アクセスできないことがある不具合です」。

   出すのは**いま何件目から何件目か**の1つだけ（§CLAUDE 8）——「2ページ目」と
   「1,001〜2,000件」は同じことを2通りで言っているので、**探している行が
   この範囲に居るか**が直に読める後者を採る。ページ番号と総ページ数は
   `title`へ落とす（§9.234 ①）。
   **全件はページの概念が無い**ので押せなくして理由を書く（§4）。 */
function renderPager(){
 const page=$('#page'),prev=$('#prev'),next=$('#next');
 if(!page||!prev||!next)return;
 const size=effectivePageSize(),total=S.count|0;
 if(isAllRows()){
  page.textContent='全件';
  page.title='「全件」ではページに分けません。表示件数を選ぶとページめくりが使えます。';
  prev.disabled=next.disabled=true;
  prev.title=next.title='「全件」ではページに分けません';
  return;
 }
 const from=total?((S.page-1)*size+1):0;
 const to=Math.min(total,S.page*size);
 const pages=Math.max(1,Math.ceil(total/size));
 page.textContent=total?`${from.toLocaleString()}–${to.toLocaleString()}`:'0';
 page.title=`${S.page} / ${pages}ページ（1ページ ${size.toLocaleString()}件）`;
 prev.disabled=S.page<=1;
 next.disabled=S.page>=pages;
 prev.title=prev.disabled?'これが最初のページです':`前のページ（${Math.max(1,S.page-1)} / ${pages}）`;
 next.title=next.disabled?'これが最後のページです':`次のページ（${Math.min(pages,S.page+1)} / ${pages}）`;
}
function allRowsProgress(loaded,total){
 const el=$('#count');if(!el)return;
 el.textContent=(isAllRows()&&total&&loaded<total)
   ? `全 ${total.toLocaleString()}件（${loaded.toLocaleString()}件まで読み込み済み…）`
   : `全 ${(total||loaded||0).toLocaleString()}件`;
}
async function continueAllRows(key){
 const run=++allRowsRun;
 const total=S.count|0;
 if(!total||S.rows.length>=total)return;
 allRowsProgress(S.rows.length,total);
 const params=new URLSearchParams(key);
 const rows=S.rows.slice();
 for(let page=2;(page-1)*ALL_BATCH<total;page++){
  if(run!==allRowsRun)return;                 // 別の読み込みが始まった
  params.set('page',String(page));
  let d=null;
  try{d=await api('/api/table?'+params)}
  catch(e){
   // 途中で読めなくなっても、**そこまでの分はそのまま使える**。
   if(run===allRowsRun)allRowsProgress(rows.length,total);
   showToast&&showToast('全件の読み込みを中断しました',
     `${rows.length.toLocaleString()}件まで表示しています（${e.message}）`,6000);
   return;
  }
  if(run!==allRowsRun)return;
  rows.push(...(d.rows||[]));
  allRowsProgress(rows.length,total);
 }
 if(run!==allRowsRun)return;
 keepGridScroll();             // 読み終わった拍子に先頭へ飛ばさない
 S.rows=rows;
 // 取り直したときに使い回せるよう、キャッシュも全件の形へ入れ替える。
 tableCacheSet(key,{columns:S.columns,rows,count:S.count,joinQuality:S.joinQuality});
 /* 全件読み終わりは**利用者の操作と無関係に**（数秒〜数十秒後に）来る。
    列幅を掴んでいる最中に表を作り直すと手が空を切るので待たせる（§9.211 ①）。 */
 WL.columnResize.defer('grid:allRows',()=>renderGrid());
 allRowsProgress(rows.length,total);
}
/* ---------- 読み込みの内訳(§9.90) ----------
   「一覧が出るまで時間がかかる」という報告に対して、**どこで待っている
   のか**が分からないと打ち手が決まらない(共有が遅いのか、量が多くて
   転送に時間がかかっているのか、描画なのか)。4つに分けて測る。
     読み出し … サーバー側(DBを開く→数える→取り出す→結合する)
     転送     … 本文を受け取り切るまで
     整形     … JSONを組み立てるまで
     表示     … 画面に並べるまで(applyTableData→renderGrid)
   サーバー側の内訳は /api/table が timing で返す(Server-Timingにも同じ値)。
   最初の1バイトが来るまで(TTFB)を測るために fetch を直接使う。 */
let lastLoadBreakdown=null;
async function fetchWithBreakdown(url,report){
 const t0=performance.now();
 const res=await fetch(url,{headers:{'Accept':'application/json'}});
 const tHead=performance.now();
 report&&report({progress:'データを受け取っています'});
 const text=await res.text();
 const tBody=performance.now();
 report&&report({progress:'画面に並べています'});
 let d;
 try{d=JSON.parse(text)}
 catch(e){throw new Error(`応答を読み取れませんでした(${res.status})`)}
 if(!res.ok)throw new Error(d&&d.error||`HTTP ${res.status}`);
 const tParse=performance.now();
 lastLoadBreakdown={
  server:d.timing&&d.timing.server||Math.round(tHead-t0),
  detail:d.timing||null,
  wait:Math.round(tHead-t0),          // 送ってから最初の応答まで
  transfer:Math.round(tBody-tHead),   // 本文を受け取り切るまで
  parse:Math.round(tParse-tBody),
  bytes:text.length,rows:(d.rows||[]).length,columns:(d.columns||[]).length,
  render:0,at:Date.now(),
 };
 return d;
}
/* 描画にかかった分を後から足す(呼び出し側が並べ終えてから分かるため)。 */
function noteRenderTime(ms){if(lastLoadBreakdown)lastLoadBreakdown.render=Math.round(ms)}
WL.loadBreakdown=()=>lastLoadBreakdown&&{...lastLoadBreakdown};
window.fetchTableData=fetchTableData;

/* 一覧を取りに行くときの問い合わせを**1箇所で組み立てる**。
   ------------------------------------------------------------
   filters.js が load() を丸ごと差し替えるため、両方に同じ組み立てを書くと
   片方だけ直した状態になる(実際に品質データ結合とキャッシュで2度起きた)。
   条件(filters)は絞り込みを持つfilters.js側が足すが、それ以外は必ずここを通す。 */
/* ---------- 一覧の読み込みの拡張点(フック) ----------
   **`load()`を丸ごと置き換えないこと。** 以前は`filters.js`が
   `load=async function(){...}`で全置換しており、元の定義をgrepで辿っても
   最終的な実装に行き着かなかった。実際、品質データ結合・キャッシュ・
   読み込み時間の計測の3回、「list-view.js側だけ直して効いていない」が起きた。
   拡張したい側は**フックを登録する**——本体は1箇所のままで、誰が何を
   足しているかが登録の行から分かる。
     query : 問い合わせの組み立て後に呼ばれる。URLSearchParamsを受け取り、
             条件を足す(戻り値は不要)
     after : 一覧を描き終えた後に呼ばれる */
const listHooks={query:[],after:[],tabs:[],grid:[],beforeSelectTable:[],select:[],narrow:[]};
WL.listHooks={
 /* narrow : 「いま何が行を絞っているか」を名乗る（0件の案内が読む・§9.453）。
             `{items:[{source,text,locked}],clear:async()=>{}}` か null を返す。
             `clear`は**外すだけで読み直さない**（読み直しは案内が1回だけ行う）。 */
 onNarrow:fn=>{if(typeof fn==='function')listHooks.narrow.push(fn)},
 onQuery:fn=>{if(typeof fn==='function')listHooks.query.push(fn)},
 onAfter:fn=>{if(typeof fn==='function')listHooks.after.push(fn)},
 onTabs:fn=>{if(typeof fn==='function')listHooks.tabs.push(fn)},
 onGrid:fn=>{if(typeof fn==='function')listHooks.grid.push(fn)},
 onBeforeSelectTable:fn=>{if(typeof fn==='function')listHooks.beforeSelectTable.push(fn)},
 onSelect:fn=>{if(typeof fn==='function')listHooks.select.push(fn)},
 count:()=>Object.fromEntries(Object.keys(listHooks).map(k=>[k,listHooks[k].length])),
};
function runListHooks(kind,arg){
 listHooks[kind].forEach(fn=>{
  // 1つのフックが転んでも一覧は出す(fail-open)。
  try{fn(arg)}catch(e){console.error('一覧の'+kind+'フックで例外',e)}
 });
}
/* 「選ぶ前」は待つ（既定のフィルタを当てる往復が1回ある）。例外は呼び出し元へ（被せのときと同じ）。 */
async function runListHooksAsync(kind,arg){for(const fn of listHooks[kind])await fn(arg)}
/* ---------- 「全件」(§9.95) ----------
   表示件数に「全件」を足した。サーバーは1回に500件までしか返さない
   (それ以上を1度に運ぶと転送も解読も1つの塊になり、そのあいだ操作できない)
   ので、**全件は「500件ずつ最後まで取り続ける」**という意味にする。
   最初の500件はいつもどおり出し、残りは裏で読む。 */
const ALL_ROWS='all';
/* 1ページの件数（§9.286 ③、利用者の指示「200,500,1000,2000,3000,5000を準備し、
   1000件としたい」）。**サーバーの上限とそろえること**——`/api/table`は
   `page_size`を丸めるので、片方だけ増やすと「5000を選んだのに500しか出ない」
   （実際に上限500で頭打ちだった）。 */
const PAGE_SIZES=[200,500,1000,2000,3000,5000];
const DEFAULT_PAGE_SIZE='1000';
/* 1回に取る件数。**大きいほど往復は減るが、1回ぶんの解読が長くなる**。
   実データ(214列)では500件で1回4.5MB・解読に1.3秒かかり、そのあいだ
   画面が止まる。250件なら0.5秒級まで下がり、往復も倍にしかならない。 */
const ALL_BATCH=250;
function pageSizeValue(){return $('#pageSize')?.value||DEFAULT_PAGE_SIZE}
function isAllRows(){return pageSizeValue()===ALL_ROWS}
/* 1ページの件数。全件のときは1回ぶんの取得単位を返す(ページ番号の計算にも使う)。 */
function effectivePageSize(){return isAllRows()?ALL_BATCH:(+pageSizeValue()||Number(DEFAULT_PAGE_SIZE))}
function listQuery(){
 /* 全件でも**サーバーへ送るのは1回ぶん**。`all=1`は「この問い合わせは
    全件の1ページ目」という目印で、サーバーは見ない(キャッシュのキーと、
    続きを読むかどうかの判定に使う)。 */
 const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,
                              page_size:String(effectivePageSize()),search:$('#search')?.value||''});
 if(isAllRows())q.set('all','1');
 /* 並び順は複数キー(§9.88 段5)。1キーでも同じ形で送る。
    **列ごとの並べ替えの決まり(§9.187)も一緒に送る**——サーバーが列レイアウト
    マスタを読みに行く形にすると、対象(target)の組み立て方をサーバーが知る
    ことになり、保存前の試し(stage)も効かなくなる。いま当たっている設定を
    そのまま渡すのが一番素直。書式・読み替えは「変換後の文字で並べる」
    ときだけ意味を持つ。 */
 const target=listLayoutTarget();
 const sorts=WL.listSort.keys().map(k=>{
  const spec=target?WL.columnLayout.sort(target,k.column):null;
  if(!spec)return k;
  const out={...k,sort:spec};
  if(spec.on==='display'){
   out.fmt=WL.columnLayout.format(target,k.column)||null;
   out.rule=WL.columnLayout.rule(target,k.column)||'';
  }
  return out;
 });
 if(sorts.length)q.set('sorts',JSON.stringify(sorts));
 // スケジュールモードの作業対象一覧のみ、品質データを結合して表示する
 // (§9.21)。通常の閲覧では付けない(オプトインで単独表示に影響を与えない)。
 // どちらが作業対象/品質かはデータソースマスタの役割で決まる(§9.87)。
 if(WL.dataSource.isWork(S.db)&&window.accessMode?.mode==='schedule')q.set('join_quality','1');
 /* 利用者が登録したクエリ結合(§9.193)は**どの一覧でも**当てる——わざわざ
    登録したものが、モードによって効いたり効かなかったりするほうが分からない。
    **本筋の問い合わせにだけ付ける**のが肝で、行ごとの追い判定のような内部の
    軽い問い合わせ(§9.94)には付かない＝相手のDBを毎行引くことにはならない。 */
 q.set('join','1');
 /* 絞り込み条件は`filters.js`がフックで足す(全置換をやめた経緯は上記)。 */
 runListHooks('query',q);
 return q;
}
WL.listQuery=listQuery;

async function load(force){
 stopAllRowsLoad();                       // 前回の「全件の続き」は打ち切る
 const key=String(listQuery());
 await fetchTableData(key,force);
 renderGrid();
 runListHooks('after');
 // 全件は1ページ目を出してから続きを読む。**待たない**(画面は使える)。
 if(isAllRows())continueAllRows(key);
}
/* 読み込みの内訳（§9.198）。「遅い」は**どこが遅いのかで打つ手がまるで違う**
   （共有ならネットワーク、整形なら列と件数、表示なら行数）ので、内訳をそのまま
   出す。**文言は1箇所**——チップの`title`と再読込メニューの両方がここを読む。 */
function loadBreakdownLines(b){
 if(!b)return [];
 const kb=Math.round(b.bytes/1024);
 const src={mirror:'手元の写し',share:'共有を直接',local:'手元'}[b.detail&&b.detail.source]||'';
 return [
  `読み出し ${b.wait}ms（サーバー側 ${b.server}ms${src?' / '+src:''}）`,
  b.detail?`　└ 開く${b.detail.open??'-'}ms・列${b.detail.cols??'-'}ms・件数${b.detail.count??'-'}ms・取り出し${b.detail.fetch??'-'}ms`
           +(b.detail.join!=null?`・品質結合${b.detail.join}ms`:''):'',
  `転送 ${b.transfer}ms（${kb}KB）`,
  `整形 ${b.parse}ms`,
  `表示 ${b.render}ms（${b.rows}行 × ${b.columns}列）`,
 ].filter(Boolean);
}
function loadTotalMs(b){return b?b.wait+b.transfer+b.parse+b.render:0}
/* 読み込みの秒数を一覧の脇に出すのは**遅かったときだけ**（§9.340、REVIEW 4-1 ④）。
   作業スケジュールは§9.198で既にそうしていたのに、一覧だけ**常に出して**いた
   ——「0.2秒」が全画面でずっと居座り、面積を取るのに読む理由が無い。しきい値の
   答えは`WL.slowLoadMs`の1箇所（§9.163。以前はスケジュール1200・一覧1500と
   2つあった）。
   **内訳の入口は消さない**——速くて出ていないときは、鮮度チップの再読込メニュー
   から読める（スケジュールが浮きメニューに内訳を持つのと同じ形・§9.300 ①）。 */
function renderLoadChip(){
 const chip=document.getElementById('listLoadChip');
 const b=lastLoadBreakdown;
 if(!chip)return;
 if(!b||loadTotalMs(b)<WL.slowLoadMs){chip.hidden=true;return}
 chip.hidden=false;
 chip.className='list-load-chip is-slow';
 chip.textContent=`${(loadTotalMs(b)/1000).toFixed(1)}秒`;
 chip.title=loadBreakdownLines(b).join('\n');
}
/* データベース切替→テーブル選択は、実際に目視できる2段階で待機表示する
   (テーブル構成の確認→列情報・一覧データの取得)。以前は3段階だったが、
   ステップ間に描画の猶予(nextPaint)を与えていない箇所があり、中間の
   ステップが一度も画面に表示されないまま次のステップへ上書きされていた。
   待機表示そのものはwithWaitingの遅延表示に委ねる(§9.46)。キャッシュから
   即座に描ける切替でオーバーレイを出すと、一瞬の点滅と表示待ちの描画
   フレームが挟まるぶん、速くなったのにかえって遅く見えるため。 */
/* テーブル構成は運用中に変わらないので保持する。**端末にも残す**(§9.93)。
   起動のたびに「カタログ→テーブル一覧→一覧データ」と3往復してからでないと
   一覧を取りに行けず、共有越しでは1往復が数百msになるため、ここが毎回
   効いてくる。前回**実際に確認した**一覧なので推測ではない
   (データソースの`preferred`は設定値で、そのDBに実在するとは限らない
   ——品質データの既定が「仕掛」のまま、という実例がある)。
   起動直後はこれを使って先に進み、裏で取り直して食い違えば入れ替える。 */
const TABLES_CACHE_KEY='listTablesCacheV1';
const tablesCache=new Map();
/* **裏での取り直しは1つのDBにつきこの起動で1回だけ。** 端末に残した一覧は
   前回の実測なので確かめる価値はあるが、切り替えるたびに投げると
   「戻るときは往復ゼロ」(§9.46)が崩れる。確かめ済みのDBはここに入れる。 */
const tablesVerified=new Set();
try{
 const saved=JSON.parse(localStorage.getItem(TABLES_CACHE_KEY)||'{}');
 Object.entries(saved).forEach(([k,v])=>{if(v&&Array.isArray(v.tables))tablesCache.set(k,v)});
}catch(e){WL.quiet.note('壊れていても取り直せばよい',e)}
function rememberTables(k,result){
 tablesCache.set(k,result);tablesVerified.add(k);
 try{
  const out={};tablesCache.forEach((v,kk)=>{out[kk]={tables:v.tables}});
  localStorage.setItem(TABLES_CACHE_KEY,JSON.stringify(out));
 }catch(e){WL.quiet.note('保存できなくても動作は続く',e)}
}
/* 一覧(データ一覧/仕掛/品質データ)。品質データを選んだときだけ品質分析の
   パネルが上に付く(qa-mode)ので、一覧から他の画面へ移るときはそれも一緒に
   畳む。以前はこの後始末を各画面のopenXxxが個別に書いており、
   #qualityAnalysisPanelを実際に隠していたのは実績カレンダーだけだった。 */
WL.registerView({key:'list',exit:()=>{
 document.body.classList.remove('qa-mode','qa-view-raw');
 document.getElementById('qualityAnalysisPanel')?.setAttribute('hidden','');
}});
async function selectDb(k,b){const r=await selectDbCore(k,b);runListHooks('select',{db:k});return r}
async function selectDbCore(k,b){
 /* 利用者の操作で一覧へ移るなら、これが画面の切替そのもの。以前は
    「他の画面を閉じる」処理を各ファイルがselectDbを順に包むモンキーパッチ
    (6箇所)で足しており、読み込み順に依存する連鎖になっていた。
    内部からの呼び出し(スケジュールの分割表示)では切り替えない。 */
 if(!WL.isInternalDbSwitch())WL.enterView('list');
 const label=WL.base.databaseLabel(k);
 return WL.records.withWaiting({title:`${label}へ切り替えています`,detail:`接続先を確認しています: ${label}`,
   progress:'テーブル構成を確認しています',step:1},async report=>{
  try{S.db=k;WL.base.setActiveNav(k);
   let result=tablesCache.get(k);
   if(!result){result=await api(`/api/tables?db=${encodeURIComponent(k)}`);rememberTables(k,result)}
   else if(!tablesVerified.has(k)){
    /* 覚えている一覧で先に進みつつ、**裏で取り直して食い違えば入れ替える**
       (§9.93)。テーブル構成が変わるのは運用の切り替え時だけなので、
       毎回待つ理由が無い。確かめるのはこの起動で1回だけ(2回目以降の切替は
       往復ゼロ)。 */
    tablesVerified.add(k);
    api(`/api/tables?db=${encodeURIComponent(k)}`).then(r=>{
     const changed=JSON.stringify(r.tables)!==JSON.stringify(result.tables);
     rememberTables(k,r);
     if(changed&&S.db===k){S.tables=r.tables;renderTabs();
      if(r.tables.length&&!r.tables.includes(S.table))selectTable(r.tables[0]);}
    }).catch(()=>{tablesVerified.delete(k)/* 取り直せなくても覚えている一覧で動く */});
   }
   S.tables=result.tables;renderTabs();
   if(S.tables.length)await selectTable(S.tables[0],report);
   else $('#grid').textContent='表示可能なテーブルがありません。';
  }catch(e){$('#grid').innerHTML=`<div class="load-error"><b>${esc(label)}を開けませんでした</b><span>${esc(e.message)}</span></div>`;throw e}
 });
}
/* reportは呼び出し元(selectDb)が待機表示を握っているときだけ渡ってくる。
   単独で呼ばれたとき(タブのクリック)は自分で遅延表示を用意する。 */
/* 表を選ぶ前に足す（フィルタの文脈の入れ替え）は `onBeforeSelectTable`、選んだあとは `onSelect`（§9.352）。 */
async function selectTable(t,report){await runListHooksAsync('beforeSelectTable',t);const r=await selectTableCore(t,report);runListHooks('select',{table:t});return r}
async function selectTableCore(t,report){
 S.table=t;S.page=1;WL.listSort.clear();renderTabs();const label=WL.base.databaseLabel(S.db);
 if(report){report({detail:`テーブル: ${t}`,progress:'列情報と一覧データを取得しています',step:2});return load()}
 return WL.records.withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${t}`,
   progress:'列情報と一覧データを取得しています'},()=>load());
}
/* 一覧の列名は仕掛先DBの生カラム名なので、aliasesの候補名のうち
   実際にS.columnsへ含まれているものを探してロット番号・鋳造番号の
   列を特定する(見つからなければ通常表示のまま)。 */
function findColumnFor(key){return (WL.base.aliases[key]||[]).find(n=>S.columns.includes(n))||null}
/* ---------- 列幅の見積り(§9.94) ----------
   `table-layout:fixed`にした以上、**全列に幅を与えるのはこちらの仕事**
   (与えないと等分になり、短い列が間延びし長い列が潰れる)。
   ブラウザに測らせないのが目的なので、実際に描いて測る方法は採れない。
   文字の幅から数える: 半角は約0.55em、全角(CJK・かな)は1em。
   見出しとデータの先頭数十行を見て、広いほうを採る。
     ・見出しは折り返さない約束(§9.90)なので、見出しは必ず入る幅にする
     ・データ側は青天井にしない(1列で画面が埋まると表として読めない) */
const COL_W_MIN=52,COL_W_MAX=320,COL_W_SAMPLE=40;
function textWidthEm(s){
 let w=0;
 for(const ch of String(s==null?'':s)){
  const c=ch.codePointAt(0);
  // ASCII・半角カナは狭い。それ以外(漢字・かな・全角記号)は1文字ぶん。
  w+=(c<0x2e80||(c>=0xff61&&c<=0xff9f))?0.55:1;
 }
 return w;
}
/* **いちばん長い1件に合わせない**(§9.106)。最大値で決めると、たまたま
   長い値が1件あるだけで列が画面の1/4を占め、他の列が押し出される
   (「不要な余白が広い」と報告された状態)。上位1割を外した長さに合わせ、
   はみ出す少数は省略記号＋`title`で読ませる(§9.94の約束どおり)。
   **見出しは必ず入る幅にする**——見出しが読めない表は列を選べない。 */
/* 見積りの余裕(§9.119)。`textWidthEm`は字幅の近似なので、実測より数px
   小さく出ることがある。表の幅を列幅の合計で固定するまでは、CSSの
   `width:max-content`が表を広げて吸収していた（＝指定より広く描かれて
   いた）ため気づかなかったが、固定した途端に**自動で決めた幅なのに
   4〜5px切れる**列が出た（用途名70/74・取引先64/69で実測）。
   自動の見積りは「入り切る」ことが目的なので、近似の誤差ぶんを足す。 */
const COL_W_SLACK=6;
function estimateColumnWidth(label,values,fs,padX){
 const lens=[];
 for(const v of values){const w=textWidthEm(v);if(w>0)lens.push(w)}
 lens.sort((a,b)=>a-b);
 // 90パーセンタイル(件数が少ないときは最大値のまま)
 const p90=lens.length?lens[Math.min(lens.length-1,Math.floor(lens.length*0.9))]:0;
 const em=Math.max(textWidthEm(label),p90);
 return Math.round(Math.min(COL_W_MAX,Math.max(COL_W_MIN,em*fs+padX*2+2+COL_W_SLACK)));
}
/* 表の文字サイズと左右余白は表示サイズ(--ui-scale)で変わるので、
   描くたびに1度だけ読む(セルごとに読むと数万回になる)。 */
function gridMetrics(){
 const g=document.getElementById('grid');
 const cs=g?getComputedStyle(g):null;
 const fs=parseFloat(cs&&cs.getPropertyValue('font-size'))||14;
 const px=parseFloat(cs&&cs.getPropertyValue('--row-pad-x'))||6;
 return {fs,padX:px};
}
/* ---------- 列の窓(§9.104) ----------
   実データの仕掛一覧は**214列**あるが、1600pxの画面に入るのは**16列**。
   残り200列ぶんのセルは、見えないのに毎回組み立てられ、毎回並べ直されて
   いた。実測(214列・50行を1回組み直す):

     作る  44ms + 並べる 918ms = 962ms   全列そのまま(いままで)
     作る  91ms + 並べる 410ms = 501ms   全部作って display:none で隠す
     作る   1ms + 並べる  22ms =  23ms   **16列だけ作る(この窓)**

   **隠すだけでは足りない**(作ってしまうとレイアウトから外れない)ので、
   窓の外は**作らない**。行の窓(§9.95)と同じ考えを横方向にも当てる。

   **見出し(thead)とcolgroupは全列のまま置く。** 1行ぶんなので安く、
   列の並べ替え・幅の調整・並び替えの当たり判定と、列を数えている既存の
   作りをそのまま残せる。畳むのは本文の行だけで、窓の外は`colspan`を
   持たせた空セル2つにまとめる(`table-layout:fixed`なので、k列ぶんを
   colspanで束ねた幅は元のk列の合計と1pxもずれない)。 */
const COL_WINDOW_OVERSCAN=6;
/* 窓を出すのは**器に収まらないほど広いとき**だけ。全部見えているなら
   畳む先が無く、横スクロールのたびに組み直す手間だけが増える。 */
function makeColumnWindow({grid,columns,widthOf,leadWidth}){
 const edge=[0];
 columns.forEach(c=>edge.push(edge[edge.length-1]+(widthOf(c)||0)));
 const total=edge[edge.length-1];
 const all={from:0,to:columns.length};
 /* 器の幅が取れないとき(まだ画面に出ていない・隠れている)は**畳まない**。
    幅0を「何も入らない」と読むと、見えるようになった瞬間に空の表になる。 */
 const on=()=>!!grid&&grid.clientWidth>0&&total>grid.clientWidth+COL_W_MAX;
 let win=all;
 const compute=()=>{
  if(!on())return all;
  const l=Math.max(0,(grid.scrollLeft||0)-leadWidth), r=l+grid.clientWidth;
  let from=0;while(from<columns.length&&edge[from+1]<=l)from++;
  let to=from;while(to<columns.length&&edge[to]<r)to++;
  return {from:Math.max(0,from-COL_WINDOW_OVERSCAN),
          to:Math.min(columns.length,to+COL_WINDOW_OVERSCAN)};
 };
 return {
  get:()=>win,
  enabled:on,
  reset(){win=compute();return win},
  /* 窓が動いたか。**余分(overscan)の中に収まっているうちは動かさない**
     ——1列ぶんスクロールするたびに組み直すと、それ自体が重い。 */
  moved(){
   if(!on())return false;
   const next=compute();
   if(next.from===win.from&&next.to===win.to)return false;
   win=next;return true;
  },
 };
}
/* 横スクロールで窓が動いたら本文だけ作り直す。世代が変われば降りる
   (前の一覧のスクロールで作り直さない。行の窓と同じ約束)。 */
function setupColumnWindow({gen,grid,colWin,redraw}){
 if(!grid||!colWin.enabled())return;
 let queued=false;
 const onScroll=()=>{
  if(queued)return;queued=true;
  requestAnimationFrame(()=>{
   queued=false;
   if(gen!==gridGeneration){grid.removeEventListener('scroll',onScroll);return}
   if(colWin.moved())redraw();
  });
 };
 grid.addEventListener('scroll',onScroll);
}
/* ---------- 一覧の列の並び(§9.106) ----------
   番号・ボタンの列も**データ列と同じ1本の並び**に載せる。列の設定パネルと
   一覧が同じ並びを見るための**唯一の出どころ**で、片方だけに列を足すと
   「設定画面では動かせるのに一覧は変わらない」が生まれる(実際に生まれた)。
   `__select__`(選択)と`__plan__`(＋予定)は**別の列**として持つ——1つに
   まとめると、colgroupと本文のセル数が合わなくなる。 */
const VIRTUAL_COLUMNS={
 '__select__':{label:'選択',width:30},
 '__plan__':{label:'予定',width:74},
 '#':{label:'#',width:0},                 // 幅は文字サイズから作る(下記)
 '__split__':{label:'分割',width:150},
 '__measure__':{label:'測定',width:86},
};
const isVirtualColumn=k=>Object.prototype.hasOwnProperty.call(VIRTUAL_COLUMNS,k);
/* 行番号の列は**その画面に実際に出る桁数**から決める（§9.239 ⑤-1 の追補）。
   以前は「3桁ぶん・0.55em・余裕なし」の決め打ちで、実測32pxに対して3桁の
   数字が40px要り**切れていた**（セルに`data-col`を足して`test_listperf`の
   「自動で決めた幅の列は溢れない」の網に入って初めて分かった）。数字は
   等幅（`font-variant-numeric:tabular-nums`）なので0.55emより広い。
   全件表示では4〜5桁になるので、桁数は呼ぶ側が渡す。 */
const virtualColumnWidth=(k,metrics,digits)=>
  k==='#'?Math.round(Math.max(2,digits||3)*0.62*metrics.fs+metrics.padX*2+2+COL_W_SLACK)
         :(VIRTUAL_COLUMNS[k]||{}).width||80;
/* **列名は1つずつしか出さない**(§9.113)。列は名前で引く(`data-col`・
   幅・書式・読み替え・並び順のすべてが列名を鍵にしている)ので、同じ名前が
   2つある並びは表として成り立たない——見出しもセルも二重に描かれ、
   画面では「列が増殖した」ように見える。名前が重なりうる出どころは
   いくつもある(結合してきた列、計算で作った列、データ側の列名変更、
   ビュー越しの取得)ので、**入口で1回だけ**落とす。
   最初に出てきた位置を残す(利用者が並べた順を崩さないため)。 */
const uniqueKeys=keys=>{
 const seen=new Set(),out=[];
 (keys||[]).forEach(k=>{if(k==null||seen.has(k))return;seen.add(k);out.push(k)});
 return out;
};
WL.uniqueColumnKeys=uniqueKeys;
/* 今の画面で出しうる列を既定の並びで返す。`cols`を省くと`S.columns`。 */
function listColumnKeys(cols){
 const isWork=WL.dataSource.isWork(S.db);
 const canPlan=isWork&&window.accessMode?.mode==='schedule';
 const out=[];
 if(canPlan)out.push('__select__','__plan__');
 out.push('#');
 if(isWork)out.push('__split__');
 out.push(...(cols||S.columns||[]));
 /* 計算で作る列(§9.111 ⑦)は**データ側に無い**ので、ここで足さないと
    どこにも出てこない。並び・幅・書式はデータ列と同じ仕組みに乗る。 */
 const target=typeof listLayoutTarget==='function'?listLayoutTarget():'';
 if(target){
  Object.keys(WL.columnLayout.formulas(target)).forEach(k=>{if(!out.includes(k))out.push(k)});
 }
 if(isWork)out.push('__measure__');
 return uniqueKeys(out);
}
WL.listColumnKeys=listColumnKeys;
/* 覚えている並びを当てはめる。**番号・ボタンの列が1つも入っていない
   並びは、データ列だけを保存していた頃のもの**(§9.110)なので、末尾へ
   流さず本来の位置へ戻す。

   直しただけでは足りない——**既に壊れた形で保存された設定が実機に残って
   いる**ので、読むときに直す(こちらが直さないと、利用者が#・分割・測定を
   手で引きずり戻すことになる)。データ列の並びは覚えているものを尊重し、
   番号・ボタンの列だけを`listColumnKeys()`の位置へ差し戻す。 */
function healedColumnOrder(target,cols){
 const canonical=listColumnKeys(cols);          // ここで既に一意
 const stored=WL.columnLayout.get(target).order||[];
 /* **覚えている並びも一意にしてから使う**(§9.113)。マスタは書くときに
    重複を落とすが、画面が保存前に当てている下書き(`stage`)や、古い端末が
    書いた並びまでは保証できない。ここを素通しにすると`known`が二重になり、
    そのまま見出しとセルが二重に出る。 */
 const known=uniqueKeys(stored.filter(c=>canonical.includes(c)));
 if(!stored.length||stored.some(isVirtualColumn))
  return [...known,...canonical.filter(c=>!known.includes(c))];
 // データ列は覚えている順のまま、番号・ボタンの列だけ本来の位置へ戻す。
 const dataOrder=[...known.filter(c=>!isVirtualColumn(c)),
                  ...canonical.filter(c=>!isVirtualColumn(c)&&!known.includes(c))];
 let i=0;
 return canonical.map(k=>isVirtualColumn(k)?k:dataOrder[i++]).filter(Boolean);
}
/* 実際に描く列。上の並びから「出さない」を落とすだけ。 */
function orderedListColumns(target,cols){
 const hide=new Set(WL.columnLayout.get(target).hidden||[]);
 return healedColumnOrder(target,cols).filter(c=>!hide.has(c));
}
WL.healedColumnOrder=healedColumnOrder;
WL.orderedListColumns=orderedListColumns;
WL.isVirtualColumn=isVirtualColumn;
WL.virtualColumnLabel=k=>(VIRTUAL_COLUMNS[k]||{}).label||k;
// Add an explicit virtual action column instead of writing into the last data column.
/* 0行のときは**なぜ空か・次に何をするか**を表の中で言う（利用者の報告「必須データが
   ない場合もエラーが出ないのは問題」）。見出しだけの表は「読み込み中」「壊れている」
   「本当に無い」の区別がつかない。見る順は、利用者が絞った → 画面で伏せた →
   元データが空。**元データが空なのはエラー**として出す（届くはずのデータが無い）。
   結合に失敗していれば、その理由も同じ枠に添える。 */
/* ---------- 絞った結果が0件のとき（§9.453、利用者の指示「フィルタが効いて、検索結果が
   1つもない場合も表示部分にわかりやすく情報を出すように」） ----------
   **何が効いているかを出どころつきで並べ、外す手を1つだけ置く**。「絞り込みに当たる行が
   ありません」だけでは、自分で掛けた覚えの無い条件（いつも適用・覚えていた条件）に
   気づけない——実際に「仕掛一覧が出ない」の原因がそれだった（§9.452）。
   名乗るのは登録口（`onNarrow`）の各提供者。検索欄はこのファイルが持つので自分で名乗る。 */
let narrowClears=[];
function narrowingParts(){
 const items=[];narrowClears=[];
 const box=$('#search'),sv=String(box&&box.value||'').trim();
 if(sv){items.push({source:'一覧を検索',text:`「${sv}」`});narrowClears.push(()=>{box.value=''})}
 listHooks.narrow.forEach(fn=>{
  try{const r=fn();if(r&&(r.items||[]).length){items.push(...r.items);if(r.clear)narrowClears.push(r.clear)}}
  catch(e){console.error('一覧のnarrowフックで例外',e)}
 });
 return items;
}
function narrowedNote(label){
 const items=narrowingParts();
 const locked=items.some(x=>x.locked);
 const list=items.map(x=>`<li><span class="list-empty-src">${esc(x.source)}</span><span>${esc(x.text)}`
  +(x.locked?' <span class="list-empty-lock">いつも適用</span>':'')+'</span></li>').join('');
 /* 見出しは中央、中身（件数→条件→断り）は左揃えのひと塊、押す物はその下に1つ。
    条件の並びは出どころの札の列で左端をそろえる（札の幅で字の頭がずれない・画面基準9）。 */
 return `<div class="record-empty list-empty-narrow" role="status"><b>検索・絞り込みに当たる行がありません</b>`
  +'<div class="list-empty-body">'
  +(items.length?`<div class="record-empty-why">いま効いている条件（${items.length}件）</div><ul class="list-empty-conds">${list}</ul>`:'')
  +(locked?'<div class="record-empty-why">「いつも適用」の条件は、この一覧を開くたびに自動で入ります。'
    +'毎回入れないようにするには、プリセットのメニューで「いつも適用」を外します。</div>':'')
  +'</div>'
  +`<div><button type="button" data-empty-clear>条件を外して${label}の全件を見る</button></div></div>`;
}
/* 外すのは各提供者、読み直しはここで1回だけ（提供者ごとに読み直すと往復が重なる）。 */
async function clearNarrowing(){
 for(const fn of narrowClears){
  try{await fn()}catch(e){console.error('絞り込みを外せませんでした',e)}
 }
 S.page=1;await load();
}
function listEmptyNote(visible){
 if(visible&&visible.length)return '';
 const label=esc(WL.base.databaseLabel(S.db));
 const jq=S.joinQuality;
 const joinWhy=(jq&&(jq.failedReasons||[]).length)
  ?`<span>結合できなかったもの: ${esc((jq.failedNames||[]).map((n,i)=>`${n}: ${jq.failedReasons[i]}`).join('／'))}</span>`:'';
 const q=listQuery();
 if(q.get('search')||q.get('filters'))return narrowedNote(label);
 if(S.rows&&S.rows.length)
  return `<div class="record-empty" role="status">読み込んだ${S.rows.length}行は、すべて作業予定に入っているので伏せています。</div>`;
 const file=((S.catalog||[]).find(x=>x.key===S.db)||{}).file_name||'';
 return `<div class="load-error" role="alert"><b>${label}の表「${esc(S.table||'')}」にデータが1行もありません</b>`
  +`<span>元データ${file?`（${esc(file)}）`:''}が空か、読み込み先が違います。`
  +`マスタ管理 &gt; データ接続 で置き場を確かめてください。別の表を開くときは、上の表名のバッジから選べます。</span>`
  +joinWhy+`</div>`;
}
function renderGrid(){
 /* **描画にかかった時間はここで測る。** filters.js が load() を丸ごと
    置き換えるため、load()側に置くと絞り込みを使ったときだけ測れなくなる
    (§9.88と同じ落とし穴)。renderGridは両方の経路が必ず通る。 */
 const _t0=performance.now();
 /* **描き直しで先頭へ飛ばさない**（§9.357、利用者の指示「D&Dでスケジュール表へ
    追加する際にスクロール位置が戻されてしまう」）。スケジュール画面は1件足すたびに
    `refreshScheduledLotFilter()` から**この関数だけ**を呼ぶ——`load()` の中の
    `keepGridScroll()` を通らないので、控える相手が居らず毎回先頭へ戻っていた。
    「次の1件」を探し直すことになり、続けて足す作業が成り立たない。
    戻すのは行を並べ終えてから（`applyPendingScroll()`・§9.95）。 */
 keepGridScroll();
 try{return renderGridInner()}
 finally{noteRenderTime(performance.now()-_t0);renderLoadChip();runListHooks('grid')}
}
/* ---------- 一覧の描画は段に分ける（§9.522・REVIEW 3-22） ----------
   以前は`renderGridInner()`の1本（554行）が、30近い局所変数を共有しながら
   ①何をどの列で描くか ②列の見え方 ③列幅 ④見出し ⑤行 ⑥器へ載せる ⑦続きを並べる
   を順に行っていた。段ごとの関数へ分け、段のあいだで渡す物は**この描画の文脈`g`の1つ**に
   まとめる（`gridScope()`が作り、②③④が書き足す）。
   **段の順番は描画の副作用の順番そのもの**なので入れ替えないこと——列の窓（`g.colWin`）は
   見出しを作ったあと・行を作る前、追い判定の世代（`gridGeneration`）は器へ載せたあとに読む。 */
function renderGridInner(){
 bumpGridGeneration();   // 前の描画に紐づく非同期判定を打ち切る(下のcheck*参照)
 const g=gridScope();
 gridColumnView(g);
 gridColumnWidths(g);
 const t=buildGridTable(g);
 const b=document.createElement('tbody');
 // 分割データはあるが子ロットが仕掛から見つからない行(=作業済みで仕掛から
 // 外れている可能性が高い)を、非同期の存在確認後にグリッド上で気づけるように
 // 更新する対象を集める(`split`・下のfeedRemainingRows参照)。
 // 親側の分割データは無い(=一見「分割なし」)行でも、「ｺﾝﾏ5本ｶｰﾄﾞ区分」が
 // 3の行は分割済みの子ロット自身であるため、親ロットを逆引き検索して
 // 気づけるようにする対象を集める(`parent`・checkParentLookupRows参照)。
 const targets={split:[],parent:[]};
 const buildRow=makeGridRowBuilder(g,b,targets);
 const feed=gridFeedPlan(g);
 for(let i=0;i<feed.first;i++)buildRow(g.visibleRows[i],i);
 t.append(b);
 mountGrid(g,t);
 feedRemainingRows(g,feed,b,buildRow,targets);
}

/* ① 何を・どの列で描くか。行（伏せる・畳む）と列（許す・並び）を決める。 */
function gridScope(){
 /* ロット問い合わせ(LotDsp)は仕掛一覧・品質データのどちらでも使えるように
    する。「測定」列(測定画面を開く)は**役割が「作業」のデータソース**専用。
    「予定」列(スケジュールへ追加、§9.5)も同じで、スケジュールモードの
    ときだけ出す(押せないボタンを他モードで見せない)。判定はキーの文字列
    ではなくデータソースマスタの役割で行う(§9.87)。 */
 const isWork=WL.dataSource.isWork(S.db),hasLotDsp=WL.dataSource.hasLot(S.db);
 const canPlan=isWork&&window.accessMode?.mode==='schedule';
 const g={isWork,hasLotDsp,canPlan,
  lotCol:hasLotDsp?findColumnFor('lotNo'):null,castCol:hasLotDsp?findColumnFor('castingNo'):null,
  filteredCols:new Set((S.genericFilters||[]).map(f=>f.column))};
 /* 一覧に出すべきでないロットは伏せる（§9.15＋§9.368）。答えるのは
    スケジュール画面の1箇所（`WL.scheduleView.hiddenLotSet()`）で、
      ・**予定に居るロット**（投入済みなので一覧に残すと二重に見える）
      ・**仕掛から消えたと確かめたロット**（外しても戻さない）
    の2つを1つの並びで返す。対象外（スケジュール画面を開いていない・
    schedule モードでない等）では`null`が返り、絞り込まない（全件表示）。 */
 const scheduledLots=canPlan?WL.scheduleView?.hiddenLotSet?.():null;
 const allVisibleRows=(scheduledLots&&scheduledLots.size)?S.rows.filter(r=>!scheduledLots.has(pick(r,'lotNo'))):S.rows;
 /* ---------- 分割ありの子ロットは親の直下へ畳む(§9.239 ⑤-2、利用者の指示) ----------
    「分割ありのものについて、親や子の情報が表示されますが、分割ありの子に
     ついては分割ありの対象の親の直下に添える形でたたみこんで表示するように
     してください」

    親子の関係は**この場で同期に分かる**——親行が持つ`親子管理_子カード`／
    `コンマ5本分割_切断巾`から子ロット番号を復元できる
    （`WL.split.childLots()`。問い合わせは要らない）。追い判定
    （`findParentLotFor`）は「親がこの画面に居ない子」のためのもので、
    畳むためには要らない。

    決めごと:
     ・**親がこの画面に居ない子は畳まない**（畳んで隠すと画面から消える。
       §9.15 の投入済みロットと同じ作法で、対象外は今までどおり出す）。
     ・**畳んでいる間は子の行を作らない**（§9.104「隠すだけでは足りない・
       作らない」）。件数・行の高さ・仮想行の計算がそのまま効く。
     ・**開いた/畳んだは覚える**（描き直しても戻らない。§9.175）。
     ・**畳んだ件数は必ず文字で出す**（§3。黙って行が減ると
       「絞り込んでいないのに件数が合わない」としか読めない）。 */
 g.childIndex=buildChildIndex(allVisibleRows,isWork);
 lastChildFold={folded:g.childIndex.size,tooMany:g.childIndex.tooMany};
 g.visibleRows=g.childIndex.size?allVisibleRows.filter(r=>!g.childIndex.has(r)):allVisibleRows;
 // スケジュール列表示マスタ(§9.18新設): scheduleモードで設備ごとに選んだ
 // 列だけへ絞る(未設定の設備・schedule以外のモードではnullが返り、
 // 通常どおり全列を表示する)。
 const columnAllowlist=canPlan?window.scColumnAllowlist?.():null;
 g.allowed=columnAllowlist?S.columns.filter(c=>columnAllowlist.includes(c)):S.columns;
 // 利用者が決めた並び・非表示を重ねる(§9.88)。記録に無い列は末尾へ回るので、
 // データ側の項目が増えても設定は壊れない。
 g.layoutTarget=listLayoutTarget();
 /* ---------- 並びは1本(§9.106) ----------
    番号・ボタンの列(`#`/`分割`/`測定`/`予定`/選択)も**データ列と同じ1本の
    並び**に載せる。以前はデータ列だけを`apply()`で並べ替え、番号・ボタンは
    `renderGridInner()`が決まった位置へ無条件に描いていたため、
    **列の設定パネルで動かした並びと実際の並びが食い違い**、チェックを
    外しても消えなかった(実機で報告された)。設定画面と一覧が同じ並びを
    見るために、出どころは`listColumnKeys()`ただ1つにする。 */
 g.ordered=orderedListColumns(g.layoutTarget,g.allowed);
 g.dataCols=g.ordered.filter(k=>!isVirtualColumn(k));   // 件数・書式の対象はデータ列
 return g;
}

/* ② 列の見え方（書式・読み替え・式）。**列ごとに1回だけ**引いて、セルの描画で使い回す。 */
function gridColumnView(g){
 const {layoutTarget,dataCols}=g;
 /* 書式(§9.88 段3)は列ごとに1度だけ引いて、セルの描画で使い回す。
    数値の書式を当てた列は**列ごと**右づめにする(桁を縦に揃えて読むため)。
    値ごとに決めると、数値として読めない値が1つ混ざった列で揃い方が乱れる。 */
 const colFmt=new Map(dataCols.map(c=>[c,WL.columnLayout.format(layoutTarget,c)]));
 const colRule=new Map(dataCols.map(c=>[c,WL.columnLayout.rule(layoutTarget,c)]));
 /* 計算で作る列(§9.111 ⑦)。**式は列ごとに1回だけ解いて使い回す**
    ——行ごとに解き直すと200行×列数ぶん効いてくる。壊れた式は
    その列を出さないのではなく、値を空にして残す(直せる場所へ辿れる)。 */
 const colCalc=new Map();
 dataCols.forEach(c=>{
  const src=WL.columnLayout.formula(layoutTarget,c);
  if(!src)return;
  try{colCalc.set(c,WL.formula.compile(src))}
  catch(e){colCalc.set(c,{run:()=>''})}
 });
 /* **式と読み替えは、いまの表示名でも元の列名でも列を引ける**（§9.464、利用者の報告
    「表示列の名前を変更しても、元の名前の列で条件を作ったり使えるように」）。行は
    生の列名で持っているので、式・条件が**書いた名前のうち行に無いもの**だけを
    `WL.columnLayout.keyByName()`で列へ当て、その名前で値を足した写しを渡す。
    当てるのは描くたびに1回（行ごとに探さない）。書いた名前がどれも行に在るなら写しを作らない。 */
 const nameKeys=(()=>{
  const want=new Set();
  colCalc.forEach(fn=>(fn.columns||[]).forEach(n=>want.add(n)));
  colRule.forEach(rn=>{if(rn&&WL.displayRules)WL.displayRules.columnsUsed(rn).forEach(n=>want.add(n))});
  const raw=S.columns||[],out=[];
  want.forEach(n=>{
   if(raw.includes(n))return;
   const k=WL.columnLayout.keyByName(layoutTarget,raw,n);
   if(k)out.push([n,k]);
  });
  return out;
 })();
 g.colFmt=colFmt;g.colRule=colRule;g.colCalc=colCalc;
 g.namedRow=r=>{
  if(!nameKeys.length||!r)return r;
  const o=Object.assign({},r);
  nameKeys.forEach(([n,k])=>{if(!(n in o))o[n]=r[k]});
  return o;
 };
 /* 読み替えが「表示の値」で見るとき（§9.474）の**列の見え方**。この一覧が持つ式・書式・読み替えを
    そのまま渡す（`WL.cellFormat`が見ている列だけを引く）。 */
 g.ruleView={
  key:n=>(colFmt.has(n)?n:(WL.columnLayout.keyByName(layoutTarget,dataCols,n)||n)),
  calc:k=>colCalc.get(k)||null, format:k=>colFmt.get(k)||null, rule:k=>colRule.get(k)||''
 };
 g.numCol=c=>colFmt.get(c)?.kind==='number';
}

/* ③ 列幅。**セルを描く前に決める**(§9.94)。colgroupへ入れるだけでなく、
   「その幅に入り切らない値へtitleを付ける」判断にも使うため。 */
function gridColumnWidths(g){
 const {layoutTarget,ordered,dataCols,visibleRows,colCalc,namedRow}=g;
 const metrics=gridMetrics();
 const widthSample=visibleRows.slice(0,COL_W_SAMPLE);
 /* 行番号に要る桁数は「このページの最後の番号」で決まる。 */
 const noDigits=String(Math.max(1,(S.page-1)*effectivePageSize()+Math.max(1,visibleRows.length))).length;
 g.colW=new Map(ordered.map(k=>[k,
   WL.columnLayout.width(layoutTarget,k)
   ||(isVirtualColumn(k)?virtualColumnWidth(k,metrics,noDigits)
      :estimateColumnWidth(WL.columnLayout.label(layoutTarget,k),
                           // 計算で作る列は**計算した値**で幅を見積もる
                           // (生のr[k]は無いので、そのままだと見出しの幅になる)。
                           widthSample.map(r=>colCalc.has(k)?colCalc.get(k).run(namedRow(r)):r[k]),
                           metrics.fs,metrics.padX))]));
 // その列に何文字ぶん入るか(em)。これを超える値は省略記号になる。
 g.colEm=new Map(dataCols.map(c=>[c,(g.colW.get(c)-metrics.padX*2-2)/metrics.fs]));
}

/* 番号・ボタンの列の揃え。**既定は今までの見え方**（選択/予定/#/分割/測定は
   それぞれCSSが中央や右にしていた）を`columnAlign`の既定に合わせて明示する
   ——`al-*`はutilityレイヤなので、当てた時点でCSS側の指定に勝つ。 */
const VIRT_ALIGN={'__select__':'center','__plan__':'center','#':'right',
                  '__split__':'center','__measure__':'center'};
function virtualAlignClass(target,k){
 const al=WL.columnLayout.align(target,k);
 if(al.data)return WL.columnAlign.classOf(al.data);
 return WL.columnAlign.classOf(VIRT_ALIGN[k]||'left');
}

/* ④ 見出し（thead・colgroup・列の窓・見出しの道具と並べ替えの配線）。 */
function buildGridTable(g){
 const {layoutTarget,ordered,colW}=g;
 const t=document.createElement('table');
 /* 見出し。**1本の並び(ordered)をそのまま辿る**ので、番号・ボタンの列が
    データ列の間に入っていてもそのとおりに出る(§9.106)。 */
 t.innerHTML='<thead><tr>'+ordered.map(k=>gridHeadCell(g,k)).join('')+'</tr></thead>';
 /* 幅はcolgroupで与える。thへ直接書くと、セル側の内容で押し広げられる。
    `table-layout:fixed`にしたので**全列に必ず幅を入れる**(§9.94)。
    入れ忘れた列は等分に割られ、見出しも値も潰れる。 */
 if(ordered.length){
  const cg=document.createElement('colgroup');
  ordered.forEach(k=>{
   const col=document.createElement('col');col.style.width=colW.get(k)+'px';cg.appendChild(col);
  });
  t.insertBefore(cg,t.firstChild);
  /* **表の幅は決めた幅の合計にする**(§9.119)。CSSの`width:max-content`の
     ままだと、`table-layout:fixed`でも表の幅を「各列の中身の最大幅」で
     解いてしまい、**colgroupの指定より見出しの文字幅が勝つ**。実測で、
     45pxを指定した列が171px(見出しの文字幅174px)になっていた——
     手で狭くしたつもりが一切効かない状態。
     合計を入れると指定どおりになり、器より狭いときはCSSの
     `min-width:100%`が広げてくれる(横スクロールの挙動は変わらない)。 */
  let total=0;ordered.forEach(k=>{total+=colW.get(k)||0});
  t.style.width=total+'px';
 }
 /* 本文の行は**窓の中の列だけ**組み立てる(§9.104)。見出しは全列のまま。
    窓は**1本の並び全体**に掛ける(番号・ボタンも並びの一部なので、
    左端に固定されているとは限らない)。 */
 g.colWin=makeColumnWindow({grid:$('#grid'),columns:ordered,
   widthOf:k=>colW.get(k),leadWidth:0});
 g.colWin.reset();
 bindColumnHeaderTools(t,layoutTarget,g.dataCols,g.allowed);
 /* クリック=この列だけで並べ替え / Shift+クリック=キーを追加(§9.88 段5)。
    既定を置き換えにしてあるのは、日々の操作のほとんどが「この列で並べたい」
    だから。2つ目以降が要る場面は少ないので、そちらへ修飾キーを割り当てる。 */
 const sortByHeader=(th,add)=>{
  WL.listSort.toggle(th.dataset.sortCol,!!add);
  S.page=1;load();
 };
 t.querySelectorAll('th[data-sort-col]').forEach(th=>{
  th.onclick=e=>sortByHeader(th,e.shiftKey);
  th.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();sortByHeader(th,e.shiftKey)}};
 });
 return t;
}

/* **どの見出しにも`data-col`を付ける**。セルと同じで、位置で数えずキーで
   引けるようにするため(§9.104)。見出しの右クリック(§9.110)は番号・
   ボタンの列にも効かせたいので、そこだけ属性が無いと分岐が増える。 */
/* 番号・ボタンの列も**掴んで動かせる・幅を引ける**（§9.239 ⑤-1）。
   取っ手(`.col-resize`)と`draggable`をデータ列と同じように付ける
   ——並びにも設定パネルにも載っている列が、見出しからだけ触れないのは
   「設定画面では動かせるのに一覧は変わらない」の裏返し（§9.106）。
   **並べ替え(`data-sort-col`)は付けない**（値を持たない列なので、
   押しても何で並べればよいか決められない）。 */
const VIRT_TIP={'__select__':'選択','__plan__':'予定の投入','#':'行番号',
                '__split__':'親子管理_子カード／コンマ5本分割_切断巾に実データがある場合「分割あり」と表示します',
                '__measure__':'測定を開く'};
/* 全選択のチェックからは掴ませない（§9.239 ⑤-1）——チェックを押した
   つもりで列の並べ替えが始まると、押した通りに動かない。 */
const VIRT_HEAD={'__select__':['plan-select-head','<input type="checkbox" id="planSelectAll" draggable="false" title="このページの全行を選択/解除">'],
                 '__plan__':['plan-action-head','予定'],'#':['grid-no-head','#'],
                 '__split__':['split-flag-head','分割'],'__measure__':['measurement-action-head','測定']};
function gridHeadCell(g,k){
 const {layoutTarget,colFmt}=g;
 if(VIRT_HEAD[k]){
  const [cls,inner]=VIRT_HEAD[k];
  return `<th class="${cls} ${WL.columnAlign.headClass(layoutTarget,k,'')}" data-col="${esc(k)}" draggable="true"`
   +` title="${esc(VIRT_TIP[k]||'')}｜ドラッグで列の入れ替え／右端の取っ手で列幅">`
   +inner
   +'<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></th>';
 }
 const c=k,filtered=g.filteredCols.has(c);
 /* 並び順の合図。**2つ以上のキーがあるときは順番も出す**——「何で並んで
    いるか」は分かっても「どちらが先か」が分からないと結果を読めない。 */
 const dir=WL.listSort.dirOf(c),rank=WL.listSort.rankOf(c),multi=WL.listSort.keys().length>1;
 const sorted=!!dir;
 /* 順番は**矢印の後ろ**に丸数字で置く。列名の直後に数字を置くと
    「製造材質2」のように列名の一部に見える(実際にそう見えた)。 */
 const arrow=sorted?((dir==='desc'?' ▼':' ▲')
   +(multi?`<i class="col-sort-rank" title="${rank}番目のキー">${'①②③④'[rank-1]||rank}</i>`:'')):'';
 /* 見出しは3役: クリックで並び替え / 掴んで左右へ動かすと列の並べ替え /
    右端の取っ手を引くと列幅。**取っ手はクリックを飲み込む**(引くつもりが
    並び替わると操作を取り消せない)。 */
 /* 揃えは`WL.columnAlign`の1箇所が答える(§9.239 ④)。`.col-num`は
    「数値の書式を当てた列」の印として残す(等幅数字の意味)が、
    **右づめにするかどうかはもう`.col-num`が決めない**——自動のときだけ
    書式を見て右へ倒すのは`columnAlign`の役目。 */
 return `<th class="sortable-col ${g.numCol(c)?'col-num':''} ${WL.columnAlign.headClass(layoutTarget,c,colFmt.get(c)?.kind||'')} ${filtered?'col-filtered':''} ${sorted?'col-sorted':''}" data-sort-col="${esc(c)}" data-col="${esc(c)}" draggable="true" tabindex="0" role="button" aria-label="${esc(WL.columnLayout.label(layoutTarget,c))}列で並び替え" title="${esc(c)}｜クリックで並び替え／ドラッグで列の入れ替え${filtered?'（絞り込み中の列です）':''}">${esc(WL.columnLayout.label(layoutTarget,c))}${arrow}${filtered?'<i class="col-filter-badge" aria-hidden="true" title="この列にフィルタが適用されています">▼</i>':''}<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></th>`;
}

/* ⑤ 行。1行ぶんのセル→行の配線→子ロットの畳み、の順に組み立てる関数を返す。 */
function makeGridRowBuilder(g,b,targets){
 return (r,i)=>{
  const tr=document.createElement('tr');
  const rowLot=String(pick(r,'lotNo')||'').trim();
  tr.innerHTML=gridRowCells(g,r,i,tr,rowLot,targets);
  /* しま模様は**クラスで塗る**（§9.239 ⑤-2）。`tbody tr:nth-child(even)`は
     DOMのパリティなので、子の行を差し込むと**それ以降の親のしまが反転する**
     （§9.115で紙が踏んだのと同じ罠）。親の並び順で決めれば、子を出しても
     親のしまは動かない。 */
  if(i%2===1)tr.classList.add('is-alt');
  tr.__row=r;   // 行→元データの逆引き(ドラッグ中の印付けに使う。§9.170)
  if(r===S.selectedRow)tr.classList.add('is-selected');
  if(g.canPlan&&S.selectedRows.has(r))tr.classList.add('is-plan-selected');
  bindGridRowActions(g,tr,r,b);
  bindGridChildFold(g,tr,r,rowLot);
  b.append(tr);
 };
}

/* 1本の並びを辿ってセルを作る(§9.106)。窓の外は`colspan`でまとめた
   空セルにする(§9.104)——**幅は1pxもずれない**(`table-layout:fixed`では
   colspanで束ねた幅がcolgroupの合計になる)。 */
/* **番号・ボタンの列は窓の外でも必ず作る**(§9.106)。畳んでしまうと、
   横へスクロールしただけで「測定」「＋予定」のボタンが**DOMごと消える**
   ——列を隠した覚えがないのに押せなくなる(実際に回帰テストが落ちた)。
   数は多くて5列なので、常に作っても重さに響かない。
   畳むのはデータ列だけで、続いた畳みぶんは1つのcolspanにまとめる。 */
function gridRowCells(g,r,i,tr,rowLot,targets){
 const {ordered,layoutTarget}=g;
 const vAl=k=>virtualAlignClass(layoutTarget,k);
 const {from,to}=g.colWin.get();
 const gap=n=>n>0?`<td class="grid-col-spacer" colspan="${n}"></td>`:'';
 let cells='',skipped=0;
 for(let ci=0;ci<ordered.length;ci++){
  const c=ordered[ci];
  if(!isVirtualColumn(c)&&(ci<from||ci>=to)){skipped++;continue}
  if(skipped){cells+=gap(skipped);skipped=0}
  /* **番号・ボタンのセルにも`data-col`を付ける**（§9.104「セルは位置で
     数えないこと。`data-col`で引く」）。以前はデータ列にしか付いておらず、
     キーで引く仕組み（列の一時的な色・揃え）がこの5列だけ効かなかった。 */
  /* 番号・ボタンの列も揃えを持てる（§9.239 ④）。既定は今までの見え方
     （中央／中央／右）で、変えたければ列の設定から。 */
  if(c==='__select__'){cells+=`<td class="plan-select-cell ${vAl(c)}" data-col="__select__"><input type="checkbox" class="plan-select-checkbox"></td>`;continue}
  if(c==='__plan__'){cells+=`<td class="plan-action-cell ${vAl(c)}" data-col="__plan__"><button type="button" class="plan-action-button" title="この行の設備の作業スケジュールへ追加します">+ 予定</button></td>`;continue}
  if(c==='#'){cells+=`<td class="grid-no-cell ${vAl(c)}" data-col="#">${(S.page-1)*effectivePageSize()+i+1}</td>`;continue}
  if(c==='__split__'){cells+=gridSplitCell(g,r,tr,rowLot,targets);continue}
  if(c==='__measure__'){cells+=`<td class="measurement-action-cell ${vAl(c)}" data-col="__measure__"><button type="button" class="measurement-action-button">開く</button></td>`;continue}
  cells+=gridDataCell(g,c,r);
 }
 return cells+gap(skipped);
}

/* 分割の印。**セルを作らないときも判定は要らない**ので、窓の中に
   入っているときだけ組み立てる(追い判定の対象もそのときだけ集める)。 */
function gridSplitCell(g,r,tr,rowLot,targets){
 const al=virtualAlignClass(g.layoutTarget,'__split__');
 const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(r):{hasSplit:false};
 if(info.hasSplit){
  const patternShort=info.widthPattern==='same'?'同幅':info.widthPattern==='different'?'異幅':'';
  const patternFull=info.widthPattern==='same'?'同一幅分割':info.widthPattern==='different'?'異幅分割':'幅パターン不明';
  /* ロット数と条数は別物なので両方出す(以前は条数をロット数として
     「分割あり(6)」のように表示していた)。セルは狭いので「ロット/条」
     の並びで短く、詳しくはツールチップで言い分ける。 */
  const strips=Number.isFinite(info.stripCount)?info.stripCount:info.lotCount;
  targets.split.push({tr,row:r});
  /* この一覧の中に子ロットの行が居るなら**畳むつまみ**を出す（§9.239 ⑤-2）。
     **件数を数字で出す**（`子N`）——開かなくても何本あるかが分かる
     （§9.199「親か子Nか、名前と数字を食い違わせない」）。 */
  const kids=g.childIndex.childrenOf(r);
  const fold=kids.length
    ?`<button type="button" class="grid-child-toggle" aria-expanded="${openChildParents.has(rowLot)?'true':'false'}"`
     +` title="この一覧に居る子ロット ${kids.length}件を${openChildParents.has(rowLot)?'畳みます':'親の直下に出します'}：`
     +`${esc(kids.map(k=>String(pick(k,'lotNo')||'')).join('、'))}">`
     +`<i aria-hidden="true">${openChildParents.has(rowLot)?'▾':'▸'}</i>子${kids.length}</button>`
    :'';
  return `<td class="split-flag-cell split-yes ${al}" data-col="__split__" title="推定 ${info.lotCount}ロット / ${strips}条・${patternFull}（実際の子ロット数・条数・幅は測定画面で確定します）">${fold}分割あり(${info.lotCount}ロット/${strips}条)${patternShort?'・'+patternShort:''}</td>`;
 }
 if(typeof window.isChildCardClassifiedRow==='function'&&window.isChildCardClassifiedRow(r))targets.parent.push({tr,row:r});
 /* **切れたセルには生の値の`title`を必ず付ける**（§9.94）。この列は
    幅を40pxまで狭められるようになった（§9.239 ⑤-1）ので、
    `#grid td{overflow:hidden}`で「分割なし」が読めなくなりうる。 */
 return `<td class="split-flag-cell split-no ${al}" data-col="__split__" title="分割なし（親子管理_子カード／コンマ5本分割_切断巾に実データがありません）">分割なし</td>`;
}

/* データ列の1マス。 */
function gridDataCell(g,c,r){
 const {layoutTarget,colFmt,colRule,colCalc,namedRow,ruleView}=g;
 /* ロット番号の字も作り方の式・書式・読み替えを通す（§9.489）。**開く先は生のロット番号**のまま
    （下の配線が`pick(r,'lotNo')`で読む）——見せ方を変えても問い合わせる番号は変わらない。 */
 if(c===g.lotCol){const lc=colCalc.get(c),lr=namedRow(r);
  const lotVal=WL.cellFormat.cell({raw:lc?lc.run(lr):r[c],format:colFmt.get(c),rule:colRule.get(c),row:lr,column:c,view:ruleView}).text;
  return `<td class="lot-cell ${WL.columnAlign.cellClass(layoutTarget,c,colFmt.get(c)?.kind||'')}" data-col="${esc(c)}"><button type="button" class="lot-dsp-link grid-lot-link" title="クリックでLotDspをこのロット番号で開きます">${esc(lotVal)||'—'}</button></td>`}
 /* 読み替え(段4)→書式(段3)の順で通してから出す。どちらも失敗したら
    生の値が出るので、指定を間違えても値が消えることはない。 */
 /* 計算で作る列(§9.111 ⑦)は、その行の値から作ってから同じ道を通す
    ——書式・読み替え・省略記号の扱いをデータ側の列と分けない。 */
 const calc=colCalc.get(c);
 const nr=namedRow(r);
 const rawVal=calc?calc.run(nr):r[c];
 const out=WL.cellFormat.cell({raw:rawVal,format:colFmt.get(c),rule:colRule.get(c),row:nr,column:c,view:ruleView});
 const raw=String(rawVal==null?'':rawVal);
 const cls=[g.numCol(c)?'col-num':'',WL.columnAlign.cellClass(layoutTarget,c,colFmt.get(c)?.kind||''),
            out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
 /* 幅を決め打ちする以上、入り切らない値は省略記号になる(§9.94)。
    **切れたものは必ずtitleで読めるようにする**——読めない文字が
    黙って消えるのは、狭い列より悪い。 */
 const clipped=textWidthEm(out.text)>g.colEm.get(c);
 const tip=(out.text!==raw||clipped)?` title="${esc(raw)}"`:'';
 return `<td data-col="${esc(c)}"${cls?` class="${cls}"`:''}${tip}>${esc(out.text)}</td>`;
}

/* 行の配線（選ぶ・測定を開く・予定へ入れる・掴んで運ぶ・LotDsp）。 */
function bindGridRowActions(g,tr,r,b){
 tr.addEventListener('click',()=>{
  if(S.selectedRow===r)return;
  S.selectedRow=r;
  b.querySelectorAll('tr.is-selected').forEach(x=>x.classList.remove('is-selected'));
  tr.classList.add('is-selected');
 });
 if(g.isWork){
  tr.classList.add('measurement-row');
  /* **差し込む位置を決めて開いているときは、その位置へ入れる**(§9.179)。
     作業スケジュールで隙間をダブルクリックしてこの一覧を開いた場合だけで、
     それ以外は今までどおり測定画面が開く——文脈で意味が変わる操作は、
     その文脈が画面に出ているとき(隙間が見えているとき)だけにする。 */
  const open=e=>{
   if(window.WL&&WL.scheduleInsert&&WL.scheduleInsert.pending()){
    e.preventDefault();e.stopPropagation();
    WL.scheduleInsert.insertRow(r);
    return;
   }
   e.preventDefault();e.stopPropagation();
   WL.records.openMeasurement(r).catch(err=>alertModal('測定画面を開けません: '+err.message));
  };
  /* 行のダブルクリックは**ボタンを消しても残す**——測定を開く導線が
     1つも無くなると、列を隠しただけで機能ごと失われる。 */
  tr.addEventListener('dblclick',open);
  const mb=tr.querySelector('.measurement-action-button');
  if(mb)mb.onclick=open;
 }
 if(g.canPlan)bindGridRowPlan(g,tr,r);
 if(g.hasLotDsp){
  const lotBtn=tr.querySelector('.grid-lot-link');
  if(lotBtn)lotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();WL.base.openLotDsp(pick(r,'lotNo'),g.castCol?r[g.castCol]:pick(r,'castingNo'),WL.lotDspTab.get())};
 }
}

/* 予定へ入れる道（＋予定・選ぶチェック・掴んで運ぶ）。スケジュールモードの作業の一覧だけ。 */
function bindGridRowPlan(g,tr,r){
 const planBtn=tr.querySelector('.plan-action-button');
 if(planBtn)planBtn.onclick=e=>{e.preventDefault();e.stopPropagation();window.scheduleAddFromRow?.(r)};
 const checkbox=tr.querySelector('.plan-select-checkbox');
 if(checkbox){
  checkbox.checked=S.selectedRows.has(r);
  checkbox.addEventListener('click',e=>e.stopPropagation());
  checkbox.addEventListener('change',()=>{
   if(checkbox.checked)S.selectedRows.add(r);else S.selectedRows.delete(r);
   tr.classList.toggle('is-plan-selected',checkbox.checked);
   syncPlanSelectAll(g.visibleRows);renderPlanSelectBar(true);
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
  try{e.dataTransfer.setData('text/plain',dragRows.map(x=>pick(x,'lotNo')||'').join('、'))}catch(err){WL.quiet.note('一部ブラウザでのsetData制限は無視する',err)}
  /* **運んでいる行を全部そう見せる**(§9.170)。ブラウザが作るドラッグの
     写しは掴んだ1行だけなので、印が1行にしか付いていないと「1件しか
     運んでいない」と読める(まとめて投入したつもりが1件だった、という
     取り違えが起きる)。選択件数は選択バーが文字で出している。 */
  markRowsDragging(dragRows,true);
 });
 tr.addEventListener('dragend',()=>{
  const rows=window.__scDragRows;
  tr.classList.remove('is-row-dragging');
  if(rows)markRowsDragging(rows,false);
  window.__scDragRows=null;
 });
}

/* ---------- 子ロットの行(§9.239 ⑤-2) ----------
   **畳んでいる間は作らない**。押した時点で親の直下へ差し込み、
   もう一度押すと取り除く（表そのものは描き直さない——横スクロールも
   選択も失わないため）。 */
function bindGridChildFold(g,tr,r,rowLot){
 const kidRows=g.childIndex.childrenOf(r);
 if(!kidRows.length)return;
 const paintKids=on=>{
  tr.parentNode&&[...tr.parentNode.querySelectorAll(`tr.grid-child-row[data-child-of="${CSS.escape(rowLot)}"]`)]
    .forEach(x=>x.remove());
  if(!on)return;
  let at=tr;
  kidRows.forEach(child=>{const c=gridChildRow(g,child,rowLot);at.insertAdjacentElement('afterend',c);at=c});
 };
 const btn=tr.querySelector('.grid-child-toggle');
 if(btn)btn.onclick=e=>{
  e.preventDefault();e.stopPropagation();
  const on=!openChildParents.has(rowLot);
  if(on)openChildParents.add(rowLot);else openChildParents.delete(rowLot);
  btn.setAttribute('aria-expanded',on?'true':'false');
  btn.querySelector('i').textContent=on?'▾':'▸';
  btn.title=`この一覧に居る子ロット ${kidRows.length}件を${on?'畳みます':'親の直下に出します'}：`
    +kidRows.map(k=>String(pick(k,'lotNo')||'')).join('、');
  paintKids(on);
 };
 /* 描き直しのあとも開いたままにする（§9.175）。 */
 if(openChildParents.has(rowLot))requestAnimationFrame(()=>{if(tr.isConnected)paintKids(true)});
}

/* 子の行は**親と同じ列の並び**に乗せる（§9.197）。
   ロット番号の列より手前を1つのcolspanでまとめ、ロット番号の列に
   子ロット番号、その右から端までを内訳の1マスにする（§9.235 ③と
   同じ「内訳は1マスにまとめる」）。**colspanの合計は必ず列数と一致
   させること**——`table-layout:fixed`では合計が食い違うと表の幅が
   ずれる（§9.104）。 */
function gridChildRow(g,child,rowLot){
 const {ordered}=g;
 const lotAt=g.lotCol?ordered.indexOf(g.lotCol):-1;
 const c=document.createElement('tr');
 c.className='grid-child-row';
 c.dataset.childOf=rowLot;
 /* **子行自身の行データ**を入れる（親を入れると、掴んだとき親子が
    一緒に運ばれ、選択も二重に数えられる）。 */
 c.__row=child;
 const lot=String(pick(child,'lotNo')||'')||'—';
 const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(child):null;
 const w=child[findColumnFor('mfgWidth')]??'';
 const bits=[w!==''&&w!=null?`幅 ${esc(String(w))}`:'',
             info&&Number.isFinite(info.stripCount)&&info.stripCount>1?`${info.stripCount}条`:'']
   .filter(Boolean).join(' / ');
 const detail=`<span class="grid-child-info">子ロット${bits?'・'+bits:''}`
   +`<i>（親 ${esc(rowLot)} の分割後）</i></span>`;
 if(lotAt<0){
  c.innerHTML=`<td class="grid-child-cell" colspan="${ordered.length}">`
    +`<span class="grid-child-mark" aria-hidden="true">└</span>`
    +`<b>${esc(lot)}</b>${detail}</td>`;
  return c;
 }
 const head=lotAt>0?`<td class="grid-child-cell" colspan="${lotAt}"><span class="grid-child-mark" aria-hidden="true">└</span></td>`:'';
 const tail=ordered.length-lotAt-1;
 c.innerHTML=head
   +`<td class="grid-child-cell grid-child-lot" title="${esc(lot)}">${lotAt>0?'':'<span class="grid-child-mark" aria-hidden="true">└</span>'}<b>${esc(lot)}</b></td>`
   +(tail>0?`<td class="grid-child-cell" colspan="${tail}">${detail}</td>`:'');
 return c;
}

/* ---------- 大きい表は少しずつ並べる(§9.94) ----------
   セル数(行×列)に比例してブラウザのレイアウトが重くなる。実測すると
   200行×214列=42,800セルで**約3秒、その間まったく操作できない**
   (罫線もCSSも外した素の表でも1秒近くかかるので、書き方の問題ではなく
   セルの数そのもの)。一度に全部を渡すと、その3秒が1つの塊になる。
   最初の一塊だけ描いて渡し、**残りはフレームごとに継ぎ足す**。合計の
   時間は変わらないが、その間ずっとスクロールも切替もできる。
   小さい表(下のしきい値以下)は今までどおり一度に描く——分割すると
   「1行ずつ現れる」だけで、速くも見やすくもならない。

   継ぎ足しは**1回ごとに表全体のレイアウトが起きる**ので、細かく割るほど
   合計は増える(実測: 20行ずつで合計4.7秒、5行ずつだと7.3秒)。そこで
   **最初だけ小さく、あとは倍々に**する——最初の一画面はすぐ出て、
   そのあとは大きく取って回数を減らす。 */
const FIRST_CELLS=700,MAX_CELLS=9000;
/* このセル数までは一度に描く。**下回る表では分けない**——分けても
   速くならず、「行が後から生えてくる」動きだけが増える。 */
const CHUNK_MIN_CELLS=8000;
/* ---------- 行が多いときは見えている分だけ置く(§9.95) ----------
   「全件」を入れると行数が桁で増える。3,000行×214列=642,000セルは、
   少しずつ並べても**並べ終えるまでに数十秒**かかる(セル数に比例するのは
   §9.94のとおり)。人が一度に読めるのは画面に入る数十行だけなので、
   **DOMへ置くのも画面の前後だけ**にする。データ(S.rows)は全部持っている
   ので、件数・並べ替え・絞り込み・検索は今までどおり全件に効く。
   しきい値を超えたときだけ効かせる——200件・500件の表は今までと1行も
   変わらない(既存の見え方・テストをそのまま残すため)。 */
const VIRTUAL_MIN_ROWS=600, VIRTUAL_OVERSCAN=14;
/* 並べ方（一度に／少しずつ／見えている分だけ）と、最初に並べる行数。 */
function gridFeedPlan(g){
 const rows=g.visibleRows.length,colCount=g.ordered.length;
 const rowsFor=cells=>Math.max(5,Math.floor(cells/Math.max(1,colCount)));
 const virtual=rows>VIRTUAL_MIN_ROWS;
 const chunked=!virtual&&rows*colCount>CHUNK_MIN_CELLS&&rows>rowsFor(FIRST_CELLS);
 return {virtual,chunked,colCount,rowsFor,first:(virtual||chunked)?rowsFor(FIRST_CELLS):rows};
}

/* ⑥ 器へ載せる（空の理由・ページ送り・全選択・選択バー・道具列）。 */
function mountGrid(g,t){
 const {visibleRows,canPlan}=g;
 /* **いまどの対象の一覧か**を器に刻む（§9.239 ⑤-3）。列の一時的な色は
    列名（`data-col`）で塗るので、器を絞らないと**別のDB・別の表の同じ
    名前の列**まで塗られる。 */
 const gridEl=$('#grid');
 if(gridEl)gridEl.dataset.lt=g.layoutTarget||'';
 gridEl.replaceChildren(t);
 const emptyNote=listEmptyNote(visibleRows);
 if(emptyNote)gridEl.insertAdjacentHTML('beforeend',emptyNote);
 const emptyClear=gridEl.querySelector('[data-empty-clear]');
 if(emptyClear)emptyClear.onclick=clearNarrowing;
 /* 全件はページの概念が無い(1枚に全部出す)。ページ送りは押せなくする
    ——押せるのに何も起きないボタンは「壊れている」と受け取られる。 */
 allRowsProgress(S.rows.length,S.count);
 renderPager();
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
}

/* ⑦ 続きを並べる（見えている分だけ／少しずつ／一度に）と、並べ終えてからの追い判定。 */
function feedRemainingRows(g,feed,b,buildRow,targets){
 const {visibleRows,colWin}=g;
 const gen=gridGeneration;
 /* 追い判定は**全部並べ終えてから**(§9.94)。継ぎ足しの途中で始めると、
    まだ作られていない行の印を付け損なう。 */
 const afterRows=()=>{
  if(gen!==gridGeneration)return;
  applyPendingScroll();
  if(!targets.split.length&&!targets.parent.length)return;
  whenIdle(()=>{
   if(gen!==gridGeneration)return;
   prefetchSplitLookups([...targets.split,...targets.parent]).then(()=>{
    if(gen!==gridGeneration)return;
    checkSplitRowsForMissingChildren(targets.split);
    checkParentLookupRows(targets.parent);
   });
  });
 };
 const clearTargets=()=>{targets.split.length=0;targets.parent.length=0};
 if(feed.virtual){
  const rows=setupVirtualRows({gen,grid:$('#grid'),tbody:b,rows:visibleRows,
   colCount:feed.colCount,overscan:VIRTUAL_OVERSCAN,buildRow,reset:clearTargets,afterRows});
  // 横に動いたら、いま出ている行だけを組み直す(行の窓に組み直しを頼む)。
  setupColumnWindow({gen,grid:$('#grid'),colWin,redraw:rows.redraw});
  return}
 /* 行の窓が要らない表(しきい値以下)でも、列の窓は効かせる。横に動いたら
    その場で全行を作り直す——窓の中は十数列なので、500行でも1万セル級。 */
 const redrawAll=()=>{
  if(gen!==gridGeneration)return;
  clearTargets();b.replaceChildren();
  for(let i=0;i<visibleRows.length;i++)buildRow(visibleRows[i],i);
  afterRows();
 };
 if(!feed.chunked){afterRows();setupColumnWindow({gen,grid:$('#grid'),colWin,redraw:redrawAll});return}
 const t0=performance.now();
 let at=feed.first,cells=FIRST_CELLS*2;
 const more=()=>{
  if(gen!==gridGeneration)return;              // 描き直された: 続きは要らない
  const end=Math.min(visibleRows.length,at+feed.rowsFor(cells));
  cells=Math.min(MAX_CELLS,cells*2);
  for(;at<end;at++)buildRow(visibleRows[at],at);
  if(at<visibleRows.length){requestAnimationFrame(more);return}
  // 全部並べ終えた時点の時間を「表示」として記録し直す(内訳の札を正しくする)
  noteRenderTime((lastLoadBreakdown?.render||0)+(performance.now()-t0));
  renderLoadChip();
  afterRows();
  // 継ぎ足しが終わってから聞き始める(途中で作り直すと`at`が食い違う)。
  setupColumnWindow({gen,grid:$('#grid'),colWin,redraw:redrawAll});
 };
 requestAnimationFrame(more);
}

/* ---------- 親子の索引(§9.239 ⑤-2) ----------
   `Map(子行 → {parent:親行, lot:子ロット番号})` と
   `Map(親行 → [子行…])` を1度に作る。**この描画に居る行だけ**が対象。

   材料は行の生データだけ（`WL.split.hasSplit()` / `WL.split.childLots()`）で、
   **問い合わせは1回も出さない**。1行あたり最大38回のフィールド探索なので、
   行が多い表では作らない（§9.94。仮想行が効く600行超は、開くと行の高さの
   計算が狂うので畳む仕組みごと使わない・§9.95）。 */
const CHILD_FOLD_MAX_ROWS=600;
function buildChildIndex(rows,isWork){
 const of=new Map(),kids=new Map();
 const api={size:0,has:r=>of.has(r),parentOf:r=>of.get(r),childrenOf:r=>kids.get(r)||[],
            tooMany:false};
 if(!isWork||!rows||!rows.length)return api;
 if(!window.WL||!WL.split||typeof WL.split.childLots!=='function'
    ||typeof WL.split.hasSplit!=='function'){
  console.error('一覧の親子の畳み込み: WL.split.childLots が見つかりません');
  return api;
 }
 /* **行が多いときは畳まない**。理由は画面に出す（§4）。 */
 if(rows.length>CHILD_FOLD_MAX_ROWS){api.tooMany=true;return api}
 const byLot=new Map();
 rows.forEach(r=>{const lot=String(pick(r,'lotNo')||'').trim();if(lot&&!byLot.has(lot))byLot.set(lot,r)});
 rows.forEach(r=>{
  if(!WL.split.hasSplit(r))return;
  const lot=String(pick(r,'lotNo')||'').trim();
  const list=[];
  WL.split.childLots(r,lot).forEach(k=>{
   const child=byLot.get(String(k||'').trim());
   /* 自分自身は子にしない（同じロット番号が親子で重なる形は作らない）。 */
   if(!child||child===r||of.has(child))return;
   of.set(child,{parent:r,lot:String(k)});
   list.push(child);
  });
  if(list.length)kids.set(r,list);
 });
 api.size=of.size;
 return api;
}
/* 開いている親（ロット番号で覚える）。**画面を描き直しても戻らない**
   ——開いた本人にとっては「まだ見ている」状態なので、勝手に閉じない。 */
const openChildParents=new Set();
WL.listChildFold={
 opened:()=>[...openChildParents],
 clear:()=>{openChildParents.clear()},
};

/* ---------- 一覧のツールバー ----------
   一覧そのものに属する操作(表示列の選択)と状態(品質データ結合の結果)は、
   一覧と同じ場所へ置く。#gridは分割表示・ポップアップ表示へDOMごと
   移動する(schedule-view.jsのmoveGridTo)ため、このツールバーも#gridの
   直前の兄弟として一緒に動かす。以前は「表示する列の選択」が作業スケジュール
   画面のヘッダーにあり、操作対象(仕掛一覧)から離れていて何に効くのか
   分かりにくかった。 */
/* ---------- 一覧の「どこを見ているか／いつのデータか」（§9.286 ②③④） ----------
   利用者の指示②「表示件数制限がある場合は、ページめくりボタンを付けてください。
   フィルタした後に他のデータにアクセスできないことがある不具合です」
   ④「読み取り専用の元データの再読み込み(更新)機能…今見ているのがいつの
   データかわかるような表示も一覧表確認時に見えるようにお願いしたいです」

   **一覧に属する操作は一覧と一緒に運ぶ。** 以前は表示件数と再読込がヘッダー
   （`.hd-actions.global-actions`）、ページャが`<footer>`に居たが、**どちらも
   `body.sc-mode`で伏せられる**——作業スケジュールの仕掛一覧では、絞り込んだ
   あと2ページ目へ行く手立ても、元データを取り直す手立ても無かった。
   ツールバー（`#listToolbar`）は`#grid`と一緒に分割表示・ポップアップへ移る
   （§9.10の`moveGridTo`）ので、ここへ置けば3つの置き場すべてで使える。

   **IDは変えない**——`#pageSize`/`#prev`/`#page`/`#next`/`#count`/
   `#listFreshness`は既存の配線と網がそのまま効く。
   並びは決める順（§CLAUDE 14）: いつのデータか → 何件ずつ → 何ページ目。 */
function ensureListToolbar(){
 let bar=document.getElementById('listToolbar');
 const grid=$('#grid');
 if(!grid||!grid.parentNode)return null;
 if(!bar){
  bar=document.createElement('div');bar.id='listToolbar';bar.className='list-toolbar';bar.hidden=true;
  /* 行間(§9.88)は**動かした瞬間に反映**する。数値を入れて確定させる形にすると、
     どの値が自分に合うのかを試せない(見て決めるものなので、見ながら動かす)。
     保存は離した時点で1回だけ(動かしている間ずっと書きに行かない)。 */
  /* ツールバーは**3つの群**に分ける(§9.90)。以前は「表示列・行間・並びの札・
     いつも使う並び(選択)・保存・削除・結合の状態」が同じ高さで一列に並び、
     どれが設定でどれが状態なのか、どこまでが1つのまとまりなのかが
     読み取れなかった。近接と囲みで群を作る(ゲシュタルトの近接・共通領域)。
       [ 見せ方 ] 表示列・行間      … この一覧の見た目を決める
       [ 並び   ] 今の並び・いつも使う並び … 並べ替えに関するものだけ
       [ 状態   ] 品質データ結合     … 操作ではなく結果。右端へ寄せる
     「いつも使う並び」は**選択+保存+削除の3つを1つのメニューへ畳んだ**。
     常に出しておく必要があるのは「今どの並びか」だけで、保存・削除は
     必要になったときに開けばよい(段階的な開示)。固定幅のselectを
     やめたので、長い名前が途中で切れることも無くなる。 */
  /* ---------- 2段にする（§9.468、利用者の指示） ----------
     「すぐに必要な機能とそうでもない機能、常に見えていないといけない表示と調べて
      わかればよい表示に分けて、機能を維持しつつ使いやすいUIUX設計でメニュー構成を
      見直してほしい」。スケジュールと並べた幅380pxで**5段・236px**に折れていた。
       1段目（すぐ使う操作）… 絞り込みのバー（filters.js）＋「☰ 表示」
       2段目（常に見る状態）… 元データの時刻・件数とページ・結合・色の印
     **決めたら触らない設定**（表示列・行間・並び・表示件数・子ロット）は「☰ 表示」の
     浮きパネルへ畳む。IDは変えない（配線と網がそのまま効く）。群を枠で囲むのは
     やめた——枠の中に枠を作らない（§CLAUDE 画面基準 10）。
     「☰ 表示」のボタンは絞り込みのバーの席（`#filterBarSlot`）へ移して1段目に置く
     （`placeViewButton()`）。バーが無い一覧ではこの帯の先頭に残る。 */
  /* ---------- 「表示列」は帯へ直に、残りは「表の見せ方」（§9.505、利用者の指示） ----------
     §9.476 で「表示列の編集はよく使う」を受けてパネルのいちばん上へ置いたが、まだ
     「開く→押す」の2手だった。**よく使うものは畳まない**（§9.207）——帯の右端に直に置き、
     データ一覧・実績・作業スケジュールと**同じ印・同じ名前**にそろえる。
     パネルの名前は「☰ 表示」をやめて**表の見せ方**——ヘッダーの「表示」（この端末の見え方）と
     同じ名前が2つあった（§9.444 で1つにしたのが §9.468 で戻っていた）。作業スケジュールの
     同じ役のボタンも「表の見せ方」。 */
  bar.innerHTML=`<button type="button" id="listColumnBtn" class="list-toolbar-btn lt-cols-btn"
    title="この一覧に出す列・並び・幅・書式・読み替えをまとめて設定します" aria-label="表示列"><i class="fa-solid fa-table-columns" aria-hidden="true"></i><span class="lt-cols-t">表示列</span></button>
   <button type="button" id="listViewBtn" class="list-toolbar-btn lt-view-btn"
    aria-haspopup="dialog" aria-expanded="false" aria-controls="listViewPanel"
    title="行間・並び・表示件数・子ロットの畳みを決めます" aria-label="表の見せ方"><span class="lt-view-pre">表の</span>見せ方<i class="hd-caret" aria-hidden="true">▾</i></button>
   <!-- 下の行は**同じ字の大きさ・同じ高さ・同じ左端**（名前の列は固定幅）で並べる（§9.476）。 -->
   <div class="wl-menu lt-view-panel" id="listViewPanel" role="dialog" aria-label="表の見せ方" hidden>
    <label class="lvp-row list-rowgap" title="行の間隔を変えます（この一覧ごとに覚えます）"><span class="lvp-k">行間</span>
     <span class="lvp-v"><input type="range" id="listRowGap" min="1" max="5" step="1" value="3" aria-label="行の間隔">
     <output id="listRowGapVal" class="lvp-note" for="listRowGap">ふつう</output></span></label>
    <div class="lvp-row list-sort" id="listSort" role="group" aria-label="並び" hidden>
     <span class="lvp-k list-sort-label">並び</span>
     <span class="lvp-v lvp-sort">
     <span class="list-sort-keys" id="listSortKeys"></span>
     <span class="list-sort-preset-wrap">
      <button type="button" id="listSortPresetBtn" class="list-toolbar-btn" role="button" aria-haspopup="true" aria-expanded="false"
       title="いつも使う並びを選ぶ・今の並びを保存する">★ いつも使う並び<i>▾</i></button>
     </span>
     </span>
     <div class="list-sort-menu" id="listSortMenu" hidden></div>
    </div>
    <label class="lvp-row list-pagesize" title="1ページに出す件数です（多くすると1回の読み込みが重くなります）">
     <span class="lvp-k">表示件数</span>
     <select id="pageSize" aria-label="表示件数">${PAGE_SIZES.map(n=>
       `<option value="${n}"${String(n)===DEFAULT_PAGE_SIZE?' selected':''}>${Number(n).toLocaleString()}</option>`).join('')}
      <option value="${ALL_ROWS}">全件</option></select></label>
    <div class="lvp-row lvp-child"><span class="lvp-k">子ロット</span><span class="list-child-chip" id="listChildChip" hidden></span></div>
   </div>
   <!-- 2段目＝**常に見る状態**。左から「いつのデータか → 何件のどこを見ているか →
        何が足されているか（結合・色）」。バッククォートを書かないこと（§9.211 ③）。 -->
   <span class="lt-state" role="group" aria-label="元データと表示している範囲">
    <button type="button" class="list-fresh-chip" id="listFreshness"
     aria-haspopup="true" aria-expanded="false" hidden></button>
    <span class="list-count" id="count"></span>
    <span class="list-pager" id="listPager">
     <button type="button" id="prev" class="list-page-btn" aria-label="前のページ" title="前のページ">‹</button>
     <b id="page">1</b>
     <button type="button" id="next" class="list-page-btn" aria-label="次のページ" title="次のページ">›</button>
    </span>
    <span class="list-join-chip" id="listJoinChip" hidden></span>
    <button type="button" class="list-tint-chip" id="listTintChip" hidden></button>
    <span class="list-load-chip" id="listLoadChip" title="読み込みにかかった時間の内訳" hidden></span>
   </span>`;
  grid.parentNode.insertBefore(bar,grid);
  /* 列の設定はこの一覧の設定パネルへ集約する(§9.88 段2)。名前・並び・幅・
     表示を1箇所で決められるので、ボタンの行き先もここ1つでよい。 */
  bar.querySelector('#listColumnBtn').onclick=()=>WL.listColumns?.toggle();
  /* 「☰ 表示」の浮きパネル。置き場所・外を押したら閉じる・Escは`WL.popMenu`の1箇所
     （§9.448）。**パネルは作り直さない**——中の欄（行間・表示件数）はここで1度だけ
     配線してある。表示列の窓を開くときはパネルを閉じる（窓とパネルを重ねない）。 */
  const viewBtn=bar.querySelector('#listViewBtn'),viewPanel=bar.querySelector('#listViewPanel');
  viewBtn.onclick=()=>{
   if(!viewPanel.hidden){WL.popMenu.close();return}
   viewPanel.hidden=false;viewBtn.setAttribute('aria-expanded','true');
   WL.popMenu.open(viewPanel,{anchor:viewBtn,owner:viewBtn,
    onClose:()=>{viewPanel.hidden=true;viewBtn.setAttribute('aria-expanded','false');
     const m=document.getElementById('listSortMenu');if(m)m.hidden=true}});
  };
  bar.querySelector('#listColumnBtn').addEventListener('click',()=>WL.popMenu.close());
  /* 表示件数・ページめくり・元データの鮮度は**ここで配線する**（§9.286 ②）
     ——器をJSで作るようになったので、読み込み時に`$('#pageSize')`を探す形の
     配線は成り立たない（欄を作った側から配る・§9.257 ②と同じ理由）。 */
  bar.querySelector('#pageSize').onchange=()=>{S.page=1;load()};
  bar.querySelector('#prev').onclick=()=>{if(S.page>1){S.page--;load()}};
  bar.querySelector('#next').onclick=()=>{S.page++;load()};
  /* 鮮度のチップは**押すと再読込のメニューが開く**（§9.286 ④）。
     「いつのデータか」と「取り直す」は同じ関心事なので、読む場所と
     打つ手を同じ場所に置く（§CLAUDE 画面基準 2）。 */
  bar.querySelector('#listFreshness').onclick=e=>{
   if(document.getElementById('reloadMenu')){closeReloadMenu();return}
   openReloadMenu(e.currentTarget);
  };
  const gap=bar.querySelector('#listRowGap');
  gap.addEventListener('input',()=>applyRowGap(Number(gap.value)));
  bindSortControls(bar);
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
/* 親の下へ畳んだ子ロットの件数(§9.239 ⑤-2)。**黙って行を減らさない**
   ——件数が合わないように見えるのがいちばん悪い（§3・§8）。
   行が多くて畳めないときも、そのことを書く（§4）。 */
let lastChildFold={folded:0,tooMany:false};
function renderChildChip(bar){
 const el=bar.querySelector('#listChildChip');if(!el)return;
 const {folded,tooMany}=lastChildFold;
 if(tooMany){
  el.hidden=false;el.className='list-child-chip is-off';
  el.textContent='子ロットは畳んでいません';
  el.title=`行が多いとき（${CHILD_FOLD_MAX_ROWS}行超）は、親の下へ畳む代わりに`
    +'そのまま並べます。表示件数を減らすと畳んで出せます。';
  return;
 }
 if(!folded){el.hidden=true;return}
 el.hidden=false;el.className='list-child-chip';
 el.textContent=`子ロット ${folded}件を親の下へ`;
 el.title='分割ありの親が同じ一覧に居る子ロットは、親の行の「子N」を押すと'
   +'その下に出ます。親が居ない子ロットは今までどおりそのまま並んでいます。';
}

/* 色を付けている列のチップ。**この一覧のぶんだけ**数える。 */
function renderTintChip(bar){
 const el=bar.querySelector('#listTintChip');if(!el)return;
 const target=listLayoutTarget();
 const n=(window.WL&&WL.columnTint)?WL.columnTint.count(target):0;
 if(!target||!n){el.hidden=true;return}
 const names=WL.columnTint.cols(target)
   .map(k=>WL.isVirtualColumn(k)?WL.virtualColumnLabel(k):WL.columnLayout.label(target,k));
 el.hidden=false;
 el.textContent=`色 ${n}列 ✕`;
 el.title=`一時的な色を付けている列: ${names.join('、')}\n`
   +'この端末だけの目印です（マスタには保存していません。アプリを閉じると消えます）。'
   +'\n押すとこの一覧の色をすべて外します。';
 el.onclick=()=>{WL.columnTint.clearAll(target);renderTintChip(bar)};
}
/* 「表示列」「表の見せ方」を1段目（絞り込みのバーの席）へ置く（§9.468・§9.505）。バーは別の本
   （filters.js）が作るので、**あれば**そこへ移し、無ければこの帯の先頭に残す。並びは
   「表示列 → 表の見せ方」（よく使うほうが先）。描くたびに呼んでよい。 */
function placeViewButton(bar){
 const btns=['listColumnBtn','listViewBtn'].map(id=>bar.querySelector('#'+id)||document.getElementById(id)).filter(Boolean);
 if(!btns.length)return;
 const slot=document.getElementById('filterBarSlot');
 const home=(slot&&slot.closest('#genericFilterBar')&&!slot.closest('[hidden]'))?slot:bar;
 /* **並びが合っているときは触らない**——動かすと押した直後の焦点が外れる。 */
 const now=[...home.children].slice(0,btns.length);
 if(btns.every((b,i)=>now[i]===b))return;
 btns.slice().reverse().forEach(b=>home.insertBefore(b,home.firstChild));
}
function renderListToolbar(){
 const bar=ensureListToolbar();if(!bar)return;
 placeViewButton(bar);
 // 読み込んだ行間を毎回反映する(一覧を切り替えるとスコープごと変わる)。
 const gapEl=bar.querySelector('#listRowGap');
 if(gapEl){gapEl.value=String(rowGapValue);applyRowGap(rowGapValue)}
 // 表示列の選択は、設備ごとの設定を持つスケジュールモードの仕掛一覧でのみ扱う。
 // 列の設定はどの一覧でも使える(§9.88)。以前はスケジュールモードの
 // 仕掛一覧だけだったが、並び・幅・表示名はどの一覧でも要る。
 const canPickColumns=!!(S.db&&S.table);
 const btn=bar.querySelector('#listColumnBtn');
 if(btn)btn.hidden=!canPickColumns;
 renderSortBar();
 // 品質データ結合(join_quality)の結果を、成功・失敗どちらも一覧の脇に出す。
 // 以前はサーバー側で黙って素通ししていたため、結合されない理由が分からなかった。
 /* 結合(§9.193)は1件とは限らない。**名前と件数を文字で出す**——色だけだと
    「何がどこから足されたか」が読めない(§3)。失敗した結合の理由も同じ帯へ。 */
 /* ---------- 色を付けていることを常時出す(§9.239 ⑤-3) ----------
    §9.175「覚えていることを画面に書き、忘れさせる手立ても同じ場所に置く」。
    色は右クリックの中でしか名乗っていないと、あとから見た人には
    「誰かが設定した色」としか読めない。**件数を文字で出し、
    外す手立ても同じチップに置く**（押すと全部外す）。 */
 renderTintChip(bar);
 renderChildChip(bar);
 const chip=bar.querySelector('#listJoinChip');
 const info=S.joinQuality;
 if(chip){
  if(!info||!info.count){chip.hidden=true;chip.textContent=''}
  else{
   chip.hidden=false;
   /* 失敗の数はサーバーが数える（`summarize()`の`failed`）。「相手に無いものだけ」の
      結合は一致0件が正常なので、「一致した行がある」では判定しない。写しに残った
      古い応答（`failed`を持たない）は今までの判定に倒す。 */
   const failed=('failed' in info)?(+info.failed||0):(info.applied&&info.matched>0?0:info.count);
   const ok=info.applied&&!failed;
   const names=(info.names||[]).filter(Boolean);
   chip.className='list-join-chip '+(ok?'is-ok':'is-warn');
   /* **行が増減したことは帯で言う**(§9.194)。結合の仕方によっては一覧から
      行が消える／相手の行が増えるので、黙って変えると「絞り込んでいないのに
      件数が合わない」としか見えない。 */
   const rowNote=info.rowsChanged
    ?`／${info.droppedRows?`-${info.droppedRows}行`:''}${info.droppedRows&&info.addedRows?' ':''}${info.addedRows?`+${info.addedRows}行`:''}`
    :'';
   chip.textContent=ok
    ?`結合 ${names.length?names.join('・'):info.count+'件'} ／ ${info.matched}行 +${info.addedColumns}列${rowNote}`
    :joinFailText(info,failed);
   /* 狭い器（スケジュールと並べたとき）で出す**短い名乗り**（§9.468）。どこから何行かは
      「調べてわかればよい」ほうなので`title`に任せ、足した列の数と失敗だけを常に見せる。
      字（`textContent`）は長いままにしておく——読み上げと網は全文を読む。 */
   chip.dataset.short=ok?`結合 +${info.addedColumns}列${rowNote}`:'結合できません';
   chip.title=ok
    ?`キーが一致した${info.matched}行に${info.addedColumns}列を足しました`
     +`${info.table?`（相手の表: ${info.table}）`:''}。同じ名前の列はこの一覧の値を残します。`
     +((info.kinds||[]).length?`\n結合の仕方: ${info.kinds.join('・')}`:'')
     +(info.droppedRows?`\n一致しない${info.droppedRows}行はこの一覧に出していません。`:'')
     +(info.addedRows?`\n相手にしかない${info.addedRows}行を足しています。`:'')
     +(info.note?`\n${info.note}`:'')
     +(info.ambiguous?`\n相手が2件以上あったキーが${info.ambiguous}件あります。`:'')
     +(info.reason?`\n当たらなかった結合: ${info.reason}`:'')
    :`結合できませんでした: ${info.reason||'原因不明'}\nマスタ管理 > クエリ結合 で設定を確かめてください。`;
  }
 }
 /* 2段目は**常に見る状態**（元データ・件数）を持つので、一覧がある限り出す（§9.468）。 */
 bar.hidden=!(canPickColumns||(info&&!chip.hidden)||!!S.table);
}
/* 結合に失敗したときの札の字（利用者の報告「エラーがわかるようにしてほしい」）。
   **どの結合が・なぜ**を字で言う——「結合できません（1件）」だけでは、どの結合の
   何を直せばよいかをマウスを乗せないと読めない。理由は最初の1件の要点
   （「（」「。」の手前）だけ。全文は`title`が持つ。 */
function joinFailText(info,failed){
 const names=(info.failedNames||[]).filter(Boolean);
 const first=String((info.failedReasons||[])[0]||'').split(/[（。]/)[0].trim();
 const who=names.length?names.join('・'):`${failed}件`;
 return `結合できません: ${who}${first?`（${first}）`:''}`;
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
 /* **何件がどこへ行くのかをボタンに書く**(§9.170)。「LS4へ追加」だけでは、
    選んだ全部なのか今の行だけなのかが読めない。 */
 const addBtn=target?`<button type="button" class="plan-select-add" id="planSelectAdd" title="選んだ${n}件を${esc(target)}の予定へまとめて追加します">${esc(target)}へ${n}件追加</button>`:'';
 bar.innerHTML=`<span>${n}件選択中</span>${addBtn}<button type="button" class="plan-select-clear" id="planSelectClear">選択解除</button>`;
 $('#planSelectClear').onclick=clearListSelection;
 const add=$('#planSelectAdd');
 if(add)add.onclick=()=>window.scAddSelectedRows?.(Array.from(S.selectedRows));
}
/* 選択している行のうち、今DOMに出ているものへ印を付け外しする(§9.170)。
   全件表示・仮想スクロールでは行が出ていないことがあるので、見つからない
   ぶんは黙って飛ばす(印は見えている行のためのもの)。 */
function markRowsDragging(rows,on){
 const b=$('#grid tbody');if(!b)return;
 const want=new Set(rows||[]);
 b.querySelectorAll('tr').forEach(tr=>{
  if(want.has(tr.__row))tr.classList.toggle('is-row-dragging',on);
 });
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
/* 描き直したあとに戻したい位置。**並べ終えてから**戻す(§9.95)
   ——描いた直後は表がまだ短く、指定してもブラウザに切り詰められる。 */
let pendingGridScroll=null;
function keepGridScroll(){
 const g=$('#grid');
 if(g)pendingGridScroll={top:g.scrollTop,left:g.scrollLeft};
}
function applyPendingScroll(){
 const g=$('#grid');
 if(g&&pendingGridScroll){g.scrollTop=pendingGridScroll.top;g.scrollLeft=pendingGridScroll.left}
 pendingGridScroll=null;
}
/* ---------- 行の窓(§9.95) ----------
   `#grid`の中で、**画面に入っている行の前後だけ**をDOMへ置く。
   上下に高さだけを持つ空の行を挟んで、スクロールバーの長さは全行ぶんに
   見せる。行の高さは`table-layout:fixed`＋`height:var(--row-h)`で全行
   そろっているので、実際に描いた1行を測ってそれを使う(トークンから
   計算すると罫線や表示サイズのぶんでずれる)。
   スクロールのたびに作り直すが、**動いた量が窓の余分に収まるうちは
   作り直さない**(1行スクロールするたびに組み直すと、それ自体が重い)。 */
function setupVirtualRows({gen,grid,tbody,rows,colCount,overscan,buildRow,reset,afterRows}){
 if(!grid)return;
 const probe=tbody.querySelector('tr');
 const rowH=Math.max(1,Math.round((probe?probe.getBoundingClientRect().height:0)||24));
 const spacer=h=>{
  const tr=document.createElement('tr');tr.className='grid-virtual-spacer';
  const td=document.createElement('td');td.colSpan=colCount;td.style.height=h+'px';
  tr.appendChild(td);return tr;
 };
 /* ---------- 速いスクロールに追いつく（§9.297、利用者の指摘「仕掛データなどの
    一覧のスクロールの速度が速いと描画が間に合わないケースがあります。少しだけ
    描画範囲を広くしてスクロールに確実に追従するように」） ----------
    組み直しは`requestAnimationFrame`にまとめてあるので、**1フレームぶんは
    必ず遅れる**。その1フレームで画面より多く動くと、上下の空行（スペーサ）が
    そのまま見える。前後に**画面1つぶんくらい**を先に作っておけば、
    ふつうの速さのホイールでは空きが見えない。

    **固定の行数にしないこと**——器の高さは表示サイズと窓の大きさで変わるので、
    14行では小さい画面で余りすぎ、大きい画面で足りない。**画面に入る行数から
    決める**（`overscan`は下限として効かせる）。上限を置くのは、行が多いほど
    1回の組み直しが重くなるから（§9.94。8,000セルを超えると目に見えて止まる）。 */
 const VIEW_BUFFER=0.9;          // 画面の何倍を前後に先取りするか
 const OVERSCAN_MAX=60;          // これ以上は1回の組み直しが重くなる
 let start=-1;
 const draw=()=>{
  if(gen!==gridGeneration)return true;                 // 描き直された: 降りる
  const viewRows=Math.ceil(grid.clientHeight/rowH);
  const pad=Math.min(OVERSCAN_MAX,Math.max(overscan,Math.ceil(viewRows*VIEW_BUFFER)));
  const view=viewRows+pad*2;
  const want=Math.max(0,Math.floor(grid.scrollTop/rowH)-pad);
  // 窓の中に収まっているうちは組み直さない
  if(start>=0&&want>=start&&want+viewRows<=start+view)return false;
  start=Math.min(want,Math.max(0,rows.length-view));
  const end=Math.min(rows.length,start+view);
  reset&&reset();
  tbody.replaceChildren();
  if(start>0)tbody.appendChild(spacer(start*rowH));
  for(let i=start;i<end;i++)buildRow(rows[i],i);
  if(end<rows.length)tbody.appendChild(spacer((rows.length-end)*rowH));
  afterRows&&afterRows();
  return false;
 };
 let queued=false;
 const onScroll=()=>{
  if(queued)return;queued=true;
  requestAnimationFrame(()=>{
   queued=false;
   // 世代が変わっていたら聞くのをやめる(前の一覧のスクロールで作り直さない)
   if(draw())grid.removeEventListener('scroll',onScroll);
  });
 };
 grid.addEventListener('scroll',onScroll);
 draw();
 applyPendingScroll();
 draw();                       // 戻した位置に合わせてもう一度窓を合わせる
 /* 列の窓(§9.104)が動いたときは、行の位置が同じでも組み直す必要がある
    ——`start`を無効にしてから描き直す。 */
 return {redraw(){start=-1;draw()}};
}
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
/* ---------- 行ごとの追い判定は「一覧が出てから」(§9.94) ----------
   分割ありの行の子ロット確認・子カード行の親ロット逆引きは、**一覧を
   読むのに要らない**(印を後から足すだけ)。それを描画の直後に始めていた
   ため、開いた瞬間に数十本の問い合わせと、そのぶんのJSON解読が
   走り、画面が固まったように見えていた(実機で報告、再現済み)。
   ・**手が空いてから**始める(requestIdleCallback。無ければ短い遅延)
   ・**先頭をまとめて先に引く**(lot-split.jsのprefetchLotPrefixes)
   ・以後は1行ずつでも手元の結果で済む */
function whenIdle(fn,timeout=1200){
 if(typeof requestIdleCallback==='function')return requestIdleCallback(fn,{timeout});
 return setTimeout(fn,120);
}
/* 追い判定に使う先頭5桁を、この画面ぶんまとめて先に引いておく。 */
function prefetchSplitLookups(targets){
 if(!targets.length||typeof window.prefetchLotPrefixes!=='function')return Promise.resolve();
 const prefixes=[...new Set(targets
   .map(({row})=>String(pick(row,'lotNo')||''))
   .filter(x=>x.length>=5).map(x=>x.slice(0,5)))];
 if(!prefixes.length)return Promise.resolve();
 return window.prefetchLotPrefixes(prefixes).catch(WL.quiet('先読みできない（行ごとに引き直すだけ）'));
}
/* 分割のセルの文字を差し替える（§9.239 ⑤-2）。**中身を`textContent`で
   丸ごと入れ替えないこと**——セルの中には子ロットを畳むつまみ
   （`.grid-child-toggle`）が入っており、押す手立てごと消える（§9.235 ④で
   バッジを包み直したのとまったく同じ罠）。つまみは残して文字だけ替える。 */
function setSplitCellText(cell,text,title){
 if(!cell)return;
 const keep=cell.querySelector('.grid-child-toggle');
 cell.textContent=text;
 if(keep)cell.insertBefore(keep,cell.firstChild);
 if(title!=null)cell.title=title;
}
function checkSplitRowsForMissingChildren(targets){
 if(!targets.length||typeof window.findMissingChildLots!=='function')return;
 const gen=gridGeneration;
 runLimited(targets,3,async({tr,row})=>{
  if(gen!==gridGeneration)return;          // 描き直された: この判定はもう不要
  const info=await window.findMissingChildLots(row,{light:true});
  if(gen!==gridGeneration)return;
  if(!info||!info.missing.length)return;
  const cell=tr.querySelector('.split-flag-cell');if(!cell)return;
  cell.classList.remove('split-yes');cell.classList.add('split-missing');
  setSplitCellText(cell,`分割あり・子ロット未検出(${info.missing.length})⚠`,
   `次の子ロットが仕掛データに見つかりません: ${info.missing.join('、')}\n作業済み(仕掛から外れている)の可能性が高く、目標幅・公差の一部が欠けたまま測定される恐れがあります。`);
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
  const parent=await window.findParentLotFor(row,{light:true});
  if(gen!==gridGeneration)return;
  const cell=tr.querySelector('.split-flag-cell');if(!cell)return;
  if(parent){
   const parentLotNo=pick(parent,'lotNo');
   setSplitCellText(cell,`分割なし(親：${parentLotNo})`,
    `このロットは分割済みの子ロット(子カード)です。親ロット「${parentLotNo}」が仕掛に見つかりました。`);
  }else{
   setSplitCellText(cell,'分割なし(子)',
    'このロットは分割済みの子ロット(子カード)と判定されましたが、対応する親ロットは仕掛に見つかりませんでした。');
  }
 });
}
/* 検索・ページャ。ボタンは常に最新のload実装を呼ぶ(旧実装は初期のload関数を
   参照し続ける潜在不具合があった)。 */
/* 欄は絞り込みの帯（filters.js）が作る（§9.505）——この行が走る時点ではまだ無いので、
   文書で受ける。 */
document.addEventListener('input',e=>{
 if(e.target&&e.target.id==='search'){clearTimeout(S.t);S.t=setTimeout(()=>{S.page=1;load()},300)}
});
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
   await api('/api/rne-extract/run',{quiet:true,method:'POST'});
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
  try{last=await status();paint(last)}catch(_){WL.quiet.note('抽出の状況を取れない（次の巡回で描き直す）',_)}
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
   (共有が不調でも、手元の写しで一覧は出る)。

   **押したら直ちに反応し、結果を字で返す**（§9.463、利用者の報告「再読み込み
   押しても任意に取りに行った感じがなく最新版化されません。行ったのであれば
   動き(反応)が欲しい」）。以前は写し直しを待つあいだ画面に何も出さず、
   結果（写した／変わっていない／写せなかった）も捨てていた——どれでも
   同じに見えた。**必ず写し直す**（`force`）——共有の時刻と大きさは手元に
   控えられて遅れることがあり、「変わっていない」と誤って読むと取りに行っても
   古いまま。**2度押しは1回にまとめる**。 */
let reloadBusy=false;
function mirrorResultText(res,key){
 const r=((res&&res.results)||[]).find(x=>x&&x.key===key);
 if(!r)return {ok:true,title:'一覧を読み直しました',detail:'この一覧は写しを使わず、置き場のファイルをそのまま読んでいます'};
 if(r.updated)return {ok:true,title:'元データを取り込み直しました',detail:'共有の元ファイルを手元へ写し直して読み直しました'};
 if(r.skipped)return {ok:true,title:'元データは最新です',detail:'共有の元ファイルは前回の取り込みから変わっていません'};
 return {ok:false,title:'元データを取り込めませんでした',detail:(r.reason||'理由が分かりません')+'（前の写しで表示しています）'};
}
async function reloadList(){
 if(reloadBusy)return;
 reloadBusy=true;
 const chip=$('#listFreshness');
 chip?.classList.add('is-busy');chip?.setAttribute('aria-busy','true');
 let res=null,err=null;
 try{
  res=await WL.records.withWaiting({title:'元データを取り込み直しています',
    detail:'共有の元ファイルを手元へ写しています',progress:'共有から写しています',delayMs:0},
   ()=>api('/api/db-mirror/refresh',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({wait:true,force:true})}));
 }catch(e){err=e;WL.quiet.note('共有からの写しを更新できない（手元の写しで読み直す）',e)}
 try{invalidateTableCache();await load(true)}
 finally{reloadBusy=false;chip?.classList.remove('is-busy');chip?.removeAttribute('aria-busy')}
 const at=fmtStamp(listSourceInfo&&listSourceInfo.at);
 const m=err?{ok:false,title:'元データを取り込めませんでした',detail:String(err.message||err)+'（前の写しで表示しています）'}
            :mirrorResultText(res,S.db);
 showToast(m.title,m.detail+(at?`／元データ ${at}`:''),m.ok?3600:7000);
}
/* **写しが新しくなったら一覧も新しくする**（§9.463、利用者の指示「意図的に更新
   停止していない限りは、版が相違ある場合直ちに更新すべき」）。写し直しは背景の
   周回（既定60秒）が行うが、**画面はそれを知らずに前の行を出し続けていた**
   （画面の控えは3分）。軽い口（共有を見に行かない）で素性だけ聞き、
   取り込んだ時刻が変わっていたら読み直す。手動のときは「新しい版あり」を出すだけ。
   見えていない間・読み直している間は聞かない。 */
const MIRROR_POLL_MS=20000;
let mirrorPollTimer=null;
async function pollMirrorSource(){
 if(document.hidden||reloadBusy||!S.db)return;
 const el=document.querySelector('#listFreshness');
 if(!el||el.hidden||!el.offsetWidth)return;
 let d=null;
 try{d=await api('/api/db-mirror/source?db='+encodeURIComponent(S.db),{quiet:true})}
 catch(e){WL.quiet.note('元データの素性を聞けない（次の周回で聞き直す）',e);return}
 const now=d&&d.source,was=listSourceInfo;
 if(!now||!was)return;
 if(now.copiedAt&&was.copiedAt&&now.copiedAt!==was.copiedAt){
  invalidateTableCache();await load(true);
  showToast('元データが新しくなったので読み直しました',now.at?`元データ ${fmtStamp(now.at)}`:'',3000);
  return;
 }
 if(!!now.newer!==!!was.newer){listSourceInfo=Object.assign({},was,{newer:now.newer,mode:now.mode});updateListFreshness(null)}
}
function startMirrorPoll(){
 if(mirrorPollTimer)return;
 mirrorPollTimer=setInterval(()=>{pollMirrorSource()},MIRROR_POLL_MS);
}
startMirrorPoll();

function closeReloadMenu(){
 document.getElementById('reloadMenu')?.remove();
 $('#listFreshness')?.setAttribute('aria-expanded','false');
 document.removeEventListener('click',onReloadOutside,true);
}
function onReloadOutside(e){
 const menu=document.getElementById('reloadMenu');
 if(menu&&!menu.contains(e.target)&&!e.target.closest('#listFreshness'))closeReloadMenu();
}
async function openReloadMenu(anchor){
 closeReloadMenu();
 const menu=document.createElement('div');
 menu.className='wl-menu access-mode-menu reload-menu';menu.id='reloadMenu';
 /* 読み込みの内訳（§9.340）。チップは遅いときしか出さないので、**速いときに
    内訳へ辿り着ける場所はここだけ**——入口ごと消さない（§4）。 */
 const bd=lastLoadBreakdown;
 const note=bd?`<div class="reload-menu-note"><b>読み込み ${(loadTotalMs(bd)/1000).toFixed(1)}秒</b>`
   +loadBreakdownLines(bd).map(l=>`<span>${esc(l)}</span>`).join('')+`</div>`
   :'<div class="reload-menu-note"><b>読み込みの内訳はまだありません</b>'
   +'<span>一覧を1回読むと出ます</span></div>';
 menu.innerHTML=note+`<button type="button" data-reload-action="list">`
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
 $('#listFreshness')?.setAttribute('aria-expanded','true');
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
/* 「再読込」の入口は**一覧のツールバーの鮮度チップ1つ**（§9.286 ④）。
   ヘッダーのボタンは外した——`body.sc-mode`で伏せられるため、分割表示の
   仕掛一覧からは押せなかった（入口を2つにしない・§9.207）。 */

/* ============================================================
   外へ出す面（§9.355・REVIEW 3-17）
   ------------------------------------------------------------
   このファイルは IIFE で閉じている。**ここに載っているものだけが外から呼べる**——
   足すときは、まず「本当に外から要るのか」を見る（中で済むなら載せない）。
   閉じたので、載せ忘れは `no-undef` が教える（§9.354）。
   ============================================================ */
WL.list={init,load,renderGrid,renderGridInner,renderTabs,renderDbNav,selectDb,
 listLayoutTarget,listColumnKeys,fmtStamp,applyTableData,estimateColumnWidth,
 tableCacheGet,tableCacheSet,checkParentLookupRows,checkSplitRowsForMissingChildren,
 setSplitCellText};
})();
