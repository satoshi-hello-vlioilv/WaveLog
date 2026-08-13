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
  /* 紙の列は**1つの紙の中で変えない**ので、まとめて1回だけ決める。 */
  const cols=paperColumns(equipment,opt);
  return groups.map(g=>({
   cols,
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

 /* ---------- 紙の列(§9.118) ----------
    **画面のレイアウトと紙のレイアウトは別物**にできる。画面は横に広く
    15列以上あり、紙は194mmしかない。同じ設定を使い回すと、どちらかが
    必ず犠牲になる（画面を紙に合わせて削るか、紙を溢れさせるか）。

    仕組みは一覧・タイムラインと同じ**列レイアウトマスタ**に乗せる
    （対象は`print:<設備>`）。紙のためだけの保存先を新しく作らない。

    **キーは保存名なので変えないこと**——変えると、その端末に保存済みの
    紙のレイアウトが黙って既定へ戻る。 */
 const PAPER_FIXED=[
  {key:'no',      label:'#',         mm:7,  cls:'sp-c-no'},
  {key:'state',   label:'区分',      mm:13, cls:'sp-c-state'},
  {key:'date',    label:'日付',      mm:20, cls:'sp-c-date'},
  {key:'time',    label:'予定時刻',  mm:25, cls:'sp-c-time'},
  {key:'shift',   label:'勤務',      mm:11, cls:'sp-c-shift'},
  {key:'lotNo',   label:'ロット番号',mm:26, cls:'sp-c-lot'},
  {key:'content', label:'内容',      mm:0,  cls:'sp-c-content'},   // 0=残りいっぱい
  {key:'estimate',label:'見積',      mm:13, cls:'sp-c-est'},
 ];
 /* 記入欄。**空のまま罫線だけ**にする(薄い下線を入れると書きにくい)。 */
 const PAPER_WRITE=[
  {key:'write:start',label:'実績 開始',mm:20,cls:'sp-c-write',write:true},
  {key:'write:end',  label:'実績 終了',mm:20,cls:'sp-c-write',write:true},
  {key:'write:check',label:'確認',    mm:10,cls:'sp-c-check',write:true},
  {key:'write:note', label:'備考',    mm:30,cls:'sp-c-write',write:true},
 ];
 /* 何も設定していないときの紙。**今までの紙と同じ並び**にしておく
    （設定を触っていない現場の紙が、更新で勝手に変わらないように）。 */
 const DEFAULT_ORDER=['no','state','time','shift','lotNo','content','estimate',
                      'write:start','write:end','write:check'];
 const CONTENT_PREFIX='content:';
 const PAPER_USABLE_MM=210-8*2;        // 用紙210mm - 左右の余白8mmずつ

 const printTarget=eq=>eq?`print:${eq}`:'';
 /* 紙に置ける列の一覧。内容の項目(§9.88 段6)は画面のタイムラインが
    出しているものをそのまま候補にする。 */
 function paperCatalog(){
  /* 出どころを持たせる(§9.105と同じ考え方)。**同じ名前の候補が並ぶ**
     ——予定そのものの「ロット番号」と、内容欄の項目としての「ロット番号」は
     別物なのに名前が同じ。分類を文字で添えないと、どちらを選んだのか
     選んだ本人にも分からない（色だけで伝えないのも同じ理由）。 */
  const out=[...PAPER_FIXED.map(c=>({...c,kind:'plan'})),
             ...PAPER_WRITE.map(c=>({...c,kind:'write'}))];
  const keys=(typeof WL.scheduleView?.contentKeys==='function')?WL.scheduleView.contentKeys():[];
  keys.forEach(k=>out.push({
   key:CONTENT_PREFIX+k, contentKey:k, mm:22, cls:'sp-c-item', kind:'content',
   label:(typeof WL.scheduleView?.contentLabelOf==='function')?WL.scheduleView.contentLabelOf(k):k,
  }));
  return out;
 }
 /* 分類の呼び名。紙の見出しには出さない（紙に「内容: 材質」は冗長）ので、
    レイアウトを組む画面でだけ使う。 */
 const KIND_LABEL={plan:'予定',content:'内容',write:'記入欄'};
 /* いま刷る列。**設定があるときは、そこに載っている列だけ**を出す
    ——一覧は「記録に無い列は末尾へ回す」が、紙は幅が有限なので同じ作りに
    すると、内容の項目を1つ足しただけで紙が溢れて配れなくなる。
    増えた項目はレイアウトの編集画面に「未選択」として出る。 */
 function paperColumns(equipment,opt){
  const target=printTarget(equipment);
  const catalog=paperCatalog();
  const byKey=new Map(catalog.map(c=>[c.key,c]));
  const layout=target?WL.columnLayout.get(target):null;
  const saved=(layout&&layout.order||[]).filter(k=>byKey.has(k));
  const hidden=new Set((layout&&layout.hidden)||[]);
  let keys=saved.length?saved.filter(k=>!hidden.has(k))
                       :DEFAULT_ORDER.filter(k=>byKey.has(k));
  /* 「実績を書き込む欄をつける」は**後から効く絞り込み**にしておく
     ——レイアウトを作った人にも「今回は記入欄なしで」が効いてほしい。 */
  if(!opt.actualColumns)keys=keys.filter(k=>!k.startsWith('write:'));
  return keys.map(k=>{
   const c=byKey.get(k);
   const mm=layout&&layout.widths&&layout.widths[k]!=null?Number(layout.widths[k]):c.mm;
   const name=layout&&layout.names&&layout.names[k]?layout.names[k]:c.label;
   return {...c,mm:Number.isFinite(mm)&&mm>0?mm:(c.mm||0),label:name};
  });
 }

 function valueOf(col,item,no,contentMap){
  const e=item.e;
  switch(col.key){
   case 'no':return String(no);
   case 'state':return STATE_LABEL[e.state]||e.state||'';
   case 'date':{
    const k=dayKey(item.start);
    if(!k)return '';
    const d=new Date(k+'T00:00:00');
    return `${d.getMonth()+1}/${d.getDate()}（${WD[d.getDay()]}）`;
   }
   case 'time':
    return item.start?(e.ongoing?`${hm(item.start)}〜継続中`:`${hm(item.start)}〜${hm(item.end)}`):'未定';
   case 'shift':return e.shift||'';
   case 'lotNo':return e.lotNo||'';
   case 'content':
    return (typeof WL.scheduleView?.contentTextOf==='function')
     ? WL.scheduleView.contentTextOf(e) : (e.title||'');
   case 'estimate':{
    /* 見積が実績由来でないときは印を添える(§9.114)。紙でも「この時間は
       どのくらい当てになるのか」が分かるようにしておく。 */
    const src=(e.estimate&&e.estimate.source)||'';
    const mark=(src==='equipment-standard'||src==='default')?'~':'';
    return e.estimate?mark+minutesText(e.estimate.minutes):'';
   }
   default:
    if(col.write)return '';
    if(col.contentKey)return contentMap?(contentMap.get(col.contentKey)||''):'';
    return '';
  }
 }

 function cellsOf(item,no,cols){
  /* 内容の項目は1行ぶんまとめて引く(項目ごとに呼ぶと行×項目の回数だけ
     組み立て直すことになる)。 */
  let map=null;
  if(cols.some(c=>c.contentKey)&&typeof WL.scheduleView?.contentCellsOf==='function'){
   map=new Map((WL.scheduleView.contentCellsOf(item.e)||[]).map(c=>[c.key,c.text]));
  }
  return cols.map(c=>`<td class="${c.cls}">${esc(valueOf(c,item,no,map))}</td>`).join('');
 }

 function pageHtml(page,opt,pageNo,pageCount){
  const cols=page.cols||paperColumns(page.equipment,opt);
  /* 幅は**colgroupで与える**（CSSのクラスに書くと利用者が変えられない）。
     幅0の列は残りいっぱい＝width指定なし。 */
  const group=`<colgroup>${cols.map(c=>
    c.mm>0?`<col style="width:${c.mm}mm">`:'<col>').join('')}</colgroup>`;
  const head=cols.map(c=>`<th class="${c.cls}">${esc(c.label)}</th>`);
  /* **通し番号はその日の頭から数える。** 紙が2枚に分かれても#1へ戻さない
     （現場は番号で呼び合うので、同じ日に#1が2つあると指せなくなる）。 */
  const from=page.startNo||1;
  const body=page.rows.map((item,i)=>
   `<tr class="${item.e.kind!=='作業'?'sp-row-stop':''}">${cellsOf(item,from+i,cols)}</tr>`).join('')
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
   <table class="sp-table">${group}<thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table>
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
  </div>
  <button type="button" class="sp-layout-open" id="spLayoutOpen">紙のレイアウトを変える…</button>
  <p class="sp-layout-note" id="spLayoutNote"></p>`;
 }
 /* いまの紙が既定のままか、自分で組んだものか。**どちらなのかを言う**
    ——設定したのに効いていないのか、そもそも設定していないのかが
    分からないと、直しようがない。 */
 function layoutNoteText(equipment){
  const t=printTarget(equipment);
  const n=t?((WL.columnLayout.get(t).order||[]).length):0;
  return n?`いまは この設備用に組んだレイアウト（${n}列）で刷ります。`
          :'いまは 既定のレイアウト（区分・時刻・勤務・ロット番号・内容・見積）で刷ります。';
 }

 async function open(){
  const view=WL.scheduleView;
  if(!view||typeof view.entries!=='function'){
   showToast&&showToast('印刷できません','作業スケジュールを開いてからお試しください',4000);return;
  }
  const equipment=view.equipment();
  /* 紙のレイアウトはマスタにあるので、開く前に読む(キャッシュ済みなら即返る)。 */
  try{await WL.columnLayout.load(printTarget(equipment))}catch(_){}
  const canAll=typeof view.equipmentNames==='function'&&view.equipmentNames().length>1;
  const pref=loadPref();
  if(!canAll)pref.allEquipment=false;
  /* **awaitの前に配線する。** confirmModalは呼んだ時点で本文を差し込んで
     からPromiseを返すので、ここで中のボタンを掴める。awaitのあとでは
     もう閉じている。 */
  const asked=confirmModal({
   eyebrow:'PRINT',title:'作業予定表を印刷',
   bodyHtml:`<p class="confirm-modal-message">いま表示している条件（表示範囲・内容の項目）のまま、現場へ配る形で印刷します。</p>`
            +optionsHtml(pref,canAll),
   confirmLabel:'印刷する',cancelLabel:'やめる',
  });
  const note=document.getElementById('spLayoutNote');
  if(note)note.textContent=layoutNoteText(equipment);
  const layoutBtn=document.getElementById('spLayoutOpen');
  if(layoutBtn)layoutBtn.onclick=()=>{
   /* 確認を閉じてから開く（浮きウィンドウが確認の裏に出ないように）。 */
   document.getElementById('appConfirmCancel')?.click();
   openLayoutPanel(equipment);
  };
  const ok=await asked;
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
    /* **紙のレイアウトは設備ごと**なので、設備ごとに読む(§9.118)。
       1台ぶんで読んだものを使い回すと、他の設備の紙が別の設備の
       レイアウトで刷られる。 */
    try{await WL.columnLayout.load(printTarget(name))}catch(_){}
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

 /* ---------- 紙のレイアウトを組む(§9.118) ----------
    **画面とは別に**、紙に出す列・並び・幅(mm)・見出しを決める。

    ここで一番大事なのは**幅の合計を見せる**こと。紙幅は194mmしかなく、
    超えると列が潰れて読めない紙が刷り上がる。刷ってから気づくのでは
    紙も時間も無駄になるので、組んでいる最中に「あと何mm」を出す。 */
 const PANEL_ID='schedulePrintLayoutPanel';
 let lp={equipment:'',rows:[]};      // rows=[{key,label,name,mm,on}]

 function layoutRowsOf(equipment){
  const target=printTarget(equipment);
  const catalog=paperCatalog();
  const layout=WL.columnLayout.get(target);
  const order=(layout.order||[]).filter(k=>catalog.some(c=>c.key===k));
  const hidden=new Set(layout.hidden||[]);
  const use=order.length?order:DEFAULT_ORDER.filter(k=>catalog.some(c=>c.key===k));
  const rank=new Map(use.map((k,i)=>[k,i]));
  /* 選んでいる列を先に、残りを後ろに並べる。**候補は全部出す**
     ——出していない列が画面のどこにも無いと、足せることに気づけない。 */
  return catalog.slice()
   .sort((a,b)=>(rank.has(a.key)?rank.get(a.key):9e9)-(rank.has(b.key)?rank.get(b.key):9e9))
   .map(c=>({
    key:c.key,label:c.label,kind:c.kind||'plan',
    name:(layout.names&&layout.names[c.key])||'',
    mm:layout.widths&&layout.widths[c.key]!=null?Number(layout.widths[c.key]):(c.mm||0),
    on:rank.has(c.key)&&!hidden.has(c.key),
   }));
 }
 function ensureLayoutPanel(){
  let el=document.getElementById(PANEL_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sc-float-win';el.id=PANEL_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sc-float-header"><div><h2 id="splTitle">紙のレイアウト</h2>
     <small class="spl-sub" id="splSub"></small></div>
    <button type="button" id="splClose" title="閉じる">×</button></div>
   <div class="sc-float-body spl-body">
    <p class="spl-lead">A4の紙に出す列を選び、上から順に並べます。
     <b>画面のタイムラインとは別</b>の設定です。</p>
    <div class="spl-gauge" id="splGauge"></div>
    <div class="spl-rows" id="splRows"></div>
   </div>
   <div class="sc-float-foot">
    <button type="button" id="splReset" class="spl-reset">既定に戻す</button>
    <div class="sc-content-foot-actions">
     <button type="button" id="splCancel">やめる</button>
     <button type="button" id="splSave" class="sc-column-save">保存</button>
    </div>
   </div>
   <div class="sc-float-resize" title="ドラッグで大きさを変えられます"></div>`;
  document.body.appendChild(el);
  el.querySelector('#splClose').onclick=closeLayoutPanel;
  el.querySelector('#splCancel').onclick=closeLayoutPanel;
  el.querySelector('#splSave').onclick=saveLayout;
  el.querySelector('#splReset').onclick=resetLayout;
  if(typeof WL.makeFloatingWindow==='function')
   WL.makeFloatingWindow(el,{storageKey:'schedulePrintLayoutRectV1',defaultWidth:760,defaultHeight:620,
                             defaultTop:80,minWidth:520,minHeight:360});
  else console.error('紙のレイアウト: WL.makeFloatingWindow が見つかりません');
  return el;
 }
 /* 幅の合計。**「残り」を出す**のが要点で、合計だけでは足りるのか
    分からない。内容欄(幅0=残りいっぱい)は合計に数えない。 */
 function renderGauge(){
  const box=document.getElementById('splGauge');if(!box)return;
  const on=lp.rows.filter(r=>r.on);
  const fixed=on.filter(r=>r.mm>0).reduce((s,r)=>s+r.mm,0);
  const auto=on.filter(r=>r.mm<=0).length;
  const left=Math.round((PAPER_USABLE_MM-fixed)*10)/10;
  const over=left<0;
  const note=over?`${Math.abs(left)}mm はみ出しています。幅を減らすか、列を外してください。`
   :auto?`残り ${left}mm を 幅を決めていない ${auto}列 で分け合います。`
        :`残り ${left}mm は余白になります。`;
  box.className='spl-gauge'+(over?' is-over':'');
  box.innerHTML=`<b>${on.length}列 / 幅の合計 ${Math.round(fixed*10)/10}mm</b>
   <span>（A4で使えるのは ${PAPER_USABLE_MM}mm）</span><small>${esc(note)}</small>`;
 }
 function layoutRowHtml(r,i){
  return `<div class="spl-row${r.on?'':' is-off'}" data-row="${i}">
   <label class="spl-on"><input type="checkbox" data-on="${i}"${r.on?' checked':''}></label>
   <span class="spl-kind spl-kind-${esc(r.kind||'plan')}">${esc(KIND_LABEL[r.kind]||'予定')}</span>
   <span class="spl-name" title="${esc(r.key)}">${esc(r.label)}</span>
   <input type="text" class="spl-alias" data-alias="${i}" value="${esc(r.name)}"
    placeholder="${esc(r.label)}" autocomplete="off" title="紙に出す見出し（空欄なら左の名前）">
   <span class="spl-mm"><input type="number" class="spl-w" data-w="${i}" min="0" max="194" step="1"
    value="${r.mm>0?r.mm:''}" placeholder="残り" title="幅(mm)。空欄なら残りいっぱい"> mm</span>
   <button type="button" class="spl-up" data-up="${i}" title="1つ上へ"${i===0?' disabled':''}>▲</button>
   <button type="button" class="spl-down" data-down="${i}" title="1つ下へ"${i===lp.rows.length-1?' disabled':''}>▼</button>
  </div>`;
 }
 function renderLayout(){
  const box=document.getElementById('splRows');if(!box)return;
  box.innerHTML=lp.rows.map(layoutRowHtml).join('');
  box.querySelectorAll('[data-on]').forEach(el=>el.onclick=e=>{
   /* **clickで受ける**（changeはclickの後に飛ぶ。§9.90と同じ理由）。 */
   lp.rows[Number(e.currentTarget.dataset.on)].on=e.currentTarget.checked;
   e.currentTarget.closest('.spl-row').classList.toggle('is-off',!e.currentTarget.checked);
   renderGauge();
  });
  box.querySelectorAll('[data-alias]').forEach(el=>el.oninput=e=>{
   /* 入力中に組み直さない（カーソルが飛ぶ。§9.117と同じ）。 */
   lp.rows[Number(e.currentTarget.dataset.alias)].name=e.currentTarget.value;
  });
  box.querySelectorAll('[data-w]').forEach(el=>el.oninput=e=>{
   const v=Number(e.currentTarget.value);
   lp.rows[Number(e.currentTarget.dataset.w)].mm=Number.isFinite(v)&&v>0?v:0;
   renderGauge();
  });
  box.querySelectorAll('[data-up]').forEach(el=>el.onclick=e=>moveLayout(Number(e.currentTarget.dataset.up),-1));
  box.querySelectorAll('[data-down]').forEach(el=>el.onclick=e=>moveLayout(Number(e.currentTarget.dataset.down),1));
  renderGauge();
 }
 function moveLayout(i,d){
  const to=i+d;
  if(to<0||to>=lp.rows.length)return;
  const [row]=lp.rows.splice(i,1);
  lp.rows.splice(to,0,row);
  renderLayout();
 }
 function openLayoutPanel(equipment){
  const eq=String(equipment||'').trim();
  if(!eq){showToast&&showToast('設備を選んでから開いてください','',3200);return}
  lp={equipment:eq,rows:layoutRowsOf(eq)};
  ensureLayoutPanel();
  document.getElementById('splTitle').textContent=`紙のレイアウト（${eq}）`;
  document.getElementById('splSub').textContent='作業予定表の印刷にだけ効きます';
  renderLayout();
  document.getElementById(PANEL_ID).hidden=false;
 }
 function closeLayoutPanel(){
  const el=document.getElementById(PANEL_ID);if(el)el.hidden=true;
 }
 /* 既定へ戻す＝保存を消す。**その場で消さず、保存を押すまで待つ**
    （やめるで元へ戻せるように）。 */
 function resetLayout(){
  const catalog=paperCatalog();
  const rank=new Map(DEFAULT_ORDER.map((k,i)=>[k,i]));
  lp.rows=catalog.slice()
   .sort((a,b)=>(rank.has(a.key)?rank.get(a.key):9e9)-(rank.has(b.key)?rank.get(b.key):9e9))
   .map(c=>({key:c.key,label:c.label,kind:c.kind||'plan',name:'',mm:c.mm||0,on:rank.has(c.key)}));
  renderLayout();
 }
 async function saveLayout(){
  const target=printTarget(lp.equipment);
  if(!target)return;
  const on=lp.rows.filter(r=>r.on);
  if(!on.length){showToast&&showToast('列が1つも選ばれていません','紙に何も出せません',3600);return}
  const widths={},names={};
  lp.rows.forEach(r=>{
   if(r.mm>0)widths[r.key]=r.mm;
   const t=String(r.name||'').trim();
   if(t&&t!==r.label)names[r.key]=t;
  });
  /* **保存は全置換なので、渡す設定を1つも書き漏らさない**(§9.113)。
     紙では使わない書式・読み替え・計算式も、既にあるものはそのまま返す。 */
  const cur=WL.columnLayout.get(target);
  try{
   await WL.columnLayout.save(target,{
    order:lp.rows.map(r=>r.key),
    hidden:lp.rows.filter(r=>!r.on).map(r=>r.key),
    widths,names,
    formats:cur.formats,rules:cur.rules,formulas:cur.formulas,locks:cur.locks,
   });
   showToast&&showToast('紙のレイアウトを保存しました',`${on.length}列（${lp.equipment}）`,2800);
   closeLayoutPanel();
  }catch(e){showToast&&showToast('保存に失敗しました',e.message,5000)}
 }

 window.WL=window.WL||{};
 WL.schedulePrint={open,buildPages,splitToSheets,pageHtml,
                   paperCatalog,paperColumns,openLayoutPanel};
})();
