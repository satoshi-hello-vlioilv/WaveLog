/* test_modalkeep.js: 背景クリックではモーダルを閉じない（§9.221 ①）
   ============================================================
   利用者の指摘は「選択肢の値マスタのモーダル外クリックした瞬間にモーダルが
   閉じないようにしてください。編集中の内容が瞬時に消えてしまうことが問題です。
   類似の事象がないかモーダル関係はすべてチェックしてください」。
   ここで固定するのは次の点。
    1. **背景を実際にクリックしても開いたまま**（ハンドラの有無ではなく結果）
    2. 打ちかけの文字が**残っている**（閉じないことの値打ちはこれ）
    3. 押したことは返る（器が弾む・×に案内が出る）
    4. ×では閉じる（閉じられなくなっていないこと）
    5. **変換中(IME)のEscでは閉じない**——変換の取り消しでモーダルごと
       消えるのは、背景クリックとまったく同じ壊れ方
    6. モーダルの閉じ方の規則は**1箇所**（`WL.modal`）が持つ
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await fetch(B+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode:'edit'})});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:15000});

  /* ---- 1) 規則は1箇所 ---- */
  const api=await page.evaluate(()=>({
    keep:typeof window.WL?.modal?.keepOpen==='function',
    esc:typeof window.WL?.modal?.escCloses==='function',
    nudge:typeof window.WL?.modal?.nudge==='function'}));
  rec('閉じ方の規則がWL.modalの1箇所にある',api.keep&&api.esc&&api.nudge,JSON.stringify(api));

  /* ---- 2) 変換中のEscでは閉じない ---- */
  const escRule=await page.evaluate(()=>({
    plain:WL.modal.escCloses({key:'Escape',isComposing:false,keyCode:27}),
    composing:WL.modal.escCloses({key:'Escape',isComposing:true,keyCode:27}),
    ime229:WL.modal.escCloses({key:'Escape',isComposing:false,keyCode:229}),
    other:WL.modal.escCloses({key:'Enter',isComposing:false,keyCode:13})}));
  rec('Escは閉じるが、変換中のEscは閉じない',
      escRule.plain&&!escRule.composing&&!escRule.ime229&&!escRule.other,JSON.stringify(escRule));

  /* ---- 3) 確認モーダル: 背景を実際に押しても閉じない ---- */
  await page.evaluate(()=>{window.__mk=null;confirmModal({title:'回帰_モーダル',message:'x'}).then(v=>{window.__mk=v})});
  await page.waitForSelector('#appConfirmModal',{state:'visible',timeout:5000});
  const box=await page.evaluate(()=>{
   const d=document.querySelector('#appConfirmModal [role="dialog"]').getBoundingClientRect();
   return {x:Math.round(d.left/2),y:Math.round(d.top/2)};
  });
  await page.mouse.click(Math.max(6,box.x),Math.max(6,box.y));
  await page.waitForTimeout(250);
  const afterOutside=await page.evaluate(()=>({
    open:document.querySelector('#appConfirmModal').hidden===false,
    resolved:window.__mk,
    nudged:!!document.querySelector('#appConfirmModal .wl-modal-nudge'),
    hint:!!document.querySelector('#appConfirmModal .wl-close-hint')}));
  rec('背景を押しても確認モーダルは開いたまま',afterOutside.open&&afterOutside.resolved===null,
      JSON.stringify(afterOutside));
  rec('押したことは返す（器が弾み、×に案内が出る）',afterOutside.nudged&&afterOutside.hint,
      JSON.stringify(afterOutside));
  await page.click('#closeAppConfirm');
  await page.waitForTimeout(200);
  rec('×では閉じる',await page.evaluate(()=>document.querySelector('#appConfirmModal').hidden===true));

  /* ---- 4) マスタの編集モーダル: 打ちかけの文字が消えない ---- */
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
  /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
  await page.click('#masterMaintNav [data-master="accessPermission"]');
  /* **「追加」が出るまで待つ**（固定待ちにしない・tests/README.md）。 */
  await page.waitForSelector('#masterMaintAdd',{state:'visible',timeout:15000});
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:5000});
  await page.fill('#maintEditorForm [data-field="loginId"]','打ちかけの文字');
  const dlg=await page.evaluate(()=>{
   const d=document.querySelector('#maintEditorModal [role="dialog"]').getBoundingClientRect();
   return {x:Math.round(d.left/2),y:Math.round(d.top+d.height/2)};
  });
  await page.mouse.click(Math.max(6,dlg.x),dlg.y);
  await page.waitForTimeout(250);
  const kept=await page.evaluate(()=>({
    open:document.querySelector('#maintEditorModal').hidden===false,
    value:document.querySelector('#maintEditorForm [data-field="loginId"]')?.value||''}));
  rec('編集モーダルも背景クリックで閉じない',kept.open,JSON.stringify(kept));
  rec('打ちかけの文字が消えていない',kept.value==='打ちかけの文字',kept.value);
  await page.click('#maintEditorCancel');
  await page.waitForTimeout(200);
  rec('キャンセルでは閉じる',
      await page.evaluate(()=>document.querySelector('#maintEditorModal').hidden===true));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
