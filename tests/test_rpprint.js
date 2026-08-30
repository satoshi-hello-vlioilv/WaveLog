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
/* 共有DBへ注ぎ込んだ検証用のレコードも同じ理由で必ず消す。 */
const cleanupRecs=()=>post('/api/measurement/backup/delete',
  {id:'rpsplit-eqA',user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
let b=null;

(async()=>{
 await cleanup();
 await cleanupRecs();
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

  /* ---- ⑦ `@page`の余白は**2枚とも同じ値**（§9.243、利用者の指摘） ----
     「アプリ内の印刷プレビューとWINDOWSのプレビューに違いが出ています…
      用紙に対して80％くらいの比率と共に表示内容のクオリティも下がっている」

     `@page`は2枚ある——`90-state.css`の保険と、向きを差し替える
     `report-dashboard.js`の`<style>`（`#rpPageSizeStyle`）。後者は`<head>`の
     末尾へ挿すので**後から読まれて勝つ**。§9.242 ⑦でCSSだけを`margin:0`に
     したため、**実際に効いていたのは5mm**——版面が200×287mmになり、
     210×297mmの紙が入らず、ブラウザが全体を縮めて合わせていた。
     **2枚あることが問題なのではなく、違う値の2枚があることが問題。** */
  const pageRules=await page.evaluate(()=>{
   const out=[];
   const walk=(list,where)=>{for(const r of list){
    if(r.constructor&&r.constructor.name==='CSSPageRule')
     out.push({where,margin:r.style.margin||r.style.marginTop||'',text:r.cssText});
    if(r.cssRules)walk(r.cssRules,where);
   }};
   for(const sh of document.styleSheets){let rs=null;try{rs=sh.cssRules}catch(e){continue}
    if(rs)walk(rs,(sh.ownerNode&&sh.ownerNode.id)?('#'+sh.ownerNode.id):(sh.href||'inline'));}
   return out;
  });
  const margins=[...new Set(pageRules.map(r=>String(r.margin||'').trim()).filter(Boolean))];
  rec('前提: 向きを差し替える@pageが出ている',
      pageRules.some(r=>r.where==='#rpPageSizeStyle'),
      JSON.stringify(pageRules.map(r=>r.where)));
  rec('@pageの余白が2枚とも同じ値（後から読まれた側が黙って勝たない）',
      margins.length===1,JSON.stringify(pageRules.map(r=>r.where+':'+r.margin)));
  rec('@pageの余白は0（紙の外側の余白は`.rp-page`のpaddingが持つ）',
      margins.length===1&&/^0(px)?$/.test(margins[0]),JSON.stringify(margins));

  /* **実際に刷らせて確かめる**（§9.243）。CSSの値を読むだけでは、版面と紙の
     大小関係までは分からない。`page.pdf()`はChromiumの印刷パイプラインを
     通るので、紙が版面に入らなければ**ページが増える**（画面の印刷ダイアログ
     では、そのぶん全体が縮んで1枚に収まる＝報告された「80％」）。
     **壊れた状態も流して確かめること**——直った状態だけを見ても、直った
     理由がこの修正なのかは分からない。 */
  const pdfPages=async broken=>{
   await page.emulateMedia({media:'print'});
   if(broken)await page.evaluate(()=>{
    const el=document.getElementById('rpPageSizeStyle');
    if(el)el.textContent='@page{size:A4 portrait;margin:5mm}';
   });
   const buf=await page.pdf({preferCSSPageSize:true,printBackground:true});
   if(broken)await page.evaluate(()=>{
    const el=document.getElementById('rpPageSizeStyle');
    if(el)el.textContent='@page{size:A4 portrait;margin:0}';
   });
   await page.emulateMedia({media:null});
   const txt=buf.toString('latin1');
   const box=/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(txt);
   return {枚:(txt.match(/\/Type\s*\/Page[^s]/g)||[]).length,
     幅mm:box?+( (+box[3]-+box[1])*25.4/72 ).toFixed(1):0,
     高mm:box?+( (+box[4]-+box[2])*25.4/72 ).toFixed(1):0};
  };
  const ok=await pdfPages(false);
  rec('刷ると1枚のA4になる（縮めずに収まる）',
      ok.枚===1&&Math.abs(ok.幅mm-210)<=1&&Math.abs(ok.高mm-297)<=1,JSON.stringify(ok));
  const bad=await pdfPages(true);
  rec('前提: 余白を5mmへ戻すと紙が版面に入らず2枚になる（縮む原因）',
      bad.枚>=2,JSON.stringify(bad));
  await settle(page);

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
   /* この紙だけの見え方は**左上の「紙」ボタン**（§9.274。ダブルクリックは
      帳票ブロックマスタへ移るようになった）。 */
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"] [data-rp-paper]');
   el.click();
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
   /* この紙だけの見え方は**左上の「紙」ボタン**（§9.274。ダブルクリックは
      帳票ブロックマスタへ移るようになった）。 */
   const el=document.querySelector('[data-rp-block="品質情報（仕掛）"] [data-rp-paper]');
   el.click();
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

  /* ==========================================================
     刷るのは「帳票だけの1枚もの」（§9.244、利用者の指示）
     ----------------------------------------------------------
     §9.243で`@page`をそろえてもなお縮んだ。**こちらの割り付けは正しい**
     （上で確かめている）ので、残る差は**アプリの画面ごと刷っている**
     ことから来る——伏せた要素も器の幅・`min-width`・`--ui-scale`として
     版面に関わり得る。紙に出したいものだけの書類を作って刷る。

     **`print()`をすり替えて中身を測る**——ヘッドレスでは印刷ダイアログを
     開けないので、「窓が出たか」ではなく**刷ろうとした書類そのもの**を
     見る（見た目だけを見る網は、書類が空でも通る）。
     ========================================================== */
  const printed=await page.evaluate(()=>new Promise(resolve=>{
   const MM=96/25.4;
   const give=w=>{
    const pgs=[...w.document.querySelectorAll('.rp-page')];
    const de=w.document.documentElement;
    const r=pgs[0]?pgs[0].getBoundingClientRect():null;
    resolve({枚数:pgs.length,
      紙幅:r?Math.round(r.width):0,紙高:r?Math.round(r.height):0,
      紙幅mm:r?+(r.width/MM).toFixed(1):0,紙高mm:r?+(r.height/MM).toFixed(1):0,
      書類幅:de.clientWidth,
      塊:w.document.querySelectorAll('.rp-block').length,
      /* 画面と同じCSSを読んでいること（写しを作っていない）。 */
      CSS:w.document.querySelectorAll('link[rel=stylesheet]').length,
      /* 画面の拡大縮小は等倍へ戻すこと（紙には関係が無い倍率）。 */
      倍率:getComputedStyle(w.document.body).getPropertyValue('--rp-scale').trim(),
      表示サイズ:de.getAttribute('data-ui-size'),
      /* 組み換えの道具は紙に出さない。 */
      道具:w.document.querySelectorAll('.rp-block-tools,.rp-free-layer').length});
   };
   let hooked=false;
   const iv=setInterval(()=>{
    const f=document.getElementById('rpPrintFrame');
    const w=f&&f.contentWindow;
    if(!w||!w.document||!w.document.body||hooked)return;
    hooked=true;w.print=()=>{clearInterval(iv);give(w)};
   },15);
   setTimeout(()=>{clearInterval(iv);resolve(null)},8000);
   document.getElementById('reportPrint').click();
  }));
  rec('印刷は帳票だけの書類を組み立てて刷る',!!printed,JSON.stringify(printed));
  if(printed){
   rec('刷る書類は1枚（割って縮められない）',printed.枚数===1,String(printed.枚数));
   rec('刷る紙はぴったりA4（210×297mm）',
       Math.abs(printed.紙幅mm-210)<=1&&Math.abs(printed.紙高mm-297)<=1,
       `${printed.紙幅mm}×${printed.紙高mm}mm`);
   /* **画面の紙と同じ寸法**——別々に測ると、どちらも同じだけ狂っていても通る。 */
   rec('画面のプレビューと同じ寸法',
       Math.abs(printed.紙幅-screen.紙幅)<=1&&Math.abs(printed.紙高-screen.紙高)<=1,
       JSON.stringify({画面:[screen.紙幅,screen.紙高],紙:[printed.紙幅,printed.紙高]}));
   rec('書類の幅も紙の幅（紙より広い器で組まない）',
       Math.abs(printed.書類幅-printed.紙幅)<=1,
       `${printed.書類幅} / ${printed.紙幅}`);
   /* **中身が入っていること**——空の紙でも寸法だけは合う。 */
   const shownBlocks=await page.evaluate(()=>document.querySelectorAll('#reportContent .rp-block').length);
   rec('中身は画面と同じ塊が入っている',printed.塊>0&&printed.塊===shownBlocks,
       `${printed.塊} / ${shownBlocks}`);
   rec('画面と同じCSSを読む（写しを作らない）',printed.CSS>=1,String(printed.CSS));
   rec('画面の拡大縮小は等倍へ戻す',printed.倍率==='1',JSON.stringify(printed.倍率));
   rec('表示サイズはプレビューと同じものを持ち込む',
       printed.表示サイズ===await page.evaluate(()=>document.documentElement.getAttribute('data-ui-size')),
       printed.表示サイズ);
   rec('組み換えの道具は紙に出さない',printed.道具===0,String(printed.道具));
  }

  /* ==========================================================
     印刷ボタン1回で、刷るのは1回だけ（§9.247 ③、利用者の報告）
     ----------------------------------------------------------
       「印刷ボタンを押すと…プレビュー機能が出てきますが、ここをキャンセル
        ボタンを押すと、もう一度同じプレビュー機能が出てきます。2回出てくる
        ということは、印刷ボタンの挙動に問題がないでしょうか」

     `rpPrintFrame()`は書類の**用意ができた合図を2つ**持っている——
     `<iframe>`の`load`と、書き込んだ`<link>`の読み込み数え。どちらも
     `go()`へ入るので、**多重防止が無いと`w.print()`が2回走る**。
     実機では1回目のダイアログが閉じるまでJSが止まるので、
     **キャンセルした直後に2枚目が開く**という形で出る。

     **「窓が出たか」ではなく回数を数えること**——1回目だけを見る網
     （上の`printed`）は2回呼ばれていても通る（実際に通っていた）。
     ========================================================== */
  const fired=await page.evaluate(()=>new Promise(resolve=>{
   let n=0;
   const iv=setInterval(()=>{
    const f=document.getElementById('rpPrintFrame');
    const w=f&&f.contentWindow;
    if(!w||!w.document||w.__wlHooked)return;
    w.__wlHooked=true;w.print=()=>{n++};
   },5);
   /* 2つ目の合図はrAF2回ぶん後に来るので、余裕をみて待ってから数える。 */
   setTimeout(()=>{clearInterval(iv);resolve(n)},2500);
   document.getElementById('reportPrint').click();
  }));
  rec('印刷ボタン1回で刷るのは1回だけ（プレビューが2度出ない）',fired===1,fired+'回');

  /* ==========================================================
     測定値の統計はロットごとにも出る（§9.244、利用者の指示）
     ----------------------------------------------------------
       「異幅分割の複数ロットが混在するパターンにおいてもロットごとに
        統計データが出てくるように対応をお願いします」

     **条ごとに測る項目だけが子ロットごとに切れる**（§9.214）——板厚・板丈・
     肉厚は丈ごとの測定なので、どの子ロットのものとも言えない。
     **確かめるときは分割と測定値を自分で注ぎ込むこと**——検証用のレコードに
     異幅分割がある保証は無く、「無ければ素通り」の書き方だと直す前でも通る。
     ========================================================== */
  const stat2=await page.evaluate(()=>{
   /* 丈2・条5。条1〜2＝CHILD-A（板幅50台）／条3〜5＝CHILD-B（60台）。 */
   const x={settings:{verticalCount:2,horizontalCount:5,
     splitGroups:[{lot:'CHILD-A',count:2},{lot:'CHILD-B',count:3}]},
    measurements:{
     width:[['50.0','50.2','60.0','60.4','60.8'],
            ['50.1','50.2','60.1','60.4','60.9']],
     /* 板厚は丈ごとに3点（OS/CL/DS）。条には紐づかない。 */
     thickness:[['1.000','1.010','1.020'],['1.030','1.040','1.050']]},
    product:{rows:[{productLength:'1200.5'},{productLength:'1180.0'}]}};
   const lots=WL.reportStat.lots(x);
   const html=WL.reportStat.tableHtml(x);
   const doc=new DOMParser().parseFromString('<table>'+html+'</table>','text/html');
   const sec=doc.querySelector('.rp-stat-table');
   const rows=sec?[...sec.querySelectorAll('tbody tr')].map(tr=>({
     名:tr.querySelector('th').textContent.replace(/\s+/g,' ').trim(),
     値:[...tr.querySelectorAll('td')].map(td=>td.textContent.trim()),
     na:tr.querySelectorAll('td.rp-stat-na').length})):[];
   return {lots,rows,
     見出し:sec?[...sec.querySelectorAll('thead th')].map(t=>t.textContent.trim()):[],
     注記:(doc.querySelector('.rp-note')||{}).textContent||'',
     /* 分割の無いロットでは「全体」1行だけ（同じ塊が両方の場面で使える）。 */
     単独:WL.reportStat.lots({settings:{verticalCount:1,horizontalCount:3},
       measurements:{width:[['10','11','12']]}}).length,
     塊:(WL.reportBlocks.keys()||[]).indexOf(WL.reportStat.blockKey())>=0};
  });
  rec('測定値の統計の塊が組み換えの候補に出る',stat2.塊);
  rec('子ロットごとの統計が作られる',stat2.lots.length===2,
      JSON.stringify(stat2.lots.map(l=>l.lot)));
  rec('分割の無いロットでは子ロットの行を作らない',stat2.単独===0,String(stat2.単独));
  if(stat2.lots.length===2){
   const A=stat2.lots[0],Bl=stat2.lots[1];
   /* **本丸**——それぞれの条の範囲だけから数えていること。 */
   rec('子ロットAの板幅は 50.0〜50.2（そのロットの条だけ）',
       A.width.min==='50.0'&&A.width.max==='50.2'&&A.width.n==='4',
       JSON.stringify(A.width));
   rec('子ロットBの板幅は 60.0〜60.9',
       Bl.width.min==='60.0'&&Bl.width.max==='60.9'&&Bl.width.n==='6',
       JSON.stringify(Bl.width));
   rec('条の範囲を持つ（紙に「1〜2条」と書ける）',
       A.from===0&&A.to===2&&Bl.from===2&&Bl.to===5,
       JSON.stringify([A.from,A.to,Bl.from,Bl.to]));
   /* **言えないことは言わない**（§4）——丈ごとの項目はnullで、表では「—」。 */
   rec('板厚は子ロットごとに出さない（丈ごとの測定）',
       A.thickness===null&&Bl.thickness===null,
       JSON.stringify([A.thickness,Bl.thickness]));
   rec('板丈も子ロットごとに出さない',A.length===null,JSON.stringify(A.length));
  }
  rec('表は「全体」＋子ロットの3行',
      stat2.rows.length===3&&stat2.rows[0].名==='全体'
      &&/CHILD-A/.test(stat2.rows[1].名)&&/CHILD-B/.test(stat2.rows[2].名),
      stat2.rows.map(r=>r.名).join(' / '));
  rec('子ロットの行に条の範囲を書く',
      /1〜2条/.test(stat2.rows[1].名||'')&&/3〜5条/.test(stat2.rows[2].名||''),
      (stat2.rows[1]||{}).名+' / '+(stat2.rows[2]||{}).名);
  rec('全体の行は全部の条から数える',
      (stat2.rows[0].値||[]).indexOf('50.0')>=0&&(stat2.rows[0].値||[]).indexOf('60.9')>=0,
      (stat2.rows[0].値||[]).join(','));
  rec('出せない組み合わせは「—」で、全体の行には出さない',
      stat2.rows[0].na===0&&stat2.rows[1].na>0&&stat2.rows[2].na>0,
      JSON.stringify(stat2.rows.map(r=>r.na)));
  rec('出せない理由を紙に書く',/丈ごと/.test(stat2.注記),stat2.注記.slice(0,60));

  /* ==========================================================
     帳票ブロックマスタの塊が子ロットごとに繰り返せる（§9.247 ②、利用者の指示）
     ----------------------------------------------------------
       「帳票ブロックマスタに異幅分割ありのロットでロット番号が1ロット内に
        複数混在するパターンにおいても各分割ロット単位ごとに統計データが
        出てくるように対応をお願いします」

     §9.244で足したのは**既定の「測定値の統計」の表**だけで、
     **帳票ブロックマスタで自分が作った塊**からは`stat.*`を子ロット単位で
     引けなかった（全部の条をまとめた1組しか出ない）。

     ここで固定するのは:
      1. 繰り返すと**子ロットの数だけ節が出る**（見出しに番号と条の範囲）
      2. 中の`stat.*`が**その子ロットの条だけ**から数え直される
      3. 条に紐づかない項目（板厚）は「—」＋理由（§4）
      4. **繰り返さない塊は今までどおり1回**・全体の値（見え方を変えない）
      5. **分割の無いロットでは繰り返しても1回**（設備の紙を分けなくてよい）
      6. `lot.*`はどちらに置いても空欄にならない（繰り返さなければ親ロット）

     **紙になる節そのものを見ること**——値を1つ引くだけの網は、繰り返しが
     効いていなくても通る。
     ========================================================== */
  const rep=await page.evaluate(()=>{
   /* 上と同じ材料。条1〜2＝CHILD-A（50台）／条3〜5＝CHILD-B（60台）。 */
   const x={basic:{lotNo:'PARENT-1'},
    settings:{verticalCount:2,horizontalCount:5,
     splitGroups:[{lot:'CHILD-A',count:2},{lot:'CHILD-B',count:3}]},
    measurements:{
     width:[['50.0','50.2','60.0','60.4','60.8'],
            ['50.1','50.2','60.1','60.4','60.9']],
     thickness:[['1.000','1.010','1.020'],['1.030','1.040','1.050']]},
    product:{rows:[]}};
   /* 分割の無いロット（同じ塊を当てて1回だけになることを見る）。 */
   const solo={basic:{lotNo:'SOLO-1'},settings:{verticalCount:1,horizontalCount:3},
     measurements:{width:[['10','11','12']]},product:{rows:[]}};
   const fields=[{label:'子ロット',path:'lot.no',span:1},
                 {label:'条',path:'lot.range',span:1},
                 {label:'幅MIN',path:'stat.width.min',span:1},
                 {label:'幅MAX',path:'stat.width.max',span:1},
                 {label:'板厚MIN',path:'stat.thickness.min',span:1}];
   const parse=h=>{
    const d=document.createElement('div');d.innerHTML=h;
    return [...d.querySelectorAll('.rp-section')].map(sec=>({
      見出し:sec.querySelector('h3').textContent.replace(/\s+/g,' ').trim(),
      値:[...sec.querySelectorAll('.rp-field-value')].map(v=>v.textContent.trim()),
      理由:[...sec.querySelectorAll('.rp-field-value')]
            .filter(v=>v.textContent.trim()==='—')
            .map(v=>v.getAttribute('title')||'')}));
   };
   return {
    繰返あり:parse(WL.reportStat.sectionHtml(x,'幅の統計',fields,0,'子ロット')),
    繰返なし:parse(WL.reportStat.sectionHtml(x,'幅の統計',fields,0,'')),
    分割なし:parse(WL.reportStat.sectionHtml(solo,'幅の統計',fields,0,'子ロット')),
    回数:{あり:WL.reportStat.repeatLots(x,true).length,
          なし:WL.reportStat.repeatLots(x,false).length,
          分割なし:WL.reportStat.repeatLots(solo,true).length}};
  });
  rec('繰り返すと子ロットの数だけ節が出る',rep.繰返あり.length===2,
      rep.繰返あり.map(s=>s.見出し).join(' / '));
  rec('節の見出しに子ロット番号と条の範囲が付く',
      /CHILD-A/.test((rep.繰返あり[0]||{}).見出し||'')
      &&/1〜2条/.test((rep.繰返あり[0]||{}).見出し||'')
      &&/CHILD-B/.test((rep.繰返あり[1]||{}).見出し||'')
      &&/3〜5条/.test((rep.繰返あり[1]||{}).見出し||''),
      rep.繰返あり.map(s=>s.見出し).join(' / '));
  /* **本丸**——それぞれの子ロットの条だけから数え直されていること
     （混ざっていれば 50台の節に 60台の数字が出る）。 */
  rec('子ロットAの節は 50.0〜50.2（その子ロットの条だけ）',
      ((rep.繰返あり[0]||{}).値||[]).join('/')==='CHILD-A/1〜2/50.0/50.2/—',
      JSON.stringify((rep.繰返あり[0]||{}).値));
  rec('子ロットBの節は 60.0〜60.9',
      ((rep.繰返あり[1]||{}).値||[]).join('/')==='CHILD-B/3〜5/60.0/60.9/—',
      JSON.stringify((rep.繰返あり[1]||{}).値));
  rec('条に紐づかない項目は「—」＋理由（§4）',
      /丈ごと/.test((((rep.繰返あり[0]||{}).理由)||[])[0]||''),
      (((rep.繰返あり[0]||{}).理由)||[])[0]||'(理由なし)');
  /* **もう片側**——繰り返さない塊の見え方を変えていないこと。片側だけを
     見る網は、いつも繰り返す実装でも通る。 */
  rec('繰り返さない塊は今までどおり1回・全体の値',
      rep.繰返なし.length===1
      &&((rep.繰返なし[0]||{}).値||[]).join('/')==='PARENT-1/-/50.0/60.9/1.000',
      JSON.stringify((rep.繰返なし[0]||{}).値));
  rec('分割の無いロットでは繰り返しても1回だけ',
      rep.分割なし.length===1&&rep.回数.分割なし===1,
      JSON.stringify(rep.回数));
  rec('繰り返しの回数は子ロットの数（1回/2回）',
      rep.回数.あり===2&&rep.回数.なし===1,JSON.stringify(rep.回数));

  /* ==========================================================
     表に組んだ塊は「1つの表」の中で子ロットぶんへ広がる（§9.277、利用者の報告）
     ----------------------------------------------------------
       「紙での見え方は表に組んだ後も…実際に帳票を見ると今までの表示と
        変わらない状態です。子ロット分縦に積む形が今までなので縦に積むが
        標準で横に積むか表を組むときに、EXCELのピボットテーブルのように
        自由に組めるように」

     §9.247 ②の繰り返しは**塊ごと**（子ロットの数だけ節が出る）。
     盤で「表に組む」と、`lot:true`の印が付いた**ひとかたまり**だけを
     子ロットの数だけ複製する形になり、既定の`測定値の統計`と同じ絵になる。

     ここで固定するのは:
      1. 印のあるマスがあれば**節は1つ**（塊ごとの繰り返しへ落ちない）
      2. 印の付いた並びが**子ロットの数だけ**複製される
      3. **印の無いマスは「全体」**（`lots[0]`＝1本目の子ロットではない）
      4. 印が1つも無ければ今までどおり（片側だけ見る網にしない）
      5. 繰り返しの向き`横`で**横並びの器**に入る（既定の縦は器を作らない）
     ========================================================== */
  const piv=await page.evaluate(()=>{
   const x={basic:{lotNo:'PARENT-1'},
    settings:{verticalCount:2,horizontalCount:5,
     splitGroups:[{lot:'CHILD-A',count:2},{lot:'CHILD-B',count:3}]},
    measurements:{
     width:[['50.0','50.2','60.0','60.4','60.8'],
            ['50.1','50.2','60.1','60.4','60.9']],
     thickness:[['1.000','1.010','1.020'],['1.030','1.040','1.050']]},
    product:{rows:[]}};
   /* 盤が組む形（対象＝行／集計＝列）を手で書き下ろしたもの。
      1段目＝見出し、2段目＝「全体」の行（印なし）、3段目＝対象の型（印あり）。 */
   const cell=(o)=>Object.assign({label:'',path:'',span:1,rows:1,blank:false,
     kind:'value',showLabel:false,align:'',format:null,lot:false},o);
   const table=[
    cell({kind:'blank',blank:true,label:''}),
    cell({kind:'head',label:'MIN'}),cell({kind:'head',label:'MAX'}),
    cell({kind:'head',label:'全体',align:'left'}),
    cell({label:'MIN',path:'stat.width.min',align:'right'}),
    cell({label:'MAX',path:'stat.width.max',align:'right'}),
    cell({label:'子ロット',path:'lot.no',align:'left',lot:true}),
    cell({label:'MIN',path:'stat.width.min',align:'right',lot:true}),
    cell({label:'MAX',path:'stat.width.max',align:'right',lot:true})];
   const plain=[cell({label:'幅MIN',path:'stat.width.min',showLabel:true}),
                cell({label:'幅MAX',path:'stat.width.max',showLabel:true})];
   const wrap=h=>{const d=document.createElement('div');d.innerHTML=h;return d};
   /* **マスの並び順のまま読む**——見出しのマスと値のマスが混ざるので、
      `.rp-field`を順に見て種類ごとの文字を拾う（別々に集めると、
      「全体の行の下に子ロットが来る」という並びそのものを確かめられない）。 */
   const secs=h=>[...wrap(h).querySelectorAll('.rp-section')].map(sec=>({
     見出し:sec.querySelector('h3').textContent.replace(/\s+/g,' ').trim(),
     並び:[...sec.querySelectorAll('.rp-grid>.rp-field')].map(f=>
       f.classList.contains('rp-field-blank')?'□'
       :(f.querySelector('.rp-field-headtext')||f.querySelector('.rp-field-value')||f)
          .textContent.trim())}));
   const H=WL.reportStat.sectionHtml;
   const row=h=>{const d=wrap(h);const r=d.querySelector('.rp-repeat-row');
     return r?{器:1,節:r.querySelectorAll('.rp-section').length,
               列:r.style.getPropertyValue('--rp-repeat')}:{器:0}};
   return {
    ピボット:secs(H(x,'幅の表',table,3,'子ロット')),
    印なし:secs(H(x,'幅の表',plain,0,'子ロット')),
    横:row(H(x,'幅の表',plain,0,'子ロット','横')),
    縦:row(H(x,'幅の表',plain,0,'子ロット','')),
    横1件:row(H(x,'幅の表',plain,0,'','横'))};
  });
  rec('§9.277 表に組んだ塊は節が1つ（塊ごとの繰り返しへ落ちない）',
      piv.ピボット.length===1,JSON.stringify(piv.ピボット.map(s=>s.見出し)));
  /* **本丸**——「全体」の行は全体の値、その下に子ロットが2本ぶん。 */
  rec('§9.277 印の無いマスは「全体」（1本目の子ロットの値を出さない）',
      ((piv.ピボット[0]||{}).並び||[]).slice(0,6).join('/')
        ==='□/MIN/MAX/全体/50.0/60.9',
      JSON.stringify(((piv.ピボット[0]||{}).並び||[]).slice(0,6)));
  rec('§9.277 印の付いた並びが子ロットの数だけ複製される',
      ((piv.ピボット[0]||{}).並び||[]).slice(6).join('/')
        ==='CHILD-A/50.0/50.2/CHILD-B/60.0/60.9',
      JSON.stringify(((piv.ピボット[0]||{}).並び||[]).slice(6)));
  rec('§9.277 印が1つも無ければ今までどおり塊ごとに繰り返す',
      piv.印なし.length===2,JSON.stringify(piv.印なし.map(s=>s.見出し)));
  rec('§9.277 繰り返しの向き「横」で横並びの器に入る',
      piv.横.器===1&&piv.横.節===2&&piv.横.列==='2',JSON.stringify(piv.横));
  rec('§9.277 既定（縦に積む）は器を作らない／1回だけの繰り返しも作らない',
      piv.縦.器===0&&piv.横1件.器===0,JSON.stringify([piv.縦,piv.横1件]));

  /* ==========================================================
     内訳の列数が空でも、表に組んだ形は崩れない（§9.279、利用者の報告）
     ----------------------------------------------------------
       「保存した設定と帳票レイアウト(プレビュー)が合っていません。
        帳票ブロックでの表示が正です」

     欄の説明は「空欄なら**中身の数から決まります**」と約束しているのに、
     紙は`Number(cols)||2`でいつも2列に落ちていた。表に組んだ塊が2列に
     潰れると、見出しと値が総崩れになる（利用者の画像がまさにこれ）。

     **当てられるときだけ当てる**——「すき間なく埋まる」だけでは決まらない
     （合計が3でも5でも割り切れる）。左上の空きマスの`縦`が2以上のときは
     1段目の見出しの並びから一意に決まるので、そこだけ当てる。
     ========================================================== */
  const derived=await page.evaluate(()=>{
   const c=(o)=>['',''].concat([o]);  /* [label,value,opt] の形 */
   const cell=(label,value,o)=>[label,value,Object.assign({span:1,rows:1},o||{})];
   /* 行＝対象／列＝項目（板厚・板幅）×集計（MAX・MIN）＝5列の形 */
   const table=[
    cell('','',{blank:true,span:1,rows:2}),
    cell('板厚','',{head:true,span:2}),cell('板幅','',{head:true,span:2}),
    cell('MAX','',{head:true}),cell('MIN','',{head:true}),
    cell('MAX','',{head:true}),cell('MIN','',{head:true}),
    cell('全体','',{head:true}),
    cell('a','1',{showLabel:false}),cell('b','2',{showLabel:false}),
    cell('c','3',{showLabel:false}),cell('d','4',{showLabel:false})];
   const plain=[cell('ロット番号','L1'),cell('取引先','A'),
                cell('用途','B'),cell('納入先','C')];
   const cols=h=>{const d=document.createElement('div');d.innerHTML=h;
     const g=d.querySelector('.rp-grid');
     return g?(g.style.getPropertyValue('--rp-cols')||g.className):'(格子なし)'};
   const S=WL.reportSectionHtml;
   return {表_空:cols(S('T',table,0)),表_5:cols(S('T',table,5)),
     表_指定3:cols(S('T',table,3)),ふつう_空:cols(S('T',plain,0))};
  });
  rec('§9.279 内訳の列数が空でも、表に組んだ形の列数を保つ',
      derived.表_空==='5'&&derived.表_5==='5',JSON.stringify(derived));
  /* **欄が持ち主**（§CLAUDE 8）——数が入っていればそれに従う（当て直さない）。 */
  rec('§9.279 欄に数が入っていればそれが勝つ',derived.表_指定3==='3',derived.表_指定3);
  /* **もう片側**——ふつうの「ラベル＝値」の並びは今までどおり2列
     （現場の紙を勝手に変えない）。 */
  rec('§9.279 ふつうの並びは今までどおり（当てに行かない）',
      derived.ふつう_空.indexOf('rp-grid')>=0&&derived.ふつう_空.indexOf('rp-grid-m')<0,
      derived.ふつう_空);

  /* ==========================================================
     塊の中もグリッド（§9.255 ②、利用者の指示）
     ----------------------------------------------------------
       「帳票ブロックマスタも『紙での並び』の部分は単純に何列何行だけでなく、
        データ内もグリッドに対応する形で細かく調整できるようにしてください」

     **紙に出る節そのものを見る**——設定画面のつまみが動くだけでは、
     紙が今までどおり1マスずつ並べていても通る。
     ========================================================== */
  const mx=await page.evaluate(()=>{
   const x={basic:{lotNo:'G-1'},settings:{verticalCount:1,horizontalCount:1},
     measurements:{},product:{rows:[]}};
   const fields=[{label:'大きい',path:'basic.lotNo',span:2,rows:3},
                 {label:'ふつう',path:'basic.lotNo',span:1,rows:1},
                 {label:'空き',path:'',blank:true,span:1,rows:1}];
   const old=[{label:'ふつう',path:'basic.lotNo',span:1,rows:1}];
   const cells=h=>{
    const d=document.createElement('div');d.innerHTML=h;
    const g=d.querySelector('.rp-grid');
    return {格子:g?g.className:'',
      並べ方:g?(g.getAttribute('style')||''):'',
      マス:[...d.querySelectorAll('.rp-field')].map(f=>f.getAttribute('style')||'')};
   };
   return {広い:cells(WL.reportStat.sectionHtml(x,'配置',fields,3,'')),
           素:cells(WL.reportStat.sectionHtml(x,'配置',old,0,''))};
  });
  rec('横のマス数が紙のグリッドへ出る',
      /grid-column:\s*span 2/.test((mx.広い.マス||[])[0]||''),
      JSON.stringify(mx.広い.マス));
  rec('縦のマス数も紙のグリッドへ出る（§9.255 ②）',
      /grid-row:\s*span 3/.test((mx.広い.マス||[])[0]||''),
      JSON.stringify(mx.広い.マス));
  rec('1マスの項目には縦の指定を書かない（余計な指定を増やさない）',
      !/grid-row/.test((mx.広い.マス||[])[1]||''),
      JSON.stringify((mx.広い.マス||[])[1]));
  /* **もう片側**——1マスだけの塊（既に登録してある形）の見え方は変えない。 */
  rec('全部1マスの塊は今までどおり（マトリクスにしない）',
      !/rp-grid-m/.test(mx.素.格子)&&((mx.素.マス||[])[0]||'')==='',
      JSON.stringify(mx.素));

  /* ==========================================================
     子ロットごとの統計は「開けば出ている」（§9.248 ②、利用者の指示）
     ----------------------------------------------------------
       「帳票ブロックマスタに異幅分割ありのロットでロット番号が1ロット内に
        複数混在するパターンにおいても各分割ロット単位ごとに統計データが
        出てくるように対応をお願いします」

     **これは§9.247 ②と同じ文言の2度目の指摘**——仕組み（`[繰返]`＝子ロット、
     `統計の塊`）は前回で入っていたが、**どちらも既定が「出さない」**だったので
     利用者の席からは何一つ変わっていなかった。だから固定するのは
     「引ける」ことではなく**紙に出ている**こと。

     ここで見ること:
      1. 分割ありのロットを開くと、**触らなくても**統計の節が紙に出る
      2. 子ロットの数だけ行があり、板幅が子ロットごとに切れている
      3. **分割の無いロットの紙は1枚も増えない**（今までどおり）
      4. 既に配置を保存してある設備（＝既定が効かない）では、
         **先回りして「統計を出す」を画面に出す**（§2）。押すと紙に出る

     **紙になる節そのものを見ること**——`WL.reportStat.lots()`が値を返すか
     だけを見る網は、既定で隠したままの実装でも通る（実際にそうなっていた）。
     ========================================================== */
  const SPLIT_ID='rpsplit-eqA';
  const putRec=(id,lotNo,payload)=>post('/api/measurement/backup',
    {id,equipment:EQ,lotNo,inspectionNo:'K-RP',status:'編集中',
     codec:'json-full-v32',payload:JSON.stringify(payload),user_id:'test'});
  /* 丈2・条5。条1〜2＝CHILD-A（板幅50台）／条3〜5＝CHILD-B（60台）。 */
  await putRec(SPLIT_ID,'RPSPLIT-1',{
    basic:{lotNo:'RPSPLIT-1',inspectionNo:'K-RP'},
    settings:{registeredEquipment:EQ,verticalCount:2,horizontalCount:5,
      splitGroups:[{lot:'CHILD-A',count:2},{lot:'CHILD-B',count:3}]},
    measurements:{width:[['50.0','50.2','60.0','60.4','60.8'],
                         ['50.1','50.2','60.1','60.4','60.9']],
      thickness:[['1.000','1.010','1.020'],['1.030','1.040','1.050']]}});
  /* **配置は白紙から**（既定を見たいので、前の段が保存したものを消す）。 */
  await cleanup();
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());

  const openSplit=async()=>{
   await page.evaluate(()=>openRecordsSafe('編集中'));
   await page.waitForSelector('.record-list-row',{timeout:25000});
   const hit=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.record-list-row')]
      .find(x=>/RPSPLIT-1/.test(x.textContent||''));
    if(!r)return false;
    const b=r.querySelector('.report');if(!b)return false;
    b.click();return true;
   });
   if(!hit)return false;
   await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
   await settle(page);
   return true;
  };
  const paper=()=>page.evaluate(()=>{
   /* 節の題は`<h3>`（`.rp-section-title`ではない）。**表そのものから辿る**
      ——題の綴りに依存すると、見出しを直しただけで網が空振りする。 */
   const tbl=document.querySelector('#reportContent .rp-stat-table');
   const sec=tbl&&tbl.closest('.rp-section');
   return {
    節:!!sec,
    行:tbl?[...tbl.querySelectorAll('tbody tr')].map(tr=>
        [tr.querySelector('th')?tr.querySelector('th').textContent.trim():'',
         ...[...tr.querySelectorAll('td')].map(td=>td.textContent.trim())].join('/')):[],
    先回り:(()=>{const e=document.getElementById('rpSplitHint');
      return e?{文:(e.textContent||'').replace(/\s+/g,' ').trim(),
                説明:(e.title||'').slice(0,120)}:null})()};
  });

  const opened=await openSplit();
  rec('前提: 分割ありのロットの帳票を開ける',opened,String(opened));
  const P1=opened?await paper():{節:false,行:[],先回り:null};
  /* **本丸①**——触らずに開いて、紙に統計の節が出ていること。 */
  rec('分割ありのロットは開いた時点で統計の節が紙に出る',P1.節===true,
      JSON.stringify({節:P1.節,行数:P1.行.length}));
  rec('子ロットの数だけ行がある（全体＋CHILD-A＋CHILD-B）',
      P1.行.some(r=>/CHILD-A/.test(r))&&P1.行.some(r=>/CHILD-B/.test(r)),
      P1.行.join(' | ').slice(0,200));
  rec('板幅が子ロットごとに切れている（50台と60台）',
      P1.行.some(r=>/CHILD-A/.test(r)&&/50\.0/.test(r)&&/50\.2/.test(r))
      &&P1.行.some(r=>/CHILD-B/.test(r)&&/60\.0/.test(r)&&/60\.9/.test(r)),
      P1.行.filter(r=>/CHILD-/.test(r)).join(' | ').slice(0,200));
  /* **先回りの案内は要らない**（既に出ているので、出すと同じことを2度言う・§8）。 */
  rec('既に出ているときは「統計を出す」を出さない',P1.先回り===null,
      JSON.stringify(P1.先回り));

  /* **本丸②**——分割の無いロットの紙は今までどおり（勝手に増やさない）。 */
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  const soloOk=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.record-list-row')]
     .find(x=>!/RPSPLIT-1/.test(x.textContent||'')&&x.querySelector('.report'));
   if(!r)return false;r.querySelector('.report').click();return true;
  });
  if(soloOk){
   await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
   await settle(page);
   const P2=await paper();
   rec('分割の無いロットの紙は増えない（統計の節を出さない）',P2.節===false,
       JSON.stringify({節:P2.節}));
   rec('分割が無ければ「統計を出す」の案内も出さない',P2.先回り===null,
       JSON.stringify(P2.先回り));
  }else{
   rec('分割の無いロットの紙は増えない（統計の節を出さない）',false,'比べる相手が居ません');
   rec('分割が無ければ「統計を出す」の案内も出さない',false,'比べる相手が居ません');
  }

  /* **本丸③**——既に配置を保存してある設備では既定が効かない。
     そこで**先回りして出す手立てを画面に置く**（§2・§4）。 */
  await page.evaluate(async t=>{
   const keys=WL.reportBlocks.keys();
   await WL.columnLayout.patch(t,{order:[...keys],hidden:['測定値の統計']});
  },TARGET);
  const again=await openSplit();
  const P3=again?await paper():{節:null,先回り:null};
  rec('保存済みの配置で隠していれば、紙には出ない（設定を尊重する）',
      P3.節===false,JSON.stringify({節:P3.節}));
  rec('そのとき「子ロットN件 統計を出す」を先回りして出す',
      !!P3.先回り&&/子ロット2件/.test(P3.先回り.文)&&/統計を出す/.test(P3.先回り.文),
      JSON.stringify(P3.先回り));
  rec('何が起きるかを説明に書く（子ロット番号つき）',
      !!P3.先回り&&/CHILD-A/.test(P3.先回り.説明)&&/CHILD-B/.test(P3.先回り.説明),
      (P3.先回り||{}).説明||'(説明なし)');
  if(P3.先回り){
   await page.click('#rpSplitHint');
   await page.waitForFunction(()=>!document.getElementById('rpSplitHint'),null,{timeout:15000})
     .catch(()=>{});
   await settle(page);
   const P4=await paper();
   rec('押すと統計の節が紙に出て、案内は引っ込む',
       P4.節===true&&P4.先回り===null&&P4.行.some(r=>/CHILD-B/.test(r)),
       JSON.stringify({節:P4.節,案内:P4.先回り,行数:P4.行.length}));
  }else rec('押すと統計の節が紙に出て、案内は引っ込む',false,'案内が出ていません');


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
  await cleanupRecs();
  if(b)await b.close().catch(()=>{});
 }
})();
