/* test_eqkind.js: 設備マスタの区分（コイル／板、§9.85）
   ------------------------------------------------------------
   設備が扱う材料の形を設備の属性として持つ。既存の登録は空欄（未設定）の
   ままでも今までどおり動くこと（他マスタと同じ互換ポリシー）が要点なので、
   「選べる」「保存される」だけでなく「未設定のまま登録・編集できる」まで見る。
   設備マスタは master.sqlite3 なので、作った行は必ず finally で片付ける
   （残すと後続テストの俯瞰ボードや設備リストの件数が変わる）。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const API='http://127.0.0.1:5029';
let browser=null,page=null;
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
const NAME='区分テスト設備'+Date.now().toString().slice(-6);

// 作った設備は必ず消す。片付け自体が失敗しても他の後始末は続ける。
async function cleanup(){
 if(!page)return;
 try{
  await page.evaluate(async ()=>{
   const r=await fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json());
   for(const it of (r.items||[])) if(String(it.name||'').startsWith('区分テスト設備'))
    await fetch('/api/equipment-master/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id:it.id,force:true,user_id:'tests'})});
  });
 }catch(e){console.log('  [cleanup]',e.message)}
}

(async()=>{
 browser=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 page=await browser.newPage({viewport:{width:1600,height:1000}});
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('  [pageerror]',e.message));
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.evaluate(()=>{localStorage.setItem('MeasurementUserIdV1','tester');
   return fetch('/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});

  const post=(url,body)=>page.evaluate(([u,b])=>fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'tests'},b))}).then(async r=>({status:r.status,body:await r.json().catch(()=>({}))})),[url,body]);
  const getEquip=name=>page.evaluate(async n=>{
   const r=await fetch('/api/equipment-master',{cache:'no-store'}).then(x=>x.json());
   return {kinds:r.equipmentKinds||null,item:(r.items||[]).find(i=>i.name===n)||null,
           hasKindField:(r.items||[]).every(i=>'kind' in i)};
  },name);

  /* ---- 1) APIの受け口 ---- */
  const first=await getEquip('テスト設備A');
  rec('設備マスタが区分の選択肢を返す',
   Array.isArray(first.kinds)&&first.kinds.join('/')==='コイル/板',JSON.stringify(first.kinds));
  rec('全ての設備がkindを持つ（既存行も欠けない）',first.hasKindField);
  rec('区分を入れていない既存設備は未設定（空）で返る',first.item&&first.item.kind==='',
   JSON.stringify(first.item&&first.item.kind));

  /* ---- 2) 画面から区分つきで登録する ---- */
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  await page.fill('#masterUserId','tester');
  await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintNav [data-master]')]
    .find(x=>x.textContent.includes('設備'));if(b)b.click()});
  await page.waitForTimeout(1500);

  const form=await page.evaluate(()=>{
   const sel=document.querySelector('#masterMaintForm select[data-field="kind"]');
   return {exists:!!sel,inline:!document.querySelector('#masterMaintForm')?.classList.contains('mm-form-compact'),
           options:sel?[...sel.options].map(o=>o.value):null,
           heads:[...document.querySelectorAll('#masterMaintList .mm-row.head span')].map(s=>s.textContent.trim())};
  });
  rec('設備タブは上のフォームで直接入力する形式のまま（項目が増えてもモーダルにしない）',form.inline,JSON.stringify(form.inline));
  rec('区分の選択欄がある',form.exists);
  rec('選択肢は 未選択／コイル／板',form.exists&&form.options.join('|')==='|コイル|板',JSON.stringify(form.options));
  rec('一覧に区分列がある',form.heads.includes('区分'),form.heads.join('/'));
  rec('区分が空の設備は一覧で「未設定」と出る',
   await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
    const r=rows.find(x=>x.children[0]?.textContent.trim()==='テスト設備A');
    return !!r&&r.children[1]?.textContent.trim()==='未設定';
   }));

  await page.fill('#masterMaintForm [data-field="name"]',NAME);
  await page.selectOption('#masterMaintForm select[data-field="kind"]','コイル');
  await page.click('#masterMaintForm button[type="submit"]');
  await page.waitForTimeout(2500);
  const added=await getEquip(NAME);
  rec('画面から区分つきで新規登録できる',added.item&&added.item.kind==='コイル',
   JSON.stringify(added.item&&{name:added.item.name,kind:added.item.kind}));
  rec('登録した区分が一覧の区分列に出る',
   await page.evaluate(n=>{
    const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
    const r=rows.find(x=>x.children[0]?.textContent.trim()===n);
    return !!r&&r.children[1]?.textContent.trim()==='コイル';
   },NAME),NAME);

  /* ---- 3) 画面から区分を変える ---- */
  await page.evaluate(n=>{const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
   const r=rows.find(x=>x.children[0]?.textContent.trim()===n);if(r)r.click()},NAME);
  await page.waitForTimeout(800);
  const loaded=await page.evaluate(()=>({
   name:document.querySelector('#masterMaintForm [data-field="name"]')?.value,
   kind:document.querySelector('#masterMaintForm select[data-field="kind"]')?.value}));
  rec('行クリックで編集フォームへ区分ごと読み込まれる',loaded.kind==='コイル'&&loaded.name===NAME,JSON.stringify(loaded));
  await page.selectOption('#masterMaintForm select[data-field="kind"]','板');
  await page.click('#masterMaintForm button[type="submit"]');
  await page.waitForTimeout(2500);
  const changed=await getEquip(NAME);
  rec('画面から区分を変更できる',changed.item&&changed.item.kind==='板',
   JSON.stringify(changed.item&&changed.item.kind));

  /* ---- 4) 互換: 区分を選ばなくても登録・編集できる ---- */
  const id=changed.item&&changed.item.id;
  const cleared=await post('/api/equipment-master/update',{id,name:NAME,kind:''});
  const afterClear=await getEquip(NAME);
  rec('区分を未設定へ戻せる',cleared.status===200&&afterClear.item.kind==='',
   `${cleared.status} / kind=${JSON.stringify(afterClear.item&&afterClear.item.kind)}`);
  const noKind=await post('/api/equipment-master/update',{id,name:NAME,maxStrips:12});
  const afterNoKind=await getEquip(NAME);
  rec('区分を送らない更新でも今までどおり保存できる',
   noKind.status===200&&afterNoKind.item.maxStrips===12,
   `${noKind.status} / maxStrips=${afterNoKind.item&&afterNoKind.item.maxStrips}`);

  /* ---- 5) 選択肢に無い値は未設定へ丸める（画面外からの入力対策） ---- */
  const bogus=await post('/api/equipment-master/update',{id,name:NAME,kind:'コイル板'});
  const afterBogus=await getEquip(NAME);
  rec('選択肢に無い区分は未設定として保存する',bogus.status===200&&afterBogus.item.kind==='',
   `${bogus.status} / kind=${JSON.stringify(afterBogus.item&&afterBogus.item.kind)}`);

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  await browser.close();browser=null;
  process.exit(f.length?1:0);
 }catch(e){
  // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
  // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
  // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
  console.error('FATAL',e);
  await cleanup();
  if(browser)await browser.close().catch(()=>{});
  process.exit(2);
 }
})();
