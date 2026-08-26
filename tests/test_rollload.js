/* test_rollload.js: 異常位置判定②のロール読み込みと、入力の取り消し（§9.241 ④⑤）
   ============================================================
   利用者の報告（2件）:
    ④「異常位置判定の長手方向の判定で、ロールマスタを読み込み入力データを
      計算して一致するものを出す機能がありますが、きちんと登録された
      ロールマスタを読んで切れないようです。」
    ⑤「条の設計で、異常データを入力した後、取り消したいとなって『この入力を
      取り消す』を押した後、モーダルが閉じないのでモーダルを閉じて終了する
      ため✖ボタンを押すと、入力を消す前に戻ってしまいます。」

   **なぜ既存の網（`tests/test_roll.js`）が素通りしたか。**
   あちらは「測定を開かずに判定だけ確かめる」として `WL.defect.rollMatches()`
   を**直接**呼び、行は自分で `fetch` して渡していた。判定の式は正しかったが、
   **画面がロールを取りに行く経路**（`loadRolls()`／`WL.ttlCache`）は一度も
   通っていない。実際の欠陥はそこにあった——`ttlCache` の
   「無ければ取りに行く」は `fetch(key,loader)` なのに `get(key)` を呼んで
   いたため、**リクエストが1本も飛ばず、画面は「登録されていません」と
   もっともらしく言い切っていた**。

   だからここでは**実際に測定を開き、窓を開き、リクエストが飛ぶこと**まで見る。
    1. 窓を開くと `/api/roll-master` を**実際に取りに行く**
    2. 登録したロールが読めて、ピッチから直接一致が出る
    3. マスタで登録した直後でも出る（控えを捨てている）
    4. 入力を消すと**記録にも反映**され、開き直しても戻らない
    5. 開いて眺めただけでは「未保存の変更」を作らない
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const TAG='RL'+process.pid;
const EQ='テスト設備A';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const made=[];
async function mkRoll(name,diaMax,extra){
 const r=await (await post('/api/roll-master',
   {user_id:'test',equipment:EQ,name,diaMax,...(extra||{})})).json();
 if(r.id)made.push(r.id);
 return r;
}

(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 try{
  await post('/api/access-mode',{mode:'edit'});
  /* **対象設備・ロール名・ロール径MAXだけ**——利用者が「最低でもしっかり
     登録できている」と言っている形そのものを注ぐ。 */
  await mkRoll(TAG+'A',250);          /* 周長 π×250 ≒ 785.40 */
  await mkRoll(TAG+'B',200);          /* 周長 π×200 ≒ 628.32 */
  const api=await getj('/api/roll-master?equipment='+encodeURIComponent(EQ));
  const server=(api.items||[]).filter(x=>String(x.name).startsWith(TAG)).length;
  rec('前提: サーバーはこの設備のロールを返す',server===2,String(server));

  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
  const page=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[];page.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  page.on('dialog',d=>d.accept());
  /* **取りに行ったことを数える**——これが今回の欠陥の核心（リクエストが
     1本も飛んでいなかった）。画面の文字だけを見る網では捕まらない。 */
  const reqs=[];
  page.on('request',r=>{if(r.url().includes('/api/roll-master'))reqs.push(r.url())});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});

  /* ---- ④ ロールを取りに行くか ---- */
  await page.evaluate(()=>WL.defect.open());
  await page.waitForFunction(()=>!document.querySelector('#defectModal')?.hidden,null,{timeout:10000});
  await page.evaluate(()=>WL.defect.setTab('roll'));
  await page.waitForFunction(()=>WL.defect.rollRows().length>0,null,{timeout:15000}).catch(()=>{});
  const s1=await page.evaluate(()=>({
   rows:WL.defect.rollRows().length,
   eq:WL.defect.rollEquipment(),
   basis:(document.getElementById('defectRollBasis')||{}).textContent||'',
  }));
  rec('窓を開くとロールマスタを実際に取りに行く（リクエストが飛ぶ）',
      reqs.length>0,JSON.stringify(reqs.slice(0,2)));
  rec('登録したロールを読める',s1.rows===2,JSON.stringify(s1));
  rec('前提の欄に「何本読んだか」が出る',/2本を読みました/.test(s1.basis),s1.basis);

  await page.fill('#defectPitch','785.4');
  await page.evaluate(()=>document.getElementById('defectPitch').dispatchEvent(new Event('input')));
  await page.waitForFunction(t=>{
   const el=document.getElementById('defectRollResult');
   return !!el&&el.textContent.includes(t);
  },TAG+'A',{timeout:10000}).catch(()=>{});
  const s2=await page.evaluate(()=>({
   result:(document.getElementById('defectRollResult')||{}).textContent||'',
   list:(document.getElementById('defectRollList')||{}).textContent||'',
  }));
  rec('ピッチから直接一致のロールが出る',
      s2.result.includes(TAG+'A')&&/直接一致/.test(s2.result),s2.result.slice(0,90));
  rec('候補の一覧にもそのロールが並ぶ',s2.list.includes(TAG+'A'),s2.list.slice(0,90));

  /* ---- ④b マスタで足した直後でも出る（控えを捨てている） ---- */
  await mkRoll(TAG+'C',300);          /* 周長 π×300 ≒ 942.48 */
  await page.evaluate(()=>WL.defect.forgetRolls&&WL.defect.forgetRolls());
  await page.evaluate(()=>WL.defect.setTab('pos'));
  await page.evaluate(()=>WL.defect.setTab('roll'));
  await page.fill('#defectPitch','942.5');
  await page.evaluate(()=>document.getElementById('defectPitch').dispatchEvent(new Event('input')));
  await page.waitForFunction(t=>{
   const el=document.getElementById('defectRollResult');
   return !!el&&el.textContent.includes(t);
  },TAG+'C',{timeout:15000}).catch(()=>{});
  const s3=await page.evaluate(t=>({
   rows:WL.defect.rollRows().length,
   hit:((document.getElementById('defectRollResult')||{}).textContent||'').includes(t),
  }),TAG+'C');
  rec('マスタで足した直後のロールも読める（控えを捨てている）',
      s3.rows===3&&s3.hit===true,JSON.stringify(s3));

  /* ---- ⑤ 入力を消すと記録にも反映される ---- */
  await page.evaluate(()=>WL.defect.setTab('pos'));
  await page.fill('#defectDistance','120');
  await page.fill('#defectMemo',TAG+'キズ');
  await page.evaluate(()=>{
   document.getElementById('defectDistance').dispatchEvent(new Event('input'));
   document.getElementById('defectMemo').dispatchEvent(new Event('input'));
  });
  await page.waitForFunction(t=>{
   const d=S.measure&&S.measure.settings&&S.measure.settings.defectLocation;
   return !!d&&String(d.memo||'')===t;
  },TAG+'キズ',{timeout:10000});
  const put=await page.evaluate(()=>({
   distance:S.measure.settings.defectLocation.distance,
   memo:S.measure.settings.defectLocation.memo,
  }));
  rec('前提: 入力が記録へ入っている',String(put.distance)==='120'&&put.memo===TAG+'キズ',
      JSON.stringify(put));

  await page.click('#defectReset');
  await page.waitForTimeout(200);
  const cleared=await page.evaluate(()=>{
   const d=S.measure.settings.defectLocation||{};
   return {distance:String(d.distance??''),memo:String(d.memo??'')};
  });
  rec('「入力を消す」が記録にも反映される（判定できなくても書き戻す）',
      cleared.distance===''&&cleared.memo==='',JSON.stringify(cleared));

  /* ×で閉じて開き直しても戻らない——これが報告そのもの。 */
  await page.click('#closeDefect');
  await page.waitForFunction(()=>!!document.querySelector('#defectModal')?.hidden,null,{timeout:8000});
  await page.evaluate(()=>WL.defect.open());
  await page.waitForFunction(()=>!document.querySelector('#defectModal')?.hidden,null,{timeout:8000});
  const back=await page.evaluate(()=>({
   distance:document.getElementById('defectDistance').value,
   memo:document.getElementById('defectMemo').value,
  }));
  rec('閉じて開き直しても消す前に戻らない',back.distance===''&&back.memo==='',
      JSON.stringify(back));

  /* ---- ⑤b 開いて眺めただけでは「未保存の変更」を作らない ---- */
  const clean=await page.evaluate(()=>{
   /* 記録を白紙に戻してから、窓を開け閉めするだけをやってみる。
      **入力欄も一緒に空にすること**——打った値が残っていると、それを
      書き戻すのは正しい動きなので「眺めただけ」を一度も確かめられない
      （最初はここを空にし忘れて、正しい動きを不具合として読んでいた）。 */
   ['defectDistance','defectMemo','defectPitch','defectRollMemo'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
   });
   delete S.measure.settings.defectLocation;
   delete S.measure.settings.defectRoll;
   measureDirty=false;
   return true;
  });
  await page.click('#closeDefect');
  await page.evaluate(()=>WL.defect.open());
  await page.evaluate(()=>WL.defect.setTab('roll'));
  await page.evaluate(()=>WL.defect.setTab('pos'));
  await page.waitForTimeout(300);
  const dirty=await page.evaluate(()=>({
   dirty:(typeof measureDirty!=='undefined')?measureDirty:null,
   made:!!(S.measure.settings.defectLocation||S.measure.settings.defectRoll),
   loc:S.measure.settings.defectLocation||null,
   roll:S.measure.settings.defectRoll||null,
  }));
  rec('開いて眺めただけでは未保存の変更を作らない',
      clean&&dirty.dirty===false&&dirty.made===false,JSON.stringify(dirty));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  console.log('FATAL '+(e&&e.message||e));R.push({ok:false});
 }finally{
  for(const id of made){try{await post('/api/roll-master/delete',{user_id:'test',id})}catch(_){}}
  try{
   const left=((await getj('/api/roll-master')).items||[]).filter(x=>x.name&&x.name.startsWith(TAG));
   for(const x of left){try{await post('/api/roll-master/delete',{user_id:'test',id:x.id})}catch(_){}}
  }catch(_){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
