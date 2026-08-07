/* 設備停止分類マスタ(§5.3.1)と入力支援(§9.49)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());

 const openTab=async key=>{
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:10000});
  await page.evaluate(k=>{const b=document.querySelector(`[data-master="${k}"]`);if(b)b.click()},key);
  await page.waitForTimeout(1200);
 };
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>{const el=document.querySelector('#masterUserId');if(el)el.value='test'});

 // ---- (1) 分類マスタのタブが存在し、既定の分類が入っている ----
 await openTab('stopCategory');
 await page.evaluate(()=>{const el=document.querySelector('#masterUserId');if(el)el.value='test'});
 const cats=await page.$$eval('#masterMaintList .mm-row',rs=>rs.map(r=>r.innerText.split('\n')[0].trim()));
 rec('設備停止分類マスタのタブがある',cats.length>0,cats.join('/'));
 rec('既定の分類(保全・段取り・待ち・突発)が入っている',
   ['保全','段取り','待ち','突発'].every(c=>cats.some(x=>x.includes(c))),cats.join('/'));

 // ---- (2) 設備停止マスタの「分類」が分類マスタ連動の選択欄になっている ----
 await openTab('stopReason');
 await page.evaluate(()=>{const el=document.querySelector('#masterUserId');if(el)el.value='test'});
 await page.click('#masterMaintAdd');
 await page.waitForSelector('#maintEditorModal:not([hidden])',{timeout:5000});
 await page.waitForTimeout(900);
 const combo=await page.evaluate(()=>{
  const sel=document.querySelector('[data-combo-select="category"]');
  if(!sel)return null;
  return {opts:[...sel.options].map(o=>o.value),hasNew:[...sel.options].some(o=>o.value==='__new__')};
 });
 rec('分類は自由入力ではなく一覧から選ぶ形になっている',!!combo,JSON.stringify(combo));
 rec('選択肢が分類マスタの登録値から作られる',
   !!combo&&['保全','段取り','待ち','突発'].every(c=>combo.opts.includes(c)),JSON.stringify(combo&&combo.opts));
 rec('「＋ 新しく追加」で未登録の分類も入れられる',!!combo&&combo.hasNew);

 // ---- (3) 標準所要分が上下ボタン付きの数値入力になっている ----
 const num=await page.evaluate(()=>{
  const wrap=document.querySelector('.mm-field-num [data-num-wrap]');
  if(!wrap)return null;
  const input=wrap.querySelector('.mm-num-input');
  return {btns:wrap.querySelectorAll('[data-num-step]').length,
          align:getComputedStyle(input).textAlign,
          unit:wrap.querySelector('.mm-num-unit')?.textContent||''};
 });
 rec('数値欄に増減ボタンが2つ付く',!!num&&num.btns===2,JSON.stringify(num));
 rec('数値は右づめで表示される',!!num&&num.align==='right',JSON.stringify(num));
 rec('単位が添えられる',!!num&&num.unit==='分',JSON.stringify(num));

 // 増減ボタンを押すと step(5) ずつ動く
 await page.click('.mm-field-num [data-num-step="1"]');
 await page.click('.mm-field-num [data-num-step="1"]');
 await page.click('.mm-field-num [data-num-step="1"]');
 const after3=await page.$eval('.mm-num-input',i=>i.value);
 rec('＋ボタン3回で5分刻みに増える',after3==='15',after3);

 // ---- (4) 未登録の分類を入力して保存すると分類マスタへ連動登録される ----
 const uniq='検査'+Date.now().toString().slice(-5);
 await page.selectOption('[data-combo-select="category"]','__new__');
 await page.fill('[data-combo-new="category"]',uniq);
 // 対象設備は単一選択のプルダウンから複数選択のタグ入力になった(§9.81)ので、
 // 候補を出してから選ぶ。
 await page.click('[data-equipment-search="equipment"]');
 await page.waitForTimeout(300);
 await page.click('[data-equipment-suggest="equipment"] [data-pick="テスト設備A"]');
 await page.fill('[data-field="name"]','連動テスト'+uniq);
 await page.click('#maintEditorSave');
 await page.waitForTimeout(2500);
 const catsAfter=await page.evaluate(async()=>{
  const r=await fetch('/api/schedule/stop-category-master').then(x=>x.json());
  return (r.items||[]).map(i=>i.name);
 });
 rec('未登録の分類が分類マスタへ自動登録される',catsAfter.includes(uniq),catsAfter.join('/'));

 // 分類マスタのタブを開き直すと、増えた分類が一覧に出る
 await openTab('stopCategory');
 const cats2=await page.$$eval('#masterMaintList .mm-row',rs=>rs.map(r=>r.innerText.split('\n')[0].trim()));
 rec('分類マスタの一覧にも反映される',cats2.some(c=>c.includes(uniq)),cats2.join('/'));

 // ---- (5) 使用中の分類は確認なしに消さない ----
 const del=await page.evaluate(async u=>{
  const list=await fetch('/api/schedule/stop-category-master').then(x=>x.json());
  const id=(list.items||[]).find(i=>i.name===u)?.id;
  const r=await fetch('/api/schedule/stop-category-master/delete',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({id,user_id:'test'})});
  return {status:r.status,body:await r.json()};
 },uniq);
 rec('使用中の分類は件数を示して削除を止める',
   del.status===409&&del.body.code==='stop_category_in_use',JSON.stringify(del));

 /* 後片付け: この2件を消してから先へ進む。設備停止マスタと分類マスタは
    共有DBではなく master.sqlite3 にあり、ランナーのフィクスチャ差し替え
    (仕掛/品質/共有スケジュール)では戻らない。**残すと実行のたびに増え続け**、
    設備停止マスタの一覧も分類の選択肢も「連動テスト検査…」で埋まる
    (実際に88件たまっていた)。使用中の分類は消せないので、停止理由が先。
    削除は業務仕様どおり論理削除なので、行そのものは残る(有効=0)。ここで
    確かめるのは「一覧・選択肢に出てこないこと」。 */
 await page.evaluate(async u=>{
  const post=(p,b)=>fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test'},b))});
  const rs=await fetch('/api/schedule/stop-reason-master').then(x=>x.json());
  for(const it of (rs.items||[])) if(it.name==='連動テスト'+u)
    await post('/api/schedule/stop-reason-master/delete',{id:it.id});
  const cs=await fetch('/api/schedule/stop-category-master').then(x=>x.json());
  for(const it of (cs.items||[])) if(it.name===u)
    await post('/api/schedule/stop-category-master/delete',{id:it.id});
 },uniq);
 const leftover=await page.evaluate(async u=>{
  const rs=await fetch('/api/schedule/stop-reason-master').then(x=>x.json());
  const cs=await fetch('/api/schedule/stop-category-master').then(x=>x.json());
  return {stop:(rs.items||[]).some(x=>x.name==='連動テスト'+u),
          cat:(cs.items||[]).some(x=>x.name===u)};
 },uniq);
 rec('検証で作ったデータを一覧・選択肢へ残さない',!leftover.stop&&!leftover.cat,JSON.stringify(leftover));

 // ---- (6) パス設定タブ: 参照ボタン・ドロップ領域・RNE状態表示 ----
 await openTab('pathConfig');
 const pc=await page.evaluate(()=>({
  browse:document.querySelectorAll('[data-path-browse]').length,
  drop:document.querySelectorAll('[data-path-drop]').length,
  nums:document.querySelectorAll('#masterMaintForm .mm-num-input').length,
  rne:!!document.querySelector('#rnePanel'),
  runBtn:!!document.querySelector('#rneRunBtn'),
 }));
 rec('パス欄に「参照…」ボタンが付く',pc.browse>=4,JSON.stringify(pc));
 rec('パス欄がドラッグ&ドロップを受け付ける',pc.drop>=4,JSON.stringify(pc));
 rec('間隔などの数値欄も増減ボタン付きになる',pc.nums>=3,JSON.stringify(pc));
 rec('RNE抽出の状態表示パネルがある',pc.rne&&pc.runBtn,JSON.stringify(pc));

 await page.waitForTimeout(1200);
 const rneText=await page.$eval('#rnePanel',e=>e.innerText.replace(/\n+/g,' | '));
 rec('抽出が停止中の理由と有効化の手順を画面に出す',
   /network|local/.test(rneText)&&/再起動/.test(rneText),rneText.slice(0,160));

 // 参照ダイアログが開き、サーバー側の実際のパスを辿れる
 await page.click('[data-path-browse="sikalotnow_path"]');
 await page.waitForSelector('#pathPickerModal:not([hidden])',{timeout:5000});
 await page.waitForTimeout(900);
 const picker=await page.evaluate(()=>({
  path:document.querySelector('#pathPickerPath')?.value||'',
  rows:document.querySelectorAll('.pathpick-row').length,
  places:document.querySelectorAll('.pathpick-place').length,
 }));
 rec('参照ダイアログがサーバー上の実際のパスを表示する',
   picker.path.startsWith('/')&&picker.rows>0,JSON.stringify(picker));
 rec('よく使う場所へワンクリックで飛べる',picker.places>0,JSON.stringify(picker));
 // フォルダを1つ潜って「選択」→ 入力欄へ実パスが入る
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.pathpick-row.is-dir')][0];if(r)r.click()});
 await page.waitForTimeout(800);
 await page.click('#pathPickerPick');
 await page.waitForTimeout(500);
 const filled=await page.$eval('[data-pc-field="sikalotnow_path"]',i=>i.value);
 rec('選んだ場所が入力欄へ入る(手入力不要)',filled.startsWith('/'),filled);

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
