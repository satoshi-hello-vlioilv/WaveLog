'use strict';
const {run}=require('./lib/harness.js');
run('test_listmodal: §9.90で端は8方向になった。右下では角のつまみ(.sc-float-grip-se)が', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();
 await page.evaluate(()=>{try{localStorage.removeItem('scListModalRectV2')}catch(e){}});
 await W.openSchedule(page,'テスト設備A',{rows:false}); await idle();
 await page.click('#scListModalBtn');
 await page.waitForSelector('#scListModal',{state:'visible',timeout:5000});
 await idle();

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
 await paint();
 const after=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('行数が多い状態でもドラッグでサイズ変更できる',after.w>before.w+120&&after.h>before.h+80,`${before.w}x${before.h} -> ${after.w}x${after.h}`);

 // 縮小もできる
 const r2=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {r:r.right,b:r.bottom}});
 await page.mouse.move(r2.r-6,r2.b-6);
 await page.mouse.down();
 await page.mouse.move(r2.r-200,r2.b-150,{steps:10});
 await page.mouse.up();
 await paint();
 const shrunk=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('縮小方向にもサイズ変更できる',shrunk.w<after.w-120&&shrunk.h<after.h-80,`${after.w}x${after.h} -> ${shrunk.w}x${shrunk.h}`);

 // 再オープンでサイズ保持
 await page.click('#scListModalClose'); await page.waitForSelector('#scListModal',{state:'hidden',timeout:5000});
 await page.click('#scListModalBtn'); await page.waitForSelector('#scListModal',{state:'visible',timeout:5000}); await idle();
 const re=await page.evaluate(()=>{const r=document.querySelector('#scListModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('変更した大きさが次に開いたときも維持される',Math.abs(re.w-shrunk.w)<=2&&Math.abs(re.h-shrunk.h)<=2,JSON.stringify(re));

 // 実際に横スクロールできる
 const sc=await page.evaluate(()=>{const g=document.querySelector('#grid');g.scrollLeft=200;return {left:g.scrollLeft,scrollW:g.scrollWidth,clientW:g.clientWidth}});
 rec('横方向に実際にスクロールできる',sc.left>0,JSON.stringify(sc));

}, {viewport:{width:1500,height:900}});
