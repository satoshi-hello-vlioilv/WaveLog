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
    7. **素のダイアログを出さない**（§9.342）——`alertModal`／`confirmModal`／
       `promptModal` の3つが同じ器を使い、ブラウザ標準の
       `alert()`/`confirm()`/`prompt()` は1つも残っていない

   なぜ7を**ここで**見るか
   ------------------------------------------------------------
   静的な網（`tests/test_patchlint.py`）は「素のダイアログを**呼んでいない**」
   ことしか言えない。**替わりの窓がちゃんと開いて答えを返すか**は動かさないと
   分からず、そこが壊れていると「押しても何も起きない」になる——素の
   `confirm()`のままより悪い。器は`#appConfirmModal`の1つなので、
   **お知らせの次に確認を開いたとき「やめる」が戻っていること**まで見る
   （お知らせは「やめる」を伏せるので、入れ直しを忘れると**次の確認から
   選択肢が片方消える**）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
run('test_modalkeep: 背景クリックではモーダルを閉じない（§9.221 ①）', async ({page,rec,B,W,idle,paint,errs})=>{
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
  /* 「閉じない」を見るので条件では待てない。背景の押下は同期で処理される（弾みの印は460msで外れる）ので、描画1巡で測る。 */
  await paint();
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
  await W.until(page,()=>{const m=document.querySelector('#appConfirmModal');return !m||m.hidden},null,{ms:5000,what:'×で確認の窓が閉じる'});
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
  await paint();  // 「閉じない」を見るので条件では待てない（上と同じ）
  const kept=await page.evaluate(()=>({
    open:document.querySelector('#maintEditorModal').hidden===false,
    value:document.querySelector('#maintEditorForm [data-field="loginId"]')?.value||''}));
  rec('編集モーダルも背景クリックで閉じない',kept.open,JSON.stringify(kept));
  rec('打ちかけの文字が消えていない',kept.value==='打ちかけの文字',kept.value);
  await page.click('#maintEditorCancel');
  await W.until(page,()=>{const m=document.querySelector('#maintEditorModal');return !m||m.hidden},null,{ms:5000,what:'キャンセルで編集の窓が閉じる'});
  rec('キャンセルでは閉じる',
      await page.evaluate(()=>document.querySelector('#maintEditorModal').hidden===true));

  /* ---- 7) 素のダイアログを出さない（§9.342） ---- */
  /* 素の`alert()`等が呼ばれたらここが拾う。**出たこと自体を記録する**
     ——閉じてしまうと、次の待ちが通ってしまい何事も無かったように見える。 */
  const native=[];
  page.on('dialog',async d=>{native.push(d.type()+':'+d.message().slice(0,40));await d.dismiss()});

  const three=await page.evaluate(()=>['alertModal','confirmModal','promptModal']
    .filter(n=>typeof window[n]==='function'));
  rec('お知らせ・確認・1行入力の3つが揃っている',three.length===3,three.join(','));

  page.evaluate(()=>{window.__mkA=alertModal('お知らせの本文です')});
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:4000});
  const al=await page.evaluate(()=>({
    title:document.querySelector('#appConfirmTitle').textContent,
    ok:document.querySelector('#appConfirmOk').textContent,
    cancelHidden:document.querySelector('#appConfirmCancel').hidden}));
  rec('お知らせはボタンが1つ（やめるを出さない）',
      al.cancelHidden===true&&al.ok==='閉じる',JSON.stringify(al));
  await page.click('#appConfirmOk');await W.until(page,()=>{const m=document.querySelector('#appConfirmModal');return !m||m.hidden},null,{ms:5000,what:'お知らせの窓が閉じる'});

  /* **お知らせの次の確認で「やめる」が戻っている。** ここが今回いちばん
     壊れやすい（伏せたままにすると選択肢が片方消えたまま気づかれない）。 */
  page.evaluate(()=>{window.__mkC=confirmModal('消しますか')});
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:4000});
  rec('お知らせの後の確認でも「やめる」が戻っている',
      await page.evaluate(()=>document.querySelector('#appConfirmCancel').hidden===false));
  await page.click('#appConfirmCancel');await W.until(page,()=>{const m=document.querySelector('#appConfirmModal');return !m||m.hidden},null,{ms:5000,what:'「やめる」で確認の窓が閉じる'});
  rec('「やめる」は false を返す',(await page.evaluate(()=>window.__mkC))===false);

  page.evaluate(()=>{window.__mkP=promptModal({title:'名前',label:'新しい名前',value:'あ'})});
  await page.waitForSelector('#appPromptInput',{timeout:4000});
  await W.until(page,()=>document.activeElement&&document.activeElement.id==='appPromptInput',null,{ms:3000,what:'1行入力の欄に焦点が乗る'});
  rec('1行入力は入力欄に焦点が乗る（すぐ打てる）',
      (await page.evaluate(()=>document.activeElement&&document.activeElement.id))==='appPromptInput');
  await page.fill('#appPromptInput','  かきくけこ  ');
  await page.keyboard.press('Enter');
  await W.until(page,()=>{const m=document.querySelector('#appConfirmModal');return !m||m.hidden},null,{ms:5000,what:'Enterで1行入力の窓が閉じる'});
  /* 素の`prompt()`はEnterで決まった。作法を落とさない。前後の空白は落とす。 */
  rec('Enterで決まり、前後の空白は落ちる',
      (await page.evaluate(()=>window.__mkP))==='かきくけこ',
      JSON.stringify(await page.evaluate(()=>window.__mkP)));

  page.evaluate(()=>{window.__mkP2=promptModal({label:'名前'})});
  await page.waitForSelector('#appPromptInput',{timeout:4000});
  await page.click('#appConfirmCancel');await W.until(page,()=>{const m=document.querySelector('#appConfirmModal');return !m||m.hidden},null,{ms:5000,what:'「やめる」で1行入力の窓が閉じる'});
  /* **やめたときは`null`。** 「空で決定した」と分かれていないと、理由の
     ように空でも通す欄で「やめた」が「理由なしで実行」に化ける。 */
  rec('やめたときは null（空文字と見分けが付く）',
      (await page.evaluate(()=>window.__mkP2))===null,
      JSON.stringify(await page.evaluate(()=>window.__mkP2)));

  rec('この間、素のダイアログは1度も出ていない',native.length===0,native.join(' / '));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){rec('FATAL',false,String(e&&e.message||e))}
}, {viewport:{width:1700,height:1000}});
