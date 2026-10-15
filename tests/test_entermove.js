/* test_entermove.js: 測定画面の入力欄は Enter でも次の欄へ進む（§9.606・利用者の指示）
   ============================================================
   「入力項目の移動をENTERキーでもできるようにしてほしい。」

   物差し E1: 測定画面の①準備・②測定に見えている入力欄のうち、Enter を押しても次の欄へ進まない欄の数 → 0
   ほかに固定すること:
    E2. Shift+Enter は前の欄へ戻る
    E3. 測定表の欄（`data-mkey`）は今までどおり自分の Enter（次の条へ）を使う（奪わない）
    E4. 日本語の変換中の Enter は確定だけ（進まない）
    E5. 測定器の受信欄（#deviceInput）の Enter は奪わない（自動転送の区切り）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';

run('test_entermove: 測定画面の入力欄は Enter でも次へ進む（§9.606）', async ({page,rec,W,idle})=>{
 await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
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
 await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
 const closeModal=()=>page.evaluate(()=>{const m=document.getElementById('appConfirmModal');
  if(m&&!m.hidden){const b=document.getElementById('appConfirmOk')||document.getElementById('closeAppConfirm');if(b)b.click()}});
 /* 見えている入力欄（表の欄・受信欄・ボタン類を除く）に印を振って返す */
 const fields=()=>page.evaluate(()=>{
  const vis=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden'};
  const list=[...document.querySelectorAll('#measureModal input,#measureModal select')].filter(e=>
   !e.matches('[data-mkey],#deviceInput,[type=hidden],[type=checkbox],[type=radio],[type=button],[type=submit],[type=file]')
   &&!e.disabled&&!e.readOnly&&e.tabIndex>=0&&vis(e)&&!e.closest('[hidden],.wl-menu'));
  list.forEach((e,i)=>e.dataset.emT=String(i));
  return list.map(e=>({t:e.dataset.emT,id:e.id||e.name||e.dataset.f||e.dataset.opf||e.tagName}));
 });
 const tryEnter=async(t,shift)=>{
  await page.focus(`[data-em-t="${t}"]`);
  if(shift)await page.keyboard.down('Shift');
  await page.keyboard.press('Enter');
  if(shift)await page.keyboard.up('Shift');
  await closeModal();
  return page.evaluate(()=>{const a=document.activeElement;return a&&a.dataset?a.dataset.emT||a.dataset.mkey||a.id||a.tagName:''});
 };
 let stuck=[],total=0,back=null;
 for(const step of ['1','2']){
  await page.evaluate(s=>WL.measureSteps.go(s),step);await idle();await closeModal();
  const f=await fields();
  for(let k=0;k<f.length-1;k++){
   total++;
   const now=await tryEnter(f[k].t,false);
   if(now===f[k].t)stuck.push(`${step}:${f[k].id}`);
  }
  if(step==='1'&&f.length>2)back={from:f[2].t,to:await tryEnter(f[2].t,true),want:f[1].t};
 }
 rec('E1. Enter を押しても次の欄へ進まない欄が無い',total>0&&stuck.length===0,`進まない ${stuck.length}/${total} ${stuck.slice(0,8).join(' / ')}`);
 rec('E2. Shift+Enter は前の欄へ戻る',!!back&&back.to===back.want,JSON.stringify(back));
 /* E3: 表の欄の Enter は次の条（自分の配線）。測定表の1つ目の欄で押して、焦点が表の中に残る */
 await page.evaluate(()=>{const el=document.getElementById('measureType');el.value='板幅';el.dispatchEvent(new Event('change',{bubbles:true}))});
 await idle();await closeModal();
 const e3=await page.evaluate(()=>{const el=document.querySelector('input[data-mkey]');if(!el)return null;el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  const a=document.activeElement;return {inGrid:!!(a&&a.dataset&&a.dataset.mkey)}});
 rec('E3. 測定表の欄の Enter は奪わない（焦点は表の中）',!!e3&&e3.inGrid,JSON.stringify(e3));
 /* E4: 変換中の Enter（isComposing）は進まない */
 await page.evaluate(()=>WL.measureSteps.go('1'));await idle();await closeModal();
 const f1=await fields();
 const e4=await page.evaluate(t=>{const el=document.querySelector(`[data-em-t="${t}"]`);el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,isComposing:true}));
  return document.activeElement===el},f1[0]&&f1[0].t);
 rec('E4. 日本語の変換中の Enter では進まない',e4===true,String(e4));
 const e5=await page.evaluate(()=>{const el=document.getElementById('deviceInput');if(!el)return null;
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  return document.getElementById('measureModal').dataset.wlEnterMove==='1'&&el.matches('[data-enter-own]')});
 rec('E5. 測定器の受信欄は Enter を自分で持つ（焦点を奪わない）',e5===true,String(e5));
});
