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
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
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
  /* この3つ以外は「並びに載っていない」だけで出てしまうので、隠して絞る。
     **分母は「いま出ている塊」ではなく全部**（§9.244）——`hidden`を書いた
     時点で`order`が埋まり、以降`rpInitialHidden()`（既定で出さない塊）は
     見に行かなくなる。出ている塊だけを隠すと、**既定で伏せてあった塊が
     そこで出てくる**（測定値の統計を足したときに実際に踏んだ）。 */
  const allKeys=await page.evaluate(()=>
    (window.WL&&WL.reportBlocks&&WL.reportBlocks.keys)?WL.reportBlocks.keys():null);
  const rest=(allKeys||keys).filter(k=>k!==A&&k!==C1&&k!==C2);
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
   大きさを書く:[...document.querySelectorAll('.rp-palette-size')].map(x=>x.textContent).slice(0,3),
   紙の外:!document.querySelector('.rp-page #rpPalette'),
   /* §9.276 ①。**左サイドバーの中**（上の帯ではない）。 */
   サイドバーの中:!!document.querySelector('.rp-nav #rpPalette'),
   縦積み:(()=>{const l=document.querySelector('.rp-palette-list');
     return l?getComputedStyle(l).flexDirection:''})(),
   案内の入口:!!document.querySelector('[data-rp-pal-help]'),
   浮き出しは閉じている:!document.getElementById('rpPaletteHelp'),
  }));
  rec('出していない塊がパレットに並ぶ',pal.件数>0,`${pal.件数}件 / ${pal.見出し}`);
  rec('パレットは紙の外に置く（刷り上がりに混ざらない）',pal.紙の外===true);
  rec('パレットは左サイドバーの中に縦積みで置く（§9.276 ①）',
      pal.サイドバーの中===true&&pal.縦積み==='column',JSON.stringify(pal));
  rec('規格の大きさを名前と一緒に書く',
      pal.大きさを書く.length>0&&pal.大きさを書く.every(t=>/マス×/.test(t)),
      JSON.stringify(pal.大きさを書く));
  /* できること（掴む／落とす／押す）は**押したときだけ出す**（§9.276 ①）。
     **消さないこと**——札の形からは「押すだけでも出せる」が読めない。
     **「入口がある」だけを見ないこと**——押して中身まで見る。 */
  rec('使い方の入口が置き場にある（常時1行を占めない）',
      pal.案内の入口===true&&pal.浮き出しは閉じている===true,JSON.stringify(pal));
  await page.evaluate(()=>document.querySelector('[data-rp-pal-help]').click());
  await page.waitForSelector('#rpPaletteHelp',{timeout:5000});
  const helpTxt=await page.evaluate(()=>{
   const d=document.getElementById('rpPaletteHelp');
   return {文:d.textContent||'',
     /* **器の外へ出す**——`.rp-nav`は`overflow`を持つので中で開くと切れる。 */
     body直下:d.parentElement===document.body,
     画面の中:(()=>{const r=d.getBoundingClientRect();
       return r.left>=0&&r.top>=0&&r.right<=window.innerWidth+1&&r.bottom<=window.innerHeight+1})()};
  });
  rec('できること（掴む／落とす／押す）は浮き出しに書く',
      /掴んで/.test(helpTxt.文)&&/外れ/.test(helpTxt.文)&&/押すだけ/.test(helpTxt.文),helpTxt.文);
  rec('浮き出しは器の外へ出し、画面の中に収める',
      helpTxt.body直下===true&&helpTxt.画面の中===true,JSON.stringify(helpTxt));
  /* **閉じられること**（§9.222 ①。控えないと外クリックでもEscでも閉じない）。 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  rec('浮き出しはEscで閉じる',
      await page.evaluate(()=>!document.getElementById('rpPaletteHelp')));
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
    /* **紙の切れ目には「どの行も無い帯」がある**（§9.282）。行は紙の高さで
       割り切れないので、1枚目の最後の行の裾から2枚目の先頭の行の頭までは
       ——紙と紙のあいだの余白ぶんに加えて1行ぶんまで——どの行も始まらない。
       そこを指したときだけは「枠の中に居る」が原理的に成り立たないので、
       **次の行の頭へ寄せたこと**——枠はカーソルと同じか下、しかも余白＋
       1行ぶん以内——で見る。**手前へ寄せるのは駄目**（枠が紙1枚ぶん上に出て、
       置いた結果が見えているものと違う。「ずらす前の座標へ直してから割る」で
       数えるとまさにそうなる）。
       それ以外の場所では今までどおり**枠の中**を要求する——倍率の取り違えは
       器の下ほど大きく効くので、この緩めでは隠れない。
       紙の在り処は`.rp-sheet`の実寸から数える（ずらし方の式を写して比べると、
       同じ間違いをした式どうしで一致してしまう）。 */
    const sheets=[...document.querySelectorAll('.rp-page .rp-sheet')]
      .map(e=>e.getBoundingClientRect());
    const nrows=Number((/span\s+(\d+)/.exec((g&&g.style.gridRow)||'')||[])[1])||1;
    const rowH=r?r.height/nrows:0;
    const 余白=sheets.length>1?Math.max(0,sheets[1].top-sheets[0].bottom):0;
    const 切れ目のそば=sheets.slice(0,-1).some((b,i)=>
      y>=b.bottom-rowH-1&&y<=sheets[i+1].top+rowH+1);
    const 横は中=!!r&&x>=r.left-1&&x<=r.right+1;
    const 中に居る=横は中&&y>=r.top-1&&y<=r.bottom+1;
    const 次の行の頭へ=横は中&&r.top>=y-2&&r.top-y<=rowH+余白+1;
    out.push({fx,fy,切れ目のそば,中に居る,
      合う:切れ目のそば?次の行の頭へ:中に居る,
      余白:Math.round(余白),行高:Math.round(rowH),
      ずれ:r?{dx:Math.round(x-r.left),dy:Math.round(y-r.top),h:Math.round(r.height)}:null});
   }
   pal.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   return {倍率:Number(sc.toFixed(3)),out};
  });
  rec('前提: 紙は縮めて出ている（等倍だと倍率の取り違えが出ない）',
      !drift.前提なし&&drift.倍率<0.95,JSON.stringify({倍率:drift.倍率}));
  rec('掴んだ先のゴーストの中にカーソルが居る（紙の下のほうでも）',
      !drift.前提なし&&drift.out.every(o=>o.合う),JSON.stringify(drift.out));

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
  /* 掴む前に読めること。**操作帯は廃止した**（§9.226 ⑤）ので、いまは
     ダブルクリックで開く設定の窓が「何マス×何行」を出す。**入口が1つ
     しかないなら、そこに必ず出ていること**を見る（出ていないと、開いても
     いま何マスなのか分からないまま押すことになる）。 */
  /* **ダブルクリックは帳票ブロックマスタへ移る**（§9.274、利用者の指示）
     ——塊そのもの（名前・載せる項目・書式）を直せるのはあちらだけ。
     この紙だけの見え方（幅・高さ・列幅・行列入れ替え）はマスタが持てないので、
     塊の左上の「紙」ボタンが今までの窓を開く。**入口は消していない**（§4）。
     ダブルクリックの行き先そのものは`tests/test_rbcells.js`が見る
     （同じ確認を2箇所に置かない・§9.249 ④）。 */
  await page.click(`[data-rp-block="${A.replace(/"/g,'\\"')}"] [data-rp-paper]`);
  await page.waitForFunction(()=>{
   const m=document.getElementById('rpBlockModal');return !!m&&!m.hidden;
  },null,{timeout:8000});
  await page.waitForTimeout(300);
  const dim=await page.evaluate(()=>{
   const f=document.getElementById('rpBlockForm');
   const n=f&&[...f.querySelectorAll('.rp-form-note')].map(x=>x.textContent).join(' ');
   return {文:n||'',
           /* 浮き帯から移した操作が窓に在ること（入口が消えていない）。 */
           並べ方:f?f.querySelectorAll('[data-e-flow]').length:0,
           幅:f?f.querySelectorAll('[data-e-span]').length:0,
           出す:f?f.querySelectorAll('[data-e-vis]').length:0};
  });
  rec('塊の大きさは設定の窓に出る（掴む前に読める）',
      /\d+\/\d+マス/.test(dim.文)&&dim.幅>=3&&dim.出す===1,JSON.stringify(dim).slice(0,180));
  rec('中の並べ方は設定の窓で選べる',dim.並べ方>=4,String(dim.並べ方));
  /* **押した結果が紙に出ること**（§9.226 ⑤）。クラスが付くだけでは足りない
     ——CSSが当たっているかまで見る（段組なら`column-count`が効く）。 */
  const flow=await page.evaluate(async t=>{
   const b=document.querySelector('#rpBlockForm [data-e-flow="縦"]');
   if(!b)return null;
   b.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   const g=el&&el.querySelector('.rp-grid');
   return {印:!!(el&&el.classList.contains('rp-flow-col')),
           段:g?getComputedStyle(g).columnCount:'',
           表示:g?getComputedStyle(g).display:''};
  },A);
  rec('並べ方を「縦」にすると段組で流れる（押した結果が紙に出る）',
      !!flow&&flow.印===true&&flow.表示==='block'&&Number(flow.段)>=2,
      JSON.stringify(flow));
  await page.evaluate(()=>{
   const b=document.querySelector('#rpBlockForm [data-e-flow=""]');if(b)b.click();
  });
  await page.waitForTimeout(200);
  await page.evaluate(()=>{const c=document.getElementById('rpBlockClose');if(c)c.click()});
  await page.waitForTimeout(300);
  /* 縁を引くと大きさが変わる。**取っ手は四辺＋四隅の8つ**（§9.283、
     利用者の指示「左、左下、左上、上、右上の部分でもすべての頂点、辺で
     サイズ変更できるように」）。綴りは方角（t/b/l/r と四隅）。 */
  const grips=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   return el?[...el.querySelectorAll('[data-rp-grip]')].map(g=>g.dataset.rpGrip):null;
  },A);
  rec('縁に大きさを変える取っ手が8方向とも付く',
      !!grips&&['t','b','l','r','tl','tr','bl','br'].every(k=>grips.includes(k))
      &&grips.length===8,JSON.stringify(grips));
  /* **実際に引いて確かめる**——取っ手が在ることだけを見る網は、掴んでも
     何も起きない実装でも通る（§9.213と同じ約束）。 */
  const before=await page.evaluate(t=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   const r=el.getBoundingClientRect();
   const grip=el.querySelector('[data-rp-grip="r"]');
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

  /* ==========================================================
     §9.283 紙をまたぐ塊も掴めて、取っ手も押せる
     ----------------------------------------------------------
     利用者の報告「今までできていたドラッグアンドドロップによる紙帳票
     レイアウト修正のところができなくなる／位置座標が無茶苦茶でとんでもない
     場所にいってしまいます」。§9.282 で組み換え中もページに割ったところ、
     `clip-path`が**当たり判定まで切る**ため、切れ目にかかる塊は切れ目より
     下が掴めず、大きさを変える取っ手が**1つも押せなくなっていた**
     ——しかも紙からはみ出している塊＝いちばん直したい塊でだけ起きる。
     続きの写し（`.rp-blk-tail`）は`pointer-events:none`の層の中なので、
     そちらを掴んでも何も起きない。
     **切れ目にかかる塊を自分で作ること**——検証用のロットがたまたま1枚に
     収まっていると、この道を一度も通らないまま通ってしまう。
     ========================================================== */
  const pageRows=await page.evaluate(()=>Number(getComputedStyle(
    document.querySelector('#reportContent .rp-blocks')).getPropertyValue('--rp-page-rows'))||48);
  await page.evaluate(([eq,k,n])=>WL.reportLayout.setRows(eq,k,n),[EQ,A,Math.round(pageRows*1.2)]);
  await page.waitForTimeout(700);await settle(page);
  const cut=await page.evaluate(()=>{
   const pg=document.getElementById('reportContent');
   const el=pg.querySelector('.rp-block.is-cut[data-rp-block]');
   const 枚数=getComputedStyle(pg).getPropertyValue('--rp-sheets').trim();
   if(!el)return {前提なし:true,枚数};
   const r=el.getBoundingClientRect();
   /* 塊の中の点。**画面の外は見ない**（`elementFromPoint`は器を返す）。 */
   const pt=f=>{
    const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height*f);
    if(y<4||y>window.innerHeight-4)return null;
    const e=document.elementFromPoint(x,y);
    const own=e&&e.closest?e.closest('[data-rp-block]'):null;
    return own?own.dataset.rpBlock:('×'+(e?(e.className||e.tagName):'なし'));
   };
   const grips=[...el.querySelectorAll('[data-rp-grip]')].map(g=>{
    const gr=g.getBoundingClientRect();
    const x=Math.round(gr.left+gr.width/2);
    const lo=Math.max(gr.top+2,4),hi=Math.min(gr.bottom-2,window.innerHeight-4);
    if(!(gr.width>0)||!(hi>lo))return {g:g.dataset.rpGrip,可:'画面の外'};
    const e=document.elementFromPoint(x,Math.round((lo+hi)/2));
    return {g:g.dataset.rpGrip,可:e===g?true:('×'+((e&&e.className)||''))};
   });
   return {k:el.dataset.rpBlock,枚数,切った:!!el.dataset.rpClip,
     写し:pg.querySelectorAll('.rp-blk-tail').length,
     中:[pt(0.5),pt(0.8)],
     押せない:grips.filter(x=>x.可!==true&&x.可!=='画面の外').map(x=>x.g+x.可)};
  });
  rec('紙をまたぐ塊を作れている（この網の前提）',!cut.前提なし,JSON.stringify(cut));
  rec('組み換え中は塊を切らない（切ると当たり判定まで切れる）',
      !cut.前提なし&&cut.切った===false&&cut.写し===0,JSON.stringify(cut));
  rec('紙をまたぐ塊は切れ目より下でも掴める',
      !cut.前提なし&&cut.中.every(v=>v===null||v===cut.k),JSON.stringify(cut));
  rec('紙をまたぐ塊の取っ手が押せる',
      !cut.前提なし&&cut.押せない.length===0,JSON.stringify(cut));
  await page.evaluate(([eq,k,n])=>WL.reportLayout.setRows(eq,k,n),[EQ,A,12]);
  await page.waitForTimeout(700);await settle(page);

  /* ==========================================================
     §9.283 8方向の取っ手——引いた辺だけが動く
     ----------------------------------------------------------
     利用者の指示「左、左下、左上、上、右上の部分でもすべての頂点、辺で
     サイズ変更できるようにしてください」。**左・上を引くときは置き場所も
     動かす**（書き忘れると、離した瞬間に元の位置へ戻り「幅だけ増えて反対側へ
     伸びた」ように見える）。**掴んでいない辺は釘で留まっていること**まで見る
     ——片側だけを見る網は、塊ごと動く実装でも通る。
     ========================================================== */
  const spotOf=key=>page.evaluate(k=>{
   const el=document.querySelector(`#reportContent [data-rp-block="${CSS.escape(k)}"]`);
   if(!el)return null;
   const c=/^(\d+)\s*\/\s*span\s*(\d+)/.exec(el.style.gridColumn||'');
   const r=/^(\d+)\s*\/\s*span\s*(\d+)/.exec(el.style.gridRow||'');
   return c&&r?{col:+c[1],span:+c[2],row:+r[1],rows:+r[2]}:null;
  },key);
  const gripDrag=async(key,kind,dc,dr)=>{
   const geo=await page.evaluate(([k,g])=>{
    const pg=document.getElementById('reportContent'),grid=pg.querySelector('.rp-blocks');
    const el=pg.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
    const gp=el&&el.querySelector(`[data-rp-grip="${g}"]`);
    if(!gp)return null;
    const r=gp.getBoundingClientRect();
    const gcs=getComputedStyle(grid),gr=grid.getBoundingClientRect();
    const sc=Number(getComputedStyle(pg).getPropertyValue('--rp-scale'))||1;
    const cols=Number(gcs.getPropertyValue('--rp-grid'))||24;
    const gapX=parseFloat(gcs.columnGap)||0;
    const cw=(((gr.width/sc)-gapX*(cols-1))/cols+gapX)*sc;
    const rh=((parseFloat(gcs.gridAutoRows)||0)+(parseFloat(gcs.rowGap)||0))*sc;
    /* **画面の中の点を狙う**（縦に長い塊は下端が画面の外）。 */
    const x=Math.round(r.left+r.width/2);
    const lo=Math.max(r.top+2,4),hi=Math.min(r.bottom-2,window.innerHeight-4);
    if(!(hi>lo))return null;
    return {x,y:Math.round((lo+hi)/2),cw,rh};
   },[key,kind]);
   if(!geo)return false;
   await page.mouse.move(geo.x,geo.y);
   await page.mouse.down();
   await page.mouse.move(geo.x+geo.cw*dc,geo.y+geo.rh*dr,{steps:6});
   await page.mouse.up();
   await page.waitForTimeout(600);await settle(page);
   return true;
  };
  const g0=await spotOf(A);
  const okL1=await gripDrag(A,'l',1,0);            /* 左の辺を右へ＝縮める */
  const g1=await spotOf(A);
  rec('左の辺を引くと置き場所が動き、右端は動かない',
      okL1&&!!g0&&!!g1&&g1.col===g0.col+1&&g1.span===g0.span-1
      &&g1.row===g0.row&&g1.rows===g0.rows,JSON.stringify({前:g0,後:g1}));
  await gripDrag(A,'l',-1,0);                      /* 左の辺を左へ＝広げ戻す */
  const g2=await spotOf(A);
  rec('左の辺は広げる向きにも効く（元の幅へ戻る）',
      !!g2&&g2.col===g0.col&&g2.span===g0.span,JSON.stringify({前:g1,後:g2}));
  const okT1=await gripDrag(A,'t',0,1);            /* 上の辺を下へ＝縮める */
  const g3=await spotOf(A);
  rec('上の辺を引くと行の位置が動き、下端は動かない',
      okT1&&!!g3&&g3.row===g0.row+1&&g3.rows===g0.rows-1
      &&g3.col===g0.col&&g3.span===g0.span,JSON.stringify({前:g2,後:g3}));
  await gripDrag(A,'t',0,-1);
  const g4=await spotOf(A);
  rec('上の辺は広げる向きにも効く（元の高さへ戻る）',
      !!g4&&g4.row===g0.row&&g4.rows===g0.rows,JSON.stringify({前:g3,後:g4}));
  /* **動かした置き場所が設定に書かれていること**——書かないと、次に
     描き直した瞬間に元の位置へ戻る（幅だけ変わったように見える）。 */
  const moved=await page.evaluate(async([t,k])=>{
   const lay=await Promise.resolve(WL.columnLayout.get(t));
   const w=(lay&&lay.widths)||{};
   return {列:w['列:'+k]!==undefined,行:w['行:'+k]!==undefined};
  },[TARGET,A]);
  rec('左・上を引いたら置き場所も設定へ書く',moved.列===true&&moved.行===true,
      JSON.stringify(moved));
  /* **当たっても縮めない**（§9.310、§9.223 ③の利用者の指示「重なっても
     配置でき、重なった部分を強調表示など視覚表示で修正をうながす」）。
     §9.283の「戻し方を2通り試して広いほうを採る」は**撤回した**——戻しが
     在るかぎり、**既に重なっている塊の縁を掴んだ瞬間に1px動かしただけで
     めちゃくちゃ縮む**（利用者の報告）。掴んだ時点で`rpFits()`が偽なので、
     戻しが最初の一手から全力で走るため。いまは重なりとして受け、縮めるのは
     紙の外へ出るときだけ。**幅が潰れないこと**は引き続き固定する。 */
  const c0=await spotOf(A);
  await gripDrag(A,'br',0,40);                     /* 右下の角を**真下へ**大きく */
  const c1=await spotOf(A);
  rec('角を真下へ引くと、当たりで止まらずカーソルなりに伸びる',
      !!c0&&!!c1&&c1.rows>c0.rows,JSON.stringify({前:c0,後:c1}));
  rec('角を真下へ引いても、幅は1マスも潰れない',
      !!c0&&!!c1&&c1.span===c0.span&&c1.col===c0.col,JSON.stringify({前:c0,後:c1}));
  /* 重なったことを画面に出す約束は、**本物の重なりを自分で作る**§9.310 ②の
     節で見る（ここは塊の並び次第で当たらないこともあり、当たりを前提にすると
     「何も確かめていないのに通る／落ちる」網になる）。 */
  /* **後片付け**（§9.121）——ここで変えた高さを戻さないと、以降の
     「重ねて置く」の網が別の形の紙を見ることになる。 */
  await page.evaluate(([eq,k,r])=>WL.reportLayout.setRows(eq,k,r),[EQ,A,12]);
  await page.waitForTimeout(700);await settle(page);

  /* ==========================================================
     §9.283 「行の頭」は切り捨てで数えない
     ----------------------------------------------------------
     `grid-auto-rows`の計算値（22.126px）と実測は0.0002行ぶんずれるので、
     塊の上端を素直に切り捨てると**1行上に居る**ことになり、その塊の下の
     1行が「空き」に見える（実測: 空きマスの枠が44個→1620個で画面が方眼紙に
     なった）。**1行目では端数が出ない**ので、**下のほうの行へ塊を運んでから**
     確かめること——上のほうだけを見る網は、切り捨てに戻しても通る。
     ========================================================== */
  const dropAtRow=async(key,want)=>page.evaluate(([k,w])=>{
   const pg=document.getElementById('reportContent'),grid=pg.querySelector('.rp-blocks');
   const el=pg.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
   if(!el)return false;
   const r=el.getBoundingClientRect(),gr=grid.getBoundingClientRect();
   el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,clientX:r.left+5,clientY:r.top+4}));
   const x=Math.round(gr.left+8);
   let hit=null;
   for(let y=Math.round(gr.top);y<Math.round(gr.bottom);y++){
    grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:y}));
    const g=document.getElementById('rpGhost');if(!g)continue;
    if(Number((/^(\d+)/.exec(g.style.gridRow)||[])[1])===w){hit=y;break}
   }
   if(hit!=null){
    grid.dispatchEvent(new DragEvent('dragover',{bubbles:true,clientX:x,clientY:hit}));
    grid.dispatchEvent(new DragEvent('drop',{bubbles:true,clientX:x,clientY:hit}));
   }
   el.dispatchEvent(new DragEvent('dragend',{bubbles:true}));
   return hit!=null;
  },[key,want]);
  await dropAtRow(A,6);
  await page.waitForTimeout(800);await settle(page);
  const frac=await page.evaluate(t=>{
   const pg=document.getElementById('reportContent'),grid=pg.querySelector('.rp-blocks');
   const el=pg.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
   if(!el)return null;
   const gcs=getComputedStyle(grid);
   const sc=Number(getComputedStyle(pg).getPropertyValue('--rp-scale'))||1;
   const step=(parseFloat(gcs.gridAutoRows)||0)+(parseFloat(gcs.rowGap)||0);
   const top=(el.getBoundingClientRect().top-grid.getBoundingClientRect().top)/sc;
   const v=top/step;
   return {行:(/^(\d+)/.exec(el.style.gridRow)||[])[1],割った:+v.toFixed(5),
     端数:+Math.abs(v-Math.round(v)).toFixed(5),切り捨て:Math.floor(v),四捨五入:Math.round(v)};
  },A);
  rec('下のほうの行では「行の頭」に端数が出る（この網の前提）',
      !!frac&&frac.切り捨て!==frac.四捨五入,JSON.stringify(frac));
  const overlapLow=await page.evaluate(()=>{
   const g=document.querySelector('#reportContent .rp-blocks');
   const bs=[...g.querySelectorAll('[data-rp-block]')].map(e=>({
     k:e.dataset.rpBlock,r:e.getBoundingClientRect()}));
   const fs=[...g.querySelectorAll('.rp-free')].map(e=>e.getBoundingClientRect());
   const hit=[];const M=3;
   fs.forEach((f,i)=>bs.forEach(b=>{
    const w=Math.min(f.right,b.r.right)-Math.max(f.left,b.r.left);
    const h=Math.min(f.bottom,b.r.bottom)-Math.max(f.top,b.r.top);
    if(w>M&&h>M)hit.push({塊:b.k,重なり:Math.round(w)+'x'+Math.round(h)});
   }));
   return {印:fs.length,塊:bs.length,件数:hit.length,例:hit.slice(0,3)};
  });
  rec('端数の出る行でも空きマスの印が塊に重ならない',
      overlapLow.印>0&&overlapLow.塊>0&&overlapLow.件数===0,JSON.stringify(overlapLow));
  /* **後片付け**（§9.121）——元の場所へ戻す。戻さないと、以降の「重ねて
     置く」の網が別の配置を見るうえ、ここで出た一言（重なり・入りきらない）が
     案内の帯に残ったままになり、あちらの「畳んだ状態から出る」が成り立たない。 */
  await dropAtRow(A,1);
  await page.waitForTimeout(800);await settle(page);
  const noteLeft=await page.evaluate(()=>{
   const n=document.getElementById('rpArrangeNote');
   return {畳んでいる:!!(n&&n.hidden),文:(n?n.textContent:'').slice(0,40)};
  });
  rec('§9.283の確認のあと、案内の帯は畳んだ状態へ戻っている',
      noteLeft.畳んでいる===true,JSON.stringify(noteLeft));
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
  /* §9.226 ③（利用者の指示「カードのサイズ変更をしやすいように、
     マウスオーバー時のフローティング表示は不要なので削除してください」）で
     操作帯は**廃止した**。ここで固定するのは2つ:
       ①中身が器の上端から始まること（刷り上がりそのまま）
       ②塊の中に操作の道具が1つも無いこと（入口はダブルクリックの窓だけ）
     **「帯が触れると出る」の網は消す**——消し忘れると、直したはずの
     ものが赤いまま残り「落ちても気にしない」を教えてしまう（§9.200）。 */
  const asPrint=await page.evaluate(()=>{
   const el=document.querySelector(
     '#reportContent .rp-block[data-rp-block]:not(.is-overlap):not(.is-overflow)');
   if(!el)return {前提なし:true};
   const fit=el.querySelector(':scope>.rp-block-fit');
   if(!fit)return {前提なし:true,fit:false};
   const er=el.getBoundingClientRect(),fr=fit.getBoundingClientRect();
   return {ずれ:Math.round(fr.top-er.top),
           帯:!!el.querySelector(':scope>.rp-block-tools'),
           /* 大きさを変える縁は残っていること（掴む的そのもの）。 */
           縁:el.querySelectorAll(':scope>[data-rp-grip]').length,
           道具:el.querySelectorAll('[data-rp-span],[data-rp-toggle],[data-rp-split]').length};
  });
  rec('組み換え中でも中身は器の上端から始まる（帯が押し下げない）',
      !asPrint.前提なし&&Math.abs(asPrint.ずれ)<=1,JSON.stringify(asPrint));
  rec('マウスオーバーの浮き帯は無い（縁を掴む的を覆わない）',
      !asPrint.前提なし&&asPrint.帯===false&&asPrint.道具===0,JSON.stringify(asPrint));
  rec('大きさを変える縁は8方向とも残っている',
      !asPrint.前提なし&&asPrint.縁===8,JSON.stringify(asPrint));

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

  /* ---- 設備ごとの配置（§9.239 ③、利用者の指示） ----
     「帳票カスタム機能について、設備ごとレイアウト調整できるように」

     保存の器は§9.174で既に`report:<設備>`だった。足りなかったのは
     **設備を選ぶ手立て**——その設備で測ったロットがこの端末に1件も無いと、
     その設備の配置を編集できなかった。
     **「選択欄が在る」ことだけを見ない**——選ぶと`rpTarget()`が実際に
     切り替わることまで見る（見た目だけ足した実装でも通ってしまう）。 */
  const eqPick=await page.evaluate(()=>{
   const sel=document.querySelector('#rpArrangeBar [data-rp-eq]');
   if(!sel)return {無い:true};
   return {数:sel.options.length,いま:sel.value,
           札:[...sel.options].map(o=>o.textContent.trim()),
           コピー:!!document.querySelector('#rpArrangeBar [data-rp-copy]')};
  });
  rec('組み換えの帯に設備の選択欄がある',!eqPick.無い&&eqPick.数>=1,JSON.stringify(eqPick));
  rec('「他の設備へ当てる」が同じ帯にある',eqPick.コピー===true,JSON.stringify(eqPick));
  rec('設備の選択肢には件数（またはロットなし）が添えてある',
      !eqPick.無い&&eqPick.札.every(t=>/（.+）$/.test(t)),JSON.stringify(eqPick.札));
  if(!eqPick.無い){
   /* この端末に無い設備も選べること＝この機能の目的そのもの。 */
   const other=await page.evaluate(()=>{
    const sel=document.querySelector('#rpArrangeBar [data-rp-eq]');
    const o=[...sel.options].find(x=>x.value!==sel.value);
    return o?o.value:null;
   });
   if(other!==null){
    await page.selectOption('#rpArrangeBar [data-rp-eq]',other);
    await page.waitForTimeout(700);
    const now=await page.evaluate(()=>({
     対象:(document.querySelector('#rpArrangeBar [data-rp-eq]')||{}).value,
    }));
    rec('別の設備を選べる',now.対象===other,JSON.stringify({選んだ:other,いま:now.対象}));
    /* 組み換えを閉じたら**元の設備へ戻す**（戻さないと通常表示まで
       別設備の設定で描かれる）。 */
    await page.click('#reportArrange');
    await page.waitForTimeout(500);
    await page.click('#reportArrange');
    await page.waitForSelector('#rpArrangeBar:not([hidden])',{timeout:8000});
    await page.waitForTimeout(500);
    const back=await page.evaluate(()=>(document.querySelector('#rpArrangeBar [data-rp-eq]')||{}).value);
    rec('組み換えを開き直すとこのロットの設備へ戻る',back!==other||other==='',
        JSON.stringify({閉じる前:other,開き直し:back}));
   }else rec('設備の選択肢が2つ以上ある',false,'1つしかない');
  }

  /* ==========================================================
     §9.310 初めて組み換えを触っただけで、触っていない塊が変わらない
     ----------------------------------------------------------
     利用者の報告「帳票ブロックのサイズ変更をすると、その近くにある帳票
     ブロックのサイズも一緒に変更される」「複数回やると1回起きたあとは
     再現せず、**初めて触ったときに発生しがち**で隣というわけではなく
     **どこかのブロック**が共にサイズ変更される」。
     実体は`rpSeedPositions()`（書き下ろし）が
      ① **「中身なり」の塊にも高さ（`行数:`）を書いていた**
         ——`rpRelayout()`には同じ禁止事項が書いてあるのに、こちらだけが
         無条件だった。1マス引いた瞬間に全部の塊の高さがそのときの見た目で
         凍る（実測: 引く前は`行数:`が0件、1回引いたら15件。丈別データは
         52→74pxで42%大きくなった）。**凍るのは1回だけ**なので2回目以降は
         再現しない＝原因に辿り着きにくい。
      ② **このロットに中身が無い塊（`.is-empty`）まで書き下ろしていた**
         ——あれは紙に出ない札なので、書き下ろすと紙に出ない塊のぶんだけ
         後ろが下がる（実測157px）。
     **確かめるのは「引いた塊」ではなく「触っていない塊」**——引いた塊が
     変わるのは当たり前なので、そこだけを見る網はこの欠陥を素通りする。
     ========================================================== */
  await cleanup();
  await page.evaluate(t=>WL.columnLayout.forget(t),TARGET);
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  const seedSnap=async()=>await page.evaluate(()=>{
   const g=document.querySelector('.rp-blocks');if(!g)return {};
   const gr=g.getBoundingClientRect();
   const sc=Number(getComputedStyle(document.querySelector('.rp-page')).getPropertyValue('--rp-scale'))||1;
   const o={};
   document.querySelectorAll('[data-rp-block]').forEach(el=>{
    const r=el.getBoundingClientRect();
    o[el.dataset.rpBlock]={高:Math.round(r.height/sc),幅:Math.round(r.width/sc),
      Y:Math.round((r.top-gr.top)/sc),空:el.classList.contains('is-empty')};
   });
   return o;
  });
  const seedBefore=await seedSnap();
  await page.click('#reportArrange');
  await page.waitForSelector('#rpArrangeBar:not([hidden])',{timeout:8000});
  await settle(page);await page.waitForTimeout(800);
  /* 中身のある塊を1つだけ、1マスぶん引く（＝「初めて触る」）。 */
  const seedTarget=await page.evaluate(()=>{
   const el=[...document.querySelectorAll('[data-rp-block]:not(.is-empty)')]
     .find(e=>e.querySelector('[data-rp-grip="r"]'));
   return el?el.dataset.rpBlock:null;
  });
  const seedGrip=seedTarget&&await page.evaluate(n=>{
   const el=document.querySelector(`[data-rp-block="${CSS.escape(n)}"]`);
   const grip=el.querySelector('[data-rp-grip="r"]');const r=grip.getBoundingClientRect();
   const lo=Math.max(r.top+4,6),hi=Math.min(r.bottom-4,window.innerHeight-6);
   const y=Math.round(hi>lo?(lo+hi)/2:lo);
   const x=Math.round(r.left+r.width/2);
   return {x,y,掴める:document.elementFromPoint(x,y)===grip};
  },seedTarget);
  if(seedGrip&&seedGrip.掴める){
   await page.mouse.move(seedGrip.x,seedGrip.y);await page.mouse.down();
   await page.mouse.move(seedGrip.x-40,seedGrip.y,{steps:5});
   await page.mouse.up();await page.waitForTimeout(1200);await settle(page);
   /* **「中身なり」の塊の高さを書き込まない**（§9.222 ②と同じ禁止事項）。
      引いた塊だけは書いてよい（縁を引くのは高さを決める操作）。凍らせると
      `.is-sized`が付いて中の枠が器いっぱいへ伸びる（§9.242 ⑧）ので、
      **触っていない塊の見た目が変わる**。 */
   const rowKeys=await getj('/api/column-layout-master?target='+encodeURIComponent(TARGET))
     .then(d=>Object.keys(d.widths||{}).filter(k=>k.startsWith('行数:')));
   const frozen=rowKeys.filter(k=>k.slice(3)!==seedTarget);
   rec('§9.310 初めて触っても、触っていない塊の高さを凍らせない',
       frozen.length===0,`書かれた行数: ${frozen.join('／')||'なし'}`);
   /* **紙に出ない塊（中身なし）も、いま見えている場所のまま書き下ろす。**
      書き下ろさない形も試したが、そうすると描くたびに空いているマスを探して
      紙の下へ伸び、**刷り上がりがA4を超えた**（実測 210×336.7mm）。
      いっぽう外した状態のまま測ると矩形が0になり、**紙の左上へ1マスに潰れる**
      ——ここで見るのはそちら（潰れていないこと）。 */
   const ghostSpots=await page.evaluate(()=>{
    const o=[];
    document.querySelectorAll('[data-rp-block].is-empty').forEach(el=>{
     const c=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridColumn||'');
     const r=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridRow||'');
     o.push({名:el.dataset.rpBlock,列:c?Number(c[1]):0,幅:c?Number(c[2]):0,
       行:r?Number(r[1]):0});
    });
    return o;
   });
   const crushed=ghostSpots.filter(x=>x.幅<=1||(x.列===1&&x.行===1&&x.幅<=1));
   /* ---- §9.311 A 書き下ろしで塊どうしを重ねない ----
      §9.310 で「中身なしの塊を伏せてから測る」を入れたが、**大きさを控える
      ために伏せる前の矩形も使っていた**ので、
        中身なしの塊 … 画面の並び（伏せる前）の場所
        それ以外の塊 … 刷り上がりの並び（伏せた後）の場所
      という**2つの並びが混ざった**状態が書き下ろされ、**別々の塊が同じマスへ
      重なって**書き込まれた（実測: `板厚の測定データ`と`作業時間`が`1,21`）。
      重なった2枚は上下に描かれるので下の1枚が掴めず、掴んだつもりが上の塊を
      動かす——利用者の報告「D&Dで位置ずれがかなりひどくなりました」の実体。
      **重なりは矩形どうしで見ること**——左上が同じかどうかだけを見る網は、
      1マスずれて重なっている形を素通りする。 */
   const seedOverlaps=await page.evaluate(()=>{
    const box=[];
    document.querySelectorAll('[data-rp-block]').forEach(el=>{
     const c=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridColumn||'');
     const r=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridRow||'');
     if(!c||!r)return;
     box.push({名:el.dataset.rpBlock,c:+c[1],cs:+c[2],r:+r[1],rs:+r[2]});
    });
    const bad=[];
    for(let i=0;i<box.length;i++)for(let j=i+1;j<box.length;j++){
     const a=box[i],b=box[j];
     if(a.c<b.c+b.cs&&b.c<a.c+a.cs&&a.r<b.r+b.rs&&b.r<a.r+a.rs)
      bad.push(`${a.名}(${a.c},${a.r}) と ${b.名}(${b.c},${b.r})`);
    }
    return {数:box.length,重なり:bad};
   });
   rec('§9.311 A 書き下ろしで塊どうしが重ならない（2つの並びを混ぜない）',
       seedOverlaps.数>1&&seedOverlaps.重なり.length===0,
       seedOverlaps.重なり.slice(0,3).join(' / ')||`${seedOverlaps.数}件・重なりなし`);
   await page.click('#rpArrangeCancel');
   await page.waitForTimeout(1200);await settle(page);
   const seedAfter=await seedSnap();
   const moved=Object.keys(seedBefore).filter(k=>k!==seedTarget&&seedAfter[k]
     &&(Math.abs(seedAfter[k].高-seedBefore[k].高)>2||Math.abs(seedAfter[k].Y-seedBefore[k].Y)>2))
     .map(k=>`${k} 高${seedBefore[k].高}→${seedAfter[k].高} Y${seedBefore[k].Y}→${seedAfter[k].Y}`);
   rec('§9.310 初めて触っても、紙の見え方が動かない（触っていない塊）',
       moved.length===0,moved.slice(0,4).join(' / ')||'動かず');
   rec('§9.310 中身が無い塊が紙の左上へ潰れない（外したまま測らない）',
       ghostSpots.length>0&&crushed.length===0,
       ghostSpots.length?JSON.stringify(ghostSpots).slice(0,220)
                        :'このロットには中身なしの塊が無い（前提が立たない）');
  }else rec('§9.310 の前提: 中身のある塊の右縁が掴める',false,JSON.stringify({seedTarget,seedGrip}));

  /* ==========================================================
     §9.310 ② 重なっている塊の縁を掴んでも、めちゃくちゃ縮まない
     ----------------------------------------------------------
     利用者の報告「ブロックが重なっているときにサイズ変更を触るとめちゃ
     縮みます」。掴んだ時点で既に`rpFits()`が偽なので、当たりを避ける戻し
     （`back()`）が最初の一手から全力で走り、どこへ戻しても入らない配置では
     **幅も高さも1マス**まで潰れていた。§9.223 ③の利用者の指示は
     「重なっても配置でき、重なった部分を強調表示で修正をうながす」なので、
     **縮めずに言う**（`rpApplySpan()`／`rpDropCell()`と同じ約束）。
     **重なりを自分で作ること**——検証用の配置は重なっていないので、
     そのまま見ると戻しの道を一度も通らずに通ってしまう。
     ========================================================== */
  await cleanup();
  /* **半分だけ重ねる**——丸かぶりにすると、印が付いた側（後から置かれた
     ほう）の縁が相手の塊に覆われて`pointerdown`が届かず、「幅が変わらない」
     としか出ない（§9.221 ⑨と同じ罠）。A は 1〜12列、C1 は 7〜18列に置いて
     7〜12列だけ重ね、C1 の右の縁（18列目）を空けておく。
     位置の保存値は**古い形（`列:`／`行:`は×40）**で書く——読む側の
     `rpNum(key,'col',40)`が同じ換算を通るので、40→1列目・160→4列目
     （24マスでは7列目）・280→7行目（48段では25行目）になる。 */
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
    order:[A,C1,C2],hidden:rest,
    widths:{[A]:6*UNIT,[C1]:6*UNIT,[C2]:6*UNIT,
            [`行数:${A}`]:4*CUNIT,[`行数:${C1}`]:4*CUNIT,[`行数:${C2}`]:2*CUNIT,
            [`列:${A}`]:40,[`列:${C1}`]:160,[`列:${C2}`]:40,
            [`行:${A}`]:40,[`行:${C1}`]:40,[`行:${C2}`]:280}});
  await page.evaluate(t=>WL.columnLayout.forget(t),TARGET);
  await page.evaluate(()=>window.exitReportView&&window.exitReportView());
  await openReport();
  await page.click('#reportArrange');
  await page.waitForSelector('#rpArrangeBar:not([hidden])',{timeout:8000});
  await settle(page);await page.waitForTimeout(800);
  /* **印が付くのは「後から置かれた側」**——`rpResolvePlacement()`は先に
     置いた塊を正として、入らなかったほうを`rpOverlaps`へ入れる。名指しで
     見ると、たまたま先に置かれた側を見て「重なっていない」で落ちる。 */
  const ovBefore=await page.evaluate(()=>{
   const els=[...document.querySelectorAll('.rp-block.is-overlap[data-rp-block]')];
   for(const el of els){
    const grip=el.querySelector('[data-rp-grip="r"]');
    if(!grip)continue;
    const r=grip.getBoundingClientRect();
    const lo=Math.max(r.top+4,6),hi=Math.min(r.bottom-4,window.innerHeight-6);
    const y=Math.round(hi>lo?(lo+hi)/2:lo);
    const x=Math.round(r.left+r.width/2);
    const m=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridColumn||'');
    const 掴める=document.elementFromPoint(x,y)===grip;
    if(!掴める&&el!==els[els.length-1])continue;
    return {名:el.dataset.rpBlock,span:m?Number(m[2]):0,重なり:true,x,y,掴める,
      印の数:els.length};
   }
   return {印の数:els.length,重なり:els.length>0,掴める:false,span:0};
  });
  rec('§9.310 ② の前提: 塊が重なっていて、その縁が掴める',
      !!ovBefore&&ovBefore.重なり===true&&ovBefore.掴める===true,JSON.stringify(ovBefore));
  if(ovBefore&&ovBefore.span&&ovBefore.掴める){
   await page.mouse.move(ovBefore.x,ovBefore.y);await page.mouse.down();
   /* **ほとんど動かさない**（1px）。ここで縮むなら、それは利用者の操作では
      なく当たり避けが勝手にやっている。 */
   await page.mouse.move(ovBefore.x-1,ovBefore.y,{steps:2});
   const ovTip=await page.evaluate(()=>{
    const t=document.querySelector('.rp-size-tip');return t?t.textContent.trim():''});
   const ovMid=await page.evaluate(t=>{
    const el=document.querySelector(`[data-rp-block="${CSS.escape(t)}"]`);
    const m=/(\d+)\s*\/\s*span\s+(\d+)/.exec(el.style.gridColumn||'');
    return m?Number(m[2]):0;
   },ovBefore.名);
   await page.mouse.up();await page.waitForTimeout(900);await settle(page);
   rec('§9.310 ② 重なっていても、掴んだ瞬間に勝手に縮まない',
       ovMid>=ovBefore.span-1,JSON.stringify({掴む前:ovBefore.span,動かした直後:ovMid}));
   rec('§9.310 ② 重なることは吹き出しの文字で言う',/重なり/.test(ovTip),ovTip||'(空)');
  }

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
