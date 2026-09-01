/* test_appquit.js: 安全な終了と、書込役が応答しないときの引き取り（§9.301）
   ------------------------------------------------------------
   利用者の指示:
    「書き込み役が自分ではない場合に、書き込み失敗するような場合、相手のPCが
     落ちている可能性があります…PC落ちか、スリープ中？サーバー落ちを判断して
     書き込み権限を執行する機能などを実装しておく必要もありそうです。
     そういう意味で安全なアプリの終了ボタンも欲しいです」

   ここで固定すること:
    1. 左メニューの足元に「アプリを終了」があり、**畳んでもアイコンで残る**
    2. 押すと**何が起きるか**が確認に並ぶ（書込役・編集セッション・接続状況・タブ数）
    3. **未保存の測定があれば、それを先に言う**（§9.202。端末の中にあるので
       画面しか知らない）
    4. 「やめる」で**終了しない**
    5. 書込役が応答しないときは、同期メニューで**理由が読めて引き取れる**
       ——判定と文言はサーバーの`probe_owner()`の1箇所（§9.163）なので、
       画面は返ってきた`label`/`note`をそのまま出す

   **実際には終了させない。** 終了するとこのあとの全部のテストが動かなく
   なるので、確認までで止める（終了そのものはサーバー側の
   `tests/test_scowner.py`が`watchdog.teardown()`で見る）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 /* **終了の口は絶対に通さない。** 押し間違い（配線の書き間違い）でサーバーが
    落ちると、このあとの全部のテストが道連れになる。 */
 let quitCalls=0;
 await page.route('**/api/app/quit',async r=>{
  quitCalls++;
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,stopping:true})});
 });
 /* **閉じたことは`hidden`で見る**——`waitForSelector`の既定は「見えるまで」
    なので、`[hidden]`を待つと永久に来ない（実際に踏んだ）。 */
 const closed=()=>page.waitForFunction(
   ()=>!!document.getElementById('appConfirmModal')?.hidden,null,{timeout:8000});
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  /* **モードは自分で決める**——前のテストが切り替えたまま終わっていても
     影響を受けないように（§9.121）。 */
  await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});

  /* ---- 1) 入口 ---------------------------------------------------- */
  const entry=await page.evaluate(()=>{
   const btn=document.getElementById('appQuit');
   if(!btn)return null;
   const r=btn.getBoundingClientRect();
   const aside=document.querySelector('.layout>aside').getBoundingClientRect();
   const nav=[...document.querySelectorAll('aside .nav-item')].filter(x=>x!==btn
     &&x.getBoundingClientRect().height>0);
   const lowest=Math.max(...nav.map(x=>x.getBoundingClientRect().bottom));
   return {文字:btn.textContent.replace(/\s+/g,' ').trim(),
           見えている:r.width>0&&r.height>0,
           左メニューの中:r.left>=aside.left-1&&r.right<=aside.right+1,
           他の行き先より下:r.top>=lowest-1,
           説明:btn.title||''};
  });
  rec('左メニューに「アプリを終了」がある',!!entry&&entry.見えている&&/終了/.test(entry.文字),
      JSON.stringify(entry));
  /* **危ない操作を主要動線に置かない**（§CLAUDE 5）——行き先の並びより下。 */
  rec('行き先の並びより下（足元）に置く',!!entry&&entry.他の行き先より下,JSON.stringify(entry));
  rec('何をするボタンかを説明に書く',!!entry&&/片付け|終了/.test(entry.説明),entry&&entry.説明);

  /* 畳んでもアイコンで残る（§9.265）。ここが消えると、畳んだ端末から
     安全に終了する手立てが無くなる。 */
  const folded=await page.evaluate(()=>{
   document.getElementById('navCollapseToggle')?.click();
   const btn=document.getElementById('appQuit');
   const r=btn.getBoundingClientRect();
   return {見えている:r.width>0&&r.height>0,
           呼び名:btn.dataset.navLabel||'',アイコン:!!btn.querySelector('svg')};
  });
  rec('メニューを畳んでもアイコンで残る',folded.見えている&&folded.アイコン,JSON.stringify(folded));
  rec('畳んだときの呼び名を持つ（浮き出しで読める・§9.265）',/終了/.test(folded.呼び名),folded.呼び名);
  await page.evaluate(()=>document.getElementById('navCollapseToggle')?.click());
  await page.waitForTimeout(200);

  /* ---- 2) サーバーが「何が起きるか」を答える ---------------------- */
  const facts=await page.evaluate(async()=>await (await fetch('/api/app/quit-check')).json());
  rec('サーバーが終了前の事実を答える',
      facts.ok===true&&typeof facts.tabs==='number'
      &&typeof facts.isOwner==='boolean'&&Array.isArray(facts.sessions),
      JSON.stringify(facts));
  rec('開いているタブの数を数えている（1つ以上）',Number(facts.tabs)>=1,String(facts.tabs));

  /* ---- 3) 押すと確認が出る（まだ終了しない） ---------------------- */
  await page.click('#appQuit');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  const conf=await page.evaluate(()=>{
   const m=document.getElementById('appConfirmModal');
   return {題:(document.getElementById('appConfirmTitle')||{}).textContent||'',
           本文:(document.getElementById('appConfirmBody')||{}).innerText.replace(/\s+/g,' '),
           件数:m.querySelectorAll('.confirm-modal-list li').length,
           OK:(document.getElementById('appConfirmOk')||{}).textContent||'',
           やめる:(document.getElementById('appConfirmCancel')||{}).textContent||''};
  });
  rec('押すと確認が出る（いきなり終了しない・§CLAUDE 5）',/終了しますか/.test(conf.題),conf.題);
  rec('何が起きるかを1行ずつ並べる（押す前に数えられる・§6）',conf.件数>=2,
      JSON.stringify({件数:conf.件数,本文:conf.本文.slice(0,120)}));
  rec('接続状況からこのPCを消すことを書く',/接続状況/.test(conf.本文),conf.本文.slice(0,160));
  rec('ボタンの文字が「終了する」「やめる」',/終了する/.test(conf.OK)&&/やめる/.test(conf.やめる),
      `${conf.OK} / ${conf.やめる}`);
  await page.click('#appConfirmCancel');
  await closed();
  rec('「やめる」で終了しない（口を叩かない）',quitCalls===0,`quit=${quitCalls}回`);
  const alive=await page.evaluate(async()=>(await fetch('/api/build')).ok);
  rec('サーバーは生きたまま',alive===true,String(alive));

  /* ---- 4) 未保存の測定があれば、それを先に言う（§9.202） ---------- */
  await page.evaluate(()=>{try{markDirty()}catch(e){}});
  await page.click('#appQuit');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  const dirty=await page.evaluate(()=>({
   本文:(document.getElementById('appConfirmBody')||{}).innerText.replace(/\s+/g,' ')}));
  rec('未保存の測定があるときは先に言う',/保存されていない測定/.test(dirty.本文),
      dirty.本文.slice(0,140));
  await page.click('#appConfirmCancel');
  await closed();
  rec('ここまで一度も終了していない',quitCalls===0,`quit=${quitCalls}回`);

  /* ---- 5) 書込役が応答しないときの引き取り（§9.301 ①） -----------
     **応答を差し替えて「応答しない書込役」を作る**——実機でその状態を
     待つことはできないし、判定はサーバーが持つので画面は答えを出すだけ
     （§9.163）。差し替えて確かめるのは「その答えが画面に出るか」と
     「押せるか」の2つ。 */
  await page.route('**/api/schedule/owner-status',async r=>{
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    ok:true,enabled:true,configured:true,running:true,isOwner:false,
    ownerPc:'GHOST-PC',ownerLogin:'ghost',ownerUrl:'http://GHOST-PC:5030',
    ownerAliveSec:12,ttlSec:90,port:5030,relays:3,relayFail:2,
    lastError:'持ち主へ届きません',relayDownSec:24,
    relayDownWhy:'http://GHOST-PC:5030: [Errno 111] Connection refused',
    takenFrom:null,myUrls:[]})});
  });
  let takeCalls=0;
  await page.route('**/api/schedule/owner-probe',async r=>{
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,probe:{
    state:'refused',label:'書込役のPCは動いていますが、アプリが終了しています',
    note:'アプリだけが落ちた（または閉じられた）状態です。引き取れます',
    canTake:true,ownerPc:'GHOST-PC',aliveSec:12,ttlSec:90,tried:[]}})});
  });
  await page.route('**/api/schedule/owner-take',async r=>{
   takeCalls++;
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
  });
  await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'schedule'})})});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(()=>{
   const el=document.getElementById('scSyncChip');return el&&!el.hidden&&el.textContent.trim();
  },null,{timeout:20000});
  await page.click('#scSyncChip');
  await page.waitForSelector('#scSyncMenu',{timeout:10000});
  /* **休んでいる理由が読める**（§4）——書込役が居るのに自分で書いている
     ことが読めないと、利用者からは「書き込みに失敗している」ように見える。 */
  const down=await page.evaluate(()=>{
   const m=document.getElementById('scSyncMenu');
   return {文:m.innerText.replace(/\s+/g,' '),
           調べる:!!m.querySelector('#scOwnerProbeBtn')};
  });
  rec('中継を休んでいることと理由を書く',/自分で書いています/.test(down.文),down.文.slice(0,200));
  rec('「書込役を調べる」がある',down.調べる===true,JSON.stringify(down.調べる));
  await page.click('#scOwnerProbeBtn');
  await page.waitForSelector('#scOwnerTakeBtn',{timeout:10000});
  const probe=await page.evaluate(()=>{
   const box=document.querySelector('.sc-owner-probe');
   return {文:box?box.innerText.replace(/\s+/g,' '):'',
           印:!!(box&&box.classList.contains('is-warn'))};
  });
  /* **文言はサーバーが持つ**（§9.163）——画面が言い直していないことを、
     返した文字がそのまま出ていることで見る。 */
  rec('サーバーの切り分けをそのまま出す（言い直さない）',
      /PCは動いていますが、アプリが終了しています/.test(probe.文)
      &&/アプリだけが落ちた/.test(probe.文),probe.文.slice(0,160));
  rec('引き取れることを色だけで伝えない（文字で書く）',/引き取れます/.test(probe.文)&&probe.印,
      JSON.stringify(probe.印));
  /* 引き取りは**確認してから**（§CLAUDE 5）。 */
  await page.click('#scOwnerTakeBtn');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  const tconf=await page.evaluate(()=>({
   題:(document.getElementById('appConfirmTitle')||{}).textContent||'',
   本文:(document.getElementById('appConfirmBody')||{}).innerText.replace(/\s+/g,' ')}));
  rec('引き取りは確認してから',/引き取りますか/.test(tconf.題),tconf.題);
  rec('なぜ引き取れるのかを確認に書く',/アプリが終了しています/.test(tconf.本文),
      tconf.本文.slice(0,140));
  await page.click('#appConfirmCancel');
  await closed();
  rec('「やめる」なら引き取らない',takeCalls===0,`take=${takeCalls}回`);
  await page.click('#scOwnerTakeBtn');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  await page.click('#appConfirmOk');
  await page.waitForFunction(()=>window.__takeDone||true,null,{timeout:2000}).catch(()=>{});
  await page.waitForTimeout(1200);
  rec('確認してから引き取る（口を1回だけ叩く）',takeCalls===1,`take=${takeCalls}回`);
  rec('最後まで一度も終了していない',quitCalls===0,`quit=${quitCalls}回`);
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  try{await page.unroute('**/api/app/quit')}catch(_){}
  try{await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})})}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
