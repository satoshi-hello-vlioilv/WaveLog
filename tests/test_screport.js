const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>{console.log('[dialog]',d.message());d.accept()});
 await setMode('edit');
 // このテストが必要とする実績を毎回作り直す(前回の実行で測定画面を開くと
 // 端末内に下書きが生まれ、同じロットの実績突合が変わるため)。
 const seed=async()=>{
  const now=Date.now();
  const put=async(id,lot,cast,startMin,endMin,status)=>{
   const payload={basic:{lotNo:lot,castingNo:cast,mfgMaterial:'A5052',mfgTemper:'H34',
                         purposeName:'一般用材',inspectionNo:'K'+lot.slice(1)},
                  settings:{registeredEquipment:'テスト設備A',operator:'田中'},
                  workTime:{startAt:new Date(now-startMin*60000).toISOString(),
                            endAt:endMin===null?null:new Date(now-endMin*60000).toISOString()}};
   await fetch('http://127.0.0.1:5029/api/measurement/backup',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id,equipment:'テスト設備A',lotNo:lot,inspectionNo:'K'+lot.slice(1),
      castingNo:cast,status,codec:'json-full-v32',payload:JSON.stringify(payload)})});
  };
  await put('rec-doing','L0003','C003',50,null,'編集中');
  await put('rec-done2','L0002','C002',180,120,'完了');
 };
 await seed();
 const open=async()=>{
  await seed();
  await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  // 行は予定と実績の突合が済んでから描かれる。固定待ちだとフィクスチャや
  // 直前のテストの状態で描画時間が変わり、静かに落ちる(実際に落ちた)。
  await page.waitForSelector('.sc-row-line',{timeout:20000});
 };
 await open();
 const rowOf=async cat=>{
  // 区分ごとの行(作業中/完了/予定)は実績の読み込みが終わってから増える。
  // 目当ての区分が現れるまで待ってから掴む。
  await page.waitForFunction(c=>[...document.querySelectorAll('.sc-row-line')]
   .some(x=>new RegExp(c).test(x.querySelector('.sc-row-cat')?.textContent||'')),
   cat,{timeout:20000}).catch(()=>{});
  return page.evaluate(c=>{
   const r=[...document.querySelectorAll('.sc-row-line')]
    .find(x=>new RegExp(c).test(x.querySelector('.sc-row-cat')?.textContent||''));
   return r?{id:r.dataset.id,resume:!!r.querySelector('.sc-row-resume'),report:!!r.querySelector('.sc-row-report'),
             resumable:r.classList.contains('sc-row-resumable')}:null;},cat);
 };

 const doing=await rowOf('作業中'), done=await rowOf('完了'), planned=await rowOf('予定');
 rec('作業中の行に「再開」ボタンが出る',!!doing&&doing.resume,JSON.stringify(doing));
 rec('作業中の行に帳票ボタンが出る',!!doing&&doing.report,JSON.stringify(doing));
 rec('完了の行にも帳票ボタンが出る',!!done&&done.report,JSON.stringify(done));
 rec('完了の行には再開ボタンを出さない',!!done&&!done.resume,JSON.stringify(done));
 rec('予定の行には帳票・再開を出さない(実績がまだ無い)',
  !!planned&&!planned.report&&!planned.resume,JSON.stringify(planned));

 // --- 完了行から帳票(この端末のIndexedDBに無い記録IDでも開けること) ---
 const reportOf=async row=>{
  await page.click(`.sc-row-line[data-id="${row.id}"] .sc-row-report`);
  // 帳票はサーバーの測定バックアップを引いてから描く。画面の切替(rp-mode)と
  // 中身の描画をそれぞれ待つ。
  await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:20000}).catch(()=>{});
  await page.waitForFunction(()=>{
   const t=document.querySelector('#reportSelectedTitle')?.textContent||'';
   const c=document.querySelector('#reportContent')?.innerText||'';
   return !!t.trim()&&!/左の一覧からロットを選ぶ/.test(c);},null,{timeout:20000}).catch(()=>{});
  return page.evaluate(()=>({mode:document.body.classList.contains('rp-mode'),
   title:document.querySelector('#reportSelectedTitle')?.textContent||'',
   selected:!!document.querySelector('#reportLotList .is-selected,#reportLotList .selected'),
   content:(document.querySelector('#reportContent')?.innerText||'').slice(0,60)}));
 };
 let rp=await reportOf(done);
 rec('完了の行から帳票が開く',rp.mode,JSON.stringify(rp));
 rec('端末内に無い記録でもサーバーの測定バックアップから引いて表示する',
  !/ロットを選択してください|表示できません/.test(rp.title)&&!/左の一覧からロットを選ぶ/.test(rp.content),
  JSON.stringify(rp));

 // --- 作業中からも帳票 ---
 await open();
 const doing2=await rowOf('作業中');
 rec('帳票を開いた後でも作業中の行を掴める',!!doing2,JSON.stringify(doing2));
 rp=doing2?await reportOf(doing2):{mode:false,title:''};
 rec('作業中の行からも帳票が開く',rp.mode&&!/ロットを選択してください/.test(rp.title),JSON.stringify(rp));

 // --- ダブルクリックで再開(下書きが生まれるので最後に実施) ---
 await open();
 const doing3=await rowOf('作業中');
 rec('再開の検証に使う作業中の行がある',!!doing3,JSON.stringify(doing3));
 let resumedId=null;  // 再開で開いた記録のID（後始末用。ブロックの外で使う）
 if(doing3){
  // どの行が先頭の作業中になるかは実績の開始時刻で決まる(他テストの実績も
  // 混ざる)。行が表示しているロット番号と、開いた測定画面のロットを突き合わせる。
  // **ロット番号は内容セル(data-content-col="lotNo")から読む。** 以前は行の
  // 文字列へ /L\d{4}|M\d{4}/ を当てていたが、これは検証用に作る番号の形しか
  // 知らない。前の実行の置き土産(killされた実行が残した実績)が先頭に来ると、
  // 実データ由来のロット(ZZ9T4813)に当たらず「行のロット=」が空のまま落ちる
  // ——**画面は正しく開いているのに**(§9.121・§9.132)。番号の形を仮定しない。
  const doingLot=await page.evaluate(id=>{
   const row=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   const cell=row?.querySelector('.sc-row-title[data-content-col="lotNo"]');
   return (cell?.textContent||'').trim();},doing3.id);
  await page.dblclick(`.sc-row-line[data-id="${doing3.id}"] .sc-row-title`);
  await page.waitForFunction(()=>{
   const m=document.querySelector('#measureModal');
   return !!m&&!m.hidden&&!!(document.querySelector('#basicInfo')?.textContent||'').trim();
  },null,{timeout:20000}).catch(()=>{});
  const resumed=await page.evaluate(()=>({modal:!document.querySelector('#measureModal').hidden,
   lot:(document.querySelector('#basicInfo')?.textContent||'').slice(0,60)}));
  /* 再開で開いた測定は開いた時点で records.sqlite3 へ写る（記録IDは設備の段が空の
     `|L0003|K0003|C003`。§9.351）。控えて後始末で消す。 */
  resumedId=await page.evaluate(()=>S.measure&&S.measure.id);
  rec('作業中の行をダブルクリックすると測定画面が開く(続きから再開)',
   resumed.modal&&!!doingLot&&resumed.lot.includes(doingLot),
   `行のロット=${doingLot} / ${JSON.stringify(resumed)}`);
 }

 /* 後始末: 自分が置いた実績（rec-*）は自分で消す。残すと後続の網が「作業中」「完了」を
    この置き土産で数える（§9.351）。 */
 await fetch('http://127.0.0.1:5029/api/measurement/backup/delete',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['rec-doing','rec-done2'].concat(resumedId?[resumedId]:[])})}).catch(()=>{});

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
