/* opsheet-print.js: 操業データ表（§9.241 ②、利用者の指示）
   ============================================================
   「帳票と同じような仕組みで、もう1枚別の帳票である、各設備別で操業データ表を
    作成したいです。日ごとまたは日＋直毎に1枚の紙に入力した操業データが配置
    されて基本情報も入っていてロットが特定できるもの、1行で収まるものは通常の
    1行構成でリスト作成ですが、データ数が多い場合は1行では紙に収まらないので、
    2行1データ構成でもできるように準備してください。レイアウトはA4横＆直単位
    （日＋直）をデフォルトとして、データがリスト形式でまとめられた操業データが
    一覧できるものを作成してください。データ数が多いので、高密度で配置する
    必要があります。中身のデータやレイアウトは後から調整できるようにして
    ください。」

   **測定帳票（`report-dashboard.js`）とは紙の性格が違う。** あちらは1ロット
   1枚の「塊の配置」で、こちらは**多数のロットを1枚へ詰める一覧**なので、
   作業予定表の紙（`schedule-print.js`）と同じ骨格に乗せる:
    ・**枚数は実測で切る**（`splitToSheets`）。定数で決め打ちにすると最後の
      数件がこぼれ、脚の「1 / 4」が嘘になる（§9.115）。
    ・**用紙サイズ・向きは`data-paper`＋刷る直前の`@page`**（§9.235 ②）。
    ・**列幅は画面の設定をmmへ配る**。収まるならそのまま、溢れたときだけ
      比例で縮める（§9.236 ③「引き伸ばさない」）。
    ・**プレビューを先に出す**（§9.186）。組み立ては1本だけを通し、
      プレビュー専用の組み立てを作らない（見たものと刷るものが違ったら
      意味が無い）。

   **どの列を出すかは列レイアウトマスタ`opsheet:<設備>`**（§9.165・§9.174）。
   新しいマスタを作らない——並び・幅・表示名・書式・読み替え・計算式が
   そのまま効く。**2行構成のときにどちらの段へ置くか**も同じ`formats`の
   `pattern`へ`段:2`の印で入れる（§9.205。文字列を直に入れない）。
   ============================================================ */
(function(){
 'use strict';
 window.WL=window.WL||{};
 const $id=id=>document.getElementById(id);
 const AREA_ID='opSheetPrintArea';
 const PRINT_CLASS='os-print';
 const PAGE_STYLE_ID='osPrintPageSizeStyle';
 const PREF_KEY='OpSheetPrintPrefV1';
 const TARGET_PREFIX='opsheet:';

 /* 用紙は作業予定表と**同じ形**（§9.252、利用者の指示「実績データ表も同じ形に
    揃えてください」）——大きさ（A4/B4/A3）と向き（縦/横）を**別々に決める**。
    掛け合わせて並べると用紙を1つ足すたびに札が2枚増える（B4を足すと8枚）。
    **既定はA4横**（利用者の指示）——列が多い表なので、縦だと1行に収まらない。
    余白は四辺8mm。B4は**JIS B4(257×364mm)**。 */
 /* ---------- 用紙（§9.332で共通核へ集約） ----------
    表も`@page`の作り方も`WL.paper`の1箇所（`print-core.js`）。ここが持つのは
    **この紙の既定**（A4横＝並びの先頭。利用者の指示。列が多い表なので縦だと
    1行に収まらない）と、**この画面の`<style>`のid**だけ。 */
 const PAPER_KINDS=WL.paper.KINDS;
 const PAPER_ORIENTS=WL.paper.orients({orientFirst:'landscape'});
 const PAPER_SIZES=WL.paper.sizes({orientFirst:'landscape'});
 const PAPER_MARGIN_MM=WL.paper.MARGIN_MM;
 const MM_PER_PX=WL.paper.MM_PER_PX;
 const MIN_COL_MM=6;
 const FRAME_MM=0.5;
 const MIN_FIT=.62;
 const SHEET_SLACK_PX=6;

 function paperSizeOf(key){return WL.paper.sizeOf(key,PAPER_SIZES)}
 function paperUsableMm(key){return WL.paper.usableMm(key,PAPER_SIZES)}
 function paperKeyWith(cur,part){return WL.paper.keyWith(cur,part,PAPER_SIZES)}
 function pageRuleFor(paperKey){return WL.paper.pageRule(paperKey,PAPER_SIZES)}

 /* ---------- 設定（この端末に覚える） ----------
    既定は利用者の指示どおり **A4横 ＋ 直単位（日＋直）**。行の構成は
    `auto`＝入るなら1行・入らなければ2行（「1行で収まるものは1行構成」）。 */
 const DEFAULTS={paper:'a4-landscape',unit:'shift',rows:'auto',borders:true,dense:true};
 let pref=Object.assign({},DEFAULTS);
 try{Object.assign(pref,JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{})}catch(e){WL.quiet.note('端末の覚えが読めない（既定で続ける）',e)}
 function savePref(){try{localStorage.setItem(PREF_KEY,JSON.stringify(pref))}catch(e){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',e)}}

 /* いま組み立てている紙の設備。**成り代わり中は必ずこちらが勝つ**
    （§9.235 ⑤／§9.174の`rpActiveTarget`と同じ罠）——設備をまたいで
    続けて刷るときに「いま選んでいる設備」を見に行くと、途中から別の
    設備の設定で描かれる。 */
 let activeEquipment='';
 function targetOf(eq){return TARGET_PREFIX+(String(eq||'').trim()||'共通')}
 function target(){return targetOf(activeEquipment)}

 /* ---------- 列 ----------
    候補は「基本情報」「仕掛（ロットの情報）」「操業データ」の3群。
    **呼び名の語彙はサーバー**（`lotFields`／操業データ項目マスタ）が持つ
    ので、ここに日本語の対応表を書かない（§9.163）。 */
 const BASE_COLUMNS=[
  {k:'#',virtual:true,def:1,w:26,num:true,get:(x,i)=>i+1},
  {k:'ロット番号',def:1,w:120,get:x=>x.lotNo||''},
  {k:'検査番号',def:1,w:96,get:x=>x.inspectionNo||''},
  {k:'鋳造番号',w:96,get:x=>x.castingNo||''},
  {k:'状態',w:60,get:x=>x.status||''},
  {k:'直',w:52,get:x=>x.shift||''},
  {k:'現場日',w:84,get:x=>x.workDate||''},
  {k:'作業開始',def:1,w:64,num:true,get:x=>hm(x.workStart)},
  {k:'作業終了',def:1,w:64,num:true,get:x=>hm(x.workEnd)},
  {k:'実働(分)',def:1,w:52,num:true,get:x=>(x.durationMin==null?'':x.durationMin)},
  {k:'更新者',w:76,get:x=>x.updatedBy||''},
 ];
 /* 紙は時刻だけで足りる（日付は紙の頭に出ている）。 */
 function hm(iso){
  if(!iso)return '';
  const d=new Date(iso);
  if(Number.isNaN(d.getTime()))return String(iso);
  const p=n=>String(n).padStart(2,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
 }
 let lotFields=[],opKeys=[];
 function lotColumns(){
  return (lotFields||[]).map(f=>({k:f.label+(f.unit?`(${f.unit})`:''),w:82,origin:'lot',
    num:!!f.unit,get:x=>((x.basic||{})[f.key]??'')}));
 }
 /* **操業データは既定で全部出す**（この紙の主役なので）。基本情報は
    「ロットが特定できる」ぶんだけを既定にする（利用者の指示）。 */
 function opColumns(){
  return (opKeys||[]).map(n=>({k:n,w:82,origin:'op',def:1,
    get:x=>((x.opData||{})[n]??'')}));
 }
 function allColumns(){return BASE_COLUMNS.concat(lotColumns(),opColumns())}
 function columnOf(k){return allColumns().find(c=>c.k===k)||null}
 function allColumnKeys(){
  const seen=new Set(),out=[];
  allColumns().forEach(c=>{if(!seen.has(c.k)){seen.add(c.k);out.push(c.k)}});
  const l=WL.columnLayout.get(target())||{};
  (l.order||[]).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  Object.keys(l.formulas||{}).forEach(k=>{if(!seen.has(k)){seen.add(k);out.push(k)}});
  return out;
 }
 /* **一度も保存していないうちは既定だけ**（§9.162／§9.173の罠）。列レイアウト
    マスタのhiddenは空なので、そのまま使うと候補が全部チェック済みになり、
    保存した瞬間に選んだ覚えの無い列が紙へ出る。 */
 function initialHidden(keys,layout){
  const l=layout||WL.columnLayout.get(target())||{};
  if((l.order||[]).length)return null;
  const def=new Set(allColumns().filter(c=>c.def).map(c=>c.k));
  return (keys||allColumnKeys()).filter(k=>!def.has(k));
 }
 function visibleColumnKeys(){
  const keys=allColumnKeys(),seed=initialHidden(keys);
  if(seed){const off=new Set(seed);return keys.filter(k=>!off.has(k))}
  return keys.filter(k=>WL.columnLayout.shows(target(),k));
 }
 function labelOf(k){return WL.columnLayout.label(target(),k)||k}
 function widthPxOf(k){
  const w=WL.columnLayout.width(target(),k);
  if(w)return w;
  const c=columnOf(k);
  return (c&&c.w)||82;
 }
 /* この列をどちらの段へ置くか。**印は`formats`の`pattern`へ**（§9.205。
    `formats[k]`へ文字列を直に入れるとサーバーが辞書以外をNoneへ落とし、
    画面では効くのに保存だけが黙って消える）。 */
 function lineOf(k){
  const f=WL.columnLayout.format(target(),k);
  const m=/(?:^|\|)段:(\d)/.exec((f&&f.pattern)||'');
  const n=m?Number(m[1]):0;
  return (n===1||n===2)?n:0;      /* 0＝自動（幅で決める） */
 }

 /* ---------- 値 ---------- */
 function rowView(x,i){
  const row={};
  allColumns().forEach(c=>{
   try{row[c.k]=c.get?c.get(x,i):''}catch(e){row[c.k]=''}
  });
  return row;
 }
 /* **整形に失敗したら生の値を出す**のが原則（空欄にしない）。読み替え→書式→
    生の値の順は`WL.cellFormat`が持つので、ここで組み立て直さない。 */
 function cellText(k,raw,row){
  try{
   /* 表示の値で見る読み替え（§9.474）にも効くよう、列の見え方を渡す（§9.479）。 */
   const r=WL.cellFormat.cell({raw,format:WL.columnLayout.format(target(),k),
     rule:WL.columnLayout.rule(target(),k),row,column:k,view:WL.cellFormat.viewOf(target())});
   return (r&&r.text)!=null?String(r.text):(raw==null?'':String(raw));
  }catch(e){return raw==null?'':String(raw)}
 }

 /* ---------- 紙の単位（日 / 日＋直） ----------
    **紙の切り方は画面の基準に従う**（§9.198／§9.195）——画面が現場歴で
    数えているのに紙が暦だと、日ごとに配る紙で件数が合わなくなる。 */
 function bucketOf(x,opt){
  const day=(opt.basis==='cal'?x.calDate:x.workDate)||'（日付なし）';
  return opt.unit==='shift'?{key:day+' '+(x.shift||''),day,shift:x.shift||''}
                           :{key:day,day,shift:''};
 }
 function buildPages(items,opt){
  const map=new Map();
  (items||[]).forEach(x=>{
   const b=bucketOf(x,opt);
   if(!map.has(b.key))map.set(b.key,{day:b.day,shift:b.shift,rows:[]});
   map.get(b.key).rows.push(x);
  });
  const pages=[...map.values()];
  /* 日付の古い順・同じ日は直の名前順。**並べ替えの根拠は1箇所**
     （画面と紙で並びが違うと、どちらが正か分からない）。 */
  pages.sort((a,b)=>(a.day===b.day?String(a.shift).localeCompare(String(b.shift))
                                  :String(a.day).localeCompare(String(b.day))));
  pages.forEach(p=>p.rows.sort((a,b)=>String(a.refAt||'').localeCompare(String(b.refAt||''))));
  return pages;
 }

 /* ---------- 段の割り付け（1行構成 / 2行1データ構成） ----------
    **`auto`は「入るなら1行」**（利用者の指示「1行で収まるものは通常の1行
    構成」）。入らないときだけ2段に割る。手で決めた段（`段:1`/`段:2`）は
    自動より優先する（後から調整できることが要件）。 */
 function planLines(keys,opt){
  const forced1=keys.filter(k=>lineOf(k)===1),forced2=keys.filter(k=>lineOf(k)===2);
  const free=keys.filter(k=>!lineOf(k));
  const usable=paperUsableMm(opt.paper).w-FRAME_MM;
  const mm=k=>Math.max(MIN_COL_MM,widthPxOf(k)*MM_PER_PX);
  if(opt.rows==='1')return [keys,[]];
  if(opt.rows==='2'||forced2.length){
   const line1=[...forced1],line2=[...forced2];
   let acc=line1.reduce((s,k)=>s+mm(k),0);
   free.forEach(k=>{
    const w=mm(k);
    if(line1.length&&acc+w>usable){line2.push(k);return}
    line1.push(k);acc+=w;
   });
   /* **上段は空にしない**（トラックが作れない）。全部が2段目へ行くような
      指定でも、先頭の1列だけは上段へ残す。 */
   if(!line1.length&&line2.length)line1.push(line2.shift());
   return [line1,line2];
  }
  /* auto: 全部を1段に置いて収まるならそのまま。 */
  const total=keys.reduce((s,k)=>s+mm(k),0);
  if(total<=usable)return [keys,[]];
  const line1=[],line2=[];let acc=0;
  keys.forEach(k=>{
   const w=mm(k);
   if(line1.length&&acc+w>usable){line2.push(k);return}
   line1.push(k);acc+=w;
  });
  return [line1,line2];
 }

 /* ---------- 幅をmmで配る（§9.236 ③「自然体」） ----------
    まず画面の実効px幅を96dpi換算でmmへ直し、**収まるならそのまま**。
    収まらないときだけ合計が予算ちょうどになるよう比例で縮める。
    **下限に着いた列を固定して配り直す**——1回の掛け算だと、床に当たった
    列のぶんだけ合計が膨らんで紙からはみ出す（§9.237）。 */
 /* 下限のある比例配分と丸めは`WL.paper.shareMm()`の1箇所（§9.332）。
    **ここには写しを置かない**——以前はこの1本だけ§9.295の直し（端数は広い列
    から0.1mmずつ散らして引く）が入っておらず、**いちばん広い列から一度に
    引く**古い形のまま残っていた（その列が切れる、と§9.295が名指しで禁じた形）。 */
 function shareMm(natural,budget){
  return WL.paper.shareMm(natural,budget,{min:MIN_COL_MM,step:0.1});
 }
 function withMm(keys,usableMm){
  const natural=keys.map(k=>Math.max(MIN_COL_MM,widthPxOf(k)*MM_PER_PX));
  const budget=usableMm-FRAME_MM;
  const total=natural.reduce((s,v)=>s+v,0);
  if(total<=budget)return {mm:natural.map(v=>Math.round(v*100)/100),fit:1,over:0};
  return {mm:shareMm(natural,budget),fit:Math.max(MIN_FIT,budget/total),over:total-budget};
 }
/* ---------- 2段のトラックを1組に束ねる ----------
    `table-layout:fixed` は **colgroupを1本しか見ない**ので、上段と下段に
    別々の幅を与えることはできない。かといって「下段は上段のトラックへ
    colspanで割り付ける」だけでは、**下段の列数が上段より多いときに置けない**
    （実測: 上段13列に対して下段44列）。

    そこで**両段の切れ目の和集合**をトラックにする。上段の境目と下段の境目を
    どちらも通る目盛りを作れば、どちらの段も自分の幅どおりに`colspan`で
    置ける（トラックは最大 n1+n2-1 本）。**両段の合計は必ずそろえる**
    ——そろえないと表の右端が段ごとにずれる。 */
 const CUT_EPS=0.15;   /* これより近い切れ目は同じものとして扱う（丸めの粒） */
 function mergeTracks(w1,w2){
  const cuts=[0];
  const add=v=>{
   for(let i=0;i<cuts.length;i++)if(Math.abs(cuts[i]-v)<=CUT_EPS)return cuts[i];
   cuts.push(v);return v;
  };
  const walk=list=>{let a=0;return list.map(v=>{a+=v;return add(Math.round(a*100)/100)})};
  const end1=walk(w1),end2=walk(w2);
  cuts.sort((a,b)=>a-b);
  const tracks=[];
  for(let i=1;i<cuts.length;i++)tracks.push(Math.round((cuts[i]-cuts[i-1])*100)/100);
  const spansOf=ends=>{
   const out=[];let at=0;
   ends.forEach(e=>{
    let n=0;
    while(at<tracks.length&&cuts[at+1]<=e+CUT_EPS){at++;n++}
    out.push(Math.max(1,n));
   });
   return out;
  };
  return {tracks,span1:spansOf(end1),span2:spansOf(end2)};
 }
 /* 1枚ぶんのトラックと段ごとの`colspan`。**幅の決め方は`withMm`の1本**
    （§9.236 ③。収まればそのまま、溢れたときだけ縮める）。 */
 function layoutLines(line1,line2,usableMm){
  const w1=withMm(line1,usableMm);
  if(!(line2||[]).length)
   return {tracks:w1.mm,span1:line1.map(()=>1),span2:[],fit:w1.fit,over:w1.over,over2:0};
  const w2=withMm(line2,usableMm);
  const t1=w1.mm.reduce((s,v)=>s+v,0),t2=w2.mm.reduce((s,v)=>s+v,0);
  const total=Math.max(t1,t2);
  /* **狭いほうを広げてそろえる**（縮めない）——右端をそろえるためで、
     列の中身に対しては余るだけなので読みにくくならない。 */
  const s1=t1>0?w1.mm.map(v=>Math.round(v*total/t1*100)/100):w1.mm;
  const s2=t2>0?w2.mm.map(v=>Math.round(v*total/t2*100)/100):w2.mm;
  const m=mergeTracks(s1,s2);
  return {...m,fit:Math.min(w1.fit,w2.fit),over:w1.over,over2:w2.over};
 }

 /* ---------- 紙1枚のHTML ---------- */
 function pageHtml(page,opt,no,total){
  const line1=opt.line1,line2=opt.line2||[];
  const usable=paperUsableMm(opt.paper);
  const L=layoutLines(line1,line2,usable.w);
  const tableMm=L.tracks.reduce((s,v)=>s+v,0);
  const head1=line1.map((k,i)=>`<th colspan="${L.span1[i]||1}">${esc(labelOf(k))}</th>`).join('');
  const head2=line2.length
   ?`<tr class="os-head-2">`+line2.map((k,i)=>`<th colspan="${L.span2[i]||1}">${esc(labelOf(k))}</th>`).join('')+`</tr>`
   :'';
  const cellHtml=(k,view,span)=>{
   /* 値は作り方の式を通す（§9.489・`rawOf()`の1本。以前は計算列のセルが空だった）。 */
   const raw=WL.cellFormat.rawOf(target(),view,k),c=columnOf(k);
   return `<td class="os-c${(c&&c.num)?' os-num':''}" colspan="${span||1}">`
    +esc(cellText(k,raw,view))+`</td>`;
  };
  const body=(page.rows||[]).map((x,i)=>{
   const view=rowView(x,(page.startNo||1)+i-1);
   const r1=`<tr data-row="${i}" class="os-row-1">`
    +line1.map((k,j)=>cellHtml(k,view,L.span1[j])).join('')+`</tr>`;
   if(!line2.length)return r1;
   const r2=`<tr data-row="${i}" class="os-row-2">`
    +line2.map((k,j)=>cellHtml(k,view,L.span2[j])).join('')+`</tr>`;
   return r1+r2;
  }).join('');
  const dayLabel=page.day||'（日付なし）';
  const basisLabel=opt.basis==='cal'?'太陽暦':'現場歴';
  return `<section class="os-page" data-paper="${esc(opt.paper)}"`
   +(opt.borders===false?' data-borders="off"':'')
   +(opt.dense?' data-dense="on"':'')
   +` style="--os-fit:${L.fit}">`
   +`<header class="os-head">`
   +`<b class="os-title">操業データ表</b>`
   +`<span class="os-eq">${esc(opt.equipment||'すべての設備')}</span>`
   +`<span class="os-day">${esc(dayLabel)}<i>${esc(basisLabel)}</i></span>`
   +(opt.unit==='shift'?`<span class="os-shift">${esc(page.shift||'（直なし）')}</span>`:'')
   +`<span class="os-count">${(page.rows||[]).length}件`
   +((page.parts||1)>1?` <i>この${opt.unit==='shift'?'直':'日'}は全${page.total||0}件</i>`:'')
   +`</span></header>`
   +`<div class="os-table-wrap"><table class="os-table" style="width:${tableMm}mm">`
   +`<colgroup>${L.tracks.map(v=>`<col style="width:${v}mm">`).join('')}</colgroup>`
   +`<thead><tr>${head1}</tr>${head2}</thead><tbody>${body}</tbody>`
   +`</table></div>`
   +`<footer class="os-foot">`
   +`<span>${esc(opt.equipment||'すべての設備')} ／ ${esc(dayLabel)}`
   +(opt.unit==='shift'?' ／ '+esc(page.shift||'（直なし）'):'')+`</span>`
   +`<span>${no} / ${total}</span></footer></section>`;
 }

 function ensureArea(){
  let el=$id(AREA_ID);
  if(el)return el;
  el=document.createElement('div');el.id=AREA_ID;el.className='os-print-area';
  document.body.appendChild(el);
  return el;
 }
 /* ---------- 何枚になるかは「測って」決める（§9.115） ----------
    **定数で決め打ちにしないこと**——足りなければ最後の数件が次の紙へこぼれ、
    脚の「1 / 4」が嘘になる。**高さを固定しない**（flexの器で高さを決めると
    表が縮み、実際より多く入るように見える）。
    1件が2行のときも、**同じ`data-row`を1つの塊**として割るので割れない。 */
 function splitToSheets(pages,opt){
  const area=ensureArea();
  const keep=area.getAttribute('style');
  const paperW=paperSizeOf(opt.paper).w;
  const out=[];
  try{
   area.setAttribute('style',`display:block;position:fixed;left:-10000px;top:0;width:${paperW}mm;visibility:hidden`);
   (pages||[]).forEach(p=>{
    const total=(p.rows||[]).length;
    if(!total){out.push({...p,startNo:1,part:1,parts:1,total});return}
    area.innerHTML=pageHtml({...p,startNo:1,part:1,parts:1,total},opt,1,1);
    const pg=area.querySelector('.os-page'),foot=area.querySelector('.os-foot');
    const trs=[...area.querySelectorAll('tbody tr')];
    if(!pg||!foot||!trs.length){out.push({...p,startNo:1,part:1,parts:1,total});return}
    const cs=getComputedStyle(pg);
    const sheetH=parseFloat(cs.minHeight)||0;
    const padBottom=parseFloat(cs.paddingBottom)||0;
    const limit=pg.getBoundingClientRect().top+sheetH-padBottom-foot.offsetHeight-SHEET_SLACK_PX;
    const hs=trs.map(t=>t.getBoundingClientRect().height);
    const rowAt=trs.map(t=>t.dataset.row==null?null:Number(t.dataset.row));
    /* 1件が2行のときは**同じ`data-row`をまとめて1つの塊**にする
       （§9.235 ③）。割ると、測ったときの行数と刷り上がりが食い違う。 */
    const blocks=[];
    trs.forEach((t,i)=>{
     const last=blocks[blocks.length-1];
     if(last&&rowAt[i]!=null&&last.row===rowAt[i]){last.idx.push(i);last.h+=hs[i];return}
     blocks.push({row:rowAt[i],idx:[i],h:hs[i]});
    });
    const avail=limit-trs[0].getBoundingClientRect().top;
    const chunks=[];let cur=[],acc=0;
    blocks.forEach(b=>{
     if(cur.length&&acc+b.h>avail){chunks.push(cur);cur=[];acc=0}
     cur.push(b);acc+=b.h;
    });
    if(cur.length)chunks.push(cur);
    const pages2=chunks.map(list=>list.map(b=>b.row).filter(v=>v!=null))
                       .filter(list=>list.length);
    if(!pages2.length){out.push({...p,startNo:1,part:1,parts:1,total});return}
    /* **通し番号はその日の頭から続ける／件数はその日の合計のまま**（§9.115）。 */
    pages2.forEach((idx,i)=>out.push({...p,rows:idx.map(j=>p.rows[j]),
      startNo:idx[0]+1,part:i+1,parts:pages2.length,total}));
   });
  }finally{
   area.innerHTML='';
   if(keep==null)area.removeAttribute('style');else area.setAttribute('style',keep);
  }
  return out;
 }

 function printPages(sheets,opt,title){
  WL.printCore.printOnPage({
   area:ensureArea(),
   html:sheets.map((p,i)=>pageHtml(p,opt,i+1,sheets.length)).join(''),
   styleId:PAGE_STYLE_ID,paper:opt.paper,paperSizes:PAPER_SIZES,
   printClass:PRINT_CLASS,title:title});
 }

 /* ---------- プレビュー（§9.186「印刷はプレビューを先に出す」） ----------
    押したらすぐ今の条件の紙を出し、設定を触るとその場で刷り上がりが変わる。
    **組み立ては上の1本**（`buildPages`/`splitToSheets`/`pageHtml`）を通す
    ——プレビュー専用の組み立てを作らない（見たものと刷るものが違ったら
    意味が無い）。 */
 const pv={items:[],opt:null,sheets:[],busy:false,again:false,basis:'work',from:'',to:''};
 function ensurePreview(){
  let el=$id('osPreview');if(el)return el;
  el=document.createElement('div');el.className='os-pv';el.id='osPreview';el.hidden=true;
  el.innerHTML=`<div class="os-pv-dialog" role="dialog" aria-modal="true" aria-labelledby="osPvTitle">
    <header class="os-pv-head">
     <div><small>測定実績</small><h2 id="osPvTitle">操業データ表</h2></div>
     <button type="button" id="osPvClose" class="os-pv-x" aria-label="閉じる">×</button>
    </header>
    <div class="os-pv-body">
     <aside class="os-pv-side">
      <section><h3>① 1枚の単位</h3><div class="os-pv-seg" id="osPvUnit">
        <button type="button" data-unit="shift" title="日＋直ごとに1枚（既定）">直ごと（日＋直）</button>
        <button type="button" data-unit="date" title="日ごとに1枚">日ごと</button></div></section>
      <section><h3>② 1件の行数</h3><div class="os-pv-seg" id="osPvRows">
        <button type="button" data-rows="auto" title="入るなら1行、入らなければ2行に折り返します">自動</button>
        <button type="button" data-rows="1" title="必ず1行。入りきらないときは列を細くして詰めます">1行</button>
        <button type="button" data-rows="2" title="必ず2行1データ。列が多いときはこちら">2行</button></div>
       <p class="os-pv-note" id="osPvRowsNote"></p></section>
      <section><h3>③ 用紙</h3>
       <!-- 大きさと向きは別の欄(§9.252)。掛け合わせて並べると用紙を1つ
            足すたびに札が2枚増える。 -->
       <div class="os-pv-sub">大きさ</div>
       <div class="os-pv-seg" id="osPvPaperKind">
        ${PAPER_KINDS.map(k=>`<button type="button" data-kind="${k.key}">${k.label}</button>`).join('')}
       </div>
       <div class="os-pv-sub">向き</div>
       <div class="os-pv-seg" id="osPvPaperOrient">
        ${PAPER_ORIENTS.map(o=>`<button type="button" data-orient="${o.key}">${o.label}</button>`).join('')}
       </div>
       <p class="os-pv-note" id="osPvPaperNow"></p></section>
      <section><h3>④ 見せ方</h3>
       <label class="os-pv-check"><input type="checkbox" id="osPvBorders">枠線を出す</label>
       <label class="os-pv-check"><input type="checkbox" id="osPvDense">高密度（文字と余白を詰める）</label>
       <button type="button" class="os-pv-btn" id="osPvColumns">載せる列を選ぶ…</button>
      </section>
      <section class="os-pv-sum" id="osPvSum"></section>
     </aside>
     <div class="os-pv-main">
      <div class="os-pv-bar">
       <span id="osPvCount"></span>
       <span class="os-pv-grow"></span>
       <button type="button" class="os-pv-btn os-pv-btn--primary" id="osPvPrint">この内容で印刷</button>
      </div>
      <div class="os-pv-scroll" id="osPvScroll"><div class="os-pv-scale" id="osPvScale"></div></div>
     </div>
    </div></div>`;
  document.body.appendChild(el);
  $id('osPvClose').onclick=closePreview;
  $id('osPvPrint').onclick=doPrint;
  $id('osPvColumns').onclick=openColumnPanel;
  /* **設定はclickで受ける**（§9.90。`change`は`click`の後に飛ぶので、
     押した結果で作り直す作りだと反映されない）。 */
  el.querySelectorAll('#osPvUnit [data-unit]').forEach(b=>b.onclick=()=>{pref.unit=b.dataset.unit;afterPref()});
  el.querySelectorAll('#osPvRows [data-rows]').forEach(b=>b.onclick=()=>{pref.rows=b.dataset.rows;afterPref()});
  el.querySelectorAll('#osPvPaperKind [data-kind],#osPvPaperOrient [data-orient]')
   .forEach(b=>b.onclick=()=>{
    pref.paper=paperKeyWith(pref.paper,b.dataset.kind||b.dataset.orient);afterPref();
   });
  $id('osPvBorders').onclick=()=>{pref.borders=$id('osPvBorders').checked;afterPref()};
  $id('osPvDense').onclick=()=>{pref.dense=$id('osPvDense').checked;afterPref()};
  /* **背景クリックでは閉じない**（§9.221 ①）。閉じる場所は×とEscだけ。 */
  if(WL.modal&&typeof WL.modal.keepOpen==='function')WL.modal.keepOpen(el);
  document.addEventListener('keydown',e=>{
   const box=$id('osPreview');
   if(!box||box.hidden)return;
   const esc=(WL.modal&&typeof WL.modal.escCloses==='function')
    ?WL.modal.escCloses(e):(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229);
   if(esc)closePreview();
  });
  return el;
 }
 function afterPref(){savePref();paintOptions();renderPreview()}
 function paintOptions(){
  const on=(sel,attr,val)=>document.querySelectorAll(sel).forEach(b=>
   b.classList.toggle('is-on',b.dataset[attr]===val));
  on('#osPvUnit [data-unit]','unit',pref.unit);
  on('#osPvRows [data-rows]','rows',pref.rows);
  const cur=paperSizeOf(pref.paper);
  on('#osPvPaperKind [data-kind]','kind',cur.kind);
  on('#osPvPaperOrient [data-orient]','orient',cur.orient);
  /* **いまの用紙と刷れる範囲を文字で出す**（§9.252・§CLAUDE 6）
     ——余白を引く暗算をさせない。 */
  const now=$id('osPvPaperNow');
  if(now){
   const u=paperUsableMm(cur.key);
   now.textContent=`いまの用紙は ${cur.label} ${cur.w}×${cur.h}mm。`
    +`四辺 ${PAPER_MARGIN_MM}mm を空けるので、刷れる範囲は ${u.w}×${u.h}mm です。`;
  }
  const b=$id('osPvBorders');if(b)b.checked=pref.borders!==false;
  const d=$id('osPvDense');if(d)d.checked=pref.dense!==false;
 }
 function currentOpt(){
  const keys=visibleColumnKeys();
  const opt={paper:pref.paper,unit:pref.unit,rows:pref.rows,borders:pref.borders!==false,
             dense:pref.dense!==false,basis:pv.basis,equipment:activeEquipment,keys};
  const [l1,l2]=planLines(keys,opt);
  opt.line1=l1;opt.line2=l2;
  return opt;
 }
 function renderPreview(){
  if(pv.busy){pv.again=true;return}
  pv.busy=true;
  try{
   const opt=currentOpt();
   pv.opt=opt;
   const pages=buildPages(pv.items,opt);
   pv.sheets=splitToSheets(pages,opt);
   const scale=$id('osPvScale');
   if(scale)scale.innerHTML=pv.sheets.map((p,i)=>pageHtml(p,opt,i+1,pv.sheets.length)).join('');
   const cnt=$id('osPvCount');
   if(cnt)cnt.textContent=`${pv.items.length}件 / ${pv.sheets.length}枚`;
   const note=$id('osPvRowsNote');
   if(note)note.textContent=opt.line2.length
    ?`2行構成です（上段 ${opt.line1.length}列 / 下段 ${opt.line2.length}列）。列ごとの段は「載せる列を選ぶ」の書式のパターンへ「段:1」「段:2」と書いて決められます。`
    :`1行構成です（${opt.line1.length}列）。`;
   const sum=$id('osPvSum');
   if(sum){
    const w=layoutLines(opt.line1,opt.line2,paperUsableMm(opt.paper).w);
    sum.innerHTML=`<h3>いまの紙</h3><dl>`
     +`<div><dt>設備</dt><dd>${esc(activeEquipment||'すべての設備')}</dd></div>`
     +`<div><dt>期間</dt><dd>${esc(pv.from||'—')} 〜 ${esc(pv.to||'—')}</dd></div>`
     +`<div><dt>日付の数え方</dt><dd>${pv.basis==='cal'?'太陽暦':'現場歴'}</dd></div>`
     +`<div><dt>載せる列</dt><dd>${opt.keys.length}列</dd></div>`
     +`<div><dt>幅</dt><dd>${(w.over>0||w.over2>0)?`紙に入らないので ${Math.round(w.fit*100)}% に縮めています`:'画面で決めた幅をそのまま使っています'}</dd></div>`
     +`<div><dt>トラック</dt><dd>${w.tracks.length}本（上下の段の切れ目をそろえた目盛り）</dd></div>`
     +`</dl>`;
   }
   fitPreview();
  }finally{
   pv.busy=false;
   if(pv.again){pv.again=false;renderPreview()}
  }
 }
 /* 倍率は**幅と高さの両方**へ合わせる（§9.186。幅だけだと1枚が縦に切れ、
    紙に収まるかが分からない）。**`offsetWidth`で測る**——
    `getBoundingClientRect()`はtransform後の見かけなので、回を重ねるほど縮む。 */
 function fitPreview(){
  const box=$id('osPvScroll'),scale=$id('osPvScale');
  if(!box||!scale)return;
  const page=scale.querySelector('.os-page');
  if(!page)return;
  const w=page.offsetWidth,h=page.offsetHeight;
  if(!w||!h)return;
  const z=Math.max(.15,Math.min((box.clientWidth-24)/w,(box.clientHeight-24)/h,1));
  scale.style.setProperty('--os-zoom',String(z));
  /* `transform`は場所を空けないので、器の寸法はJSが入れる。 */
  scale.style.setProperty('--os-zoom-w',(w*z)+'px');
  scale.style.setProperty('--os-zoom-h',((h*z)+12)*Math.max(1,pv.sheets.length)+'px');
 }
 function doPrint(){
  if(!pv.sheets.length){
   showToast&&showToast('刷る紙がありません','この設備・期間には実績がありません。',4200);return;
  }
  printPages(pv.sheets,pv.opt,`操業データ表_${activeEquipment||'全設備'}`);
 }
 function closePreview(){
  const el=$id('osPreview');if(el)el.hidden=true;
 }
 function openColumnPanel(){
  if(!WL.listColumns||typeof WL.listColumns.open!=='function'){
   console.error('列の設定パネル(WL.listColumns.open)がありません');return;
  }
  const eq=activeEquipment;
  WL.listColumns.open({
   key:'opsheet',eyebrow:'操業データ表',
   title:()=>`載せる列の設定（操業データ表：${eq||'共通'}）`,
   lead:'紙に載せる列と、並び・幅・表示名・書式・読み替えを決めます。'
       +'<b>2行構成のときにどちらの段へ置くか</b>は、書式の「パターン」へ <b>段:1</b> / <b>段:2</b> と書きます（空欄なら幅から自動で決めます）。',
   target:()=>targetOf(eq),
   savedToast:'操業データ表の列を保存しました',
   savedNote:'この設備の紙に同じ形で出ます',
   keys:()=>allColumnKeys(),
   healed:()=>null,
   initialHidden:(keys,l)=>initialHidden(keys,l),
   rows:()=>(pv.items||[]).slice(0,40).map((x,i)=>rowView(x,i)),
   valueOf:(row,k)=>(row?row[k]:undefined),
   /* この紙のデータの列か（§9.489）。式を持っても計算列ではない（元の値を式で作り直す列）。 */
   isData:k=>!!columnOf(k),
   virtual:()=>({'#':{label:'#（行番号）',note:'その日の先頭からの通し番号です。'}}),
   joined:()=>new Set(),joinFrom:()=>'',
   origins:()=>['source','calc'],
   originOf:k=>(k==='#'?'calc':'source'),
   noteOf:k=>{const c=columnOf(k);return (c&&c.origin==='op')?'操業データ項目マスタの項目です。':''},
   currentWidthOf:k=>widthPxOf(k),
   /* 紙の割り付けは**みんなで同じ**(§9.259)。人ごとに列が違うと、同じ名前の
      紙を2人が刷って中身が違う、が起きる。個人設定は「表示する一覧表」だけ。 */
   features:{formula:true,preset:true,width:true,format:true,rule:true,sort:false,
             personalScope:false},
   afterApply:()=>renderPreview(),
   save:null,
  });
 }

 /* ---------- 入口 ---------- */
 async function open(o){
  const opt=o||{};
  activeEquipment=String(opt.equipment||'').trim();
  pv.items=(opt.items||[]).slice();
  pv.basis=opt.basis==='cal'?'cal':'work';
  pv.from=opt.from||'';pv.to=opt.to||'';
  lotFields=opt.lotFields||[];
  /* 操業データの列は**項目マスタの並び**。マスタに無い鍵（項目名を変えた
     後の古い記録）も落とさず後ろへ足す——落とすと記録があるのに紙に出せない。 */
  const seen=new Set(),keys=[];
  (opt.opDefs||[]).forEach(d=>{const n=String((d&&d.name)||'').trim();
    if(n&&!seen.has(n)){seen.add(n);keys.push(n)}});
  pv.items.forEach(x=>Object.keys(x.opData||{}).forEach(n=>{
    if(n&&!seen.has(n)){seen.add(n);keys.push(n)}}));
  opKeys=keys;
  const el=ensurePreview();
  /* 配置設定は**描く前に読む**（読めなくても既定の並びで紙は出る）。 */
  await Promise.all([WL.columnLayout.load(targetOf(activeEquipment)).catch(WL.quiet('列の設定を取れない（既定の並びで出す）')),
                     (WL.displayRules&&WL.displayRules.load)?WL.displayRules.load().catch(WL.quiet('表示ルールを取れない（読み替え無しで出す）')):Promise.resolve()]);
  el.hidden=false;
  paintOptions();
  renderPreview();
 }
 window.addEventListener('resize',()=>{
  const box=$id('osPreview');
  if(box&&!box.hidden)fitPreview();
 });

 WL.opSheet={open,close:closePreview,buildPages,splitToSheets,pageHtml,printPages,
             paperSizes:()=>PAPER_SIZES.slice(),
             /* 刷るときの`@page`(§9.252)。**名前ではなく実寸mm**で頼んで
                いることを網が直に見られるようにしておく。 */
             pageRule:pageRuleFor,
             planLines,withMm,layoutLines,mergeTracks,
             columnKeys:allColumnKeys,visibleColumnKeys,targetOf,lineOf,
             pref:()=>({...pref}),sheets:()=>pv.sheets.slice(),
             render:renderPreview};
})();
