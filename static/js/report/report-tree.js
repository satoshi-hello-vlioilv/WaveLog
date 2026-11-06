'use strict';
/* report-tree.js: 帳票の左の一覧を「日付 →（直）→ ロット」の木にする（§9.642）
   ============================================================
   利用者の指摘「帳票の表示画面の左側の対象リストが数が増えたときに見えないくらい細く潰れてカード表示されるので
   わからないので使えない」「ツリービューで日付（太陽暦と現場歴の切り替え、現場歴の場合は直の階層も追加）と
   ロット情報を階層構造にして、検索しやすい・探しやすいリストに」。

   潰れていた理由: 縦の flex の器（`.rp-lot-list`）に行を並べ、行が`overflow:hidden`だったため行の最小の高さが0になり、
   80件で1行6.6pxまで縮んでいた（中身は全行で切れていた）。木の行は縮まない（`flex:none`）。

   役割の分け方:
    ・木の組み立ては`build()`の1箇所（純粋な関数・画面を知らない）。日付の分け方は2つ（`BASES`）。
    ・現場歴の日と直は**勤務形態マスタが決める**のでサーバーが答える（`/api/measurement/record-dates`・
      `actuals.date_shift()`の1箇所）。太陽暦の日も同じ答えを読む（届く前と届かないときだけ端末の時計の日付）。
    ・記録の代表時刻は`refAt()`の1箇所（作業開始 → 作業終了 → 更新時刻・実績の一覧と同じ順）。
    ・描くのは`render()`。どのロットを選んでいるか・一括印刷の選びは帳票の側（呼ぶ側）が持ち、木は読むだけ。
   ============================================================ */
(function(){
 const WL=window.WL;
 /* 日付の分け方。字はここ1箇所（切り替えの札・節の副題・網）。 */
 const BASES={cal:{label:'太陽暦',hint:'記録の時刻の暦の日付で分けます'},
  work:{label:'現場歴',hint:'勤務形態マスタの直で分け、日をまたぐ直は始まった日に入れます（日付補正）'}};
 const NO_DATE='日付なし',NO_SHIFT='直なし';
 const STORE_KEY='wl.rpTree.basis';
 const WEEK='日月火水木金土';
 const pad=n=>String(n).padStart(2,'0');

 /* 記録の代表時刻（実績の一覧`actuals._with_shift`と同じ順）。 */
 function refAt(x){const w=(x&&x.workTime)||{};return String(w.startAt||w.endAt||(x&&x.updatedAt)||'')}
 function localDate(iso){
  const d=new Date(iso);if(!iso||Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 }
 function hm(iso){const d=new Date(iso);return !iso||Number.isNaN(d.getTime())?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`}
 function equipmentOf(x){const s=(x&&x.settings)||{};return s.registeredEquipment||x.registeredEquipment||(x.snapshot||{}).registeredEquipment||''}
 /* 'YYYY-MM-DD' → 「2026/10/25(日)」。**文字列のまま組む**（`new Date('2026-10-25')`はUTCの0時で読まれ、1日ずれる端末がある）。 */
 function dateLabel(ymd){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd||''));if(!m)return NO_DATE;
  return `${m[1]}/${m[2]}/${m[3]}(${WEEK[new Date(+m[1],+m[2]-1,+m[3]).getDay()]})`;
 }

 /* ---------- サーバーの答え（日付と直）の控え ----------
    鍵は記録ID＋代表時刻（時刻が変われば引き直す）。引けなかった理由は`state.error`（画面が字で言う）。 */
 const dates=new Map();
 const state={error:'',pending:false};
 const keyOf=x=>`${x.id}\u0001${refAt(x)}`;
 async function fetchDates(items){
  const want=(items||[]).filter(x=>x&&x.id&&!dates.has(keyOf(x)));
  if(!want.length)return false;
  state.pending=true;
  try{
   const r=await window.api('/api/measurement/record-dates',{quiet:true,method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({items:want.map(x=>({id:String(x.id),equipment:equipmentOf(x),at:refAt(x)}))})});
   const got=(r&&r.dates)||{};
   want.forEach(x=>{const d=got[String(x.id)];if(d)dates.set(keyOf(x),d)});
   state.error='';
   return true;
  }catch(e){
   /* 引けなかった記録は控えに「無し」で残す（描き直すたびに引き直して回り続けない）。開き直すと`forgetFailed()`で引き直す。 */
   state.error=(e&&e.message)||'取得できませんでした';want.forEach(x=>dates.set(keyOf(x),null));return true}
  finally{state.pending=false}
 }
 function datesOf(x){
  const d=dates.get(keyOf(x));
  if(d)return d;   // null＝引けなかった（暦の日付で並べる）
  const c=localDate(refAt(x));
  return {calDate:c||null,workDate:null,shift:'',shiftOrder:null};
 }

 /* ---------- 木の組み立て（1箇所） ----------
    items: 記録の配列（呼ぶ側が絞り・並べ替え済み）。basis: 'cal'|'work'。newestFirst: 日付の並び。
    返す: [{key,label,date,count,children:[{key,label,count,items}]|null,items}]。現場歴は日の下に直の節。 */
 function build(items,basis,newestFirst){
  const byDay=new Map();
  for(const x of items||[]){
   const d=datesOf(x);
   const day=(basis==='work'?(d.workDate||d.calDate):d.calDate)||'';   // 直が届く前・引けないときは暦の日
   if(!byDay.has(day))byDay.set(day,[]);
   byDay.get(day).push(x);
  }
  const days=[...byDay.keys()].sort((a,b)=>!a?1:!b?-1:(newestFirst?b.localeCompare(a):a.localeCompare(b)));
  return days.map(day=>{
   const list=byDay.get(day);
   const node={key:`${basis}:${day}`,label:dateLabel(day),date:day,count:list.length,items:list,children:null};
   if(basis==='work'){
    const bySh=new Map();
    for(const x of list){const d=datesOf(x),s=d.shift||'';
     if(!bySh.has(s))bySh.set(s,{order:d.shiftOrder,items:[]});bySh.get(s).items.push(x)}
    node.children=[...bySh.entries()]
     .sort(([a,A],[b,Bv])=>Number(!a)-Number(!b)||((A.order??99)-(Bv.order??99))||a.localeCompare(b,'ja'))
     .map(([s,v])=>({key:`${node.key}/${s}`,label:s||NO_SHIFT,count:v.items.length,items:v.items}));
   }
   return node;
  });
 }

 /* ---------- 描く ----------
    ctx: {items, basis, newestFirst, selectedId, picked:Set, query,
          onSelect(x), onOpen(x), onPick(ids,on), statusLabel(x), statusClass(x)} */
 const open=new Set();      // 開いている節の鍵（この画面のあいだ・人が開けた閉じたを覚える）
 const touched=new Set();   // 人が触った節（既定の開き方より人の操作が勝つ）
 function isOpen(node,ctx,first){
  if(ctx.query)return true;                        // 探しているあいだは当たった節を全部開く（探させない）
  if(touched.has(node.key))return open.has(node.key);
  if(first)return true;                            // 既定: いちばん上の日と、その日の並びの先頭の記録（新しい順なら最新）を持つ直を開く
  return !!(ctx.selectedId&&node.items.some(x=>String(x.id)===String(ctx.selectedId)));
 }
 const esc=s=>window.esc(s);
 function checkHtml(items,ctx){
  const n=items.filter(x=>ctx.picked.has(x.id)).length;
  const say=`この${items.length}件を一括印刷に選ぶ`;
  return `<input type="checkbox" class="rp-tn-check" data-state="${n===0?'none':n===items.length?'all':'some'}"${n===items.length&&n?' checked':''} title="${say}" aria-label="${say}">`;
 }
 /* 探している字に印を付ける（どこで当たったかを見せる・推測させない）。比べ方は帳票の一覧の検索と同じ（NFKC・大小を問わない）。 */
 function mark(text,q){
  const t=String(text||'');if(!q)return esc(t);
  const n=t.normalize('NFKC').toLowerCase(),k=q.normalize('NFKC').toLowerCase();
  const i=n.indexOf(k);
  if(i<0||n.length!==t.length)return esc(t);
  return esc(t.slice(0,i))+'<mark>'+esc(t.slice(i,i+k.length))+'</mark>'+esc(t.slice(i+k.length));
 }
 function leafHtml(x,ctx,multiEq){
  const lot=(x.basic&&x.basic.lotNo)||x.id,eq=equipmentOf(x),insp=(x.basic&&x.basic.inspectionNo)||'';
  const on=String(x.id)===String(ctx.selectedId),q=ctx.query;
  const sub=[insp&&`検査 ${mark(insp,q)}`,(multiEq||(q&&mark(eq,q)!==esc(eq)))&&mark(eq,q)].filter(Boolean).join('・');
  /* チェックは節と同じ右端の列（一括印刷の選びは1本の列で読む）。 */
  return `<div class="rp-lot-row${on?' active is-selected':''}${ctx.picked.has(x.id)?' checked':''}" role="treeitem" aria-selected="${on}" data-id="${esc(x.id)}">`
   +`<button type="button" class="rp-lot-main-btn" title="${esc(lot)}（ダブルクリックで測定画面を開きます）">`
   +`<span class="rp-lot-main"><b>${mark(lot,q)}</b><time>${esc(hm(refAt(x)))}</time>`
   +`<em class="rp-status-badge ${ctx.statusClass(x)}">${esc(ctx.statusLabel(x))}</em></span>`
   +(sub?`<span class="rp-lot-sub">${sub}</span>`:'')+`</button>`
   +`<label class="rp-lot-check" title="一括印刷の対象に含めます"><input type="checkbox"${ctx.picked.has(x.id)?' checked':''}></label></div>`;
 }
 function nodeHtml(node,ctx,depth,first,multiEq){
  const o=isOpen(node,ctx,first);
  const kids=node.children
   ?node.children.map(c=>nodeHtml(c,ctx,depth+1,first&&c.items.includes(node.items[0]),multiEq)).join('')
   :node.items.map(x=>leafHtml(x,ctx,multiEq)).join('');
  return `<div class="rp-tn rp-tn--d${depth}" role="treeitem" aria-expanded="${o}" data-key="${esc(node.key)}">`
   +`<div class="rp-tn-head">`
   +`<button type="button" class="rp-tn-toggle" aria-label="${o?'畳む':'開く'}"><i aria-hidden="true">${o?'▾':'▸'}</i>`
   +`<span class="rp-tn-label">${esc(node.label)}</span><span class="rp-tn-count">${node.count}件</span></button>`
   +checkHtml(node.items,ctx)+`</div>`
   +`<div class="rp-tn-kids" role="group"${o?'':' hidden'}>${o?kids:''}</div></div>`;
 }
 function stateHtml(ctx){
  const hit=ctx.query?`<p class="rp-tree-note">「${esc(ctx.query)}」に当たるロット ${ctx.items.length}件</p>`:'';
  return hit+workStateHtml(ctx);
 }
 function workStateHtml(ctx){
  if(ctx.basis!=='work')return '';
  if(state.error)return `<p class="rp-tree-note is-bad">現場歴の日付と直を引けませんでした（${esc(state.error)}）。太陽暦の日付で並べています。</p>`;
  if(state.pending)return `<p class="rp-tree-note">直を引いています…</p>`;
  return '';
 }
 function render(host,ctx){
  const tree=build(ctx.items,ctx.basis,ctx.newestFirst);
  const multiEq=new Set(ctx.items.map(equipmentOf)).size>1;
  host.innerHTML=stateHtml(ctx)+`<div class="rp-tree" role="tree" aria-label="帳票の対象（${esc(BASES[ctx.basis].label)}）">`
   +tree.map((n,i)=>nodeHtml(n,ctx,0,i===0,multiEq)).join('')+`</div>`;
  wire(host,ctx,tree);
 }
 function findNode(tree,key){for(const n of tree){if(n.key===key)return n;for(const c of n.children||[])if(c.key===key)return c}return null}
 function wire(host,ctx,tree){
  const byId=new Map(ctx.items.map(x=>[String(x.id),x]));
  host.onclick=e=>{
   const t=e.target;
   const tg=t.closest('.rp-tn-toggle');
   if(tg){const key=tg.closest('.rp-tn').dataset.key;const was=tg.closest('.rp-tn').getAttribute('aria-expanded')==='true';
    touched.add(key);if(was)open.delete(key);else open.add(key);render(host,ctx);
    host.querySelector(`.rp-tn[data-key="${CSS.escape(key)}"] .rp-tn-toggle`)?.focus();return}
   const leaf=t.closest('.rp-lot-row');
   if(leaf&&t.closest('.rp-lot-main-btn')){const x=byId.get(leaf.dataset.id);if(x)ctx.onSelect(x)}
  };
  host.ondblclick=e=>{const leaf=e.target.closest('.rp-lot-row');if(!leaf||!e.target.closest('.rp-lot-main-btn'))return;
   e.preventDefault();const x=byId.get(leaf.dataset.id);if(x)ctx.onOpen(x)};
  host.onchange=e=>{
   const t=e.target;if(t.type!=='checkbox')return;
   const leaf=t.closest('.rp-lot-row');
   if(leaf&&t.closest('.rp-lot-check')){ctx.onPick([leaf.dataset.id],t.checked);return}
   const tn=t.closest('.rp-tn');if(!tn)return;
   const node=findNode(tree,tn.dataset.key);if(node)ctx.onPick(node.items.map(x=>String(x.id)),t.checked);
  };
  /* 節の印の3つ目の状態（いくつか選んでいる）は属性では付けられないので描いたあとに当てる。 */
  host.querySelectorAll('.rp-tn-check[data-state="some"]').forEach(c=>{c.indeterminate=true});
  host.onkeydown=e=>keyNav(e,host);
 }
 /* 鍵盤: ↑↓で見えている行を移る・←→で畳む／開く（木の決まり・WAI-ARIA の tree）。 */
 function keyNav(e,host){
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
  const items=[...host.querySelectorAll('.rp-tn-toggle,.rp-lot-main-btn')].filter(b=>b.offsetParent!==null||b.getClientRects().length);
  const i=items.indexOf(document.activeElement);if(i<0)return;
  e.preventDefault();
  const cur=items[i],tn=cur.closest('.rp-tn');
  if(e.key==='ArrowDown')items[Math.min(items.length-1,i+1)].focus();
  else if(e.key==='ArrowUp')items[Math.max(0,i-1)].focus();
  else if(cur.classList.contains('rp-tn-toggle')){
   const on=tn.getAttribute('aria-expanded')==='true';
   if((e.key==='ArrowRight')!==on)cur.click();
   else if(e.key==='ArrowLeft'){tn.parentElement.closest('.rp-tn')?.querySelector('.rp-tn-toggle')?.focus()}
  }else if(e.key==='ArrowLeft')tn?.querySelector('.rp-tn-toggle')?.focus();
 }
 /* 選んだロットの節を開いて見える所へ（帳票を外から開いたとき・探させない）。 */
 function reveal(host,id){
  const row=host.querySelector(`.rp-lot-row[data-id="${CSS.escape(String(id))}"]`);
  if(row)row.scrollIntoView({block:'nearest'});
 }

 function basis(){try{return localStorage.getItem(STORE_KEY)==='work'?'work':'cal'}catch(e){WL.quiet.note('端末の控えを読めない（太陽暦で出す）',e);return 'cal'}}
 function setBasis(v){try{localStorage.setItem(STORE_KEY,v==='work'?'work':'cal')}catch(e){WL.quiet.note('端末の控えへ書けない（この画面のあいだだけ効く）',e)}}

 function forgetFailed(){for(const [k,v] of dates)if(v===null)dates.delete(k);state.error=''}

 WL.reportTree={BASES,refAt,build,render,reveal,fetchDates,forgetFailed,basis,setBasis,dateLabel,state};
})();
