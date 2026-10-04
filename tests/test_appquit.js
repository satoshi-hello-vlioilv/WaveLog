/* test_appquit.js: ×で閉じる前の確かめと、書込役が応答しないときの引き取り（§9.556・§9.301）
   ------------------------------------------------------------
   利用者の指示（§9.556）:
    「デスクトップ版になってポートの心配をしなくて良いので、アプリ終了ボタンは必要なく、
     削除希望です。×ボタンから普通に閉じて終了したいです」
   （§9.301 ②の「安全な終了ボタン」は外した。×で窓を閉じれば窓口の入力が閉じ、同じ片付け
    `watchdog._exit()`→`teardown()`を通って終わる。片付けそのものは`tests/test_scowner.py`が見る）

   ここで固定すること:
    1. 「アプリを終了」の入口も、終了の口（`/api/app/quit`）も無い
    2. ×のとき画面が聞かれたら（`WL.closeGuard.ask()`）、**失うものが無ければすぐ「閉じてよい」**と返す
       （確認を出さない——いつもの×は1回で閉じる）
    3. **保存していない測定があれば確認を出し**、理由を書く。「やめる」で`stay`・「閉じる」で`close`
    4. 書込役が応答しないときは、同期メニューで**理由が読めて引き取れる**（§9.301 ①）
       ——判定と文言はサーバーの`probe_owner()`の1箇所（§9.163）

   窓（Rust）への返事は`/__desktop/close`。ブラウザで回す網には窓が無いので、ルートで受け止めて数える。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

run('test_appquit: ×で閉じる前の確かめと、書込役が応答しないときの引き取り（§9.556・§9.301）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 窓への返事（`/__desktop/close`）を受け止めて数える（窓の代わり）。 */
 const answers=[];
 await page.route('**/__desktop/close',async r=>{
  try{answers.push(JSON.parse(r.request().postData()||'{}').answer)}catch(_){answers.push('?')}
  await r.fulfill({status:200,contentType:'application/json',body:'{"received":true}'});
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

  /* ---- 1) 入口も口も無い ------------------------------------------ */
  const entry=await page.evaluate(async()=>({
   ボタン:!!document.getElementById('appQuit'),足元:!!document.querySelector('.nav-foot'),
   覆い:!!document.getElementById('appQuitDone'),
   /* GET で聞く（POST の口が残っていればサーバーが落ちるので叩かない）。口が無ければ 404、
      POST だけの口が残っていれば 405 */
   口:(await fetch('/api/app/quit')).status,確認の口:(await fetch('/api/app/quit-check')).status}));
  rec('「アプリを終了」のボタン・足元の器・終了後の覆いが無い',
      !entry.ボタン&&!entry.足元&&!entry.覆い,JSON.stringify(entry));
  rec('終了の口（/api/app/quit・quit-check）が無い（×で閉じる）',entry.口===404&&entry.確認の口===404,
      JSON.stringify(entry));

  /* ---- 2) 失うものが無ければ、すぐ「閉じてよい」 ------------------ */
  answers.length=0;
  await page.evaluate(()=>WL.closeGuard.ask());
  await W.poll(async()=>answers.length,n=>n>=1,4000,50);
  const modal1=await page.evaluate(()=>{const m=document.getElementById('appConfirmModal');return !!m&&!m.hidden});
  rec('失うものが無ければ確認を出さずに「閉じてよい」と返す',answers.join()==='close'&&!modal1,
      JSON.stringify({answers,modal1}));

  /* ---- 3) 保存していない測定があれば確かめる（§9.202） ------------ */
  answers.length=0;
  await page.evaluate(()=>{WL.base.measureDirty=true});
  await page.evaluate(()=>{WL.closeGuard.ask()});
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  const conf=await page.evaluate(()=>({
   題:(document.getElementById('appConfirmTitle')||{}).textContent||'',
   本文:(document.getElementById('appConfirmBody')||{}).innerText.replace(/\s+/g,' '),
   OK:(document.getElementById('appConfirmOk')||{}).textContent||'',
   やめる:(document.getElementById('appConfirmCancel')||{}).textContent||''}));
  rec('保存していない測定があれば確認を出す',/閉じますか/.test(conf.題)&&/保存されていない測定/.test(conf.本文),
      JSON.stringify(conf).slice(0,200));
  rec('ボタンの文字が「閉じる」「やめる」',/閉じる/.test(conf.OK)&&/やめる/.test(conf.やめる),`${conf.OK} / ${conf.やめる}`);
  rec('確認を出したことを窓へ先に返す（窓は待ち切りで閉じない）',answers[0]==='asking',JSON.stringify(answers));
  await page.click('#appConfirmCancel');
  await closed();
  await W.poll(async()=>answers.length,n=>n>=2,4000,50);
  rec('「やめる」なら閉じない（stay を返す）',answers.join()==='asking,stay',JSON.stringify(answers));
  answers.length=0;
  await page.evaluate(()=>{WL.closeGuard.ask()});
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:10000});
  await page.click('#appConfirmOk');
  await closed();
  await W.poll(async()=>answers.length,n=>n>=2,4000,50);
  rec('「閉じる」なら close を返す',answers.join()==='asking,close',JSON.stringify(answers));
  await page.evaluate(()=>{WL.base.measureDirty=false});

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
  /* 引き取りの口が叩かれるまで待ち、そのあと取得が静まるまで待つ
     （2回目が出るならこの間に出る——「1回だけ」を見る判定なので上限の待ちで止めない）。 */
  await W.poll(async()=>takeCalls,n=>n>=1,8000,50);
  await idle(800);
  rec('確認してから引き取る（口を1回だけ叩く）',takeCalls===1,`take=${takeCalls}回`);
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  try{await page.unroute('**/__desktop/close')}catch(_){/* 既に外れていれば何もしない（後片付け） */}
  try{await page.evaluate(()=>{WL.base.measureDirty=false})}catch(_){/* 落ちた後のページでは戻せない（読み直せば消える） */}
  try{await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})})}catch(_){/* 落ちた後のページでは戻せない（次の本がモードを入れ直す） */}
 }

}, {viewport:{width:1600,height:1000}});
