const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let browser=null;
(async () => {
  browser = await chromium.launch({ executablePath: (process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const R=[]; const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
  page.on('dialog', d => d.accept());
  page.on('pageerror', e => console.log('  [pageerror]', e.message));

  await page.goto('http://127.0.0.1:5029/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#openMasterMaint', { timeout: 15000 });
  await page.evaluate(()=>localStorage.setItem('MeasurementUserIdV1','tester'));

  await page.evaluate(()=>fetch('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})}));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:15000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
  await page.fill('#masterUserId','tester');
  await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));

  const clickTab = async (label) => await page.evaluate(l => {
    const b=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes(l));
    if(b) b.click(); return !!b;
  }, label);

  /* オペレータマスタは操業データ選択肢マスタへ統合した（§9.221 ③）ので、
     モーダル方式の代表はアクセス権限マスタで見る。**見ているのは
     「編集専用モーダルの一周」そのもの**で、どのマスタかは本質ではない。 */
  // ---- モーダル経由の新規登録 (アクセス権限: equipment-multi-textを含むためモーダル) ----
  await clickTab('アクセス権限');
  await page.waitForTimeout(1000);
  const isModalDef = await page.evaluate(()=>({
    compact: document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    addBtn: !!document.querySelector('#masterMaintAdd'),
  }));
  rec('アクセス権限(タグ入力を含む)はモーダル方式に分類される', isModalDef.compact&&isModalDef.addBtn, JSON.stringify(isModalDef));

  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:5000});
  const name='tester'+Date.now().toString().slice(-5);
  await page.fill('#maintEditorForm [data-field="loginId"]', name);
  await page.fill('#maintEditorForm [data-field="pcName"]', 'PC-BEFORE');
  await page.click('#maintEditorSave');
  await page.waitForTimeout(2500);

  const saved = await page.evaluate(n => ({
    modalClosed: document.querySelector('#maintEditorModal').hidden,
    inList: document.querySelector('#masterMaintList').textContent.includes(n),
  }), name);
  rec('編集モーダルから新規登録するとモーダルが閉じ一覧へ反映される', saved.modalClosed&&saved.inList, JSON.stringify(saved));

  // サーバー側にも入っているか
  const onServer = await page.evaluate(async n => {
    const r = await fetch('/api/access-permission-master',{cache:'no-store'}).then(x=>x.json());
    return (r.items||[]).some(i=>i.loginId===n);
  }, name);
  rec('サーバー(master.sqlite3)にも保存されている', onServer);

  // ---- 行クリックでモーダル編集 ----
  await page.evaluate(n => {
    const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
    const row=rows.find(r=>r.textContent.includes(n));
    if(row) row.click();
  }, name);
  await page.waitForSelector('#maintEditorModal',{state:'visible',timeout:5000});
  const editOpen = await page.evaluate(()=>({
    title: document.querySelector('#maintEditorTitle')?.textContent,
    nameVal: document.querySelector('#maintEditorForm [data-field="loginId"]')?.value,
  }));
  rec('一覧の行クリックで編集モーダルが開き既存値が入る', editOpen.nameVal===name, JSON.stringify(editOpen));

  // 更新して保存
  await page.fill('#maintEditorForm [data-field="pcName"]','PC-AFTER');
  await page.click('#maintEditorSave');
  await page.waitForTimeout(2500);
  const updated = await page.evaluate(async n => {
    const r = await fetch('/api/access-permission-master',{cache:'no-store'}).then(x=>x.json());
    const it=(r.items||[]).find(i=>i.loginId===n);
    return it? it.pcName : null;
  }, name);
  rec('編集モーダルからの更新がサーバーへ反映される', updated==='PC-AFTER', 'pcName='+updated);

  // ---- インライン方式のマスタ(設備停止分類)も従来どおり登録できる ----
  await clickTab('設備停止分類');
  await page.waitForTimeout(900);
  const sname='分類'+Date.now().toString().slice(-5);
  await page.fill('#masterMaintForm [data-field="name"]', sname);
  await page.click('#masterMaintForm button[type="submit"]');
  await page.waitForTimeout(2200);
  const spoolOk = await page.evaluate(async n => {
    const r = await fetch('/api/schedule/stop-category-master',{cache:'no-store'}).then(x=>x.json());
    return (r.items||[]).some(i=>i.name===n);
  }, sname);
  rec('少項目マスタは従来どおりインラインフォームから登録できる', spoolOk);

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);
  console.log(`${R.length-f.length}/${R.length} passed`);
  if(f.length){console.log('FAILURES:');f.forEach(x=>console.log(' -',x.n,x.d||''))}
  await browser.close();
  process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(browser)await browser.close().catch(()=>{});
 process.exit(2);
});
