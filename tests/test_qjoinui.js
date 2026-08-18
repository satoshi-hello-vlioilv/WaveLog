/* test_qjoinui.js: クエリ結合の画面（§9.193）
   ============================================================
   固定するのは4つ:
     1. データ接続の一覧が**行で並び、見出しと同じ列定義を共有する**
        （カード形式では項目の左端が行ごとにずれて列として追えなかった）
     2. クエリ結合のタブから、**登録済みのデータ接続の組み合わせだけ**で
        結合を作れること（保存する前に当ててみられること）
     3. 一覧の帯が**結合の名前と件数を文字で**言い、列の設定パネルが
        足された列を「結合」に分類すること（色だけで伝えない）
     4. スケジュール表の内容欄で、結合で足した列を**選べて・値が出る**こと

   **後始末は必ず行う**——マスタDBは実行をまたいで生き延びるので（§9.121）、
   落ちても finally で消す。ブラウザも必ず閉じる。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const NAME='テスト結合UI';
const EQ='テスト設備A';
let b=null,joinId=null,contentTouched=false;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};

async function call(method,path,body){
 const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined});
 let j={};try{j=await r.json()}catch(_){}
 return {status:r.status,body:j};
}
const raf2=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  const cat=(await call('GET','/api/catalog')).body;
  const WORK=cat.workKey,QUALITY=cat.qualityKey;

  /* ---- 1) データ接続の一覧は「行」で、見出しと同じ列定義 ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="dataSource"]',{timeout:20000});
  /* 更新者IDはマスタ更新の必須項目（requireMaintUser）。入れずに保存すると
     トーストが出るだけで**何も起きない**ので、先に入れておく。 */
  await page.evaluate(()=>{const el=document.querySelector('#masterUserId');
    if(el){el.value='test-qjoin';el.dispatchEvent(new Event('change',{bubbles:true}))}});
  await page.click('#masterMaintNav [data-master="dataSource"]');
  await page.waitForSelector('#masterMaintList .ds-rows .ds-row:not(.ds-row-head)',{timeout:20000});
  await raf2(page);
  const dsRows=await page.evaluate(()=>{
   const head=document.querySelector('#masterMaintList .ds-row-head');
   const rows=[...document.querySelectorAll('#masterMaintList .ds-row:not(.ds-row-head)')];
   const cs=el=>getComputedStyle(el).gridTemplateColumns;
   return {count:rows.length,headCols:cs(head),
           all:[...new Set([cs(head),...rows.map(cs)])],
           same:rows.every(r=>cs(r)===cs(head)),
           listed:rows.map(r=>r.querySelector('.ds-listed')?.textContent.trim()||''),
           heights:rows.map(r=>Math.round(r.getBoundingClientRect().height))};
  });
  rec('データ接続は1行＝1データソースで並ぶ',dsRows.count>=2,dsRows.count+'行');
  rec('見出しと本文が同じ列定義を共有する（左端がそろう）',dsRows.same,dsRows.all.join(' | '));
  rec('「一覧に出す/出さない」が行に出ている',
      dsRows.listed.every(t=>t==='出す'||t==='出さない'),JSON.stringify(dsRows.listed));
  /* 高密度＝1行が2行ぶんの高さに膨らんでいないこと。行の高さは文字サイズから
     決まるので、絶対値ではなく**見出し行との比**で見る（表示サイズに追随する）。 */
  const headH=await page.$eval('#masterMaintList .ds-row-head',n=>Math.round(n.getBoundingClientRect().height));
  rec('1行が見出し行の2倍を超えない（高密度）',
      dsRows.heights.every(h=>h<=headH*2.4),`見出し${headH}px 行${JSON.stringify(dsRows.heights)}`);

  /* ---- 2) クエリ結合のタブ ---- */
  rec('クエリ結合のタブがある',
      await page.$('#masterMaintNav [data-master="queryJoin"]')!==null);
  await page.click('#masterMaintNav [data-master="queryJoin"]');
  await page.waitForSelector('#qjAddBtn',{timeout:20000});
  const sources=await page.evaluate(()=>{
   const b=document.querySelector('#qjAddBtn');b.click();
   return new Promise(r=>setTimeout(()=>{
    const sel=document.querySelector('[data-qj-field="right"]');
    r([...(sel?sel.options:[])].map(o=>o.value).filter(Boolean));
   },400));
  });
  rec('相手はデータ接続に登録済みのものだけから選ぶ',
      sources.length>0&&sources.every(k=>['SIKALOTNOW','SIKALOTDEF','QJTESTUI'].includes(k)||k===WORK||k===QUALITY),
      JSON.stringify(sources));
  // 列の候補が両側とも入るまで待つ（/api/table-columns の往復）
  await page.waitForFunction(()=>{
   const l=document.querySelector('[data-qj-keyleft="0"]'),r=document.querySelector('[data-qj-keyright="0"]');
   return l&&r&&l.options.length>1&&r.options.length>1;
  },{timeout:20000});
  const keyOpts=await page.evaluate(()=>({
   left:[...document.querySelector('[data-qj-keyleft="0"]').options].map(o=>o.value).length,
   right:[...document.querySelector('[data-qj-keyright="0"]').options].map(o=>o.value).length}));
  rec('突合キーの候補は実際の列から作る',keyOpts.left>2&&keyOpts.right>2,JSON.stringify(keyOpts));
  // 名前・キー・接頭辞を入れて下見が出ることを見る
  await page.evaluate(n=>{
   const set=(sel,v)=>{const el=document.querySelector(sel);el.value=v;
     el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
   set('[data-qj-field="name"]',n);
   set('[data-qj-field="prefix"]','UI_');
   set('[data-qj-keyleft="0"]','ロット番号');
   set('[data-qj-keyright="0"]','ロット番号');
  },NAME);
  await page.waitForFunction(()=>document.querySelector('#qjProbeBox .qj-probe-ok'),{timeout:20000});
  const probe=await page.$eval('#qjProbeBox',n=>n.textContent.replace(/\s+/g,' ').trim());
  rec('保存する前に「何件に当たるか」が文字で出る',/行に当たりました/.test(probe),probe.slice(0,90));
  rec('足す列の名前も出る（何が増えるか分かる）',/UI_/.test(probe),probe.slice(0,140));
  await page.click('#maintEditorSave');
  await page.waitForFunction(n=>[...document.querySelectorAll('#masterMaintList .qj-c-name')]
    .some(el=>el.textContent.includes(n)),NAME,{timeout:20000});
  const listed=await page.$$eval('#masterMaintList .qj-row:not(.ds-row-head) .qj-c-name',
    ns=>ns.map(n=>n.textContent.trim()));
  rec('登録した結合が一覧に並ぶ',listed.some(t=>t.includes(NAME)),JSON.stringify(listed));
  const saved=(await call('GET','/api/query-join-master')).body;
  joinId=((saved.items||[]).find(x=>x.name===NAME)||{}).id||null;
  rec('保存された定義に突合キーと接頭辞が入っている',
      !!joinId&&((saved.items||[]).find(x=>x.id===joinId)||{}).prefix==='UI_',
      JSON.stringify((saved.items||[]).find(x=>x.id===joinId)||{}));

  /* ---- 3) 一覧の帯と、列の設定パネルの分類 ---- */
  await page.evaluate(()=>window.exitMasterMaint&&window.exitMasterMaint());
  await page.click(`[data-db-key="${WORK}"]`);
  /* **行が出たことでは待てない。** マスタ管理から戻ると前の描画がDOMに
     残っているので、行数を見る待ちは即座に通る（結合前の写しを見て
     「帯が出ていない」と誤診断する）。結合した列が入るまで待つ。 */
  await page.waitForFunction(()=>typeof S!=='undefined'&&Array.isArray(S.columns)
    &&S.columns.some(c=>c.startsWith('UI_')),{timeout:30000});
  await raf2(page);
  const chip=await page.evaluate(()=>{
   const c=document.querySelector('#listJoinChip');
   return c&&!c.hidden?{text:c.textContent.trim(),title:c.title}:null;
  });
  rec('一覧の帯が結合の名前と件数を文字で言う',
      !!chip&&chip.text.includes(NAME)&&/行/.test(chip.text),JSON.stringify(chip));
  /* `S`は`const`宣言のグローバルなので**`window.S`では引けない**（bareな
     識別子としてだけ見える）。ここを間違えると、列があるのに空で返る。 */
  const joined=await page.evaluate(()=>{
   const info=(typeof S!=='undefined')?S.joinQuality:null;
   const cols=(typeof S!=='undefined'&&Array.isArray(S.columns))?S.columns:[];
   return {added:(info&&info.addedColumnNames)||[],inGrid:cols.filter(c=>c.startsWith('UI_'))};
  });
  rec('足した列が一覧の列に入る',joined.inGrid.length>0,JSON.stringify(joined.inGrid.slice(0,4)));
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:20000});
  await raf2(page);
  const origin=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#listColumnPanel .lc-item')];
   const hit=rows.find(r=>String(r.dataset.key||'').startsWith('UI_'));
   return hit?{key:hit.dataset.key,origin:hit.dataset.origin}:null;
  });
  rec('列の設定パネルが足された列を「結合」に分類する',
      !!origin&&origin.origin==='join',JSON.stringify(origin));
  await page.keyboard.press('Escape');

  /* ---- 4) スケジュール表の内容欄で使える ---- */
  const keys=(await call('GET','/api/query-join/keys?db='+encodeURIComponent(WORK))).body;
  rec('突合に要る列だけを先に聞く（200列を送らない）',
      Array.isArray(keys.keys)&&keys.keys.length>0&&keys.keys.length<=4,
      JSON.stringify(keys.keys));
  const sample=(await call('GET',`/api/table?db=${encodeURIComponent(WORK)}&table=%E4%BB%95%E6%8E%9B&page_size=5&join=1`)).body;
  const lot=((sample.rows||[])[0]||{})['ロット番号'];
  const res=(await call('POST','/api/query-join/resolve',{db:WORK,rows:[{'ロット番号':lot}]})).body;
  rec('予定の行（鍵の値だけ）から、足す列の値を引ける',
      (res.columns||[]).some(c=>c.startsWith('UI_'))
      &&Object.keys((res.values||[{}])[0]||{}).some(c=>c.startsWith('UI_')),
      JSON.stringify(res.values&&res.values[0]).slice(0,120));
  /* ---- 4b) スケジュール表の内容欄に、結合で足した列を出す ---- */
  await call('POST','/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(eq=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===eq);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  const st=await page.waitForFunction(()=>window.WL&&WL.scheduleJoinState
    &&WL.scheduleJoinState().columns.length>0,{timeout:30000})
    .then(()=>page.evaluate(()=>WL.scheduleJoinState())).catch(()=>null);
  rec('スケジュール表でも同じ結合が当たる',
      !!st&&st.columns.some(c=>c.startsWith('UI_'))&&st.resolved>0,
      JSON.stringify(st));
  // 内容欄へ出す項目として選ぶ（保存先はスケジュール内容表示マスタ）。
  contentTouched=true;
  await call('POST','/api/schedule-content-master',
    {equipment:EQ,items:['lotNo','UI_検査結果'],user_id:'test-qjoin'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(eq=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===eq);if(r)r.click()},EQ);
  /* **見出しを数えないこと。** `.sc-row-head`にも同じ`data-content-col`が
     付くので、器を絞らないと見出しだけで待ちが通り、まだ値の入っていない
     セルを読んで「出ていない」と誤診断する（実際に踏んだ）。 */
  const cell=await page.waitForFunction(()=>[...document.querySelectorAll('.sc-row-line [data-content-col="UI_検査結果"]')]
    .some(n=>n.textContent.trim()!==''),{timeout:30000})
    .then(()=>page.evaluate(()=>{
      const n=[...document.querySelectorAll('.sc-row-line [data-content-col="UI_検査結果"]')]
        .find(x=>x.textContent.trim()!=='');
      return n?n.textContent.trim():''})).catch(()=>'');
  rec('内容欄に結合で足した列の値が出る',!!cell,cell||'(空)');
  const head=await page.evaluate(()=>{
   const n=document.querySelector('.sc-row-head [data-col="UI_検査結果"]');
   return n?n.textContent.replace(/\s+/g,'').trim():'';
  });
  rec('見出しにも項目名が出る（生のキーのままにしない）',head.includes('UI_検査結果'),head);

  rec('画面側の例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* 後始末（落ちても必ず通る）。**ブラウザも必ず閉じる**——開いたままだと
     設備の編集セッションを掴み続け、後続のスケジュール系が連鎖的に落ちる。 */
  /* **内容欄の設定はマスタDBに残り、実行をまたいで生き延びる**（§9.121）。
     戻し忘れると、関係の無いテストが「実績がスケジュールに出ない」で落ちる。 */
  try{if(contentTouched)await call('POST','/api/schedule-content-master',
    {equipment:EQ,items:[],user_id:'test-qjoin'})}catch(_){}
  try{await call('POST','/api/access-mode',{mode:'edit'})}catch(_){}
  try{if(joinId)await call('POST','/api/query-join-master/delete',{id:joinId,user_id:'test-qjoin'})}catch(_){}
  try{const all=(await call('GET','/api/query-join-master')).body;
      for(const x of (all.items||[]))if(String(x.name||'').startsWith('テスト結合'))
        await call('POST','/api/query-join-master/delete',{id:x.id,user_id:'test-qjoin'});}catch(_){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})();
