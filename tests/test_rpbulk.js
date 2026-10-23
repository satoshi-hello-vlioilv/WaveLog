/* test_rpbulk.js: 「選択した帳票を印刷」（一括印刷）も、測った紙を刷る（§9.626）
   ============================================================
   利用者の報告「帳票表示画面の左下の『選択した帳票を印刷』のボタンから印刷プレビューを表示すると×、
   右上の印刷ボタン（プリンターマークのアイコン）から印刷すると〇」（Latitude 3550・1920×1080・100%）。
   右上は画面に出ている紙（測り終えた紙）を写して刷る。一括印刷は紙を印刷用の器（`#reportBulkPrintArea`）へ描き直して
   測ってから写す（§9.244）が、器を見せる規則が`@media print`の中だけだったので、測るあいだ器は`display:none`
   ——大きさ0で測り、中身なりの塊は1行へ潰れ、場所と高さを決めた塊は縮められないまま刷られていた。

   物差し（評価関数）: 一括印刷で刷る書類（`#rpPrintFrame`）の中を数える。
    B1. 刷る書類の中で器の下が切れている塊 0
    B2. 刷る書類に塊が入っている（空の紙を数えない）
   ============================================================ */
'use strict';
const {run,seedRecord}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
run('test_rpbulk: 一括印刷も測った紙を刷る（§9.626）', async ({page,rec,W,idle})=>{
 const id=await seedRecord({lotNo:'L0001'});
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
  await W.openRecordReport(page,{has:'L0001'});
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await idle();
  /* 刷る書類が組み上がったところ（`print()`を呼ぶ直前）で数える。 */
  const got=await page.evaluate(id=>new Promise(resolve=>{
   const give=w=>{
    const d=w.document;
    const cut=[...d.querySelectorAll('[data-rp-block]')].filter(b=>{const f=b.querySelector(':scope>.rp-block-fit');if(!f)return false;
     const k=parseFloat(f.style.getPropertyValue('--rp-fit'))||1;return f.scrollHeight*k>b.clientHeight+1&&!b.classList.contains('is-cramped')})
     .map(b=>`${b.dataset.rpBlock} ${b.querySelector(':scope>.rp-block-fit').scrollHeight}>${b.clientHeight}`);
    resolve({blocks:d.querySelectorAll('[data-rp-block]').length,cut});
   };
   let hooked=false;
   const iv=setInterval(()=>{const f=document.getElementById('rpPrintFrame');const w=f&&f.contentWindow;
    if(!w||!w.document||!w.document.body||hooked)return;hooked=true;w.print=()=>{clearInterval(iv);give(w)}},15);
   setTimeout(()=>{clearInterval(iv);resolve(null)},15000);
   WL.report.bulkPrint([id]);
  }),id);
  rec('B2. 刷る書類に塊が入っている',!!got&&got.blocks>0,JSON.stringify(got&&{塊:got.blocks}));
  rec('B1. 刷る書類の中で器の下が切れている塊 0',!!got&&!got.cut.length,got?(got.cut.join(' / ')||'0件'):'刷る書類が組み立たない');
 }finally{
  await fetch(B+'/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id]})}).catch(()=>{});
 }
},{viewport:{width:1920,height:1080}});
