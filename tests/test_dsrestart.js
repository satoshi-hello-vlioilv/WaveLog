/* test_dsrestart.js: 名称の変更が再起動待ちであることを画面に出す（§9.183）
   ------------------------------------------------------------
   データソースの**表示名も接続先と同じく起動時に1回だけ決まる**
   (`DBS`はプロセス起動時の写し)。読み込み先については既にマスタ管理画面が
   「再起動待ち」を出していたが、**名称の変更は誰も何も言わなかった**ため、
   左のボタンが古い名前のまま残っているのを見て「マスタで直したのに
   反映されない」と受け取られた。

   ここで固定するのは:
    1. サーバーが突き合わせて返すこと(`/api/catalog`の`restartPending`)
       ——画面で推測しない
    2. 左メニューに案内が出て、**何が待っているか**が文字で分かること
    3. 待ちが無いときは出さないこと（常設すると読み流される）
    4. 押すとデータ接続の設定が開くこと（気づく場所と打つ手を同じ場所に） */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 let saved=null,work=null;
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
                           localStorage.setItem('AccessMeasurementUserId','tester')});

  /* ---- 0) 待ちが無いうちは案内を出さない ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#nav [data-db-key]',{timeout:20000});
  rec('待ちが無いときは案内を出さない',
      await page.evaluate(()=>!document.getElementById('navRestartPending')));

  /* ---- 1) 名称だけを変える（読み込み先は触らない） ---- */
  work=await page.evaluate(async()=>{
   const r=await (await fetch('/api/data-source-master')).json();
   return (r.items||[]).find(x=>x.purpose==='作業')||null;
  });
  rec('役割「作業」のデータソースがある',!!work,work?work.key:'');
  saved=work&&work.label;
  const changed=await page.evaluate(async w=>{
   const r=await fetch('/api/data-source-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...w,id:w.id,label:w.label+'（改）',user_id:'tester'})});
   const j=await r.json();
   const cat=await (await fetch('/api/catalog')).json();
   return {save:j.error||'ok',pending:cat.restartPending||[]};
  },work);
  rec('サーバーが「名称が再起動待ち」と答える',
      changed.pending.some(x=>x.kind==='label'&&x.key===work.key),JSON.stringify(changed));
  rec('いまの名称と再起動後の名称の両方を返す',
      changed.pending.some(x=>x.now===saved&&x.next===saved+'（改）'),JSON.stringify(changed.pending));

  /* ---- 2) 左メニューに案内が出る ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#navRestartPending',{timeout:20000});
  const note=await page.evaluate(()=>{
   const el=document.getElementById('navRestartPending');
   return {text:el.innerText.replace(/\s+/g,' '),title:el.title,
           inNav:!!el.closest('#nav')};
  });
  rec('左メニュー（一覧を見る）の中に出る',note.inNav,JSON.stringify(note).slice(0,140));
  rec('件数と何が待っているかを文字で出す',
      /1件が再起動待ち/.test(note.text)&&/名称/.test(note.text),note.text.slice(0,120));
  rec('いまの名前も添える（どちらが今なのか分かる）',
      note.text.includes(saved),note.text.slice(0,120));
  rec('再起動で反映されると書く',/再起動/.test(note.text),note.text.slice(0,120));

  /* ---- 3) 押すとデータ接続の設定が開く ---- */
  await page.click('#navRestartPending');
  await page.waitForSelector('#masterMaintList',{timeout:15000});
  const opened=await page.evaluate(()=>{
   const on=document.querySelector('#masterMaintNav .is-active,#masterMaintNav [aria-current="true"]');
   return {mode:document.body.classList.contains('mm-mode'),
           tab:on?on.textContent.trim():'',cards:document.querySelectorAll('.ds-card').length};
  });
  rec('押すとデータ接続の設定が開く',opened.mode&&opened.cards>0,JSON.stringify(opened));
  const card=await page.evaluate(()=>{
   const c=[...document.querySelectorAll('.ds-card')].find(x=>x.classList.contains('is-pending'));
   return c?c.innerText.replace(/\s+/g,' '):'';
  });
  rec('カードにも「再起動待ち（名称）」と出る',/再起動待ち/.test(card)&&/名称/.test(card),card.slice(0,140));
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 名称を必ず戻す(残すと次の実行以降ずっと再起動待ちが出る)。 */
  try{if(work&&saved!=null)await page.evaluate(async([w,label])=>{
   await fetch('/api/data-source-master/update',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...w,id:w.id,label,user_id:'tester'})});
  },[work,saved])}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
