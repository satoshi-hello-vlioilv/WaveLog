/* test_rprefit.js: 帳票の紙は、描いたあとに字の幅が変わっても測り直して切らない（§9.624）
   ============================================================
   利用者の報告（Latitude 3550・1920×1080・100%）: 帳票の画面で、運転条件の字が折り返し、寸法の「製造」の行・
   運転条件の3段目・測定データの33〜40条が器の下で切れていた。同じ解像度・倍率の Latitude 5340 では入っている。
   紙は描いた直後に1回だけ測って器へ合わせる（`rpFitAll`）。そのあと字の幅が変わる（書体の用意が遅れて差し替わる等）と、
   広がった字が器の中で折り返し、切れたまま残る。

   物差し（評価関数）: 帳票を開いて測り終えたあと、紙の字の幅を広げる（字間 .12em＝書体の差し替えと同じ形の変化）。
    R1. 広げる前: 器の下で切れている塊 0
    R2. 広げたあと: 器の下で切れている塊 0（測り直して縮める・行を足す）
    R3. 広げたあと: 字の大きさ（計算値）は変わらない（縮めるのは器への合わせ込み＝`--rp-fit`だけ）
   ============================================================ */
'use strict';
const {run,seedRecord}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
const settle=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const cutBlocks=page=>page.evaluate(()=>[...document.querySelectorAll('#reportContent [data-rp-block]')].filter(b=>{
 const f=b.querySelector(':scope>.rp-block-fit');if(!f)return false;
 const k=parseFloat(f.style.getPropertyValue('--rp-fit'))||1;
 return f.scrollHeight*k>b.clientHeight+1&&!b.classList.contains('is-cramped');
}).map(b=>`${b.dataset.rpBlock} ${Math.round(b.querySelector(':scope>.rp-block-fit').scrollHeight)}>${b.clientHeight}`));
const fontsOf=page=>page.evaluate(()=>[...document.querySelectorAll('#reportContent [data-rp-block] *')].map(e=>getComputedStyle(e).fontSize).join(','));
run('test_rprefit: 字の幅が後から変わっても紙を測り直す（§9.624）', async ({page,rec,W,idle})=>{
 const id=await seedRecord({lotNo:'L0001'});
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
  await W.openRecordReport(page,{has:'L0001'});
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await idle();await settle(page);
  const before=await cutBlocks(page),f0=await fontsOf(page);
  rec('R1. 広げる前: 器の下で切れている塊 0',!before.length,before.join(' / ')||'0件');
  await page.addStyleTag({content:'#reportContent .rp-block-fit{letter-spacing:.12em}'});
  /* 測り直しは描き直しの次の数フレームで起きる。切れが無くなる（＝条件）まで待ち、待ち切れたらその時の数を記録する。 */
  await W.until(page,()=>![...document.querySelectorAll('#reportContent [data-rp-block]')].some(b=>{
   const f=b.querySelector(':scope>.rp-block-fit');if(!f)return false;
   const k=parseFloat(f.style.getPropertyValue('--rp-fit'))||1;
   return f.scrollHeight*k>b.clientHeight+1&&!b.classList.contains('is-cramped')}),null,{ms:4000,what:'測り直して切れが無くなる'}).catch(()=>{});
  const after=await cutBlocks(page),f1=await fontsOf(page);
  rec('R2. 広げたあと: 器の下で切れている塊 0',!after.length,after.join(' / ')||'0件');
  rec('R3. 広げたあと: 字の大きさは変わらない',f0===f1,f0===f1?'同じ':'変わった');
 }finally{
  await fetch(B+'/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})}).catch(()=>{});
 }
},{viewport:{width:1920,height:1080}});
