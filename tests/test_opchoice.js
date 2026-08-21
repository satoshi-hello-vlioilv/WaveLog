/* test_opchoice.js: 選択肢の値マスタの階層化と6マスタの統合（§9.221 ②③）
   ============================================================
   利用者の指示:
     「まとまり名毎にまとめて管理したいです。まとまり名毎にさらに子マスタを
      持つような感じにしてマスタに階層構造を持たせたいです」
     「オペレータ、機器、スプール種別、内径種別、バリ揃え、コイル止めに
      ついても汎用化した操業データ項目マスタに移行させてください」

   ここで固定するのは次の点。
    1. 左＝まとまり／右＝その中の値、の2階層で出る
    2. まとまりを選ぶと、その中の値だけが出る
    3. 値を足す／消す／並べ替えるのが**そのまとまりの中で**できる
    4. まとまり名を変えると、**参照している項目の選択肢名も**変わる
    5. 使っている項目があるまとまりは**消せない**（理由が返る）
    6. 6つのマスタが**まとまりとして引ける**（表が在るだけでは通らない）
    7. 専用タブは残っていない（探す場所が1つ）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const G='回帰_選択肢'+Date.now().toString().slice(-5);
const G2=G+'_改名';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({status:r.status,body:await r.json()}));
const getj=p=>fetch(B+p).then(r=>r.json());
async function cleanup(){
 try{
  for(const nm of [G,G2])await post('/api/operation-choice-master/delete-group',{name:nm,user_id:'cleanup'});
  const it=await getj('/api/operation-item-master');
  for(const x of (it.items||[]))
   if(String(x.name||'').startsWith('回帰_選択肢項目'))
    await post('/api/operation-item-master/delete',{id:x.id,user_id:'cleanup'});
  for(const nm of [G,G2])await post('/api/operation-choice-master/delete-group',{name:nm,user_id:'cleanup'});
 }catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await cleanup();
  await post('/api/access-mode',{mode:'edit'});

  /* ---- 1) 6つのマスタが「まとまり」として引ける ---- */
  const ch0=await getj('/api/operation-choice-master');
  const groups=(ch0.groups||[]).map(g=>g.name);
  const legacy=ch0.legacyGroups||[];
  rec('移行したまとまりの名前をサーバーが答える',
      legacy.length===7&&legacy.includes('オペレータ')&&legacy.includes('板厚測定器'),legacy.join('/'));
  /* **表が在るだけでは通らない**。値まで引けることを見る（バリ揃え・
     コイル止めは新規導入でも種を持つので、どの環境でも必ず在る）。 */
  const valuesOf=n=>(ch0.items||[]).filter(x=>x.name===n).map(x=>x.value);
  rec('バリ揃えがまとまりとして引ける',
      ['上バリ揃え','下バリ揃え','指定なし'].every(v=>valuesOf('バリ揃え').includes(v)),
      valuesOf('バリ揃え').join(','));
  rec('コイル止めがまとまりとして引ける',
      ['内巻両面テープ','指定なし'].every(v=>valuesOf('コイル止め').includes(v)),
      valuesOf('コイル止め').join(','));
  rec('まとまりの件数・使い道をサーバーが数える',
      (ch0.groups||[]).every(g=>typeof g.count==='number'&&Array.isArray(g.usedBy)),
      JSON.stringify((ch0.groups||[])[0]||{}));

  /* ---- 2) よみ・対象設備を選択肢が持てる ---- */
  await post('/api/operation-choice-master',
    {name:G,value:'あか',note:'説明あか',reading:'アカ',equipment:'テスト設備A',user_id:'test'});
  await post('/api/operation-choice-master',{name:G,value:'あお',user_id:'test'});
  const ch1=await getj('/api/operation-choice-master');
  const mine=(ch1.items||[]).filter(x=>x.name===G);
  rec('よみと対象設備を選択肢が持てる',
      mine.length===2&&mine.some(x=>x.reading==='アカ'&&x.equipment==='テスト設備A'),
      JSON.stringify(mine.map(x=>({v:x.value,r:x.reading,e:x.equipment}))));

  /* ---- 3) 画面: 左＝まとまり／右＝値 ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:15000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:8000});
  await page.fill('#masterUserId','tester');
  await page.evaluate(()=>document.querySelector('#masterUserId').dispatchEvent(new Event('change')));
  const menu=await page.$$eval('#masterMaintNav [data-master]',n=>n.map(x=>x.dataset.master));
  rec('専用タブ（オペレータ・機器・スプール・内径・バリ・コイル止め）を残していない',
      !['operator','device','spool','inner','burr','coilStop'].some(k=>menu.includes(k)),menu.join(','));
  rec('「選択肢の値」が1枚だけある',menu.filter(k=>k==='opChoice').length===1,menu.join(','));

  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintNav [data-master]')]
     .find(x=>x.dataset.master==='opChoice');
   if(b)b.click();
  });
  await page.waitForSelector('.oc-edit',{timeout:8000});
  const shape=await page.evaluate(()=>({
    groups:document.querySelectorAll('.oc-groups .oc-group').length,
    hasValues:!!document.querySelector('.oc-values'),
    hasAdd:!!document.querySelector('#ocAddValue')}));
  rec('左にまとまり・右に値の2階層で出る',
      shape.groups>0&&shape.hasValues&&shape.hasAdd,JSON.stringify(shape));

  await page.evaluate(g=>{
   const b=[...document.querySelectorAll('[data-oc-group]')].find(x=>x.dataset.ocGroup===g);
   if(b)b.click();
  },G);
  await page.waitForTimeout(500);
  const picked=await page.evaluate(()=>({
    name:document.querySelector('#ocGroupName')?.value,
    rows:[...document.querySelectorAll('.oc-row[data-oc-id] [data-oc-f="value"]')].map(i=>i.value)}));
  rec('まとまりを選ぶとその中の値だけが出る',
      picked.name===G&&picked.rows.length===2&&picked.rows.includes('あか'),JSON.stringify(picked));

  /* ---- 4) まとまり名を変えると、使っている項目も付け替わる ---- */
  const item=await post('/api/operation-item-master',
    {equipment:'*',group:'回帰',name:'回帰_選択肢項目',type:'選択',choice:G,user_id:'test'});
  rec('前提: この選択肢を使う項目を作れた',item.status===200,JSON.stringify(item.body).slice(0,80));
  const ren=await post('/api/operation-choice-master/rename-group',{from:G,to:G2,user_id:'test'});
  const after=await getj('/api/operation-item-master');
  const hit=(after.items||[]).find(x=>x.name==='回帰_選択肢項目');
  rec('まとまり名を変えると、参照している項目の選択肢名も変わる',
      ren.status===200&&hit&&hit.choice===G2,JSON.stringify({ren:ren.body,choice:hit&&hit.choice}));

  /* ---- 5) 使っているまとまりは消せない（理由が返る） ---- */
  const del=await post('/api/operation-choice-master/delete-group',{name:G2,user_id:'test'});
  rec('使っている項目があるまとまりは消せない',
      del.status===409&&/回帰_選択肢項目/.test(String(del.body.error||'')),
      String(del.body.error||del.status));

  /* ---- 6) 並べ替えがまとまりの中で効く ---- */
  const ch2=await getj('/api/operation-choice-master');
  const ids=(ch2.items||[]).filter(x=>x.name===G2).map(x=>x.id);
  await post('/api/operation-choice-master/reorder',{ids:[ids[1],ids[0]],user_id:'test'});
  const ch3=await getj('/api/operation-choice-master');
  const order=(ch3.items||[]).filter(x=>x.name===G2).map(x=>x.value);
  rec('まとまりの中で並べ替えられる',order[0]!=='あか',order.join('/'));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
