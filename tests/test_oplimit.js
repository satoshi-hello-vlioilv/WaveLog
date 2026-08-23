/* test_oplimit.js: 設備マスタの最大ライン速度と、数の決まりのマスタ連携（§9.231）
   ============================================================
   利用者の指示:
     ①「設備マスタに最大ライン速度を追加」
     ②「操業データ項目の『数の決まり』の部分で、MIN-MAXなどの入力値を
        決めるところで、マスタからのデータともリンクできるようにして
        ください。特に設備マスタの追加する最大ライン速度や最大条数は
        リンクをさせたい部分です」

   ここで固定すること:
    - 設備マスタに`[最大ライン速度]`があり、画面から入れて一覧に単位つきで出る
    - 設定窓の「上下限の出どころ」で**マスタを選ぶと手打ちの欄が使えなくなる**
      （押せるのに効かない欄を残さない・§CLAUDE 4）
    - **いまの値・単位・設備名を文字で出す**（§CLAUDE 6）
    - 出どころは**保存で消えない**（`item_upsert`は全列を書く・§9.212 ②）
    - **値の入っていない設備では上限が掛からない**（引けない値を0にしない）
    - 測定画面の案内は`ruleText()`の1本なので、**出どころの呼び名まで出る**
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='lim-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)}).then(async r=>({st:r.status,body:await r.json().catch(()=>({}))}));
const get=p=>fetch(B+p).then(r=>r.json());
const EQ='テスト設備A',EQ2='テスト設備B';
const SRC='equipment.maxLineSpeed';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 /* 後始末のための控え。**設備マスタの更新は全置換**なので、1つだけ送ると
    区分・最大条数・標準時間が消える——丸ごと控えて丸ごと戻す。 */
 let eqBackup=null,itemId=null;
 try{
  await post('/api/access-mode',{mode:'edit'});
  const eqs=await get('/api/equipment-master');
  const row=(eqs.items||[]).find(x=>x.name===EQ);
  if(!row)throw new Error('検証用の設備が見つかりません: '+EQ);
  eqBackup={id:row.id,name:row.name,kind:row.kind,maxStrips:row.maxStrips,
            standardMinutes:row.standardMinutes,maxLineSpeed:row.maxLineSpeed};
  rec('前提: 最大ライン速度は未設定から始める（設定してあると「入れられた」が確かめられない）',
      String(row.maxLineSpeed||'')==='',JSON.stringify(row.maxLineSpeed));

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master]',{timeout:20000});
  await page.evaluate(()=>{
   const el=document.querySelector('#masterUserId');
   if(el){el.value='tests';el.dispatchEvent(new Event('change',{bubbles:true}))}
  });

  /* ==========================================================
     ① 設備マスタ 最大ライン速度（利用者の指示）
     ========================================================== */
  await page.click('#masterMaintNav [data-master="equipment"]');
  await page.waitForFunction(()=>!!document.querySelector('#masterMaintForm [data-field="name"]'),
    null,{timeout:20000});
  const heads=await page.$$eval('#masterMaintList .mm-row.head span',es=>es.map(s=>s.textContent.trim()));
  rec('一覧に最大速度の列がある',heads.some(h=>/最大速度/.test(h)),heads.join('/'));
  const hasField=await page.evaluate(()=>!!document.querySelector('#masterMaintForm [data-field="maxLineSpeed"]'));
  rec('入力欄がある（設備マスタは上のフォームで直接入れる形のまま）',hasField);
  const cellOf=n=>page.evaluate(name=>{
   const hs=[...document.querySelectorAll('#masterMaintList .mm-row.head span')].map(s=>s.textContent.trim());
   const i=hs.findIndex(h=>/最大速度/.test(h));
   const r=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(x=>x.children[0]?.textContent.trim()===name);
   return (r&&i>=0)?r.children[i]?.textContent.trim():null;
  },n);
  rec('未設定の設備は「未設定」と出る（空欄で黙らない・§CLAUDE 4）',
      (await cellOf(EQ))==='未設定',String(await cellOf(EQ)));
  /* 画面から入れる。**行を押して読み込んでから**書き換える（登録の欄へ
     打つと別の設備を作ってしまう）。 */
  await page.evaluate(n=>{const r=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
    .find(x=>x.children[0]?.textContent.trim()===n);if(r)r.click()},EQ);
  await page.waitForFunction(n=>document.querySelector('#masterMaintForm [data-field="name"]')?.value===n,
    EQ,{timeout:10000});
  await page.fill('#masterMaintForm [data-field="maxLineSpeed"]','350');
  await page.click('#masterMaintForm button[type="submit"]');
  await page.waitForFunction(async()=>true,null,{timeout:1000}).catch(()=>{});
  await page.waitForFunction(n=>{
   const hs=[...document.querySelectorAll('#masterMaintList .mm-row.head span')].map(s=>s.textContent.trim());
   const i=hs.findIndex(h=>/最大速度/.test(h));
   const r=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')]
     .find(x=>x.children[0]?.textContent.trim()===n);
   return !!r&&i>=0&&/350/.test(r.children[i]?.textContent||'');
  },EQ,{timeout:15000});
  rec('画面から入れると一覧に単位つきで出る（350 m/min）',
      /^350\s*m\/min$/.test(await cellOf(EQ)),String(await cellOf(EQ)));
  const after=(await get('/api/equipment-master')).items.find(x=>x.name===EQ);
  rec('マスタへ保存されている',Number(after&&after.maxLineSpeed)===350,JSON.stringify(after&&after.maxLineSpeed));

  /* ==========================================================
     ② 数の決まりの出どころ
     ========================================================== */
  const made=await post('/api/operation-item-master',{user_id:'tests',equipment:EQ,
    group:'ライン'+TAG,name:'ライン速度'+TAG,type:'正の数',decimals:1,max:99,
    place:'準備',span:4,unit:'m/min'});
  itemId=made.body&&made.body.id;
  if(!itemId){
   const all=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   const hit=(all.items||[]).find(x=>x.name==='ライン速度'+TAG);
   itemId=hit&&hit.id;
  }
  rec('前提: 数の項目を1つ作れた',!!itemId,String(itemId));

  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  /* 盤は設備で絞れる。**この設備を選ぶ**——選ばないと「いまの値」が
     引けず、案内の文が変わる（そこも下で確かめる）。 */
  await page.selectOption('#opEqPick',EQ).catch(()=>{});
  await page.waitForFunction(id=>!!document.querySelector(`.op-tile[data-op-id="${id}"]`),
    String(itemId),{timeout:20000});
  const openModal=async()=>{
   await page.evaluate(id=>{const t=document.querySelector(`.op-tile[data-op-id="${id}"]`);if(t)t.click()},
     String(itemId));
   await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !!m&&!m.hidden},
     null,{timeout:10000});
   await page.evaluate(()=>{const t=[...document.querySelectorAll('.op-tab')]
     .find(x=>/記録/.test(x.textContent));if(t)t.click()});
   await page.waitForSelector('#opdMaxFrom',{timeout:10000});
  };
  await openModal();
  const before=await page.evaluate(()=>({
   ある:!!document.getElementById('opdMaxFrom')&&!!document.getElementById('opdMinFrom'),
   既定:document.getElementById('opdMaxFrom').value,
   打てる:!document.getElementById('opdMax').disabled,
   案内:(document.querySelector('#opdMaxFrom')?.closest('label')?.querySelector('.op-form-note')?.textContent||'').trim(),
   候補:[...document.getElementById('opdMaxFrom').options].map(o=>o.textContent.trim())}));
  rec('「上下限の出どころ」の欄が最小・最大の両方にある',before.ある);
  rec('既定は「自分で決める」（今までの設定を勝手に変えない）',
      before.既定===''&&/この行に書いた数/.test(before.案内),JSON.stringify(before));
  rec('既定では最大の欄を手で打てる',before.打てる);
  rec('候補は設備マスタの2つ（語彙はサーバーが答える）',
      before.候補.some(t=>/最大ライン速度/.test(t))&&before.候補.some(t=>/最大条数/.test(t)),
      before.候補.join('/'));

  await page.selectOption('#opdMaxFrom',SRC);
  await page.waitForFunction(()=>document.getElementById('opdMax')?.disabled===true,null,{timeout:10000});
  const picked=await page.evaluate(()=>({
   打てる:!document.getElementById('opdMax').disabled,
   案内:(document.querySelector('#opdMaxFrom')?.closest('label')?.querySelector('.op-form-note')?.textContent||'').trim(),
   見本全体:(document.getElementById('opModalPreview')?.textContent||'')}));
  rec('マスタを選ぶと手打ちの欄は使えなくなる（効かない欄を残さない・§CLAUDE 4）',!picked.打てる);
  rec('案内に出どころ・設備名・いまの値・単位が出る（§CLAUDE 6）',
      /設備マスタ 最大ライン速度/.test(picked.案内)&&picked.案内.includes(EQ)
      &&/350/.test(picked.案内)&&/m\/min/.test(picked.案内),picked.案内);
  rec('見本の決まり書きにも出どころつきで出る（測定画面と同じ1本を通る）',
      /350 以下（設備マスタ 最大ライン速度）/.test(picked.見本全体),
      picked.見本全体.slice(0,160));

  await page.click('#opdSave');
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !m||m.hidden},
    null,{timeout:15000});
  const saved=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>String(x.id)===String(itemId));
  rec('保存すると出どころがマスタへ入る',saved&&saved.maxFrom===SRC,JSON.stringify(saved&&saved.maxFrom));

  /* **開き直しても残ること**——`item_upsert`は全列を書くので、送り漏れが
     あると「保存した瞬間は効いているのに次に開くと消えている」になる
     （§9.113／§9.212 ②で3回踏んでいる形）。ここでは**出どころに触らず
     別の欄だけ**保存して、巻き添えで消えないことを見る。 */
  await openModal();
  const reopened=await page.evaluate(()=>({
   出どころ:document.getElementById('opdMaxFrom').value,
   打てる:!document.getElementById('opdMax').disabled}));
  rec('開き直しても出どころが選ばれたまま',reopened.出どころ===SRC&&!reopened.打てる,
      JSON.stringify(reopened));
  await page.evaluate(()=>{const t=[...document.querySelectorAll('.op-tab')]
    .find(x=>/メモ/.test(x.textContent));if(t)t.click()});
  await page.waitForSelector('#opdNote',{timeout:10000});
  await page.fill('#opdNote','出どころの巻き添えを見るためのメモ');
  await page.click('#opdSave');
  await page.waitForFunction(()=>{const m=document.getElementById('opItemModal');return !m||m.hidden},
    null,{timeout:15000});
  const kept=(await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ)))
    .items.find(x=>String(x.id)===String(itemId));
  rec('別の欄を保存しても出どころは消えない（全列書き込みの巻き添えにしない）',
      kept&&kept.maxFrom===SRC,JSON.stringify(kept&&kept.maxFrom));

  /* ---- 測定画面が読む形（`form_for_equipment`） ---- */
  const form=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const fr=(form.items||[]).find(x=>String(x.id)===String(itemId));
  rec('測定画面へは引き直した値が届く（項目に書いた99ではなく350）',
      fr&&Number(fr.max)===350,JSON.stringify(fr&&{max:fr.max,label:fr.maxFromLabel}));
  rec('出どころの呼び名も届く（画面が推測しない）',
      fr&&fr.maxFromLabel==='設備マスタ 最大ライン速度',JSON.stringify(fr&&fr.maxFromLabel));

  /* ---- 値の入っていない設備 ---- */
  await post('/api/operation-item-master/update',{user_id:'tests',id:itemId,
    equipment:'*',group:'ライン'+TAG,name:'ライン速度'+TAG,type:'正の数',decimals:1,max:99,
    place:'準備',span:4,unit:'m/min',maxFrom:SRC});
  const form2=await get('/api/operation-form?equipment='+encodeURIComponent(EQ2));
  const fr2=(form2.items||[]).find(x=>String(x.id)===String(itemId));
  rec('前提: 値の入っていない設備でもその項目は出る',!!fr2,String(!!fr2));
  rec('値の入っていない設備では上限が掛からない（引けない値を0にしない）',
      fr2&&(fr2.max===null||fr2.max===undefined),JSON.stringify(fr2&&fr2.max));
  rec('引けなかったことは名前で言う（画面が理由を書けるように）',
      fr2&&fr2.maxFromMissing===true,JSON.stringify(fr2&&fr2.maxFromMissing));

  /* ---- 自分で決めるへ戻す ---- */
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.selectOption('#opEqPick',EQ).catch(()=>{});
  await page.waitForFunction(id=>!!document.querySelector(`.op-tile[data-op-id="${id}"]`),
    String(itemId),{timeout:20000});
  await openModal();
  await page.selectOption('#opdMaxFrom','');
  await page.waitForFunction(()=>document.getElementById('opdMax')?.disabled===false,null,{timeout:10000});
  const back=await page.evaluate(()=>({
   打てる:!document.getElementById('opdMax').disabled,
   案内:(document.querySelector('#opdMaxFrom')?.closest('label')?.querySelector('.op-form-note')?.textContent||'').trim()}));
  rec('「自分で決める」へ戻すと手打ちの欄が戻る',
      back.打てる&&/この行に書いた数/.test(back.案内),JSON.stringify(back));

  console.log('\n合計 '+R.filter(r=>r.ok).length+'/'+R.length+' PASS'
    +'  (FAIL: '+R.filter(r=>!r.ok).length+')');
  process.exitCode=R.some(r=>!r.ok)?1:0;
 }catch(e){
  console.log('FATAL: '+(e&&e.message));process.exitCode=1;
 }finally{
  /* 後始末（§9.121）。**落ちても消す**——残った項目は次の実行の盤に
     並び、`test_msteps`の「記録した値」の分母を変える。 */
  try{if(itemId)await post('/api/operation-item-master/delete',{user_id:'tests',id:itemId})}catch(e){}
  try{if(eqBackup)await post('/api/equipment-master/update',{user_id:'tests',...eqBackup})}catch(e){}
  if(b)await b.close();
 }
})();
