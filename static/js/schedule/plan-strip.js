"use strict";
/* plan-strip.js: 初期画面の「作業予定」の帯（§9.580）
   ============================================================
   利用者の指示:
     「起動画面と初期画面を有料版の製品くらいのクオリティにいい感じにしてほしいです。」
   7案→組合せ7案で選んだ H4 の初期画面の半分。仕掛一覧（初期画面）の上に**1行だけ**、
   この端末の設備の「残り・作業中・次の1本」と、**次にすることを1つ**（続きを測る／次を測る）出す。

   決めたこと
   ------------------------------------------------------------
   ① **一覧の面積は取らない**: 1行・高さ固定（字が変わっても一覧の上端は動かない。
      起動の覆いが外れたあとに組み替えないため・§9.92）。
   ② **数え方と「始められるか」は予定の画面の答え**（`WL.scheduleView.digest()`）。
      ここで数え直さない（写すと予定の画面と食い違う）。
   ③ **始め方も予定の行の「開始」と同じ1本**（`WL.scheduleView.start()`）——測定画面の
      入口を2つにしない（仕掛かっていないロットを断るのも同じ所・§9.51）。
   ④ 出すのは**仕掛の一覧で、設備が決まっているときだけ**。設備が無ければ上の
      「使用設備を設定してください」の帯が言う（同じことを2箇所で言わない）。
   ⑤ 読めなかったら**理由を字で**言い、作業スケジュールへの道だけ残す（§CLAUDE 4）。
   ============================================================ */
(function(){
 /* 一覧を読み直すたびに聞きに行くと、ページめくり・絞り込みのたびに予定を取り直す。
    15秒のあいだは前の答えを使う（設備を変えたとき・測定から戻ったときは取り直す）。 */
 const FRESH_MS=15000;
 let last={eq:'',at:0,data:null,error:'',gen:0};
 const box=()=>document.getElementById('planStrip');
 const onWorkList=()=>!!(S.db&&WL.dataSource&&WL.dataSource.isWork(S.db));
 const pad=n=>String(n).padStart(2,'0');
 const hm=v=>{const d=new Date(String(v||''));return isNaN(d.getTime())?'':`${pad(d.getHours())}:${pad(d.getMinutes())}`};
 const lotOf=e=>e.lotNo||e.title||'';

 /* いまの答えから、字と「次にすること」を決める（描くのとは分ける）。 */
 function plan(eq,d,error){
  if(error)return {meta:`作業予定を読めません（${error}）`,go:null,bad:true};
  if(!d)return {meta:'作業予定を読み込んでいます…',go:null};
  const rest=d.waiting+d.doing.length;
  const parts=[`残り ${rest}件`];
  if(d.doing.length)parts.push(`作業中 ${d.doing.length}件（${d.doing.map(lotOf).join('・')}）`);
  if(d.next)parts.push(`次 ${lotOf(d.next)}${hm(d.next.plannedStart)?`・${hm(d.next.plannedStart)} 開始予定`:''}`);
  else if(d.waiting)parts.push(`いま始められるロットはありません（予定 ${d.waiting}件はまだ${eq}に仕掛かっていません）`);
  if(!rest)parts.splice(0,parts.length,'予定はありません');
  /* 次にすることは1つ: 測っている途中があれば続き、無ければ次の1本。 */
  const go=d.doing.length?{label:`測定の続きを開く（${lotOf(d.doing[0])}）`,entry:d.doing[0]}
   :d.next?{label:`次の測定を始める（${lotOf(d.next)}）`,entry:d.next}:null;
  return {meta:parts.join('・'),go};
 }

 function render(){
  const el=box();if(!el)return;
  const eq=currentConfiguredEquipment();
  const show=!!eq&&onWorkList();
  el.hidden=!show;
  if(!show)return;
  const p=plan(eq,last.eq===eq?last.data:null,last.eq===eq?last.error:'');
  el.classList.toggle('is-bad',!!p.bad);
  el.innerHTML=`<div class="ps-copy"><b class="ps-title">${esc(eq)} の作業予定</b>`
   +`<span class="ps-meta">${esc(p.meta)}</span></div>`
   +`<div class="ps-actions">`
   +(p.go?`<button type="button" class="ps-go" data-ps="go">${esc(p.go.label)}</button>`:'')
   +`<button type="button" class="${p.go?'':'ps-go'}" data-ps="schedule">作業スケジュール</button></div>`;
  const go=el.querySelector('[data-ps="go"]');
  if(go&&p.go){const entry=p.go.entry;go.onclick=async()=>{last.at=0;await WL.scheduleView.start(entry,eq)}}
  el.querySelector('[data-ps="schedule"]').onclick=()=>WL.scheduleView.open();
 }

 async function refresh(force){
  const eq=currentConfiguredEquipment();
  render();
  if(!eq||!onWorkList())return;
  if(!force&&last.eq===eq&&Date.now()-last.at<FRESH_MS)return;
  const gen=++last.gen;
  if(last.eq!==eq)last={eq,at:0,data:null,error:'',gen};
  try{
   const data=await WL.scheduleView.digest(eq);
   if(gen!==last.gen)return;          // 待つあいだに設備が変わった・もう一度聞いた
   last={eq,at:Date.now(),data,error:'',gen};
  }catch(e){
   if(gen!==last.gen)return;
   last={eq,at:Date.now(),data:null,error:(e&&e.message)||String(e),gen};
  }
  render();
 }

 /* 一覧を描いたあと（初回・設備や表の切り替え・測定から戻った読み直し）と、設備を変えたとき。 */
 WL.listHooks.onAfter(()=>{refresh(false)});
 WL.equipment.onChange(()=>{refresh(true)});
 window.WL=window.WL||{};
 WL.planStrip={refresh,plan};
})();
