"use strict";
/* schedule-print.js: 作業予定表の印刷(§9.115、§9.235)
   ============================================================
   現場へ配って使う紙を出す。

   **§9.235で「画面のタイムラインをそのまま印刷しない」方針を改めた**
   （利用者の指示「画面の見た目を活かしたレイアウトにしてほしい。列の情報や
   並びもそのまま、『内容』で表示内容をまとめずに、画面印刷に近い形で、
   列の成型した内容が生きるように調整してください。また、印刷サイズA4だけ
   でなくA3や縦向きや横向きも選べるようにしてください」）。

   以前は紙のためだけの列（`print:<設備>`という別の列レイアウトマスタ、
   「内容」1列へまとめる仕組み）を持っていた。**紙は画面と同じ`timeline:<設備>`
   （並び・表示/非表示・書式・読み替え・計算式）をそのまま使う**——紙のため
   だけの列選択はやめた。紙にだけ足すのは**印刷専用の「#」「状態」列**
   （先頭。白黒コピーでは色分けが消えるので状態は文字で言い切る）と
   **記入欄**（末尾、§9.191の機能はそのまま残す）。

   幅(mm)は画面の実効px幅を**比率のまま**用紙の使える幅へ配分する
   （`columnEffWidthPx`）。固定mmを積み上げる作りをやめたので、**紙から
   はみ出す組み合わせが原理的に作れない**——列を足すほど1列が狭くなる
   だけで、旧仕組みが必須にしていた「幅の合計と残り」を見せる画面は
   もう要らない。

   紙の決まりごと（§9.115から変えていない部分）:
    ・**1設備・1日で1枚**。現場は日ごと・ラインごとに配るので、
      1枚に複数の日や設備が混ざると渡す相手が決まらない。
    ・**実績を書く欄を紙に置く**。配る目的の半分は「書いて戻してもらう」
      ことなので、書く場所が無いと結局手書きの別紙が要る。
    ・紙の割り付けは**mm(用紙)とpx(文字)の固定**。表示サイズ(--ui-scale)へ
      追随させると、画面の拡大率で紙の行数が変わってしまう
      (CLAUDE.mdの「例外はA4帳票だけ」と同じ理由。既存の.rp-pageに揃える)。
    ・**画面に出ている条件をそのまま持っていく**。表示範囲・列の並び・
      表示/非表示は利用者が既に選んでいるので、紙だけ別の条件で出すと
      突き合わせられない。
   ============================================================ */
(function(){
 const AREA_ID='schedulePrintArea';
 const PRINT_CLASS='sc-print';

 /* 区分の紙での書き方。画面は色と記号で示しているが、**紙は白黒で刷られる**
    ので文字で言い切る(色だけで意味を伝えない、と同じ理由)。画面の「区分」
    (`__cat__`)は作業/設備停止といった**種類**を出すのに対し、こちらは
    予定/作業中/完了/取消という**状態**——別の軸なので、紙だけの列として
    「#」の隣に残す(§9.235)。 */
 const STATE_LABEL={'予定':'予定','着手':'作業中','完了':'完了','取消':'取消'};
 /* 状態の色。**画面の区分(`.sc-cat-*`)と同じ語彙**へ寄せる（§9.237）
    ——紙だけ別の色にすると、画面で赤かったものが紙で灰色になる。
    状態は紙だけの列なので、対応表もここに置いてよい（画面に同じ列が無い）。 */
 const STATE_TONE={'予定':'planned','着手':'doing','完了':'done','取消':'cancel'};

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
 /* 紙の「日付」も**現場歴で数える**(§9.197)。画面のまとまりは現場歴
    (勤務の日付補正を当てた現場の1日)なので、紙だけ暦で数えると
    「画面では18日に12件なのに、紙は18日と19日に分かれる」という食い違いに
    なる——日ごとに配る紙で件数が合わないのは、受け取った側が「足りない」と
    判断できなくなるので致命的(§9.115と同じ理由)。
    現場歴が分からない行(勤務が決まらない行)は暦で数える。 */
 const workDayKey=(e,start)=>{
  /* **画面のまとめ方に従う**(§9.198)。まとめを「日付ごと（太陽暦）」に
     しているときに紙だけ現場歴で切ると、日ごとに配る紙の件数が画面と
     合わなくなる。まとめが日付でないとき(区分・勤務・まとめない)は
     今までどおり現場歴。 */
  let basis='';
  try{basis=(typeof WL.scheduleView?.groupBasis==='function')?WL.scheduleView.groupBasis():''}catch(_){basis=''}
  if(basis==='cal')return dayKey(start);
  return (e&&e.workDate)||dayKey(start);
 };
 const WD=['日','月','火','水','木','金','土'];
 function dayLabel(key){
  if(!key)return '日付未定';
  const d=new Date(key+'T00:00:00');
  if(Number.isNaN(d.getTime()))return key;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${WD[d.getDay()]}）`;
 }
 function rangeLabel(rows){
  const keys=(rows||[]).map(r=>workDayKey(r.e,r.start)).filter(Boolean).sort();
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

 /* ---------- 用紙サイズ(§9.235、利用者の指示「印刷サイズA4だけでなくA3や
    縦向きや横向きも選べるようにしてください」) ----------
    画面が15列以上・内容の項目が多い設備ではA4では狭いことがあるので、
    A3・横向きも選べるようにする。**余白は四辺とも同じ8mm**（既存のA4と
    揃える）。 */
 const PAPER_SIZES=[
  {key:'a4-portrait', label:'A4 縦',w:210,h:297},
  {key:'a4-landscape',label:'A4 横',w:297,h:210},
  {key:'a3-portrait', label:'A3 縦',w:297,h:420},
  {key:'a3-landscape',label:'A3 横',w:420,h:297},
 ];
 const PAPER_MARGIN_MM=8;
 function paperSizeOf(key){return PAPER_SIZES.find(p=>p.key===key)||PAPER_SIZES[0]}
 function paperUsableMm(key){
  const p=paperSizeOf(key);
  return {w:p.w-PAPER_MARGIN_MM*2,h:p.h-PAPER_MARGIN_MM*2};
 }
 /* 実際に紙へ出すときだけ`@page`を差し替える(§9.235)。**クラスでは
    切り替えられない**ため、専用の<style>を書き換える方式にする
    ——帳票(`report-dashboard.js`の`updatePageSizeStyle`)と同じ作法で、
    app.css側の既定`@page`より後に挿入されるためこちらが優先される。 */
 const PAGE_STYLE_ID='scPrintPageSizeStyle';
 function applyPrintPageStyle(paperKey){
  let el=document.getElementById(PAGE_STYLE_ID);
  if(!el){el=document.createElement('style');el.id=PAGE_STYLE_ID;document.head.appendChild(el)}
  const p=paperSizeOf(paperKey);
  const orient=p.w>p.h?'landscape':'portrait';
  const size=p.key.indexOf('a3')===0?'A3':'A4';
  el.textContent=`@page{size:${size} ${orient};margin:0}`;
 }

 /* ---------- 印刷する中身を組み立てる ----------
    entriesは画面が持っているものをそのまま受け取る(紙のために取り直さない
    ——取り直すと画面と紙で件数が食い違い、どちらが正か分からなくなる)。 */
 function buildPages(equipment,entries,opt){
  const view=WL.scheduleView;
  const rows=(entries||[]).filter(e=>{
   if(e.parentId!=null)return false;              // 子ロットは主行にしない(§9.235③)——内訳は下で別に付ける
   if(e.__pending)return false;                    // まだサーバーに無いものは刷らない
   const st=e.state||'予定';
   if(st==='完了'||st==='取消')return !!opt.includeDone;
   return true;
  });
  /* **日付ごとに束ねる。** 並びは画面の順(=実際に流す順)のまま。
     時刻で並べ直さないこと——固定開始や停止の差し込みで、画面の順と
     時刻の順は必ずしも一致しない。現場が見るのは「流す順」。 */
  /* **画面の「まとめ」をそのまま紙へ**(§9.189、利用者の指示)。まとまりの
     判定は画面の1箇所(groupBucketOf)を通す——紙だけ別に組み立てると、
     画面と紙でまとまりが食い違う。「まとめない」ときは見出しを出さない。 */
  const grouping=opt.useGroups!==false&&typeof view?.groupMode==='function'
    &&view.groupMode()!=='none'&&typeof view.groupOf==='function';
  const groups=[];const index=new Map();
  rows.forEach(e=>{
   const useActual=(e.state==='完了'||e.state==='着手')&&e.actual&&e.actual.startAt;
   const start=useActual?e.actual.startAt:e.plannedStart;
   const key=opt.pageByDate?workDayKey(e,start):'';
   if(!index.has(key)){const g={key,label:dayLabel(key),rows:[]};index.set(key,g);groups.push(g)}
   let group=null;
   if(grouping){try{group=view.groupOf(e)}catch(_){group=null}}
   /* **印刷向けのセル文字列・子ロットの内訳はここで解いて持たせる**
      (§9.235)。他の設備ぶんを成り代わって解いているとき(`withEquipment`)
      にしか正しく引けないので、`pageHtml`側で遅延評価すると値が食い違う
      （成り代わりは同期のあいだしか続かない）。 */
   const cells=(typeof view.printRowCells==='function')?view.printRowCells(e):[];
   const allKids=(typeof view.childrenOf==='function')?(view.childrenOf(e.id)||[]):[];
   const kids=opt.includeChildren?allKids:[];
   /* 行の見せ方（行表示マスタ。§9.198）も紙へ運ぶ（§9.237）——画面で色を
      付けた区分・停止分類が、紙では真っ白では「画面の見た目そのまま」に
      ならない。**判定は画面の1箇所**（`rowStyleOf`）を呼ぶだけ。 */
   let rowStyle=null;
   if(typeof view.rowStyleOf==='function'){try{rowStyle=view.rowStyleOf(e)}catch(_){rowStyle=null}}
   /* 子ロットの件数は**内訳を載せるかどうかとは別**（§9.237）。画面は
      ロット番号のお尻に「子N」の印を出しているので、紙でも出す。 */
   index.get(key).rows.push({e,start,end:useActual?e.actual.endAt:e.plannedEnd,group,cells,kids,
                             kidCount:allKids.length,rowStyle});
  });
  /* 紙の列は**1つの紙の中で変えない**ので、まとめて1回だけ決める。 */
  const cols=printColumns(opt);
  return groups.map(g=>({
   cols,
   /* 日付で分けないときは、束ねた中身の**実際の範囲**を書く。
      キーが空だからと「日付未定」にすると、日付を持っている予定まで
      日付不明の紙として配られてしまう。 */
   equipment,day:opt.pageByDate?g.label:rangeLabel(g.rows),rows:g.rows,
   /* 見出しに出す「その日ぶん」の合計。**紙を切り分けても変えない**
      （2枚目に「12件」と出ると、その日が12件だと読まれてしまう）。
      **子ロットの内訳は数えない**——予定そのものの件数と揃える。 */
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
  const paperW=paperSizeOf(opt.paper).w;
  const out=[];
  try{
   area.setAttribute('style',`display:block;position:fixed;left:-10000px;top:0;width:${paperW}mm;visibility:hidden`);
   (pages||[]).forEach(p=>{
    if(!p.rows||!p.rows.length){out.push({...p,startNo:1,part:1,parts:1});return}
    area.innerHTML=pageHtml({...p,startNo:1,part:1,parts:1},opt,1,1);
    const pg=area.querySelector('.sp-page'),foot=area.querySelector('.sp-foot');
    const trs=[...area.querySelectorAll('tbody tr')];
    if(!pg||!foot||!trs.length){out.push({...p,startNo:1,part:1,parts:1});return}
    const cs=getComputedStyle(pg);
    /* 表の下に置くもの（申し送りの欄。§9.189）も**高さを引く**——引き忘れると
       行で紙を埋めたあとに欄が押し出し、A4から溢れる（実測1188px > 1123px）。 */
    const note=area.querySelector('.sp-note');
    const noteH=note?(note.getBoundingClientRect().height
      +(parseFloat(getComputedStyle(note).marginTop)||0)):0;
    /* 用紙1枚の高さはmm指定なので、computedStyleがpxへ直したものを借りる
       （mm→pxの換算を自前で持つと、いつか96dpi決め打ちが混ざる）。 */
    const sheetH=parseFloat(cs.minHeight)||0;
    const padBottom=parseFloat(cs.paddingBottom)||0;
    const limit=pg.getBoundingClientRect().top+sheetH-padBottom-foot.offsetHeight-noteH-SHEET_SLACK_PX;
    const hs=trs.map(t=>t.getBoundingClientRect().height);
    /* **まとまりの見出し行は「行」ではない**(§9.189)。高さは数えるが、
       中身の行としては数えない——ここを取り違えると、見出しのぶんだけ
       予定が抜け落ちる(配る紙から作業が消える)。 */
    const rowAt=trs.map(t=>t.dataset.row==null?null:Number(t.dataset.row));
    /* ---- 予定＋子ロットの内訳は「1つの塊」として割る(§9.235③) ----
       子ロットの内訳の行(`childRowHtml`)は親と**同じ`data-row`**を持つ。
       1件の予定として塊で割らないと、子の途中で改ページしたときに
       「測ったときは途中までしか数えていない」のに「刷るときは親の子を
       まるごと出す」という食い違いが起きる（測定と刷り上がりがずれる）。
       まとまりの見出し(`data-row`無し)は今までどおり1行だけの塊。 */
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
    /* 見出しだけで終わった塊は次の塊へ寄せる(見出しが1枚に取り残されない)。
       見出しは次の枚でpageHtmlが出し直すので、ここでは捨ててよい。 */
    const pages2=chunks.map(list=>list.map(b=>b.row).filter(v=>v!=null))
                       .filter(list=>list.length);
    if(!pages2.length){out.push({...p,startNo:1,part:1,parts:1});return}
    pages2.forEach((idx,i)=>out.push({...p,rows:idx.map(j=>p.rows[j]),
      startNo:idx[0]+1,part:i+1,parts:pages2.length}));
   });
  }finally{
   area.innerHTML='';
   if(keep==null)area.removeAttribute('style');else area.setAttribute('style',keep);
  }
  return out;
 }

 /* ---------- 紙の列は画面と同じ(§9.235) ----------
    利用者の指示「画面の見た目を活かしたレイアウトにしてほしい。列の情報や
    並びもそのまま、『内容』で表示内容をまとめずに、画面印刷に近い形で、
    列の成型した内容が生きるように」。

    以前は`print:<設備>`という紙のためだけの列レイアウトを持ち、内容の
    項目を「内容」の1列へまとめていた(§9.118)。**紙のためだけの列選択は
    やめた**——画面の`timeline:<設備>`（並び・表示/非表示・書式・読み替え・
    計算式）をそのまま使う。紙にだけ足すのは**印刷専用の「#」「状態」列**
    （先頭。状態は白黒コピーで色分けが消える分の言い切り）と**記入欄**
    （末尾、§9.191の機能はそのまま）。 */
 /* ---------- 列の範囲(§9.236、利用者の指示「見える範囲の列か、全ての列かを
    選べるようにして」) ----------
    「全ての列」（既定＝§9.235までの挙動）は、画面で表示中のすべての列
    （横スクロールしないと見えないものも含む）を紙へ出す——列数が多い設備
    ではどうしても1列が狭くなる。「見える範囲の列」は、いま画面を
    スクロールせずに見えている列**だけ**を紙にする——列数が絞られるぶん、
    下のwithMm()が「設定した幅をそのまま使える」場面が増え、画面の見た目に
    近い、余白のある紙になる。 */
 const COLUMN_SCOPES=[
  {key:'all',    label:'すべての列',      note:'横スクロールしないと見えない列も含めて全部載せます（既定）'},
  {key:'visible',label:'見える範囲の列だけ',note:'いま画面をスクロールせずに見えている列だけを、画面に近い余白で載せます'},
 ];
 function columnScopeOf(opt){
  const k=String(opt&&opt.columnScope||'');
  return COLUMN_SCOPES.some(s=>s.key===k)?k:'all';
 }
 function printColumns(opt){
  const view=WL.scheduleView;
  const visible=columnScopeOf(opt)==='visible';
  const keys=visible&&typeof view.visibleColumnKeys==='function'?view.visibleColumnKeys()
    :(typeof view.printColumnKeys==='function'?view.printColumnKeys():[]);
  const base=[{key:'no',   label:'#', w:30},
              {key:'state',label:'状態',w:50},
              ...keys.map(k=>({key:k,
                label:(typeof view.columnLabelOf==='function')?view.columnLabelOf(k):k,
                w:(typeof view.columnEffWidthPx==='function')?view.columnEffWidthPx(k):110}))];
  const pat=WRITE_PATTERNS.find(p=>p.key===writePatternOf(opt))||WRITE_PATTERNS[0];
  const writeCols=(pat.keys||[]).map(k=>PAPER_WRITE.find(w=>w.key===k)).filter(Boolean);
  return [...base,...writeCols];
 }
 /* ---------- 幅(mm)はこの1本で配る(§9.236、利用者の指示「列幅も設定した
    ものを活かして」) ----------
    以前は列数に関わらず**必ず用紙の使える幅いっぱいへ比率で伸縮**して
    いた——列が少ないときも無理に間延びし、画面で決めた幅の「感じ」が
    紙では消えていた。**まず画面の実効px幅を96dpi(CSSの標準)でmmへ
    そのまま換算し**、それが用紙に収まるならそのまま使う（設定した幅を
    活かす）。**収まらないときだけ**、いままでどおり比率で圧縮する
    （紙からはみ出す組み合わせを原理的に作らない、という既存の保証は
    そのまま残す）。余った分は表の右の余白になる——伸ばして埋め直さない
    （§9.115「行の高さは中身で決め、余った下は空けたままにする」と同じ
    考え方を横方向にも当てる）。 */
 const MM_PER_PX=25.4/96;
 /* 縮めるときは**文字も一緒に縮める**（§9.237、利用者の指摘「列の折り返しを
    無くした形で列を整えても印刷側できちんと反映されない」）。
    幅だけを比率で詰めると、同じ文字が狭い箱に入らなくなって折り返し
    （実機で見出し「用途コード」が2行になっていた）か切り落としになる。
    幅と文字を同じ比率で縮めれば、**画面で決めた「この列に何文字入るか」が
    紙でもそのまま**になる。下限を切ったら（読めない大きさになるなら）
    そこで止めて、収まらないことをプレビューに文字で出す（§4）。 */
 const MIN_FIT=.62;
 const MIN_COL_MM=4;      // これ以下の列は文字が1つも入らない
 const FRAME_MM=.5;       // 表を囲む器(.sp-table-wrap)の枠のぶん
 /* ---------- 下限のある比例配分（§9.237） ----------
    「狭い列は最低◯mm」と「合計は用紙に収める」を**同時に**満たす。
    以前は`Math.max(4, natural*scale)`と1回で済ませていたが、床に当たった
    列のぶんだけ合計が膨らみ、**16列A4縦で3.8mmはみ出していた**（右余白が
    8mm→4.2mmへ痩せる。表の中しか見ていない`wide`判定では捕まらない）。
    床に着いた列を固定して、残りを残りの予算で配り直す——を落ち着くまで繰り返す。
    列が多すぎて「全部が下限」でも入らないときは、**下限のほうを下げる**
    （紙からはみ出させない、が最後まで優先）。 */
 function shareMm(natural,usableMm){
  const n=natural.length;
  if(!n)return [];
  const floor=Math.min(MIN_COL_MM,usableMm/n);
  const out=natural.slice();
  const fixed=new Array(n).fill(false);
  for(let pass=0;pass<=n;pass++){
   let used=0,freeNat=0;const free=[];
   for(let i=0;i<n;i++){
    if(fixed[i]){used+=out[i];continue}
    free.push(i);freeNat+=natural[i];
   }
   if(!free.length)break;
   const k=freeNat>0?Math.min(1,(usableMm-used)/freeNat):1;
   let hit=false;
   free.forEach(i=>{
    const v=natural[i]*k;
    if(v<floor){out[i]=floor;fixed[i]=true;hit=true}else out[i]=v;
   });
   if(!hit)break;
  }
  /* 0.1mm へ丸めた誤差で合計が予算を超えることがある。**いちばん広い列から
     引く**（狭い列から引くと下限を割る）。 */
  const mm=out.map(v=>Math.round(v*10)/10);
  let over=Math.round((mm.reduce((s,v)=>s+v,0)-usableMm)*10)/10;
  while(over>0.001){
   let at=0;for(let i=1;i<n;i++)if(mm[i]>mm[at])at=i;
   const cut=Math.min(over,Math.max(0,mm[at]-floor))||over;
   mm[at]=Math.round((mm[at]-cut)*10)/10;
   over=Math.round((over-cut)*10)/10;
   if(cut<=0)break;
  }
  return mm;
 }
 function withMm(cols,usableMm){
  const budget=Math.max(1,usableMm-FRAME_MM);
  const natural=cols.map(c=>Math.max(MIN_COL_MM,(c.w||60)*MM_PER_PX));
  const total=natural.reduce((s,w)=>s+w,0)||1;
  if(total<=budget)
   return {cols:cols.map((c,i)=>({...c,mm:Math.round(natural[i]*10)/10})),fit:1,over:0};
  const scale=budget/total;
  /* 幅は今までどおり**必ず**用紙に収める（はみ出す組み合わせを原理的に
     作らない、という既存の保証は変えない）。文字だけ下限で止める。 */
  const fit=Math.max(MIN_FIT,scale);
  const mm=shareMm(natural,budget);
  return {cols:cols.map((c,i)=>({...c,mm:mm[i]})),
          fit:Math.round(fit*1000)/1000,over:Math.round((total-budget)*10)/10};
 }

 /* 記入欄。**空のまま罫線だけ**にする(薄い下線を入れると書きにくい)。 */
 const PAPER_WRITE=[
  {key:'write:start',label:'実績 開始',write:true,w:90},
  {key:'write:end',  label:'実績 終了',write:true,w:90},
  {key:'write:check',label:'確認',    write:true,w:60},
  {key:'write:note', label:'備考',    write:true,w:150},
 ];
 /* ---------- 記入欄のパターン(§9.191、利用者の指示) ----------
    「開始・終了での入力欄ではなく、備考という形での枠設定や、他カスタム
     できるパターンを追加して、メニューも分かりやすく」。

    記入欄は**現場が紙に書き込む場所**なので、運用ごとに要るものが違う
    （実績を戻してもらう／気付きだけ書ければよい／確認印だけ／見るだけ）。
    **既定は「実績を書いてもらう」**(§9.235)——以前の既定「紙の列で決めた
    まま」は紙のためだけの列選択があった前提の言い方で、それが無くなった
    ので率直な既定へ言い直した（挙動そのものは変わっていない。以前も
    「紙の列を触っていない設備」ではこれと同じ3欄が出ていた）。 */
 const WRITE_PATTERNS=[
  {key:'actual',    label:'実績を書いてもらう（既定）',keys:['write:start','write:end','write:check'],
   note:'開始・終了・確認の3欄。配って書いて戻してもらう形'},
  {key:'actualNote',label:'実績＋備考',                keys:['write:start','write:end','write:check','write:note'],
   note:'実績のほかに気付きも書ける'},
  {key:'note',      label:'備考だけ',                  keys:['write:note'],
   note:'書くのは気付きだけでよいとき'},
  {key:'check',     label:'確認だけ',                  keys:['write:check'],
   note:'流し終わりに印を付けるだけ'},
  {key:'none',      label:'記入欄なし',                keys:[],
   note:'見るための紙（書き込まない）'},
 ];
 function writePatternOf(opt){
  const k=String(opt&&opt.writePattern||'');
  if(WRITE_PATTERNS.some(p=>p.key===k))return k;
  /* 古い設定(actualColumns)からの読み替え。**設定を触っていない現場の紙が
     更新で変わらないように**、偽＝なしへ落とす。 */
  if(opt&&opt.actualColumns===false)return 'none';
  return 'actual';
 }

 /* 固定列の揃え方。画面と同じキーで判定する(§9.235)——`__est__`のような
    内側のキーは並べ替えても変わらないので、ここに書いても崩れない。 */
 const FIXED_ALIGN_CENTER=new Set(['__cat__','__workable__','__date__','__caldate__','__time__','__shift__','__rel__']);
 const FIXED_ALIGN_RIGHT=new Set(['__est__','__actual__']);
 function fixedAlignClass(k){
  if(FIXED_ALIGN_RIGHT.has(k))return 'sp-al-r';
  if(FIXED_ALIGN_CENTER.has(k)||k==='no'||k==='state')return 'sp-al-c';
  return '';
 }
 function writeCellClass(k){return k==='write:check'?'sp-c-check':'sp-c-write'}

 /* ---------- 紙のバッジ（§9.237、利用者の指示「画面印刷の時に映る
    スケジュール一覧表の見た目を正にしてその見た目に近づけてほしい」） ----------
    画面では可否・区分・印が**色の付いた小さな札**で、そこが一覧の読みやすさの
    肝になっている。紙で全部を素の文字にすると、同じ表でも「灰色の升目」に
    見える（実機で「カラーなくグレーの感じ」と指摘された）。
    **状態そのものは画面が答える**（`printRowCells`の`tone`／`chips`。§9.237）
    ので、ここがやるのは**紙の意匠へ翻訳するだけ**。
    **色だけで伝えない**（§3）——札の中の文字（可／不可／予定／計画外…）は
    画面と同じものを必ず出す。 */
 function badgeHtml(tone,text,title,extra){
  const t=String(tone||'');
  const cls=t?` sp-b-${esc(t)}`:'';
  const tip=title?` title="${esc(title)}"`:'';
  return `<span class="sp-badge${cls}"${tip}>${extra||''}${esc(text)}</span>`;
 }
 /* 親ロットの印（子N／親）。**画面と同じ言い方**にする（§9.199）——
    画面が「子2」と出しているのに紙が「親」では、同じ行の話だと分からない。
    紙では押せないので、開閉のつまみではなく**ただの印**として出す。 */
 function kidBadgeHtml(count){
  if(!count)return '';
  let mode='count';
  try{if(typeof WL.scheduleView.childBadgeMode==='function')mode=WL.scheduleView.childBadgeMode()}catch(_){}
  const text=mode==='parent'?'親':`子${count}`;
  return `<span class="sp-kid" title="分割後の子ロットが${count}件あります">${esc(text)}</span>`;
 }
 /* 子ロットの印を付ける列。**画面と同じ列**（§9.235 ④の`childBadgeColKey`）
    ——画面はロット番号のお尻に付けているので、紙だけ別の列に付けると
    突き合わせられない。その列を刷っていなければロット番号へ落とす。 */
 function kidBadgeKey(cols){
  let k='';
  try{if(typeof WL.scheduleView.childBadgeColKey==='function')k=String(WL.scheduleView.childBadgeColKey()||'')}catch(_){k=''}
  if(k&&cols.some(c=>c.key===k))return k;
  return cols.some(c=>c.key==='lotNo')?'lotNo':'';
 }
 function cellsOf(item,no,cols){
  const map=new Map((item.cells||[]).map(c=>[c.key,c]));
  const kidKey=item.kidCount?kidBadgeKey(cols):'';
  return cols.map(c=>{
   if(c.key==='no')return `<td class="sp-al-c">${esc(String(no))}</td>`;
   if(c.key==='state'){
    const st=item.e.state||'';
    return `<td class="sp-al-c">${badgeHtml('cat-'+(STATE_TONE[st]||'planned'),
      STATE_LABEL[st]||st||'')}</td>`;
   }
   if(c.write)return `<td class="${writeCellClass(c.key)}"></td>`;
   const v=map.get(c.key);
   const text=v?v.text:'';
   const cls=[fixedAlignClass(c.key),c.key==='lotNo'?'sp-c-lot':'',
              v&&v.color?'cell-'+v.color:''].filter(Boolean).join(' ');
   const raw=v&&v.raw!=null?String(v.raw):'';
   const title=raw&&raw!==text?` title="${esc(raw)}"`:'';
   /* 印（計画外・固定・遅れ…）は**1つずつ札にする**（画面と同じ）。 */
   if(v&&v.chips&&v.chips.length)
    return `<td class="sp-c-chips">${v.chips.map(f=>
      `<span class="sp-chip sp-chip-${esc(f.cls||'')}" title="${esc(f.title||'')}">${esc(f.text||'')}</span>`
     ).join('')}</td>`;
   /* 可否・区分は札。区分は**行表示マスタのアイコン**も画面と同じ位置へ
      添える（§9.198。色だけで伝えないので文字は必ず残す）。 */
   const tone=v&&v.tone?String(v.tone):'';
   if(text&&(tone.indexOf('wk-')===0||tone.indexOf('cat-')===0)){
    const icon=(tone.indexOf('cat-')===0&&item.rowStyle&&item.rowStyle.html)?item.rowStyle.html:'';
    return `<td class="${esc(cls)}"${title}>${badgeHtml(tone,text,'',icon)}</td>`;
   }
   /* 暫定の見積（実績がまだ無い）は画面と同じく**薄い斜体**にする。 */
   if(tone==='est-provisional')
    return `<td class="${esc(cls)}"${title}><span class="sp-est-prov">${esc(text)}</span></td>`;
   if(c.key===kidKey)
    return `<td class="${esc(cls)}"${title}><span class="sp-cell-in">${esc(text)}</span>${kidBadgeHtml(item.kidCount)}</td>`;
   return `<td class="${esc(cls)}"${title}>${esc(text)}</td>`;
  }).join('');
 }

 /* ---------- 子ロットの内訳の1行(§9.235③、利用者の指示「分割後の子ロット
    の情報も印刷表示ONOFFできるようにしてください」) ----------
    画面(`renderChildRows`)と同じ考え方——**ロット番号の列の真下**へ
    子ロット番号を置き、その右から端までを内訳（幅・条数・公差）の
    1マスとして使う(§9.197)。表なので`grid-column`の代わりに`colspan`で
    束ねる。 */
 function childRowHtml(child,cols,parentIdx){
  const at=cols.findIndex(c=>c.key==='lotNo');
  const summary=(typeof WL.scheduleView.childSummaryOf==='function')
    ?(WL.scheduleView.childSummaryOf(child)||''):'';
  const lotLabel=`└ ${child.lotNo||''}`;
  let cells='';
  if(at<0){
   // ロット番号の列を1つも出していないとき。内訳だけを全幅で出す。
   cells=cols.length?`<td colspan="${cols.length}" class="sp-c-child-info">${esc(summary)}</td>`:'';
  }else{
   cols.forEach((c,i)=>{
    if(i<at)cells+='<td></td>';
    else if(i===at)cells+=`<td class="sp-c-child-lot">${esc(lotLabel)}</td>`;
    else if(i===at+1)cells+=`<td colspan="${cols.length-i}" class="sp-c-child-info">${esc(summary)}</td>`;
   });
   // ロット番号が最後の列なら、内訳はその手前へ回す(器が無いと消える)。
   if(at===cols.length-1&&at>0)
    cells=`<td colspan="${at}" class="sp-c-child-info">${esc(summary)}</td>`
      +`<td class="sp-c-child-lot">${esc(lotLabel)}</td>`;
  }
  /* **`data-row`は親と同じ**にする——splitToSheetsが「同じdata-row=1つの
     塊」として割るための印(§9.235③)。子だけを別ページへ逃さない。 */
  return `<tr class="sp-row-child">${cells}</tr>`.replace('<tr class="sp-row-child">',
    `<tr class="sp-row-child" data-row="${parentIdx}">`);
 }

 function pageHtml(page,opt,pageNo,pageCount){
  const fitted=withMm(page.cols||printColumns(opt),paperUsableMm(opt.paper).w);
  const cols=fitted.cols;
  /* 幅は**colgroupで与える**（CSSのクラスに書くと利用者が変えられない）。 */
  const group=`<colgroup>${cols.map(c=>`<col style="width:${c.mm}mm">`).join('')}</colgroup>`;
  /* ---------- 表の幅は「列幅の合計」（§9.237、一覧の§9.119と同じ理由） ----------
     `width:100%`のままだと、`table-layout:fixed`は**余った幅を各列へ配り直す**
     ので、colgroupへ設定どおりのmmを入れても**刷り上がりでは引き伸ばされる**
     （利用者の指摘「列幅も設定したものを活かして…印刷側できちんと反映されない」
     の実体がこれ。宣言値だけを見る網は素通りしていた）。合計を入れて、
     余りは表の右の余白にする（§9.115「余った下は空けたままにする」の横版）。 */
  const tableMm=Math.round(cols.reduce((s,c)=>s+(c.mm||0),0)*10)/10;
  const head=cols.map(c=>`<th class="${esc([fixedAlignClass(c.key),
    c.key==='lotNo'?'sp-c-lot':''].filter(Boolean).join(' '))}">${esc(c.label)}</th>`);
  /* **通し番号はその日の頭から数える。** 紙が2枚に分かれても#1へ戻さない
     （現場は番号で呼び合うので、同じ日に#1が2つあると指せなくなる）。 */
  const from=page.startNo||1;
  /* まとまりの見出し(§9.189)。**紙を切り分けた続きの枚にも出す**
     ——2枚目が見出し無しで始まると、どのまとまりの続きなのか読めない。
     `data-row`が付いているのが実際の予定の行で、**枚数を測る側は
     この印で数える**(splitToSheets)。 */
  let lastGroup=null;
  /* まとまりの見出しに添える「現場歴／太陽暦」（§9.237）。**紙の中で
     変わらない**ので1回だけ引く。 */
  let basisLabel='';
  try{if(typeof WL.scheduleView?.groupBasisLabel==='function')basisLabel=WL.scheduleView.groupBasisLabel()||''}catch(_){basisLabel=''}
  const body=page.rows.map((item,i)=>{
   const g=item.group;
   let head2='';
   if(g&&g.key!==lastGroup){
    lastGroup=g.key;
    /* **同じことを2箇所に出さない**(§9.129)。日付ごとにページを分けていて
       まとめも日付なら、見出しは紙の頭と同じ文字になる。 */
    if(String(g.label)!==String(page.day||'')){
     const n=page.rows.filter(x=>x.group&&x.group.key===g.key).length;
     /* 帯の中身は**画面の`groupHeadHtml()`と同じ3つ**（§9.237）——
        まとまりの名前・どの日付で数えているか（現場歴／太陽暦）・件数。
        以前は名前と件数だけで、しかも濃い灰色の帯だった。 */
     head2=`<tr class="sp-row-group"${g.tone?` data-tone="${esc(g.tone)}"`:''}>`
       +`<td colspan="${head.length}"><span class="sp-group-label">${esc(g.label)}</span>`
       +(basisLabel?`<span class="sp-group-basis">${esc(basisLabel)}</span>`:'')
       +`<span class="sp-group-count">${n}件</span></td></tr>`;
    }
   }
   /* 申し送り(コメント)は**横いっぱいの1行**にする——列に押し込むと
      読めない幅になり、書いた意味が無くなる（§9.191、利用者の指示）。 */
   if(item.e.kind==='コメント'){
    return head2+`<tr class="sp-row-comment" data-row="${i}">`
   +`<td colspan="${head.length}"><b>申し送り</b> ${esc((item.e.title||'').trim())}</td></tr>`;
   }
   /* 行の地の色は**画面と同じクラス**（`sc-rs-<色>`）を貼る（§9.237）——
      色の定義（`--rs-fg`/`--rs-bg`/`--rs-line`）は行表示マスタの1箇所が
      持っているので、紙のためにもう1つ色表を作らない。 */
   const rsKey=item.rowStyle&&item.rowStyle.colorKey?String(item.rowStyle.colorKey):'';
   const rowCls=[item.e.kind!=='作業'?'sp-row-stop':'',rsKey?'sc-rs-'+rsKey:''].filter(Boolean).join(' ');
   const mainRow=head2+`<tr class="${esc(rowCls)}" data-row="${i}">`
     +`${cellsOf(item,from+i,cols)}</tr>`;
   /* 子ロットの内訳(§9.235③)。**「載せる」を選んだときだけ**——分割の
      無いロットが大半の現場では、内訳が常に付くと紙が長くなりすぎる。 */
   const kidRows=(opt.includeChildren&&item.kids&&item.kids.length)
     ?item.kids.map(k=>childRowHtml(k,cols,i)).join(''):'';
   return mainRow+kidRows;
  }).join('')
   ||`<tr><td class="sp-empty" colspan="${head.length}">この日に出す予定はありません</td></tr>`;
  /* 総見積。紙を受け取った人が最初に見るのは「今日どれだけあるか」。
     **切り分けた紙でもその日の合計を出す**（この紙に載っている数ではない）。 */
  const count=page.count==null?page.rows.length:page.count;
  const total=page.total==null
   ? page.rows.reduce((s,x)=>s+((x.e.estimate&&x.e.estimate.minutes)||0),0)
   : page.total;
  const parts=page.parts||1;
  const cont=parts>1?`（${page.part||1}枚目 / 全${parts}枚）`:'';
  /* 収まらないときは**文字も一緒に縮める**（§9.237）。`--sp-fit`は
     `.sp-table`の中の文字サイズにだけ掛かる（用紙・余白はmmのまま）。 */
  const fitVar=fitted.fit<1?` style="--sp-fit:${fitted.fit}"`:'';
  return `<section class="sp-page" data-paper="${esc(opt.paper||'a4-portrait')}"${
    opt.borders===false?' data-borders="off"':''}${fitVar}>
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
   <div class="sp-table-wrap">
    <table class="sp-table" style="width:${tableMm}mm">${group}<thead><tr>${head.join('')}</tr></thead><tbody>${body}</tbody></table>
   </div>
   ${opt.commentBox===false?'':`<section class="sp-note">
     <span class="sp-note-label">申し送り・気付き</span>
     <span class="sp-note-area"></span>
    </section>`}
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
  /* 用紙サイズ・向きを`@page`へ反映してから刷る(§9.235)。 */
  applyPrintPageStyle(opt.paper);
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
 /* useGroups=画面の「まとめ」を紙にも入れる / commentBox=紙の下に
    申し送りの欄を作る(§9.189、利用者の指示)。includeChildren=分割後の
    子ロットの内訳も載せる(§9.235③)。paper=用紙サイズ・向き(§9.235)。
    columnScope=列の範囲(§9.236)。borders=枠線を出すか(§9.236)。
    どれも既定は今までの見え方を保つ側（子ロットの内訳・A3・見える範囲だけ・
    枠線なしはどれも新機能なので既定オフ側＝これまでどおり全部の列に
    枠線を付ける／A4縦）。 */
 const DEFAULTS={includeDone:false,actualColumns:true,pageByDate:true,allEquipment:false,
                 useGroups:true,commentBox:true,writePattern:'actual',
                 includeChildren:false,paper:'a4-portrait',
                 columnScope:'all',borders:true};
 function loadPref(){
  try{
   const v={...DEFAULTS,...(JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{})};
   /* 古い保存値の読み替え(§9.235)。'custom'は「紙の列で決めたまま」の
      意味だったが、紙だけの列選択が無くなったので既定へ倒す。 */
   if(v.writePattern==='custom')v.writePattern='actual';
   if(!PAPER_SIZES.some(p=>p.key===v.paper))v.paper='a4-portrait';
   if(!COLUMN_SCOPES.some(s=>s.key===v.columnScope))v.columnScope='all';
   v.borders=v.borders!==false;
   return v;
  }catch(_){return {...DEFAULTS}}
 }
 function savePref(p){
  try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(_){}
 }

 /* ---------- 印刷はプレビューを先に出す(§9.186) ----------
    以前は「印刷しますか？」＋チェック4つの確認から始まり、**紙を見る前に
    決めさせていた**。日付ごとに分けるか・実績欄を付けるか・完了も載せるかは、
    どれも「刷り上がりを見れば分かる」ことなので、聞く順番が逆だった
    （利用者の指示: いったん今の条件でプレビューを出して、必要なら
    設定を変える。変えた結果はその場で見せる）。

    ・押したら**すぐ今の条件の紙**が出る（設定は覚えてある）
    ・設定を触ると**その場で刷り上がりが変わる**（枚数もその場で出る）
    ・「印刷する」はプレビューで見たものをそのまま出す（組み直さない）

    紙の組み立ては`buildPages`/`splitToSheets`/`pageHtml`の既存の1本を
    そのまま使う。**プレビュー用の別の組み立てを作らないこと**——
    見たものと刷るものが食い違ったら、プレビューの意味が無い。 */
 async function open(){
  const view=WL.scheduleView;
  if(!view||typeof view.entries!=='function'){
   showToast&&showToast('印刷できません','作業スケジュールを開いてからお試しください',4000);return;
  }
  openPreview(view.equipment());
 }

 /* 刷る中身を集める。**全設備のときだけ**他の設備を読む(読んだものは
    プレビューを開いている間だけ覚える——チェックを入れ直すたびに
    共有DBへ取りに行くと、そのあいだ画面が固まる)。 */
 const otherEntries=new Map();
 async function collectPages(pref,onProgress){
  const view=WL.scheduleView;
  const opt={...pref};
  let pages=[];
  if(opt.allEquipment&&typeof view.fetchEntries==='function'){
   const names=view.equipmentNames();
   const here=view.equipment();
   for(const name of names){
    let entries=otherEntries.get(name);
    if(!entries){
     if(onProgress)onProgress(`${name} の予定を集めています…`);
     try{entries=await view.fetchEntries(name)}
     catch(e){
      showToast&&showToast('一部の設備を読めませんでした',`${name}: ${e.message}`,5000);
      continue;
     }
     otherEntries.set(name,entries);
    }
    if(name===here){
     /* いま開いている設備は成り代わる必要が無い(scStateがそのまま正しい)。 */
     pages=pages.concat(buildPages(name,entries,opt));
    }else{
     /* **紙の列は`timeline:<設備>`から引く**(§9.235)ので、成り代わる前に
        読んでおく(`WL.columnLayout`はターゲットごとのキャッシュなので、
        読み込みは1回だけで済む)。 */
     try{await WL.columnLayout.load('timeline:'+name)}catch(_){}
     const built=(typeof view.withEquipment==='function')
       ?await view.withEquipment(name,entries,()=>buildPages(name,entries,opt))
       :buildPages(name,entries,opt);
     pages=pages.concat(built);
    }
   }
  }else{
   pages=pages.concat(buildPages(view.equipment(),view.entries(),opt));
  }
  return pages;
 }

 /* ---------- プレビューの画面 ----------
    左に決めること、右に刷り上がり。並びは実際にする順(何を載せる→用紙→
    枚数の確認→印刷)。 */
 const PREVIEW_ID='schedulePrintPreview';
 let pv={equipment:'',pref:null,sheets:[],busy:false,again:false};

 function ensurePreview(){
  let el=document.getElementById(PREVIEW_ID);
  if(el)return el;
  el=document.createElement('div');
  el.className='sp-preview';el.id=PREVIEW_ID;el.hidden=true;
  el.innerHTML=`
   <div class="sp-pv-box" role="dialog" aria-modal="true" aria-labelledby="spPvTitle">
    <header class="sp-pv-head">
     <div><span class="sp-pv-eyebrow">PRINT PREVIEW</span>
      <h2 id="spPvTitle">作業予定表</h2>
      <small id="spPvSub"></small></div>
     <button type="button" id="spPvClose" title="閉じる（刷りません）">×</button>
    </header>
    <div class="sp-pv-body">
     <aside class="sp-pv-side">
      <section class="sp-pv-sec">
       <h3>① 何を載せるか</h3>
       <div class="sp-options" id="spPvOptions"></div>
      </section>
      <section class="sp-pv-sec">
       <h3>② 用紙</h3>
       <div class="sp-pats" id="spPvSize"></div>
      </section>
      <section class="sp-pv-sec">
       <h3>③ 刷り上がり</h3>
       <p class="sp-pv-facts" id="spPvFacts"></p>
      </section>
     </aside>
     <div class="sp-pv-paper" id="spPvPaper"></div>
    </div>
    <footer class="sp-pv-foot">
     <span class="sp-pv-hint">設定を変えると、右のプレビューがその場で変わります。</span>
     <button type="button" id="spPvCancel">閉じる</button>
     <button type="button" class="sp-pv-print" id="spPvPrint">印刷する</button>
    </footer>
   </div>`;
  document.body.appendChild(el);
  el.querySelector('#spPvClose').onclick=closePreview;
  el.querySelector('#spPvCancel').onclick=closePreview;
  el.querySelector('#spPvPrint').onclick=doPrint;
  /* **背景クリックでは閉じない**（§9.221 ①）。刷る前の設定を触っている
     最中に外を押して消えると、選び直しからやり直しになる。閉じるのは
     ×／キャンセル／Escの3つ。 */
  WL.modal.keepOpen(el);
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!el.hidden){e.stopPropagation();closePreview()}
  },true);
  return el;
 }
 function optionRows(pref,canAll){
  const cb=(k,label,note)=>`<label class="sp-opt"><input type="checkbox" data-opt="${k}"${pref[k]?' checked':''}>
   <span><b>${esc(label)}</b>${note?`<small>${esc(note)}</small>`:''}</span></label>`;
  /* 「まとめ」は画面で選んでいるものをそのまま使う。**いま何でまとめて
     いるかを書く**——「まとめない」ときに設定だけ出ていると、押しても
     何も変わらないことになる。 */
  const gm=(typeof WL.scheduleView?.groupModeLabel==='function')?WL.scheduleView.groupModeLabel():'';
  const grouped=(typeof WL.scheduleView?.groupMode==='function')&&WL.scheduleView.groupMode()!=='none';
  /* **記入欄はパターンから選ぶ**(§9.191)。チェックの寄せ集めだと
     「開始だけ欲しい」「備考だけ」を作るのに何回も試すことになる。 */
  const cur=writePatternOf(pref);
  const patRows=WRITE_PATTERNS.map(p=>`<label class="sp-pat${cur===p.key?' is-on':''}" title="${esc(p.note)}">
     <input type="radio" name="spWritePattern" value="${p.key}"${cur===p.key?' checked':''}>
     <span><b>${esc(p.label)}</b><small>${esc(p.note)}</small></span></label>`).join('');
  /* 列の範囲(§9.236、利用者の指示「見える範囲の列か、全ての列かを選べる
     ように」)。用紙サイズと同じ`.sp-pat`の見せ方を使い回す。 */
  const scopeCur=columnScopeOf(pref);
  const scopeRows=COLUMN_SCOPES.map(s=>`<label class="sp-pat${scopeCur===s.key?' is-on':''}" title="${esc(s.note)}">
     <input type="radio" name="spColumnScope" value="${s.key}"${scopeCur===s.key?' checked':''}>
     <span><b>${esc(s.label)}</b><small>${esc(s.note)}</small></span></label>`).join('');
  return `<div class="sp-opt-group"><h4>載せるもの</h4>
   ${canAll?cb('allEquipment','すべての設備を続けて印刷する','設備ごとにページを分けます'):''}
   ${cb('includeDone','完了・取消も載せる','ふだんは載せません（これから流すものだけ配るため）')}
   ${cb('includeChildren','分割後の子ロットの情報も載せる（§9.235）','親の下に「└ 子ロット番号・幅・条数・公差」を差し込みます')}
   ${grouped?cb('useGroups',`画面のまとめ（${gm}）で見出しを入れる`,'画面と同じまとまりで区切ります')
            :`<p class="sp-opt-note">画面は「まとめない」なので、紙にも見出しは入りません。</p>`}
   ${cb('pageByDate','日付ごとにページを分ける','日ごとに配る場合はこのまま')}
  </div>
  <div class="sp-opt-group"><h4>列の範囲（§9.236）</h4>
   <div class="sp-pats" id="spColumnScope">${scopeRows}</div>
  </div>
  <div class="sp-opt-group"><h4>見た目</h4>
   ${cb('borders','枠線（表の格子）を出す',
        '外すと格子を消して、画面のようなさわやかな見た目になります（見出し・まとまりの帯と、記入欄の下線は残ります）')}
  </div>
  <div class="sp-opt-group"><h4>書き込む欄</h4>
   <div class="sp-pats" id="spWritePatterns">${patRows}</div>
   ${cb('commentBox','紙の下に「申し送り・気付き」の欄をつける','行ごとではなく、紙1枚に1つの欄です')}
  </div>`;
 }
 /* 用紙サイズ・向きの選択肢(§9.235、利用者の指示)。既存の「書き込む欄」と
   同じ`.sp-pat`の見せ方を使い回す(選んだものが面で分かる)。 */
 function paperSizeRows(pref){
  const cur=PAPER_SIZES.some(p=>p.key===pref.paper)?pref.paper:'a4-portrait';
  return PAPER_SIZES.map(p=>`<label class="sp-pat${cur===p.key?' is-on':''}">
     <input type="radio" name="spPaperSize" value="${p.key}"${cur===p.key?' checked':''}>
     <span><b>${esc(p.label)}</b><small>${p.w}×${p.h}mm</small></span></label>`).join('');
 }
 function openPreview(equipment){
  const view=WL.scheduleView;
  const canAll=typeof view.equipmentNames==='function'&&view.equipmentNames().length>1;
  const pref=loadPref();
  if(!canAll)pref.allEquipment=false;
  pv={equipment:String(equipment||''),pref,sheets:[],busy:false,again:false};
  otherEntries.clear();
  const el=ensurePreview();
  el.querySelector('#spPvTitle').textContent=`作業予定表${pv.equipment?`（${pv.equipment}）`:''}`;
  el.querySelector('#spPvSub').textContent='いま画面に出ている条件（表示範囲・列の並び）のまま刷ります';
  const box=el.querySelector('#spPvOptions');
  box.innerHTML=optionRows(pref,canAll);
  /* **clickで受ける**（changeはclickの後に飛ぶ。§9.90と同じ理由）。 */
  box.querySelectorAll('[data-opt]').forEach(inp=>inp.onclick=()=>{
   pv.pref[inp.dataset.opt]=!!inp.checked;savePref(pv.pref);renderPreview();
  });
  /* 列の範囲(§9.236)。**選んだらその場で刷り上がりが変わる**（同じ作法）。 */
  box.querySelectorAll('input[name="spColumnScope"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.columnScope=inp.value;savePref(pv.pref);
   box.querySelectorAll('#spColumnScope .sp-pat').forEach(l=>l.classList.toggle('is-on',
     l.querySelector('input')&&l.querySelector('input').value===inp.value));
   renderPreview();
  });
  /* 記入欄のパターン(§9.191)。**選んだらその場で刷り上がりが変わる**。 */
  box.querySelectorAll('input[name="spWritePattern"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.writePattern=inp.value;
   /* 古い設定とも辻褄を合わせる（他の画面が actualColumns を見ている）。 */
   pv.pref.actualColumns=inp.value!=='none';
   savePref(pv.pref);
   /* **`#spWritePatterns`の中だけ**を見る——`box`には他の`.sp-pat`群
      （列の範囲。§9.236で増えた）も同居しており、絞らずに探すとそちらの
      選択表示まで巻き添えで消える。 */
   box.querySelectorAll('#spWritePatterns .sp-pat').forEach(l=>l.classList.toggle('is-on',
     l.querySelector('input')&&l.querySelector('input').value===inp.value));
   renderPreview();
  });
  /* 用紙サイズ(§9.235)。**選んだらその場で刷り上がりが変わる**（同じ作法）。 */
  const sizeBox=el.querySelector('#spPvSize');
  sizeBox.innerHTML=paperSizeRows(pref);
  sizeBox.querySelectorAll('input[name="spPaperSize"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.paper=inp.value;savePref(pv.pref);
   sizeBox.querySelectorAll('.sp-pat').forEach(l=>l.classList.toggle('is-on',
     l.querySelector('input')&&l.querySelector('input').value===inp.value));
   renderPreview();
  });
  el.hidden=false;
  renderPreview();
  requestAnimationFrame(()=>el.querySelector('#spPvPrint')?.focus());
 }
 function closePreview(){
  const el=document.getElementById(PREVIEW_ID);if(el)el.hidden=true;
 }
 /* 実寸(用紙のmm×mm)を器へ収める倍率。**紙の寸法はmmのまま**にして
    見た目だけ縮める(§9.115の「用紙はmm」を崩さない)。
    **高さも見る**のが要点——幅だけで合わせると1枚が縦に切れ、
    「配る紙が1枚に収まっているか」というプレビューの一番の用が果たせない
    （下が見えないので、溢れているのかどうかが分からない）。 */
 function fitZoom(box){
  const probe=box.querySelector('.sp-page');
  /* **`offsetWidth`で測る。** `getBoundingClientRect()`は`transform`を
     掛けたあとの見かけの寸法を返すので、前回の倍率が掛かった値を基準に
     してしまう（回を重ねるほど縮む）。 */
  const w=probe?probe.offsetWidth:0,h=probe?probe.offsetHeight:0;
  if(!w||!h)return 1;
  const roomW=box.clientWidth-24,roomH=box.clientHeight-56;   // 余白と枚数の見出しぶん
  if(roomW<=0||roomH<=0)return 1;
  return Math.min(1,Math.max(.3,Math.min(roomW/w,roomH/h)));
 }
 async function renderPreview(){
  const el=document.getElementById(PREVIEW_ID);if(!el||el.hidden)return;
  /* 続けて押されたときは**最後の1回だけ**組む(チェックを続けて触ると
     組み立てが重なる)。 */
  if(pv.busy){pv.again=true;return}
  pv.busy=true;
  const paper=el.querySelector('#spPvPaper'),facts=el.querySelector('#spPvFacts');
  try{
   let pages=await collectPages(pv.pref,msg=>{
    paper.innerHTML=`<p class="sp-pv-wait">${esc(msg)}</p>`;
   });
   if(!pages.length||pages.every(p=>!p.rows.length)){
    pv.sheets=[];
    paper.innerHTML=`<p class="sp-pv-empty">${esc(pv.pref.includeDone
      ?'この設備に予定がありません。':'これから流す予定がありません。')}</p>`
     +(pv.pref.includeDone?'':'<p class="sp-pv-empty-how">「完了・取消も載せる」を入れると過去分も出せます。</p>');
    facts.innerHTML='<b>0枚</b>';
    el.querySelector('#spPvPrint').disabled=true;
    return;
   }
   const sheets=splitToSheets(pages,pv.pref);
   pv.sheets=sheets;
   el.querySelector('#spPvPrint').disabled=false;
   paper.innerHTML=sheets.map((p,i)=>
    `<figure class="sp-pv-sheet"><figcaption>${i+1} / ${sheets.length}${
      p.equipment&&pv.pref.allEquipment?`　${esc(p.equipment)}`:''}</figcaption>
     <div class="sp-pv-scale">${pageHtml(p,pv.pref,i+1,sheets.length)}</div></figure>`).join('');
   /* 倍率は**描いてから測って**決める(mm指定の実寸はブラウザに聞くしかない)。 */
   const zoom=fitZoom(paper);
   paper.style.setProperty('--sp-zoom',String(Math.round(zoom*1000)/1000));
   paper.querySelectorAll('.sp-pv-scale').forEach(box=>{
    const pg=box.querySelector('.sp-page');
    if(!pg)return;
    /* 縮めた分だけ器も縮める(transformは場所を空けてくれない)。
       **`offsetWidth`で測ること**——`getBoundingClientRect()`は倍率を
       掛けたあとの寸法なので、そこへもう一度掛けると器が小さくなり、
       紙の右側が切り落とされる(実際に切れた)。 */
    box.style.width=Math.round(pg.offsetWidth*zoom)+'px';
    box.style.height=Math.round(pg.offsetHeight*zoom)+'px';
   });
   const rows=sheets.reduce((n,p)=>n+((p.rows||[]).length),0);
   const eqs=new Set(sheets.map(p=>p.equipment).filter(Boolean));
   const size=paperSizeOf(pv.pref.paper);
   /* ---------- 列幅が設定どおりか、詰めたのかを言う(§9.237) ----------
      利用者は画面で「折り返さない幅」に整えてから刷る。用紙に収まらずに
      詰めたのなら**そう書く**（§4／§6）——黙って縮めると「設定が効いて
      いない」としか読めない。**刷り上がりから読む**ので、成り代わりで
      刷った他の設備ぶんも含めて本当の値になる。 */
   const fits=[...paper.querySelectorAll('.sp-page')]
    .map(p=>parseFloat(p.style.getPropertyValue('--sp-fit'))||1);
   const minFit=fits.length?Math.min(1,...fits):1;
   facts.innerHTML=`<b>${sheets.length}枚</b>・${rows}件・${esc(size.label)}`
    +(eqs.size>1?`・${eqs.size}台ぶん`:'')
    +`・列幅 ${minFit>=1?'設定どおり':`${Math.round(minFit*100)}%に縮小`}`
    +`<small>実寸の ${Math.round(zoom*100)}% で表示しています`
    +(minFit>=1?''
      :`／用紙に収めるため列と文字を詰めています。設定どおりの幅で刷るには、`
       +`用紙を大きく（A3・横）するか「見える範囲の列だけ」を選んでください。`)
    +`</small>`;
  }catch(e){
   paper.innerHTML=`<p class="sp-pv-empty">プレビューを作れませんでした: ${esc(e.message)}</p>`;
   pv.sheets=[];
  }finally{
   pv.busy=false;
   if(pv.again){pv.again=false;renderPreview()}
  }
 }
 /* 見たものをそのまま刷る。**組み直さない**——組み直すと、そのあいだに
    画面が変わっていた場合にプレビューと違う紙が出る。 */
 function doPrint(){
  if(!pv.sheets.length){showToast&&showToast('刷るものがありません','',3000);return}
  const el=document.getElementById(PREVIEW_ID);if(el)el.hidden=true;
  printPages(pv.sheets,pv.pref,`作業予定表_${pv.sheets[0].equipment||''}`);
 }

 window.WL=window.WL||{};
 WL.schedulePrint={open,buildPages,splitToSheets,pageHtml,
                   printColumns,paperSizes:()=>PAPER_SIZES.map(p=>({...p})),
                   /* 書き込む欄のパターン(§9.191)。名前と並びは画面の文言と
                      同じものを1箇所から出す（テストも同じ表を見る）。 */
                   writePatterns:()=>WRITE_PATTERNS.map(p=>({...p})),
                   /* 列の範囲(§9.236)。名前と並びは画面の文言と同じものを
                      1箇所から出す（テストも同じ表を見る）。 */
                   columnScopes:()=>COLUMN_SCOPES.map(s=>({...s})),
                   /* プレビューは**中身を見て確かめられる**ようにしておく
                      （テストが「何枚になったか」を画面から読むため）。 */
                   openPreview,closePreview,previewSheets:()=>pv.sheets.slice()};
})();
