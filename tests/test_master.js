const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1400,height:900}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
 await page.waitForTimeout(900);

 const g=await page.$$eval('.mm-nav-group-label',ns=>ns.map(n=>n.textContent));
 rec('マスタ種別がグループ見出しで階層化される',g.length===3&&g.join('/')==='設備・人/作業スケジュール/表示・システム',g.join('/'));

 const inSchedGroup=await page.evaluate(()=>{
  const grp=[...document.querySelectorAll('.mm-nav-group')].find(x=>x.querySelector('.mm-nav-group-label')?.textContent==='作業スケジュール');
  return grp?[...grp.querySelectorAll('[data-master]')].map(b=>b.dataset.master):[];
 });
 rec('スケジュール系マスタが同じグループに集まる',
   ['stopReason','shiftMaster','loadFactor'].every(k=>inSchedGroup.includes(k)),inSchedGroup.join(','));

 const clickTab=async l=>await page.evaluate(t=>{const b=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes(t));if(b)b.click();return !!b},l);

 // 横スクロールが出ないこと(列数の多いアクセス権限マスタで確認)
 await clickTab('アクセス権限');
 await page.waitForTimeout(1200);
 const ov=await page.evaluate(()=>{
  const w=document.querySelector('.mm-list-wrap'),p=document.querySelector('#masterMaintPanel');
  return {listScrollW:w.scrollWidth,listClientW:w.clientWidth,
          panelScrollW:p.scrollWidth,panelClientW:p.clientWidth,
          bodyScrollW:document.body.scrollWidth,bodyClientW:document.body.clientWidth,
          cols:document.querySelectorAll('.mm-row.head>span').length};
 });
 rec('列数の多いマスタでも一覧に横スクロールが出ない',ov.listScrollW<=ov.listClientW+1,JSON.stringify(ov));
 rec('画面全体にも横スクロールが出ない',ov.bodyScrollW<=ov.bodyClientW+1,`body ${ov.bodyScrollW}/${ov.bodyClientW}`);
 rec('列数が多いマスタでは更新者/更新日時を列から外す(6項目+操作=7)',ov.cols===7,'head spans='+ov.cols);

 // 列が少ないマスタでは監査列を出す
 await clickTab('スプール');
 await page.waitForTimeout(900);
 const sp=await page.evaluate(()=>({cols:document.querySelectorAll('.mm-row.head>span').length,
   labels:[...document.querySelectorAll('.mm-row.head>span')].map(s=>s.textContent)}));
 rec('列数が少ないマスタでは更新者・更新日時も列として出す',sp.labels.includes('更新者')&&sp.labels.includes('更新日時'),sp.labels.join(','));

 // 統合されたスケジュール系マスタが master.sqlite3 の生データタブに見える
 await clickTab('テーブル生データ');
 await page.waitForTimeout(1400);
 const tables=await page.$$eval('#rawTableSelect option',os=>os.map(o=>o.value));
 rec('設備停止・勤務形態・稼働カレンダー・換算係数がmaster.sqlite3に統合された',
   ['設備停止マスタ','勤務形態マスタ','稼働カレンダーマスタ','負荷率上書きマスタ'].every(t=>tables.includes(t)),tables.join(','));

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
