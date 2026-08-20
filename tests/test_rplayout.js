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
const UNIT=60;                                  /* RP_SPAN_UNIT（§9.169） */
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
  rec('行も粗いグリッド（1行ぶんの高さが決まっている）',/^\d+px$/.test(grid.行の高さ)&&parseFloat(grid.行の高さ)>0,
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
            [`行数:${A}`]:12*UNIT,[`行数:${C1}`]:3*UNIT,[`行数:${C2}`]:3*UNIT}});
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
      (saved.widths||{})[`行数:${A}`]===12*UNIT&&(saved.widths||{})[`行数:${C1}`]===3*UNIT,
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
  /* **組み換え中は外した塊も並べる**（§9.174。何を外しているか分かるように）
     ので、「消えたか」ではなく**外した印が付いたか／パレットに並んだか**で
     見る——DOMから消えたかを見ると、直っていても落ちる。 */
  const afterDrop=await page.evaluate(k=>({
   外した:!!document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`)?.classList.contains('is-off'),
   パレットに居る:[...document.querySelectorAll('#rpPalette [data-rp-pal]')].some(x=>x.dataset.rpPal===k),
  }),C2);
  rec('落とせる場所だと分かる印が出る',removed.marked===true);
  rec('紙の塊をパレットへ落とすと外れる',
      afterDrop.外した===true&&afterDrop.パレットに居る===true,JSON.stringify(afterDrop));

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
  rec('ゴーストは掴んだ塊と同じ幅・高さ',
      !!ghost.out&&/^span \d+$/.test(ghost.out.幅)&&/^span \d+$/.test(ghost.out.高さ),
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
   const g=el.querySelector('[data-rp-grip="w"]').getBoundingClientRect();
   return {w:Math.round(r.width),gx:Math.round(g.left+g.width/2),gy:Math.round(g.top+g.height/2)};
  },A);
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
      /linear-gradient/.test(guide.線)&&guide.列==='12',JSON.stringify({列:guide.列}));
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
