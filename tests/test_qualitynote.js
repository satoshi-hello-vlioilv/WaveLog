/* test_qualitynote.js: 品質情報の下に人が書く欄（§9.606・利用者の指示）
   ============================================================
   「品質情報の下に入力できる欄を設けたい。」
   作り: 操業データ項目マスタの置き場に「品質情報の下」を足し、最初の1欄「品質メモ」（文字・12マス）を1度だけ置く。
   物差し Q1: 品質情報の下にある、打てる欄の数（前 0 → 1以上）
   ほかに固定すること:
    Q2. ①準備・②測定・③確認のどの段でも見える（左の基本情報の中）
    Q3. 打った値は操業データとして記録に入る（`settings.opData['品質メモ']`）
    Q4. 品質情報（読むだけ）の面は今までどおり読むだけ
    Q5. マスタの置き場の選択肢に「品質情報の下」がある
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';

run('test_qualitynote: 品質情報の下に人が書く欄（§9.606）', async ({page,rec,W,idle})=>{
 const shot=async n=>{if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/qnote-${n}.png`})};
 await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 const form=await page.evaluate(async()=>(await fetch('/api/operation-form?equipment='+encodeURIComponent('テスト設備A'))).json());
 const qItems=(form.items||[]).filter(x=>x.place==='品質情報の下');
 rec('前提: 品質情報の下に置いた項目がある（品質メモ）',qItems.some(x=>x.name==='品質メモ'),JSON.stringify(qItems.map(x=>x.name)));
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 const started=await page.evaluate(()=>{
  const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start:not(.is-locked)'));
  if(r)r.querySelector('.sc-row-start').click();
  return !!r;
 });
 rec('前提: 予定から測定画面を開ける',started);
 if(!started)return;
 await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000})
  .catch(e=>console.log('保存の覆いが消えるのを待てなかった（続ける）: '+e.message));
 await W.until(page,()=>!!document.querySelector('#qualityOpGrid input,#qualityOpGrid select'),null,{ms:8000,what:'品質情報の下の欄が並ぶ'})
  .catch(e=>console.log('品質情報の下の欄を待てなかった（Q1 が数える）: '+e.message));
 const closeModal=()=>page.evaluate(()=>{const m=document.getElementById('appConfirmModal');
  if(m&&!m.hidden){const b=document.getElementById('appConfirmOk')||document.getElementById('closeAppConfirm');if(b)b.click()}});
 const look=()=>page.evaluate(()=>{
  const box=document.getElementById('qualityOpGrid'),qi=document.getElementById('qualityInfo');
  const vis=e=>{if(!e)return false;const r=e.getBoundingClientRect();return r.width>0&&r.height>0};
  const fields=box?[...box.querySelectorAll('input,select,textarea')].filter(e=>vis(e)&&!e.readOnly&&!e.disabled):[];
  const qr=qi&&qi.getBoundingClientRect(),br=box&&box.getBoundingClientRect();
  return {n:fields.length,below:!!(qr&&br&&br.top>=qr.bottom-1),qiReadOnly:!!(qi&&qi.readOnly),
   names:fields.map(e=>e.closest('label')?.dataset.opfield||e.id)};
 });
 const seen={};
 for(const step of ['1','2','3']){
  await page.evaluate(s=>WL.measureSteps.go(s),step);await idle();await closeModal();
  seen[step]=await look();
  await shot('step'+step);
 }
 rec('Q1. 品質情報の下に打てる欄がある',seen['1'].n>=1,JSON.stringify(seen['1']));
 rec('Q2. ①②③のどの段でも、品質情報のすぐ下に見える',['1','2','3'].every(k=>seen[k].n>=1&&seen[k].below),JSON.stringify(seen));
 rec('Q4. 品質情報の面は読むだけのまま',seen['1'].qiReadOnly,'');
 const h=await page.$('#qualityOpGrid input');
 if(h){
  await h.click();await h.fill('');await h.type('端部に軽微な擦れあり');await page.keyboard.press('Tab');await idle();
  const v=await page.evaluate(()=>{WL.opData&&WL.opData.collect&&WL.opData.collect();return S.measure.settings.opData&&S.measure.settings.opData['品質メモ']});
  rec('Q3. 打った値は操業データとして記録に入る',v==='端部に軽微な擦れあり',String(v));
  await h.click();await h.fill('');await page.keyboard.press('Tab');
 }
 const places=await page.evaluate(async()=>((await (await fetch('/api/operation-item-master')).json()).places||[]));
 rec('Q5. マスタの置き場に「品質情報の下」がある',places.includes('品質情報の下'),JSON.stringify(places));
});
