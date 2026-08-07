const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let browser=null;
(async () => {
  browser = await chromium.launch({ executablePath: (process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome') });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const R=[]; const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
  page.on('dialog', d => d.accept());
  const errs=[];
  page.on('pageerror', e => { errs.push(e.message); console.log('  [pageerror]', e.message); });
  page.on('console', m => { if(m.type()==='error') console.log('  [console.error]', m.text()); });

  await page.goto('http://127.0.0.1:5029/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#openMasterMaint', { timeout: 15000 });
  rec('app loaded', true);

  // ===== (1) マスタ管理がメイン画面統合型 =====
  rec('サイドバーにMASTER(マスタ一覧)の独立ナビが無い',
      (await page.$$('aside [data-db-key="MASTER"]')).length===0);

  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel', { state:'visible', timeout: 8000 });
  const integ = await page.evaluate(() => ({
    mmMode: document.body.classList.contains('mm-mode'),
    panelInMain: !!document.querySelector('main > #masterMaintPanel'),
    noShade: !document.querySelector('#masterMaintModal'),
    navActive: document.getElementById('openMasterMaint')?.classList.contains('active'),
    gridHidden: getComputedStyle(document.querySelector('#grid')).display==='none',
  }));
  rec('body.mm-mode + パネルがmain内 + シェード無し + ナビactive', integ.mmMode&&integ.panelInMain&&integ.noShade&&integ.navActive, JSON.stringify(integ));
  rec('統合表示中は一覧グリッドが隠れる', integ.gridHidden);

  const navLabels = await page.$$eval('#masterMaintNav [data-master]', bs => bs.map(b=>b.textContent.trim()));
  rec('マスタ種別タブに「テーブル生データ」が統合されている', navLabels.some(t=>t.includes('テーブル生データ')), navLabels.join('/'));

  // ===== (1b) 少項目マスタ = インラインフォーム =====
  // ラベルは完全一致を優先する。「設備停止」と「設備停止分類」のように
  // 前方一致で衝突するタブが増えたため、includesだけだと別のタブを押してしまう。
  const clickTab = async (label) => await page.evaluate(l => {
    const tabs=[...document.querySelectorAll('#masterMaintNav [data-master]')];
    const name=x=>(x.querySelector('.mm-nav-label')||x).textContent.trim();
    const b=tabs.find(x=>name(x)===l)||tabs.find(x=>name(x).includes(l));
    if(b) b.click(); return !!b;
  }, label);

  await clickTab('スプール');
  // 固定待ちだと他テストと同時に走らせたときに描画が間に合わずFAILすることがある。
  // フォームが実際に描画されるまで待つ。
  await page.waitForFunction(
    ()=>document.querySelectorAll('#masterMaintForm [data-field]').length>0, null, {timeout:15000});
  const spool = await page.evaluate(() => ({
    compact: document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    fieldCount: document.querySelectorAll('#masterMaintForm [data-field]').length,
  }));
  rec('少項目マスタ(スプール2項目)は従来どおり上部インラインフォーム', spool.compact===false&&spool.fieldCount>0, JSON.stringify(spool));

  // ===== (1c) 多項目マスタ = 編集モーダル =====
  await clickTab('設備停止');
  await page.waitForFunction(
    ()=>document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact')
        &&!!document.querySelector('#masterMaintAdd'), null, {timeout:15000});
  const shift = await page.evaluate(() => ({
    compact: document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
    inlineFields: document.querySelectorAll('#masterMaintForm [data-field]').length,
    addBtn: !!document.querySelector('#masterMaintAdd'),
  }));
  rec('多項目マスタ(設備停止4項目)は上部フォームを畳み追加ボタンのみ', shift.compact===true&&shift.inlineFields===0&&shift.addBtn, JSON.stringify(shift));

  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorModal', { state:'visible', timeout:5000 });
  /* 数えるのは入力欄の器(.mm-field)。専用コントロール(設備の複数選択タグ入力
     など)は素の [data-field] を持たないので、そちらで数えると項目が
     入れ替わるたびに数が合わなくなる(§9.81で対象設備がタグ入力になった)。 */
  const editor = await page.evaluate(() => ({
    fields: document.querySelectorAll('#maintEditorForm .mm-field').length,
    title: document.querySelector('#maintEditorTitle')?.textContent,
  }));
  rec('編集専用モーダルが開き4項目すべて表示', editor.fields===4, JSON.stringify(editor));
  await page.click('#maintEditorCancel');
  await page.waitForTimeout(300);
  rec('編集モーダルを閉じられる', await page.evaluate(()=>document.querySelector('#maintEditorModal').hidden));

  // ===== (1d) 生データタブ =====
  await clickTab('テーブル生データ');
  await page.waitForFunction(
    ()=>document.querySelectorAll('.mm-raw-table thead th').length>0, null, {timeout:15000});
  const raw = await page.evaluate(() => ({
    sel: !!document.querySelector('#rawTableSelect'),
    tables: document.querySelector('#rawTableSelect')?.options.length||0,
    table: !!document.querySelector('.mm-raw-table'),
    cols: document.querySelectorAll('.mm-raw-table thead th').length,
  }));
  rec('テーブル生データタブでmaster.sqlite3の表を閲覧できる', raw.sel&&raw.tables>0&&raw.table&&raw.cols>0, JSON.stringify(raw));

  // ===== (1e) 他ナビへ移動すると閉じる =====
  await page.click('aside [data-db-key="SIKALOTNOW"]');
  await page.waitForTimeout(1200);
  rec('他のサイドバー項目を押すとマスタ管理から出る',
      await page.evaluate(()=>!document.body.classList.contains('mm-mode')&&document.querySelector('#masterMaintPanel').hidden));

  // ===== (4) サイズ統一 =====
  const sizes = await page.evaluate(() => {
    const h = s => { const e=document.querySelector(s); return e?Math.round(e.getBoundingClientRect().height):null };
    const f = s => { const e=document.querySelector(s); return e?getComputedStyle(e).fontSize:null };
    return {
      navItem: h('#openSchedule'), navItem2: h('#openMasterMaint'),
      // §9.48でヘッダーを再設計し、検索欄・表示件数はラベル(.hd-search/.hd-field)が
      // 枠を持つ形になった。高さを比べる対象は「見えている箱」なのでそちらを測る。
      equipBtn: h('.hd-chip-equip'), modeBadge: h('#accessModeBadge'),
      search: h('.hd-search'), pageSize: h('.hd-field'), reload: h('#reload'),
      navFont: f('#openSchedule .nav-item span') || f('#openSchedule'),
      // --ctl-hはcalc()式なので、実際に解決された高さで比べる
      ctlH: (()=>{const d=document.createElement('div');d.style.height='var(--ctl-h)';document.body.appendChild(d);
                  const h=Math.round(d.getBoundingClientRect().height);d.remove();return h})(),
    };
  });
  const navSame = sizes.navItem===sizes.navItem2;
  const headerVals=[sizes.equipBtn,sizes.modeBadge,sizes.search,sizes.pageSize,sizes.reload].filter(v=>v!=null);
  const headerSame = new Set(headerVals).size===1;
  rec('左ナビ項目の高さが揃っている', navSame, JSON.stringify(sizes));
  rec('ヘッダーのコントロール高さが全て同一', headerSame, 'heights='+JSON.stringify(headerVals));
  rec('ナビ項目の高さ=--ctl-hトークン', sizes.navItem===sizes.ctlH, sizes.navItem+' vs '+sizes.ctlH);

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);
  console.log(`${R.length-f.length}/${R.length} passed`);
  if(f.length){console.log('FAILURES:');f.forEach(x=>console.log(' -',x.n,x.d||''))}
  if(errs.length)console.log('PAGE ERRORS:',errs.length);
  await browser.close();
  process.exit(f.length||errs.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(browser)await browser.close().catch(()=>{});
 process.exit(2);
});
