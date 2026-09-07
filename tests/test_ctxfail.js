/* test_ctxfail.js: 参照データが読めなくても測定は始められる（§9.317）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「書き込み権限がないところにある品質ファイルを読んでいるので開き方に
     問題があるのでしょうか？…いずれにしても**編集モードでの測定作業に
     影響がないように**してほしいです。」

   以前は `WL.records.loadMeasurementContext()` が例外を投げており、
   `WL.records.openMeasurementCore()` の続き——**記録の初回保存（reliablePut）と
   共有への登録**——が丸ごと走らなかった。つまり共有の品質データが一瞬
   読めないだけで、**測定そのものが始められなかった**。

   ここで固定すること
    1. `/api/measurement/context` が500でも**測定画面は開き、記録が作られる**
    2. 黙って続けない——品質情報の札が「異常なし」ではなく「読めません」に
       なり、**理由が文字で読める**（§3・§4）
    3. **品質だけ読めなかった**応答（200＋diagnostics.quality_error）でも同じ
    4. **エラー文を記録へ入れない**——`WL.measureView.collect()`は`#qualityInfo`の中身を
       そのまま保存するので、そこへ書くと品質情報として残り帳票にも刷られる
    5. 読み直して成功したら注記は消える

   **応答を差し替えて確かめる**——実機のWinError 5はここでは作れないし、
   画面が見ているのは「読めなかったこと」だけなので、理由は問わない。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const CTX=/\/api\/measurement\/context\?/;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());

 const qi=()=>page.evaluate(()=>({
  札:document.getElementById('qualityInfoBadge')?.textContent||'',
  読めません:!!document.getElementById('qualityInfoBadge')?.classList.contains('qi-warn'),
  注記:document.getElementById('qualityInfoNote')?.hidden===false
    ?(document.getElementById('qualityInfoNote').textContent||''):'',
  本文:document.getElementById('qualityInfo')?.value||'',
 }));

 try{
  await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({mode:'edit'})});
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  // ---- 1. 参照データが500でも測定は始まる ----
  await page.route(CTX,r=>r.fulfill({status:500,contentType:'application/json',
    body:JSON.stringify({error:"[WinError 5] アクセスが拒否されました。: 'SIKADEF.sqlite3'"})}));
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(1200);

  const open=await page.evaluate(()=>({
   出ている:!document.getElementById('measureModal').hidden,
   ロット:(S.measure&&S.measure.basic&&S.measure.basic.lotNo)||'',
  }));
  rec('参照データが読めなくても測定画面は開く',open.出ている,open.ロット);

  /* **記録が作られること**まで見る（§9.317）。画面が出ただけでは足りない
     ——以前はここで例外が飛び、`WL.records.reliablePut()`が走らなかった。 */
  const saved=await page.evaluate(async()=>{
   const id=S.measure&&S.measure.id;if(!id)return {有:false};
   const all=await WL.records.reliableAll();
   return {有:all.some(x=>x.id===id),件数:all.length};
  });
  rec('記録の初回保存まで進む（測定を始められる）',saved.有,JSON.stringify(saved));

  // ---- 2. 黙って続けない ----
  const a=await qi();
  rec('品質情報の札が「異常なし」にならない（画面が嘘をつかない）',
      a.読めません&&/読めません/.test(a.札),JSON.stringify(a).slice(0,110));
  rec('理由が文字で読める（測定は続けられる、と書く）',
      /読み込めません/.test(a.注記)&&/続けられます/.test(a.注記),a.注記.slice(0,90));
  // ---- 4. エラー文を記録へ入れない ----
  rec('エラー文を品質情報として記録しない',
      !/読み込めません|WinError/.test(a.本文)
      && await page.evaluate(()=>!/読み込めません|WinError/.test(String(WL.measureView.collect().qualityInfo||''))),
      a.本文.slice(0,40));

  // ---- 3. 品質だけ読めなかった応答でも同じ ----
  await page.unroute(CTX);
  await page.route(CTX,async r=>{
   const res=await r.fetch();let j={};
   try{j=await res.json()}catch(e){j={}}
   j.quality=[];j.diagnostics=Object.assign({},j.diagnostics,
     {quality_error:"[WinError 5] アクセスが拒否されました。",quality_path:'\\\\srv\\Read\\SIKADEF.sqlite3'});
   r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)});
  });
  await page.evaluate(()=>WL.records.loadMeasurementContext(true));
  await page.waitForTimeout(400);
  const c=await qi();
  rec('品質だけ読めなかったときも札と注記が出る',
      c.読めません&&/品質情報を読み込めません/.test(c.注記),JSON.stringify(c).slice(0,110));

  // ---- 5. 読み直して成功したら消える ----
  await page.unroute(CTX);
  await page.evaluate(()=>WL.records.loadMeasurementContext(true));
  await page.waitForTimeout(600);
  const d=await qi();
  rec('読み直して成功したら注記は消える',!d.読めません&&!d.注記,JSON.stringify(d).slice(0,110));

  // 後片付け: この検証で作った記録を消す（§9.121）。
  await page.evaluate(async()=>{
   const id=S.measure&&S.measure.id;if(!id)return;
   try{await WL.records.deleteBackupRows([id])}catch(e){}
   try{await WL.records.reliableDelete(id)}catch(e){}
  });
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
