const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));

 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 // 前回の検証結果が残っていると候補の出方が変わるため、内容表示マスタを空へ戻す
 await page.evaluate(()=>fetch('/api/schedule-content-master',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({equipment:'テスト設備A',items:[],user_id:'test'})}));
 await page.waitForTimeout(600);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForFunction(()=>{const e=document.querySelector('#scTimeline');return e&&!e.textContent.includes('読み込んでいます')},{timeout:10000});
 // タイムラインの後に仕掛一覧の分割表示(showSplitList)が組み上がる。
 // 固定待ちだと予定件数が増えたときに間に合わず、無関係な失敗になる。
 await page.waitForFunction(()=>!!document.querySelector('.sc-split-wrap #listToolbar')
   &&!!document.querySelector('.sc-split-wrap #grid table'),null,{timeout:30000}).catch(()=>{});
 await page.waitForTimeout(600);

 // --- (3) 列選択の分離 ---
 rec('スケジュールヘッダーの「列選択」は廃止',(await page.$$('#scColumnModalBtn')).length===0);
 const hdr=await page.evaluate(()=>({content:!!document.querySelector('#scContentModalBtn'),
   contentVisible:document.querySelector('#scContentModalBtn')?.hidden===false}));
 rec('代わりに「内容の項目」ボタンがスケジュールヘッダーにある',hdr.content&&hdr.contentVisible,JSON.stringify(hdr));
 const tb=await page.evaluate(()=>({exists:!!document.querySelector('#listToolbar'),
   inSplit:!!document.querySelector('.sc-split-wrap #listToolbar'),
   colBtn:document.querySelector('#listColumnBtn')?.hidden===false}));
 rec('「表示列」ボタンは仕掛一覧側のツールバーへ移設(分割表示内に同居)',tb.exists&&tb.inSplit&&tb.colBtn,JSON.stringify(tb));

 // --- (5) 品質データ結合の可視化 ---
 const chip=await page.evaluate(()=>{const c=document.querySelector('#listJoinChip');return c?{hidden:c.hidden,txt:c.textContent,cls:c.className}:null});
 rec('品質データ結合の結果が一覧の脇に表示される',chip&&!chip.hidden&&/結合済み/.test(chip.txt),JSON.stringify(chip));
 const joined=await page.evaluate(()=>({cols:(typeof S!=='undefined'&&S.columns)||[]}));
 rec('結合された品質列(検査結果・公差判定)が一覧の列に入っている',
   joined.cols.includes('検査結果')&&joined.cols.includes('公差判定'),joined.cols.join(','));

 // --- 予定を1件投入して「内容」欄を検証 ---
 await page.evaluate(()=>window.scheduleAddFromRow?.({'ロット番号':'L0001','鋳造番号':'C001','製造材質':'A5052','製造調質':'H34','用途名':'一般用材','BOX設計_設備名':'テスト設備A','検査結果':'合格','公差判定':'OK'}));
 await page.waitForTimeout(2000);
 // §9.39で区分はセクションではなく行内の「区分」列になった。投入した予定は
 // 「予定」区分の最後の行(末尾へ追加されるため)。
 // §9.88 段6で内容欄は項目ごとの独立した列(1セル1値)になったので、
 // 1つの文字列ではなく行の内容セル全部を集めて中身の集合で見る。
 const plannedContents=()=>page.evaluate(()=>[...document.querySelectorAll('.sc-row-line')]
   .filter(r=>/予定/.test(r.querySelector('.sc-row-cat')?.textContent||''))
   .map(r=>[...r.querySelectorAll('.sc-row-title')].map(c=>c.textContent.trim())));
 const beforeList=await plannedContents();
 const before=beforeList.length?beforeList[beforeList.length-1]:[];
 rec('未設定の設備は既定の組み立てで内容欄を表示',
   before.includes('L0001')&&before.includes('一般用材'),JSON.stringify(before));
 rec('1セルに複数の値が詰め込まれない',before.every(t=>!t.includes(' / ')),JSON.stringify(before));

 /* --- 内容の項目を「検査結果 / 公差判定」だけにする ---
    内容欄の設定は**仕掛一覧と同じパネル**で開く(§9.120)。専用モーダルは
    消したので、チェックの付け外しで選ぶ。並びはパネルの並び順に従う。 */
 await page.click('#scContentModalBtn');
 await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:10000});
 await page.waitForTimeout(600);
 const cand=await page.$$eval('#lcList .lc-item',ns=>ns.map(x=>x.dataset.key));
 rec('内容の項目候補に結合済みの品質列も出る',cand.includes('検査結果')&&cand.includes('公差判定'),cand.slice(0,12).join(','));
 const chosen=await page.evaluate(async()=>{
  const want=new Set(['検査結果','公差判定']);
  const items=[...document.querySelectorAll('#lcList .lc-item')];
  for(const it of items){
   const box=it.querySelector('.lc-vis input');
   if(!box)continue;
   const on=want.has(it.dataset.key);
   if(box.checked!==on){box.click();await new Promise(r=>setTimeout(r,30))}
  }
  await new Promise(r=>setTimeout(r,400));
  return [...document.querySelectorAll('#lcList .lc-item')]
    .filter(x=>x.querySelector('.lc-vis input')?.checked).map(x=>x.dataset.key);
 });
 rec('選んだ項目だけがチェック済みになる',
  chosen.length===2&&chosen.includes('検査結果')&&chosen.includes('公差判定'),chosen.join(','));
 await page.click('#lcSave');
 await page.waitForTimeout(2200);
 await page.evaluate(()=>WL.listColumns.close());
 await page.waitForTimeout(600);
 // この検証で追加した予定(最後の行)の内容欄を見る。古い予定は投入時点の
 // 仕掛データを保存しているため、その項目を持たなければ既定表示のままになる。
 const contents=await plannedContents();
 const last=contents[contents.length-1]||[];
 rec('内容欄が選んだ項目だけに変わる(仕掛一覧の列数とは独立)',
   last.length===2&&last.includes('合格')&&last.includes('OK')&&!last.includes('L0001'),
   'last='+JSON.stringify(last));

 // 一覧の列数は内容欄の設定に影響されない
 const colsAfter=await page.evaluate(()=>document.querySelectorAll('#grid thead th').length);
 rec('一覧の列数は内容欄の設定に引きずられない',colsAfter>4,'th='+colsAfter);

 // --- (2) 分割バーが他画面へ残らない ---
 await page.click('aside [data-db-key="SIKALOTNOW"]');
 await page.waitForTimeout(1500);
 const leaked=await page.evaluate(()=>({
   scMode:document.body.classList.contains('sc-mode'),
   split:document.body.classList.contains('sc-split'),
   divider:!!document.querySelector('.sc-split-divider'),
   wrap:!!document.querySelector('.sc-split-wrap'),
   panelHidden:document.querySelector('#schedulePanel')?.hidden,
 }));
 rec('サイドバーで仕掛一覧へ移ると分割バー・スケジュールパネルが残らない',
   !leaked.scMode&&!leaked.split&&!leaked.divider&&!leaked.wrap&&leaked.panelHidden===true,JSON.stringify(leaked));

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
