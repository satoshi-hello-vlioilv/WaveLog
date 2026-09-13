const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const {execSync}=require('child_process');
// 現場段取り対象設備を差し替える(アクセス権限マスタは毎回読み直されるため再起動不要)
const setTarget=t=>execSync(`python3 ${__dirname}/setperm.py ${JSON.stringify(t)}`);
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const W=require('./lib/wait.js');const {idle}=W.track(page);
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 let posts=0;
 page.on('request',r=>{if(r.url().includes('/plan/reorder'))posts++});
 const open=async()=>{
  await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:15000});
  await W.booted(page);
  await page.click('#openSchedule');
  // 行が描かれるまで待つ(固定待ちはフィクスチャが育つと落ちる)
  await page.waitForSelector('.sc-row-line',{timeout:20000});
 };
 const state=()=>page.evaluate(()=>({
  badge:(()=>{const e=document.querySelector('#fieldReorderBadge');
    return e&&!e.hidden?{txt:e.textContent,warn:e.classList.contains('is-warn')}:null})(),
  note:(()=>{const e=document.querySelector('#scFieldReorderNote');
    return e&&!e.hidden?{txt:e.textContent,warn:e.classList.contains('is-warn')}:null})(),
  drag:[...document.querySelectorAll('.sc-row-line')].some(x=>x.draggable),
 }));
 const toasts=()=>page.$$eval('.toast',n=>n.map(x=>x.innerText.replace(/\n/g,' | ')));
 // 並べ替えの対象は予定行だけ。他のテストが残した計画外実績(data-idが
 // 「actual:」で始まる)がタイムラインの先頭に載るため、行を添字で掴むと
 // 実績行を掴んでしまい、キー操作が何も起こさない(実際に落ちた)。
 const planIds=()=>page.$$eval('.sc-row-line',n=>n
  .filter(x=>x.draggable&&!/^actual:/.test(x.dataset.id||''))
  .map(x=>x.dataset.id));

 // 現場段取りバッジ・注記はeditモードの端末に出す表示なので、モードを固定してから始める
 // (他のテストがscheduleモードへ切り替えたまま終わっていても影響を受けないように)
 await fetch('http://127.0.0.1:5029/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});

 /* ===== (A) 現場段取り可だが対象設備が未設定 ===== */
 setTarget('');
 await open();
 let st=await state();
 rec('対象設備が未設定なら行をドラッグさせない',!st.drag,JSON.stringify(st));
 rec('理由をヘッダーに明示する',!!st.note&&/対象設備が未設定/.test(st.note.txt)&&st.note.warn,JSON.stringify(st.note));
 rec('バッジも「可」と言い切らない',!!st.badge&&st.badge.warn&&!/^並べ替え可$/.test(st.badge.txt),JSON.stringify(st.badge));
 posts=0;
 await page.keyboard.press('Tab');
 rec('失敗する並べ替えAPIをそもそも呼ばない',posts===0,'POST='+posts);

 /* ===== (B) 対象設備が別の設備 ===== */
 setTarget('テスト設備B');
 await open();
 st=await state();
 rec('対象設備が別設備ならドラッグさせない',!st.drag,JSON.stringify(st));
 rec('どの設備が対象かを示す',!!st.note&&/テスト設備B/.test(st.note.txt),JSON.stringify(st.note));

 /* ===== (C) 対象設備が一致 = 本来の現場段取り ===== */
 setTarget('テスト設備A');
 await open();
 st=await state();
 rec('対象設備が一致すればドラッグできる',st.drag,JSON.stringify(st));
 /* **一致しているときは注記を出さない**（§9.300 ①）。ヘッダーのバッジが
    「現場段取り 並べ替え可」とまったく同じことを言うので、操作列にも出すと
    同じ文が2つ並ぶ（§CLAUDE 8）。直せることがあるとき＝(A)(B)だけ出す。 */
 rec('一致しているときは注記を出さない（バッジが言う）',!st.note,JSON.stringify(st.note));
 rec('バッジも「並べ替え可」に戻る',!!st.badge&&/並べ替え可/.test(st.badge.txt)&&!st.badge.warn,JSON.stringify(st.badge));
 const ids=await planIds();
 posts=0;
 // 並べ替えの往復（150msのまとめ待ち→POST→応答）を条件で待つ。押す前に仕掛ける。
 const reorderDone=page.waitForResponse(r=>r.url().includes('/plan/reorder'),{timeout:20000}).catch(()=>null);
 await (await page.$(`.sc-row-line[data-id="${ids[0]}"]`)).focus();
 await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
 await reorderDone;await idle(400,6000);
 const after=await planIds();
 rec('実際に並べ替えできる',posts===1&&after[0]!==ids[0],`POST=${posts} before=${ids.slice(0,3)} after=${after.slice(0,3)}`);
 rec('成功時はエラー通知を出さない',(await toasts()).length===0,JSON.stringify(await toasts()));

 /* ===== (C-2) 現場段取りの端末は元データを取り込まない（§9.378・利用者の報告） =====
    報告（VER2.270.0・LS4）は「27件の`update`が403」「現場段取りのみ: true」
    「書ける: false」「元データの扱い: auto」。取り込みの可否を`editable`
    （＝現場段取りだけでも true）で見ていたため、**アプリが勝手に書きに行き**、
    サーバーが並べ替え以外を断って403が並んでいた。現場は何も操作しておらず、
    直す手立ても無い。書ける端末だけが取り込む。 */
 const sync=await page.evaluate(()=>WL.scheduleView.sourceSync());
 rec('現場段取りだけの端末は「取り込めない」と答える（勝手に403を出しに行かない）',
     sync&&sync.writable===false,JSON.stringify(sync&&{mode:sync.mode,writable:sync.writable}));

 /* ===== (D) サーバーが拒否したときの通知は1回だけ ===== */
 await open();
 // 403の返却をわざと遅らせ、「拒否される前は画面上で入れ替わっている」→
 // 「拒否後に元へ戻る」の2段階を確実に観測する。
 await page.route('**/api/schedule/plan/reorder',async r=>{
  await new Promise(x=>setTimeout(x,1500));
  await r.fulfill({status:403,contentType:'application/json',
   body:JSON.stringify({error:'この端末には、この設備の現場段取り(並べ替え)権限がありません。'})});
 });
 const ids2=await planIds();
 posts=0;
 // 「拒否される前」は**要求が出た時点**で観測する（楽観的更新は要求より先に画面へ出ている。
 // 応答は route が1.5秒遅らせるので、ここで読む並びは拒否前のもの）。
 const reorderSent=page.waitForRequest(r=>r.url().includes('/plan/reorder'),{timeout:20000}).catch(()=>null);
 const rejected=page.waitForResponse(r=>r.url().includes('/plan/reorder'),{timeout:20000}).catch(()=>null);
 await (await page.$(`.sc-row-line[data-id="${ids2[0]}"]`)).focus();
 await page.keyboard.down('Alt');await page.keyboard.press('ArrowDown');await page.keyboard.up('Alt');
 await reorderSent;
 const during=await planIds();
 rec('拒否される前は画面上で入れ替わっている(楽観的更新)',
  JSON.stringify(during)!==JSON.stringify(ids2),`before=${ids2.slice(0,3)} during=${during.slice(0,3)}`);
 await rejected;
 // 拒否のあと、通知が出て並びが戻るまで（通知は応答の直後に出る）
 await page.waitForFunction(()=>document.querySelectorAll('.toast').length>0,{timeout:10000}).catch(()=>{});
 await idle(400,6000);
 const t=await toasts();
 rec('403はリトライしない(呼び出しは1回)',posts===1,'POST='+posts);
 rec('失敗の通知は1件だけ(同じ文言が並ばない)',t.length===1,JSON.stringify(t));
 const after2=await planIds();
 rec('拒否された並びを画面に残さない(元へ戻す)',
  JSON.stringify(after2)===JSON.stringify(ids2),`before=${ids2.slice(0,3)} after=${after2.slice(0,3)}`);

 // 検証用に書き換えた対象設備を戻す(他のテストが同じマスタを見るため)
 setTarget('テスト設備A');

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
