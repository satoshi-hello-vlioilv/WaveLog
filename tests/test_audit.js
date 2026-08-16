/* 監査で見つけた点の検証(§9.53):
   - 分割/親ロット判定の問い合わせが行数に比例しない
   - 描き直したら古い判定を打ち切る
   - 一覧の再読込で分割判定のキャッシュも捨てる
   - 作業可否の索引が一括取得の上限に載らなかったロットを補う */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const { addOrphanPlan } = require('./orphan_lot');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
let b=null,orphan=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const calls=[];
 page.on('request',r=>{const u=r.url();if(u.includes('/api/table'))calls.push(u)});
 const since=()=>{const n=calls.length;return()=>calls.length-n};

 // (5)の前提: 仕掛に無いロットの予定が1件あること。無いと索引は1ページ目で
 // 打ち切られる(それが正しい動き)ので、この検証の前提を自前で作る。
 // 画面を開く前に入れておくと、最初の予定取得から載る。
 orphan=await addOrphanPlan(EQ);

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
 await page.waitForTimeout(1500);

 const runParent=async N=>page.evaluate(async N=>{
  // 実データに近い形(親1件に子4件) = 先頭5桁が数行ずつ重複する
  const rows=Array.from({length:N},(_,i)=>({'ロット番号':'P'+String(90000+Math.floor(i/4)).slice(0,4)+String(i).padStart(4,'0')}));
  let idx=0;
  await Promise.all(Array.from({length:3},async()=>{
   while(idx<rows.length){await window.findParentLotFor(rows[idx++])}
  }));
 },N);

 // ---- (1) 行数に比例しない ----
 let m=since(); await runParent(5);  const n5=m();
 m=since(); await runParent(40); const n40=m();
 rec('子カード判定の問い合わせが行数に比例しない(5行と40行で同程度)',
   n40<=n5+4,`5行=${n5}回 / 40行=${n40}回`);
 rec('同じ先頭5桁は1回にまとまる',n40<15,`40行で${n40}回`);

 // ---- (2) 同じ問い合わせは2回目以降ゼロ ----
 m=since(); await runParent(40); const again=m();
 rec('同じ判定を繰り返してもサーバーへ行かない',again===0,`${again}回`);

 // ---- (3) 再読込でキャッシュを捨てる(古い判定を残さない) ----
 await page.evaluate(()=>window.invalidateTableCache());
 m=since(); await runParent(4); const afterInval=m();
 rec('一覧の再読込で分割判定のキャッシュも捨てる',afterInval>0,`${afterInval}回`);

 // ---- (4) 描き直したら古い判定を打ち切る ----
 const aborted=await page.evaluate(async()=>{
  let calls=0;
  const orig=window.findParentLotFor;
  window.findParentLotFor=async r=>{calls++;await new Promise(x=>setTimeout(x,120));return null};
  const tr=document.createElement('tr');
  tr.innerHTML='<td class="split-flag-cell">分割なし</td>';
  const targets=Array.from({length:12},()=>({tr,row:{'ロット番号':'Z1234567'}}));
  checkParentLookupRows(targets);       // 走らせてから
  await new Promise(x=>setTimeout(x,60));
  renderGrid();                          // 途中で描き直す
  await new Promise(x=>setTimeout(x,900));
  window.findParentLotFor=orig;
  return {calls,total:targets.length};
 });
 rec('描き直したら残りの判定を打ち切る',aborted.calls<aborted.total,
   `${aborted.calls}/${aborted.total}件で停止`);

 // ---- (5) 作業可否: 仕掛の500件上限を越えて予定ロットを判定できる(§9.57) ----
 rec('前提: 仕掛に無いロットの予定を用意できた',orphan.ok,`${orphan.lotNo} / ${orphan.detail}`);
 // 判定対象は「タイムラインに出ている予定」なので、先にスケジュール画面を開く
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-row-line',{timeout:15000});
 await page.waitForTimeout(4000);
 const fill=await page.evaluate(async()=>{
  const realFetch=window.fetch;
  let pages=0,perLot=0;
  window.fetch=async(u,o)=>{
   const s=String(u);
   if(s.includes('/api/table?')&&s.includes('SIKALOTNOW')){
    if(s.includes('filters='))perLot++;else pages++;
   }
   return realFetch(u,o);
  };
  await window.refreshScheduleWorkable(true);
  window.fetch=realFetch;
  const st=window.scheduleWorkableState();
  return {pages,perLot,index:st.indexSize,scanned:st.scanned,total:st.total};
 });
 // サーバーはpage_sizeを500で頭打ちにするので、500件を超える仕掛は複数ページ要る
 rec('仕掛を複数ページ辿って索引を作る',
   fill.total<=500||fill.pages>1,JSON.stringify(fill));
 rec('索引が仕掛の全件をカバーする',fill.index>=fill.total,
   `索引${fill.index}件 / 仕掛${fill.total}件`);
 rec('辿っても見つからないロットは個別問い合わせで確定させる',
   fill.perLot>0,`個別${fill.perLot}件`);

 await b.close();b=null;
 // 自分で足した予定は必ず消す(残すと後続テストの「不可」の件数や行位置が変わる)。
 await orphan.remove();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 if(orphan)await orphan.remove().catch(()=>{});
 process.exit(2);
});
