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
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForFunction(()=>{const e=document.querySelector('#scTimeline');return e&&!e.textContent.includes('読み込んでいます')},{timeout:10000});
 await page.waitForTimeout(1500);

 // 「予定」行だけを見る。先頭行は計画外実績(他テストが残したバックアップ行から
 // 合成される)になることがあり、その行の内容は元データ次第で用途名を持たない。
 const before=await page.$$eval('.sc-row-line',ns=>ns
   .filter(n=>(n.querySelector('.sc-row-cat')||{}).textContent?.includes('予定'))
   .map(n=>(n.querySelector('.sc-row-title')||{}).textContent||''));
 // 先頭行に限定しない。共有フィクスチャには検証用にAPIで直接作った
 // 用途名を持たない予定も混ざるため、「既定の組み立てが効いている行が
 // あること」で見る(変更後は全行が材質のみになることを後段で確認する)。
 rec('変更前は既定の組み立て',before.some(t=>t.includes('一般用材')),
   `${before.length}件中 例=${JSON.stringify(before.slice(0,3))}`);
 rec('欠けている項目があっても二重空白にならない',
   !before.some(t=>/\s{2,}/.test(t)),
   JSON.stringify(before.filter(t=>/\s{2,}/.test(t)).slice(0,3)));

 await page.click('#scContentModalBtn');
 await page.waitForSelector('#scContentModal',{state:'visible',timeout:5000});
 await page.waitForTimeout(400);

 // 候補に同義の重複(用途名とpurposeName)が並んでいないこと
 const cands=await page.$$eval('.sc-content-add',bs=>bs.map(x=>({label:x.textContent.replace('＋','').trim(),key:x.title})));
 const chosenKeys=await page.$$eval('#scContentChosen .sc-content-name',ns=>ns.map(n=>n.title));
 const all=[...cands.map(c=>c.key),...chosenKeys];
 rec('同義の項目が重複して並ばない(用途名/purposeNameが両方出ない)',
   !(all.includes('用途名')&&all.includes('purposeName')),JSON.stringify(all));

 // 「製造材質」だけにして保存 → 全予定(古い予定も含む)で反映されること
 await page.evaluate(()=>{
  document.querySelectorAll('#scContentChosen .sc-content-item [data-act="del"]').forEach(()=>{});
 });
 // すべて外してから製造材質を1つ選ぶ
 await page.click('#scContentClear'); await page.waitForTimeout(300);
 await page.evaluate(()=>{const b=[...document.querySelectorAll('.sc-content-add')].find(x=>x.textContent.includes('製造材質'));if(b)b.click()});
 await page.waitForTimeout(300);
 const preview=await page.evaluate(()=>document.querySelector('.sc-content-preview b')?.textContent);
 rec('プレビューが選択内容を反映する',preview==='A5052'||preview==='A6061',preview);
 await page.click('#scContentSave');
 await page.waitForTimeout(2200);

 const after=await page.$$eval('.sc-row-title',ns=>ns.map(n=>n.textContent));
 const workRows=after.filter(t=>t!=='型替え');
 // 既定は「ロット 用途名 材質-調質」の複数項目つなぎなので必ず空白が入る。
 // 1項目だけにしたら、どの行も空白の無い単一の値になるはず。
 // (仕掛に無いロット=他テストが積んだ予定は材質を引けずロット番号のまま出る。
 //  これも単一の値なので同じ判定で扱える。)
 const composite=workRows.filter(t=>/\s/.test(t.trim()));
 const materials=workRows.filter(t=>/^A\d{4}$/.test(t.trim()));
 rec('選択した項目がタイムラインへ反映される',
   composite.length===0&&materials.length>0,
   `複数項目のまま=${composite.length}件 材質のみ=${materials.length}件 例=${JSON.stringify(after.slice(0,3))}`);
 rec('alias名しか持たない古い予定にも反映される(相互読み替え)',
   workRows.length>1&&workRows[0].trim()==='A5052',`first=${workRows[0]}`);

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
