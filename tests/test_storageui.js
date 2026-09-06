/* test_storageui.js: 置き場を1枚で見せて、その場で直す（§9.267、利用者の指示
   「マスタの置き場、スケジュールの置き場、測定データの置き場、バックアップの
   置き場などを含めた全ての設定を共通設定に視覚的に表現した上でそのままその
   表示とリンクして設定を簡単にわかりやすく出来るように参照ボタンや
   ドラッグ&ドロップなど、使い勝手の良い機能も使って」）。

   固定するのは6つ。
    ① 置き場が**1枚**に出る（3群・本体3つが必ず居る）
    ② 直せる置き場には**欄と「参照…」とドロップ先**がその場にある
    ③ 直せないものは欄を出さない（押せるのに効かないものを残さない・§4）
    ④ 無い置き場には「作る」が出て、**下見を見るまで作らない**
    ⑤ `config/local.json` の4つも同じ画面から直せる（**画面の外に残さない**）
    ⑤' 保存は**保存値**を送る（効いている値を送り返して焼き付けない・§9.250 ⑩）
    ⑥ 測定データの保存の側に**同じ欄を2つ置かない**（§9.207 入口は1つ） */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
let b=null;
/* 検証で触るパス設定は必ず元へ戻す（§9.121。置き土産が次の実行を狂わせる）。 */
let savedShareDir=null;
const readShareDir=async()=>{
 const r=await (await fetch(B+'/api/path-config-master')).json();
 return String((r.values||{}).records_share_dir||'');
};
const writeShareDir=async v=>{
 await fetch(B+'/api/path-config-master',{method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({records_share_dir:v,user_id:'test_storageui'})});
};
(async()=>{
 await setMode('edit');
 savedShareDir=await readShareDir();
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 const tab=async label=>{await page.evaluate(l=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
   .find(x=>x.textContent.includes(l));if(t)t.click()},label);await page.waitForTimeout(2200)};
 /* 段は**名前で開く**（番号だと段が1つ増えただけで落ちる・§9.261）。 */
 const openSection=async label=>{await page.evaluate(l=>{
   const t=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')].find(x=>x.textContent.includes(l));
   if(t)t.click();},label);await page.waitForTimeout(600)};

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(1500);
 await page.click('#openMasterMaint');await page.waitForTimeout(1200);

 // ---- 前提: 無い置き場を1つ作っておく（「作る」の道を実際に通すため） ----
 // **材料は自分で注ぎ込む**——共有の置き場が設定済みの保証は無く、
 // 「無ければ素通り」の書き方だと直す前でも通ってしまう。
 const missing='/tmp/wl-storageui-'+Date.now()+'/records';
 await writeShareDir(missing);

 await tab('共通設定');
 await openSection('置き場');

 // ---- ① 1枚に出る ----
 const map=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.pc-store-row')].map(r=>({
    key:r.dataset.storeKey,
    label:(r.querySelector('.pc-store-label')||{}).textContent||'',
    exists:(r.querySelector('.pc-store-exists')||{}).textContent||'',
    kind:(r.querySelector('.pc-store-kind')||{}).textContent||'',
    input:!!r.querySelector('input[data-field]'),
    browse:!!r.querySelector('.mm-path-browse'),
    drop:!!r.querySelector('[data-path-drop]'),
    make:!!r.querySelector('[data-pc-make]'),
    visible:!!r.offsetParent}));
  return {rows,
    groups:[...document.querySelectorAll('.pc-store-group')].map(g=>g.dataset.storeGroup),
    lc:[...document.querySelectorAll('[data-lc-field]')].map(x=>x.dataset.lcField)};
 });
 const byKey=k=>map.rows.find(r=>r.key===k)||{};
 rec('置き場が1枚に出る（本体3つが必ず居る）',
   ['master','schedule','recordsShare'].every(k=>byKey(k).key),
   map.rows.map(r=>r.key).join(','));
 rec('群は3つ（この端末の中／みんなで使う／読むだけ）',
   map.groups.join(',')==='terminal,share,read',map.groups.join(','));
 rec('置き場の種類を文字で出す（色だけで伝えない）',
   map.rows.filter(r=>r.kind).length>=3,
   map.rows.map(r=>r.key+':'+r.kind).join(' '));
 rec('在るかどうかも文字で出す',
   map.rows.every(r=>r.exists),map.rows.map(r=>r.key+':'+r.exists).join(' '));
 rec('全部の行が見えている（畳んだ段の中に隠れていない）',
   map.rows.every(r=>r.visible),String(map.rows.filter(r=>!r.visible).length));

 // ---- ② 直せる置き場は、その場に欄と参照…とドロップ先がある ----
 rec('直せる置き場は欄・参照…・ドロップ先がその場にある',
   ['master','schedule','recordsShare'].every(k=>byKey(k).input&&byKey(k).browse&&byKey(k).drop),
   JSON.stringify(['master','schedule','recordsShare'].map(k=>({k,...byKey(k)}))));
 // ---- ③ 直せないものは欄を出さない ----
 rec('直せないものに欄を出さない（作り直せるファイル）',
   byKey('work').key&&!byKey('work').input&&!byKey('work').make,
   JSON.stringify(byKey('work')));

 // ---- ④ 無い置き場には「作る」が出て、下見を見るまで作らない ----
 rec('前提: 共有の測定データの置き場が「まだありません」になっている',
   byKey('recordsShare').exists.includes('まだ'),byKey('recordsShare').exists);
 rec('無い置き場には「作る」が出る',byKey('recordsShare').make===true,
   JSON.stringify(byKey('recordsShare')));
 rec('在る置き場には「作る」を出さない（在るものを作りに行ったように見せない）',
   byKey('master').make===false,JSON.stringify(byKey('master')));
 /* **下見は1つも作らない**——サーバー側は`test_storage.py`が見ているので、
    ここは「押すと確認の窓が出て、そこに作るものが並ぶ」ことを見る。 */
 await page.evaluate(()=>document.querySelector('[data-pc-make]').click());
 await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:15000});
 const cfm=await page.evaluate(()=>({
   title:(document.querySelector('#appConfirmTitle')||{}).textContent||'',
   items:[...document.querySelectorAll('.pc-make-list code')].map(x=>x.textContent),
   ok:(document.querySelector('#appConfirmOk')||{}).textContent||''}));
 rec('押すと「何を作るか」を1つずつ並べて確認する',
   cfm.items.length>0&&/作る/.test(cfm.ok),JSON.stringify(cfm));
 rec('確認には作られるパスそのものが出る',
   cfm.items.some(x=>x.includes('records')),cfm.items.join(' / '));
 await page.click('#appConfirmCancel');await page.waitForTimeout(400);
 const stillMissing=await (await fetch(B+'/api/storage-layout')).json();
 rec('キャンセルしたら1つも作らない',
   (stillMissing.items||[]).find(x=>x.key==='recordsShare').exists===false,
   JSON.stringify((stillMissing.items||[]).find(x=>x.key==='recordsShare')||{}));

 // ---- ⑤ config/local.json の4つも同じ画面から直せる ----
 rec('config/local.json の4つも同じ画面に出る（画面の外に残さない）',
   ['db_dir','master_db_path','records_db_path','master_share_mode']
     .every(k=>map.lc.includes(k)),map.lc.join(','));
 const lcInfo=await page.evaluate(()=>{
  const el=document.querySelector('[data-lc-field="master_db_path"]');
  const row=el&&el.closest('.pc-store-row');
  return {value:el?el.value:null,
    tag:row?[...row.querySelectorAll('.pc-store-tag')].map(x=>x.textContent).join('/'):'',
    foot:row?(row.querySelector('.pc-store-foot')||{}).textContent||'':''};
 });
 /* **保存値を出す**——効いている値を欄へ入れると、画面が送り返すだけで
    値が焼き付く（§9.250 ⑩と同じ形）。 */
 rec('欄に出るのは保存値（効いている値ではない）',lcInfo.value==='',JSON.stringify(lcInfo));
 rec('いま効いている値は欄の外に出す',/いま:/.test(lcInfo.foot),lcInfo.foot.slice(0,80));
 rec('この端末だけの設定だと文字で言う',/この端末だけ/.test(lcInfo.tag),lcInfo.tag);
 rec('効くタイミングを書く（再起動）',/再起動/.test(lcInfo.foot),lcInfo.foot.slice(0,80));

 // ---- ⑤* 同じ設定の欄を画面に2つ置かない（§9.207 入口は1つ） ----
 /* 保存は `#masterMaintForm` の `[data-pc-field]` を**全部**集めるので、
    同じ鍵の欄が2つあるとDOM順で後の側が勝つ＝どちらが効くのか分からなくなる。
    実際に `rne_assets_dir` が置き場の行とRNE抽出の節の両方に出ていた。 */
 const dup=await page.evaluate(()=>{
  const seen={};
  document.querySelectorAll('#masterMaintForm [data-pc-field]').forEach(e=>{
   const k=e.dataset.pcField;(seen[k]=seen[k]||[]).push(e.closest('.pc-store-row')?'置き場':'節');
  });
  const lc={};
  document.querySelectorAll('#masterMaintForm [data-lc-field]').forEach(e=>{
   const k=e.dataset.lcField;lc[k]=(lc[k]||0)+1;
  });
  return {pc:Object.entries(seen).filter(([,v])=>v.length>1),
          lc:Object.entries(lc).filter(([,n])=>n>1)};
 });
 rec('同じ設定の欄を画面に2つ置かない',
   dup.pc.length===0&&dup.lc.length===0,JSON.stringify(dup));
 /* 欄を1つに絞ったぶん、**直す場所へは連れて行く**（§4。押せるのに
    効かない欄を残さない代わりに、行き先を必ず出す）。 */
 const roRow=await page.evaluate(()=>{
  const r=document.querySelector('[data-store-key="rneAssets"]');
  return r?{input:!!r.querySelector('input[data-field]'),
            jump:!!r.querySelector('[data-pc-jump],[data-pc-goto]')}:null;
 });
 rec('欄を持たない置き場は、直す場所へ連れて行く',
   !roRow||(!roRow.input&&roRow.jump),JSON.stringify(roRow));

 // ---- ⑤'' マスタの一言は共有かどうかで違う（旧 test_pcshare より・§9.263） ----
 // **置いていない端末に「共有で動いています」と書かない。**
 const mNote=await page.evaluate(()=>{
  const r=document.querySelector('[data-store-key="master"]');
  return (r&&(r.querySelector('.pc-store-note')||{}).textContent||'').trim();
 });
 rec('マスタの置き場の状態を文で書く',
   /この端末の中だけ|共有で動いています/.test(mNote),mNote.slice(0,60));
 rec('共有へ移したらどうなるかを書く',/順番待ち/.test(mNote),mNote.slice(0,60));

 // ---- ⑤''' 判定はサーバーが持つ（§9.163。旧 test_pcshare より） ----
 const srv=await (await fetch(B+'/api/storage-layout')).json();
 rec('サーバーが置き場の一覧を答える',(srv.items||[]).length>=6,String((srv.items||[]).length));
 rec('サーバーが種類・在るか・効くタイミングを答える',
   (srv.items||[]).every(x=>'kind' in x&&'exists' in x&&x.when),
   JSON.stringify((srv.items||[])[0]||{}).slice(0,120));
 /* **画面のJSに判定を書き写していないこと**——2つの答えが出ると、
    片方だけ直した状態が作れる。 */
 /* §9.324 R3: 共通設定の画面は master-data.js（定義は master-defs.js）。 */
 const js=(await Promise.all(['master/master-defs','master/master-maint','master/master-data']
   .map(n=>fetch(B+'/static/js/'+n+'.js').then(r=>r.text()))).catch(()=>[])).join('\n');
 if(js.length<20000)throw new Error('画面のJSを読めていない（取れた長さ '+js.length
   +'）——空の材料では「書き写していない」が必ず通る');
 rec('画面のJSにUNC判定を書き写していない',
   js.length>0&&!/is_network_path|startsWith\('\\\\\\\\'\)/.test(js),
   js.length?'ok':'JSを読めませんでした');

 // ---- ⑥ 入口は1つ（測定データの保存の側に同じ欄を置かない） ----
 await tab('測定データの保存');
 await openSection('置き場と引っ越し');
 const ms=await page.evaluate(()=>({
   oldInput:!!document.querySelector('#msShareDir'),
   oldExport:!!document.querySelector('#msExportPath'),
   goto:!!document.querySelector('[data-ms-goto]'),
   where:(document.querySelector('.ms-where-path')||{}).textContent||''}));
 rec('測定データの保存に同じ欄を置かない（入口は1つ）',
   !ms.oldInput&&!ms.oldExport,JSON.stringify(ms));
 rec('いまの置き場は書き、直す場所へ連れて行く',
   ms.goto&&ms.where.length>0,JSON.stringify(ms));
 /* **連れて行った先が「置き場」の段であること**まで見る（§2。共通設定を
    開くだけだと、置き場の段を自分で探すことになる）。 */
 await page.evaluate(()=>document.querySelector('[data-ms-goto]').click());
 await page.waitForTimeout(2600);
 const landed=await page.evaluate(()=>{
  const t=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')]
    .find(x=>x.getAttribute('aria-selected')==='true'||x.classList.contains('is-on'));
  return {tab:t?t.textContent.trim():'',rows:document.querySelectorAll('.pc-store-row').length,
    visible:[...document.querySelectorAll('.pc-store-row')].filter(r=>r.offsetParent).length};
 });
 rec('連れて行った先が「置き場」の段',
   /置き場/.test(landed.tab)&&landed.visible>0,JSON.stringify(landed));
})().catch(e=>{rec('FATAL',false,e.message)}).finally(async()=>{
 /* **後片付け**——検証で入れたパス設定を必ず戻す（§9.121）。 */
 try{if(savedShareDir!==null)await writeShareDir(savedShareDir)}catch(e){}
 if(b)await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');
 console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
});
