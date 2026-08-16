/* test_reccols.js: データ一覧の表示列（§9.162）
   ============================================================
   仕掛一覧・作業スケジュールの内容欄と**同じパネル**で決める。設定画面を
   2つ持たないのがこの機能の主旨なので、ここで固定するのは
   「同じパネルが開く」「既定の見え方が変わっていない」「触った結果が
   一覧に出る」「保存して開き直しても残る」の4点。

   **既定の15列と並びが今までと同じであること**が一番大事。候補は44列
   あるので、`initialHidden`が効いていないと保存した瞬間に見覚えの無い
   29列が並ぶ（§9.120で内容欄が踏んだのと同じ罠）。

   後片付けは finally で必ず行う。**列レイアウトマスタは実行をまたいで
   生き延びる**（§9.121）ので、消し忘れると次の実行が引き継ぐ。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TARGET='records:list';
/* 今まで出ていた15列。**この並びを変えないこと**（設定していない端末の
   見え方を変えないため）。 */
const DEFAULT_HEAD=['状態','ロット番号','検査番号','製造材質','製造板厚','用途名','コース',
                    'オペレータ','検査員','作業人数','分割','作業開始時刻','更新日時',
                    '実作業時間','操作'];
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{await post('/api/column-layout-master',{target:TARGET,order:[],widths:{},hidden:[],
      names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
}
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
const head=page=>page.evaluate(()=>[...document.querySelectorAll('.record-list-head>span')].map(s=>s.textContent.trim()));
async function openList(page){
 await page.evaluate(()=>openRecordsSafe('編集中'));
 await page.waitForSelector('.record-list-head',{timeout:20000});
 await settle(page);
}
(async()=>{
 await cleanup();
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openList(page);

  /* ---- 1) 既定の見え方が変わっていない ---- */
  const h0=await head(page);
  rec('既定は今までの15列で並びも同じ',JSON.stringify(h0)===JSON.stringify(DEFAULT_HEAD),
      h0.join('／'));
  const cols0=await page.evaluate(()=>getComputedStyle(document.getElementById('recordList'))
    .getPropertyValue('--rec-cols').trim());
  rec('列幅はJSが--rec-colsへ入れている',cols0.split(')').length-1>=15,
      cols0.slice(0,60)+'…');

  /* ---- 2) 「表示列」ボタンで**同じパネル**が開く ---- */
  const btn=await page.$('#recordColumnsBtn');
  rec('「表示列」ボタンがある',!!btn);
  await page.click('#recordColumnsBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) .lc-item',{timeout:15000});
  await settle(page);
  const panel=await page.evaluate(()=>({
   id:document.getElementById('listColumnPanel')?'listColumnPanel':'',
   title:document.getElementById('lcTitle')?.textContent||'',
   rows:document.querySelectorAll('#listColumnPanel .lc-item').length,
   checked:[...document.querySelectorAll('#listColumnPanel .lc-item input[type=checkbox]')]
     .filter(x=>x.checked).length,
   origins:[...document.querySelectorAll('#lcOrigins button')].map(x=>x.textContent.trim()),
   fx:!document.getElementById('lcAddCol')?.hidden,
  }));
  rec('仕掛一覧と同じパネル（#listColumnPanel）が開く',panel.id==='listColumnPanel',panel.title);
  rec('候補が既定の15列より多い',panel.rows>DEFAULT_HEAD.length,panel.rows+'列');
  rec('一度も保存していないうちは既定の15列だけがチェック済み',
      panel.checked===DEFAULT_HEAD.length,panel.checked+' / '+panel.rows);
  rec('分類は「元データ」と「計算・操作」の2つ（結合は無いので出さない）',
      panel.origins.length===3&&panel.origins.join('').includes('元データ')
      &&panel.origins.join('').includes('計算・操作')
      &&!panel.origins.join('').includes('結合'),panel.origins.join(' / '));
  rec('計算式で列を作れる（仕掛一覧と同じ機能）',panel.fx===true);

  /* ---- 3) 触った結果がそのまま一覧に出る（保存していなくても） ---- */
  await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='鋳造番号');
   if(!row)throw Error('鋳造番号の行が無い');
   row.querySelector('input[type=checkbox]').click();
  });
  await settle(page);
  const h1=await head(page);
  rec('チェックを入れると保存せずに一覧へ出る',h1.includes('鋳造番号'),h1.join('／'));

  /* ---- 4) 表示名を変えると見出しが変わる ---- */
  await page.evaluate(()=>{
   [...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='更新日時').click();
  });
  await settle(page);
  await page.fill('#lcName','最終更新');
  await page.dispatchEvent('#lcName','input');
  await settle(page);
  const h2=await head(page);
  rec('表示名が見出しに出る',h2.includes('最終更新')&&!h2.includes('更新日時'),h2.join('／'));

  /* ---- 5) 保存せずに閉じたら開いた時点へ戻る ---- */
  await page.evaluate(()=>WL.listColumns.close());
  await settle(page);
  const h3=await head(page);
  rec('保存せずに閉じたら元へ戻る',JSON.stringify(h3)===JSON.stringify(DEFAULT_HEAD),h3.join('／'));

  /* ---- 6) 保存すると再読込後も残る ---- */
  await page.click('#recordColumnsBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) .lc-item',{timeout:15000});
  await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#lcList [data-key]')].find(r=>r.dataset.key==='使用設備');
   row.querySelector('input[type=checkbox]').click();
  });
  await settle(page);
  await page.click('#lcSave');
  await page.waitForTimeout(1200);
  await page.evaluate(()=>WL.listColumns.close());
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await openList(page);
  const h4=await head(page);
  rec('保存した設定は再読込後も残る',h4.includes('使用設備'),h4.join('／'));
  rec('保存しても既定の15列は消えていない',
      DEFAULT_HEAD.every(x=>h4.includes(x)),
      DEFAULT_HEAD.filter(x=>!h4.includes(x)).join('／')||'欠けなし');

  /* ---- 7) 切れる値には生の値のtitleが付く（§9.94の約束） ---- */
  const tips=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('.record-list-row .record-list-cell')];
   if(!cells.length)return {n:0,withTitle:0};
   return {n:cells.length,withTitle:cells.filter(c=>c.getAttribute('title')).length};
  });
  rec('セルに生の値のtitleが付いている',tips.n===0||tips.withTitle>0,
      tips.withTitle+' / '+tips.n);

  /* ---- 8) 閲覧モードでは「表示列」を出さない（保存が403になるため） ---- */
  await post('/api/access-mode',{mode:'view'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>openRecordsSafe('編集中')).catch(()=>{});
  await page.waitForTimeout(1500);
  const hidden=await page.evaluate(()=>{
   const b2=document.getElementById('recordColumnsBtn');
   return !b2||b2.hidden;
  });
  rec('閲覧モードでは「表示列」ボタンを出さない',hidden===true);

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  await cleanup();
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
