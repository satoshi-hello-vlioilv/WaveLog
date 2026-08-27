/* test_master.js: マスタ管理の画面（統合パネル・タブ・編集の一周）

   ============================================================
   3本を1本へまとめた（§9.249 ④、利用者の指示「重複しているテストは統合
   できるか確認し必要に応じて統合して最適化してください」）
   ------------------------------------------------------------
   `test_p11.js`（統合パネルとタブ）・`test_p11c.js`（編集モーダルの一周）・
   `test_master.js`（群の見出しと列幅）は、**どれもマスタ管理を開くために
   ブラウザを立ち上げ、同じ起動を待っていた**。しかも名前の「p11」は
   当時の作業フェーズ番号で、中身が何かを言っていない。

   まとめても**1件も落としていない**。唯一減らしたのは
   「ヘッダーのコントロール高さが全て同一」——同じことを
   `test_headbar.js`（ヘッダーの全コントロールが同じ高さ）が見ているので、
   ヘッダーの約束はあちらへ寄せた。

   ここで固定すること
   ------------------------------------------------------------
    ① 形     … メイン画面へ統合（シェード無し・一覧は隠れる）／群の見出しで
                階層化／横スクロールが出ない／監査列の出し分け
    ② 分類   … 少項目マスタはインライン、多項目・タグ入力はモーダル
    ③ 一周   … モーダルから登録→一覧とサーバーへ反映→行クリックで編集→更新、
                インラインからの登録も通る
    ④ 生データ … 専用タブを持たない表もここで中身が読める
   **後始末を必ずする**（§9.121）——旧`test_p11c.js`は登録した行を消して
   おらず、実行のたびにアクセス権限マスタと分類マスタが1行ずつ増えていた。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p,{cache:'no-store'}).then(r=>r.json());
let b=null;
const made={perm:[],cat:[]};

(async()=>{
 await post('/api/access-mode',{mode:'edit'});
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1400,height:900}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>{errs.push(e.message);console.log('  [pageerror]',e.message)});
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('MeasurementUserIdV1','tester'));

  /* ---- ① 形: メイン画面へ統合されている（旧 test_p11） ---- */
  rec('サイドバーにMASTER(マスタ一覧)の独立ナビが無い',
      (await page.$$('aside [data-db-key="MASTER"]')).length===0);
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  await page.fill('#masterUserId','tester');
  await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
  await page.waitForTimeout(900);
  const integ=await page.evaluate(()=>({
    mmMode:document.body.classList.contains('mm-mode'),
    panelInMain:!!document.querySelector('main > #masterMaintPanel'),
    noShade:!document.querySelector('#masterMaintModal'),
    navActive:document.getElementById('openMasterMaint')?.classList.contains('active'),
    gridHidden:getComputedStyle(document.querySelector('#grid')).display==='none',
  }));
  rec('body.mm-mode + パネルがmain内 + シェード無し + ナビactive',
      integ.mmMode&&integ.panelInMain&&integ.noShade&&integ.navActive,JSON.stringify(integ));
  rec('統合表示中は一覧グリッドが隠れる',integ.gridHidden);

  /* 群は**固定の3つ＋サーバーが答える2つ**（§9.249 ②）。あとの2つ
     （内部データ／移行済み）は master.sqlite3 に該当する表があるときだけ出るので、
     **数で固定しない**——先頭3つの並びと、余分な群が出ていないことを見る。 */
  const g=await page.$$eval('.mm-nav-group-label',ns=>ns.map(n=>n.textContent));
  const KNOWN=['設備・人','作業スケジュール','表示・システム','内部データ','移行済み'];
  rec('マスタ種別がグループ見出しで階層化される',
    g.slice(0,3).join('/')==='設備・人/作業スケジュール/表示・システム'
    &&g.every(x=>KNOWN.includes(x)),g.join('/'));
  const inSchedGroup=await page.evaluate(()=>{
   const grp=[...document.querySelectorAll('.mm-nav-group')].find(x=>x.querySelector('.mm-nav-group-label')?.textContent==='作業スケジュール');
   return grp?[...grp.querySelectorAll('[data-master]')].map(b=>b.dataset.master):[];
  });
  rec('スケジュール系マスタが同じグループに集まる',
    ['stopReason','shiftMaster','loadFactor'].every(k=>inSchedGroup.includes(k)),inSchedGroup.join(','));
  const navLabels=await page.$$eval('#masterMaintNav [data-master]',bs=>bs.map(b=>b.textContent.trim()));
  rec('マスタ種別タブに「テーブル生データ」が統合されている',
      navLabels.some(t=>t.includes('テーブル生データ')),navLabels.join('/'));

  /* ラベルは完全一致を優先する。「設備停止」と「設備停止分類」のように
     前方一致で衝突するタブがあるため、includesだけだと別のタブを押してしまう。 */
  const clickTab=async label=>await page.evaluate(l=>{
    const tabs=[...document.querySelectorAll('#masterMaintNav [data-master]')];
    const name=x=>(x.querySelector('.mm-nav-label')||x).textContent.trim();
    const btn=tabs.find(x=>name(x)===l)||tabs.find(x=>name(x).includes(l));
    if(btn)btn.click();return !!btn;
  },label);

  // 横スクロールが出ないこと(列数の多いアクセス権限マスタで確認)
  await clickTab('アクセス権限');
  await page.waitForTimeout(1200);
  const ov=await page.evaluate(()=>{
   const w=document.querySelector('.mm-list-wrap'),p=document.querySelector('#masterMaintPanel');
   return {listScrollW:w.scrollWidth,listClientW:w.clientWidth,
           panelScrollW:p.scrollWidth,panelClientW:p.clientWidth,
           bodyScrollW:document.body.scrollWidth,bodyClientW:document.body.clientWidth,
           cols:document.querySelectorAll('.mm-row.head>span').length};
  });
  rec('列数の多いマスタでも一覧に横スクロールが出ない',ov.listScrollW<=ov.listClientW+1,JSON.stringify(ov));
  rec('画面全体にも横スクロールが出ない',ov.bodyScrollW<=ov.bodyClientW+1,`body ${ov.bodyScrollW}/${ov.bodyClientW}`);
  rec('列数が多いマスタでは更新者/更新日時を列から外す(6項目+操作=7)',ov.cols===7,'head spans='+ov.cols);

  /* ---- ③ 一周: モーダルから登録→一覧とサーバー→行クリックで編集→更新（旧 test_p11c） ----
     モーダル方式の代表はアクセス権限マスタ（equipment-multi-textを含む）。
     **見ているのは「編集専用モーダルの一周」そのもの**で、どのマスタかは本質ではない。 */
  const isModalDef=await page.evaluate(()=>({
    compact:document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    addBtn:!!document.querySelector('#masterMaintAdd'),
  }));
  rec('アクセス権限(タグ入力を含む)はモーダル方式に分類される',
      isModalDef.compact&&isModalDef.addBtn,JSON.stringify(isModalDef));
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:8000});
  const name='tester'+Date.now().toString().slice(-6);
  await page.fill('#maintEditorForm [data-field="loginId"]',name);
  await page.fill('#maintEditorForm [data-field="pcName"]','PC-BEFORE');
  await page.click('#maintEditorSave');
  await page.waitForTimeout(2500);
  const saved=await page.evaluate(n=>({
    modalClosed:document.querySelector('#maintEditorModal').hidden,
    inList:document.querySelector('#masterMaintList').textContent.includes(n),
  }),name);
  rec('編集モーダルから新規登録するとモーダルが閉じ一覧へ反映される',
      saved.modalClosed&&saved.inList,JSON.stringify(saved));
  let perm=(await get('/api/access-permission-master')).items||[];
  const mine=perm.find(i=>i.loginId===name);
  if(mine)made.perm.push(mine.id);
  rec('サーバー(master.sqlite3)にも保存されている',!!mine);

  await page.evaluate(n=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
   const row=rows.find(r=>r.textContent.includes(n));
   if(row)row.click();
  },name);
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:8000});
  const editOpen=await page.evaluate(()=>({
    title:document.querySelector('#maintEditorTitle')?.textContent,
    nameVal:document.querySelector('#maintEditorForm [data-field="loginId"]')?.value,
  }));
  rec('一覧の行クリックで編集モーダルが開き既存値が入る',editOpen.nameVal===name,JSON.stringify(editOpen));
  await page.fill('#maintEditorForm [data-field="pcName"]','PC-AFTER');
  await page.click('#maintEditorSave');
  await page.waitForTimeout(2500);
  perm=(await get('/api/access-permission-master')).items||[];
  const updated=(perm.find(i=>i.loginId===name)||{}).pcName;
  rec('編集モーダルからの更新がサーバーへ反映される',updated==='PC-AFTER','pcName='+updated);

  /* ---- ② 分類: 少項目マスタはインライン（旧 test_p11 / test_p11c） ----
     少項目マスタの代表は**設備停止分類**（1項目）。スプール種別マスタは
     §9.221 ③で操業データ選択肢マスタへ統合して撤去した。 */
  await clickTab('設備停止分類');
  await page.waitForFunction(
    ()=>document.querySelectorAll('#masterMaintForm [data-field]').length>0,null,{timeout:15000});
  const inline=await page.evaluate(()=>({
    compact:document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    fieldCount:document.querySelectorAll('#masterMaintForm [data-field]').length,
    labels:[...document.querySelectorAll('.mm-row.head>span')].map(s=>s.textContent),
  }));
  rec('少項目マスタ(設備停止分類1項目)は従来どおり上部インラインフォーム',
      inline.compact===false&&inline.fieldCount>0,JSON.stringify({c:inline.compact,f:inline.fieldCount}));
  rec('列数が少ないマスタでは更新者・更新日時も列として出す',
      inline.labels.includes('更新者')&&inline.labels.includes('更新日時'),inline.labels.join(','));
  const sname='分類'+Date.now().toString().slice(-6);
  await page.fill('#masterMaintForm [data-field="name"]',sname);
  await page.click('#masterMaintForm button[type="submit"]');
  await page.waitForTimeout(2200);
  const cats=(await get('/api/schedule/stop-category-master')).items||[];
  const cat=cats.find(i=>i.name===sname);
  if(cat)made.cat.push(cat.id);
  rec('少項目マスタは従来どおりインラインフォームから登録できる',!!cat);

  /* ---- ② 分類: 多項目マスタはモーダル（旧 test_p11） ---- */
  await clickTab('設備停止');
  await page.waitForFunction(
    ()=>document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact')
        &&!!document.querySelector('#masterMaintAdd'),null,{timeout:15000});
  const modal=await page.evaluate(()=>({
    compact:document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    inlineFields:document.querySelectorAll('#masterMaintForm [data-field]').length,
    addBtn:!!document.querySelector('#masterMaintAdd'),
  }));
  rec('多項目マスタ(設備停止4項目)は上部フォームを畳み追加ボタンのみ',
      modal.compact===true&&modal.inlineFields===0&&modal.addBtn,JSON.stringify(modal));
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:8000});
  /* 数えるのは入力欄の器(.mm-field)。専用コントロール(設備の複数選択タグ入力
     など)は素の [data-field] を持たないので、そちらで数えると項目が
     入れ替わるたびに数が合わなくなる(§9.81で対象設備がタグ入力になった)。 */
  const editor=await page.evaluate(()=>({
    fields:document.querySelectorAll('#maintEditorForm .mm-field').length,
    title:document.querySelector('#maintEditorTitle')?.textContent,
  }));
  rec('編集専用モーダルが開き4項目すべて表示',editor.fields===4,JSON.stringify(editor));
  await page.click('#maintEditorCancel');
  await page.waitForTimeout(300);
  rec('編集モーダルを閉じられる',await page.evaluate(()=>document.querySelector('#maintEditorModal').hidden));

  /* ---- ④ 生データ（旧 test_p11 / test_master） ---- */
  await clickTab('テーブル生データ');
  await page.waitForFunction(
    ()=>document.querySelectorAll('.mm-raw-table thead th').length>0,null,{timeout:15000});
  const raw=await page.evaluate(()=>({
    sel:!!document.querySelector('#rawTableSelect'),
    tables:[...(document.querySelector('#rawTableSelect')?.options||[])].map(o=>o.value),
    table:!!document.querySelector('.mm-raw-table'),
    cols:document.querySelectorAll('.mm-raw-table thead th').length,
  }));
  rec('テーブル生データタブでmaster.sqlite3の表を閲覧できる',
      raw.sel&&raw.tables.length>0&&raw.table&&raw.cols>0,
      JSON.stringify({n:raw.tables.length,cols:raw.cols}));
  rec('設備停止・勤務形態・稼働カレンダー・換算係数がmaster.sqlite3に統合された',
    ['設備停止マスタ','勤務形態マスタ','稼働カレンダーマスタ','負荷率上書きマスタ']
      .every(t=>raw.tables.includes(t)),raw.tables.join(','));

  /* ---- ① 形: 他ナビへ移ると閉じる（旧 test_p11） ---- */
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await page.waitForTimeout(1200);
  rec('他のサイドバー項目を押すとマスタ管理から出る',
      await page.evaluate(()=>!document.body.classList.contains('mm-mode')&&document.querySelector('#masterMaintPanel').hidden));

  /* ---- 左ナビの寸法（旧 test_p11）。**ヘッダーの寸法は見ない**——
     同じことを test_headbar.js が見ている（§9.249 ④）。 ---- */
  const sizes=await page.evaluate(()=>{
   const h=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):null};
   return {
    navItem:h('#openSchedule'),navItem2:h('#openMasterMaint'),
    // --ctl-hはcalc()式なので、実際に解決された高さで比べる
    ctlH:(()=>{const d=document.createElement('div');d.style.height='var(--ctl-h)';document.body.appendChild(d);
               const v=Math.round(d.getBoundingClientRect().height);d.remove();return v})(),
   };
  });
  rec('左ナビ項目の高さが揃っている',sizes.navItem===sizes.navItem2,JSON.stringify(sizes));
  rec('ナビ項目の高さ=--ctl-hトークン',sizes.navItem===sizes.ctlH,sizes.navItem+' vs '+sizes.ctlH);
  rec('初期表示でエラーが出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。master.sqlite3は実行をまたいで生き延びるので、
     足した行は必ず消す（旧 test_p11c は消しておらず、実行のたびに増えていた）。 */
  for(const id of made.perm){try{await post('/api/access-permission-master/delete',{id,user_id:'tester'})}catch(e){}}
  for(const id of made.cat){try{await post('/api/schedule/stop-category-master/delete',{id,user_id:'tester'})}catch(e){}}
  if(b)await b.close().catch(()=>{});
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');
 console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
