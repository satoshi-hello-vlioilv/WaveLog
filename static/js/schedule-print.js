"use strict";
/* schedule-print.js: 作業予定表の印刷(§9.115)
   ============================================================
   現場へ配って使う紙を出す。

   **画面のタイムラインをそのまま印刷しない。** 画面は15列以上あり、
   横に長い表をA4へ押し込むと文字が読めない大きさになる。紙に要るのは
   「何を・いつ・どの順で流すか」だけなので、専用の割り付けを別に組む。

   紙の決まりごと:
    ・**1設備・1日で1枚**。現場は日ごと・ラインごとに配るので、
      1枚に複数の日や設備が混ざると渡す相手が決まらない。
    ・**実績を書く欄を紙に置く**。配る目的の半分は「書いて戻してもらう」
      ことなので、書く場所が無いと結局手書きの別紙が要る。
    ・A4の割り付けは**mm(用紙)とpx(文字)の固定**。表示サイズ(--ui-scale)へ
      追随させると、画面の拡大率で紙の行数が変わってしまう
      (CLAUDE.mdの「例外はA4帳票だけ」と同じ理由。既存の.rp-pageに揃える)。
    ・**画面に出ている条件をそのまま持っていく**。表示範囲・内容の項目は
      利用者が既に選んでいるので、紙だけ別の条件で出すと突き合わせられない。
   ============================================================ */
(function(){
 const AREA_ID='schedulePrintArea';
 const PRINT_CLASS='sc-print';

 /* 区分の紙での書き方。画面は色と記号で示しているが、**紙は白黒で刷られる**
    ので文字で言い切る(色だけで意味を伝えない、と同じ理由)。 */
 const STATE_LABEL={'予定':'予定','着手':'作業中','完了':'完了','取消':'取消'};

 const two=n=>String(n).padStart(2,'0');
 function hm(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
 }
 function dayKey(iso){
  if(!iso)return '';
  const d=new Date(iso);if(Number.isNaN(d.getTime()))return '';
  return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;
 }
 const WD=['日','月','火','水','木','金','土'];
 function dayLabel(key){
  if(!key)return '日付未定';
  const d=new Date(key+'T00:00:00');
  if(Number.isNaN(d.getTime()))return key;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）`;
 }
 function rangeLabel(rows){
  const keys=(rows||[]).map(r=>dayKey(r.start)).filter(Boolean).sort();
  if(!keys.length)return '日付未定';
  const a=dayLabel(keys[0]),b=dayLabel(keys[keys.length-1]);
  return a===b?a:`${a} 〜 ${b}`;
 }
 function minutesText(m){
  if(m==null||Number.isNaN(m))return '';
  const n=Math.round(m);
  return n>=60?`${Math.floor(n/60)}:${two(n%60)}`:`${n}分`;
 }
 function stamp(){
  const d=new Date();
  return `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
 }

 /* ---------- 印刷する中身を組み立てる ----------
    entriesは画面が持っているものをそのまま受け取る(紙のために取り直さない
    ——取り直すと画面と紙で件数が食い違い、どちらが正か分からなくなる)。 */
 function buildPages(equipment,entries,opt){
  const rows=(entries||[]).filter(e=>{
   if(e.__pending)return false;                  // まだサーバーに無いものは刷らない
   const st=e.state||'予定';
   if(st==='完了'||st==='取消')return !!opt.includeDone;
   return true;
  });
  /* **日付ごとに束ねる。** 並びは画面の順(=実際に流す順)のまま。
     時刻で並べ直さないこと——固定開始や停止の差し込みで、画面の順と
     時刻の順は必ずしも一致しない。現場が見るのは「流す順」。 */
  const groups=[];const index=new Map();
  rows.forEach(e=>{
   const useActual=(e.state==='完了'||e.state==='着手')&&e.actual&&e.actual.startAt;
   const start=useActual?e.actual.startAt:e.plannedStart;
   const key=opt.pageByDate?dayKey(start):'';
   if(!index.has(key)){const g={key,label:dayLabel(key),rows:[]};index.set(key,g);groups.push(g)}
   index.get(key).rows.push({e,start,end:useActual?e.actual.endAt:e.plannedEnd});
  });
  return groups.map(g=>({
   /* 日付で分けないときは、束ねた中身の**実際の範囲**を書く。
      キーが空だからと「日付未定」にすると、日付を持っている予定まで
      日付不明の紙として配られてしまう。 */
   equipment,day:opt.pageByDate?g.label:rangeLabel(g.rows),rows:g.rows,
   /* 見出しに出す「その日ぶん」の合計。**紙を切り分けても変えない**
      （2枚目に「12件」と出ると、その日が12件だと読まれてしまう）。 */
   count:g.rows.length,
   total:g.rows.reduce((s,x)=>s+((x.e.estimate&&x.e.estimate.minutes)||0),0),
  }));
 }

 /* ---------- 何枚になるかは「測って」決める ----------
    A4へ何行載るかは内容欄の折り返し次第で変わる（1行の日と2行の日で倍違う）。
    **定数で決め打ちにしないこと**——足りなければ最後の数件が次の紙へこぼれ、
    脚の「1 / 4」が嘘になる。配る紙で枚数の表示が違うのは、受け取った側が
    「自分のぶんが足りない」と判断できなくなるので致命的。

    紙と同じ幅の器へ一度描いて、**行の高さを実測してから**切る。
    測るときは高さを固定しないこと——flexの器で高さを決めると表が縮められ、
    実際より多くの行が入るように見える（そのまま刷ると溢れる）。 */
 const SHEET_SLACK_PX=6;   // 罫線と丸めのぶんの余裕。0だと最後の1行が端に噛む
 function splitToSheets(pages,opt){
  const area=ensureArea();
  const keep=area.getAttribute('style');
  const out=[];
  try{
   area.setAttribute('style','display:block;position:fixed;left:-10000px;top:0;width:210mm;visibility:hidden');
   (pages||[]).forEach(p=>{
    if(!p.rows||!p.rows.length){out.push({...p,startNo:1,part:1,parts:1});return}
    area.innerHTML=pageHtml({...p,startNo:1,part:1,parts:1},opt,1,1);
    const pg=area.querySelector('.sp-page'),foot=area.querySelector('.sp-foot');
    const trs=[...area.querySelectorAll('tbody tr')];
    if(!pg||!foot||!trs.length){out.push({...p,startNo:1,part:1,parts:1});return}
    const cs=getComputedStyle(pg);
    /* 用紙1枚の高さはmm指定なので、computedStyleがpxへ直したものを借りる
       （mm→pxの換算を自前で持つと、いつか96dpi決め打ちが混ざる）。 */
    const sheetH=parseFloat(cs.minHeight)||0;
    const padBottom=parseFloat(cs.paddingBottom)||0;
    const limit=pg.getBoundingClientRect().top+sheetH-padBottom-foot.offsetHeight-SHEET_SLACK_PX;
    const hs=trs.map(t=>t.getBoundingClientRect().height);
    const avail=limit-trs[0].getBoundingClientRect().top;
    const chunks=[];let cur=[],acc=0;
    hs.forEach((h,i)=>{
     if(cur.length&&acc+h>avail){chunks.push(cur);cur=[];acc=0}
     cur.push(i);acc+=h;
    });
    if(cur.length)chunks.push(cur);
    chunks.forEach((idx,i)=>out.push({...p,rows:idx.map(j=>p.rows[j]),
      startNo:idx[0]+1,part:i+1,parts:chunks.length}));
   });
  }finally{
   area.innerHTML='';
   if(keep==null)area.removeAttribute('style');else area.setAttribute('style',keep);
  }
  return out;
 }

 function cellsOf(item,no,opt){
  const e=item.e;
  const state=STATE_LABEL[e.state]||e.state||'';
  const time=item.start?(e.ongoing?`${hm(item.start)}〜継続中`:`${hm(item.start)}〜${hm(item.end)}`):'未定';
  const content=(typeof WL.scheduleView?.contentTextOf==='function')
   ? WL.scheduleView.contentTextOf(e) : (e.title||'');
  /* 見積が実績由来でないときは印を添える(§9.114)。紙でも「この時間は
     どのくらい当てになるのか」が分かるようにしておく。 */
  const src=(e.estimate&&e.estimate.source)||'';
  const est=e.estimate?minutesText(e.estimate.minutes):'';
  const estMark=(src==='equipment-standard'||src==='default')?'~':'';
  const cells=[
   `<td class="sp-c-no">${no}</td>`,
   `<td class="sp-c-state">${esc(state)}</td>`,
   `<td class="sp-c-time">${esc(time)}</td>`,
   `<td class="sp-c-shift">${esc(e.shift||'')}</td>`,
   `<td class="sp-c-lot">${esc(e.lotNo||'')}</td>`,
   `<td class="sp-c-content">${esc(content)}</td>`,
   `<td class="sp-c-est">${esc(estMark+est)}</td>`,
  ];
  if(opt.actualColumns){
   cells.push('<td class="sp-c-write"></td>','<td class="sp-c-write"></td>','<td class="sp-c-check"></td>');
  }
  return cells.join('');
 }

 function pageHtml(page,opt,pageNo,pageCount){
  const head=[
   '<th class="sp-c-no">#</th>','<th class="sp-c-state">区分</th>',
   '<th class="sp-c-time">予定時刻</th>','<th class="sp-c-shift">勤務</th>',
   '<th class="sp-c-lot">ロット番号</th>','<th class="sp-c-content">内容</th>',
   '<th class="sp-c-est">見積</th>',
  ];
  if(opt.actualColumns){
   head.push('<th class="sp-c-write">実績 開始</th>','<th class="sp-c-write">実績 終了</th>',
             '<th class="sp-c-check">確認</th>');
  }
  /* **通し番号はその日の頭から数える。** 紙が2枚に分かれても#1へ戻さない
     （現場は番号で呼び合うので、同じ日に#1が2つあると指せなくなる）。 */
  const from=page.startNo||1;
  const body=page.rows.map((item,i)=>
   `<tr class="${item.e.kind!=='作業'?'sp-row-stop':''}">${cellsOf(item,from+i,opt)}</tr>`).join('')
   ||`<tr><td class="sp-empty" colspan="${head.length}">この日に出す予定はありません</td></tr>`;
  /* 総見積。紙を受け取った人が最初に見るのは「今日どれだけあるか」。
     **切り分けた紙でもその日の合計を出す**（この紙に載っている数ではない）。 */
  const count=page.count==null?page.rows.length:page.count;
  const total=page.total==null
   ? page.rows.reduce((s,x)=>s+((x.e.estimate&&x.e.estimate.minutes)||0),0)
   : page.total;
  const parts=page.parts||1;
  const cont=parts>1?`（${page.part||1}枚目 / 全${parts}枚）`:'';
  return `<section class="sp-page">
   <header class="sp-head">
    <div class="sp-head-main">
     <span class="sp-title">作業予定表</span>
     <span class="sp-equip">${esc(page.equipment||'')}</span>
    </div>
    <div class="sp-head-sub">
     <span class="sp-day">${esc(page.day)}${esc(cont)}</span>
     <span class="sp-count">${count}件 / 見積計 ${esc(minutesText(total))}</span>
    </div>
   </header>
   <table class="sp-table"><thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table>
   <footer class="sp-foot">
    <span>出力 ${esc(stamp())}</span>
    <span class="sp-foot-note">「~」の付いた見積は実績がまだ無いための暫定値です</span>
    <span>${pageNo} / ${pageCount}</span>
   </footer>
  </section>`;
 }

 function ensureArea(){
  let el=document.getElementById(AREA_ID);
  if(el)return el;
  el=document.createElement('div');el.id=AREA_ID;el.className='sp-print-area';
  document.body.appendChild(el);
  return el;
 }

 /* ---------- 印刷する ----------
    **描き終えてからダイアログを開く**(同期的にwindow.print()を呼ぶと
    まだ差し込んだDOMが反映されておらず白紙になる。既存の帳票と同じ)。 */
 function printPages(pages,opt,title){
  const area=ensureArea();
  area.innerHTML=pages.map((p,i)=>pageHtml(p,opt,i+1,pages.length)).join('');
  document.body.classList.add(PRINT_CLASS);
  const prevTitle=document.title;
  document.title=title;
  const cleanup=()=>{
   document.body.classList.remove(PRINT_CLASS);
   document.title=prevTitle;area.innerHTML='';
   window.removeEventListener('afterprint',cleanup);
  };
  window.addEventListener('afterprint',cleanup);
  requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));
 }

 /* ---------- 設定 ----------
    既定は「現場へ配る」ときの形。**毎回選び直させない**ので、選んだ内容は
    この端末に覚える(紙の運用は現場ごとに決まっていて、毎回は変わらない)。 */
 const PREF_KEY='SchedulePrintPrefV1';
 const DEFAULTS={includeDone:false,actualColumns:true,pageByDate:true,allEquipment:false};
 function loadPref(){
  try{return {...DEFAULTS,...(JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{})}}
  catch(_){return {...DEFAULTS}}
 }
 function savePref(p){
  try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(_){}
 }

 function optionsHtml(pref,canAll){
  const cb=(k,label,note)=>`<label class="sp-opt"><input type="checkbox" data-opt="${k}"${pref[k]?' checked':''}>
   <span><b>${esc(label)}</b>${note?`<small>${esc(note)}</small>`:''}</span></label>`;
  return `<div class="sp-options">
   ${canAll?cb('allEquipment','すべての設備を続けて印刷する','設備ごとにページを分けます。1台ぶんだけでよければ外してください'):''}
   ${cb('actualColumns','実績を書き込む欄をつける','開始・終了・確認の記入欄を右側に作ります')}
   ${cb('pageByDate','日付ごとにページを分ける','日ごとに配る場合はこのまま')}
   ${cb('includeDone','完了・取消も載せる','ふだんは載せません（これから流すものだけ配るため）')}
  </div>`;
 }

 async function open(){
  const view=WL.scheduleView;
  if(!view||typeof view.entries!=='function'){
   showToast&&showToast('印刷できません','作業スケジュールを開いてからお試しください',4000);return;
  }
  const canAll=typeof view.equipmentNames==='function'&&view.equipmentNames().length>1;
  const pref=loadPref();
  if(!canAll)pref.allEquipment=false;
  const ok=await confirmModal({
   eyebrow:'PRINT',title:'作業予定表を印刷',
   bodyHtml:`<p class="confirm-modal-message">いま表示している条件（表示範囲・内容の項目）のまま、現場へ配る形で印刷します。</p>`
            +optionsHtml(pref,canAll),
   confirmLabel:'印刷する',cancelLabel:'やめる',
  });
  /* **チェックは閉じた後に読む。** confirmModalは閉じるとき`hidden`にする
     だけで中身は消さない(次に開いたときに差し替わる)ので、awaitのあとでも
     そのまま読める。押した瞬間の値を控える仕掛けを別に持つより短い。 */
  const box=document.getElementById('appConfirmBody');
  if(box)box.querySelectorAll('[data-opt]').forEach(el=>{pref[el.dataset.opt]=!!el.checked});
  if(!canAll)pref.allEquipment=false;
  savePref(pref);
  if(!ok)return;
  await run(pref);
 }

 async function run(pref){
  const view=WL.scheduleView;
  const opt={...pref};
  let pages=[];
  if(opt.allEquipment&&typeof view.fetchEntries==='function'){
   const names=view.equipmentNames();
   showToast&&showToast('印刷の準備をしています',`${names.length}台ぶんの予定を集めています…`,3000);
   for(const name of names){
    let entries=[];
    try{entries=await view.fetchEntries(name)}
    catch(e){
     showToast&&showToast('一部の設備を読めませんでした',`${name}: ${e.message}`,5000);
     continue;
    }
    pages=pages.concat(buildPages(name,entries,opt));
   }
  }else{
   pages=buildPages(view.equipment(),view.entries(),opt);
  }
  if(!pages.length||pages.every(p=>!p.rows.length)){
   showToast&&showToast('印刷するものがありません',
    opt.includeDone?'この設備に予定がありません':'これから流す予定がありません（「完了・取消も載せる」で過去分も出せます）',5000);
   return;
  }
  const sheets=splitToSheets(pages,opt);
  printPages(sheets,opt,`作業予定表_${sheets[0].equipment||''}`);
 }

 window.WL=window.WL||{};
 WL.schedulePrint={open,buildPages,splitToSheets,pageHtml};
})();
