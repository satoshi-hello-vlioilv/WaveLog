/* test_listperf.js: 一覧を開いたときに画面が固まらないこと(§9.94)
   ============================================================
   実機で「一覧に切り替えると初回のデータ取得でブラウザがフリーズする」
   と報告された。実測した内訳は次の3つで、どれが戻っても同じ症状になる。

    1. **列幅はこちらが全列ぶん指定する**(table-layout:fixed)
       既定のautoは列幅を決めるために全セルの自然幅を測る。実データ
       (200行×214列=42,800セル)で**3.4秒メインスレッドが止まった**。
    2. **行ごとの追い判定は描画のあと・まとめて・軽く**
       分割ありの子ロット確認と子カード行の親逆引きが、行ごとに
       `/api/table`(全列・50行)を投げていた。1ページで67往復・約30MBを
       受け取り、解くたびに画面が止まっていた。
       先頭をまとめて引き(starts_any)、要る列だけ頼む(columns=)。
    3. **大きい表は少しずつ並べる**
       セル数に比例してレイアウトが重くなるので、一度に全部渡すと
       その間ずっと操作できない。最初の一塊を出してから継ぎ足す。
    4. **横に見えている列だけ作る**(§9.104、「列の窓」)
       実データは214列あるが画面に入るのは16列。残り約200列は見えない
       のに毎回並べ直されていた。実測(214列×50行の1回の組み直し)で
       **962ms→23ms**。`display:none`で隠すだけでは501msにしか下がらない
       ——作ってしまうとレイアウトから外れないので、**作らない**。
       見出し(thead)とcolgroupは全列のまま置き、本文だけ畳む。

   ここで固定するのは「速さ」ではなく**この4つの作りが残っていること**。
   実時間はマシンで変わるので、往復回数・DOMの形・順序で見る。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const ctx=await b.newContext({viewport:{width:1600,height:950}});
 await ctx.addInitScript(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 const page=await ctx.newPage();
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));

 // 行ごとの追い判定(filters付きの/api/table)を数える
 const lookups=[];
 page.on('request',r=>{const u=r.url();
   if(u.includes('/api/table?')&&u.includes('filters='))lookups.push(decodeURIComponent(u))});

 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});

  // ---- 1. 列幅は全列ぶん指定されている ----
  const cg=await page.evaluate(()=>{
   const t=document.querySelector('#grid table');
   const cols=[...t.querySelectorAll('colgroup col')];
   const heads=t.querySelectorAll('thead th').length;
   return {layout:getComputedStyle(t).tableLayout,cols:cols.length,heads,
           withWidth:cols.filter(c=>c.style.width).length,
           widths:cols.slice(0,6).map(c=>c.style.width)};
  });
  rec('一覧の表は table-layout:fixed（全セルを測らせない）',cg.layout==='fixed',cg.layout);
  rec('colgroup が見出しと同じ数だけある',cg.cols===cg.heads,`col=${cg.cols} / th=${cg.heads}`);
  rec('**すべての列**に幅が入っている（入れ忘れると等分に潰れる）',
    cg.cols>0&&cg.withWidth===cg.cols,`${cg.withWidth}/${cg.cols} ${JSON.stringify(cg.widths)}`);

  // ---- 2. 幅は見出しとデータから見積もられている ----
  const est=await page.evaluate(()=>{
   // 半角と全角で見積りが変わること(文字数ではなく字幅で数えている証拠)
   const half=estimateColumnWidth('ABCDEFGH',[],14,6);
   const full=estimateColumnWidth('あいうえおかきく',[],14,6);
   const long=estimateColumnWidth('A',['あ'.repeat(200)],14,6);
   const short=estimateColumnWidth('A',[''],14,6);
   return {half,full,long,short};
  });
  rec('全角の見出しは半角より広く見積もる',est.full>est.half,JSON.stringify(est));
  rec('極端に長い値でも上限で止まる（1列で画面が埋まらない）',est.long<=320,String(est.long));
  rec('空でも下限は確保する（掴めない細さにしない）',est.short>=52,String(est.short));

  // ---- 3. 入り切らない値は省略記号＋titleで読める ----
  const clip=await page.evaluate(()=>{
   const td=document.querySelector('#grid tbody td');
   return {overflow:getComputedStyle(td).overflow,ellipsis:getComputedStyle(td).textOverflow};
  });
  rec('セルは溢れさせず省略記号にする',clip.overflow==='hidden'&&clip.ellipsis==='ellipsis',JSON.stringify(clip));
  const tipped=await page.evaluate(()=>{
   // 幅より広い値を持つセルには必ずtitleが付く
   const tds=[...document.querySelectorAll('#grid tbody tr:first-child td')];
   const over=tds.filter(td=>td.scrollWidth>td.clientWidth+1);
   return {over:over.length,withTitle:over.filter(td=>td.title).length};
  });
  rec('切れているセルには生の値のtitleが付く',tipped.over===tipped.withTitle,JSON.stringify(tipped));

  // ---- 4. 行ごとの追い判定は一覧が出たあとで、まとめて引く ----
  const atPaint=lookups.length;
  rec('一覧が出た時点では行ごとの追い判定を始めていない',atPaint===0,`${atPaint}件`);
  /* 追い判定が起きるのは「分割あり」「ｺﾝﾏ5本ｶｰﾄﾞ区分=3」の行だけ。
     フィクスチャではL9000系がそれなので、その3行を出した状態で見る。 */
  await page.fill('#search','L900');
  await page.waitForFunction(()=>document.querySelectorAll('#grid tbody tr').length<=5
    &&document.querySelectorAll('#grid tbody tr').length>0,{timeout:15000});
  await page.waitForTimeout(4000);
  const kinds={
   any:lookups.filter(u=>u.includes('starts_any')).length,
   one:lookups.filter(u=>!u.includes('starts_any')).length,
   projected:lookups.filter(u=>u.includes('columns=')).length,
  };
  rec('先頭はまとめて引く（starts_anyの問い合わせがある）',kinds.any>=1,JSON.stringify(kinds));
  rec('追い判定は要る列だけ頼む（columns=が付く）',
    lookups.length===0||kinds.projected===lookups.length,JSON.stringify(kinds));
  rec('1行1往復に戻っていない（追い判定の往復が十数本を超えない）',
    lookups.length<=12,`${lookups.length}件`);

  // ---- 5. 大きい表は少しずつ並べ、最後には全行そろう ----
  await page.fill('#search','');
  await page.waitForTimeout(1200);
  await page.selectOption('#pageSize','500');
  await page.waitForFunction(()=>document.querySelectorAll('#grid tbody tr').length>0,{timeout:20000});
  const firstPaint=await page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
  await page.waitForFunction(()=>document.querySelectorAll('#grid tbody tr').length>=500,{timeout:20000})
    .catch(()=>{});
  const settled=await page.evaluate(()=>({rows:document.querySelectorAll('#grid tbody tr').length,
                                          count:S.rows.length}));
  rec('最初に出るのは一塊だけ（全部そろうまで待たせない）',
    firstPaint<settled.rows,`最初 ${firstPaint}行 → 最後 ${settled.rows}行`);
  rec('継ぎ足しは最後まで走り、全行そろう',settled.rows===settled.count,JSON.stringify(settled));
  // 継ぎ足しの途中でも操作を受け付ける（並べ替えができる）
  await page.click('#grid thead th[data-sort-col]');
  await page.waitForTimeout(2500);
  const afterSort=await page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
  rec('継ぎ足しのあとに並べ替えても行が壊れない',afterSort>0,`${afterSort}行`);

  // ---- 6. 横に見えている列だけ作る（列の窓、§9.104） ----
  await page.selectOption('#pageSize','200');
  await page.waitForFunction(()=>document.querySelectorAll('#grid tbody tr').length>10,{timeout:20000});
  const win=await page.evaluate(()=>{
   const g=document.getElementById('grid');
   const tr=g.querySelector('tbody tr:not(.grid-virtual-spacer)');
   return {列:g.querySelectorAll('thead th[data-sort-col]').length,
           本文のセル:tr.querySelectorAll('td[data-col]').length,
           畳んだ空セル:tr.querySelectorAll('td.grid-col-spacer').length,
           表の幅:Math.round(g.scrollWidth),器の幅:Math.round(g.clientWidth)};
  });
  /* 器に収まらないほど広いときだけ畳む。収まっているなら畳む先が無いので
     全列そのままが正しい——どちらの側も固定する。 */
  const wide=win.表の幅>win.器の幅+320;
  rec('見出しは全列そろっている（列の窓は本文だけ畳む）',
    win.列>0&&win.表の幅>0,JSON.stringify(win));
  if(wide){
   rec('本文は横に見えている列だけ作る',win.本文のセル<win.列,
     `${win.本文のセル} / ${win.列}列`);
   rec('窓の外はcolspanの空セルに畳む',win.畳んだ空セル>0,`${win.畳んだ空セル}個`);
  }else{
   rec('器に収まる表は畳まない（全列そのまま）',
     win.本文のセル===win.列&&win.畳んだ空セル===0,JSON.stringify(win));
  }
  /* **畳んでも見出しと本文はずれない。** `table-layout:fixed`では
     colspanで束ねた幅が元の列幅の合計になるので、1pxもずれない。
     ここがずれると表として読めなくなる(この作りの一番の危険). */
  const aligned=await page.evaluate(async()=>{
   const g=document.getElementById('grid');
   const check=()=>{
    const tr=g.querySelector('tbody tr:not(.grid-virtual-spacer)');
    const bad=[];let n=0;
    tr.querySelectorAll('td[data-col]').forEach(td=>{
     const th=g.querySelector(`thead th[data-sort-col="${CSS.escape(td.dataset.col)}"]`);
     if(!th)return;
     const a=th.getBoundingClientRect(),c=td.getBoundingClientRect();
     n++;
     if(Math.abs(a.left-c.left)>1||Math.abs(a.width-c.width)>1)
      bad.push(`${td.dataset.col}:${Math.round(a.left)}≠${Math.round(c.left)}`);
    });
    return {n,bad};
   };
   const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const out={n:0,bad:[]};
   for(const x of [0,Math.round(g.scrollWidth/2),g.scrollWidth]){
    g.scrollLeft=x;await raf();await raf();
    const r=check();out.n+=r.n;out.bad.push(...r.bad);
   }
   return out;
  });
  rec('畳んでも見出しと本文の左端・幅がずれない',aligned.bad.length===0,
    aligned.bad.length?aligned.bad.slice(0,3).join(' / '):`${aligned.n}列を照合`);
  /* 横へスクロールしたら、そこにある列が本文にも出ていること
     (畳んだままなら、右のほうの列が永久に空欄に見える)。 */
  const scrolled=await page.evaluate(async()=>{
   const g=document.getElementById('grid');
   g.scrollLeft=g.scrollWidth;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   await new Promise(r=>setTimeout(r,300));
   const gr=g.getBoundingClientRect();
   const tr=g.querySelector('tbody tr:not(.grid-virtual-spacer)');
   const shown=[...g.querySelectorAll('thead th[data-sort-col]')]
     .filter(th=>{const r=th.getBoundingClientRect();return r.right>gr.left+2&&r.left<gr.right-2});
   const missing=shown.filter(th=>!tr.querySelector(
     `td[data-col="${CSS.escape(th.dataset.sortCol)}"]`)).map(th=>th.dataset.sortCol);
   g.scrollLeft=0;
   return {見えている:shown.length,本文に無い:missing};
  });
  rec('右端までスクロールしても、見えている列は本文にも出る',
    scrolled.本文に無い.length===0,JSON.stringify(scrolled));

  rec('コンソールに例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  console.error('FATAL',e);
 }finally{
  await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
