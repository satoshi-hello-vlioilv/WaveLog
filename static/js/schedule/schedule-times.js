"use strict";
/* schedule-times.js: 実際の時刻を手で入れる小窓（§9.514）
   ============================================================
   利用者の指示:
     「仕掛にないロットや時間的に完了したであろう設備停止は、色を変え、ユーザーに
      登録を促し開始時間だけ(この場合は登録済みの時間を適用する)もしくは開始時間と
      終了時間を入力(ワンクリックでも入れられるような入力補助をいれ、分単位で
      できるだけ簡単に入力できる仕組みを入れること)させるようにしてください。
      (過去の履歴から修正も可能にしてください)」

   決めたこと
   ------------------------------------------------------------
   ① **窓は1つ**（`confirmModal`・§9.342）。予定の画面（時刻を入れる）と段「履歴」
      （時刻を直す）が同じこの部品を呼ぶ——入れ方が2通りあると、片方だけ直る。
   ② **ワンクリック**: 開けた時点で開始の候補（前の行の終わり 等・サーバーの
      `timesHint`）が入っていて、終わりは「見積で終わる」が選ばれている。
      候補で良ければ「登録する」を押すだけ。
   ③ **分単位の補助**: 欄は分まで（`step=60`）。−5分／＋5分／今 のボタン、
      終わりは「開始＋見積」。所要（分）と見積との差をその場で出す。
   ④ **検めるのはサーバー**（`schedule_calc.manual_payload()`）。ここは読みやすい
      理由を先に言うだけ（終わりが始まりより前・読めない）——断られたら窓を開き直し、
      打った値を捨てない。
   ============================================================ */
(function(){
 const pad=n=>String(n).padStart(2,'0');
 /* `datetime-local`の値（分まで・地方時）。 */
 const local=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
 const parse=v=>{const d=new Date(String(v||''));return isNaN(d)?null:d};
 const addMin=(d,m)=>new Date(d.getTime()+m*60000);
 const hm=d=>d?`${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`:'—';
 const floor5=d=>{const x=new Date(d);x.setSeconds(0,0);x.setMinutes(Math.floor(x.getMinutes()/5)*5);return x};
 const minsOf=(a,b)=>Math.round((b-a)/60000);

 /* 行の呼び名（ロット番号・停止の名称）。 */
 function nameOf(e){
  if(e.kind==='設備停止')return `設備停止「${e.title||''}」`;
  return `ロット ${e.lotNo||e.title||('予定'+e.id)}`;
 }

 /* 開いたときの値。**編集（直す）ならいまの値、登録ならサーバーの候補**。 */
 function initial(e){
  const a=e.actual||{};
  const hint=e.timesHint||{};
  const minutes=Number(hint.minutes||(e.estimate||{}).minutes||e.estimateMinutes||0)||0;
  if(a.startAt&&a.source==='手入力'){
   return {start:parse(a.startAt),end:parse(a.endAt),endMode:a.endFrom==='見積'?'estimate':'input',
           minutes,startFrom:'いま登録してある時刻',editing:true};
  }
  let start=parse(hint.start),startFrom=hint.startFrom||'';
  const end=parse(hint.end);
  if(!start){start=floor5(addMin(new Date(),-(minutes||0)));startFrom=minutes?`今から見積${minutes}分を引いた時刻`:'今'}
  return {start,end:end||addMin(start,minutes),endMode:end?'input':'estimate',minutes,startFrom,editing:false};
 }

 function bodyHtml(e,v,err){
  const est=v.minutes?`見積で終わる（${v.minutes}分）`:'見積で終わる';
  return `<div class="sct" id="sctForm">
    <p class="sct-lead"><b>${esc(nameOf(e))}</b>${e.doneReason?`<span>${esc(e.doneReason)}</span>`:''}</p>
    <div class="sct-row">
     <label class="sct-key" for="sctStart">開始</label>
     <input type="datetime-local" id="sctStart" step="60" value="${local(v.start)}">
     <span class="sct-nudge">
      <button type="button" data-sct="start:-5">−5分</button><button type="button" data-sct="start:+5">＋5分</button>
      <button type="button" data-sct="start:now">今</button></span>
     <small class="sct-from" id="sctStartFrom">${v.startFrom?`候補: ${esc(v.startFrom)}`:''}</small>
    </div>
    <div class="sct-row">
     <span class="sct-key">終わり</span>
     <span class="sct-seg" role="radiogroup" aria-label="終わりの決め方">
      <button type="button" role="radio" data-end="estimate" class="${v.endMode==='estimate'?'is-on':''}" aria-checked="${v.endMode==='estimate'}">${esc(est)}</button>
      <button type="button" role="radio" data-end="input" class="${v.endMode==='input'?'is-on':''}" aria-checked="${v.endMode==='input'}">終了の時刻を入れる</button>
     </span>
    </div>
    <div class="sct-row" id="sctEndRow"${v.endMode==='input'?'':' hidden'}>
     <label class="sct-key" for="sctEnd">終了</label>
     <input type="datetime-local" id="sctEnd" step="60" value="${local(v.end||v.start)}">
     <span class="sct-nudge">
      <button type="button" data-sct="end:-5">−5分</button><button type="button" data-sct="end:+5">＋5分</button>
      <button type="button" data-sct="end:now">今</button>
      ${v.minutes?`<button type="button" data-sct="end:est">開始＋見積</button>`:''}</span>
    </div>
    <p class="sct-sum" id="sctSum"></p>
    <p class="sct-err" id="sctErr"${err?'':' hidden'}>${esc(err||'')}</p>
   </div>`;
 }

 /* 窓の中の配線。`confirmModal`は本文を`innerHTML`で入れ替えるので、開くたびに繋ぐ。 */
 function wire(v){
  const f=document.getElementById('sctForm');if(!f)return;
  const st=f.querySelector('#sctStart'),en=f.querySelector('#sctEnd'),row=f.querySelector('#sctEndRow');
  const sum=f.querySelector('#sctSum'),from=f.querySelector('#sctStartFrom');
  const paint=()=>{
   const s=parse(st.value);
   const e=v.endMode==='input'?parse(en.value):(s&&v.minutes?addMin(s,v.minutes):null);
   if(!s){sum.textContent='開始の時刻を入れてください。';sum.className='sct-sum is-ng';return}
   if(!e){sum.textContent='終了の時刻を入れてください。';sum.className='sct-sum is-ng';return}
   const m=minsOf(s,e);
   if(m<0){sum.textContent=`終わり（${hm(e)}）が始まりより前です。`;sum.className='sct-sum is-ng';return}
   const diff=v.minutes?m-v.minutes:null;
   sum.textContent=`${hm(s)} 〜 ${hm(e)}　所要 ${m}分`
    +(diff==null?'':`（見積 ${v.minutes}分${diff?`・${diff>0?'+':''}${diff}分`:'・見積どおり'}）`);
   sum.className='sct-sum';
  };
  f.querySelectorAll('[data-sct]').forEach(b=>b.onclick=()=>{
   const [which,how]=b.dataset.sct.split(':');
   const el=which==='start'?st:en;
   let d=parse(el.value)||new Date();
   if(how==='now')d=new Date();
   else if(how==='est')d=addMin(parse(st.value)||new Date(),v.minutes);
   else d=addMin(d,Number(how));
   d.setSeconds(0,0);el.value=local(d);
   if(which==='start'&&from)from.textContent='';   // 手で動かしたら候補の出どころは消す
   paint();
  });
  f.querySelectorAll('[data-end]').forEach(b=>b.onclick=()=>{
   v.endMode=b.dataset.end;
   f.querySelectorAll('[data-end]').forEach(x=>{const on=x===b;x.classList.toggle('is-on',on);x.setAttribute('aria-checked',String(on))});
   row.hidden=v.endMode!=='input';
   if(v.endMode==='input'&&!parse(en.value))en.value=st.value;
   paint();
  });
  st.addEventListener('input',()=>{if(from)from.textContent='';paint()});
  en.addEventListener('input',paint);
  paint();
 }

 /* 開く。`opts.equipment`＝どの設備の予定か、`opts.onSaved`＝保存できたら呼ぶ。
    戻り値: 保存できたら true、やめたら false。 */
 async function open(e,opts={}){
  if(!e)return false;
  const v=initial(e);
  let err='';
  for(;;){
   const shown=confirmModal({eyebrow:v.editing?'EDIT TIMES':'ACTUAL TIMES',
    title:v.editing?'実際の時刻を直す':'実際の時刻を入れる',
    bodyHtml:bodyHtml(e,v,err),confirmLabel:v.editing?'直す':'登録する',cancelLabel:'やめる',
    focus:'#appConfirmOk'});
   wire(v);   // 本文は`confirmModal`が呼ばれた時点で入っている
   if(!await shown)return false;
   const st=(document.getElementById('sctStart')||{}).value||'';
   const en=v.endMode==='input'?((document.getElementById('sctEnd')||{}).value||''):'';
   /* 打った値は次に開き直したときにも使う（断られても捨てない）。 */
   v.start=parse(st)||v.start;if(en)v.end=parse(en);
   if(!parse(st)){err='開始の時刻を入れてください。';continue}
   if(v.endMode==='input'&&!parse(en)){err='終了の時刻を入れてください。';continue}
   if(v.endMode==='input'&&parse(en)<parse(st)){err='終わりが始まりより前です。終了を開始より後にしてください。';continue}
   try{
    await api('/api/schedule/plan/update',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:e.id,equipment:opts.equipment||'',actualStart:st,actualEnd:en})});
   }catch(x){err=x.message||String(x);continue}
   showToast(v.editing?'時刻を直しました':'時刻を登録しました',
    `${nameOf(e)}: ${hm(parse(st))} 〜 ${en?hm(parse(en)):`見積${v.minutes}分で終わり`}`);
   if(typeof opts.onSaved==='function')await opts.onSaved();
   return true;
  }
 }

 window.WL=window.WL||{};
 WL.scheduleTimes={open,initial};
})();
