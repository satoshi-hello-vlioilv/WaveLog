/* ============================================================
   list-slicer.js: 一覧の「スライサー」（§9.591、利用者の指示・LotScope のスライサーと同じ作り）

   決めごと:
    ・列ごとのカードに**値の一覧と件数の棒**。押した値で絞る（同じ列は「または」・列どうしは「かつ」）。
    ・数えるのは**サーバー**（`/api/table/slicer`）——ページの行ではなく、絞り込んだ全件。カードの数は
      **ほかの**絞り込み（検索・条件・ほかのカード）に当たる件数で、自分の列の選択は外して数える
      （選んでいない値の数も見える＝Excel のスライサーと同じ）。0件の値も出す（薄く・押せる）。
    ・選んだ値は一覧の問い合わせの`filters`へ「どれかと同じ」（`in`）で足す（`WL.listHooks.onQuery`）。
      絞り込みの条件（`S.genericFilters`）には入れない＝条件の覚えに焼き付かない。
    ・面は一覧のすぐ上（カードを横に並べる＝仕掛・品質・分割のどれでも同じ形）。開け閉め・カードの列・選んだ値はこの端末に一覧ごと（`wl.listSlicer.v1`）。
   ============================================================ */
(function(){
 'use strict';
 const WL=(window.WL=window.WL||{});
 const KEY='wl.listSlicer.v1',SEARCH_FROM=8,CARD_MAX=6;
 const read=()=>{try{const x=JSON.parse(localStorage.getItem(KEY)||'{}');return x&&typeof x==='object'?x:{}}catch(e){WL.quiet.note('スライサーの覚えを読めない（閉じたまま続ける）',e);return {}}};
 const write=x=>{try{localStorage.setItem(KEY,JSON.stringify(x))}catch(e){WL.quiet.note('スライサーの覚えを書けない（この画面のあいだだけ効く）',e)}};
 const scope=()=>(S.db&&S.table)?`${S.db}:${S.table}`:'';
 function setup(){const s=scope();const x=(read().tables||{})[s];return {open:!!(x&&x.open),cards:(x&&Array.isArray(x.cards)?x.cards:[]).filter(c=>c&&c.column)}}
 function store(st){const s=scope();if(!s)return;const all=read();all.tables=all.tables||{};all.tables[s]=st;write(all)}
 const vals={};      // 列 → {values:[{value,count,all}], truncated, err}
 const qs={};        // 列 → カードの中の「値を探す」
 const blankWord='（空欄）';
 function filters(except){
  return setup().cards.filter(c=>c.column!==except&&(c.sel||[]).length)
   .map(c=>({column:c.column,op:'in',value:c.sel.slice()}));
 }
 /* 一覧の問い合わせへ足す（filters.js が先に`filters`を入れている＝その後ろへ足す）。 */
 WL.listHooks.onQuery(q=>{
  const add=filters();if(!add.length)return;
  let cur=[];try{cur=JSON.parse(q.get('filters')||'[]')}catch(e){WL.quiet.note('絞り込みの並びを読めない（スライサーだけで絞る）',e)}
  q.set('filters',JSON.stringify(cur.concat(add)));
 });
 /* カードの数を取り直す（一覧を描いたあと）。ほかの絞り込みは一覧と同じ問い合わせから作る。 */
 let gen=0;
 async function refresh(){
  const st=setup();paintAll();
  if(!st.open||!st.cards.length||!S.db||!S.table)return;
  const my=++gen;
  const base=WL.listQuery?WL.listQuery():new URLSearchParams();
  await Promise.all(st.cards.map(async c=>{
   const q=new URLSearchParams({db:S.db,table:S.table,column:c.column,search:base.get('search')||''});
   /* 自分の列の選択は外す（ほかの絞り込み＝一覧の filters からこの列のスライサーぶんを抜いたもの）。 */
   let f=[];try{f=JSON.parse(base.get('filters')||'[]')}catch(e){WL.quiet.note('絞り込みの並びを読めない（数は絞り込み無しで数える）',e)}
   const mine=JSON.stringify((c.sel||[]).slice());
   f=f.filter(x=>!(x.op==='in'&&x.column===c.column&&JSON.stringify(x.value)===mine));
   if(f.length)q.set('filters',JSON.stringify(f));
   try{const d=await api('/api/table/slicer?'+q);if(my===gen)vals[c.column]={values:d.values||[],truncated:!!d.truncated,err:''}}
   catch(e){if(my===gen)vals[c.column]={values:[],truncated:false,err:e.message||String(e)}}
  }));
  if(my===gen)paintAll();
 }
 WL.listHooks.onAfter(()=>{placeButton();placePane();refresh()});
 /* 効いている条件として名乗る（§9.612）——0件の案内・帯の「条件 N」が同じ並びを数える。外すのは選んだ値だけ（カードは残す）。 */
 WL.listHooks.onNarrow(()=>{
  const on=setup().cards.filter(c=>(c.sel||[]).length);
  return on.length?{items:on.map(c=>({source:'スライサー',text:`${c.column}: ${c.sel.map(v=>v||blankWord).join('・')}`,kind:'slicer'})),
   clear:()=>clearAll()}:null;
 });
 WL.listHooks.onTabs(()=>{placeButton();placePane()});
 /* ---------- 面 ---------- */
 function placePane(){
  const grid=document.getElementById('grid');if(!grid||!grid.parentNode)return null;
  let pane=document.getElementById('listSlicer');
  const st=setup();
  if(!pane){pane=document.createElement('aside');pane.id='listSlicer';pane.className='sx-pane';pane.setAttribute('aria-label','スライサー')}
  /* 一覧（#grid）は分割表示・ポップアップへ運ばれる（§9.10・運ぶ側も面を一緒に運ぶ）。面はいつも一覧のすぐ上（同じ親）。 */
  if(pane.nextElementSibling!==grid)grid.parentNode.insertBefore(pane,grid);
  pane.hidden=!st.open||!scope();
  return pane;
 }
 function cardHtml(c){
  const v=vals[c.column]||{values:[],truncated:false,err:''};
  const q=(qs[c.column]||'').trim().toLowerCase();
  const list=v.values.filter(x=>!q||(x.value||blankWord).toLowerCase().includes(q));
  const max=Math.max(1,...v.values.map(x=>x.count));
  const sel=new Set(c.sel||[]);
  return `<section class="sx-card" data-sx-col="${esc(c.column)}">
   <div class="sx-ch"><b title="${esc(c.column)}">${esc(c.column)}</b>${sel.size?`<button type="button" class="sx-clear" data-sx-clear title="この列の選択を外します">${sel.size} 選択 ×</button>`:''}
    <button type="button" class="sx-ic" data-sx-drop title="このカードを外します">×</button></div>
   ${v.values.length>=SEARCH_FROM?`<input class="sx-q" data-sx-q value="${esc(qs[c.column]||'')}" placeholder="値を探す" aria-label="${esc(c.column)}の値を探す">`:''}
   <div class="sx-vals">${v.err?`<p class="sx-note is-ng">数えられませんでした: ${esc(v.err)}</p>`
    :list.map(x=>`<button type="button" class="sx-v${sel.has(x.value)?' is-on':''}${x.count?'':' is-zero'}" data-sx-v="${esc(x.value)}" style="--w:${Math.round(x.count/max*100)}%"
      title="${esc(x.value||blankWord)}｜いまの絞り込みで ${x.count}件（絞り込む前 ${x.all}件）"><span>${esc(x.value||blankWord)}</span><b>${x.count.toLocaleString()}</b></button>`).join('')
     ||'<p class="sx-note">当たる値がありません。</p>'}${v.truncated?'<p class="sx-note">値が多いので先頭の200だけ出しています（探す欄で絞れます）。</p>':''}</div></section>`;
 }
 function paintAll(){
  const pane=placePane();paintButton();paintSum();
  if(!pane||pane.hidden)return;
  const st=setup(),used=new Set(st.cards.map(c=>c.column));
  const left=(S.columns||[]).filter(c=>!used.has(c));
  /* 頭は「名前・読み方・列を足す・閉じる」の1行（足す欄は閉じるの隣＝右端の群）。カードは下に横へ並べる。 */
  pane.innerHTML=`<div class="sx-head"><b>スライサー</b><small>押した値で絞ります（同じ列は「または」・列どうしは「かつ」）</small>
    ${st.cards.length<CARD_MAX?`<select class="sx-add" data-sx-add aria-label="スライサーに列を足す"><option value="">＋ 列を足す…</option>${left.map(c=>`<option>${esc(c)}</option>`).join('')}</select>`:''}
    <button type="button" class="sx-ic" data-sx-close title="スライサーを閉じます（選んだ値は外れません）">×</button></div>
   <div class="sx-cards">${st.cards.map(cardHtml).join('')||'<p class="sx-note">右上の「＋ 列を足す」で列を選ぶと、その列の値の一覧と件数が出ます。</p>'}</div>`;
  wire(pane);
 }
 function mutate(fn){const st=setup();fn(st);store(st);}
 function reload(){S.page=1;WL.list.load()}
 function wire(pane){
  const close=pane.querySelector('[data-sx-close]');if(close)close.onclick=()=>{mutate(st=>{st.open=false});paintAll()};
  const add=pane.querySelector('[data-sx-add]');if(add)add.onchange=()=>{if(!add.value)return;mutate(st=>{st.cards.push({column:add.value,sel:[]})});refresh()};
  pane.querySelectorAll('.sx-card').forEach(card=>{
   const col=card.dataset.sxCol;
   wireVals(card,col);
   const clr=card.querySelector('[data-sx-clear]');if(clr)clr.onclick=()=>{mutate(st=>{st.cards.find(x=>x.column===col).sel=[]});reload()};
   const drop=card.querySelector('[data-sx-drop]');if(drop)drop.onclick=()=>{
    const had=(setup().cards.find(x=>x.column===col)||{}).sel||[];
    mutate(st=>{st.cards=st.cards.filter(x=>x.column!==col)});if(had.length)reload();else paintAll()};
   /* 探す欄は**値の並びだけ**描き直す（欄を作り直すと打っている字と変換が飛ぶ）。 */
   const q=card.querySelector('[data-sx-q]');if(q)WL.base.onTyped(q,()=>{qs[col]=q.value;
    const box=card.querySelector('.sx-vals');const tmp=document.createElement('div');tmp.innerHTML=cardHtml(setup().cards.find(x=>x.column===col));
    box.replaceWith(tmp.querySelector('.sx-vals'));wireVals(card,col)});
  });
 }
 function wireVals(card,col){
  card.querySelectorAll('[data-sx-v]').forEach(b=>{b.onclick=()=>{
   mutate(st=>{const c=st.cards.find(x=>x.column===col);const v=b.dataset.sxV;c.sel=c.sel||[];
    const i=c.sel.indexOf(v);if(i>=0)c.sel.splice(i,1);else c.sel.push(v)});reload()}});
 }
 /* ---------- 帯の入口と、状態の帯の札 ---------- */
 function paintButton(){
  const b=document.getElementById('listSlicerBtn');if(!b)return;
  const st=setup(),n=st.cards.filter(c=>(c.sel||[]).length).length;
  b.classList.toggle('is-active',st.open||n>0);b.setAttribute('aria-pressed',String(st.open));
  b.innerHTML=`<i class="fa-solid fa-table-list" aria-hidden="true"></i><span class="lt-tool-t">スライサー</span>${n?`<b class="lt-n">${n}</b>`:''}`;
 }
 function placeButton(){
  const row=document.querySelector('#genericFilterBar .filter-search-row');if(!row)return;
  let b=document.getElementById('listSlicerBtn');
  if(!b){b=document.createElement('button');b.type='button';b.id='listSlicerBtn';b.className='lt-tool-btn sx-entry';
   b.title='スライサー: 列の値の一覧と件数を一覧の上に出し、押した値で絞ります';
   b.onclick=()=>{mutate(st=>{st.open=!st.open});if(setup().open)refresh();else paintAll()}}
  const after=document.getElementById('filterToolsAt');   // 絞り込みの帯の目印（filters.js の骨組み・§9.614）
  if(after&&b.previousElementSibling!==after)after.after(b);
  paintButton();
 }
 function paintSum(){
  const box=document.getElementById('listToolSums');if(!box)return;
  let el=box.querySelector('.sx-sum');
  if(!el){el=document.createElement('span');el.className='sx-sum';box.insertBefore(el,box.firstChild)}
  const on=setup().cards.filter(c=>(c.sel||[]).length);
  el.innerHTML=on.map(c=>{const shown=c.sel.slice(0,3).map(v=>v||blankWord).join('・');
   return `<button type="button" class="sx-chip" data-sx-chip="${esc(c.column)}" title="スライサーの選択（押すと外します）: ${esc(c.column)} = ${esc(c.sel.map(v=>v||blankWord).join('、'))}">${esc(c.column)}: ${esc(shown)}${c.sel.length>3?` ほか${c.sel.length-3}`:''} ×</button>`}).join('');
  el.querySelectorAll('[data-sx-chip]').forEach(b=>{b.onclick=()=>{mutate(st=>{const c=st.cards.find(x=>x.column===b.dataset.sxChip);if(c)c.sel=[]});reload()}});
 }
 /* 表示の設定の書き出し・読み込み（`list-tools.js`）へ渡す形（選んだ値は持たない＝LotScope と同じ）。 */
 const setupOf=()=>{const st=setup();return {open:st.open,cards:st.cards.map(c=>({column:c.column}))}};
 function setSetup(x){store({open:!!(x&&x.open),cards:((x&&x.cards)||[]).filter(c=>c&&c.column).map(c=>({column:String(c.column),sel:[]}))});reload()}
 const summary=()=>setup().cards.filter(c=>(c.sel||[]).length).map(c=>`${c.column}: ${c.sel.map(v=>v||blankWord).join('・')}`);
 const clearAll=()=>mutate(st=>{st.cards.forEach(c=>{c.sel=[]})});
 WL.listSlicer={filters,refresh,setupOf,setSetup,summary,clearAll};
})();
