/* design-fix.js: 設計値（丈数・条数・元幅）の訂正（§9.637）
   ============================================================
   利用者の指示:「メイン測定画面から、設計情報を取り込んだ時に、ごくまれに間違っていることがあり、
   丈数や条数の変更を行わなければならないことがあります。このとき、元幅よりも製品幅×条数の計算値が
   広くなってしまう場合は元幅の修正も必要になりますが、元データの状態と変更したデータの内容がわかり、
   変更したということがわかるようにして修正を受け付けるようにしてほしいです」

   決めごと（答えはこのファイルの1箇所）:
    ・**取り込んだ設計値は記録に控える**（`settings.designBase`・初めて読めたときの値のまま）。
      画面の「設計（元データ）」はこれを読む——仕掛の行は後で変わる・消えることがある。
    ・**変えた値だけを記録に持つ**（`settings.designFix[鍵]`＝{value,at,by,pc}）。設計値へ戻せば消える。
      経過（いつ・誰が・何から何へ）は`settings.designFixLog`に積み、理由は`settings.designFixReason`の1つ。
    ・**使う値は今までの置き場のまま**（`settings.verticalCount`／`settings.horizontalCount`／`basic.originalWidth`）
      ——測定表・屑幅・帳票・ダッシュボードは今までどおりそこを読む（読む側を2通りにしない）。
    ・**仕掛の完全な行の取り直しは、変えた値を上書きしない**（前は保存して開き直すと設計値へ戻っていた）。
      変えていない鍵だけ、今までどおり設計値を当てる（`fromSource()`・lot-split.js が呼ぶ）。
    ・条数を増やして**元幅が足りない**ときは条数を待たせ（`draft`）、元幅の欄へ移って直す数を言う。
      屑幅がマイナスになる条数は受け付けない（§9.210 ⑤）——元幅を直したところで当てる。
    ・丈数・条数は**測定データが入ったら変えられない**（測定表の形が変わる・§9.122 のロック）。元幅はいつでも。
   ============================================================ */
(function(){
'use strict';
/* 項目の顔ぶれ（表の行の順）。`src`は仕掛の行の呼び名（`WL.base.aliases`）、`int`は整数だけ。 */
const ITEMS=[
 {key:'verticalCount',label:'丈数',unit:'丈',src:'boxVerticalCount',int:true,field:'verticalCount'},
 {key:'horizontalCount',label:'条数',unit:'条',src:'boxHorizontalCount',int:true,field:'horizontalCount'},
 {key:'originalWidth',label:'元幅',unit:'mm',src:'originalWidth',int:false,field:''},
];
const ITEM=Object.fromEntries(ITEMS.map(x=>[x.key,x]));
const COUNT_MAX={verticalCount:9,horizontalCount:40};
/* 待たせている条数（元幅が足りない）。記録には持たない——画面を閉じれば捨ててよい下書き。 */
let draft=null;
let reasonFocus=false;

 function st(){const m=S.measure;if(!m)return null;m.settings=m.settings||{};return m.settings}
 function base(){const s=st();if(!s)return {};s.designBase=s.designBase&&typeof s.designBase==='object'?s.designBase:{};return s.designBase}
 function fixes(){const s=st();if(!s)return {};s.designFix=s.designFix&&typeof s.designFix==='object'?s.designFix:{};return s.designFix}
 function log(){const s=st();if(!s)return [];s.designFixLog=Array.isArray(s.designFixLog)?s.designFixLog:[];return s.designFixLog}

/* 数として読む（空・0以下・数でない物は null。`Number('')`は0になる罠を踏まない）。 */
 function numOf(v,int){
 const t=String(v??'').trim();if(!t)return null;
 const n=Number(t);if(!Number.isFinite(n)||!(n>0))return null;
 return int?Math.round(n):n;
}
/* 仕掛の行が言っている設計値（無ければ null）。 */
 function sourceValue(key){
 const it=ITEM[key],m=S.measure;if(!it||!m)return null;
 const n=numOf(pick(m.source||{},it.src),it.int);
 if(n===null)return null;
 return it.int&&n>COUNT_MAX[key]?null:n;
}
/* 控えた設計値（無ければ null）。 */
 function designOf(key){const b=base();return Object.hasOwn(b,key)?b[key]:null}
/* いま使っている値。丈数・条数は欄（打っている途中も含む）→記録、元幅は記録。 */
 function valueOf(key){
 const it=ITEM[key],m=S.measure;if(!it||!m)return null;
 if(key==='originalWidth')return numOf(m.basic?.originalWidth,false);
 const el=document.getElementById(it.field);
 return numOf(el&&el.value!==''?el.value:m.settings?.[key],true);
}
 function user(){const t=window.WL&&WL.terminal;
 return {by:t?t.userId():((typeof currentUserId==='function'&&currentUserId())||''),pc:t?t.pcName():''}}
 function fmt(key,v){if(v===null||v===undefined)return '—';return key==='originalWidth'?Number(v).toFixed(1):String(v)}
 function locked(){
 const m=S.measure;if(!m)return false;
 if(m.settings?.dimensionLocked)return true;
 return ['thickness','width','lateral','burr'].some(k=>(m.measurements?.[k]||[]).some(r=>(r||[]).some(v=>String(v??'').trim()!=='')));
}

/* 使う値を書く（置き場は今までどおり）。丈数・条数は欄と測定表まで描き直す。 */
 function write(key,v){
 const m=S.measure;if(!m)return;
 if(key==='originalWidth'){m.basic=m.basic||{};m.basic.originalWidth=v===null?'':String(v)}
 else{m.settings[key]=v;const el=document.getElementById(ITEM[key].field);if(el)el.value=String(v)}
 /* 描き直しは**今までの配線**に任せる（欄の change が測定表・丈位置・条の設計・屑幅を描き直す）。
    元幅でも条数の欄の change を通す——屑幅と条の設計の札は条の設計の描き直しが持つ。 */
 const el=document.getElementById(key==='verticalCount'?'verticalCount':'horizontalCount');
 if(el)el.dispatchEvent(new Event('change',{bubbles:true}));
 if(key==='originalWidth')WL.measureHooks.run('afterSourceRefresh');
 if(WL.measureSteps&&WL.measureSteps.refresh)WL.measureSteps.refresh();
}
/* 変えた記録を、使う値と設計値から付け外す（人が変えたときだけ呼ぶ）。 */
 function note(key,from){
 const d=designOf(key),v=valueOf(key),fx=fixes(),u=user(),at=new Date().toISOString();
 if(from!==v)log().push({at,by:u.by,pc:u.pc,key,from,to:v,design:d});
 if(d===null||v===d){delete fx[key];return}
 if(!fx[key]||fx[key].value!==v)fx[key]={value:v,at,by:u.by,pc:u.pc};
}
/* 条数の上限（元幅÷製品幅）。判断できないロット（分割・元幅や製品幅が読めない）は null。 */
 function stripLimit(width){
 const lim=WL.split&&WL.split.stripCountLimit?WL.split.stripCountLimit():null;
 if(!lim)return null;
 const w=width===undefined?lim.original:width;
 return {width:lim.width,max:Math.max(1,Math.floor((w+0.0001)/lim.width))};
}

/* ---------- 人が値を変える入口（表の欄・測定表の形の欄）。返すのは {ok, why} ---------- */
 function set(key,raw){
 const it=ITEM[key];if(!it||!S.measure)return {ok:false,why:'測定を開いていません。'};
 const v=numOf(raw,it.int);
 if(v===null)return {ok:false,why:`${it.label}は 0 より大きい数で入れてください。`};
 if(it.int){
  if(locked())return {ok:false,why:`${it.label}は測定データが入っているので変えられません（測定表の形が変わるため。値を消すと変えられます）。`};
  if(v>COUNT_MAX[key])return {ok:false,why:`${it.label}は ${COUNT_MAX[key]} までです。`};
  const max=Number(document.getElementById('horizontalCount')?.max)||40;
  if(key==='horizontalCount'&&v>max)return {ok:false,why:`この設備で割れるのは最大 ${max} 条です（マスタ管理 > 設備の「最大条数」）。`};
  const lim=key==='horizontalCount'?stripLimit():null;
  if(lim&&v>lim.max){
   /* 元幅が足りない。**条数は待たせ、元幅を直したら当てる**（行き止まりにしない）。 */
   draft={key,value:v};paint();focusWidth();
   return {ok:false,wait:true,why:''};
  }
 }
 const from=valueOf(key);
 if(from===v&&!(draft&&draft.key===key)){paint();return {ok:true}}
 if(draft&&draft.key===key)draft=null;
 write(key,v);note(key,from);
 /* 元幅を直して待たせていた条数が入るようになったら、ここで当てる。 */
 if(key==='originalWidth'&&draft){
  const lim=stripLimit(v);
  if(!lim||draft.value<=lim.max){const k=draft.key,dv=draft.value,f=valueOf(k);draft=null;write(k,dv);note(k,f)}
 }
 if(typeof markDirty==='function')markDirty();
 paint();
 return {ok:true};
}
/* 設計値へ戻す（差のセルを押した先の1つ）。 */
 function revert(key){const d=designOf(key);if(d===null)return {ok:false,why:'設計値がありません。'};if(draft&&draft.key===key)draft=null;return set(key,d)}

/* ---------- 仕掛の行が届いたとき（lot-split.js の取り直しが呼ぶ） ----------
   設計値を控え、**変えていない鍵だけ**使う値を設計値へそろえる。変えた鍵は使う値を書き戻す
   （元幅は取り直しで`basic`が仕掛の値へ戻されるため）。 */
 function fromSource(){
 const m=S.measure;if(!m)return;
 const b=base(),fx=fixes(),lock=locked();
 ITEMS.forEach(({key,int})=>{
  const sv=sourceValue(key);
  if(sv!==null&&!Object.hasOwn(b,key))b[key]=sv;
  if(Object.hasOwn(fx,key)){
   if(numOf(key==='originalWidth'?m.basic?.originalWidth:m.settings[key],int)!==fx[key].value)write(key,fx[key].value);
   return;
  }
  if(sv===null||(int&&lock))return;
  if(valueOf(key)!==sv)write(key,sv);
 });
 paint();
}

/* ---------- 記録に残す字（帳票・データ一覧が読む） ---------- */
 function textOf(rec){
 const s=rec&&rec.settings||{},fx=s.designFix||{},b=s.designBase||{};
 const parts=ITEMS.filter(it=>fx[it.key]).map(it=>`${it.label} ${fmt(it.key,b[it.key])}→${fmt(it.key,fx[it.key].value)}`);
 if(!parts.length)return '';
 const reason=String(s.designFixReason||'').trim();
 return parts.join('・')+(reason?`（${reason}）`:'');
}
 function list(){
 const fx=fixes();
 return ITEMS.filter(it=>fx[it.key]).map(it=>({key:it.key,label:it.label,unit:it.unit,design:designOf(it.key),...fx[it.key]}));
}

/* ======================================================================
   画面: 「測定表の形」を表（項目｜設計（元データ）｜使う値｜差）にする。
   欄（#verticalCount・#horizontalCount）は残して伏せる——ほかの処理は今までどおり欄を読む。
   置き場は操業データの格子の中で、欄と同じ`order`（並びはマスタが決める）。
   ====================================================================== */
const HOST_ID='designFixPanel';
 function host(){
 const lh=document.querySelector('label[data-f="horizontalCount"]');
 if(!lh||!lh.parentElement)return null;
 let h=document.getElementById(HOST_ID);
 if(!h){h=document.createElement('div');h.id=HOST_ID;h.className='dfx';wire(h)}
 if(h.previousElementSibling!==lh)lh.after(h);
 h.style.order=lh.style.order;
 ['verticalCount','horizontalCount'].forEach(k=>document.querySelector(`label[data-f="${k}"]`)?.classList.add('dfx-hidden'));
 return h;
}
/* 製品幅×条数（分割ありは子ロットの幅の合計）。待たせている条数があればそれで数える。 */
 function slitOf(count){
 const info=WL.split&&WL.split.scrapInfo?WL.split.scrapInfo():null;
 const lim=WL.split&&WL.split.stripCountLimit?WL.split.stripCountLimit():null;
 if(lim)return {width:lim.width,count,slit:lim.width*count};
 return info?{width:null,count,slit:info.slit}:null;
}
 function figHtml(){
 const W=valueOf('originalWidth'),count=draft&&draft.key==='horizontalCount'?draft.value:valueOf('horizontalCount');
 const s=slitOf(count||1);
 if(W===null||!s||!Number.isFinite(s.slit))return `<div class="dfx-fig is-none"><p class="dfx-fig-say">元幅か製品幅が読めないため、入るかを描けません。</p></div>`;
 const max=Math.max(W,s.slit),pc=v=>(v/max*100).toFixed(2)+'%',over=s.slit-W;
 const cap=s.width!==null?`元幅の中に 製品幅×条数（${fmt('originalWidth',s.width).replace(/\.0$/,'')}×${count}）が入るか`:'元幅の中に 子ロットの幅の合計が入るか';
 /* 屑・不足の**数は書かない**——同じ答えを条の設計の札（元幅 − 条幅 ＝ 屑）が持つ（2か所に出すと数え直す）。
    図が言うのは「入る（斜線＝屑）／入らない（赤＝足りない）」の形と、足りないときの札1つ。 */
 return `<div class="dfx-fig${over>0?' is-short':''}"><div class="dfx-fig-cap">${esc(cap)}</div>`
  +`<div class="dfx-track" role="img" aria-label="${esc(cap)}"><i class="dfx-frame" style="width:${pc(W)}"></i><i class="dfx-slit" style="width:${pc(Math.min(s.slit,W))}"></i>`
  +(over>0?`<i class="dfx-over" style="left:${pc(W)};width:${pc(over)}"></i>`:'')+'</div>'
  +`<div class="dfx-legend"><span><i class="dfx-k-slit"></i>製品幅×条数</span><span><i class="dfx-k-frame"></i>元幅（斜線＝屑）</span>${over>0?'<span><i class="dfx-k-over"></i>はみ出す幅</span>':''}</div></div>`;
}
 function rowHtml(it,lock){
 const d=designOf(it.key),fx=fixes()[it.key],wait=draft&&draft.key===it.key;
 const v=wait?draft.value:valueOf(it.key);
 const short=it.key==='originalWidth'&&draft&&draft.key==='horizontalCount';
 const dis=it.int&&lock;
 let diff='—',cls='';
 if(short){cls='is-bad';diff=fx?`${signed(it.key,v-d)} 変更・足りない`:'足りない'}
 else if(wait){cls='is-wait';diff='元幅を直すと入ります'}
 else if(fx&&d!==null){cls='is-chg';diff=`${signed(it.key,v-d)} 変更`}
 else if(d===null)diff='設計値なし';
 const cell=fx&&!wait&&!short
  ?`<button type="button" class="dfx-d" data-dfx-diff="${it.key}" title="押すと「設計値（${esc(fmt(it.key,d))} ${esc(it.unit)}）へ戻す」が出ます">${esc(diff)}</button>`
  :`<span class="dfx-d">${esc(diff)}</span>`;
 return `<tr class="${cls}" data-dfx-row="${it.key}"><th scope="row">${esc(it.label)}</th>`
  +`<td>${d===null?'—':`${esc(fmt(it.key,d))} ${esc(it.unit)}`}</td>`
  +`<td><input class="dfx-in${it.int?'':' dfx-in-w'}" data-dfx-in="${it.key}" inputmode="${it.int?'numeric':'decimal'}" value="${v===null?'':esc(fmt(it.key,v).replace(/\.0$/,''))}"${dis?' disabled':''} title="${dis?esc(`${it.label}は測定データが入っているので変えられません（値を消すと変えられます）`):esc(`使う${it.label}（${it.unit}）。設計値と違う値にすると「変更」として記録に残ります`)}"> ${esc(it.unit)}</td>`
  +`<td>${cell}</td></tr>`;
}
 function signed(key,n){const t=fmt(key,Math.abs(n)).replace(/\.0$/,key==='originalWidth'?'.0':'');return (n>=0?'＋':'－')+t}
 function warnHtml(){
 if(!(draft&&draft.key==='horizontalCount'))return '';
 const s=slitOf(draft.value),W=valueOf('originalWidth');
 if(!s||W===null)return '';
 return `<p class="dfx-warn" role="alert">${fmt('originalWidth',s.slit)} mm が元幅 ${fmt('originalWidth',W)} mm を超えます。`
  +`<b>元幅を ${fmt('originalWidth',s.slit)} 以上に</b></p>`;
}
 function capHtml(){
 const ls=list();
 /* 待たせている値があるあいだは「設計どおり」と言わない（行は赤いのに右上が設計どおりだと迷う）。 */
 if(draft)return `<div class="dfx-cap"><span>設計値との違い</span><span class="dfx-bad">${esc(ITEM[draft.key].label)} ${draft.value} は元幅待ち</span></div>`;
 if(!ls.length)return `<div class="dfx-cap"><span>設計値との違い</span><span class="dfx-same">設計どおり</span></div>`;
 const last=ls.slice().sort((a,b)=>String(b.at).localeCompare(String(a.at)))[0];
 const t=last.at?new Date(last.at):null,hm=t&&!isNaN(t.getTime())?`${String(t.getHours()).padStart(2,'0')}:${String(t.getMinutes()).padStart(2,'0')}`:'';
 return `<div class="dfx-cap"><span>設計値との違い</span><span class="dfx-who">変更 ${ls.length}項目${last.by?`・${esc(last.by)}`:''}${hm?` ${hm}`:''}</span></div>`;
}
 function paint(){
 if(!S.measure)return;
 const h=host();if(!h)return;
 const lock=locked();
 const active=document.activeElement&&h.contains(document.activeElement)?document.activeElement.dataset.dfxIn||'':'';
 const reason=String(st().designFixReason||'');
 const showReason=list().length>0||!!draft;
 h.innerHTML=`<div class="dfx-tw">${capHtml()}<table class="dfx-t"><thead><tr><th>項目</th><th>設計（元データ）</th><th>使う値</th><th>差</th></tr></thead>`
  +`<tbody>${ITEMS.map(it=>rowHtml(it,lock)).join('')}</tbody></table></div>`
  +`<div class="dfx-col">${figHtml()}${warnHtml()}`
  +(showReason?`<label class="dfx-reason"><span>変えた理由<small>空でも可</small></span><input data-dfx-reason value="${esc(reason)}" maxlength="200" placeholder="例: 設計の取り込み誤り（現物は5条）"></label>`:'')
  +'</div>';
 if(active){const el=h.querySelector(`[data-dfx-in="${active}"]`);if(el){el.focus();el.select?.()}}
 if(reasonFocus){const el=h.querySelector('[data-dfx-reason]');if(el)el.focus();reasonFocus=false}
}
 function focusWidth(){const el=document.querySelector(`#${HOST_ID} [data-dfx-in="originalWidth"]`);if(el){el.focus();el.select?.()}}
 function wire(h){
 const commit=el=>{
  const r=set(el.dataset.dfxIn,el.value);
  if(!r.ok&&r.why){if(typeof showToast==='function')showToast('この値は入れられません',r.why,6000);paint()}
 };
 h.addEventListener('change',ev=>{
  const el=ev.target;
  if(el.matches('[data-dfx-in]'))commit(el);
  else if(el.matches('[data-dfx-reason]')){st().designFixReason=el.value.trim().slice(0,200);if(typeof markDirty==='function')markDirty()}
 });
 h.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&ev.target.matches('[data-dfx-in]')){ev.preventDefault();commit(ev.target)}});
 h.addEventListener('click',ev=>{
  const b=ev.target.closest('[data-dfx-diff]');if(!b)return;
  const key=b.dataset.dfxDiff,it=ITEM[key],d=designOf(key);
  /* 戻すのは主の動線に置かない（差のセルを押した先の1つ）。押した所に「設計値へ戻す」を出す。 */
  const cell=b.parentElement;
  if(cell.querySelector('[data-dfx-revert]')){paint();return}
  cell.insertAdjacentHTML('beforeend',` <button type="button" class="dfx-rev" data-dfx-revert="${key}">設計値（${esc(fmt(key,d))} ${esc(it.unit)}）へ戻す</button>`);
  cell.querySelector('[data-dfx-revert]').onclick=()=>{const r=revert(key);if(!r.ok&&r.why&&typeof showToast==='function')showToast('戻せません',r.why,5000)};
 });
}

/* 測定を開いた・開き直した・描き直したとき。待たせている条数は別のロットへ持ち越さない。 */
let lastId='';
 function onRender(){if(!S.measure)return;if(S.measure.id!==lastId){lastId=S.measure.id;draft=null}fromSource()}
WL.measureHooks.afterRender(onRender);
WL.measureHooks.on('afterGrid',()=>paint());
/* 測定表の形の欄（伏せてあるが、ほかの道から変わることがある）を人が変えたときも記録へ。 */
['verticalCount','horizontalCount'].forEach(k=>document.getElementById(k)?.addEventListener('change',ev=>{
 if(!ev.isTrusted||!S.measure)return;
 const from=numOf(S.measure.settings[k],true);note(k,from);paint();
}));
/* 保存の直前に、記録に残す字をそろえる（帳票の「設計値の変更」・データ一覧の列が読む）。 */
WL.measureHooks.on('collect',m=>{if(m&&m.settings)m.settings.designFixText=textOf(m)});

window.WL=window.WL||{};
WL.designFix={ITEMS,set,revert,fromSource,list,textOf,designOf,valueOf,paint,draft:()=>draft};
})();
