const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1500,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('MeasurementUserIdV1','tester'));
 await page.click('#openMasterMaint');
 await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
 await page.fill('#masterUserId','tester');
 await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
 await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes('勤務形態'));if(b)b.click()});
 await page.waitForSelector('.shift-editor',{timeout:8000});
 await page.waitForTimeout(600);

 const migrated=await page.$$eval('.shift-list-item b',ns=>ns.map(n=>n.textContent));
 rec('旧フラット勤務形態が勤務体系へ自動移行されている',migrated.length>0,migrated.join(' / '));

 // テンプレートから 交替勤務(1,2,3直) を作る
 await page.click('#shiftNew'); await page.waitForTimeout(300);
 await page.evaluate(()=>{const b=[...document.querySelectorAll('[data-shift-tmpl]')].find(x=>x.textContent.includes('1,2,3直'));if(b)b.click()});
 await page.waitForTimeout(400);
 const t=await page.evaluate(()=>({
   name:document.querySelector('#shiftName').value,
   segs:[...document.querySelectorAll('.shift-seg')].map(el=>({
     n:el.querySelector('.shift-seg-name').value,
     s:el.querySelector('.shift-seg-start').value,
     e:el.querySelector('.shift-seg-end').value,
     next:el.querySelector('.shift-seg-next').textContent})),
   timeInputs:document.querySelectorAll('.shift-seg input[type="time"]').length,
   bars:document.querySelectorAll('.shift-bar-piece').length,
 }));
 rec('テンプレート1クリックで階層(体系+3区分)が入る',t.name==='交替勤務(1,2,3直)'&&t.segs.length===3,JSON.stringify(t.segs));
 rec('時刻はinput[type=time](直打ち回避)',t.timeInputs===6,'time inputs='+t.timeInputs);
 rec('日跨ぎの3直に「翌日」バッジが出る',t.segs[2].next==='翌日',JSON.stringify(t.segs[2]));
 rec('24時間バーが描かれる(日跨ぎは2本に分割)',t.bars===4,'pieces='+t.bars);
 const cov=await page.evaluate(()=>document.querySelector('#shiftCoverage')?.textContent);
 rec('カバレッジが可視化される',/24時間をすべてカバー/.test(cov||''),cov);

 // 保存
 await page.click('#shiftSave'); await page.waitForTimeout(2200);
 const saved=await page.evaluate(async()=>await fetch('/api/schedule/shift-pattern-master?scope=all').then(r=>r.json()));
 const p=(saved.items||[]).find(x=>x.name==='交替勤務(1,2,3直)');
 rec('保存され、階層のままサーバーに入る',!!p&&p.segments.length===3,p?JSON.stringify(p.segments):'not found');

 // 区分追加は前の区分の終了時刻を引き継ぐ
 await page.click('#shiftAddSeg'); await page.waitForTimeout(400);
 const added=await page.evaluate(()=>{const els=[...document.querySelectorAll('.shift-seg')];const l=els[els.length-1];
   return {n:l.querySelector('.shift-seg-name').value,s:l.querySelector('.shift-seg-start').value,prevEnd:els[els.length-2].querySelector('.shift-seg-end').value}});
 rec('区分追加時に直前の終了時刻を開始の初期値にする',added.s===added.prevEnd,JSON.stringify(added));

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
