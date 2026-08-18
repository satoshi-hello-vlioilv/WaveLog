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

 /* ---- 現場歴の日付補正(§9.195) ----
    日を跨ぐ区分にだけ「日付の数え方」を出す。跨がない区分に置くと、
    設定できるのに効かない欄になる(§4)。 */
 const dayoff=await page.evaluate(()=>[...document.querySelectorAll('.shift-seg')].map(el=>({
   n:el.querySelector('.shift-seg-name').value,
   cross:(el.querySelector('.shift-seg-next')?.textContent||'').trim(),
   sel:!!el.querySelector('select.shift-seg-dayoff'),
   val:el.querySelector('select.shift-seg-dayoff')?.value||'',
   na:(el.querySelector('.shift-seg-dayoff.is-na')?.textContent||'').trim()})));
 rec('日を跨ぐ区分にだけ「日付の数え方」が出る',
     dayoff.filter(x=>x.sel).length===1&&dayoff.find(x=>x.sel).n==='3直'
     &&dayoff.filter(x=>!x.sel).every(x=>x.na==='—'),JSON.stringify(dayoff));
 rec('既定は「前の日として数える（−1日）」',
     (dayoff.find(x=>x.sel)||{}).val==='-1',(dayoff.find(x=>x.sel)||{}).val);

 /* ---- 見出しと本文が同じグリッドを共有する(§9.176と同じ土台) ---- */
 const grid=await page.evaluate(()=>{
  const head=document.querySelector('.shift-seg-head');
  const rows=[...document.querySelectorAll('.shift-seg')];
  const cs=el=>getComputedStyle(el).gridTemplateColumns;
  const name=document.querySelector('#shiftName');
  return {same:!!head&&rows.every(r=>cs(r)===cs(head)),
          all:[...new Set([cs(head),...rows.map(cs)])],
          nameW:Math.round(name.getBoundingClientRect().width),
          eqDisp:getComputedStyle(document.querySelector('#shiftEquipment')).display,
          /* 設備名のタグ(§9.197)。**文字が読めること**と**高さがそろうこと**を
             見る——「何個あるか」だけの網は、名前が押し出されて消えていた
             ときも通っていた。 */
          eqTags:[...document.querySelectorAll('#shiftEquipment [data-shift-eq]')].map(t=>({
           name:t.dataset.shiftEq,
           text:t.textContent.replace(/[＋✓\s]/g,''),
           h:Math.round(t.getBoundingClientRect().height),
           clipped:t.scrollWidth>t.clientWidth+1}))};
 });
 rec('区分の見出しと本文が同じ列定義を共有する（左端がそろう）',grid.same,grid.all.join(' | '));
 /* **器は中身の長さから決める**(CLAUDE.md §11)。名称は長くても20字ほど
    なのに、以前は枠いっぱい(600px超)まで伸びていた。 */
 rec('勤務体系の名称欄が無意味に長くない',grid.nameW>0&&grid.nameW<=420,grid.nameW+'px');
 /* **設備名そのものが押せるタグ**(§9.197、利用者の指示)。マス目に
    チェックボックスを置く形は、名前が消える不具合の温床でもあった。 */
 rec('適用設備は名前のタグで並ぶ',grid.eqDisp==='flex',grid.eqDisp);
 rec('タグに設備名の文字が出て、切れていない',
     grid.eqTags.length>0&&grid.eqTags.every(t=>t.text===t.name&&!t.clipped),
     JSON.stringify(grid.eqTags));
 rec('タグの高さがそろう',
     grid.eqTags.length>0&&new Set(grid.eqTags.map(t=>t.h)).size===1,
     JSON.stringify(grid.eqTags.map(t=>t.h)));

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

 /* **後始末。** 勤務体系はマスタDBに残り、実行をまたいで生き延びる(§9.121)。
    片付けないと、同じ名前の体系が回すたびに1件ずつ増えていく(実際に18件
    溜まっていた)。移行で作られる「既定の勤務」等には触らない。 */
 try{
  const all=await page.evaluate(async()=>await fetch('/api/schedule/shift-pattern-master?scope=all').then(r=>r.json()));
  for(const x of (all.items||[]))if(x.name==='交替勤務(1,2,3直)')
   await page.evaluate(async id=>await fetch('/api/schedule/shift-pattern-master/delete',
     {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id,user_id:'test-shift'})}),x.id);
 }catch(_){}

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
