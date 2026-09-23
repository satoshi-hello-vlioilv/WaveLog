/* test_scwarm.js: 開く前に用意し、見えないものは作らない(§9.182)
   ============================================================
   利用者の指示は「スケジュールモードへの読み込みが少し遅い。ローカルデータや
   バックグラウンド処理を有効に活かして、ユーザーに読み込み待ちを意識させない
   ようにデータの準備を行い、間に合わない状況になった場合にのみWAITING表示を
   出すように、速度と読み込み順改良して」。
   ここで固定するのは**時間ではなく形**（時間で固定すると環境差で落ちる）。
    1. 表示設定と予定を**同時に**取り始める（1本ずつ待たない）
    2. 仕掛一覧を畳んでいるあいだは**中身を読まない**（見えないものを作らない）
    3. 畳んだ帯を開いた時点で読む（押しても空、にしない）
    4. 俯瞰ボードは手が空いた時点で先に取っておく（押す前に用意できている）
    5. 2回目はキャッシュから出すので待機表示を出さない
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
run('test_scwarm: 開く前に用意し、見えないものは作らない(§9.182)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 要求の「開始」を記録する。**開始時刻だけを見る**——応答の速さは環境で
    変わるが、「1本ずつ待っているか」は開始の並びに出る。 */
 const started=[];
 page.on('request',r=>{const u=r.url();if(u.includes('/api/'))started.push({u:u.replace(B,''),t:Date.now()})});
 const since=n=>started.filter(x=>x.t>=n);
 try{
 /* モードは土台が入れて、終わりに edit へ戻す（以前は schedule のまま残していた）。 */
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}));
   localStorage.setItem('scSplitListCollapsedV1','1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  /* ---- 4) 手が空いたら俯瞰ボードを先に取っておく ----
     待つのは**先取りの要求が出ること**そのもの。時間で待つと、遅い端末では
     出る前に見て落ち、速い端末では無駄に3秒寝る。出なければ上限で抜けて
     下の判定が落ちる。 */
  await W.poll(async()=>started.some(x=>x.u.startsWith('/api/schedule/overview')),v=>v,8000);
  const warmed=started.some(x=>x.u.startsWith('/api/schedule/overview'));
  rec('押す前に俯瞰ボードを取っておく',warmed,JSON.stringify(started.map(x=>x.u).filter(u=>u.includes('schedule')).slice(0,4)));

  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:30000});
  await idle();

  /* ---- 1) 表示設定と予定を同時に取り始める ---- */
  const t0=Date.now();
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  /* この画面ぶんの取得が出そろってから数える（取得中の数が0のまま静か）。 */
  await idle();
  const batch=since(t0);
  const plan=batch.find(x=>x.u.startsWith('/api/schedule/plan'));
  const layout=batch.find(x=>x.u.startsWith('/api/column-layout-master'));
  const first=batch.length?Math.min(...batch.map(x=>x.t)):0;
  rec('予定と表示設定を同時に取り始める',
      !!plan&&!!layout&&(plan.t-first)<150&&(layout.t-first)<150,
      JSON.stringify({plan:plan?plan.t-first:null,layout:layout?layout.t-first:null,n:batch.length}));

  /* ---- 2) 畳んでいるあいだは仕掛一覧の中身を読まない ----
     **見るのは品質データ結合つきの問い合わせ**(join_quality=1)。作業可否や
     予定済みロットの印は`columns=`で要る列だけを引く別物で、これは畳んで
     いても要る（隠すと行の「可/不可」が出なくなる）。組み立てを止めたいのは
     隣に並べる一覧そのもの。 */
  const listReq=batch.filter(x=>x.u.includes('join_quality=1'));
  const collapsed=await page.evaluate(()=>!!document.querySelector('.sc-split-wrap.sc-list-collapsed'));
  rec('スケジュールだけのときは畳まれている',collapsed,String(collapsed));
  rec('畳んでいるあいだは仕掛一覧を組み立てない',listReq.length===0,
      JSON.stringify(listReq.map(x=>x.u.slice(0,40))));
  rec('それでも予定は出ている',
      (await page.evaluate(()=>document.querySelectorAll('.sc-row-line').length))>0,'');

  /* ---- 3) 開いた時点で読む ---- */
  const t1=Date.now();
  await page.click('.sc-split-collapse-btn');
  await page.waitForFunction(()=>!!document.querySelector('.sc-split-wrap #grid table tbody tr'),
    null,{timeout:30000});
    await idle();
    const opened=since(t1);
  console.log('  (開いた後の要求)',JSON.stringify(opened.map(x=>x.u.slice(0,46))));
  const joined=await page.evaluate(()=>({rows:document.querySelectorAll('.sc-split-wrap #grid table tbody tr').length,
    join:!!(window.S&&S.joinQuality),cols:[...document.querySelectorAll('.sc-split-wrap #grid thead th')].map(x=>x.dataset.col||'').filter(Boolean).length}));
  rec('開いた時点で仕掛一覧が使える',joined.rows>0&&joined.cols>5,JSON.stringify(joined));

  /* ---- 5) 2回目は待機表示を出さない ---- */
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid th',{timeout:20000}); await idle();
  let sawOverlay=false;
  const watch=setInterval(async()=>{
   try{if(await page.evaluate(()=>document.querySelector('#saveOverlay')?.hidden===false))sawOverlay=true}catch(e){}
  },60);
  await page.click('#openSchedule');
  /* スケジュールモードは俯瞰ボードから始まる(§9.9)ので、設備を選び直す。
     **行が「見えている」ことで判定しない**——ボード表示のあいだは前回の行が
     DOMに残ったまま隠れているので、見えるまで待つと永久に待つ。 */
  await page.waitForSelector('.sc-board-row',{timeout:30000});
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForFunction(()=>{
   const b2=document.querySelector('#scSingleBody');
   return b2&&!b2.hidden&&document.querySelectorAll('.sc-row-line').length>0;
  },null,{timeout:30000});
  /* 見えたあとも、取得が静まるまでは覆いを見張り続ける。 */
  await idle();
  clearInterval(watch);
  rec('2回目は待機表示を出さない（キャッシュから出す）',!sawOverlay,String(sawOverlay));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){rec('FATAL',false,String(e&&e.message||e))}
 }, {mode:'schedule', viewport:{width:1700,height:1000}});
