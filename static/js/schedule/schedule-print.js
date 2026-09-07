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

 /* ---------- 用紙(§9.235 ②／§9.252) ----------
    §9.235 ②（利用者の指示「印刷サイズA4だけでなくA3や縦向きや横向きも
    選べるようにしてください」）で用紙を選べるようにしたが、**大きさと向きを
    1つの選択肢に掛け合わせて**並べていた（A4縦／A4横／A3縦／A3横）。
    利用者の指示（§9.252）:

      「作業スケジュール表の用紙設定と縦横選択を分けて、わかりやすくまとめ直し
       用紙選択はB4も追加してください」

    **掛け算で並べない。** 大きさと向きは**別々に決めること**で、選択肢は
    足し算（3＋2＝5）で済む。掛け合わせると用紙を1つ足すたびに札が2枚増え、
    B4を足した時点で8枚を読み比べることになる。決める順も「まず大きさ→
    次に向き」で、実際に決める順番と画面の並びが一致する（§CLAUDE 14）。

    **持つのは今までどおり1つの鍵**（`<大きさ>-<向き>`）。2つに割って保存すると
    「大きさだけ保存されて向きが古い」という食い違いが作れるうえ、
    `data-paper`・CSS・保存済みの設定が全部この綴りに乗っている。
    画面が2つに見えるのと、保存が1つなのは矛盾しない（§9.242 ⑤の
    「値は隠し欄が持つ」と同じ）。

    **余白は四辺とも同じ8mm**（既存のA4と揃える）。 */
 /* ---------- 用紙（§9.332で共通核へ集約） ----------
    表も`@page`の作り方も`WL.paper`の1箇所（`print-core.js`）。ここが持つのは
    **この紙の既定**（A4縦＝並びの先頭）と、**この画面の`<style>`のid**だけ。
    以前は同じ表と同じ関数が操業データ表にも並んでおり、§9.252で
    「片方だけ直さないこと」と注意書きを足すしかなかった。 */
 const PAPER_KINDS=WL.paper.KINDS;
 const PAPER_ORIENTS=WL.paper.orients({orientFirst:'portrait'});
 const PAPER_SIZES=WL.paper.sizes({orientFirst:'portrait'});
 const PAPER_MARGIN_MM=WL.paper.MARGIN_MM;
 const PAGE_STYLE_ID='scPrintPageSizeStyle';
 function paperSizeOf(key){return WL.paper.sizeOf(key,PAPER_SIZES)}
 function paperUsableMm(key){return WL.paper.usableMm(key,PAPER_SIZES)}
 function paperKeyWith(cur,part){return WL.paper.keyWith(cur,part,PAPER_SIZES)}
 function pageRuleFor(paperKey){return WL.paper.pageRule(paperKey,PAPER_SIZES)}

 /* ---------- 印刷する中身を組み立てる ----------
    entriesは画面が持っているものをそのまま受け取る(紙のために取り直さない
    ——取り直すと画面と紙で件数が食い違い、どちらが正か分からなくなる)。 */
 function buildPages(equipment,entries,opt){
  const view=WL.scheduleView;
  /* **画面で開いている親**（§9.357）。紙は画面の見た目が正（§9.237）なので、
     開いている子ロットは何も選ばなくても出す。1回だけ引いて使い回す。 */
  const openParents=new Set((typeof view?.childOpenIds==='function'?view.childOpenIds():[])||[]);
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
   /* **日付は常に数えておく**（§9.295 ②）——「区切りの行間」は日付が
      変わる行に効くので、日付ごとにページを分けない紙でも要る。
      数え方は**紙のページ分けと同じ`workDayKey()`**（別に数えると
      「区切りの空きは入ったのに、その行は前の日の紙に載る」が起きる・
      §9.115／§9.197）。 */
   const dayKey=workDayKey(e,start);
   const key=opt.pageByDate?dayKey:'';
   if(!index.has(key)){const g={key,label:dayLabel(key),rows:[]};index.set(key,g);groups.push(g)}
   let group=null;
   if(grouping){try{group=view.groupOf(e)}catch(_){group=null}}
   /* **印刷向けのセル文字列・子ロットの内訳はここで解いて持たせる**
      (§9.235)。他の設備ぶんを成り代わって解いているとき(`withEquipment`)
      にしか正しく引けないので、`pageHtml`側で遅延評価すると値が食い違う
      （成り代わりは同期のあいだしか続かない）。 */
   const cells=(typeof view.printRowCells==='function')?view.printRowCells(e):[];
   const allKids=(typeof view.childrenOf==='function')?(view.childrenOf(e.id)||[]):[];
   /* **画面で開いている子ロットは、何も選ばなくても紙に出る**（§9.357、利用者の
      指摘「子ロット情報が展開状態でも印刷一覧にのってこない」）。紙は画面の
      見た目が正（§9.237）。以前は `includeChildren` だけで決めており、画面で
      開いていても既定（切）のままだと**紙にだけ出ない**——同じ画面を見ている
      つもりで、刷ると中身が違った。
      設定を入れると**畳んでいるぶんも含めて全部**出す。 */
   const kids=opt.includeChildren?allKids:allKids.filter(()=>openParents.has(String(e.id)));
   /* 行の見せ方（行表示マスタ。§9.198）も紙へ運ぶ（§9.237）——画面で色を
      付けた区分・停止分類が、紙では真っ白では「画面の見た目そのまま」に
      ならない。**判定は画面の1箇所**（`rowStyleOf`）を呼ぶだけ。 */
   let rowStyle=null;
   if(typeof view.rowStyleOf==='function'){try{rowStyle=view.rowStyleOf(e)}catch(_){rowStyle=null}}
   /* 子ロットの件数は**内訳を載せるかどうかとは別**（§9.237）。画面は
      ロット番号のお尻に「子N」の印を出しているので、紙でも出す。 */
   /* 作業以外の行の題名（§9.294 ①）。**紙は内容の列を束ねてここへ置く**
      ので、どの列が残ったかに関わらず読める1つの文字列として持つ。 */
   const nonWorkTitle=(e.kind!=='作業'&&typeof view.nonWorkTitle==='function')
     ?String(view.nonWorkTitle(e)||''):'';
   /* 題名の横の（所要時間）（§9.295 ④）。**出すかどうかも画面が答える**
      ——紙で判定をやり直さない（§9.163）。 */
   const nonWorkTime=(nonWorkTitle&&typeof view.nonWorkTime==='function')
     ?String(view.nonWorkTime(e)||''):'';
   index.get(key).rows.push({e,start,end:useActual?e.actual.endAt:e.plannedEnd,group,cells,kids,
                             kidCount:allKids.length,rowStyle,nonWorkTitle,nonWorkTime,dayKey});
  });
  /* 紙の列は**1つの紙の中で変えない**ので、まとめて1回だけ決める。 */
  const cols=printColumns(opt);
  /* 列の幅を文字から決めるための実測（§9.294 ④）。**1回の印刷で1つの答え**
     ——紙ごとに測ると、同じ日の2枚目で列幅が変わって別の表に見える。
     測れなければ`null`＝画面の幅へ倒す（fail-open）。 */
  let textMm=null;
  if(colFitOf(opt)==='text'){
   const all=[];groups.forEach(g=>g.rows.forEach(r=>all.push(r)));
   try{textMm=measureColsMm(cols,all,opt)}catch(_){textMm=null}
  }
  return groups.map(g=>({
   cols,textMm,
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
 /* ---------- 印刷範囲(§9.292 ①、利用者の指示「スケジュール印刷範囲の指定が
    できるようにしてください」) ----------
    §9.291 ②で稼働カレンダーが足りなくなったら伸びるようにしたので、予定は
    何ヶ月先まででも並ぶ。そのまま刷ると**紙が何十枚にもなる**——現場が
    配りたいのは「今日から3日ぶん」「この直ぶん」であって全部ではない。

    絞り方は3つで、**既定は`all`＝今までどおり全部**（設定を触っていない
    現場の刷り上がりを黙って変えない）:
      all    今の表示範囲ぜんぶ（既定）
      date   現場歴の日付で from〜to
      picked 画面で選んでいる予定だけ（§9.170／§9.177の`#scPickBar`）

    **日付は`workDayKey()`で数える**——紙のページ分けと同じ関数を通す。
    別に数えると「範囲は18日までなのに、18日の紙に19日の行が混じる」が
    起きる（§9.115・§9.197と同じ理由）。

    **日付の決まっていない予定は範囲に入れられない**（比べる値が無い）。
    落とすのは正しいが、**黙って落とさない**（§4）——何件はじいたかを
    その場に書く。 */
 const RANGE_MODES=[
  {key:'all',   label:'いまの表示範囲ぜんぶ',note:'画面に出ている予定をすべて刷ります（既定）'},
  {key:'date',  label:'日付で絞る',          note:'現場歴の日付で「この日から・この日まで」を決めます'},
  {key:'picked',label:'選んだ予定だけ',      note:'一覧のチェックで選んでいる予定だけを刷ります'},
 ];
 const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
 function rangeOf(opt){
  const k=String(opt&&opt.range||'');
  return RANGE_MODES.some(r=>r.key===k)?k:'all';
 }
 /* 画面が選んでいる予定のid（文字列）。**`scState`を直に覗かない**——
    選べる行の条件（未着手の親だけ）は画面の1箇所が持っている。 */
 function pickedIdSet(){
  const view=WL.scheduleView;
  let ids=[];
  try{if(typeof view?.pickedIds==='function')ids=view.pickedIds()||[]}catch(_){ids=[]}
  return new Set(ids.map(String));
 }
 /* 1件の予定が乗る「現場歴の日付」。**buildPages と同じ取り方**（実績が
    あればその開始、無ければ予定の開始）。 */
 function entryDayKey(e){
  const useActual=(e.state==='完了'||e.state==='着手')&&e.actual&&e.actual.startAt;
  return workDayKey(e,useActual?e.actual.startAt:e.plannedStart);
 }
 /* 印刷範囲を当てる。**親を絞り、残った親の子だけを残す**——子だけを
    落とすと内訳が消え、子だけを残すと親の無い行が紙に出る。
    `isCurrent`＝いま画面で開いている設備か（「選んだ予定だけ」はこの端末が
    開いている設備の選択なので、他の設備には当てられない）。 */
 function applyRange(entries,opt,isCurrent){
  const list=entries||[];
  const mode=rangeOf(opt);
  if(mode==='all')return list.slice();
  let keep;
  if(mode==='picked'){
   if(!isCurrent)return [];
   const set=pickedIdSet();
   keep=e=>set.has(String(e.id));
  }else{
   const from=String(opt&&opt.dateFrom||''),to=String(opt&&opt.dateTo||'');
   keep=e=>{
    const k=entryDayKey(e);
    if(!k)return false;                       // 日付未定は範囲に入れられない
    if(from&&k<from)return false;
    if(to&&k>to)return false;
    return true;
   };
  }
  const alive=new Set();
  list.forEach(e=>{if(e.parentId==null&&keep(e))alive.add(String(e.id))});
  return list.filter(e=>e.parentId==null?alive.has(String(e.id)):alive.has(String(e.parentId)));
 }

 const COLUMN_SCOPES=[
  {key:'all',    label:'すべての列',      note:'横スクロールしないと見えない列も含めて全部載せます（既定）'},
  {key:'visible',label:'見える範囲の列だけ',note:'いま画面をスクロールせずに見えている列だけを、画面に近い余白で載せます'},
 ];
 function columnScopeOf(opt){
  const k=String(opt&&opt.columnScope||'');
  return COLUMN_SCOPES.some(s=>s.key===k)?k:'all';
 }
 /* 印刷専用の列（§9.293 ①、利用者の報告「作業スケジュールの表示内容と
    印刷内容が違います。設定は今の表示内容全部にしていますが、表示して
    いない内容まで出ています」）。

    §9.235で「#」「状態」を紙にだけ足していた（通し番号は現場が番号で
    呼び合うため、状態は白黒コピーで色分けが消えるため）。**理由はいまも
    正しいが、既定で足すのは間違いだった**——「画面の見た目が正」（§9.237）
    と言いながら、画面に無い列を黙って2本増やしていた。しかも列が2本
    増えるぶん他の列が痩せるので、**文字の大きさの見当も付かなくなる**
    （まさにそう報告された）。

    いまは**入切できる設定**で、**既定は「足さない」＝画面と同じ**。
    足したい現場はチェック1つで戻せる（何が増えるのかを説明に書く）。 */
 const PRINT_EXTRA_COLS=[{key:'no',label:'#',w:30},{key:'state',label:'状態',w:50}];
 function printColumns(opt){
  const view=WL.scheduleView;
  const visible=columnScopeOf(opt)==='visible';
  const keys=visible&&typeof view.visibleColumnKeys==='function'?view.visibleColumnKeys()
    :(typeof view.printColumnKeys==='function'?view.printColumnKeys():[]);
  const base=[...(opt&&opt.printExtras?PRINT_EXTRA_COLS.map(c=>({...c})):[]),
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
 const MM_PER_PX=WL.paper.MM_PER_PX;
 /* 縮めるときは**文字も一緒に縮める**（§9.237、利用者の指摘「列の折り返しを
    無くした形で列を整えても印刷側できちんと反映されない」）。
    幅だけを比率で詰めると、同じ文字が狭い箱に入らなくなって折り返し
    （実機で見出し「用途コード」が2行になっていた）か切り落としになる。
    幅と文字を同じ比率で縮めれば、**画面で決めた「この列に何文字入るか」が
    紙でもそのまま**になる。下限を切ったら（読めない大きさになるなら）
    そこで止めて、収まらないことをプレビューに文字で出す（§4）。 */
 const MIN_FIT=.62;
 /* ---------- 文字は枠いっぱいまで大きく（§9.292 ⑥、利用者の指示） ----------
    「作業スケジュールの印刷において、枠に対して文字が小さすぎて非常に
     見にくいです。カラムも含めて、枠のサイズに対してはみ出さない程度に
     文字サイズをできるだけぎりぎりまで大きくしたいです。ベースサイズを
     大きめの設定で変更したうえで、印刷時の文字サイズやセル内の余白の
     調整＆設定保存ができるようにしてください」

    §9.236の「収まるならそのまま使う」は**撤回した**——列の少ない設備では
    紙の右に何十mmも余り、そのぶん文字が小さいままだった。いまは
    **余っているぶんだけ幅も文字も一緒に大きくする**（縮めるときと同じ比率で、
    向きが逆になっただけ）。**幅と文字を必ず同じ比率で動かすこと**——
    片方だけ動かすと「画面で決めたこの列に何文字入るか」が紙で変わる
    （§9.237で縮める側について決めたのと同じ理由）。
    **上限を置く**（`MAX_FIT`）——1列しか出さない紙で文字だけが巨大になる。 */
 /* **上限は「1〜2列しか刷らない紙で字だけ巨大にならない」ための歯止め**で、
    ふつうは`room`（紙の余り）が先に効く。利用者の指示「おじいちゃんも見るので、
    文字はもっと限界まで大きくしてほしい。バキバキの限界まで、文字どうしが
    ぶつかったり隣のカラムの文字と被ったりしないところを限界として」
    （§9.293 ④）を受けて 1.35 → 2.6（本文 12.5px → 32.5px 相当）へ広げた。
    **列どうしの比は変わらない**ので、大きくしても隣の列の文字とは被らない
    （はみ出した文字は列の中で切られる）。 */
 const MAX_FIT=2.6;
 /* 利用者が選ぶ文字の大きさ。`auto`＝枠いっぱいまで（既定）。
    **綴りと呼び名は1箇所**（テストも画面もここを見る）。 */
 const FONT_SCALES=[
  {key:'auto',label:'自動（枠いっぱい）',note:'紙の余りぶんだけ、幅と文字を一緒に大きくします。列の文字は切れません（既定）'},
  {key:'0.85',label:'小',  note:'1枚により多くの行を載せたいとき'},
  {key:'1',   label:'標準',note:'画面と同じ大きさの比率で刷ります'},
  {key:'1.15',label:'大',  note:'少し大きめ'},
  {key:'1.3', label:'特大',note:'かなり大きめ'},
  {key:'1.7', label:'極大',note:'遠目でも読める大きさ。列が窮屈だと長い値は「…」で切れます'},
  {key:'2.2', label:'最大',note:'いちばん大きく。列の数が少ない紙向き'},
 ];
 /* ---------- セルの余白は「上下」と「左右」で別の軸（§9.294 ②、利用者の指示
    「セルの余白は上下だけでなく左右を分けてもう少し調整できるようにしたうえで、
     特に左右を詰められるようにしたいです。左右の余白は、今の設定で言う
     『詰める』が標準にしたいです」） ----------
    §9.292 ⑥で足した`cellPad`は**1つの値で上下と左右を同時に動かして**いた。
    ところが2つは打つ手が正反対で——**左右**を詰めると空いたぶんが文字の
    大きさへ回る（列の必要量が減る＝`withMm`の`room`が増える）が、**上下**を
    詰めると行が薄くなるだけで文字は1pxも大きくならない。1つの軸だと
    「文字を大きくしたいので詰めたら、行間まで詰まって読みにくくなった」に
    なる（利用者の理想が「詰める＋大」で止まっていたのはこの形）。 */
 /* 行間（上下）。**既定は標準**——ロットの並びは詰めない（利用者の指示）。 */
 const PAD_YS=[
  {key:'0.6',label:'詰める',note:'行が薄くなり、1枚により多く入ります'},
  {key:'1',   label:'標準',  note:'既定。ロットの並びはこの間隔です'},
  {key:'1.5', label:'広め',  note:'手で書き込む欄が広くなります'},
 ];
 /* 左右。**既定は「詰める」**（利用者の指示）——ここを詰めたぶんが
    そのまま文字の大きさへ回る（`withMm`が余白を列の必要量へ織り込む）。
    「最小」は「さらにタイトに」への答え（§9.294 ②）。 */
 const PAD_XS=[
  {key:'0.3',label:'最小',  note:'いちばん詰めます。文字を最大まで大きくしたいとき'},
  {key:'0.6',label:'詰める',note:'既定。文字と枠のあいだを詰めて、そのぶん文字を大きくします'},
  {key:'1',   label:'標準',  note:'画面と同じくらいの余白'},
  {key:'1.5', label:'広め',  note:'ゆったり'},
 ];
 /* 日付（まとまり）の切り替わりだけ空ける（§9.294 ③、利用者の指示
    「日付の切り替わりは、行間の余白のみ『広め』くらい空けたい」）。
    **行間とは別の軸**——ここが同じ値だと、区切りが「1行ぶん濃い帯」でしか
    分からない。既定は広め。 */
 const DAY_GAPS=[
  {key:'0.6',label:'詰める',note:'区切りも他の行と同じ薄さにします'},
  {key:'1',   label:'標準',  note:'他の行と同じ間隔'},
  {key:'1.5', label:'広め',  note:'既定。日付が変わったことが目で分かります'},
  {key:'2.2', label:'とても広め',note:'紙を折って配るときなど、はっきり切りたいとき'},
 ];
 /* ---------- 列の幅の決め方（§9.294 ④、利用者の指示「カラムの文字列は
    見切れないようにしたいのでカラム幅の自動調整機能も欲しいです」） ----------
    `screen`＝画面の実効px幅をそのまま使う（§9.236。今までの唯一の道）。
    `text`＝**実際に刷る文字を測って**、その列に要るぶんだけ配る。
    値が短い列（区分・条数）は痩せ、余ったぶんは`room`＝文字の倍率へ回る
    ——「見切れさせずに文字を大きくする」に効く唯一の外側の手立て。 */
 const COL_FITS=[
  {key:'text',  label:'文字に合わせる',note:'既定。見出しと値を実際に測って、切れない幅を配ります。余ったぶんは文字の大きさへ回ります'},
  {key:'screen',label:'画面のまま',    note:'画面で決めた列幅の比をそのまま紙へ写します'},
 ];
 function fontScaleOf(opt){
  const k=String(opt&&opt.fontScale||'');
  return FONT_SCALES.some(x=>x.key===k)?k:'auto';
 }
 /* **知らない綴りは既定へ倒す**（§9.204）。綴りと呼び名はここが1箇所。 */
 function padYOf(opt){
  const k=String(opt&&opt.padY||'');
  return PAD_YS.some(x=>x.key===k)?k:'1';
 }
 function padXOf(opt){
  const k=String(opt&&opt.padX||'');
  return PAD_XS.some(x=>x.key===k)?k:'0.6';
 }
 function dayGapOf(opt){
  const k=String(opt&&opt.dayGap||'');
  return DAY_GAPS.some(x=>x.key===k)?k:'1.5';
 }
 function colFitOf(opt){
  const k=String(opt&&opt.colFit||'');
  return COL_FITS.some(x=>x.key===k)?k:'text';
 }
 function boldOf(opt){return !!(opt&&opt.bold)}
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
 /* 下限のある比例配分と丸めは`WL.paper.shareMm()`の1箇所（§9.332）。
    「床に着いた列を固定して配り直す」も「端数は広い列から0.1mmずつ散らして
    引く」（§9.295）も、紙を出す3本で同じでなければならない。 */
 function shareMm(natural,usableMm){
  return WL.paper.shareMm(natural,usableMm,{min:MIN_COL_MM,step:0.1});
 }
 function trimRound(values,usableMm,floorMm){
  return WL.paper.trimRound(values,usableMm,
   floorMm!=null?floorMm:Math.min(MIN_COL_MM,usableMm/(values.length||1)),0.1);
 }

 /* ---------- 幅と文字は別の答え（§9.293 ②、利用者の報告「文字のサイズ変更
    機能は印刷で見てもプレビューで見ても全く変化しているように感じません」）
    ----------
    §9.292 ⑥では「幅も文字も同じ比率」で動かしたが、**幅は紙に必ず収める**
    という制約があるので、列の多い設備では比率が下限（`MIN_FIT`）に張り付き、
    **どの大きさを選んでも同じ絵**になっていた（実機の18列がまさにそれ）。
    「縮めています」と書いてはいたが、**選べるのに一度も効かない設定**は
    押しても何も起きないボタンと同じ（§4）。

    いまは2つの答えを返す:
      `fit`  … **幅**の倍率。紙に必ず収める（利用者は決められない）
      `font` … **文字**の倍率。`auto`なら`fit`と同じ（今までどおり幅なり）、
               大きさを選んでいれば**その値そのもの**

    文字が幅より大きいと、窮屈な列の値は「…」で切れる——**それは利用者が
    選んだこと**なので、切れる件数を数えて画面に出す（§3・§4）。切らずに
    折り返す道は採らない（§9.237で画面と同じ`nowrap`に決めた）。 */
 /* セルの左右の余白（mm）。**CSSの`1.4mm × --sp-pad`と同じ数**——ここと
    CSSが食い違うと、幅の見積もりが実際の刷り上がりとずれる（§9.163）。 */
 const CELL_PAD_MM=1.4;
 /* ---------- 列の幅を「実際に刷る文字」から決める（§9.294 ④、利用者の指示
    「カラムの文字列は見切れないようにしたいのでカラム幅の自動調整機能も
     欲しいです」） ----------
    画面の実効px幅（§9.237 ④b）は**画面で読むための幅**で、紙とは条件が違う
    ——画面は横スクロールできるので余裕を持たせてあるし、逆に狭く詰めた列は
    紙でも狭いまま。**紙は1行に全部を並べる**ので、値の短い列に画面ぶんの
    幅を配ると、そのぶん文字の倍率(`room`)が食われて全部が小さくなる。

    測るのは**見出しと、その紙に実際に出る値の最長**。`canvas`の
    `measureText`で、刷るのと同じ書体・同じ太さ・同じ地の大きさ（倍率1）で
    測る（§9.130の`fitControlWidths()`と同じ作法）。**倍率は掛けない**
    ——幅も文字も`fit`で一緒に伸縮するので、倍率1で測っておけば比が保たれる。

    **測れなければ画面の幅へ倒す**（fail-open）——`canvas`が使えない場面で
    紙が出なくなるほうが困る。 */
 /* ---------- 測るのは「実際に描いた表」（§9.294 ④） ----------
    最初は`canvas`の`measureText`で見積もっていたが、**ちょうどの幅では必ず
    どこかが足りなくなった**（実測: 切れるセルが14→46件）。書体の指定だけでは
    再現できない要素が多すぎる——`tabular-nums`（数字の列は等幅で広い）・
    札(`.sp-badge`)と印(`.sp-chip`)の余白と枠・暫定見積の斜体・「子N」の印・
    セルの余白と罫線。**紙と同じCSSで一度描いて、列ごとの実寸を読む**のが
    唯一ずれない答え（§9.237 ④b「実際に描かれている見出しを測る」と同じ）。

    描くのは`table-layout:auto; width:max-content`の写しなので、ブラウザが
    列ごとに「折り返さずに要る幅」を解いてくれる。**倍率は掛けない**
    （`--sp-fit`を書かない＝1。幅も文字も`fit`で一緒に動くので、地の大きさで
    測っておけば比が保たれる）。**セルの余白と太字は掛ける**（どちらも列の
    必要量を変える）。 */
 /* **実寸ちょうどでは切れる**——0.1mmへ丸める段・倍率を掛けたときの端数・
    札や印の枠（`border`はmm固定で倍率に追随しない）で、必ずどこかが
    足りなくなる。0.5mmの遊びを持たせる（0.3mmでは、札の入るセルが
    通しの実行で1件だけ切れた。これ以上取ると、余りを文字へ回すという
    目的が薄れる——16列で0.2mm増やすと本文が1.6%小さくなる）。 */
 const TEXT_SLACK_MM=0.5;
 let colMmCache={sig:'',val:null};
 function measureSig(cols,rows,opt){
  let n=0;(rows||[]).forEach(r=>((r&&r.cells)||[]).forEach(c=>{n+=(c.text||'').length}));
  return [cols.map(c=>c.key).join('\u0001'),padXOf(opt),boldOf(opt)?1:0,
          (rows||[]).length,n].join('|');
 }
 function measureColsMm(cols,rows,opt){
  if(!cols||!cols.length)return null;
  /* **同じ材料なら測り直さない**（§9.198）——設定を1つ触るたびに表を
     もう1枚描くことになる。 */
  const sig=measureSig(cols,rows,opt);
  if(colMmCache.sig===sig)return colMmCache.val;
  let area=null,keep='';
  try{
   area=ensureArea();
   keep=area.innerHTML;
   area.classList.add('is-measuring');
   const head=cols.map(c=>`<th class="${esc(fixedAlignClass(c.key))}">${esc(c.label||'')}</th>`).join('');
   /* 申し送り（行まるごと全幅）は列の幅を決めない。**作業以外の行は
      「束ねない形」で測る**（§9.296）——束ねた題名は列の幅を決めないが、
      **固定列（区分・日付・時刻…）は実際に刷られる**ので、行ごと外すと
      その列が痩せる（実測: 「設備停止」の札が入らず1セル切れた。「予定」より
      2文字長い）。題名だけ外して、残りはふつうの行として測る。 */
   const body=(rows||[]).filter(r=>!fullWidthTitle(r))
     .map((item,i)=>`<tr>${cellsOf(item.nonWorkTitle?{...item,nonWorkTitle:''}:item,i+1,cols)}</tr>`)
     .join('');
   area.innerHTML=`<section class="sp-page sp-measure-page"${boldOf(opt)?' data-bold="on"':''}`
     +` style="--sp-pad-x:${padXOf(opt)}"><div class="sp-table-wrap">`
     +`<table class="sp-table sp-measure">`
     +`<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div></section>`;
   const ths=[...area.querySelectorAll('.sp-measure thead th')];
   if(ths.length!==cols.length)return null;
   const out={};
   ths.forEach((th,i)=>{out[cols[i].key]=th.getBoundingClientRect().width*MM_PER_PX});
   colMmCache={sig,val:out};
   return out;
  }catch(_){return null}
  finally{if(area){area.innerHTML=keep;area.classList.remove('is-measuring')}}
 }
 function withMm(cols,usableMm,opt,textMm){
  const budget=Math.max(1,usableMm-FRAME_MM);
  /* **セルの余白は列の幅の一部**（§9.293 ④）。以前は幅を配ってから CSS が
     内側に余白を足していたので、「余白を詰める」を選んでも**文字は1pxも
     大きくならなかった**（空いた場所が誰にも配られない）。余白を列の
     必要量へ織り込むと、詰めたぶんがそのまま文字の大きさになる
     ——利用者の「限界まで大きく」に効く唯一の内側の手立て。
     **左右だけ**が幅に効く（§9.294 ②）——上下を詰めても文字は大きく
     ならないので、同じ軸にすると「詰めたのに変わらない」が作れる。 */
  const pad=Number(padXOf(opt))||1;
  const padDelta=2*CELL_PAD_MM*(pad-1);
  /* 文字に合わせるとき、1列が紙を食い尽くさないよう頭打ちにする
     （長い備考が1本あるだけで他の列が全部潰れる）。切れることは
     プレビューが数えて言う（§3）。 */
  const capMm=budget*0.42;
  const fitMode=colFitOf(opt);
  const natural=cols.map(c=>{
   /* **記入欄は測らない**（§9.294 ④）——空のまま刷って現場が手で書く場所
      なので、「文字に合わせる」と見出しの幅まで痩せて書けなくなる。 */
   /* 測った幅は**セルの余白と罫線を含む実寸**なので、そのまま使う
      （足し引きすると、測った意味が無くなる）。 */
   if(fitMode==='text'&&!c.write&&textMm&&textMm[c.key]!=null)
    return Math.max(MIN_COL_MM,Math.min(capMm,textMm[c.key]+TEXT_SLACK_MM));
   return Math.max(MIN_COL_MM,(c.w||60)*MM_PER_PX+padDelta);
  });
  const total=natural.reduce((s,w)=>s+w,0)||1;
  const want=fontScaleOf(opt);
  const room=budget/total;
  /* **幅**は「余っていれば上限まで広げ、足りなければ縮める」。
     `auto`以外を選んでいても、幅はその値までしか広げない（大きい文字を
     選んだからといって紙からはみ出させない）。 */
  const target=want==='auto'?MAX_FIT:Math.min(MAX_FIT,Number(want));
  const fit=Math.max(MIN_FIT,Math.min(target,room));
  const scaled=natural.map(w=>w*fit);
  const tot=scaled.reduce((s,w)=>s+w,0);
  /* **丸めの端数で`shareMm`へ落とさないこと**（§9.294 ④）——あちらは
     「下限つきの比例配分」なので、狭い列を`MIN_COL_MM`へ持ち上げたぶんを
     他の列から取る＝**文字と幅の比が崩れて切れる**。予算をわずかに超えた
     だけなら、いちばん広い列から削って丸めるだけでよい。 */
  const mm=tot<=budget+0.06?trimRound(scaled,budget):shareMm(scaled,budget);
  /* **文字**は利用者が決めた値をそのまま使う（幅の圧縮に引きずられない）。 */
  const font=want==='auto'?fit:Number(want);
  return {cols:cols.map((c,i)=>({...c,mm:mm[i]})),
          fit:Math.round(fit*1000)/1000,
          font:Math.round(font*1000)/1000,
          over:Math.round(Math.max(0,tot-budget)*10)/10};
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
    内側のキーは並べ替えても変わらないので、ここに書いても崩れない。

    **手で決めた揃えは紙にも効かせる**（§9.239 ④、利用者の指示「手動での
    任意変更もできるように」）。判定は`WL.columnAlign`の1箇所を通す
    ——画面で右にしたのに紙が中央、を作らない（§9.237「紙は画面の一覧の
    見た目が正」）。
    **既定だけは紙が別に持つ**（区分・日付・時刻・勤務・残りは紙では中央）
    ——紙は1行が細く列が多いので、画面と同じ左詰めだと升目に見える。
    設定していない列の刷り上がりは今までどおり。 */
 const FIXED_ALIGN_CENTER=new Set(['__cat__','__workable__','__date__','__caldate__','__time__','__shift__','__rel__']);
 const FIXED_ALIGN_RIGHT=new Set(['__est__','__actual__']);
 const SP_ALIGN_CLASS={left:'',center:'sp-al-c',right:'sp-al-r'};
 function fixedAlignClass(k){
  const t=(WL.scheduleView&&typeof WL.scheduleView.layoutTarget==='function')
    ? WL.scheduleView.layoutTarget() : '';
  if(t&&WL.columnLayout){
   const set=WL.columnLayout.align(t,k).data;
   if(set)return SP_ALIGN_CLASS[set]||'';
  }
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
  try{if(typeof WL.scheduleView.childBadgeMode==='function')mode=WL.scheduleView.childBadgeMode()}catch(_){WL.quiet.note('子の印の出し方を引けない（件数の形で出す）',_)}
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
 /* 申し送り(コメント)は**行まるごと横いっぱい**（§9.191）。他の作業以外の
    行（設備停止・枠）は、**内容の列だけを束ねて**題名を置く（§9.294 ①）
    ——日付・時刻・見積は停止そのものの事実なので残す。 */
 function fullWidthTitle(item){return !!(item&&item.e&&item.e.kind==='コメント')}
 /* 束ねる範囲は**実際に刷る列**から決める（§9.294 ①）。画面の並びで決めた
    束をそのまま使うと、「見える範囲の列だけ」で削られたときに範囲が
    紙の列とずれる。どれが内容の列かは**画面が答える**（`fixed`。§9.163）。 */
 function contentRunOf(item,cols){
  /* **「行いっぱい」も選べる**（§9.295）。紙では**記入欄を残す**
     ——空のまま刷って現場が手で書く場所なので、名前で潰さない。 */
  const place=String((item.rowStyle&&item.rowStyle.titlePlace)||'');
  if(place==='全幅'){
   const last=cols.reduce((n,c,i)=>c.write?n:i+1,0);
   if(last>0)return {at:0,span:last};
  }
  const map=new Map((item.cells||[]).map(c=>[c.key,c]));
  const isContent=c=>{const v=map.get(c.key);return !!v&&v.fixed===false};
  const at=cols.findIndex(isContent);
  if(at<0)return null;
  let span=1;
  while(at+span<cols.length&&isContent(cols[at+span]))span++;
  return {at,span};
 }
 function cellsOf(item,no,cols){
  const map=new Map((item.cells||[]).map(c=>[c.key,c]));
  const kidKey=item.kidCount?kidBadgeKey(cols):'';
  /* 作業以外の行は、内容の列をひとかたまりにして題名を置く（§9.294 ①）。 */
  const run=item.nonWorkTitle?contentRunOf(item,cols):null;
  return cols.map((c,ci)=>{
   if(run){
    if(ci===run.at){
     /* 見せ方・揃えは**画面と同じ答えを運ぶだけ**（§9.295）——紙で
        判定をやり直すと、画面と刷り上がりが食い違う（§9.163）。
        色は行に貼る`sc-rs-*`の`--rs-*`を読むので、紙のための色表を
        もう1つ作らない（§9.237 ⑥と同じ作法）。 */
     const look=String((item.rowStyle&&item.rowStyle.titleLook)||'');
     const align=String((item.rowStyle&&item.rowStyle.titleAlign)||'');
     const time=String(item.nonWorkTime||'');
     const body=esc(item.nonWorkTitle)+(time?`<span class="sp-nw-time">${esc(time)}</span>`:'');
     const inner=look?`<b class="sp-nw-face">${body}</b>`:body;
     return `<td class="sp-c-nonwork"${run.span>1?` colspan="${run.span}"`:''}`
      +(look?` data-nw-look="${esc(look)}"`:'')+(align?` data-nw-align="${esc(align)}"`:'')
      +` title="${esc(item.nonWorkTitle)}${esc(time)}">${inner}</td>`;
    }
    if(ci>run.at&&ci<run.at+run.span)return '';
   }
   return cellOne(item,no,cols,c,kidKey,map);
  }).join('');
 }
 /* セル1つ。**内容の列を束ねる判定とは分ける**——束ねるかどうかは行の話、
    ここは列の話（1つの関数に混ぜると分岐がもう一段深くなる）。 */
 function cellOne(item,no,cols,c,kidKey,map){
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
  const fitted=withMm(page.cols||printColumns(opt),paperUsableMm(opt.paper).w,opt,page.textMm);
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
  /* 日付の変わり目（§9.295 ②、利用者の報告「区切りの行間の余白は変更しても
     変化がない」）。§9.294 ③では**まとまりの帯にだけ**効かせていたが、
     帯が出るのは「まとめ」を日付にしているときだけで、**既定（まとめない・
     日付ごとにページを分ける）の紙には帯が1本も無い**——選べるのに一度も
     効かない設定になっていた（§4）。印は**行そのもの**に付ける。
     紙の1行目には付けない（紙の頭は区切りではない）。 */
  let lastDay=null;
  /* まとまりの見出しに添える「現場歴／太陽暦」（§9.237）。**紙の中で
     変わらない**ので1回だけ引く。 */
  let basisLabel='';
  try{if(typeof WL.scheduleView?.groupBasisLabel==='function')basisLabel=WL.scheduleView.groupBasisLabel()||''}catch(_){basisLabel=''}
  const body=page.rows.map((item,i)=>{
   const g=item.group;
   const day=String(item.dayKey||'');
   const dayStart=i>0&&day&&lastDay!==null&&day!==lastDay;
   if(day)lastDay=day;else if(lastDay===null)lastDay='';
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
   const dayCls=dayStart?' is-day-start':'';
   if(item.e.kind==='コメント'){
    return head2+`<tr class="sp-row-comment${dayCls}" data-row="${i}">`
   +`<td colspan="${head.length}"><b>申し送り</b> ${esc((item.e.title||'').trim())}</td></tr>`;
   }
   /* 行の地の色は**画面と同じクラス**（`sc-rs-<色>`）を貼る（§9.237）——
      色の定義（`--rs-fg`/`--rs-bg`/`--rs-line`）は行表示マスタの1箇所が
      持っているので、紙のためにもう1つ色表を作らない。 */
   const rsKey=item.rowStyle&&item.rowStyle.colorKey?String(item.rowStyle.colorKey):'';
   /* 題名を札／帯にした行は**地を塗らない**（§9.295。同じ色が2箇所に出ると
      どちらが印なのか読めなくなる）。画面と同じ印を貼るだけ。 */
   const nwFace=item.nonWorkTitle&&item.rowStyle&&item.rowStyle.titleLook?'sp-row-nw-face':'';
   const rowCls=[item.e.kind!=='作業'?'sp-row-stop':'',rsKey?'sc-rs-'+rsKey:'',nwFace,
                 dayStart?'is-day-start':''].filter(Boolean).join(' ');
   const mainRow=head2+`<tr class="${esc(rowCls)}" data-row="${i}">`
     +`${cellsOf(item,from+i,cols)}</tr>`;
   /* 子ロットの内訳(§9.235③)。**載せるかどうかは `buildPages` が決めて
      `item.kids` に入れてある**（画面で開いているぶん、または設定が入なら全部。
      §9.357）——ここで `includeChildren` をもう一度見ると、**決めた結果を
      出力側が握り潰す**（実際にそうなっていて、開いている子ロットが紙に
      出なかった）。**同じ判定を2箇所に置かない**（§CLAUDE 8）。 */
   const kidRows=(item.kids&&item.kids.length)
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
  /* 収まらないときは**文字も一緒に縮める**（§9.237）。余っているときは
     **一緒に大きくする**（§9.292 ⑥）。`--sp-fit`は
     `.sp-table`の中の文字サイズにだけ掛かる（用紙・余白はmmのまま）。 */
  /* セルの余白は文字とは別の軸（§9.292 ⑥）。**既定のときは書かない**
     ——書かない紙は今までと1pxも変わらない。 */
  const padY=padYOf(opt),padX=padXOf(opt),dayGap=dayGapOf(opt);
  /* `--sp-fit`は**文字**の倍率（§9.293 ②）。幅はもう mm へ入っている。
     余白は**上下と左右で別の変数**（§9.294 ②）——1つにすると「文字を
     大きくしたくて詰めたら行間まで詰まった」になる。**既定のときは
     書かない**ので、触っていない設定は今までどおりの見え方になる。 */
  const vars=[fitted.font!==1?`--sp-fit:${fitted.font}`:'',
              padY!=='1'?`--sp-pad-y:${padY}`:'',
              padX!=='1'?`--sp-pad-x:${padX}`:'',
              dayGap!=='1'?`--sp-pad-day:${dayGap}`:''].filter(Boolean);
  const fitVar=vars.length?` style="${vars.join(';')}"`:'';
  return `<section class="sp-page" data-paper="${esc(opt.paper||'a4-portrait')}"${
    opt.borders===false?' data-borders="off"':''}${boldOf(opt)?' data-bold="on"':''}${fitVar}>
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
  WL.printCore.printOnPage({
   area:ensureArea(),
   html:pages.map((p,i)=>pageHtml(p,opt,i+1,pages.length)).join(''),
   styleId:PAGE_STYLE_ID,paper:opt.paper,paperSizes:PAPER_SIZES,
   printClass:PRINT_CLASS,title:title});
 }

 /* ---------- 設定の段（§9.293 ③、利用者の指示「印刷のメニューがかなり
    複雑になってきたので、タブ、アコーディオン、ポップオーバーメニューなどを
    駆使して階層化しわかりやすく使いやすく改良再構築してほしい」） ----------
    §9.238 ④で「載せるもの／見せ方／用紙／刷り上がり」の4節へ分けたが、
    §9.292 ①⑥で印刷範囲・文字の大きさ・セルの余白が増え、**縦に積むと
    2画面ぶん**になった（目当ての設定を探すのに毎回スクロールする）。

    **決める理由で3つの段**にする。並びは実際にする順（何を刷る → どう
    見せる → どの紙に）で、**4つ目の「刷り上がり」は段にしない**
    ——枚数と「既定へ戻す」はどの段からでも読めるべきなので、段の外
    （足元）へ据える（§CLAUDE 8。同じことを段ごとに書かない）。

    **開いていた段を覚える**（毎回①から辿らせない）。段の見出しには
    **いまの値の一言**を出す（§9.250 ④。開かないと分からない段を作らない）。 */
 const PV_TABS=[
  {key:'load',label:'載せるもの',icon:'▤'},
  {key:'look',label:'見せ方',    icon:'✎'},
  {key:'paper',label:'用紙',     icon:'▭'},
 ];
 function pvTabOf(pref){
  const k=String(pref&&pref.tab||'');
  return PV_TABS.some(t=>t.key===k)?k:'load';
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
 /* zoomMode/zoomPct=プレビューの表示倍率(§9.238 ③)。**紙には効かない**
    ——見え方だけの設定だが、毎回選び直させないので同じ場所へ覚える。
    既定は今までの見え方（1枚がまるごと入る「全体」）。 */
 const DEFAULTS={includeDone:false,actualColumns:true,pageByDate:true,allEquipment:false,
                 useGroups:true,commentBox:true,writePattern:'actual',
                 includeChildren:false,paper:'a4-portrait',
                 columnScope:'all',borders:true,
                 /* 印刷範囲(§9.292 ①)。**既定は`all`＝今までどおり全部**。 */
                 range:'all',dateFrom:'',dateTo:'',
                 /* ---------- 紙の文字とセルの余白 ----------
                    **既定は「大」＋左右「詰める」＋列は文字に合わせる**
                    （§9.294 ⑤⑥、利用者の指示「文字サイズ『大』がベースに
                     したいです」「今の設定で最も理想に近いのが余白『詰める』
                     ＋文字サイズ『大』です」）。§9.292 ⑥の既定「自動（枠
                     いっぱい）」は撤回した——`auto`は**紙の余りで決まる**ので
                     設備や列数で刷り上がりが変わり、「いつもこの大きさ」に
                     できなかった。 */
                 fontScale:'1.15',padY:'1',padX:'0.6',dayGap:'1.5',
                 colFit:'text',bold:false,
                 /* 印刷専用の「#」「状態」の列(§9.293 ①)。**既定は足さない**
                    ＝画面と同じ列だけ（利用者の報告「表示していない内容まで
                    出ています」）。 */
                 printExtras:false,
                 /* 設定の段(§9.293 ③)。**開いていた段を覚える**——毎回
                    ①から辿らせない。 */
                 tab:'load',
                 zoomMode:'fit',zoomPct:100};
 function loadPref(){
  try{
   const v={...DEFAULTS,...(JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{})};
   /* 古い保存値の読み替え(§9.235)。'custom'は「紙の列で決めたまま」の
      意味だったが、紙だけの列選択が無くなったので既定へ倒す。 */
   if(v.writePattern==='custom')v.writePattern='actual';
   if(!PAPER_SIZES.some(p=>p.key===v.paper))v.paper='a4-portrait';
   if(!COLUMN_SCOPES.some(s=>s.key===v.columnScope))v.columnScope='all';
   v.borders=v.borders!==false;
   /* 印刷範囲(§9.292 ①)。知らない綴り・壊れた日付は既定へ倒す
      （**「絞れない値でこっそり0件」を作らない**）。 */
   v.range=rangeOf(v);
   v.dateFrom=DATE_RE.test(String(v.dateFrom||''))?String(v.dateFrom):'';
   v.dateTo=DATE_RE.test(String(v.dateTo||''))?String(v.dateTo):'';
   /* 紙の文字とセルの余白(§9.292 ⑥／§9.294 ②)。知らない綴りは既定へ倒す。 */
   v.fontScale=fontScaleOf(v);
   /* ---------- 旧`cellPad`は1度だけ上下・左右の両方へ移す（§9.294 ②） ----------
      **わざわざ選んだ人の見え方を変えない**（§9.132）——「詰める」を選んで
      いた端末は上下も左右も詰めたまま。**触っていない端末には新しい既定**
      （左右＝詰める）が届く。移したら旧い鍵は捨てる（読まない鍵を残すと、
      次に触ったときどちらが効くのか分からなくなる）。 */
   const raw=JSON.parse(localStorage.getItem(PREF_KEY)||'{}')||{};
   const had=k=>Object.prototype.hasOwnProperty.call(raw,k);
   if(had('cellPad')&&!had('padY'))v.padY=String(raw.cellPad);
   if(had('cellPad')&&!had('padX'))v.padX=String(raw.cellPad);
   delete v.cellPad;
   v.padY=padYOf(v);v.padX=padXOf(v);v.dayGap=dayGapOf(v);
   v.colFit=colFitOf(v);v.bold=!!v.bold;
   v.printExtras=!!v.printExtras;
   v.tab=PV_TABS.some(t=>t.key===v.tab)?v.tab:'load';
   /* 倍率(§9.238 ③)。知らない値は既定へ倒す（壊れた保存値で
      プレビューが開けなくならないように）。 */
   v.zoomMode=zoomModeOf(v);
   v.zoomPct=Math.min(ZOOM_MAX*100,Math.max(ZOOM_MIN*100,Number(v.zoomPct)||100));
   return v;
  }catch(_){return {...DEFAULTS}}
 }
 function savePref(p){
  try{localStorage.setItem(PREF_KEY,JSON.stringify(p))}catch(_){WL.quiet.note('端末の覚えを書けない（次に開くと既定へ戻るだけ）',_)}
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
    /* 印刷範囲(§9.292 ①)。**設備ごとに当てる**——「選んだ予定だけ」は
       この端末が開いている設備の選択なので、他の設備には当てられない。 */
    const rows=applyRange(entries,opt,name===here);
    if(name===here){
     /* いま開いている設備は成り代わる必要が無い(scStateがそのまま正しい)。 */
     pages=pages.concat(buildPages(name,rows,opt));
    }else{
     /* **紙の列は`timeline:<設備>`から引く**(§9.235)ので、成り代わる前に
        読んでおく(`WL.columnLayout`はターゲットごとのキャッシュなので、
        読み込みは1回だけで済む)。 */
     try{await WL.columnLayout.load('timeline:'+name)}catch(_){WL.quiet.note('列の設定を取れない（既定の並びで出す）',_)}
     const built=(typeof view.withEquipment==='function')
       ?await view.withEquipment(name,rows,()=>buildPages(name,rows,opt))
       :buildPages(name,rows,opt);
     pages=pages.concat(built);
    }
   }
  }else{
   pages=pages.concat(buildPages(view.equipment(),
                                 applyRange(view.entries(),opt,true),opt));
  }
  return pages;
 }

 /* ---------- プレビューの画面(§9.186・§9.238 ③④) ----------
    左に決めること、右に刷り上がり。並びは実際にする順（何を載せる→どう
    見せる→用紙→枚数の確認→印刷）。

    **§9.238 ④で組み直した**（利用者の指示「印刷プレビューのメニューが
    使えないメニューも混在しているので、メニューのわかりやすく使いやすい形で
    再構成して必要な機能は追加実装、使えない不要な機能は整理してください」）。
    直したのは3点:
     ① **見出しと中身を合わせた。** 「(1) 何を載せるか」の中に用紙以外の
        すべて（列の範囲・枠線・記入欄）が入っており、見出しが嘘をついて
        いた。決める理由ごとに「載せるもの／見せ方／用紙／刷り上がり」の
        4つへ分ける。
     ② **いま効かない設定は、効かないと書いて押せなくする**（CLAUDE.md §4）。
        分割の無い設備で「子ロットも載せる」、1日ぶんしか無いときの
        「日付ごとにページを分ける」、全部の列が画面に入っているときの
        「見える範囲の列だけ」——どれも押せるのに何も起きなかった。
        判定は`previewFacts()`の**1箇所**が答え、理由をその場に書く。
     ③ **表示倍率を足した**（§9.238 ③、利用者の指示「プレビューを幅に
        合わせて、縦に合わせて、100%、など表示のスケール調整も含めて
        調整できるように」）。倍率は**刷り上がりではなく見え方**の話なので、
        左の設定ではなく**紙の側の帯**へ置く（同じ場所に置くと「100%で
        刷られる」と読まれる）。 */
 const PREVIEW_ID='schedulePrintPreview';
 let pv={equipment:'',pref:null,sheets:[],busy:false,again:false,sheet:0};

 /* ---------- 表示倍率(§9.238 ③) ----------
    紙は実寸(mm)のまま組み、`transform`で見え方だけ変える(§9.186)。
    **刷り上がりには一切効かない**——ここで100%にしても紙は同じ。 */
 const ZOOM_MODES=[
  {key:'fit',   label:'全体',  note:'紙1枚がまるごと入る大きさ（既定）'},
  {key:'width', label:'幅',    note:'紙の横幅を器いっぱいに合わせます'},
  {key:'height',label:'縦',    note:'紙の高さを器いっぱいに合わせます'},
  {key:'actual',label:'100%',  note:'実寸。細かい文字まで確かめられます'},
 ];
 const ZOOM_MIN=.2,ZOOM_MAX=4;
 /* ＋／−で辿る刻み。**等間隔にしないこと**——小さい側は細かく、大きい側は
    粗くないと、100%付近で何度も押すことになる。 */
 const ZOOM_STEPS=[.25,.33,.5,.67,.75,1,1.25,1.5,2,3,4];
 function zoomModeOf(pref){
  const k=String(pref&&pref.zoomMode||'');
  return (k==='manual'||ZOOM_MODES.some(z=>z.key===k))?k:'fit';
 }
 const clampZoom=v=>Math.min(ZOOM_MAX,Math.max(ZOOM_MIN,v||1));
 /* 器へ入る倍率。**`offsetWidth`で測る**——`getBoundingClientRect()`は
    `transform`を掛けたあとの見かけの寸法なので、前回の倍率が掛かった値を
    基準にしてしまう（回を重ねるほど縮む）。 */
 const PAPER_GUTTER_PX=24;    // 器の左右の余白
 const PAPER_CAPTION_PX=56;   // 「1 / 4」の見出しぶん
 function computeZoom(box,pref){
  const mode=zoomModeOf(pref);
  if(mode==='manual')return clampZoom((pref.zoomPct||100)/100);
  if(mode==='actual')return 1;
  const probe=box.querySelector('.sp-page');
  const w=probe?probe.offsetWidth:0,h=probe?probe.offsetHeight:0;
  if(!w||!h)return 1;
  const roomW=box.clientWidth-PAPER_GUTTER_PX,roomH=box.clientHeight-PAPER_CAPTION_PX;
  if(roomW<=0||roomH<=0)return 1;
  /* **「幅」「縦」は器いっぱいまで拡大する**——合わせる先が器なのだから、
     1倍で頭打ちにすると小さい紙では一度も合わない（利用者の指示は
     「幅に合わせて、縦に合わせて」）。**「全体」だけは1倍で止める**
     ——既定の見え方(§9.186)を変えないため。大きくしたい人は「幅」か
     「100%」か「＋」を明示的に選ぶ。 */
  if(mode==='width')return clampZoom(roomW/w);
  if(mode==='height')return clampZoom(roomH/h);
  return Math.min(1,Math.max(ZOOM_MIN,Math.min(roomW/w,roomH/h)));
 }
 /* いま出ている倍率（帯の%表示と＋−の起点）。描いたあとに入れる。 */
 let shownZoom=1;
 /* 次の刻み。**無ければnull**——端では押せなくするので、判定は1箇所で答える
    （§4。押せるのに何も起きないボタンを残さない）。 */
 function nextZoomStep(dir){
  const cur=shownZoom||1;
  const list=dir>0?ZOOM_STEPS:[...ZOOM_STEPS].slice().reverse();
  const next=list.find(v=>dir>0?v>cur+1e-6:v<cur-1e-6);
  return next==null?null:next;
 }
 function stepZoom(dir){
  const next=nextZoomStep(dir);
  if(next==null)return;
  pv.pref.zoomMode='manual';pv.pref.zoomPct=Math.round(next*100);
  savePref(pv.pref);applyZoom();renderZoomBar();
 }

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
     <!-- 設定は段（タブ）で階層化する(§9.293 ③)。**段の見出しにいまの値**を
          出すので、開かないと分からない段を作らない。刷り上がり（枚数）と
          「既定へ戻す」は**段の外**（どの段からでも読める・触れる）。
          **この中にバッククォートを書かないこと**(§9.211 ③)——ここは
          テンプレートリテラルの中なので、コメントの中でも文字列が閉じ、
          以降がJSとして解釈されて画面が組み上がらない(node --check は
          通るので構文検査では捕まらない。実際にここで踏んだ)。 -->
     <aside class="sp-pv-side">
      <div class="sp-pv-tabs" id="spPvTabs" role="tablist"></div>
      <div class="sp-pv-panes" id="spPvPanes">
       <section class="sp-pv-pane" data-pane="load">
        <div class="sp-options" id="spPvOptions"></div>
       </section>
       <section class="sp-pv-pane" data-pane="look" hidden>
        <div class="sp-options" id="spPvLook"></div>
       </section>
       <section class="sp-pv-pane" data-pane="paper" hidden>
        <!-- 大きさと向きは別の欄(§9.252)。器は見せ方と同じ sp-options に
             する——中に「大きさ」「向き」の2つの群が入るので、sp-pats を
             直に置くと群の見出しが札と同じ並びに混ざる。 -->
        <div class="sp-options" id="spPvSize"></div>
       </section>
      </div>
      <div class="sp-pv-sum">
       <p class="sp-pv-facts" id="spPvFacts"></p>
       <button type="button" id="spPvReset" class="sp-pv-reset"
        title="この画面の設定（載せるもの・見せ方・用紙）を、はじめの形へ戻します。表示倍率は変えません">設定を既定へ戻す</button>
      </div>
     </aside>
     <div class="sp-pv-view">
      <!-- 表示倍率と紙送り(§9.238 ③)。**刷り上がりの設定とは分けて紙の側へ
           置く**——左の欄に混ぜると「100%で刷られる」と読まれる。 -->
      <div class="sp-pv-zoom" id="spPvZoom"></div>
      <div class="sp-pv-paper" id="spPvPaper"></div>
     </div>
    </div>
    <footer class="sp-pv-foot">
     <span class="sp-pv-hint">設定を変えると、右のプレビューがその場で変わります。倍率は見え方だけで、紙は変わりません。</span>
     <button type="button" id="spPvCancel">閉じる</button>
     <button type="button" class="sp-pv-print" id="spPvPrint">印刷する</button>
    </footer>
   </div>`;
  document.body.appendChild(el);
  el.querySelector('#spPvClose').onclick=closePreview;
  el.querySelector('#spPvCancel').onclick=closePreview;
  el.querySelector('#spPvPrint').onclick=doPrint;
  el.querySelector('#spPvReset').onclick=resetPref;
  /* **背景クリックでは閉じない**（§9.221 ①）。刷る前の設定を触っている
     最中に外を押して消えると、選び直しからやり直しになる。閉じるのは
     ×／キャンセル／Escの3つ。 */
  WL.modal.keepOpen(el);
  document.addEventListener('keydown',e=>{
   if(WL.modal.escCloses(e)&&!el.hidden){e.stopPropagation();closePreview()}
  },true);
  /* 器の大きさが変わったら「合わせる」倍率を取り直す(§9.238 ③)。
     **窓の`resize`だけでは足りない**——左の設定が増減しても器の幅は動く。
     倍率を当て直すだけなので、紙は組み直さない。 */
  if(typeof ResizeObserver==='function'){
   const ro=new ResizeObserver(()=>{if(!el.hidden){applyZoom();renderZoomBar()}});
   ro.observe(el.querySelector('#spPvPaper'));
  }
  return el;
 }

 /* ---------- いま何ができるか(§9.238 ④) ----------
    **判定はここ1箇所**。散らすと「押せるのに何も起きない」が必ずどれかに
    戻る。数えるのは**いま開いている設備**の予定——他の設備は「すべての設備」
    を入れて初めて読むので、読む前に数えられない（数えられないものを
    「無い」と言わない）。 */
 function previewFacts(pref){
  const view=WL.scheduleView;
  const list=(typeof view?.entries==='function'?view.entries():[])||[];
  const main=list.filter(e=>e.parentId==null&&!e.__pending);
  const shown=main.filter(e=>{
   const st=e.state||'予定';
   return (st==='完了'||st==='取消')?!!(pref&&pref.includeDone):true;
  });
  const days=new Set(shown.map(e=>entryDayKey(e)));
  /* 印刷範囲(§9.292 ①)。**「載せるもの」の他のチェックを当てたあと**の
     顔ぶれで数える——完了を載せない設定なら、その日は範囲の候補にも
     出ない（画面に出ていない日を選ばせない）。 */
  const dayKeys=[...days].filter(Boolean).sort();
  const undated=shown.filter(e=>!entryDayKey(e)).length;
  const picked=pickedIdSet();
  const pickedCount=shown.filter(e=>picked.has(String(e.id))).length;
  const ranged=applyRange(shown,pref,true).filter(e=>e.parentId==null).length;
  const names=(typeof view?.equipmentNames==='function')?view.equipmentNames():[];
  const allCols=(typeof view?.printColumnKeys==='function')?view.printColumnKeys().length:0;
  let visCols=allCols;
  try{if(typeof view?.visibleColumnKeys==='function')visCols=view.visibleColumnKeys().length}catch(_){WL.quiet.note('見えている列を数えられない（全部の列で見積もる）',_)}
  return {
   /* 「すべての設備」を入れていると、他設備ぶんは読むまで分からない。
      そのときは**数えられないので断らない**（fail-open）。 */
   unknown:!!(pref&&pref.allEquipment),
   equipments:names.length,
   doneCount:main.filter(e=>e.state==='完了'||e.state==='取消').length,
   childCount:list.filter(e=>e.parentId!=null).length,
   dayCount:days.size,
   grouped:(typeof view?.groupMode==='function')&&view.groupMode()!=='none',
   groupLabel:(typeof view?.groupModeLabel==='function')?view.groupModeLabel():'',
   allCols,visCols,
   /* いま効いている倍率（§9.292 ⑥／§9.293 ②）。**紙を組み立てるのと同じ
      `withMm()`に聞く**——画面で別に計算すると、案内と刷り上がりが
      食い違う（§9.163）。`fit`は幅・`font`は文字で、**別の答え**。
      `printCols`は**実際に紙へ出る列の数**（記入欄・印刷専用の列を含む）。 */
   ...(()=>{
    try{
     const cols=printColumns(pref||{});
     /* 列の幅を文字から決めるとき（§9.294 ④）は**紙と同じ材料で測る**
        ——`withMm`へ実測を渡さないと、案内だけが画面の幅で計算した倍率を
        言うことになる（§9.163）。材料はいま組み上がっている紙の行。
        まだ1枚も組んでいなければ渡さない＝画面の幅へ倒す（fail-open）。 */
     let textMm=null;
     if(colFitOf(pref)==='text'&&pv.sheets&&pv.sheets.length){
      const all=[];pv.sheets.forEach(p2=>(p2.rows||[]).forEach(r2=>all.push(r2)));
      textMm=measureColsMm(cols,all,pref);
     }
     const r=withMm(cols,paperUsableMm((pref&&pref.paper)||'a4-portrait').w,pref,textMm);
     return {fit:r.fit,font:r.font,printCols:cols.length};
    }catch(_){return {fit:1,font:1,printCols:0}}
   })(),
   /* 印刷範囲(§9.292 ①)。`shownCount`は範囲を当てる前・`rangedCount`は
      当てたあと。**両方出す**——「12件中3件」と書けないと、絞れているのか
      そもそも予定が3件なのかが読めない。 */
   /* 日付の変わり目が**紙の中に**何回あるか（§9.295 ②）。日付ごとに
      ページを分けているなら0（1枚＝1日）。**数え方は紙と同じ`entryDayKey`**
      ——別に数えると「効くと書いたのに効かない」が作れる（§9.163）。 */
   dayBreaks:(pref&&pref.pageByDate)?0:Math.max(0,dayKeys.length-1),
   shownCount:shown.length,rangedCount:ranged,
   dayKeys,firstDay:dayKeys[0]||'',lastDay:dayKeys[dayKeys.length-1]||'',
   undatedCount:undated,pickedCount,
  };
 }

 /* チェック1つ。**効かないときは押せなくして理由を書く**（§4）。 */
 function cb(pref,k,label,note,block){
  const off=!!block;
  return `<label class="sp-opt${off?' is-off':''}">`
   +`<input type="checkbox" data-opt="${k}"${pref[k]?' checked':''}${off?' disabled':''}>`
   +`<span><b>${esc(label)}</b>`
   +(off?`<small class="sp-opt-why">いまは効きません: ${esc(block)}</small>`
        :(note?`<small>${esc(note)}</small>`:''))
   +`</span></label>`;
 }
 /* ---------- ① 載せるもの / 印刷範囲(§9.292 ①) ----------
    **日付は打たせず、実際にある日から選ばせる**——打つ形にすると
    ①1文字ごとに欄が作り直されてカーソルが飛び(§9.117) ②予定の無い日や
    逆さまの範囲を作れてしまう。選択欄なら「どこからどこまで選べるのか」が
    開いた時点で読める（§CLAUDE 画面基準: 探させない・推測させない）。 */
 function dayPickHtml(id,cur,facts,counts){
  const opts=facts.dayKeys.map(k=>
   `<option value="${esc(k)}"${cur===k?' selected':''}>${esc(dayLabel(k))}（${counts.get(k)||0}件）</option>`).join('');
  return `<select class="sp-range-day" id="${id}" data-sprange="${id}"${facts.dayKeys.length?'':' disabled'}>${opts}</select>`;
 }
 function rangeRows(pref,facts){
  const cur=rangeOf(pref);
  /* 「選んだ予定だけ」は画面のチェックが要る。**押せるのに何も起きない
     ようにしない**（§4）——選んでいなければ理由を書いて押せなくする。 */
  const pickBlock=facts.pickedCount>0?''
   :'一覧のチェックで予定を選んでから使えます（実施中・完了は選べません）';
  const dateBlock=facts.dayKeys.length?'':'日付の決まっている予定がありません';
  const rows=RANGE_MODES.map(r=>{
   const off=(r.key==='picked'&&!!pickBlock)||(r.key==='date'&&!!dateBlock);
   const why=r.key==='picked'?pickBlock:(r.key==='date'?dateBlock:'');
   const note=r.key==='picked'&&!off?`いま ${facts.pickedCount} 件を選んでいます`:r.note;
   return `<label class="sp-pat${cur===r.key?' is-on':''}${off?' is-off':''}" title="${esc(off?why:r.note)}">
     <input type="radio" name="spRange" value="${r.key}"${cur===r.key?' checked':''}${off?' disabled':''}>
     <span><b>${esc(r.label)}</b><small>${esc(off?why:note)}</small></span></label>`;
  }).join('');
  /* 日ごとの件数（選ばせる欄に添える）。 */
  const view=WL.scheduleView;
  const list=(typeof view?.entries==='function'?view.entries():[])||[];
  const counts=new Map();
  list.filter(e=>e.parentId==null&&!e.__pending).forEach(e=>{
   const st=e.state||'予定';
   if((st==='完了'||st==='取消')&&!(pref&&pref.includeDone))return;
   const k=entryDayKey(e);if(!k)return;
   counts.set(k,(counts.get(k)||0)+1);
  });
  const pick=cur==='date'
   ?`<div class="sp-range-days">
      <label><span>この日から</span>${dayPickHtml('spRangeFrom',pref.dateFrom||facts.firstDay,facts,counts)}</label>
      <label><span>この日まで</span>${dayPickHtml('spRangeTo',pref.dateTo||facts.lastDay,facts,counts)}</label>
     </div>`:'';
  /* **絞れていることは必ず文字で出す**（§3）。「12件中3件」と書けないと、
     絞れているのか予定が3件しかないのかが読めない。 */
  const note=cur==='all'
   ?`この設備の予定 ${facts.shownCount} 件をすべて刷ります。`
   :`この設備の予定 ${facts.shownCount} 件のうち <b>${facts.rangedCount} 件</b>を刷ります。`;
  const warn=(cur==='date'&&facts.undatedCount)
   ?`<br>日付の決まっていない予定 ${facts.undatedCount} 件は、比べる日付が無いので範囲に入りません。`:'';
  const other=(cur==='picked'&&pref.allEquipment)
   ?'<br>「選んだ予定だけ」はこの端末が開いている設備の選択なので、ほかの設備は1件も出ません。':'';
  return `<div class="sp-opt-group"><h4>印刷範囲</h4>
   <div class="sp-pats" id="spRange">${rows}</div>${pick}
   <p class="sp-opt-note" id="spRangeNote">${note}${warn}${other}</p>
  </div>`;
 }
 /* ---------- ① 載せるもの ----------
    「この紙に何が出るか」だけ。見え方(列・枠線・記入欄)は②へ移した。 */
 function optionRows(pref,facts){
  return `${rangeRows(pref,facts)}
  <div class="sp-opt-group"><h4>載せる予定</h4>
   ${cb(pref,'allEquipment','すべての設備を続けて印刷する','設備ごとにページを分けます',
      facts.equipments>1?'':(facts.equipments?'この画面に設備が1台しかありません':'設備の一覧を読めていません'))}
   ${cb(pref,'includeDone','完了・取消も載せる','ふだんは載せません（これから流すものだけ配るため）',
      (facts.unknown||facts.doneCount>0)?'':'この設備に完了・取消の予定がありません')}
   ${cb(pref,'includeChildren','畳んでいる子ロットも載せる','画面で開いている子ロットは、ここを切にしていても出ます（紙は画面の見た目が正）。入にすると、畳んでいるぶんも含めて全部の子ロットを親の下へ差し込みます',
      (facts.unknown||facts.childCount>0)?'':'この設備の予定に、分割後の子ロットがありません')}
   ${cb(pref,'useGroups',
      facts.grouped?`画面のまとめ（${facts.groupLabel}）で見出しを入れる`:'画面のまとめで見出しを入れる',
      '画面と同じまとまりで区切ります',
      facts.grouped?'':'画面が「まとめない」なので、入れる見出しがありません')}
   ${cb(pref,'pageByDate','日付ごとにページを分ける','日ごとに配る場合はこのまま',
      (facts.unknown||facts.dayCount>1)?'':`載せる予定が${facts.dayCount===0?'ありません':'1日ぶんしかありません'}`)}
  </div>`;
 }
 /* ---------- ② 見せ方 ----------
    「同じ中身をどう刷るか」。列の範囲・枠線・記入欄はどれもここ。 */
 function lookRows(pref,facts){
  const scopeCur=columnScopeOf(pref);
  /* 全部の列が画面に入っているときは「見える範囲だけ」＝「すべて」なので、
     選んでも何も起きない（§4）。 */
  const scopeBlock=facts.visCols>0&&facts.visCols>=facts.allCols
    ?'いま画面に全部の列が見えているので、「すべての列」と同じになります':'';
  const scopeRows=COLUMN_SCOPES.map(s=>{
   const off=s.key==='visible'&&!!scopeBlock;
   return `<label class="sp-pat${scopeCur===s.key?' is-on':''}${off?' is-off':''}" title="${esc(off?scopeBlock:s.note)}">
     <input type="radio" name="spColumnScope" value="${s.key}"${scopeCur===s.key?' checked':''}${off?' disabled':''}>
     <span><b>${esc(s.label)}</b><small>${esc(off?scopeBlock:s.note)}</small></span></label>`;
  }).join('');
  /* **記入欄はパターンから選ぶ**(§9.191)。チェックの寄せ集めだと
     「開始だけ欲しい」「備考だけ」を作るのに何回も試すことになる。 */
  const cur=writePatternOf(pref);
  const patRows=WRITE_PATTERNS.map(p=>`<label class="sp-pat${cur===p.key?' is-on':''}" title="${esc(p.note)}">
     <input type="radio" name="spWritePattern" value="${p.key}"${cur===p.key?' checked':''}>
     <span><b>${esc(p.label)}</b><small>${esc(p.note)}</small></span></label>`).join('');
  /* 紙の文字とセルの余白（§9.292 ⑥）。**効いている大きさを文字で出す**
     （§3・§6）——「自動」を選んでいると倍率が場面で変わるので、いま何倍で
     刷られるのかが読めないと選びようが無い。 */
  const fsCur=fontScaleOf(pref);
  const padYCur=padYOf(pref),padXCur=padXOf(pref),dayCur=dayGapOf(pref),fitCur=colFitOf(pref);
  /* **段数の多い選択は札を積まない**（§9.293 ③）——7枚の縦積みだと段の
     中がそれだけで1画面になる。呼び名の短い「大きさ」は横に並べ、
     選んだものの説明だけを下に1行出す（同じことを7回書かない・§CLAUDE 8）。 */
  const seg=(name,list,cur)=>`<div class="sp-seg" role="radiogroup" aria-label="${esc(name)}">`
   +list.map(x=>`<label class="sp-seg-btn${cur===x.key?' is-on':''}" title="${esc(x.label)}: ${esc(x.note)}">
      <input type="radio" name="${name}" value="${x.key}"${cur===x.key?' checked':''}>
      <span>${esc(x.label)}</span></label>`).join('')+'</div>';
  const fsRows=seg('spFontScale',FONT_SCALES,fsCur)
   +`<p class="sp-opt-note">${esc((FONT_SCALES.find(x=>x.key===fsCur)||{}).note||'')}</p>`;
  /* 余白は3つとも同じ形の帯で並べる（§9.294 ②③）——**同じ語彙**
     （詰める／標準／広め）なので、並べて置けば覚えることが増えない。 */
  const padRow=(name,list,cur,head,note)=>`<div class="sp-opt-row"><span class="sp-opt-k">${esc(head)}</span>`
   +`<span class="sp-opt-v">${seg(name,list,cur)}</span></div>`
   +`<p class="sp-opt-note">${esc(note)}</p>`;
  /* **効く場面が無いときは、そう書く**（§4／§9.295 ②、利用者の報告
     「区切りの行間の余白は変更しても変化がない」）——日付ごとにページを
     分けていて、まとまりの帯も出していない紙には**日付の変わり目が1つも
     無い**。押せるのに何も起きない設定を黙って残さない。 */
  const dayBreaks=facts.dayBreaks;
  const dayNote=dayBreaks===0
    ?'いまの紙には日付の変わり目がありません'
      +(pref.pageByDate?'（日付ごとにページを分けているため）。'
                       :'（この範囲が1日ぶんのため）。')
      +'「① 載せるもの」で日付ごとのページ分けを外すか、範囲を広げると効きます。'
    :(DAY_GAPS.find(x=>x.key===dayCur)||{}).note||'';
  const padRows=padRow('spPadX',PAD_XS,padXCur,'左右',
     (PAD_XS.find(x=>x.key===padXCur)||{}).note||'')
   +padRow('spPadY',PAD_YS,padYCur,'行間（上下）',
     (PAD_YS.find(x=>x.key===padYCur)||{}).note||'')
   +padRow('spDayGap',DAY_GAPS,dayCur,'区切りの行間',dayNote);
  const fitRows=seg('spColFit',COL_FITS,fitCur)
   +`<p class="sp-opt-note">${esc((COL_FITS.find(x=>x.key===fitCur)||{}).note||'')}</p>`;
  const fit=facts.fit||1,font=facts.font||1;
  /* **文字が幅より大きいと値が切れる**（§9.293 ②）。選んだ結果なので
     止めはしないが、**そうなることを先に書く**（§4）。 */
  const tight=font>fit+0.001;
  /* **床に着いたら打つ手を書く**（§4）——列が多い設備では幅がここで
     止まる。文字は別に選べるので、そのことも一緒に言う。 */
  const floored=fit<=MIN_FIT+0.001;
  /* **もっと大きくする手立てを、効く順に並べて書く**（§4／§9.293 ④、
     利用者の指示「バキバキの限界まで…本当にできるだけ大きく見やすく」）。
     「自動」は**文字を切らずに入る限界**まで大きくするので、そこから先は
     ①セルの余白を詰める ②列を減らす ③紙を大きくする、のどれかで
     場所を作るしかない——そのことを画面に書く（黙っていると
     「これ以上大きくならない」としか見えない）。 */
  const bigger=[padXOf(pref)!=='0.3'?'左右の余白を「最小」に':'',
                colFitOf(pref)!=='text'?'列の幅を「文字に合わせる」に':'',
                scopeCur!=='visible'?'列の範囲を「見える範囲の列だけ」に':'',
                String(pref&&pref.paper||'').indexOf('a3')!==0?'用紙をA3／横向きに':''
               ].filter(Boolean);
  /* **同じ数字を2箇所に出さない**（§CLAUDE 8）——列幅の%は足元の
     「刷り上がり」がすでに言っているので、ここは本文の大きさだけ。 */
  const fitNote=`いまの刷り上がりは 本文 <b>約${(12.5*font).toFixed(1)}px</b>。`
   +(fsCur==='auto'
     ?'<b>文字が切れない限界まで大きくしています。</b>'
      +(bigger.length?`もっと大きくするには、${bigger.join('／')}。`
                     :'これ以上は、列そのものを減らすしかありません。')
      +'（「極大」「最大」を選べばさらに大きくできますが、長い値は「…」で切れます）'
     :(tight
       ?'<b>列の幅より文字が大きいので、長い値は「…」で切れます。</b>'
        /* **確実に切れない道を必ず挙げる**（§4）——他の手立ては場所を作る
           だけで、入りきる保証は無い。「自動」は入る限界まで大きくする。 */
        +(bigger.length?`切らずに大きくするには、${bigger.join('／')}。`
                       +'それでも入らなければ「自動（枠いっぱい）」に戻してください。'
                       :'切りたくないときは「自動（枠いっぱい）」に戻してください。')
       :'選んだ大きさで刷ります。'));
  return `<div class="sp-opt-group"><h4>列の範囲</h4>
   <div class="sp-pats" id="spColumnScope">${scopeRows}</div>
   <p class="sp-opt-note">画面に出ている ${facts.allCols} 列のうち、スクロールせずに見えているのは ${facts.visCols} 列です。
    <b>いま紙に出るのは ${facts.printCols} 列</b>（画面の列 ${scopeCur==='visible'?facts.visCols:facts.allCols} ＋ 記入欄など ${
      Math.max(0,facts.printCols-(scopeCur==='visible'?facts.visCols:facts.allCols))} 列）。</p>
   ${cb(pref,'printExtras','印刷用の「#」「状態」の列を足す',
        '紙だけの2列です。通し番号は現場で行を指すため、状態は白黒コピーで色分けが消えるためのものです（既定は足さない＝画面と同じ列）')}
  </div>
  <div class="sp-opt-group"><h4>列の幅</h4>
   <div id="spColFit">${fitRows}</div>
  </div>
  <div class="sp-opt-group"><h4>セルの余白</h4>
   <div id="spCellPad">${padRows}</div>
  </div>
  <div class="sp-opt-group"><h4>文字の大きさ</h4>
   <div id="spFontScale">${fsRows}</div>
   ${cb(pref,'bold','文字を太くする',
        '本文を太字で刷ります。白黒コピーやFAXで薄くなるとき、遠目で読むときに効きます（見出しはもともと太字です）')}
   <p class="sp-opt-note" id="spFitNote">${fitNote}</p>
  </div>
  <div class="sp-opt-group"><h4>枠線</h4>
   ${cb(pref,'borders','枠線（表の格子）を出す',
        '外すと格子を消して、画面のようなさわやかな見た目になります（見出し・まとまりの帯と、記入欄の下線は残ります）')}
  </div>
  <div class="sp-opt-group"><h4>書き込む欄</h4>
   <div class="sp-pats" id="spWritePatterns">${patRows}</div>
   ${cb(pref,'commentBox','紙の下に「申し送り・気付き」の欄をつける','行ごとではなく、紙1枚に1つの欄です')}
  </div>`;
 }
 /* 用紙の選択肢(§9.252、利用者の指示「用紙設定と縦横選択を分けて、
    わかりやすくまとめ直し」)。**大きさと向きを別の群にする**——掛け合わせて
    並べると用紙を1つ足すたびに札が2枚増える（B4を足すと8枚）。
    見せ方は既存の「書き込む欄」と同じ`.sp-pat`（選んだものが面で分かる）。

    **数字はいまの向きで出す**（§CLAUDE 6「単位と根拠を画面に出す」）——
    「横」を選んでいるのに札が`210×297mm`と言っていると、どちらが本当か
    確かめに行くことになる。**刷れる範囲まで書く**ので、余白を引く暗算を
    させない。 */
 function paperRowsHtml(pref){
  const cur=paperSizeOf(pref.paper),usable=paperUsableMm(cur.key);
  const dims=(k,orient)=>orient==='landscape'?{w:k.h,h:k.w}:{w:k.w,h:k.h};
  const kinds=PAPER_KINDS.map(k=>{
   const d=dims(k,cur.orient);
   return `<label class="sp-pat${cur.kind===k.key?' is-on':''}" title="${esc(k.note)}">
     <input type="radio" name="spPaperKind" value="${k.key}"${cur.kind===k.key?' checked':''}>
     <span><b>${esc(k.label)}</b><small>${d.w}×${d.h}mm</small></span></label>`;
  }).join('');
  const orients=PAPER_ORIENTS.map(o=>{
   const k=PAPER_KINDS.find(x=>x.key===cur.kind)||PAPER_KINDS[0],d=dims(k,o.key);
   return `<label class="sp-pat${cur.orient===o.key?' is-on':''}" title="${esc(o.note)}">
     <input type="radio" name="spPaperOrient" value="${o.key}"${cur.orient===o.key?' checked':''}>
     <span><b>${esc(o.label)}</b><small>${d.w}×${d.h}mm</small></span></label>`;
  }).join('');
  return `<div class="sp-opt-group"><h4>大きさ</h4>
    <div class="sp-pats" id="spPaperKinds">${kinds}</div></div>
   <div class="sp-opt-group"><h4>向き</h4>
    <div class="sp-pats" id="spPaperOrients">${orients}</div></div>
   <p class="sp-opt-note" id="spPaperNow">いまの用紙は <b>${esc(cur.label)} ${cur.w}×${cur.h}mm</b>。
    四辺 ${PAPER_MARGIN_MM}mm を空けるので、刷れる範囲は ${usable.w}×${usable.h}mm です。</p>`;
 }
 /* ---------- 倍率と紙送りの帯(§9.238 ③) ---------- */
 function renderZoomBar(){
  const bar=document.getElementById('spPvZoom');if(!bar)return;
  const mode=zoomModeOf(pv.pref);
  const n=pv.sheets.length;
  const modeBtns=ZOOM_MODES.map(z=>`<button type="button" class="sp-zoom-btn${mode===z.key?' is-on':''}"
     data-zoom="${z.key}" title="${esc(z.note)}">${esc(z.label)}</button>`).join('');
  bar.innerHTML=`<span class="sp-zoom-label">表示倍率</span>
   <div class="sp-zoom-modes">${modeBtns}</div>
   <button type="button" class="sp-zoom-step" data-zoom-step="-1"${nextZoomStep(-1)==null?' disabled title="これ以上小さくできません"':' title="1段小さく"'}>−</button>
   <span class="sp-zoom-now" id="spPvZoomNow" title="紙は実寸(mm)のまま。倍率は画面の見え方だけで、刷り上がりは変わりません">${Math.round(shownZoom*100)}%</span>
   <button type="button" class="sp-zoom-step" data-zoom-step="1"${nextZoomStep(1)==null?' disabled title="これ以上大きくできません"':' title="1段大きく"'}>＋</button>
   ${n>1?`<span class="sp-zoom-gap"></span>
     <span class="sp-zoom-label">紙送り</span>
     <button type="button" class="sp-zoom-step" data-sheet="-1" title="前の紙の頭へ">◀</button>
     <button type="button" class="sp-zoom-step" data-sheet="1" title="次の紙の頭へ">▶</button>`:''}`;
  bar.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>{
   pv.pref.zoomMode=b.dataset.zoom;savePref(pv.pref);applyZoom();renderZoomBar();
  });
  bar.querySelectorAll('[data-zoom-step]').forEach(b=>b.onclick=()=>stepZoom(+b.dataset.zoomStep));
  bar.querySelectorAll('[data-sheet]').forEach(b=>b.onclick=()=>goSheet(+b.dataset.sheet));
 }
 /* いま見えている紙。**控えた番号で決めないこと**——手でスクロールした
    あとに「1枚目へ戻る」ような動きになる（止まった状態を出しておくと、
    そのうち嘘になる・§9.198）。押した時点の位置から数える。 */
 function currentSheetIndex(paper,sheets){
  const top=paper.getBoundingClientRect().top;
  let best=0,bestD=Infinity;
  sheets.forEach((el,i)=>{
   const d=Math.abs(el.getBoundingClientRect().top-top);
   if(d<bestD){bestD=d;best=i}
  });
  return best;
 }
 function goSheet(dir){
  const paper=document.getElementById('spPvPaper');if(!paper)return;
  const sheets=[...paper.querySelectorAll('.sp-pv-sheet')];
  if(!sheets.length)return;
  const at=currentSheetIndex(paper,sheets);
  pv.sheet=Math.min(Math.max(0,at+dir),sheets.length-1);
  sheets[pv.sheet].scrollIntoView({block:'start',behavior:'smooth'});
 }
 /* 倍率を当てる。**紙は組み直さない**——組み直すと見ていた場所へ戻れない。
    `transform`は場所を空けてくれないので、器の寸法もここで入れる。 */
 function applyZoom(){
  const paper=document.getElementById('spPvPaper');if(!paper)return;
  const zoom=computeZoom(paper,pv.pref);
  shownZoom=zoom;
  paper.style.setProperty('--sp-zoom',String(Math.round(zoom*1000)/1000));
  paper.querySelectorAll('.sp-pv-scale').forEach(box=>{
   const pg=box.querySelector('.sp-page');
   if(!pg)return;
   /* **`offsetWidth`で測ること**——`getBoundingClientRect()`は倍率を
      掛けたあとの寸法なので、そこへもう一度掛けると器が小さくなり、
      紙の右側が切り落とされる(実際に切れた)。 */
   box.style.width=Math.round(pg.offsetWidth*zoom)+'px';
   box.style.height=Math.round(pg.offsetHeight*zoom)+'px';
  });
  const now=document.getElementById('spPvZoomNow');
  if(now)now.textContent=`${Math.round(zoom*100)}%`;
  return zoom;
 }
 function openPreview(equipment){
  const view=WL.scheduleView;
  const pref=loadPref();
  pv={equipment:String(equipment||''),pref,sheets:[],busy:false,again:false,sheet:0};
  otherEntries.clear();
  const el=ensurePreview();
  el.querySelector('#spPvTitle').textContent=`作業予定表${pv.equipment?`（${pv.equipment}）`:''}`;
  el.querySelector('#spPvSub').textContent='いま画面に出ている条件（表示範囲・列の並び）のまま刷ります';
  paintOptions();
  el.hidden=false;
  renderZoomBar();
  renderPreview();
  requestAnimationFrame(()=>el.querySelector('#spPvPrint')?.focus());
 }
 /* 左の欄を描いて配線する。**押せない理由はデータで変わる**ので、
    設定を触るたびに描き直す（子ロットを載せると日数が変わる、など）。
    **`renderPreview()`は呼ばない**——呼び出し側が続けて呼ぶ。 */
 /* 段の見出しに添える「いまの値の一言」（§9.293 ③）。**畳んだ先の値が
    読めないと、開くまで思い出せない**（§9.199と同じ約束）。
    **触っていない設定は数えない**——既定のままの項目まで並べると、
    どこを変えたのかが読めなくなる。 */
 function tabSummary(key,pref,facts){
  if(key==='load'){
   const r=rangeOf(pref);
   const head=r==='all'?`${facts.shownCount}件`
     :(r==='date'?`日付で ${facts.rangedCount}/${facts.shownCount}件`
                 :`選んだ ${facts.rangedCount}件`);
   const on=[pref.allEquipment?'全設備':'',pref.includeDone?'完了も':'',
             pref.includeChildren?'子ロット':'',pref.pageByDate?'':'日付で分けない'].filter(Boolean);
   return [head,...on].join('・');
  }
  if(key==='look'){
   const fs=(FONT_SCALES.find(x=>x.key===fontScaleOf(pref))||{}).label||'';
   const px=(PAD_XS.find(x=>x.key===padXOf(pref))||{}).label||'';
   const py=(PAD_YS.find(x=>x.key===padYOf(pref))||{}).label||'';
   return [`${facts.printCols}列`,`文字 ${fs}`,boldOf(pref)?'太字':'',
           colFitOf(pref)==='screen'?'幅は画面のまま':'',
           px!=='詰める'?`左右 ${px}`:'',py!=='標準'?`行間 ${py}`:'',
           pref.borders===false?'枠線なし':''].filter(Boolean).join('・');
  }
  const cur=paperSizeOf(pref&&pref.paper);
  return `${cur.label} ${cur.w}×${cur.h}mm`;
 }
 function paintTabs(){
  const el=document.getElementById(PREVIEW_ID);if(!el)return;
  const box=el.querySelector('#spPvTabs');if(!box)return;
  const cur=pvTabOf(pv.pref);
  const facts=previewFacts(pv.pref);
  box.innerHTML=PV_TABS.map(t=>{
   const sum=tabSummary(t.key,pv.pref,facts);
   return `<button type="button" class="sp-pv-tab${cur===t.key?' is-on':''}"
     role="tab" aria-selected="${cur===t.key?'true':'false'}" data-pv-tab="${t.key}"
     title="${esc(t.label)}: ${esc(sum)}"><i aria-hidden="true">${t.icon}</i>
     <span><b>${esc(t.label)}</b><small>${esc(sum)}</small></span></button>`;
  }).join('');
  box.querySelectorAll('[data-pv-tab]').forEach(b=>b.onclick=()=>{
   pv.pref.tab=b.dataset.pvTab;savePref(pv.pref);paintTabs();
  });
  el.querySelectorAll('.sp-pv-pane').forEach(p=>{p.hidden=p.dataset.pane!==cur});
 }
 function paintOptions(){
  const el=document.getElementById(PREVIEW_ID);if(!el)return;
  /* **触っていた欄へ戻す**——押せない理由はデータで変わるので描き直すが、
     戻さないと1つ触るたびにフォーカスが窓の頭へ飛ぶ（キーボードで
     たどれなくなる）。 */
  const focused=document.activeElement;
  const keepOpt=focused&&focused.dataset?focused.dataset.opt:'';
  const keepName=focused&&focused.name?focused.name:'';
  const keepValue=focused&&focused.value!=null?focused.value:'';
  const facts=previewFacts(pv.pref);
  if(!facts.equipments||facts.equipments<=1)pv.pref.allEquipment=false;
  const box=el.querySelector('#spPvOptions'),look=el.querySelector('#spPvLook');
  box.innerHTML=optionRows(pv.pref,facts);
  look.innerHTML=lookRows(pv.pref,facts);
  /* **clickで受ける**（changeはclickの後に飛ぶ。§9.90と同じ理由）。 */
  [box,look].forEach(host=>host.querySelectorAll('[data-opt]').forEach(inp=>inp.onclick=()=>{
   pv.pref[inp.dataset.opt]=!!inp.checked;savePref(pv.pref);paintOptions();renderPreview();
  }));
  /* 印刷範囲(§9.292 ①)。**選んだらその場で刷り上がりが変わる**（同じ作法）。
     日付で絞るへ切り替えたときは、**いま画面に出ている最初と最後の日**を
     入れておく——空欄のまま「絞る」を選ばせると、押しても何も変わらない
     （＝壊れて見える）。そこから狭めてもらう。 */
  box.querySelectorAll('input[name="spRange"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.range=inp.value;
   if(inp.value==='date'){
    if(!pv.pref.dateFrom||!facts.dayKeys.includes(pv.pref.dateFrom))pv.pref.dateFrom=facts.firstDay;
    if(!pv.pref.dateTo||!facts.dayKeys.includes(pv.pref.dateTo))pv.pref.dateTo=facts.lastDay;
   }
   savePref(pv.pref);paintOptions();renderPreview();
  });
  /* 日付の欄。**逆さまの範囲を作らせない**——掴んだほうを正として、
     もう一方が追い越していたら合わせる（断って戻すと、なぜ動かないのかを
     考えることになる）。 */
  box.querySelectorAll('.sp-range-day').forEach(sel=>sel.onchange=()=>{
   if(sel.id==='spRangeFrom'){
    pv.pref.dateFrom=sel.value;
    if(pv.pref.dateTo&&pv.pref.dateTo<sel.value)pv.pref.dateTo=sel.value;
   }else{
    pv.pref.dateTo=sel.value;
    if(pv.pref.dateFrom&&pv.pref.dateFrom>sel.value)pv.pref.dateFrom=sel.value;
   }
   savePref(pv.pref);paintOptions();renderPreview();
  });
  /* 列の範囲(§9.236)。**選んだらその場で刷り上がりが変わる**（同じ作法）。 */
  look.querySelectorAll('input[name="spColumnScope"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.columnScope=inp.value;savePref(pv.pref);paintOptions();renderPreview();
  });
  /* 紙の文字とセルの余白(§9.292 ⑥)。**選んだらその場で刷り上がりが変わる**。 */
  look.querySelectorAll('input[name="spFontScale"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.fontScale=inp.value;savePref(pv.pref);paintOptions();renderPreview();
  });
  /* セルの余白は3つの軸（§9.294 ②③）。**書き込む先が違うだけ**で作法は同じ。 */
  [['spPadX','padX'],['spPadY','padY'],['spDayGap','dayGap'],['spColFit','colFit']]
   .forEach(([name,key])=>look.querySelectorAll(`input[name="${name}"]`).forEach(inp=>inp.onclick=()=>{
    pv.pref[key]=inp.value;savePref(pv.pref);paintOptions();renderPreview();
   }));
  /* 記入欄のパターン(§9.191)。**選んだらその場で刷り上がりが変わる**。 */
  look.querySelectorAll('input[name="spWritePattern"]').forEach(inp=>inp.onclick=()=>{
   pv.pref.writePattern=inp.value;
   /* 古い設定とも辻褄を合わせる（他の画面が actualColumns を見ている）。 */
   pv.pref.actualColumns=inp.value!=='none';
   savePref(pv.pref);paintOptions();renderPreview();
  });
  /* 用紙(§9.235 ②／§9.252)。**選んだらその場で刷り上がりが変わる**（同じ作法）。
     大きさと向きは別の欄だが、**書き込む先は1つの鍵**（片方だけ選び直しても
     もう片方は今の値を残す）。 */
  const sizeBox=el.querySelector('#spPvSize');
  sizeBox.innerHTML=paperRowsHtml(pv.pref);
  sizeBox.querySelectorAll('input[name="spPaperKind"],input[name="spPaperOrient"]')
   .forEach(inp=>inp.onclick=()=>{
    pv.pref.paper=paperKeyWith(pv.pref.paper,inp.value);
    savePref(pv.pref);paintOptions();renderPreview();
   });
  /* 段の帯は**最後に**描く（中身の値を読んで一言を作るため）。 */
  paintTabs();
  const keepRange=focused&&focused.dataset?focused.dataset.sprange:'';
  if(keepRange){
   /* 日付の欄は選び直すたびに作り直されるので、**同じ欄へ戻す**
      （戻さないと、続けて絞り込むのにマウスで拾い直すことになる）。 */
   const back=el.querySelector(`.sp-pv-side [data-sprange="${keepRange}"]:not([disabled])`);
   if(back)back.focus();
  }else if(keepOpt){
   const back=el.querySelector(`.sp-pv-side [data-opt="${keepOpt}"]:not([disabled])`);
   if(back)back.focus();
  }else if(keepName){
   const back=el.querySelector(`.sp-pv-side input[name="${keepName}"][value="${keepValue}"]:not([disabled])`);
   if(back)back.focus();
  }
 }
 /* 設定を既定へ戻す(§9.238 ④)。**倍率は戻さない**——あれは見え方の話で、
    紙の設定ではない（戻した拍子に見ていた場所を失うほうが困る）。 */
 function resetPref(){
  const zoomMode=pv.pref.zoomMode,zoomPct=pv.pref.zoomPct;
  pv.pref={...DEFAULTS,zoomMode,zoomPct};
  savePref(pv.pref);paintOptions();renderPreview();
  showToast&&showToast('印刷の設定を既定へ戻しました','用紙・載せるもの・見せ方が、はじめの形へ戻りました',3200);
 }
 function closePreview(){
  const el=document.getElementById(PREVIEW_ID);if(el)el.hidden=true;
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
    pv.sheets=[];pv.sheet=0;
    paper.innerHTML=`<p class="sp-pv-empty">${esc(pv.pref.includeDone
      ?'この設備に予定がありません。':'これから流す予定がありません。')}</p>`
     +(pv.pref.includeDone?'':'<p class="sp-pv-empty-how">「完了・取消も載せる」を入れると過去分も出せます。</p>');
    facts.innerHTML='<b>0枚</b>';
    el.querySelector('#spPvPrint').disabled=true;
    /* 紙が無いときに前回の%を残さない（見えている紙が無いのに「62%」と
       出ていると、何かが縮んでいるように読める）。 */
    shownZoom=1;renderZoomBar();
    return;
   }
   const sheets=splitToSheets(pages,pv.pref);
   pv.sheets=sheets;
   if(pv.sheet>=sheets.length)pv.sheet=0;
   el.querySelector('#spPvPrint').disabled=false;
   paper.innerHTML=sheets.map((p,i)=>
    `<figure class="sp-pv-sheet"><figcaption>${i+1} / ${sheets.length}${
      p.equipment&&pv.pref.allEquipment?`　${esc(p.equipment)}`:''}</figcaption>
     <div class="sp-pv-scale">${pageHtml(p,pv.pref,i+1,sheets.length)}</div></figure>`).join('');
   /* 倍率は**描いてから測って**決める(mm指定の実寸はブラウザに聞くしかない)。 */
   const zoom=applyZoom();
   renderZoomBar();
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
    +`<small>画面では実寸の ${Math.round(zoom*100)}%（見え方だけ。紙は${esc(size.label)}のまま）`
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
                   /* 刷るときの`@page`(§9.252)。**名前ではなく実寸mm**で
                      頼んでいることを網が直に見られるようにしておく——名前で
                      頼むと、用紙を1つ足したときにその用紙だけ既定のA4で
                      刷られ、B4はISO(250×353mm)へ化ける。 */
                   pageRule:pageRuleFor,
                   /* 書き込む欄のパターン(§9.191)。名前と並びは画面の文言と
                      同じものを1箇所から出す（テストも同じ表を見る）。 */
                   writePatterns:()=>WRITE_PATTERNS.map(p=>({...p})),
                   /* 列の範囲(§9.236)。名前と並びは画面の文言と同じものを
                      1箇所から出す（テストも同じ表を見る）。 */
                   columnScopes:()=>COLUMN_SCOPES.map(s=>({...s})),
                   /* 紙の文字とセルの余白(§9.292 ⑥)。名前と並びは画面の文言と
                      同じものを1箇所から出す（テストも同じ表を見る）。 */
                   fontScales:()=>FONT_SCALES.map(x=>({...x})),
                   padYs:()=>PAD_YS.map(x=>({...x})),
                   padXs:()=>PAD_XS.map(x=>({...x})),
                   dayGaps:()=>DAY_GAPS.map(x=>({...x})),
                   colFits:()=>COL_FITS.map(x=>({...x})),
                   measureColsMm:(cols,rows,opt)=>measureColsMm(cols,rows,opt),
                   /* 効いている倍率。**紙を組むのと同じ関数に聞ける**ように
                      しておく——別に数えると案内と刷り上がりが食い違う。 */
                   /* 既定は**1箇所**（§9.163）。網も画面もここを見る
                      ——書き写すと「既定を変えたのに網が古い約束のまま」に
                      なる（§9.294 ⑤⑥で既定を動かしたので必ず要る）。 */
                   defaults:()=>({...DEFAULTS}),
                   fitOf:(cols,usableMm,opt)=>withMm(cols,usableMm,opt).fit,
                   /* 文字の倍率は**幅とは別の答え**（§9.293 ②）。 */
                   fontOf:(cols,usableMm,opt)=>withMm(cols,usableMm,opt).font,
                   /* 印刷範囲(§9.292 ①)。名前と並びは画面の文言と同じものを
                      1箇所から出す（テストも同じ表を見る）。 */
                   rangeModes:()=>RANGE_MODES.map(r=>({...r})),
                   /* 範囲を当てた結果。**紙になる行そのもの**を外から数え
                      られるようにしておく——「札が並ぶ」だけを見る網は、
                      1件も絞らない実装でも通る。 */
                   applyRange:(entries,opt,isCurrent)=>applyRange(entries,opt,isCurrent!==false),
                   /* プレビューは**中身を見て確かめられる**ようにしておく
                      （テストが「何枚になったか」を画面から読むため）。 */
                   openPreview,closePreview,previewSheets:()=>pv.sheets.slice()};
})();
