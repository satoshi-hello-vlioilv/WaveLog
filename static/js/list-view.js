"use strict";
/* list-view.js: 起動処理・DB/テーブル選択・一覧グリッド(仕掛一覧/品質データ)。 */
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
 const drafts=$('#homeDrafts');if(drafts)drafts.onclick=()=>openRecords('編集中');
 bindAppSettingsControls();
 /* 件数バッジと保存領域の使用量は**一覧の表示を待たせない**。どちらも
    数字が少し遅れて入るだけで、画面の組み立てには影響しない。 */
 refreshDraftCount().catch(e=>console.warn('件数バッジの更新に失敗',e));
 showQuota();
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
  }catch(e){/* 読めなくても並び替えそのものは使える(fail-open) */}
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
     body:JSON.stringify(withUserId({id:p.id}))}).catch(()=>{});
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
  const name=prompt(`この並び順に名前を付けて保存します。\n${label}`,'');
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
  if(!confirm(`並び順「${p.name}」を削除します。よろしいですか？`))return;
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
  ).join(''):'<span class="list-sort-none">指定なし（見出しをクリック／Shift+クリックで2つ目）</span>';
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
WL.columnResize={busy:gripBusy,settleMs:GRIP_SETTLE_MS};
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
  gripHeld++;document.body.classList.add('col-resizing');
  const move=ev=>{
   if(!startW)return;
   w=Math.max(GRIP_W_MIN,Math.min(GRIP_W_MAX,Math.round(startW+(ev.clientX-startX))));
   o.preview(w);
  };
  const up=()=>{
   document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);
   gripHeld=Math.max(0,gripHeld-1);
   if(!gripHeld)document.body.classList.remove('col-resizing');
   /* 離してからも少しのあいだは「触っている」——ここで見張りが表を
      組み直すと、続けて隣の列を掴もうとした手が空を切る。 */
   gripCalmUntil=Date.now()+GRIP_SETTLE_MS;
   if(!w)return;
   const width=w;
   saveTimer=setTimeout(()=>{
    saveTimer=null;gripSaving++;
    Promise.resolve().then(()=>o.commit(width)).catch(()=>{})
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
 const layout=WL.columnLayout.get(target);
 const heads=[...table.querySelectorAll('th[data-sort-col]')];

 /* 覚えている並びを、許可された全列に対して作り直す。

    **数えるのは`listColumnKeys()`の1本の並び(§9.106)**——`allColumns`は
    データ列だけなので、それを基準にすると番号・ボタンの列
    (`#`/`分割`/`測定`/`予定`)が保存する並びから丸ごと落ちる。落ちると
    次に開いたとき`apply()`が「知らない列」として**末尾へ回す**ので、
    **列幅を少し引いただけで#・分割・測定が右端へ飛ぶ**(§9.110。実機で
    「列の移動が正しく反映されない」として報告された)。 */
 const fullOrder=()=>{
  const all=WL.listColumnKeys(allColumns);
  const known=(layout.order||[]).filter(c=>all.includes(c));
  return [...known,...all.filter(c=>!known.includes(c))];
 };
 /* 保存は全置換なので、**触っていない設定も一緒に送る**こと。
    並びだけを送ると、表示名や書式が黙って消える(全置換で行ごと作り直すため)。
    **1つでも書き漏らすとその設定だけが黙って消える**(§9.113)——`formulas`を
    渡していなかったため、**見出しを1回ドラッグしただけで計算式で作った列が
    全部消えていた**(式が消えると`listColumnKeys()`がその列を並べなくなる)。
    渡す中身は`save()`のキーと1対1で対応させること。
    **控えは呼ばれた時点で取り直す**——`save()`はキャッシュを新しい
    オブジェクトへ差し替えるので、束縛した`layout`は1回保存した時点で
    古い写しになる(2回目以降が古い設定で上書きしてしまう)。 */
 const persist=async(order,widths,locks)=>{
  /* **控えは保存のたびに取り直す**(§9.113)。save()はキャッシュを新しい
     オブジェクトへ差し替えるので、関数の頭で束縛すると1回保存した時点で
     古い写しになる。渡し漏れた設定は消えるので、キーは1つも欠かさない。 */
  const cur=WL.columnLayout.get(target);
  try{
   await WL.columnLayout.save(target,{order,widths:widths||cur.widths,hidden:cur.hidden,
                                      names:cur.names,formats:cur.formats,rules:cur.rules,
                                      formulas:cur.formulas,locks:locks||cur.locks});
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

 // ---- 列幅(右端の取っ手を引く。手順はWL.columnWidthGripが持つ) ----
 heads.forEach(th=>{
  const grip=th.querySelector('.col-resize');if(!grip)return;
  const col=th.dataset.sortCol;
  /* colgroupは**1本の並び(§9.106)と1対1**になったので、見出しの位置を
     そのまま使える。以前は「先頭の何列ぶんか」を数え直しており、
     番号・ボタンの出し入れで基準がずれる作りだった。 */
  const colEl=()=>{
   const cg=table.querySelector('colgroup');
   const at=[...table.querySelectorAll('thead th')].indexOf(th);
   return (cg&&at>=0)?cg.children[at]:null;
  };
  WL.columnWidthGrip(grip,{
   locked:WL.columnLayout.locked(target,col),
   startWidth:()=>th.getBoundingClientRect().width,
   preview:w=>{const c=colEl();if(c)c.style.width=w+'px'},
   commit:w=>{const widths={...(layout.widths||{}),[col]:w};
              layout.widths=widths;persist(fullOrder(),widths)},
   reset:()=>{const widths={...(layout.widths||{})};delete widths[col];
              layout.widths=widths;persist(fullOrder(),widths);renderGrid()},
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

function closeColumnHeaderMenu(){
 document.querySelector('.col-head-menu')?.remove();
 document.removeEventListener('mousedown',onColumnMenuOutside,true);
 document.removeEventListener('keydown',onColumnMenuKey,true);
}
function onColumnMenuOutside(e){if(!e.target.closest('.col-head-menu'))closeColumnHeaderMenu()}
function onColumnMenuKey(e){if(e.key==='Escape'){e.stopPropagation();closeColumnHeaderMenu()}}
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
function openColumnHeaderMenu(ev,col,target,allColumns,src){
 closeColumnHeaderMenu();
 if(!target||!col)return;
 const S2=headMenuSource(target,allColumns,src);
 const hidden=S2.hiddenOf();
 const nameOf=k=>S2.label(k);
 const menu=document.createElement('div');
 menu.className='col-head-menu';
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
  +(hidden.length?`<div class="chm-sep"></div><div class="chm-label">隠している列（${hidden.length}）</div>`
    +shown.map(k=>`<button type="button" class="chm-show" data-key="${esc(k)}">${esc(nameOf(k))}</button>`).join('')
    +(hidden.length>shown.length?`<div class="chm-more">ほか${hidden.length-shown.length}件は「表示列」から</div>`:'')
    +item('すべての列を表示','chm-all'):'')
  +`<div class="chm-sep"></div>`+item('表示列の設定を開く…','chm-panel');
 document.body.appendChild(menu);
 const w=menu.offsetWidth,h=menu.offsetHeight;
 menu.style.left=`${Math.max(6,Math.min(ev.clientX,innerWidth-w-6))}px`;
 menu.style.top=`${Math.max(6,Math.min(ev.clientY,innerHeight-h-6))}px`;

 const persist=async patch=>{
  if(S2.persist){await S2.persist(patch);S2.refresh();return}
  const v=WL.columnLayout.get(target);
  const all=S2.keys();
  const known=(v.order||[]).filter(c=>all.includes(c));
  /* **保存は全置換なので、渡す設定を1つでも書き漏らさない**(§9.113)。
     ここは`formulas`が抜けており、**右クリックで列を1つ隠しただけで
     計算式で作った列が全部消えていた**(bindColumnHeaderToolsのpersistで
     同じ不具合を直したときに、こちらを見落としていた)。 */
  /* `hidden`は**口が答える「いま隠している列」**(§9.197)。保存値だけを
     見ると、既定で畳んでいる列が幅を1回変えた拍子に出てしまう。 */
  await WL.columnLayout.save(target,{order:[...known,...all.filter(c=>!known.includes(c))],
                                     widths:v.widths,hidden:S2.hiddenOf(),names:v.names,
                                     formats:v.formats,rules:v.rules,
                                     formulas:v.formulas,locks:v.locks,...patch});
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
 menu.querySelector('.chm-panel').onclick=()=>{
  closeColumnHeaderMenu();
  S2.openPanel();
 };
 requestAnimationFrame(()=>{
  document.addEventListener('mousedown',onColumnMenuOutside,true);
  document.addEventListener('keydown',onColumnMenuKey,true);
 });
}
WL.openColumnHeaderMenu=openColumnHeaderMenu;

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
  WL.columnLayout.load(listLayoutTarget()).catch(()=>{}),
  WL.displayRules.load().catch(()=>{}),
  sortPresets.load().catch(()=>{}),
  loadRowGap().catch(()=>{}),
 ]);
 const hit=force?null:tableCacheGet(key);
 if(hit){await settings;applyTableData(hit.data);updateListFreshness(hit.at);return}
 const label=databaseLabel(S.db),table=S.table||'テーブル';
 await withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${table}`,
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
 renderGrid();
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
const listHooks={query:[],after:[]};
WL.listHooks={
 onQuery:fn=>{if(typeof fn==='function')listHooks.query.push(fn)},
 onAfter:fn=>{if(typeof fn==='function')listHooks.after.push(fn)},
 count:()=>({query:listHooks.query.length,after:listHooks.after.length}),
};
function runListHooks(kind,arg){
 listHooks[kind].forEach(fn=>{
  // 1つのフックが転んでも一覧は出す(fail-open)。
  try{fn(arg)}catch(e){console.error('一覧の'+kind+'フックで例外',e)}
 });
}
/* ---------- 「全件」(§9.95) ----------
   表示件数に「全件」を足した。サーバーは1回に500件までしか返さない
   (それ以上を1度に運ぶと転送も解読も1つの塊になり、そのあいだ操作できない)
   ので、**全件は「500件ずつ最後まで取り続ける」**という意味にする。
   最初の500件はいつもどおり出し、残りは裏で読む。 */
const ALL_ROWS='all';
/* 1回に取る件数。**大きいほど往復は減るが、1回ぶんの解読が長くなる**。
   実データ(214列)では500件で1回4.5MB・解読に1.3秒かかり、そのあいだ
   画面が止まる。250件なら0.5秒級まで下がり、往復も倍にしかならない。 */
const ALL_BATCH=250;
function pageSizeValue(){return $('#pageSize')?.value||'200'}
function isAllRows(){return pageSizeValue()===ALL_ROWS}
/* 1ページの件数。全件のときは1回ぶんの取得単位を返す(ページ番号の計算にも使う)。 */
function effectivePageSize(){return isAllRows()?ALL_BATCH:(+pageSizeValue()||200)}
function listQuery(){
 /* 全件でも**サーバーへ送るのは1回ぶん**。`all=1`は「この問い合わせは
    全件の1ページ目」という目印で、サーバーは見ない(キャッシュのキーと、
    続きを読むかどうかの判定に使う)。 */
 const q=new URLSearchParams({db:S.db,table:S.table,page:S.page,
                              page_size:String(effectivePageSize()),search:$('#search').value});
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
/* 内訳を一覧の脇に出す。**遅かったときだけ**目立たせる(速いときに
   出しても読む理由が無い)。押すと内訳の内わけが出る。 */
function renderLoadChip(){
 const chip=document.getElementById('listLoadChip');
 const b=lastLoadBreakdown;
 if(!chip)return;
 if(!b){chip.hidden=true;return}
 const total=b.wait+b.transfer+b.parse+b.render;
 chip.hidden=false;
 const slow=total>=1500;
 chip.className='list-load-chip'+(slow?' is-slow':'');
 const kb=Math.round(b.bytes/1024);
 const src={mirror:'手元の写し',share:'共有を直接',local:'手元'}[b.detail&&b.detail.source]||'';
 chip.textContent=`${(total/1000).toFixed(1)}秒`;
 chip.title=[
  `読み出し ${b.wait}ms（サーバー側 ${b.server}ms${src?' / '+src:''}）`,
  b.detail?`　└ 開く${b.detail.open??'-'}ms・列${b.detail.cols??'-'}ms・件数${b.detail.count??'-'}ms・取り出し${b.detail.fetch??'-'}ms`
           +(b.detail.join!=null?`・品質結合${b.detail.join}ms`:''):'',
  `転送 ${b.transfer}ms（${kb}KB）`,
  `整形 ${b.parse}ms`,
  `表示 ${b.render}ms（${b.rows}行 × ${b.columns}列）`,
 ].filter(Boolean).join('\n');
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
}catch(e){/* 壊れていても取り直せばよい */}
function rememberTables(k,result){
 tablesCache.set(k,result);tablesVerified.add(k);
 try{
  const out={};tablesCache.forEach((v,kk)=>{out[kk]={tables:v.tables}});
  localStorage.setItem(TABLES_CACHE_KEY,JSON.stringify(out));
 }catch(e){/* 保存できなくても動作は続く */}
}
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
async function selectTable(t,report){
 S.table=t;S.page=1;WL.listSort.clear();renderTabs();const label=databaseLabel(S.db);
 if(report){report({detail:`テーブル: ${t}`,progress:'列情報と一覧データを取得しています',step:2});return load()}
 return withWaiting({title:`${label}を読み込んでいます`,detail:`テーブル: ${t}`,
   progress:'列情報と一覧データを取得しています'},()=>load());
}
/* 一覧の列名は仕掛先DBの生カラム名なので、aliasesの候補名のうち
   実際にS.columnsへ含まれているものを探してロット番号・鋳造番号の
   列を特定する(見つからなければ通常表示のまま)。 */
function findColumnFor(key){return (aliases[key]||[]).find(n=>S.columns.includes(n))||null}
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
const virtualColumnWidth=(k,metrics)=>
  k==='#'?Math.round(3*0.55*metrics.fs+metrics.padX*2+2)   // 行番号(3桁ぶん)
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
function renderGrid(){
 /* **描画にかかった時間はここで測る。** filters.js が load() を丸ごと
    置き換えるため、load()側に置くと絞り込みを使ったときだけ測れなくなる
    (§9.88と同じ落とし穴)。renderGridは両方の経路が必ず通る。 */
 const _t0=performance.now();
 try{return renderGridInner()}
 finally{noteRenderTime(performance.now()-_t0);renderLoadChip()}
}
function renderGridInner(){
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
 /* ---------- 並びは1本(§9.106) ----------
    番号・ボタンの列(`#`/`分割`/`測定`/`予定`/選択)も**データ列と同じ1本の
    並び**に載せる。以前はデータ列だけを`apply()`で並べ替え、番号・ボタンは
    `renderGridInner()`が決まった位置へ無条件に描いていたため、
    **列の設定パネルで動かした並びと実際の並びが食い違い**、チェックを
    外しても消えなかった(実機で報告された)。設定画面と一覧が同じ並びを
    見るために、出どころは`listColumnKeys()`ただ1つにする。 */
 const ordered=orderedListColumns(layoutTarget,allowed);
 const dataCols=ordered.filter(k=>!isVirtualColumn(k));
 const visibleColumns=dataCols;         // 以降の互換(件数・書式の対象はデータ列)
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
 const numCol=c=>colFmt.get(c)?.kind==='number';
 /* 列幅は**セルを描く前に決める**(§9.94)。colgroupへ入れるだけでなく、
    「その幅に入り切らない値へtitleを付ける」判断にも使うため。 */
 const metrics=gridMetrics();
 const widthSample=visibleRows.slice(0,COL_W_SAMPLE);
 const colW=new Map(ordered.map(k=>[k,
   WL.columnLayout.width(layoutTarget,k)
   ||(isVirtualColumn(k)?virtualColumnWidth(k,metrics)
      :estimateColumnWidth(WL.columnLayout.label(layoutTarget,k),
                           // 計算で作る列は**計算した値**で幅を見積もる
                           // (生のr[k]は無いので、そのままだと見出しの幅になる)。
                           widthSample.map(r=>colCalc.has(k)?colCalc.get(k).run(r):r[k]),
                           metrics.fs,metrics.padX))]));
 // その列に何文字ぶん入るか(em)。これを超える値は省略記号になる。
 const colEm=new Map(dataCols.map(c=>[c,(colW.get(c)-metrics.padX*2-2)/metrics.fs]));
  const t=document.createElement('table');
 /* 見出し。**1本の並び(ordered)をそのまま辿る**ので、番号・ボタンの列が
    データ列の間に入っていてもそのとおりに出る(§9.106)。 */
 /* **どの見出しにも`data-col`を付ける**。セルと同じで、位置で数えずキーで
    引けるようにするため(§9.104)。見出しの右クリック(§9.110)は番号・
    ボタンの列にも効かせたいので、そこだけ属性が無いと分岐が増える。 */
 const headOf=k=>{
  if(k==='__select__')return '<th class="plan-select-head" data-col="__select__"><input type="checkbox" id="planSelectAll" title="このページの全行を選択/解除"></th>';
  if(k==='__plan__')return '<th class="plan-action-head" data-col="__plan__">予定</th>';
  if(k==='#')return '<th class="grid-no-head" data-col="#">#</th>';
  if(k==='__split__')return '<th class="split-flag-head" data-col="__split__" title="親子管理_子カード／コンマ5本分割_切断巾に実データがある場合「分割あり」と表示します">分割</th>';
  if(k==='__measure__')return '<th class="measurement-action-head" data-col="__measure__">測定</th>';
  const c=k,filtered=filteredCols.has(c);
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
  return `<th class="sortable-col ${numCol(c)?'col-num':''} ${filtered?'col-filtered':''} ${sorted?'col-sorted':''}" data-sort-col="${esc(c)}" data-col="${esc(c)}" draggable="true" tabindex="0" role="button" aria-label="${esc(WL.columnLayout.label(layoutTarget,c))}列で並び替え" title="${esc(c)}｜クリックで並び替え／ドラッグで列の入れ替え${filtered?'（絞り込み中の列です）':''}">${esc(WL.columnLayout.label(layoutTarget,c))}${arrow}${filtered?'<i class="col-filter-badge" aria-hidden="true" title="この列にフィルタが適用されています">▼</i>':''}<i class="col-resize" title="ドラッグで列幅を調整（ダブルクリックで既定へ）" aria-hidden="true"></i></th>`;
 };
 t.innerHTML='<thead><tr>'+ordered.map(headOf).join('')+'</tr></thead>';
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
 const colWin=makeColumnWindow({grid:$('#grid'),columns:ordered,
   widthOf:k=>colW.get(k),leadWidth:0});
 colWin.reset();
 bindColumnHeaderTools(t,layoutTarget,visibleColumns,allowed);
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
 const b=document.createElement('tbody');
 // 分割データはあるが子ロットが仕掛から見つからない行(=作業済みで仕掛から
 // 外れている可能性が高い)を、非同期の存在確認後にグリッド上で気づけるように
 // 更新する対象を集める(下のrunLimitedブロック参照)。
 const splitCheckTargets=[];
 // 親側の分割データは無い(=一見「分割なし」)行でも、「ｺﾝﾏ5本ｶｰﾄﾞ区分」が
 // 3の行は分割済みの子ロット自身であるため、親ロットを逆引き検索して
 // 気づけるようにする対象を集める(下のcheckParentLookupRows参照)。
 const parentCheckTargets=[];
  const buildRow=(r,i)=>{
  const tr=document.createElement('tr');
  /* 分割の印。**セルを作らないときも判定は要らない**ので、窓の中に
     入っているときだけ組み立てる(追い判定の対象もそのときだけ集める)。 */
  const splitCellHtml=()=>{
   const info=typeof window.analyzeRowSplit==='function'?window.analyzeRowSplit(r):{hasSplit:false};
   if(info.hasSplit){
    const patternShort=info.widthPattern==='same'?'同幅':info.widthPattern==='different'?'異幅':'';
    const patternFull=info.widthPattern==='same'?'同一幅分割':info.widthPattern==='different'?'異幅分割':'幅パターン不明';
    /* ロット数と条数は別物なので両方出す(以前は条数をロット数として
       「分割あり(6)」のように表示していた)。セルは狭いので「ロット/条」
       の並びで短く、詳しくはツールチップで言い分ける。 */
    const strips=Number.isFinite(info.stripCount)?info.stripCount:info.lotCount;
    splitCheckTargets.push({tr,row:r});
    return `<td class="split-flag-cell split-yes" title="推定 ${info.lotCount}ロット / ${strips}条・${patternFull}（実際の子ロット数・条数・幅は測定画面で確定します）">分割あり(${info.lotCount}ロット/${strips}条)${patternShort?'・'+patternShort:''}</td>`;
   }
   if(typeof window.isChildCardClassifiedRow==='function'&&window.isChildCardClassifiedRow(r))parentCheckTargets.push({tr,row:r});
   return '<td class="split-flag-cell split-no">分割なし</td>';
  };
  /* 1本の並びを辿ってセルを作る(§9.106)。窓の外は`colspan`でまとめた
     空セルにする(§9.104)——**幅は1pxもずれない**(`table-layout:fixed`では
     colspanで束ねた幅がcolgroupの合計になる)。 */
  /* **番号・ボタンの列は窓の外でも必ず作る**(§9.106)。畳んでしまうと、
     横へスクロールしただけで「測定」「＋予定」のボタンが**DOMごと消える**
     ——列を隠した覚えがないのに押せなくなる(実際に回帰テストが落ちた)。
     数は多くて5列なので、常に作っても重さに響かない。
     畳むのはデータ列だけで、続いた畳みぶんは1つのcolspanにまとめる。 */
  const {from,to}=colWin.get();
  const gap=n=>n>0?`<td class="grid-col-spacer" colspan="${n}"></td>`:'';
  let cells='',skipped=0;
  for(let ci=0;ci<ordered.length;ci++){
   const c=ordered[ci];
   if(!isVirtualColumn(c)&&(ci<from||ci>=to)){skipped++;continue}
   if(skipped){cells+=gap(skipped);skipped=0}
   if(c==='__select__'){cells+='<td class="plan-select-cell"><input type="checkbox" class="plan-select-checkbox"></td>';continue}
   if(c==='__plan__'){cells+='<td class="plan-action-cell"><button type="button" class="plan-action-button" title="この行の設備の作業スケジュールへ追加します">+ 予定</button></td>';continue}
   if(c==='#'){cells+=`<td class="grid-no-cell">${(S.page-1)*effectivePageSize()+i+1}</td>`;continue}
   if(c==='__split__'){cells+=splitCellHtml();continue}
   if(c==='__measure__'){cells+='<td class="measurement-action-cell"><button type="button" class="measurement-action-button">開く</button></td>';continue}
   if(c===lotCol){const lotVal=r[c];cells+=`<td class="lot-cell" data-col="${esc(c)}"><button type="button" class="lot-dsp-link grid-lot-link" title="クリックでLotDspをこのロット番号で開きます">${esc(lotVal)||'—'}</button></td>`;continue}
   /* 読み替え(段4)→書式(段3)の順で通してから出す。どちらも失敗したら
      生の値が出るので、指定を間違えても値が消えることはない。 */
   /* 計算で作る列(§9.111 ⑦)は、その行の値から作ってから同じ道を通す
      ——書式・読み替え・省略記号の扱いをデータ側の列と分けない。 */
   const calc=colCalc.get(c);
   const rawVal=calc?calc.run(r):r[c];
   const out=WL.cellFormat.cell({raw:rawVal,format:colFmt.get(c),rule:colRule.get(c),row:r,column:c});
   const raw=String(rawVal==null?'':rawVal);
   const cls=[numCol(c)?'col-num':'',out.color?'cell-'+out.color:''].filter(Boolean).join(' ');
   /* 幅を決め打ちする以上、入り切らない値は省略記号になる(§9.94)。
      **切れたものは必ずtitleで読めるようにする**——読めない文字が
      黙って消えるのは、狭い列より悪い。 */
   const clipped=textWidthEm(out.text)>colEm.get(c);
   const tip=(out.text!==raw||clipped)?` title="${esc(raw)}"`:'';
   cells+=`<td data-col="${esc(c)}"${cls?` class="${cls}"`:''}${tip}>${esc(out.text)}</td>`;
  }
  tr.innerHTML=cells+gap(skipped);
  tr.__row=r;   // 行→元データの逆引き(ドラッグ中の印付けに使う。§9.170)
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
    openMeasurement(r).catch(err=>alert('測定画面を開けません: '+err.message));
   };
   /* 行のダブルクリックは**ボタンを消しても残す**——測定を開く導線が
      1つも無くなると、列を隠しただけで機能ごと失われる。 */
   tr.addEventListener('dblclick',open);
   const mb=tr.querySelector('.measurement-action-button');
   if(mb)mb.onclick=open;
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
  if(hasLotDsp){
   const lotBtn=tr.querySelector('.grid-lot-link');
   if(lotBtn)lotBtn.onclick=e=>{e.preventDefault();e.stopPropagation();openLotDsp(pick(r,'lotNo'),castCol?r[castCol]:pick(r,'castingNo'),localStorage.getItem('LotDspLastTabV1')||'1')};
  }
  b.append(tr);
 };
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
 const colCount=ordered.length;
 const rowsFor=cells=>Math.max(5,Math.floor(cells/Math.max(1,colCount)));
 /* ---------- 行が多いときは見えている分だけ置く(§9.95) ----------
    「全件」を入れると行数が桁で増える。3,000行×214列=642,000セルは、
    少しずつ並べても**並べ終えるまでに数十秒**かかる(セル数に比例するのは
    §9.94のとおり)。人が一度に読めるのは画面に入る数十行だけなので、
    **DOMへ置くのも画面の前後だけ**にする。データ(S.rows)は全部持っている
    ので、件数・並べ替え・絞り込み・検索は今までどおり全件に効く。
    しきい値を超えたときだけ効かせる——200件・500件の表は今までと1行も
    変わらない(既存の見え方・テストをそのまま残すため)。 */
 const VIRTUAL_MIN_ROWS=600, VIRTUAL_OVERSCAN=14;
 const virtual=visibleRows.length>VIRTUAL_MIN_ROWS;
 const chunked=!virtual&&visibleRows.length*colCount>CHUNK_MIN_CELLS
               &&visibleRows.length>rowsFor(FIRST_CELLS);
 const first=(virtual||chunked)?rowsFor(FIRST_CELLS):visibleRows.length;
 for(let i=0;i<first;i++)buildRow(visibleRows[i],i);
 t.append(b);$('#grid').replaceChildren(t);
 /* 全件はページの概念が無い(1枚に全部出す)。ページ送りは押せなくする
    ——押せるのに何も起きないボタンは「壊れている」と受け取られる。 */
 allRowsProgress(S.rows.length,S.count);
 $('#page').textContent=isAllRows()?'全件':`${S.page}ページ`;
 $('#prev').disabled=isAllRows()||S.page===1;
 $('#next').disabled=isAllRows()||S.page*effectivePageSize()>=S.count;
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
 const gen=gridGeneration;
 /* 追い判定は**全部並べ終えてから**(§9.94)。継ぎ足しの途中で始めると、
    まだ作られていない行の印を付け損なう。 */
 const afterRows=()=>{
  if(gen!==gridGeneration)return;
  applyPendingScroll();
  if(!splitCheckTargets.length&&!parentCheckTargets.length)return;
  whenIdle(()=>{
   if(gen!==gridGeneration)return;
   prefetchSplitLookups([...splitCheckTargets,...parentCheckTargets]).then(()=>{
    if(gen!==gridGeneration)return;
    checkSplitRowsForMissingChildren(splitCheckTargets);
    checkParentLookupRows(parentCheckTargets);
   });
  });
 };
 const clearTargets=()=>{splitCheckTargets.length=0;parentCheckTargets.length=0};
 if(virtual){
  const rows=setupVirtualRows({gen,grid:$('#grid'),tbody:b,rows:visibleRows,
   colCount,overscan:VIRTUAL_OVERSCAN,buildRow,reset:clearTargets,afterRows});
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
 if(!chunked){afterRows();setupColumnWindow({gen,grid:$('#grid'),colWin,redraw:redrawAll});return}
 const t0=performance.now();
 let at=first,cells=FIRST_CELLS*2;
 const more=()=>{
  if(gen!==gridGeneration)return;              // 描き直された: 続きは要らない
  const end=Math.min(visibleRows.length,at+rowsFor(cells));
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
  bar.innerHTML=`<span class="lt-group" role="group" aria-label="見せ方">
    <button type="button" id="listColumnBtn" class="list-toolbar-btn" title="この一覧に出す列・並び・幅・書式をまとめて設定します">☰ 表示列</button>
    <label class="list-rowgap" title="行の間隔を変えます（この一覧ごとに覚えます）"><span>行間</span>
     <input type="range" id="listRowGap" min="1" max="5" step="1" value="3" aria-label="行の間隔"></label>
   </span>
   <span class="lt-group list-sort" id="listSort" role="group" aria-label="並び" hidden>
    <span class="list-sort-label">並び</span>
    <span class="list-sort-keys" id="listSortKeys"></span>
    <span class="list-sort-preset-wrap">
     <button type="button" id="listSortPresetBtn" class="list-toolbar-btn" aria-haspopup="true" aria-expanded="false"
      title="いつも使う並びを選ぶ・今の並びを保存する">★ いつも使う並び<i>▾</i></button>
     <div class="list-sort-menu" id="listSortMenu" hidden></div>
    </span>
   </span>
   <span class="list-load-chip" id="listLoadChip" title="読み込みにかかった時間の内訳" hidden></span>
   <span class="list-join-chip" id="listJoinChip" hidden></span>`;
  grid.parentNode.insertBefore(bar,grid);
  /* 列の設定はこの一覧の設定パネルへ集約する(§9.88 段2)。名前・並び・幅・
     表示を1箇所で決められるので、ボタンの行き先もここ1つでよい。 */
  bar.querySelector('#listColumnBtn').onclick=()=>WL.listColumns?.toggle();
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
 renderSortBar();
 // 品質データ結合(join_quality)の結果を、成功・失敗どちらも一覧の脇に出す。
 // 以前はサーバー側で黙って素通ししていたため、結合されない理由が分からなかった。
 /* 結合(§9.193)は1件とは限らない。**名前と件数を文字で出す**——色だけだと
    「何がどこから足されたか」が読めない(§3)。失敗した結合の理由も同じ帯へ。 */
 const chip=bar.querySelector('#listJoinChip');
 const info=S.joinQuality;
 if(chip){
  if(!info||!info.count){chip.hidden=true;chip.textContent=''}
  else{
   chip.hidden=false;
   const ok=info.applied&&info.matched>0;
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
    :`結合できません（${info.count}件）`;
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
 let start=-1;
 const draw=()=>{
  if(gen!==gridGeneration)return true;                 // 描き直された: 降りる
  const view=Math.ceil(grid.clientHeight/rowH)+overscan*2;
  const want=Math.max(0,Math.floor(grid.scrollTop/rowH)-overscan);
  // 窓の中に収まっているうちは組み直さない
  if(start>=0&&want>=start&&want+Math.ceil(grid.clientHeight/rowH)<=start+view)return false;
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
 return window.prefetchLotPrefixes(prefixes).catch(()=>{});
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
  const parent=await window.findParentLotFor(row,{light:true});
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
