/* dash-kit.js: ダッシュボード（§9.628・LotScope のグリッドのパネルの移植）が使う小道具を、WaveLog の部品へつなぐ
   ============================================================
   LotScope の画面は共通の小道具（TPA）を呼んでいた。移した画面は`WL.dashKit`を同じ名前で呼ぶ。
   **中身は WaveLog の1箇所へ渡す**（写しを作らない）:
     esc            … base.js の esc
     menu・dismissable・placeBelow・placeAt … 浮く面のふるまいは`WL.popMenu`の1箇所（§9.448。外を押す・Esc・矢印キー・置き場所）
     download       … `WL.base.saveBlob()`（§9.551）
     onText・afterIme … 日本語の変換中は待つ（`WL.base.onTyped()`と同じ決まり・§9.573）
     FILTER_OPS     … 一覧の条件の比べ方（`WL.filterOps`）＋日付の「今日から N 日以内」（サーバーの filter_sql と同じ語彙）
     unsaved.watch  … 保存していない並びを×で失う前に聞く（`WL.closeGuard`）と、画面を離れる前に聞く（ダッシュボードの画面の beforeLeave）
     local          … この端末の覚え（localStorage。読めない・書けない端末でも投げない）
     src            … 集計の元（測定データ・作業予定・データソース）。何が「作業の記録」かはサーバーの /api/dashboard/sources が答え、画面は印を読むだけ
     fetch          … 問い合わせの1箇所: 「この端末の使用設備」（@mine）を`WL.equipment`で置き換え、書込は報告のために控える（`WL.feedback.request()`・§9.578）
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const $=(s,r=document)=>r.querySelector(s);
 const $$=(s,r=document)=>[...r.querySelectorAll(s)];
 const escText=v=>window.esc(v);

 /* この端末の覚え。キーは呼ぶ側の名前のまま（wl.dash.*）。 */
 const local={
  get(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v==null?d:v}catch(e){WL.quiet.note('ダッシュボードの覚えを読めない（既定で続ける）',e);return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){WL.quiet.note('ダッシュボードの覚えを書けない（この画面のあいだだけ覚える）',e)}},
 };

 /* ---------- 日本語の変換中 ---------- */
 let imeNow=false;
 const imeLater=new Map();
 document.addEventListener('compositionstart',()=>{imeNow=true},true);
 document.addEventListener('compositionend',()=>{
  imeNow=false;
  setTimeout(()=>{if(imeNow)return;const fs=[...imeLater.values()];imeLater.clear();fs.forEach(f=>f())},0);
 },true);
 const composing=e=>!!(e&&(e.isComposing||e.keyCode===229));
 function onText(el,fn){WL.base.onTyped(el,e=>fn(el,e))}
 function onTextIn(root,selector,fn){
  const at=e=>{const el=e.target.closest?e.target.closest(selector):null;return el&&root.contains(el)?el:null};
  root.addEventListener('input',e=>{const el=at(e);if(el&&!composing(e))fn(el,e)});
  root.addEventListener('compositionend',e=>{const el=at(e);if(el)fn(el,e)});
 }
 function afterIme(key,fn){if(!imeNow)return fn();imeLater.set(key,fn)}

 /* ---------- 浮く面（WL.popMenu の1箇所へ） ---------- */
 /* 開いた面を、外を押す・Esc で閉じる。戻り値は見張りを外す関数（閉じる処理は呼ばない）。 */
 function dismissable(el,onClose,{keep=null}={}){
  let live=true;
  WL.popMenu.open(el,{owner:keep,at:{x:parseFloat(el.style.left)||0,y:parseFloat(el.style.top)||0},
   onClose:()=>{if(live){live=false;onClose(false)}}});
  return ()=>{if(!live)return;live=false;if(WL.popMenu.isOpen(el))WL.popMenu.close()};
 }
 function placeAt(el,x,y){
  el.style.left=`${Math.round(Math.max(8,Math.min(x,innerWidth-el.offsetWidth-8)))}px`;
  el.style.top=`${Math.round(Math.max(8,Math.min(y,innerHeight-el.offsetHeight-8)))}px`;
 }
 function placeBelow(el,anchor,align='left'){
  const r=anchor.getBoundingClientRect(),w=el.offsetWidth,top=Math.round(r.bottom+6);
  el.style.top=`${top}px`;
  if(/auto|scroll/.test(getComputedStyle(el).overflowY))el.style.maxHeight=`${Math.max(160,innerHeight-top-8)}px`;
  el.style.left=`${Math.round(Math.max(8,Math.min(align==='right'?r.right-w:r.left,innerWidth-w-8)))}px`;
 }
 /* 右クリックのメニュー。器は`.wl-menu`（§9.448）。items: [{label, run, key?, icon?, danger?, disabled?, why?, on?} | {group} | {sep}] */
 function menuItemHtml(it,i){
  if(it.sep)return '<hr class="tm-sep">';
  if(it.group)return `<p class="tm-group">${escText(it.group)}</p>`;
  return `<button type="button" data-i="${i}" class="${it.danger?'is-danger':''}${it.on?' is-on':''}"${it.disabled?' disabled':''}${it.why?` title="${escText(it.why)}"`:''}>`
   +`<i class="tm-ico" aria-hidden="true">${it.on?'✓':escText(it.icon||'')}</i><span>${escText(it.label)}${it.disabled&&it.why?`<small class="tm-why">${escText(it.why)}</small>`:''}</span>`
   +`${it.key?`<kbd>${escText(it.key)}</kbd>`:''}</button>`;
 }
 function menu({x,y,head='',items,onClose=null}){
  const acts=[],m=document.createElement('div');
  m.className='wl-menu dk-menu';
  m.innerHTML=(head?`<p class="tm-head">${escText(head)}</p>`:'')+items.filter(Boolean).map(it=>{
   if(it.sep||it.group)return menuItemHtml(it,-1);
   acts.push(it);return menuItemHtml(it,acts.length-1);
  }).join('');
  document.body.append(m);
  const close=()=>{if(WL.popMenu.isOpen(m))WL.popMenu.close()};
  WL.popMenu.open(m,{at:{x,y},onClose:()=>{m.remove();if(onClose)onClose()}});
  m.addEventListener('contextmenu',e=>e.preventDefault());
  m.addEventListener('click',e=>{
   const b=e.target.closest('button[data-i]');if(!b||b.disabled)return;
   close();acts[+b.dataset.i].run();
  });
  requestAnimationFrame(()=>{const b=m.querySelector('button:not(:disabled)');if(b)b.focus({preventScroll:true})});
  return close;
 }

 /* ---------- 条件の言葉（一覧と同じ比べ方＋日付の「今日から」） ---------- */
 const REL_UNIT={within_days:'日',within_weeks:'週間',within_months:'か月',within_years:'年'};
 const FILTER_OPS=WL.filterOps.OPS.concat(Object.entries(REL_UNIT).map(([k,u])=>[k,`${u}以内（今日から）`]));
 const opShort=op=>(FILTER_OPS.find(x=>x[0]===op)||[op,op])[1].split(' ')[0];
 const relText=f=>`${f.value}${REL_UNIT[f.op]}以内`+(String(f.value)==='0'&&f.op==='within_days'?'（今日）':'');
 function inText(f){
  let v=[];
  if(f.op==='tuple_in')v=f.names||[];
  else try{v=Array.isArray(f.value)?f.value:JSON.parse(f.value||'[]')}catch(e){WL.quiet.note('値の並びを読めない（空として出す）',e)}
  v=Array.isArray(v)?v.map(x=>(x===''?'（空欄）':String(x))):[];
  return v.length?v.slice(0,2).join('・')+(v.length>2?` ほか ${v.length-2}`:''):'（どれも選んでいません）';
 }
 const condLabel=f=>(f.op==='in'||f.op==='tuple_in'?`${f.column} = ${inText(f)}`:f.op in REL_UNIT?`${f.column} ${relText(f)}`
  :WL.filterOps.noValueOp(f.op)?`${f.column} ${opShort(f.op)}`:`${f.column} ${opShort(f.op)} ${f.value}`);

 /* ---------- 置き場の言葉（共通デフォルト＝全員の既定・共通＝全員（共有）・ID＝自分だけ） ---------- */
 const SCOPES={
  me:{name:'自分だけ',see:'この ID にだけ',edit:'自分で',icon:'M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 15c0-3 3-5 6-5s6 2 6 5'},
  all:{name:'全員（共有）',see:'全員',edit:'マスタを書ける端末',icon:'M5 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM11 7a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4M6.5 14c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4'},
  default:{name:'全員の既定',see:'全員',edit:'開発者だけ',icon:'M3 7h10v8H3zM5 7V5a3 3 0 0 1 6 0v2'},
 };
 const scope={
  SCOPES,ORDER:['me','all','default'],
  NAME:Object.fromEntries(Object.entries(SCOPES).map(([k,v])=>[k,v.name])),
  RULE:'自分だけ → 全員（共有）→ 全員の既定 の順に、先にある★が勝ちます',
  icon:k=>`<svg class="dk-sci" viewBox="0 0 16 16" aria-hidden="true"><path d="${SCOPES[k].icon}"/></svg>`,
  head:(k,extra='')=>`<span class="dk-sch"><b>${scope.icon(k)}${SCOPES[k].name}${extra}</b><small><i>見える</i>${SCOPES[k].see}　<i>直せる</i>${SCOPES[k].edit}</small></span>`,
  who:k=>`見える: ${SCOPES[k].see}・直せる: ${SCOPES[k].edit}`,
 };

 /* ---------- 保存していない変更（×で閉じる前・画面を離れる前に聞く） ---------- */
 const watchers=new Map();
 const unsaved={
  watch(key,spec){
   watchers.set(key,spec);
   WL.closeGuard.hold(key,()=>(spec.dirty()?`${typeof spec.label==='function'?spec.label():spec.label}を保存していません`:''));
  },
  /* 画面を離れる前（ダッシュボードの beforeLeave）。保存していなければ聞き、離れてよいなら true */
  async leave(){
   const list=[...watchers.values()].filter(w=>w.dirty());
   if(!list.length)return true;
   const names=list.map(w=>(typeof w.label==='function'?w.label():w.label)).join('・');
   if(!await WL.mm.confirmDiscard(names))return false;
   list.forEach(w=>w.discard&&w.discard());
   return true;
  },
 };

 /* ---------- 集計の元（§9.628） ----------
    鍵は rec（測定データ）・plan（作業予定）・src:<データソース>・role:<役割>。
    role: は組み込みのダッシュボードが「仕掛」などの役割で元を名指す形で、どのデータソースかはサーバーの roles が答える。 */
 const src={
  items:[],roles:{},DEFAULT:'rec',
  set(d){src.items=(d&&d.items)||[];src.roles=(d&&d.roles)||{}},
  /** 鍵 → 元の行（role: は役割を担うデータソースの行） */
  of(key){const k=String(key||'');const real=k.startsWith('role:')?src.roles[k.slice(5)]||'':k;return src.items.find(x=>x.key===real)||null},
  /** 作業の記録か（作業日・直・設備で数えられる元。稼働の図・作業日の期間が使える） */
  isWork:key=>!!(src.of(key)||{}).work,
 };
 /* ---------- 問い合わせ ---------- */
 const MINE='@mine';
 /** 本文の中の設備の並び（equips）の @mine を、この端末の使用設備へ。使用設備が決まっていなければそのまま送る（サーバーが理由を言う） */
 function withMine(v){
  if(Array.isArray(v))return v.map(withMine);
  if(!v||typeof v!=='object')return v;
  const out={};
  for(const [k,x] of Object.entries(v)){
   if(k==='equips'&&Array.isArray(x)){const me=String((WL.equipment&&WL.equipment.get())||'').trim();out[k]=me?x.map(n=>(n===MINE?me:n)):x}
   else out[k]=withMine(x);
  }
  return out;
 }
 /** 設備の名前の字（@mine は「この端末の使用設備」の名前で言う。決まっていなければそう言う） */
 const equipWord=n=>{
  if(n!==MINE)return String(n);
  const me=String((WL.equipment&&WL.equipment.get())||'').trim();
  return me?`${me}（この端末）`:'この端末の使用設備（未登録）';
 };
 /** @param {string} url @param {RequestInit} [opt] @returns {Promise<Response>} */
 async function dashFetch(url,opt){
  /** @type {RequestInit} */
  const o={cache:'no-store',...(opt||{})};
  const method=String(o.method||'GET').toUpperCase();
  if(method==='POST'&&typeof o.body==='string'){try{o.body=JSON.stringify(withMine(JSON.parse(o.body)))}catch(e){WL.quiet.note('問い合わせの本文を読めない（そのまま送る）',e)}}
  const t0=performance.now(),r=await window.fetch(url,o);
  // 読むだけの問い合わせ（集計・列）は控えない。書込（ダッシュボード・セット・設備グループ）は報告に載せる
  if(method!=='GET'&&!/\/api\/dashboard\/(query|fields)$/.test(url)&&WL.feedback&&WL.feedback.request)
   WL.feedback.request({method,url,status:r.status,ms:performance.now()-t0,body:o.body});
  return r;
 }

 WL.dashKit={
  $,$$,esc:escText,clone:v=>JSON.parse(JSON.stringify(v)),
  json:(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
  pad2:n=>String(n).padStart(2,'0'),local,composing,onText,onTextIn,afterIme,
  dismissable,placeAt,placeBelow,menu,
  FILTER_OPS,REL_UNIT,noValueOp:op=>WL.filterOps.noValueOp(op),relText,inText,condLabel,scope,unsaved,
  download:(blob,name)=>WL.base.saveBlob(blob,name),
  src,fetch:dashFetch,MINE,equipWord,
 };
})();
