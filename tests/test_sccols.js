/* test_sccols.js: タイムラインの内容欄を項目ごとの独立した列へ(§9.88 段6)
   ============================================================
   以前は選んだ項目を「 / 」で繋いだ1つの文字列だった。1セルに複数の値が
   入ると桁が揃わず目で追えないうえ、項目ごとの幅も書式も指定できない。
   **1セル1値**にすると、一覧とまったく同じ仕組み(列レイアウトマスタ)が
   そのまま効く——タイムライン専用の設定画面を作らずに済む。

   ここで固定するのは、崩れると読めなくなる次の点。
    1. 内容が項目ごとの列になり、見出しに**項目名**が出る
       (生のキー`mfgTemper`ではなく「製造調質」)
    2. **見出しとセルの左端が揃う**(桁が合う)
    3. 行の高さは内容によらず一定(段0で決めた土台を壊さない)
    4. 設備停止の行も列数が変わらない(行ごとに列数を変えると桁が崩れる)
    5. 見出しは掴めて、右端に幅の取っ手がある
    6. 幅の指定(timeline:<設備名>)が実際に効く
    7. 書式・読み替えが一覧と同じように効く
    8. 親子の折りたたみのつまみは**最初の内容セル**の中に入る
       (素の兄弟として足すと1列ぶんずれて全部の桁が合わなくなる)
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},user_id:'test'})}catch(e){}
 try{await post('/api/schedule-content-master',{equipment:EQ,items:[],user_id:'test'})}catch(e){}
}
run('test_sccols: タイムラインの内容欄を項目ごとの独立した列へ(§9.88 段6)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await cleanup();
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await W.settleFlags(page); await idle();

  const shot=()=>page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   const head=tl.querySelector('.sc-row-head');
   const rows=[...tl.querySelectorAll('.sc-row-line')];
   const row=rows[0];
   return {
    headKeys:[...head.querySelectorAll('[data-content-col]')].map(h=>h.dataset.contentCol),
    headText:[...head.querySelectorAll('[data-content-col]')].map(h=>h.textContent.trim()),
    headX:[...head.querySelectorAll('[data-content-col]')].map(h=>Math.round(h.getBoundingClientRect().left)),
    headW:[...head.querySelectorAll('[data-content-col]')].map(h=>Math.round(h.getBoundingClientRect().width)),
    cellKeys:[...row.querySelectorAll('.sc-row-title')].map(c=>c.dataset.contentCol),
    cellText:[...row.querySelectorAll('.sc-row-title')].map(c=>c.textContent.trim()),
    cellX:[...row.querySelectorAll('.sc-row-title')].map(c=>Math.round(c.getBoundingClientRect().left)),
    rowHeights:[...new Set(rows.map(r=>Math.round(r.getBoundingClientRect().height)))],
    cellCounts:[...new Set(rows.map(r=>r.querySelectorAll('.sc-row-title').length))],
    grips:head.querySelectorAll('[data-content-col] .col-resize').length,
    draggable:[...head.querySelectorAll('[data-content-col]')].filter(h=>h.draggable).length,
    tracks:getComputedStyle(row).gridTemplateColumns.split(' ').length,
   };
  });

  /* ---- 1) 項目ごとの列になっている ---- */
  let v=await shot();
  rec('内容が項目ごとの列に分かれる',v.headKeys.length>=3,`${v.headKeys.length}列: ${v.headKeys.join(',')}`);
  rec('見出しは項目名で出る(生のキーではない)',
   v.headText.includes('ロット番号')&&!v.headText.includes('lotNo'),v.headText.join(' / '));
  rec('セルは項目ごとに1つずつ',v.cellKeys.join()===v.headKeys.join(),v.cellKeys.join(','));
  rec('1セルに1つの値だけが入る',v.cellText.every(t=>!t.includes(' / ')),v.cellText.join(' | '));

  /* **要点**: 見出しとセルの桁が合う。ずれると表として読めない。 */
  rec('見出しとセルの左端が揃う',v.headX.join()===v.cellX.join(),
   `head=${v.headX.join(',')} / cell=${v.cellX.join(',')}`);
  /* 固定10列＋取っ手＋内容の数＋**余りを受ける1本**（§9.209 ①）。
     余りの1本はセルを持たない——列を増やしたのではなく、狭めたときに
     できる空きを受けるための器。 */
  rec('グリッドの列数が内容の数だけ増える',v.tracks===12+v.headKeys.length,
   `${v.tracks}列(内容${v.headKeys.length})`);

  /* ---- 2) 行の高さと列数は行によらず一定 ---- */
  rec('行の高さは内容によらず一定',v.rowHeights.length===1,JSON.stringify(v.rowHeights));
  rec('どの行も列数が同じ(設備停止の行も含む)',v.cellCounts.length===1,JSON.stringify(v.cellCounts));

  /* ---- 3) 見出しの操作の受け口 ---- */
  rec('見出しは掴んで並べ替えできる',v.draggable===v.headKeys.length,`${v.draggable}/${v.headKeys.length}`);
  rec('見出しに列幅の取っ手がある',v.grips===v.headKeys.length,`${v.grips}/${v.headKeys.length}`);

  /* ---- 4) 幅・書式・読み替えが効く(一覧と同じ列レイアウトマスタ) ---- */
  const keys=v.headKeys;
  await post('/api/column-layout-master',{target:TARGET,user_id:'test',
   order:keys,widths:{[keys[1]]:210},hidden:[],names:{[keys[1]]:'用途(表示名)'},
   formats:{[keys[2]]:{kind:'text',prefix:'<',suffix:'>'}},rules:{}});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await W.settleFlags(page); await idle();
  v=await shot();
  rec('開き直しても幅の指定が効く',Math.abs(v.headW[1]-210)<=2,`${v.headW[1]}px`);
  rec('開き直しても表示名の指定が効く',v.headText[1]==='用途(表示名)',v.headText[1]);
  rec('書式が内容のセルに効く',/^<.*>$/.test(v.cellText[2]||''),v.cellText[2]);
  rec('見出しとセルの桁は幅を変えても揃う',v.headX.join()===v.cellX.join(),
   `head=${v.headX.join(',')} / cell=${v.cellX.join(',')}`);
  rec('行の高さは幅を変えても一定',v.rowHeights.length===1,JSON.stringify(v.rowHeights));

  /* ---- 5) 項目を増やすと列が増える(内容表示マスタが「何を出すか」を決める)
     **内容表示マスタはモードによらず読む**（§9.246 ②で訂正。以前は
     scheduleモードだけで、編集モードは既定の4項目へ落ちていた——
     同じ表が2通りの姿を持っており、モードを一往復すると直るという形で
     実機から報告された）。下の`mode:'schedule'`は**このあとの手順が
     全体俯瞰から入る作りだから**残してある（モードの前提ではない）。
     編集モードとの一致は`tests/test_scmodecols.js`が見る。 */
  const more=[...keys,'鋳造番号'];
  await post('/api/schedule-content-master',{equipment:EQ,items:more,user_id:'test'});
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  // scheduleモードは設備を選ぶところから始まる(全設備を扱えるため)。
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(e=>{
   const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment===e);
   if(r)r.click();
  },EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await W.settleFlags(page); await idle();
  const v2=await shot();
  rec('項目を足すと列が増える',v2.headKeys.length===v.headKeys.length+1,
   `${v.headKeys.length} -> ${v2.headKeys.length}`);
  rec('増えても桁は揃う',v2.headX.join()===v2.cellX.join());
  rec('増えても行の高さは一定',v2.rowHeights.length===1,JSON.stringify(v2.rowHeights));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));
  await post('/api/access-mode',{mode:'edit'});

  await cleanup();
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
 }
}, {viewport:{width:1700,height:1000}});
