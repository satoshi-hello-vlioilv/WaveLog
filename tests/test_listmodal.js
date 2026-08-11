const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1500,height:900}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>{try{localStorage.removeItem('scListModalRectV2')}catch(e){}});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForTimeout(2200);
 await page.click('#scListModalBtn');
 await page.waitForSelector('#scListModal',{state:'visible',timeout:5000});
 await page.waitForTimeout(900);

 const g=await page.evaluate(()=>{
  const grid=document.querySelector('#grid'),cs=getComputedStyle(grid),gr=grid.getBoundingClientRect();
  const h=document.querySelector('#scListModal .sc-float-resize').getBoundingClientRect();
  return {rows:document.querySelectorAll('#grid tbody tr').length,
          overflowX:cs.overflowX, scrollW:grid.scrollWidth, clientW:grid.clientWidth,
          hasHBar:grid.scrollWidth>grid.clientWidth,
          gridBottom:Math.round(gr.bottom), handleTop:Math.round(h.top),
          gripClearOfGrid:gr.bottom<=h.top+1,
          elemAtGrip:(()=>{const e=document.elementFromPoint(h.right-6,h.bottom-6);return e?(e.className||e.id):'none'})()};
 });
 rec('横スクロールバーが常に表示される設定になっている',g.overflowX==='scroll',`overflow-x=${g.overflowX}, scrollW=${g.scrollW}/${g.clientW}`);
 rec('行数が多く一覧が枠いっぱいでも、つまみが一覧の下端と重ならない',g.gripClearOfGrid,JSON.stringify({rows:g.rows,gridBottom:g.gridBottom,handleTop:g.handleTop}));
 /* §9.90で端は8方向になった。右下では角のつまみ(.sc-float-grip-se)が
    目印(.sc-float-resize)より手前に来る。**どちらもリサイズの受け口**
    なので、拾えたのがそのどちらかであることを見る。 */
 rec('つまみの位置で拾える要素がリサイズハンドル',
  /sc-float-resize|sc-float-grip/.test(String(g.elemAtGrip)),g.elemAtGrip);

 const before=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),r:r.right,b:r.bottom}});
 await page.mouse.move(before.r-6,before.b-6);
 await page.mouse.down();
 await page.mouse.move(before.r+180,before.b+120,{steps:10});
 await page.mouse.up();
 await page.waitForTimeout(300);
 const after=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('行数が多い状態でもドラッグでサイズ変更できる',after.w>before.w+120&&after.h>before.h+80,`${before.w}x${before.h} -> ${after.w}x${after.h}`);

 // 縮小もできる
 const r2=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {r:r.right,b:r.bottom}});
 await page.mouse.move(r2.r-6,r2.b-6);
 await page.mouse.down();
 await page.mouse.move(r2.r-200,r2.b-150,{steps:10});
 await page.mouse.up();
 await page.waitForTimeout(300);
 const shrunk=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('縮小方向にもサイズ変更できる',shrunk.w<after.w-120&&shrunk.h<after.h-80,`${after.w}x${after.h} -> ${shrunk.w}x${shrunk.h}`);

 // 再オープンでサイズ保持
 await page.click('#scListModalClose'); await page.waitForTimeout(600);
 await page.click('#scListModalBtn'); await page.waitForTimeout(800);
 const re=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('変更した大きさが次に開いたときも維持される',Math.abs(re.w-shrunk.w)<=2&&Math.abs(re.h-shrunk.h)<=2,JSON.stringify(re));

 // 実際に横スクロールできる
 const sc=await page.evaluate(()=>{const g=document.querySelector('#grid');g.scrollLeft=200;return {left:g.scrollLeft,scrollW:g.scrollWidth,clientW:g.clientWidth}});
 rec('横方向に実際にスクロールできる',sc.left>0,JSON.stringify(sc));

 console.log('\n=== SUMMARY ===');
 const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
