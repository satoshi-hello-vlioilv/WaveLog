/* test_rplayout.js: 帳票の塊を行のグリッドへ載せ、パレットから出し入れする（§9.217）
   ============================================================
   利用者の指示:
     「縦方向にはブロックが干渉回避のため行単位でのレイヤーが設けてあります
      が、下方向に余白がある場合は以降のレイヤーにも跨いで表示できるように
      したいです。そのためにブロックごとに既定の高さを設定して…」
     「項目からD&Dで表示(ゴーストが出て配置可能な部分がわかりやすいように)、
      D&Dで非表示などできるようにしてください」
     「内部データについても各項目ごと設計できるように、編集追加など…」

   ここで固定するのは、崩れると「跨げる」「出し入れできる」が成り立たなく
   なる点。
    1. 行も粗いグリッド（`grid-auto-rows`＝1行ぶん・`dense`）で、塊は
       `grid-row: span R`を占める
    2. **背の高い塊の横へ、低い塊が下の段まで回り込む**（これが「跨ぐ」）
    3. 出していない塊はパレットに並び、押す/掴むで紙へ出る
    4. 紙の塊をパレットへ落とすと外れる
    5. 掴んでいる最中は**実物大のゴースト**が落ちる場所に出る
    6. 帳票ブロックマスタで作った塊が候補に出て、中身が出る

   後片付けは finally で必ず行う。**列レイアウトマスタは実行をまたいで
   生き延びる**（§9.121）。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const fs=require('fs');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const TAG='rplayout-'+process.pid;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=p=>fetch(B+p).then(r=>r.json());
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
/* 中身が必ず出る3つ（このロットのデータに依存しない）。 */
const A='基本情報',C1='コース情報',C2='登録状態';
const UNIT=60;                                  /* RP_SPAN_UNIT（§9.169。幅） */
/* 行数・段数は`RP_COUNT_UNIT`。**幅と同じ60にしないこと**——22行×60=1320は
   `normalize_column_width`の上限900で頭打ちになり、読み戻すと15行へ
   切り詰められる（§9.221 ⑨の追補）。 */
const CUNIT=30;
let b=null,madeBlock=null;

(async()=>{
 await cleanup();
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 const openReport=async()=>{
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await page.click('.record-list-row .report');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await settle(page);
  await page.waitForTimeout(600);
 };
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openReport();

  /* ---- 1) 行も粗いグリッド ---- */
  const grid=await page.evaluate(()=>{
   const g=document.querySelector('.rp-blocks'),cs=getComputedStyle(g);
   const blocks=[...document.querySelectorAll('[data-rp-block]')];
   /* 行数の決まった塊は`grid-row:span R`（HTMLのstyle属性）、中身なりの塊は
      `grid-row-end:span R`（JSが測って入れる）。**両方を見ること**——
      `gridRowEnd`は前者で`'auto'`という**真の値**を返すので、`||`で
      つなぐと後ろを一度も見ない（実際にそれで1件だけ落ちた）。 */
   const has=e=>/span\s+\d+/.test(e.style.gridRow||'')||/span\s+\d+/.test(e.style.gridRowEnd||'');
   return{行の高さ:cs.gridAutoRows,詰め方:cs.gridAutoFlow,
     行を持つ塊:blocks.filter(has).length,塊:blocks.length,
     持たない:blocks.filter(e=>!has(e)).map(e=>e.dataset.rpBlock+':'+(e.style.gridRow||e.style.gridRowEnd||'—')),
     /* 紙は`--rp-scale`で縮めて見せている（§9.174）。**倍率を打ち消してから
        寸法を比べること**——縮めただけで「行数ぶんの高さが無い」ことになる。 */
     倍率:Number(getComputedStyle(document.querySelector('.rp-page')).getPropertyValue('--rp-scale'))||1};
  });
  /* 1行の高さは**紙から作る**ようになった（§9.221 ⑨。紙の縦÷段数）ので、
     24pxのような整数pxとはかぎらない（実測88.5px）。見たいのは「1行ぶんが
     決まっていること」なので、単位と正の値だけを見る。 */
  rec('行も粗いグリッド（1行ぶんの高さが決まっている）',/px$/.test(grid.行の高さ)&&parseFloat(grid.行の高さ)>0,
      grid.行の高さ);
  rec('空いた横へ回り込ませる（dense）',/dense/.test(grid.詰め方),grid.詰め方);
  rec('どの塊も「何行ぶんか」を持つ（中身なりは描いてから測る）',
      grid.塊>0&&grid.行を持つ塊===grid.塊,
      `${grid.行を持つ塊}/${grid.塊}`+(grid.持たない.length?' 持たない: '+grid.持たない.join('／'):''));

  /* ---- 2) 背の高い塊の横へ、低い塊が下の段まで回り込む ----
     **確かめるときは形を自分で作ること**——たまたま高さの揃ったロットでは
     跨ぎの道を一度も通らない。3つだけ残し、1枚を12行・2枚を2行にする。 */
  const keys=await page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));
  const all=await page.evaluate(()=>{
   /* 出していない塊も含めた全部の名前（パレットの分母）。 */
   return (typeof WL!=='undefined'&&window.__rpKeys)?window.__rpKeys():null;
  });
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    order:[A,C1,C2],
    hidden:[],
    widths:{[A]:6*UNIT,[C1]:6*UNIT,[C2]:6*UNIT,
            /* **低い2枚は中身が確実に収まる行数にする**——2行(48px)だと
               中身のほうが高くなり、次の塊へはみ出して「跨ぎ」の判定が
               どちらとも取れなくなる（実測でそうなった）。 */
            [`行数:${A}`]:12*CUNIT,[`行数:${C1}`]:3*CUNIT,[`行数:${C2}`]:3*CUNIT}});
  await page.evaluate(t=>WL.columnLayout.forget(t),TARGET);
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  /* この3つ以外は「並びに載っていない」だけで出てしまうので、隠して絞る。 */
  const rest=keys.filter(k=>k!==A&&k!==C1&&k!==C2);
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',hidden:rest});
  await page.evaluate(t=>WL.columnLayout.forget(t),TARGET);
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  const saved=await getj('/api/column-layout-master?target='+encodeURIComponent(TARGET));
  rec('前提: 行数がマスタに入っている',
      (saved.widths||{})[`行数:${A}`]===12*CUNIT&&(saved.widths||{})[`行数:${C1}`]===3*CUNIT,
      JSON.stringify({[`行数:${A}`]:(saved.widths||{})[`行数:${A}`],
                      [`行数:${C1}`]:(saved.widths||{})[`行数:${C1}`]}));
  const geo=await page.evaluate(([a,c1,c2])=>{
   const r=k=>{const e=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
     if(!e)return null;const b=e.getBoundingClientRect();
     return{top:Math.round(b.top),bottom:Math.round(b.bottom),left:Math.round(b.left),h:Math.round(b.height)}};
   const st=k=>{const e=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
     return e?{行:e.style.gridRow||e.style.gridRowEnd||'',最小高:e.style.minHeight||''}:null};
   return{A:r(a),B:r(c1),C:r(c2),Aの指定:st(a),
     出ている塊:[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock)};
  },[A,C1,C2]);
  rec('前提: 3つだけ紙に出ている',geo.出ている塊.length===3,geo.出ている塊.join('／'));
  /* 紙は縮めて見せているので、**倍率を打ち消してから**比べる（§9.174）。 */
  const sc=grid.倍率||1;
  rec('背の高い塊は行数ぶんの高さを持つ',
      !!geo.A&&geo.A.h/sc>=12*parseFloat(grid.行の高さ)-6,
      JSON.stringify({寸法:geo.A,指定:geo.Aの指定,倍率:sc}));
  rec('低い塊は背の高い塊の横に並ぶ',
      !!geo.A&&!!geo.B&&Math.abs(geo.A.top-geo.B.top)<=2&&geo.B.left>geo.A.left,
      JSON.stringify({A:geo.A,B:geo.B}));
  /* ここが「跨ぐ」の実体——Cは**Bの下**だが、まだ**Aの下端より上**にいる。
     以前の暗黙の行では、Aのいる段がAの高さになるのでCはAの下へ落ちていた。 */
  rec('その下にもう1枚が入り、背の高い塊はまだ続いている（跨ぎ）',
      !!geo.C&&geo.C.top>geo.B.bottom-2&&geo.C.top<geo.A.bottom-2,
      JSON.stringify({A:geo.A,B:geo.B,C:geo.C}));

  /* ---- 3) パレット ---- */
  await page.click('#reportArrange');
  await page.waitForSelector('#rpPalette:not([hidden])',{timeout:8000});
  await settle(page);
  const pal=await page.evaluate(()=>({
   件数:document.querySelectorAll('#rpPalette [data-rp-pal]').length,
   見出し:(document.querySelector('.rp-palette-head')||{}).textContent||'',
   案内:(document.querySelector('.rp-palette-note')||{}).textContent||'',
   大きさを書く:[...document.querySelectorAll('.rp-palette-size')].map(x=>x.textContent).slice(0,3),
   紙の外:!document.querySelector('.rp-page #rpPalette'),
  }));
  rec('出していない塊がパレットに並ぶ',pal.件数>0,`${pal.件数}件 / ${pal.見出し}`);
  rec('パレットは紙の外に置く（刷り上がりに混ざらない）',pal.紙の外===true);
  rec('規格の大きさを名前と一緒に書く',
      pal.大きさを書く.length>0&&pal.大きさを書く.every(t=>/マス×/.test(t)),
      JSON.stringify(pal.大きさを書く));
  rec('できること（掴む／落とす／押す）を書く',
      /掴んで/.test(pal.案内)&&/外れ/.test(pal.案内)&&/押すだけ/.test(pal.案内),pal.案内);
  /* 押すだけでも出せる（§4。掴めない環境で行き止まりにしない）。 */
  const first=await page.evaluate(()=>document.querySelector('#rpPalette [data-rp-pal]').dataset.rpPal);
  await page.click(`#rpPalette [data-rp-pal="${first.replace(/"/g,'\\"')}"]`).catch(async()=>{
   await page.evaluate(k=>document.querySelector(`#rpPalette [data-rp-pal="${CSS.escape(k)}"]`).click(),first);
  });
  await page.waitForTimeout(600);
  const afterClick=await page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));
  rec('パレットを押すと紙に出る',afterClick.includes(first),`${first} / ${afterClick.length}件`);

  /* ---- 4) 紙の塊をパレットへ落とすと外れる ---- */
  const removed=await page.evaluate(k=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
   const pal=document.getElementById('rpPalette');
   el.dispatchEvent(new DragEvent('dragstart',{bubbles:true}));
   pal.dispatchEvent(new DragEvent('dragover',{bubbles:true}));
   const marked=pal.classList.contains('is-target');
   pal.dispatchEvent(new DragEvent('drop',{bubbles:true}));
   return {marked};
  },C2);
  await page.waitForTimeout(700);
  /* **外した塊は配置面から消える**（§9.222 ③、利用者の指示）。以前は
     薄く残していたが、外した塊がマスを押さえるので置き場所が無くなり、
     ゴーストが重なって位置調整ができなかった。**消えるだけでは足りない**
     ——行き先（置き場）に並んでいることまで見る。 */
  const afterDrop=await page.evaluate(k=>({
   紙から消えた:!document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`),
   パレットに居る:[...document.querySelectorAll('#rpPalette [data-rp-pal]')].some(x=>x.dataset.rpPal===k),
  }),C2);
  rec('落とせる場所だと分かる印が出る',removed.marked===true);
  rec('紙の塊をパレットへ落とすと外れて置き場へ移る',
      afterDrop.紙から消えた===true&&afterDrop.パレットに居る===true,JSON.stringify(afterDrop));

  /* ==========================================================
     6) 掴んだところと落ちるところが一致する（§9.222 ②）
     ----------------------------------------------------------
     利用者の指摘「ドラッグ位置とゴーストの位置が合わない。**移動量が
     多いほどずれを感じる**」。原因は、紙が`--rp-scale`で縮んでいるのに
     `getBoundingClientRect()`（拡大後）と`gap`/`gridAutoRows`（拡大前）を
     そのまま割り算していたこと——器の左上から離れるほど誤差が積み上がる。
     **等倍では出ない**ので、まず倍率が1でないことを前提として見る
     （等倍のまま測ると、直す前でも通る）。
     見るのは実装の式ではなく**「カーソルがゴーストの中に居るか」**
     ——式を写して比べると、同じ間違いをした式どうしで一致してしまう。
     ========================================================== */
  const drift=await page.evaluate(()=>{
   const pal=document.querySelector('#rpPalette [data-rp-pal]');
   const grid=document.querySelector('.rp-page .rp-blocks');
   const paper=document.querySelector('.rp-page');
   if(!pal||!grid)return {前提なし:true};
   const sc=Number(getComputedStyle(paper).getPropertyValue('--rp-scale'))||1;
   const gr=grid.getBoundingClientRect();
   const out=[];
   pal.dispatchEvent(new DragEvent('dragstart',{bubbles:true}));
   /* 器の左上から遠いほどずれるので、**下のほう・右のほう**で見る。 */
   for(const [fx,fy] of [[0.2,0.2],[0.5,0.6],[0.8,0.88]]){
    const x=gr.left+gr.width*fx, y=gr.top+gr.height*fy;
    grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y}));
    const g=document.getElementById('rpGhost');
    const r=g?g.getBoundingClientRect():null;
    out.push({fx,fy,中に居る:!!r&&x>=r.left-1&&x<=r.right+1&&y>=r.top-1&&y<=r.bottom+1,
      ずれ:r?{dx:Math.round(x-r.left),dy:Math.round(y-r.top),h:Math.round(r.height)}:null});
   }
   pal.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   return {倍率:Number(sc.toFixed(3)),out};
  });
  rec('前提: 紙は縮めて出ている（等倍だと倍率の取り違えが出ない）',
      !drift.前提なし&&drift.倍率<0.95,JSON.stringify({倍率:drift.倍率}));
  rec('掴んだ先のゴーストの中にカーソルが居る（紙の下のほうでも）',
      !drift.前提なし&&drift.out.every(o=>o.中に居る),JSON.stringify(drift.out));

  /* 塊の**右下**を掴んで同じ場所へ持っていくと、ゴーストはその塊の位置の
     まま——掴んだところのぶんを引かないと、掴んだぶんだけ塊が飛ぶ。 */
  const grab=await page.evaluate(()=>{
   const el=document.querySelector('.rp-block.is-placed[data-rp-block]');
   if(!el)return {塊なし:true};
   const r=el.getBoundingClientRect();
   const x=r.right-6,y=r.bottom-6;
   const grid=el.parentElement;
   el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,clientX:x,clientY:y}));
   grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y}));
   const g=document.getElementById('rpGhost');
   const out={塊:el.style.gridColumn+' / '+el.style.gridRow,
     ゴースト:g?g.style.gridColumn+' / '+g.style.gridRow:null,
     大きさ:{w:Math.round(r.width),h:Math.round(r.height)}};
   el.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   return out;
  });
  rec('右下を掴んで動かさなければ、ゴーストは元の場所のまま',
      !grab.塊なし&&grab.ゴースト===grab.塊,JSON.stringify(grab));

  /* ==========================================================
     7) 「中身なり」の高さは**中身**から決まる（§9.222 ②）
     ----------------------------------------------------------
     器は`grid-auto-rows`で1行ぶんに決まっていて`overflow:hidden`なので、
     `getBoundingClientRect().height`は**いつも1行**を返す。それを1行で
     割れば必ず1行になり、どの塊も伸びない——段数が12だった頃は1行が88px
     あってたまたま入っていたが、48段（1行22px）にした瞬間に**全部の塊が
     「入りきりません」**になった。**中身（`.rp-block-fit`の`scrollHeight`）を
     測ること。**
     ここで見るのは「1行しかない塊が並んでいないこと」と「入りきらない印が
     出ていないこと」——数を数えるだけの網では、1行の塊が1つでもあれば
     本物か偶然かを見分けられないので、**割合**で見る。
     ========================================================== */
  const fitRows=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.rp-blocks [data-rp-block]')];
   const rows=els.map(e=>{
    const m=/span\s+(\d+)\s*$/.exec(e.style.gridRow||e.style.gridRowEnd||'');
    return m?Number(m[1]):0;
   });
   return {塊:els.length,一行:rows.filter(r=>r===1).length,
     最大:Math.max(0,...rows),
     入りきらない:document.querySelectorAll('.rp-blocks .is-cramped').length,
     段数:Number(getComputedStyle(document.querySelector('.rp-blocks'))
       .getPropertyValue('--rp-page-rows'))||0};
  });
  rec('前提: 紙は48段以上で割られている',fitRows.段数>=48,String(fitRows.段数));
  rec('中身なりの塊が1行に潰れていない',
      fitRows.塊>0&&fitRows.一行<=1&&fitRows.最大>=3,JSON.stringify(fitRows));
  rec('既定の並びで「入りきりません」が出ない',
      fitRows.入りきらない===0,JSON.stringify(fitRows));

  /* ---- 5) ゴーストは実物大 ---- */
  const ghost=await page.evaluate(k=>{
   const it=document.querySelector(`#rpPalette [data-rp-pal="${CSS.escape(k)}"]`);
   if(!it)return{パレットに無い:true};
   it.dispatchEvent(new DragEvent('dragstart',{bubbles:true}));
   const target=document.querySelector('[data-rp-block]');
   const r=target.getBoundingClientRect();
   target.dispatchEvent(new DragEvent('dragover',
     {bubbles:true,clientX:Math.round(r.left+2),clientY:Math.round(r.top+2)}));
   const g=document.getElementById('rpGhost');
   const out=g?{幅:g.style.gridColumn,高さ:g.style.gridRow,文:g.textContent,
     グリッドの中:g.parentElement.classList.contains('rp-blocks'),
     位置:[...g.parentElement.children].indexOf(g)}:null;
   it.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   return {out,消えた:!document.getElementById('rpGhost')};
  },C2);
  rec('掴むと落ちる場所にゴーストが出る',!!ghost.out&&ghost.out.グリッドの中===true,
      JSON.stringify(ghost.out));
  /* 置き場所を利用者が決める形にした（§9.221 ⑨）ので、ゴーストは
     `<列>/span <幅>`のようにマスも名指しする。**幅と高さがマス数で
     出ていること**を見る（`span N`だけの形も、まだ置き場所の決まって
     いない塊で出るので両方通す）。 */
  const spanish=v=>/(^|\/\s*)span\s+\d+/.test(String(v||''));
  rec('ゴーストは掴んだ塊と同じ幅・高さ',
      !!ghost.out&&spanish(ghost.out.幅)&&spanish(ghost.out.高さ),
      JSON.stringify(ghost.out&&{幅:ghost.out.幅,高さ:ghost.out.高さ}));
  rec('どの塊が入るのかを文字で言う',!!ghost.out&&ghost.out.文.includes(C2),
      String(ghost.out&&ghost.out.文));
  rec('離したらゴーストは消える',ghost.消えた===true);

  /* ---- 6) 帳票ブロックマスタで作った塊 ---- */
  const mk=await (await post('/api/report-block-master',
    {equipment:EQ,name:TAG+' 自作',span:6,rows:3,
     content:'ロット番号=basic.lotNo\n入力内容=settings.measureType',user_id:'test'})).json();
  madeBlock=mk.id;
  rec('自作の塊をマスタへ足せる',!!mk.id,JSON.stringify(mk));
  const api=await getj('/api/report-block-master?equipment='+encodeURIComponent(EQ));
  const hit=(api.items||[]).find(x=>x.name===TAG+' 自作');
  rec('内容は「ラベル=出どころ」で読む',
      !!hit&&hit.fields.length===2&&hit.fields[0].label==='ロット番号'
      &&hit.fields[0].path==='basic.lotNo',JSON.stringify(hit&&hit.fields));
  rec('幅と行数は規格へ丸める',!!hit&&hit.span===6&&hit.rows===3,
      JSON.stringify(hit&&{span:hit.span,rows:hit.rows}));
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  await page.click('#reportArrange');
  await page.waitForSelector('#rpPalette:not([hidden])',{timeout:8000});
  await settle(page);
  const inPal=await page.evaluate(t=>{
   const it=[...document.querySelectorAll('#rpPalette [data-rp-pal]')].find(x=>x.dataset.rpPal===t);
   if(!it)return{無い:true};
   it.click();
   return{有る:true};
  },TAG+' 自作');
  await page.waitForTimeout(700);
  const made=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   return el?{題:(el.querySelector('h3')||{}).textContent||'',本文:el.textContent||''}:null;
  },TAG+' 自作');
  rec('自作の塊は既定では紙に出さず、候補として並ぶ',inPal.有る===true,JSON.stringify(inPal));
  rec('紙へ出すと中身が出る',!!made&&/ロット番号/.test(made.本文)&&/入力内容/.test(made.本文),
      JSON.stringify(made&&{題:made.題}).slice(0,120));

  /* ================================================================
     §9.218 ⑥ 大きさとグリッドが見えること（利用者の指示）
     「ブロックを選択してもサイズがわからないし、D&Dでつかんでもゴーストが
      サイズで出ないのでわかりにくい、つかんだときにサイズがわかるように
      してほしい。選択したときに縦横のサイズ変更ができるように。また配置の
      しにくさはグリッドとの関係性がわからないことにありそうです」
     ================================================================ */
  /* 掴む前に読めること＝操作帯に「何マス×何行」が出ている。 */
  const dim=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   const d=el&&el.querySelector('.rp-block-dim');
   return d?d.textContent.trim():null;
  },A);
  rec('塊の大きさが操作帯に出る（掴む前に読める）',
      !!dim&&/\d+\/\d+マス×/.test(dim),String(dim));
  /* 縁を引くと大きさが変わる。**取っ手は3つ**（幅・高さ・両方）。 */
  const grips=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   return el?[...el.querySelectorAll('[data-rp-grip]')].map(g=>g.dataset.rpGrip):null;
  },A);
  rec('縁に大きさを変える取っ手が付く',
      !!grips&&grips.join('/')==='w/h/wh',JSON.stringify(grips));
  /* **実際に引いて確かめる**——取っ手が在ることだけを見る網は、掴んでも
     何も起きない実装でも通る（§9.213と同じ約束）。 */
  const before=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   const r=el.getBoundingClientRect();
   const grip=el.querySelector('[data-rp-grip="w"]');
   const g=grip.getBoundingClientRect();
   /* **画面に出ている場所を狙う。** 紙は`--rp-scale`で縮めて縦に長いので、
      背の高い塊は下端が画面の外へ出る——取っ手の「まん中」を計算すると
      ビューポートの外を指し、`elementFromPoint`は器（MAIN）を返す
      （実測: 取っ手6x612px・まん中y=999で画面の高さ1000）。
      取っ手と画面の重なりの中から取る。 */
   const gx=Math.round(g.left+g.width/2);
   const lo=Math.max(g.top+6,6),hi=Math.min(g.bottom-6,window.innerHeight-6);
   const gy=Math.round(hi>lo?(lo+hi)/2:lo);
   /* **掴めることを先に確かめる。** 覆われていると`pointerdown`が別の
      要素へ行き、ログには「幅が変わらない」としか残らない。 */
   const top=document.elementFromPoint(gx,gy);
   return {w:Math.round(r.width),gx,gy,
     取っ手:[Math.round(g.width),Math.round(g.height)].join('x'),
     上に居るもの:top?(top.tagName+'.'+(top.className||'')).slice(0,60):'なし',
     掴める:top===grip};
  },A);
  rec('幅の取っ手が実際に掴める位置に出ている',before.掴める===true,JSON.stringify(before));
  await page.mouse.move(before.gx,before.gy);
  await page.mouse.down();
  await page.mouse.move(before.gx-180,before.gy,{steps:8});
  const tip=await page.evaluate(()=>{
   const t=document.querySelector('.rp-size-tip');return t?t.textContent.trim():null;
  });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const after=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   return el?Math.round(el.getBoundingClientRect().width):0;
  },A);
  rec('引いている最中に何マス×何行かを出す',!!tip&&/マス ×/.test(tip),String(tip));
  rec('縁を引くと幅が実際に狭くなる',after>0&&after<before.w-40,
      JSON.stringify({前:before.w,後:after}));
  /* 組み換え中はマスの線が引かれる（**要素ではなく背景**——グリッドの子に
     すると位置の決まった子が先に置かれて塊が押し出される）。 */
  const guide=await page.evaluate(()=>{
   const g=document.querySelector('#reportContent .rp-blocks');
   const cs=getComputedStyle(g);
   return {線:cs.backgroundImage,列:cs.getPropertyValue('--rp-grid').trim(),
           空き:g.querySelectorAll('.rp-free').length,
           層:!!g.querySelector('.rp-free-layer')};
  });
  rec('組み換え中はマスの線が背景で引かれる',
      /linear-gradient/.test(guide.線)&&Number(guide.列)>=24,JSON.stringify({列:guide.列}));
  rec('空いているマスが枠で見える',guide.層===true&&guide.空き>0,
      JSON.stringify({層:guide.層,空き:guide.空き}));
  /* **空きの印がグリッドの並びを崩さないこと。** 位置を数字で指定した子を
     グリッドへ入れると、`span`しか持たない塊より先に置かれて押し出される
     ——実際にそうなる作りにしていたら、この網が捕まえる。 */
  const layered=await page.evaluate(()=>{
   const g=document.querySelector('#reportContent .rp-blocks');
   const free=g.querySelector('.rp-free-layer');
   return {子:free&&free.parentElement===g,
           位置:free?getComputedStyle(free).position:'',
           塊が先:[...g.children].findIndex(x=>x.dataset.rpBlock!==undefined)===0};
  });
  rec('空きの印は重ねる層で、並びに加わらない',
      layered.子===true&&layered.位置==='absolute'&&layered.塊が先===true,
      JSON.stringify(layered));
  /* ==========================================================
     空きマスの印は**塊の上に乗らない**（§9.222 ②）
     ----------------------------------------------------------
     `rpFreeCells()`は`getBoundingClientRect()`（拡大後）と`gap`/
     `grid-auto-rows`（拡大前）を混ぜて割っていたため、器の左上から離れる
     ほどマスの見立てがずれ、**塊の載っているマスを「空き」と描いていた**
     （落とせる場所を示す印なので、これは嘘の案内になる）。
     **枠の数だけを見る網では捕まらない**ので、実際に重なっていないかを
     矩形どうしで見る。印は層の中で拡大前の座標で置かれるが、
     `getBoundingClientRect()`はどちらも同じ拡大後なので直接比べられる。
     ========================================================== */
  const overlapFree=await page.evaluate(()=>{
   const g=document.querySelector('#reportContent .rp-blocks');
   if(!g)return {前提なし:true};
   const bs=[...g.querySelectorAll('[data-rp-block]')].map(e=>({
     k:e.dataset.rpBlock,r:e.getBoundingClientRect()}));
   const fs=[...g.querySelectorAll('.rp-free')].map(e=>e.getBoundingClientRect());
   const hit=[];
   const M=3;                                  /* 罫線と丸めのぶん */
   fs.forEach((f,i)=>bs.forEach(b=>{
    const w=Math.min(f.right,b.r.right)-Math.max(f.left,b.r.left);
    const h=Math.min(f.bottom,b.r.bottom)-Math.max(f.top,b.r.top);
    if(w>M&&h>M)hit.push({印:i,塊:b.k,重なり:Math.round(w)+'x'+Math.round(h)});
   }));
   return {印:fs.length,塊:bs.length,重なり:hit.slice(0,4),件数:hit.length};
  });
  rec('空きマスの印が塊に重ならない（拡大前後の座標を混ぜていない）',
      !overlapFree.前提なし&&overlapFree.印>0&&overlapFree.塊>0&&overlapFree.件数===0,
      JSON.stringify(overlapFree));

  /* ==========================================================
     **重なっても置ける。置いたことは見えるところで言う**（§9.223 ③）
     ----------------------------------------------------------
     利用者の指示「任意の場合のカード移動のみ、重なっても配置でき、重なった
     部分を強調表示など視覚表示で修正をうながす」。以前は埋まっているマスへ
     落とすと**断って何もしなかった**ので、詰めたい場所へ一度も置けなかった。
     いまは置いたうえで①塊の赤い縁 ②重なったマスの赤い網 ③帯のチップ
     ④一言、で直すよう促す。
     一言は`?`で畳める案内の中にあるので、**畳んだままでも読めること**まで
     見る（`hidden`の中でも`textContent`は取れるので、実寸で見る）。
     ========================================================== */
  const refuse=await page.evaluate(()=>{
   const note=document.getElementById('rpArrangeNote');
   const el=document.querySelector('.rp-block.is-placed[data-rp-block]');
   const other=[...document.querySelectorAll('.rp-block.is-placed[data-rp-block]')]
     .find(x=>x!==el);
   if(!note||!el||!other)return {前提なし:true};
   const 畳んでいる=note.hidden===true;
   const k=el.dataset.rpBlock;
   const was=el.style.gridRow+'/'+el.style.gridColumn;
   const r=other.getBoundingClientRect();
   const grid=el.parentElement;
   const x=r.left+r.width/2,y=r.top+r.height/2;
   el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,clientX:el.getBoundingClientRect().left+4,
     clientY:el.getBoundingClientRect().top+4}));
   grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y}));
   grid.dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:x,clientY:y}));
   el.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   const n2=document.getElementById('rpArrangeNote');
   const now=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
   return {畳んでいる,塊:k,
     動いた:!!now&&(now.style.gridRow+'/'+now.style.gridColumn)!==was,
     文:(n2?n2.textContent:'').includes('重ね'),
     見えている:!!(n2&&!n2.hidden&&n2.offsetParent!==null&&n2.getBoundingClientRect().height>0)};
  });
  rec('埋まっているマスへも落とせる（自動で別の場所へ逃がさない）',
      !refuse.前提なし&&refuse.動いた===true,JSON.stringify(refuse));
  rec('重ねたことは畳んだ案内の中に隠れず読める',
      !refuse.前提なし&&refuse.畳んでいる===true&&refuse.文===true&&refuse.見えている===true,
      JSON.stringify(refuse));
  /* **重なったマスそのものが赤い網で出る**（縁だけでは、どこが当たっている
     のかが読めない）。数だけを見る網では捕まらないので、実際に重なりの
     矩形が塊と重なっていることまで見る。 */
  await settle(page);
  const hatch=await page.evaluate(()=>{
   const g=document.querySelector('#reportContent .rp-blocks');
   const cells=[...g.querySelectorAll('.rp-overlap-cell')];
   const over=[...g.querySelectorAll('.rp-block.is-overlap')];
   if(!cells.length||!over.length)return {網:cells.length,縁:over.length,乗っている:false};
   const c=cells[0].getBoundingClientRect();
   const hit=over.some(b=>{
    const r=b.getBoundingClientRect();
    return Math.min(c.right,r.right)-Math.max(c.left,r.left)>2
        && Math.min(c.bottom,r.bottom)-Math.max(c.top,r.top)>2;
   });
   return {網:cells.length,縁:over.length,乗っている:hit};
  });
  rec('重なったマスが赤い網で出て、重なった塊の上に乗っている',
      hatch.網>0&&hatch.縁>0&&hatch.乗っている===true,JSON.stringify(hatch));

  /* ==========================================================
     **編集中のカードは「刷ったとおり」**（§9.223 ①、利用者の指示）
     ----------------------------------------------------------
     「各カードのサイズ表示や幅調整ボタンは、マウスオーバーの時のみレイヤーで
      表示させ、編集中画面のカードの見た目は常に実際に出力される見た目を
      再現してほしい。詰めておきたいのに実際と違う見た目のままサイズや位置の
      調整を行っているズレを解消したい。」
     帯を流れの中に置くと、その高さのぶん中身が下へ押されるので、**中身の
     上端が器の上端と一致するか**で見る（「帯があること」だけを見る網では
     捕まらない——流れの中でも層でも、帯は在る）。
     ========================================================== */
  const asPrint=await page.evaluate(()=>{
   /* **重なり・入りきらない塊は帯を出しっぱなし**にしてあるので、
      「触れるまで見えない」はふつうの塊で見る（この網より前で重ねている）。 */
   const el=document.querySelector(
     '#reportContent .rp-block[data-rp-block]:not(.is-overlap):not(.is-overflow)');
   if(!el)return {前提なし:true};
   const fit=el.querySelector(':scope>.rp-block-fit');
   const tools=el.querySelector(':scope>.rp-block-tools');
   if(!fit||!tools)return {前提なし:true,fit:!!fit,tools:!!tools};
   const er=el.getBoundingClientRect(),fr=fit.getBoundingClientRect();
   const cs=getComputedStyle(tools);
   return {ずれ:Math.round(fr.top-er.top),
           層:cs.position,
           触れる前は見えない:cs.visibility==='hidden'||Number(cs.opacity)===0};
  });
  rec('組み換え中でも中身は器の上端から始まる（帯が押し下げない）',
      !asPrint.前提なし&&Math.abs(asPrint.ずれ)<=1,JSON.stringify(asPrint));
  rec('操作帯は重ねる層で、触れるまで見えない',
      !asPrint.前提なし&&asPrint.層==='absolute'&&asPrint.触れる前は見えない===true,
      JSON.stringify(asPrint));
  /* 触れたら出ること。**出ないなら操作できない**ので、見えないだけでは足りない。
     CSSの`:hover`はイベントでは付かないので、同じ条件（`is-overlap`＝直して
     ほしい塊は出しっぱなし）で確かめる。**淡く出るのに時間がかかる**ので、
     固定待ちではなく「出るまで待つ」（`transition`は120ms・§9.102）。 */
  const marked=await page.evaluate(()=>{
   const el=document.querySelector(
     '#reportContent .rp-block[data-rp-block]:not(.is-overlap):not(.is-overflow)');
   if(!el)return false;
   el.dataset.rpProbe='1';el.classList.add('is-overlap');return true;
  });
  let onHover={前提なし:!marked};
  if(marked){
   let shown=false;
   try{
    await page.waitForFunction(()=>{
     const el=document.querySelector('[data-rp-probe="1"]');
     const t=el&&el.querySelector(':scope>.rp-block-tools');
     if(!t)return false;
     const cs=getComputedStyle(t);
     return cs.visibility!=='hidden'&&Number(cs.opacity)>0.5;
    },null,{timeout:4000});
    shown=true;
   }catch(e){}
   onHover=await page.evaluate(s=>{
    const el=document.querySelector('[data-rp-probe="1"]');
    const t=el&&el.querySelector(':scope>.rp-block-tools');
    const cs=t?getComputedStyle(t):null;
    if(el){el.classList.remove('is-overlap');delete el.dataset.rpProbe}
    return {見える:s,可視性:cs?cs.visibility:'',濃さ:cs?cs.opacity:''};
   },shown);
  }
  rec('直してほしい塊（重なり）では帯を出しっぱなしにする',
      !onHover.前提なし&&onHover.見える===true,JSON.stringify(onHover));

  /* **空きは紙の地と違う色**（§9.223 ②、利用者の指摘「他のエリアと色が同じで
     空欄の場所が認識しにくい」）。塊は白なので、白との差が付いているかを
     実際の計算値で見る（`rgba(...,.05)`では差が出ていなかった）。 */
  const emptyColor=await page.evaluate(()=>{
   const f=document.querySelector('#reportContent .rp-free');
   const b=document.querySelector('#reportContent .rp-block[data-rp-block]');
   if(!f||!b)return {前提なし:true};
   const num=c=>(String(c).match(/[\d.]+/g)||[]).map(Number);
   const fc=num(getComputedStyle(f).backgroundColor),bc=num(getComputedStyle(b).backgroundColor);
   const d=Math.abs((fc[0]||0)-(bc[0]||0))+Math.abs((fc[1]||0)-(bc[1]||0))+Math.abs((fc[2]||0)-(bc[2]||0));
   return {空き:getComputedStyle(f).backgroundColor,塊:getComputedStyle(b).backgroundColor,差:d,
           網:/gradient/.test(getComputedStyle(f).backgroundImage)};
  });
  rec('空きマスの色が塊の地と見分けられる',
      !emptyColor.前提なし&&emptyColor.差>=18&&emptyColor.網===true,JSON.stringify(emptyColor));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  if(madeBlock){try{await post('/api/report-block-master/delete',{id:madeBlock,user_id:'test'})}catch(e){}}
  await cleanup();
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 /* ランナーはFAILを4件までしか見せないので、**全部をファイルにも残す**
    （直すときに何件目で何が起きたのかを毎回追い直さないため）。 */
 try{fs.writeFileSync('/tmp/wl-rplayout.json',JSON.stringify(R,null,1))}catch(e){}
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
