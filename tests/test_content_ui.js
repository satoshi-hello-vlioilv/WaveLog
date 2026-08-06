const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>{try{localStorage.removeItem('scContentModalRectV2')}catch(e){}});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForFunction(()=>{const e=document.querySelector('#scTimeline');return e&&!e.textContent.includes('読み込んでいます')},{timeout:10000});
 await page.waitForTimeout(1500);

 await page.click('#scContentModalBtn');
 await page.waitForSelector('#scContentModal',{state:'visible',timeout:5000});
 await page.waitForTimeout(400);

 // (1) 未設定なら既定の項目が選択済み
 const chosen=await page.$$eval('#scContentChosen .sc-content-name',ns=>ns.map(n=>({label:n.textContent,key:n.title})));
 rec('未設定の設備でも既定の項目が最初から選択されている',
   chosen.length===4&&chosen.map(c=>c.key).join(',')==='lotNo,purposeName,mfgMaterial,mfgTemper',
   JSON.stringify(chosen.map(c=>c.label+'('+c.key+')')));
 rec('alias名ではなく日本語の項目名で表示される',
   chosen.some(c=>c.label==='用途名')&&chosen.some(c=>c.label==='製造材質'),chosen.map(c=>c.label).join(','));

 // (2) 保存ボタンがスクロールせずに見えている
 const foot=await page.evaluate(()=>{
  const m=document.querySelector('#scContentModal'),f=document.querySelector('#scContentModalFoot'),
        s=document.querySelector('#scContentSave'),body=document.querySelector('#scContentModalBody');
  const mr=m.getBoundingClientRect(),sr=s.getBoundingClientRect();
  return {saveInsideModal:sr.bottom<=mr.bottom+1&&sr.top>=mr.top,
          saveVisible:sr.height>0&&sr.width>0,
          footOutsideScroll:!body.contains(s),
          bodyScrollable:body.scrollHeight>body.clientHeight,
          preview:document.querySelector('.sc-content-preview b')?.textContent};
 });
 rec('保存ボタンはスクロール領域の外(固定フッター)にある',foot.footOutsideScroll&&foot.saveInsideModal&&foot.saveVisible,JSON.stringify(foot));
 rec('本文が長くスクロールする状況でも保存が見えている',foot.bodyScrollable?foot.saveVisible:true,'bodyScrollable='+foot.bodyScrollable);
 rec('保存前に表示例(プレビュー)が出る',!!foot.preview&&foot.preview.length>0,foot.preview);

 // (3) リサイズできる
 const before=await page.evaluate(()=>{const r=document.querySelector('#scContentModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),x:r.right,y:r.bottom}});
 await page.mouse.move(before.x-6,before.y-6);
 await page.mouse.down();
 await page.mouse.move(before.x+160,before.y+120,{steps:8});
 await page.mouse.up();
 await page.waitForTimeout(300);
 const after=await page.evaluate(()=>{const r=document.querySelector('#scContentModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('右下つまみのドラッグでサイズを変更できる',after.w>before.w+100&&after.h>before.h+80,`${before.w}x${before.h} -> ${after.w}x${after.h}`);

 // 保存サイズが残る
 await page.click('#scContentModalClose'); await page.waitForTimeout(200);
 await page.click('#scContentModalBtn'); await page.waitForTimeout(400);
 const reopened=await page.evaluate(()=>{const r=document.querySelector('#scContentModal').getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}});
 rec('変更したサイズが次に開いたときも維持される',Math.abs(reopened.w-after.w)<=2&&Math.abs(reopened.h-after.h)<=2,JSON.stringify(reopened));

 // (4) 絞り込みで候補を探せる
 await page.fill('#scContentFilter','検査');
 await page.waitForTimeout(400);
 const filtered=await page.$$eval('.sc-content-add',bs=>bs.map(x=>x.textContent.trim()));
 rec('候補を絞り込める(長い一覧をスクロールしなくてよい)',filtered.length>0&&filtered.every(t=>t.includes('検査')),filtered.join(','));

 // (5) 既定のまま保存 = 未設定として保存(表示は変わらない)
 await page.fill('#scContentFilter','');
 await page.waitForTimeout(300);
 const titleBefore=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-title')].map(n=>n.textContent).join('|'));
 await page.click('#scContentSave');
 await page.waitForTimeout(2000);
 const saved=await page.evaluate(async()=>await fetch('/api/schedule-content-master?equipment='+encodeURIComponent('テスト設備A')).then(r=>r.json()));
 const titleAfter=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-title')].map(n=>n.textContent).join('|'));
 rec('既定と同じ組み合わせのまま保存すると「未設定」のまま(表示も不変)',
   (saved.items||[]).length===0&&titleBefore===titleAfter,`items=${JSON.stringify(saved.items)}`);

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
