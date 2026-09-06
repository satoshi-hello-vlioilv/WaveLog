const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
/* 待ちは「時間」でなく「条件」で置く（§9.324 R5、tests/lib/wait.js）。 */
const W=require('./lib/wait');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 /* 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」
    パネル(§9.199)の中にある。開く→選ぶ→**閉じる**まで1つの手順にする
    ——開いたままにすると、パネルが表の右上を覆って次のクリックが
    「要素が隠れている」で落ちる（実際に落ちた）。 */
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 const pickView=async(sel,val)=>{await openView();await page.selectOption(sel,val).catch(()=>{});await closeView()};
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>{console.log('[dialog]',d.message());d.accept()});

 /* このテストが必要とする実績を毎回作り直す(他テストの実績が混ざっても
    自分の見たい行を特定できるよう、予定に無いロット番号を使う)。
    L0055=実施中の計画外実績 / L0057=40時間前の完了実績(表示範囲の確認用) /
    L0059=8時間以内の完了実績(完了の行が必ず1本あるように)。 */
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
  await put('sw-running','L0055','C055',45,null,'編集中');
  await put('sw-old','L0057','C057',40*60,40*60-90,'完了');
  /* 既定の8時間に入る完了実績も**自分で置く**（§9.325 ②）。以前は「他テストの
     実績も混ざる」前提で、通しでは前のテストが完了させた記録が必ず在ったが、
     単独で回すと「完了」の行が1本も無く落ちた（順番に依存する網）。 */
  await put('sw-done','L0059','C059',300,240,'完了');
 };
 const open=async()=>{
  await seed();
  await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await W.settleFlags(page);
  await W.settle(page);
 };

 /* ===== 編集モード ===== */
 await setMode('edit');
 await open();

 // --- (2) 計画外の実績がタイムラインへ載る ---
 // §9.39: 区分はセクション見出しではなく行内の「区分」列で持つ。
 const catOf=async label=>page.evaluate(l=>[...document.querySelectorAll('.sc-row-line')]
   .filter(r=>new RegExp(l).test(r.querySelector('.sc-row-cat')?.textContent||''))
   .map(r=>({txt:r.innerText.replace(/\n/g,' '),unplanned:!!r.querySelector('.sc-flag-unplanned'),
             del:!!r.querySelector('.sc-row-delete'),start:!!r.querySelector('.sc-row-start')})),label);
 const cats=await page.$$eval('.sc-row-cat',n=>[...new Set(n.map(x=>x.textContent))]);
 rec('完了/作業中/予定が行内の区分列に出る',
  ['完了','作業中','予定'].every(k=>cats.some(c=>c.includes(k))),cats.join(' '));
 // 他テストの実績も同じ設備の「作業中」に並ぶため、行を特定して確かめる
 const runningRows=await catOf('作業中');
 const running=runningRows.find(r=>/L0055/.test(r.txt))||null;
 rec('仕掛から直接始めた作業(予定に無い実績)が「実施中」に出る',
  !!running&&running.unplanned,JSON.stringify(running||runningRows.map(r=>r.txt.slice(0,40))));
 rec('実施中の行に経過時間が出る',!!running&&/経過/.test(running.txt),running&&running.txt);
 const hist=((await catOf('完了'))[0]||{}).txt||null;
 // 完了行は予定時刻を持たない(終端状態)。実績の開始〜終了が時刻欄に出る。
 // どのロットが先頭の完了行になるかは実績の開始時刻で決まる(他テストの
 // 実績も混ざる)。ここで見たいのは「終端状態でも実績の時刻が出ること」。
 rec('完了した実績が実績時刻付きで出る(HH:MM〜HH:MM)',
  !!hist&&/(L|M)\d{4}/.test(hist)&&/\d\d:\d\d〜\d\d:\d\d/.test(hist),hist);
 rec('計画外の行は削除ボタンを持たない(共有DBに行が無いため)',
  (await catOf('作業中')).every(r=>!r.del));

 // --- (3) 表示範囲 ---
 rec('表示範囲セレクタが個別タイムラインに出る',
  await page.evaluate(()=>{const w=document.querySelector('#scHistoryRange');return !!w&&!w.hidden}));
 rec('既定は直近8時間',await page.evaluate(()=>document.querySelector('#scHistorySelect').value==='8'));
 // 40時間前の実績は8時間表示では出ない → 72時間にすると出る
 rec('表示範囲外(40時間前)の実績は既定では出ない',
  await page.evaluate(()=>!/L0057/.test(document.querySelector('#scTimeline').textContent)));
 await pickView('#scHistorySelect','72');
 await W.until(page,()=>/L0057/.test(document.querySelector('#scTimeline').textContent));
 rec('表示範囲を直近72時間へ広げると40時間前の実績も出る',
  await page.evaluate(()=>/L0057/.test(document.querySelector('#scTimeline').textContent)));
 rec('表示範囲は保存され次回も引き継ぐ',
  await page.evaluate(()=>localStorage.getItem('ScheduleHistoryHoursV1')==='72'));
 await pickView('#scHistorySelect','8');
 await W.until(page,()=>!/L0057/.test(document.querySelector('#scTimeline').textContent));
 await W.settleFlags(page);

 // --- (1) 編集モードから作業開始 ---
 const startCount=await page.$$eval('.sc-row-start',n=>n.length);
 rec('編集モードでは予定行に「開始」ボタンが出る',startCount>0,'件数='+startCount);
 rec('設備停止の行には開始ボタンが出ない',(await catOf('設備停止')).every(r=>!r.start));
 rec('作業中・完了の行には開始ボタンが出ない',
  (await catOf('作業中')).every(r=>!r.start)&&(await catOf('完了')).every(r=>!r.start));
 await page.click('.sc-row-start');
 await W.until(page,()=>!document.querySelector('#measureModal')?.hidden&&typeof S!=='undefined'&&!!S.measure,null,25000);
 const opened=await page.evaluate(()=>({modal:!document.querySelector('#measureModal').hidden,
  lot:document.querySelector('#basicInfo')?.textContent?.slice(0,120)||''}));
 rec('「開始」で測定画面が開く',opened.modal,JSON.stringify(opened).slice(0,180));

 /* ===== スケジュールモードでは開始ボタンを出さない ===== */
 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await W.booted(page);
 await page.click('#openSchedule');
 // scheduleモードの既定は俯瞰ボード。設備行から個別タイムラインへ入る
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 rec('俯瞰ボードで計画外の実施中作業も「稼働中」として見える',
  await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment==='テスト設備A');
   return !!r&&/稼働中/.test(r.textContent)}));
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await W.until(page,()=>(document.querySelector('#scTimeline')||{dataset:{}}).dataset.equipment==='テスト設備A'
   &&document.querySelectorAll('.sc-row-line').length>0);
 await W.settleFlags(page);
 rec('スケジュールモードでは開始ボタンを出さない(計画専用の端末のため)',
  await page.$$eval('.sc-row-start',n=>n.length)===0);
 rec('スケジュールモードでも作業中の区分と計画外バッジは出る',
  (await catOf('作業中')).some(r=>r.unplanned));

 /* 後始末: 自分が置いた実績（sw-*）は自分で消す。残すと後続の網が「作業中」
    「完了」の行をこの置き土産で数え、単独では落ちる網が通しでだけ緑になる
    （test_scsync／test_theme がそうだった。§9.351）。 */
 await fetch('http://127.0.0.1:5029/api/measurement/backup/delete',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:['sw-running','sw-old','sw-done']})}).catch(()=>{});

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
