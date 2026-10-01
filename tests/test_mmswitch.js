/* test_mmswitch.js: マスタ管理のタブを切り替えたとき、前のタブの応答が
   今の画面を上書きしないこと（§9.331）。
   ------------------------------------------------------------
   専用の画面（`special:`。操業データ項目の盤など）は**取りに行ってから描く**
   ので、取りに行っている最中に別のタブへ移ると、後から届いた前のタブの盤が
   今の画面を上書きする——**見出しだけ新しいマスタで、中身は前の盤**。
   実際に「設備停止マスタ」の見出しの下に操業データ項目の盤が出て、
   「追加」が押せなくなった（`test_stopeq`が通しでだけ落ちる形で出ていた）。

   **応答をわざと遅らせること**（§9.312と同じ理由）——手元のマスタでは往復が
   一瞬なのでこの道をほとんど通らず、遅らせない網は直す前でも通る。
   マスタを共有に置いた端末では1回の取得に数秒かかる（§9.263／§9.273）ので、
   現場ではむしろこちらがふつう。 */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
run('test_mmswitch: マスタ管理のタブを切り替えても前のタブの応答が上書きしない（§9.331）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 遅らせた取得が「出ている最中」になるまで（前は固定の300ms）。この網は
    **応答が届く前に**タブを移ることで競り合いを作るので、先に取得が出ていることを
    条件にする。出なければ5秒で先へ進む（その先の判定が見る）。 */
 const live=new Set();
 page.on('request',r=>live.add(r));
 page.on('requestfinished',r=>live.delete(r));
 page.on('requestfailed',r=>live.delete(r));
 const inFlight=re=>W.poll(async()=>[...live].some(r=>re.test(r.url())),v=>v,5000,20);
 try{
  // 操業データ項目の盤が読む口だけを2秒遅らせる（他は素通し）。
  await page.route('**/api/operation-item-master*',async route=>{
   await new Promise(r=>setTimeout(r,2000));
   await route.continue();
  });
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await W.booted(page);await idle();

  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:10000});
  // 遅い盤の取得が終わる前に、汎用の一覧を持つタブへ移る。
  await inFlight(/\/api\/operation-item-master/);
  /* **汎用の一覧を持つタブ**を選ぶこと（見るのは「追加が押せる一覧が出るか」）。
     設備停止マスタは§9.397で専用画面（3ペイン）になったので、ここでは使わない
     ——`.op-bar`を持つ専用画面なので「前のタブの盤が残っている」と誤判定する。
     刃マスタも§9.529で専用の盤（2ペイン）になり「追加」を持たないので使わない（§9.537 で気づいた・
     それ以来この節は必ず落ちていた）。ロールマスタは汎用の一覧のまま。 */
  const moved=await page.evaluate(()=>{
   const b=document.querySelector('[data-master="roll"]');if(!b)return false;b.click();return true;});
  rec('ロールマスタのタブがある',moved);

  // 前のタブの応答（2秒後）が届いたあとまで待つ。
  await idle(600,8000);   // 遅らせた応答（2秒）が届いて取得が静まるまで

  const st=await page.evaluate(()=>({
   見出し:(document.querySelector('#masterMaintTitle,.mm-title')||{}).textContent||'',
   追加:!!document.getElementById('masterMaintAdd'),
   前の盤:!!document.querySelector('#masterMaintForm #opEqPick, #masterMaintForm .op-bar'),
  }));
  rec('見出しは切り替えた先のマスタ',/ロール/.test(st.見出し),st.見出し||'なし');
  rec('前のタブの盤が残っていない',!st.前の盤,JSON.stringify(st));
  /* **「見出しが変わった」だけを見ないこと**——見出しは取りに行く前に書くので、
     上書きされていても必ず通る。中身（押せる「追加」）まで見る。 */
  rec('切り替えた先の一覧が出ている（追加が押せる）',st.追加,JSON.stringify(st));

  // 遅い盤へ戻れること（負けたほうが描き直す作りで、戻る道を塞いでいないか）。
  await page.evaluate(()=>{const b=document.querySelector('[data-master="opItem"]');if(b)b.click()});
  await idle(600,8000);
  const back=await page.evaluate(()=>!!document.querySelector('#masterMaintForm #opEqPick, #masterMaintForm .op-bar'));
  rec('遅い盤のタブへ戻れる',back);

  /* ---- 汎用の一覧どうしでも同じこと ----
     専用の画面だけでなく、**汎用の一覧も取りに行ってから描く**。前のタブの
     行が今のタブの一覧に並ぶと、見出しと中身が食い違ったまま操作できてしまう
     （消すつもりで別のマスタの行を消せる）。 */
  await page.unroute('**/api/operation-item-master*');
  await page.route('**/api/bladeset-blade-master*',async route=>{
   await new Promise(r=>setTimeout(r,2000));
   await route.continue();
  });
  await page.evaluate(()=>{const b=document.querySelector('[data-master="bladesetBlade"]');if(b)b.click()});
  await inFlight(/\/api\/bladeset-blade-master/);
  await page.evaluate(()=>{const b=document.querySelector('[data-master="equipment"]');if(b)b.click()});
  await idle(600,8000);   // 遅らせた応答（2秒）が届いて取得が静まるまで
  const g=await page.evaluate(()=>({
   見出し:(document.querySelector('#masterMaintTitle,.mm-title')||{}).textContent||'',
   一覧:(document.getElementById('masterMaintList')||{}).textContent||''}));
  rec('見出しは設備マスタ',/^設備/.test(g.見出し)&&!/刃/.test(g.見出し),g.見出し||'なし');
  rec('前のタブの行が一覧に残っていない',
      g.一覧.indexOf('テスト設備A')>=0,(g.一覧||'').slice(0,120));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1700,height:1000}});
