const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
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
 // APIの呼ばれ方を数える
 let api={plan:0,overview:0,table:0};
 page.on('request',r=>{const u=r.url();
  if(u.includes('/api/schedule/plan?'))api.plan++;
  else if(u.includes('/api/schedule/overview'))api.overview++;
  else if(u.includes('/api/table?'))api.table++;});
 const reset=()=>{api={plan:0,overview:0,table:0}};

 await setMode('schedule');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 /* ---- 待ち方(§フェーズF) ----
    このテストは「操作のあとサーバーへ何回行ったか」を数える。数える前に
    **画面が組み上がるのを待つ**必要があるが、固定待ちで待つと、その秒数が
    そのままテストの所要時間になる(実測で34秒中31秒が待ち時間だった)。
    「その状態になるまで待つ」+「取りこぼしの要求を拾う短い落ち着き」に
    分けると、同じことを確かめたまま速くなる。落ち着きを0にしないこと——
    描画の直後に飛ぶ要求を数え損ねる。 */
 const SETTLE=350;
 const until=async(fn,ms=15000)=>{await page.waitForFunction(fn,null,{timeout:ms}).catch(()=>{});
   await page.waitForTimeout(SETTLE)};
 const untilRows=()=>until(()=>document.querySelectorAll('.sc-row-line').length>0);
 const untilBoard=()=>until(()=>document.querySelectorAll('.sc-board-row').length>0);

 // --- 初回 ---
 reset();
 let t=Date.now();
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 const firstBoardMs=Date.now()-t;
 /* §9.182で**押す前に先読みする**ようにしたので、押した時点の要求は0でよい
    （0なら「もう持っている」＝速い、1なら「今取った」＝従来どおり。どちらも
    正しい）。ここで見たいのは**同じものを2回取っていないこと**なので、
    「1回まで」に固定する。 */
 rec('俯瞰ボードは高々1回しか取らない（先読み済みなら0）',api.overview<=1,
     `overview=${api.overview} ${firstBoardMs}ms`);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await untilRows();
 rec('設備を開くと予定を1回取得する',api.plan===1,`plan=${api.plan}`);
 /* 読込時点は`#scSyncChip`が言う（§9.300 ①。§9.42の`#scFreshness`と
    §9.188の同期チップは同じ問いの2つの答えだったので1つに畳んだ）。 */
 rec('読込時点がヘッダーに出る',
  await page.evaluate(()=>{const e=document.querySelector('#scSyncChip');return !!e&&!e.hidden&&/時点/.test(e.textContent)}),
  await page.evaluate(()=>document.querySelector('#scSyncChip')?.textContent));

 // --- 画面を離れて戻る(ここが遅かった) ---
 reset();
 t=Date.now();
 await page.click('#openMasterMaint');
 await until(()=>!document.body.classList.contains('sc-mode'));
 await page.click('#openSchedule');
 await until(()=>document.querySelectorAll('.sc-row-line,.sc-board-row').length>0);
 const backMs=Date.now()-t;
 rec('画面を離れて戻っても再読込しない',api.overview===0&&api.plan===0,
  `overview=${api.overview} plan=${api.plan} table=${api.table}`);
 rec('戻ったときも内容が表示されている',
  await page.evaluate(()=>document.querySelectorAll('.sc-row-line,.sc-board-row').length>0));

 // --- 設備を切り替えて戻る ---
 reset();
 await page.click('#scModeBoard'); await untilBoard();
 rec('全体ボードへ戻るときも再取得しない',api.overview===0,`overview=${api.overview}`);
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備B');if(r)r.click()});
 await untilRows();
 rec('未読込の設備は取得する',api.plan===1,`plan=${api.plan}`);
 reset();
 await page.click('#scModeBoard'); await untilBoard();
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await untilRows();
 rec('一度読んだ設備へ戻るときは取得しない',api.plan===0,`plan=${api.plan}`);

 // --- 再計算は必ず取り直す ---
 reset();
 await page.click('#scRefresh'); await untilRows();
 rec('「再計算」は必ず取り直す',api.plan===1,`plan=${api.plan}`);

 // --- 予定を変えるとキャッシュを捨てる ---
 reset();
 const id=await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-row-line')]
   .find(x=>x.querySelector('.sc-row-lock'));return r?r.dataset.id:null});
 /* **書込が終わるまで待ってから数え直す**（§9.268の追補）。
    以前は`untilRows()`（行が在れば350msで返る）のあと`reset()`していたが、
    書込は1.5秒かかっていたので、**その書込自身の取り直し**が`reset()`より
    後に届き、それを「開き直したら取り直した」と数えていた。
    ロックの確認待ちを短くしたら（§9.267の追補）書込が先に終わるようになり、
    露見した——**待ちの長さに寄りかかった網だった。**
    書込の取り直しが届くのを待ってから数え直す。 */
 const before=api.plan;
 await page.click(`.sc-row-line[data-id="${id}"] .sc-row-lock`);
 for(let i=0;i<160&&api.plan<=before;i++)await page.waitForTimeout(50);
 await untilRows();
 rec('固定を押すと、その場で取り直す',api.plan>before,`plan=${api.plan}`);
 reset();
 await page.click('#scModeBoard'); await untilBoard();
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await untilRows();
 /* **見たいのは「古い内容が残らない」こと**（§9.268の追補）。
    以前は`plan===1`（＝開き直したら1回取りに行く）で見ていたが、書込の
    直後に取り直している以上、そのあとの再訪でキャッシュを使うのは**正しい**
    ——数え方のほうが 約束 を取り違えていた（待ちが長かったので、書込
    自身の取り直しを「再訪の取り直し」と数えていただけ）。
    行の状態そのもので見る。 */
 const stillFixed=await page.evaluate(i=>{
   const r=document.querySelector(`.sc-row-line[data-id="${i}"]`);
   return r?{locked:r.classList.contains('sc-row-locked'),
             btn:(r.querySelector('.sc-row-lock')||{}).textContent||''}:null;
 },id);
 rec('予定を変えた後に開き直しても、古い内容が残らない',
     !!stillFixed&&(stillFixed.locked||/解除/.test(stillFixed.btn)),
     JSON.stringify(stillFixed));
 rec('開き直しでむだに取りに行かない（書込の直後に取り直している）',
     api.plan===0,`plan=${api.plan}`);
 await page.click(`.sc-row-line[data-id="${id}"] .sc-row-lock`); await untilRows();

 // --- 日付＋勤務のまとめ ---
 await pickView('#scGroupSelect','dateshift');
 await until(()=>document.querySelectorAll('.sc-group-head').length>0);
 const heads=await page.$$eval('.sc-group-head .sc-group-label',n=>n.map(x=>x.textContent));
 rec('「日付＋勤務ごと」で日付と勤務を組にした見出しが出る',
  heads.length>0&&heads.every(h=>/\d{4}\/\d{2}\/\d{2}/.test(h))&&heads.some(h=>/直|勤務/.test(h)),
  heads.slice(0,4).join(' / '));
 await pickView('#scGroupSelect','none');
 await until(()=>document.querySelectorAll('.sc-group-head').length===0);

 console.log(`\n(参考) 初回の俯瞰ボード ${firstBoardMs}ms / 離れて戻る ${backMs}ms`);
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
