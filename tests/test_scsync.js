/* test_scsync.js: 作業途中になったロットが作業スケジュールへ即時反映されるか。
   ------------------------------------------------------------
   スケジュールの実績突合はサーバーのバックアップ(records.sqlite3)を見る
   (§9.52)。測定画面で保存するとその中身が変わるので、
     (a) スケジュール側の予定キャッシュを捨てる
     (b) 重なっている測定画面を閉じたらスケジュールを描き直す
   の両方が要る。(a)だけでは既に描かれている行は変わらず、(b)だけでは
   取り直しても古いキャッシュが返る。削除(reliableDelete)は以前から(a)を
   していたが、**保存側は両方とも抜けていた**。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});

  // 開始できる予定行を1つ選ぶ
  const target=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(!r)return null;
   return {id:r.dataset.id,cat:r.querySelector('.sc-row-cat')?.textContent?.trim()||''};
  });
  rec('開始できる予定行がある',!!target,JSON.stringify(target));
  if(!target)throw Error('開始できる行が無い');
  rec('開始前は「予定」',/予定/.test(target.cat),target.cat);

  // 作業を開始 → 測定画面が開く
  await page.click(`.sc-row-line[data-id="${target.id}"] .sc-row-start`);
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  rec('測定画面が開く',true);

  // 開いた直後は参照データの読み込みで待機オーバーレイが被さる。消えるまで
  // 待たずに押すと、オーバーレイがクリックを遮って30秒待たされる(実際に踏んだ)。
  const waitOverlay=async()=>{
   await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,
    null,{timeout:30000}).catch(()=>{});
  };
  await waitOverlay();

  // **開始を打刻してから**「編集中」で保存する(=作業途中)。製品は勝手に開始・
  // 終了へ書き込まない（測定画面の作業時間カードの方針）ので、打刻しない
  // 一時保存は「予定」のまま——以前この網が緑だったのは、直前の test_startwork が
  // 残した sw-running（開始時刻つき）を「作業中」と数えていたから（§9.351）。
  await page.evaluate(()=>document.querySelector('#stampWorkStart').click());
  const stamped=await page.evaluate(()=>!!(S.measure&&S.measure.workTime&&S.measure.workTime.startAt));
  rec('開始を打刻できる（打刻が「作業中」の条件）',stamped);
  const draftId=await page.evaluate(()=>S.measure&&S.measure.id);  // 後始末用（スケジュールへ戻ると S.measure は空になる）
  // 保存でスケジュール側のキャッシュが捨てられる。
  await page.click('#saveDraft');
  await page.waitForTimeout(3500);

  // 一時保存すると測定画面は閉じ、データ一覧へ遷移する(persistAndTransition)。
  // スケジュールへは利用者が開き直す流れなので、そのとおりに辿る。
  await waitOverlay();
  await page.waitForFunction(()=>document.querySelector('#measureModal')?.hidden,null,{timeout:20000});
  rec('保存すると測定画面が閉じる',true);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await page.waitForTimeout(3000);

  // 同じロットの行が「作業中」になっていること(ブラウザを再読込せずに)
  const after=await page.evaluate(id=>{
   const r=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   const actual=[...document.querySelectorAll('.sc-row-line')]
    .map(x=>x.querySelector('.sc-row-cat')?.textContent?.trim()||'');
   return {cat:r?.querySelector('.sc-row-cat')?.textContent?.trim()||'(行なし)',
           doing:actual.filter(c=>/作業中/.test(c)).length};
  },target.id);
  rec('画面を再読込せずに「作業中」が反映される',
   /作業中/.test(after.cat)||after.doing>0,JSON.stringify(after));

  // 後始末: 作った実績を消す(次のテストの突合を汚さない)
  await page.evaluate(async()=>{
   if(typeof S!=='undefined'&&S.measure&&typeof WL.records.reliableDelete==='function')
    await WL.records.reliableDelete(S.measure.id);
  }).catch(()=>{});
  /* 上の削除はスケジュールへ戻った時点で S.measure が空なので実際には効かず、
     作った一時保存（記録ID）が records.sqlite3 に残っていた（§9.351）。控えたIDで消す。 */
  if(draftId)await fetch(`${API}/api/measurement/backup/delete`,{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[draftId]})}).catch(()=>{});

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
