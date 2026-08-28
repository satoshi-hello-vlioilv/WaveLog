/* test_pcshare.js: 共有の置き場を1枚で見せる（§9.260）
   ============================================================
   利用者の指示:
     「マスタの管理画面の共有設定の部分も今回の改良に合わせて
      設定しやすいようにわかりやすく作り替えてほしいです。」

   共有の設定は3つ（作業予定・測定データ・マスタ）あるのに、**直す場所も
   効くタイミングも別々**で、画面の3箇所に散っていた。マスタに至っては
   画面のどこにも出ておらず、いまどこにあるのかを確かめる手立てが無かった。

   ここで固定すること。
    1. 共通設定の「共有の置き場」に3つとも並ぶ（作業予定・測定データ・マスタ）
    2. **いまどこにあるか**が実際のパスで出る（推測させない）
    3. 置き場の種類（共有／この端末の中）を**文字で**言う（§3。色だけにしない）
    4. **直す場所と効くタイミング**を行ごとに書く（§6）
    5. 直せない行は理由を書く（§4）——マスタは config/local.json だけ、
       しかもこの版では共有に対応していないこと
    6. 「ここを開く」で直す場所へ飛べる（探させない）
    7. 判定はサーバーが持つ（§9.163）——画面のJSに「UNCかどうか」の
       判定を書き写していない
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
let b=null;

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master]',{timeout:30000});
  /* タブは**見出しの言葉で開く**（キーで探すと、名前を変えただけで落ちる）。 */
  const tab=async label=>{
   await page.evaluate(l=>{
    const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.textContent.includes(l));if(t)t.click();},label);
  };
  await tab('共通設定');
  /* 章は**段（タブ）**になった（§9.261）。共有の置き場はその1つ。
     **段の名前で開くこと**（番号で探すと段が増えただけで落ちる）。 */
  await page.waitForSelector('#masterMaintForm .mm-tab',{timeout:30000});
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#masterMaintForm .mm-tab')]
    .find(e=>e.textContent.includes('共有の置き場'));
   if(t)t.click();
  });
  await page.waitForSelector('#pcShareRows .pc-share-row',{timeout:30000});

  const rows=await page.evaluate(()=>[...document.querySelectorAll('#pcShareRows .pc-share-row')]
   .map(r=>({what:(r.querySelector('.pc-share-what')?.textContent||'').trim(),
             kind:(r.querySelector('.pc-share-kind')?.textContent||'').trim(),
             path:(r.querySelector('.pc-share-path')?.textContent||'').trim(),
             where:(r.querySelector('.pc-share-where')?.textContent||'').trim(),
             note:(r.querySelector('.pc-share-note')?.textContent||'').trim(),
             jump:!!r.querySelector('[data-pc-goto]'),
             shared:r.classList.contains('is-shared')})));

  /* ---- 1) 3つとも並ぶ ---- */
  rec('共有の置き場に3つとも並ぶ',rows.length===3,rows.length+'行');
  const has=w=>rows.some(r=>r.what.includes(w));
  rec('作業予定が並ぶ',has('作業予定'));
  rec('測定データが並ぶ',has('測定データ'));
  rec('マスタが並ぶ（今まで画面のどこにも無かった）',has('マスタ'));

  /* ---- 2) いまどこにあるかが実際のパスで出る ---- */
  const recRow=rows.find(r=>r.what.includes('測定データ'));
  const mRow=rows.find(r=>r.what.includes('マスタ'));
  rec('測定データの実際のパスが出る',/records\.sqlite3|\\|\//.test(recRow.path),recRow.path);
  rec('マスタの実際のパスが出る',/master\.sqlite3/.test(mRow.path),mRow.path);
  rec('ファイル名も出る（何が置かれるかが分かる）',
      /records\.sqlite3/.test(recRow.what)&&/master\.sqlite3/.test(mRow.what),
      recRow.what+' / '+mRow.what);

  /* ---- 3) 置き場の種類を文字で言う（色だけにしない） ---- */
  rec('置き場の種類が文字で出る',rows.every(r=>r.kind.length>0),
      rows.map(r=>r.kind).join(' / '));
  rec('この端末の中にあることが文字で分かる',/この端末/.test(recRow.kind),recRow.kind);

  /* ---- 4) 直す場所と効くタイミング ---- */
  rec('行ごとに直す場所が書いてある',rows.every(r=>/直す場所/.test(r.where)),
      rows.map(r=>r.where.slice(0,20)).join(' | '));
  rec('行ごとに効くタイミングが書いてある',rows.every(r=>/反映/.test(r.where)));

  /* ---- 5) 直せない行は理由を書く ---- */
  rec('マスタは直す場所がconfig/local.jsonだと書いてある',
      /local\.json/.test(mRow.where),mRow.where);
  /* マスタの一言は**共有に置いたときと置いていないときで違う**（§9.263）。
     置いていない端末に「共有で動いています」と書かないこと。 */
  rec('マスタの置き場の状態が文で書いてある',
      /この端末の中だけ|共有で動いています/.test(mRow.note),mRow.note.slice(0,60));
  rec('共有へ移したときどうなるかが書いてある',
      /順番待ち/.test(mRow.note),mRow.note.slice(0,60));

  /* ---- 6) 直す場所へ飛べる ---- */
  rec('測定データの行から直す場所へ飛べる',recRow.jump===true);
  await page.evaluate(()=>document.querySelector('#pcShareRows [data-pc-goto]').click());
  /* 飛んだ先も段（タブ）なので、**器が出ることで見る**——置き場の欄は
     「置き場と引っ越し」の段にあり、開くまでは見えない（DOMには在る）。 */
  await page.waitForSelector('#masterMaintForm .ms-flow',{timeout:20000});
  const moved=await page.evaluate(()=>({
   here:!!document.getElementById('msShareDir'),
   tabs:[...document.querySelectorAll('#masterMaintForm .mm-tab')].map(x=>x.textContent.trim()),
  }));
  rec('押すと「測定データの保存」が開く',moved.here===true,JSON.stringify(moved.tabs));

  /* ---- 7) 判定はサーバーが持つ ---- */
  const srv=await fetch(B+'/api/path-config-master').then(r=>r.json());
  const sl=(srv.active||{}).share_layout||{};
  rec('サーバーが置き場の一覧を答える',(sl.items||[]).length===3,String((sl.items||[]).length));
  rec('サーバーが置き場の種類を答える',(sl.items||[]).every(x=>'kind' in x));
  rec('サーバーが直す場所と効くタイミングを答える',
      (sl.items||[]).every(x=>x.where&&x.when));
  /* **画面のJSに判定を書き写していないこと**——2つの答えが出ると、
     片方だけ直した状態が作れる（§9.163）。 */
  const js=await fetch(B+'/js/master-maint.js').then(r=>r.text()).catch(()=>'');
  rec('画面のJSにUNC判定を書き写していない',
      js.length>0&&!/is_network_path|startsWith\('\\\\\\\\'\)/.test(js),
      js.length?'ok':'JSを読めませんでした');
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({n:'FATAL',ok:false,d:String(e&&e.message||e)});
 }finally{ if(b)await b.close() }
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');
 console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' - '+x.n+(x.d?' '+x.d:'')));
 process.exit(ng.length?1:0);
})();
