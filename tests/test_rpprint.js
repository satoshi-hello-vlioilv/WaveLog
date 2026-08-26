/* test_rpprint.js: 帳票は**プレビューどおりに刷る**（§9.242 ⑦⑧）
   ============================================================
   利用者の指摘（⑦）:
     「プレビューと比率が全く違います。幅方向の余白が広い印象です。
      プレビューの通りに印刷したいです。プレビューのレイアウト、比率が正で、
      正確に印刷するようにしてください」
   利用者の指摘（⑧）:
     「異常登録のデータがない場合…『異常情報なし』とだけ出るのですが、
      その表示する枠は文字量に合わせて可変となっており、折角帳票レイアウトで
      最低表示領域を確保しても中の枠が小さくなるのでバランスが悪くなって
      しまいます。品質情報のカードのサイズの枠に合わせて中の情報表示領域の
      枠を確保してください」

   ここで固定すること:
    - **紙の箱がプレビューと同じ**（幅・高さ・内側の余白）。以前は
      `@page{margin:5mm}`＋`.rp-page{width:auto;padding:0}`で、刷るときだけ
      中身の幅が「用紙−@pageの余白」になっていた（＝別の幅で組み直していた）
    - **中身を並べる器の幅が同じ**（`.rp-blocks`）。ここが違うと、`1fr`の
      割り算も、画面で測った縮小率（`--rp-fit`）も全部ずれる
    - **一括印刷も同じ箱**（片方だけ直すと「1枚ずつなら合う」形になる）
    - 品質情報の枠は**高さを決めたカードの中いっぱい**

   **画面の値と刷るときの値を突き合わせる**こと——片方だけ見る網は、
   どちらも同じだけ狂っていても通る。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
/* 列レイアウトマスタは**実行をまたいで生き延びる**（§9.121）ので必ず消す。 */
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
let b=null;

(async()=>{
 await cleanup();
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 /* 紙の箱と中身の器を**拡大前のCSS px**で測る（§9.222 ②。
    `getBoundingClientRect()`は`--rp-scale`が掛かった後なので混ぜない）。 */
 const geom=()=>page.evaluate(()=>{
  const pg=document.querySelector('#reportContent');
  const grid=pg&&pg.querySelector('.rp-blocks');
  if(!pg)return null;
  const cs=getComputedStyle(pg);
  return {紙幅:pg.offsetWidth,紙高:pg.offsetHeight,
    余白:cs.paddingLeft+'/'+cs.paddingRight,
    器幅:grid?grid.clientWidth:0,
    /* 1マスの幅＝比率そのもの。ここが違えば塊の幅もすべて違う。 */
    マス:grid?getComputedStyle(grid).gridTemplateColumns.split(' ')[0]:''};
 });
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await page.click('.record-list-row .report');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await settle(page);

  /* ---- ⑦ プレビューと刷るときで紙の箱が同じ ---- */
  const screen=await geom();
  rec('前提: プレビューの紙が読める',!!screen&&screen.紙幅>0,JSON.stringify(screen));
  await page.emulateMedia({media:'print'});
  await settle(page);
  const print=await geom();
  await page.emulateMedia({media:null});
  await settle(page);
  rec('刷るときも紙の幅が同じ（A4縦 210mm のまま）',
      !!print&&Math.abs(print.紙幅-screen.紙幅)<=1,
      JSON.stringify({画面:screen.紙幅,印刷:print&&print.紙幅}));
  rec('刷るときも紙の高さが同じ（297mm のまま）',
      !!print&&Math.abs(print.紙高-screen.紙高)<=1,
      JSON.stringify({画面:screen.紙高,印刷:print&&print.紙高}));
  rec('刷るときも内側の余白が同じ（8mm）',
      !!print&&print.余白===screen.余白,
      JSON.stringify({画面:screen.余白,印刷:print&&print.余白}));
  /* **比率が合っていること**——ここが本丸。器の幅が違えば`1fr`の割り算も
     画面で測った縮小率も全部ずれる（利用者の「比率が全く違う」の実体）。 */
  rec('刷るときも中身を並べる器の幅が同じ（比率が変わらない）',
      !!print&&Math.abs(print.器幅-screen.器幅)<=1,
      JSON.stringify({画面:screen.器幅,印刷:print&&print.器幅}));
  rec('刷るときも1マスの幅が同じ',
      !!print&&print.マス===screen.マス,
      JSON.stringify({画面:screen.マス,印刷:print&&print.マス}));

  /* ---- ⑦ 一括印刷の紙も同じ箱（片方だけ直さない） ---- */
  const bulk=await page.evaluate(()=>{
   /* 実際に刷らずに、規則だけを確かめる——`@media print`の中の
      `.rp-bulk-print-area .rp-page`が単票と同じ寸法を持っているか。 */
   const hit=[];
   for(const sheet of document.styleSheets){
    let rules=null;try{rules=sheet.cssRules}catch(e){continue}
    if(!rules)continue;
    const walk=list=>{for(const r of list){
     if(r.cssRules&&(r.media||r.name==='print'||r.constructor.name==='CSSLayerBlockRule'))walk(r.cssRules);
     else if(r.cssRules)walk(r.cssRules);
     if(r.selectorText&&/rp-bulk-print-area[\s\S]*\.rp-page$/.test(r.selectorText))
      hit.push({sel:r.selectorText,w:r.style.width,h:r.style.minHeight,p:r.style.padding});
    }};
    walk(rules);
   }
   return hit;
  });
  const bulkMain=bulk.find(x=>!/rp-landscape|last-child/.test(x.sel));
  rec('一括印刷の紙も単票と同じ箱（210mm・297mm・内側8mm）',
      !!bulkMain&&bulkMain.w==='210mm'&&bulkMain.h==='297mm'&&/8mm/.test(bulkMain.p||''),
      JSON.stringify(bulkMain||bulk));

  /* ---- ⑧ 品質情報の枠はカードいっぱい ---- */
  /* まず**中身なり**のときの枠（今までどおり中身の高さで止まる）。 */
  const before=await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"]');
   if(!el)return{ある:false};
   const box=el.querySelector('.rp-info-box');
   return{ある:true,文:(box&&box.textContent||'').trim(),
     器:Math.round(el.getBoundingClientRect().height),
     枠:box?Math.round(box.getBoundingClientRect().height):0};
  });
  rec('前提: 品質情報の塊が出ている',before.ある===true,JSON.stringify(before));
  /* **中身の長さは問わない**——ロットによって「異常情報なし」の1行のことも、
     何行も入っていることもある。⑧で見たいのは「中身なりに縮まないこと」。 */
  rec('前提: 品質情報の中身が読める',before.文.length>0,before.文.slice(0,40));

  /* カードの高さを決める（利用者の言う「帳票レイアウトで最低表示領域を確保」）。 */
  await page.click('#reportArrange');
  await page.waitForTimeout(400);
  await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"]');
   el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  });
  await page.waitForFunction(()=>{
   const m=document.getElementById('rpBlockModal');return !!m&&!m.hidden;
  },null,{timeout:8000});
  await page.waitForTimeout(200);
  const rowsPicked=await page.evaluate(()=>{
   /* いちばん背の高い選択肢（全高の1つ手前）を選ぶ——中身1行との差が
      いちばん大きく、伸びていないことを見逃さない。 */
   const bs=[...document.querySelectorAll('#rpBlockForm [data-e-rows]')]
     .filter(x=>Number(x.dataset.eRows)>0);
   const pick=bs[Math.max(0,bs.length-2)];
   if(pick)pick.click();
   return pick?Number(pick.dataset.eRows):0;
  });
  await page.evaluate(()=>{const c=document.getElementById('rpBlockClose');if(c)c.click()});
  await settle(page);
  await page.waitForTimeout(400);
  const after=await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"]');
   if(!el)return{ある:false};
   const box=el.querySelector('.rp-info-box');
   return{ある:true,印:el.classList.contains('is-sized'),
     器:Math.round(el.getBoundingClientRect().height),
     枠:box?Math.round(box.getBoundingClientRect().height):0};
  });
  rec('高さを決めるとカードに印が付く',after.ある&&after.印===true&&rowsPicked>0,
      JSON.stringify({...after,行:rowsPicked}));
  rec('カードの高さを決めると実際に背が高くなる',
      after.器>before.器+20,JSON.stringify({前:before.器,後:after.器}));
  /* **割合で見る**（§9.234 ⑤）——枠線と内側の余白ぶんはpxの差で落ちる。 */
  rec('品質情報の枠がカードいっぱいに広がる（§9.242 ⑧）',
      after.枠>=after.器*0.8,
      JSON.stringify({器:after.器,枠:after.枠,比:Math.round(after.枠/after.器*100)+'%'}));

  /* **中身なりへ戻すと元どおり**——ここを伸ばしたままにすると、
     `rpFitRows()`が測る`scrollHeight`が器の高さになり、行数が
     「自分の高さで自分の高さを決める」形になって決まらない。 */
  await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"]');
   el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  });
  await page.waitForFunction(()=>{
   const m=document.getElementById('rpBlockModal');return !!m&&!m.hidden;
  },null,{timeout:8000});
  await page.waitForTimeout(200);
  await page.click('#rpBlockForm [data-e-rows="0"]');
  await page.evaluate(()=>{const c=document.getElementById('rpBlockClose');if(c)c.click()});
  await settle(page);
  await page.waitForTimeout(500);
  const back=await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"]');
   if(!el)return null;
   const box=el.querySelector('.rp-info-box');
   return{印:el.classList.contains('is-sized'),
     器:Math.round(el.getBoundingClientRect().height),
     枠:box?Math.round(box.getBoundingClientRect().height):0};
  });
  rec('中身なりへ戻すと印が外れる',!!back&&back.印===false,JSON.stringify(back));
  rec('中身なりへ戻すと高さも中身なりに戻る（行数の測り直しが効いている）',
      !!back&&back.器<after.器*0.6,JSON.stringify({決め打ち:after.器,中身なり:back&&back.器}));

  /* ==========================================================
     ⑨ 測定した値の統計を帳票の塊へ載せられる（§9.242 ⑨）
     利用者の指示「測定したデータの計算値や集計値など…特にロットごとの
      板厚MIN、MAXや板幅MIN、MAXや板丈MIN、MAXなど測定した項目の統計値なども
      含めて設計できるようにしたい」
     ========================================================== */
  /* **語彙はサーバーが答える**（§9.163）——画面へ綴りの写しを持たせない。 */
  const cat=await page.evaluate(async()=>{
   const r=await fetch('/api/report-block-master').then(x=>x.json());
   const g=(r.catalog||[]).find(x=>/統計/.test(x.group||''));
   return g?{群:g.group,件数:g.items.length,道:g.items.map(i=>i.path),
             名:g.items.map(i=>i.label)}:null;
  });
  rec('帳票の塊の候補に「測定した値の統計」がある',!!cat&&cat.件数>0,
      JSON.stringify(cat&&{群:cat.群,件数:cat.件数}));
  rec('板厚・板幅・板丈のMIN/MAXが選べる',
      !!cat&&['stat.thickness.min','stat.thickness.max','stat.width.min','stat.width.max',
              'stat.length.min','stat.length.max'].every(p=>cat.道.includes(p)),
      JSON.stringify(cat&&cat.道.slice(0,8)));
  /* **N数も選べる**（1点と80点では当たる見込みが違う・§9.214）。 */
  rec('平均・ばらつき・N数も選べる',
      !!cat&&['stat.width.avg','stat.width.span','stat.width.n'].every(p=>cat.道.includes(p)),
      JSON.stringify(cat&&cat.名.slice(0,6)));

  /* **値が実際に作られること**まで見る（候補に在るだけでは、1つも計算しない
     実装でも通る）。測定値を注ぎ込んでから引く。 */
  const stat=await page.evaluate(()=>{
   /* 丈2・条3のロット。**丈数・条数の外は数えない**ので、配列に余分な
      値が残っていても拾わない（板厚は丈ごとに3点＝OS/CL/DS）。 */
   const x={settings:{verticalCount:2,horizontalCount:3},
     measurements:{thickness:[['2.001','2.010','2.005'],['2.020','','']],
                   width:[['100.10','100.30','100.20'],['','','']]},
     product:{rows:[{productLength:'1200.5'},{productLength:'1180.0'}]}};
   const at=p=>WL.reportStat?WL.reportStat(x,p):null;
   return {板厚MIN:at('stat.thickness.min'),板厚MAX:at('stat.thickness.max'),
     板厚N:at('stat.thickness.n'),
     板幅MIN:at('stat.width.min'),板幅MAX:at('stat.width.max'),
     板幅ばらつき:at('stat.width.span'),
     板丈MIN:at('stat.length.min'),板丈MAX:at('stat.length.max'),
     未測定:at('stat.burr.min'),未測定N:at('stat.burr.n'),
     知らない道:at('stat.thickness.nope')};
  });
  rec('板厚のMIN/MAXが測定値から作られる（桁は記録の桁）',
      stat.板厚MIN==='2.001'&&stat.板厚MAX==='2.020',JSON.stringify(stat));
  /* **丈数・条数の外は数えない**——配列は12丈×40条で確保してあるので、
     素で走査すると条数を減らす前の値まで拾う。ここは1丈(＋尾)×3条。 */
  rec('丈数・条数の外の値は数えない',stat.板厚N==='4',JSON.stringify(stat));
  rec('板幅のMIN/MAX・ばらつきが作られる',
      stat.板幅MIN==='100.10'&&stat.板幅MAX==='100.30'&&stat.板幅ばらつき==='0.20',
      JSON.stringify(stat));
  /* 板丈は丈ごとの記録（`product.rows`の「長さ」）。 */
  rec('板丈のMIN/MAXは丈ごとの記録から作られる',
      stat.板丈MIN==='1180.0'&&stat.板丈MAX==='1200.5',JSON.stringify(stat));
  /* **測っていない項目は空**（0で埋めない・§9.114と同じ約束）。 */
  rec('測っていない項目は空欄で、N数は0',
      stat.未測定===''&&stat.未測定N==='0',JSON.stringify(stat));
  rec('知らない綴りは空（黙って別の値を出さない）',
      stat.知らない道==='',JSON.stringify(stat));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  process.exitCode=ng.length?1:0;
 }catch(e){
  console.error('FATAL',e);
  process.exitCode=2;
 }finally{
  /* **落ちても必ず後片付け**（§9.121）。 */
  await cleanup();
  if(b)await b.close().catch(()=>{});
 }
})();
