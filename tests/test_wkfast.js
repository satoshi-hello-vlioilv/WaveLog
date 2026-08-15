/* §9.67 作業可否フラグを予定側の保存値で即座に作る。
   ・仕掛一覧から投入した予定は往復ゼロで「可」になるか
   ・1件追加しても既存行のフラグが「?」へ戻らないか
   ・取り直しは「可でない行」だけに絞られているか */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=async(p,b)=>{const r=await fetch(B+p,{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()};
const setMode=m=>post('/api/access-mode',{mode:m});
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
let b=null;
(async()=>{
 await setMode('schedule');
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 // 仕掛への問い合わせ回数を数える(作業可否の判定材料の取得)
 let tableCalls=0;
 await page.route('**/api/table?*',route=>{
   const u=route.request().url();
   if(u.includes('SIKALOTNOW')&&u.includes('include_hidden=1'))tableCalls++;
   route.continue();
 });
 const flags=()=>page.evaluate(()=>{
  const c={};document.querySelectorAll('.sc-row-line .sc-row-workable').forEach(n=>{
   const k=[...n.classList].find(x=>x.startsWith('is-'));c[k]=(c[k]||0)+1});return c});
 const planRows=()=>page.evaluate(()=>document.querySelectorAll('.sc-row-line').length);
 /* 可否の裏取りが落ち着くまで待つ(§9.102: 待ちは時間でなく条件で置く)。
    「?」が1つも無い状態を待つ。取り直しが要らなければ即座に真になるので、
    速い画面では待たない。**取り直しが本当に終わらない場合の保険**として
    上限を置き、超えたら黙って先へ進む(その先の判定でFAILとして出る)。 */
 const settleFlags=(pg,ms=30000)=>pg.waitForFunction(
   ()=>{const ns=[...document.querySelectorAll('.sc-row-line .sc-row-workable')];
        return ns.length>0&&!ns.some(n=>n.classList.contains('is-unknown'))},
   null,{timeout:ms}).catch(()=>{});

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
   .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 // **時間でなく状態で待つ**(§9.102): 可否の裏取りが止まる=「?」が無くなるまで。
 // 取り直しが要らない予定ばかりなら即座に真になる。
 await settleFlags(page);
 // 追加前の予定IDを控えておく(後始末で自分が足したぶんだけ消すため)。
 // 消さずに終わると共有フィクスチャが実行のたびに増え、後続テストの
 // 読み込みが遅くなって時間切れで落ちる(実際にtest_colsを巻き込んだ)。
 const planIds=async()=>{
  const r=await (await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))).json();
  return new Set((r.entries||[]).filter(e=>!e.unplanned).map(e=>String(e.id)));
 };
 const idsBefore=await planIds();
 const before=await flags(),beforeRows=await planRows();
 console.log('  初期状態:',JSON.stringify(before),beforeRows+'行');

 // --- 仕掛一覧から1件追加し、往復ゼロで「可」になるか ---
 await page.waitForSelector('.plan-action-button',{timeout:20000});
 tableCalls=0;
 const t0=Date.now();
 await page.evaluate(()=>document.querySelector('.plan-action-button').click());
 // 追加直後(描画1フレーム)の時点でフラグが確定しているかを見る
 await page.waitForFunction(n=>document.querySelectorAll('.sc-row-line').length>n,
   beforeRows,{timeout:10000});
 const addedFlagNow=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.sc-row-line')];
  const last=rows[rows.length-1];
  const cell=last?.querySelector('.sc-row-workable');
  return cell?[...cell.classList].find(x=>x.startsWith('is-')):null;
 });
 const ms=Date.now()-t0;
 rec('追加した予定が即座に「可」になる(保存値から判定)',addedFlagNow==='is-ok',
   `${addedFlagNow} / ${ms}ms`);
 rec('判定のための仕掛への問い合わせが発生しない',tableCalls===0,tableCalls+'回');

 // --- 既存行のフラグが「?」へ戻らない ---
 await settleFlags(page);
 const after=await flags();
 rec('追加しても既存行が「?」へ戻らない',!after['is-unknown'],JSON.stringify(after));
 rec('可の行が減っていない',(after['is-ok']||0)>=(before['is-ok']||0),
   `${before['is-ok']||0} → ${after['is-ok']||0}`);

 // --- 続けて数件追加しても問い合わせが増えない ---
 tableCalls=0;
 for(let i=0;i<3;i++){
  const n=await planRows();
  await page.evaluate(()=>document.querySelector('.plan-action-button')?.click());
  await page.waitForFunction(x=>document.querySelectorAll('.sc-row-line').length>x,n,{timeout:10000}).catch(()=>{});
 }
 await settleFlags(page);
 const after3=await flags();
 rec('続けて追加しても全件走査が起きない',tableCalls===0,tableCalls+'回');
 rec('追加後も「?」が出ない',!after3['is-unknown'],JSON.stringify(after3));

 // --- 再読み込みしても保存値から判定できる(往復ゼロ) ---
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
   .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 const firstPaint=await flags();
 // 投入時に残仕掛設備ｺｰｽを保存している予定は、**仕掛を1回も読まずに**
 // 最初の描画で確定している。保存が無い古い予定(APIで直接作った検証用
 // データ等)だけが「?」で始まり、裏の取り直しで確定する。
 const resolvedAtPaint=(firstPaint['is-ok']||0)+(firstPaint['is-ng']||0);
 rec('開き直した直後から保存値で判定できている行がある',resolvedAtPaint>0,
   JSON.stringify(firstPaint));
 rec('保存値だけで判定した時点では仕掛を読んでいない',
   (await page.evaluate(()=>window.scheduleWorkableState())).pages===0,
   JSON.stringify(await page.evaluate(()=>window.scheduleWorkableState())));
 // 保存の無い古い予定も、裏の取り直しで「?」が解消される
 const gone=await page.waitForFunction(()=>![...document.querySelectorAll('.sc-row-workable')]
   .some(n=>n.classList.contains('is-unknown')),null,{timeout:60000})
   .then(()=>true).catch(()=>false);
 rec('保存が無い古い予定も裏の取り直しで「?」が解消される',gone,
   JSON.stringify(await flags()));

 // --- 「再計算」は可も含めて情報源を取り直す ---
 tableCalls=0;
 await page.evaluate(()=>document.querySelector('#scRefresh').click());
 // 取り直しが**始まった**ことは問い合わせ回数で分かるので、そこまで待つ
 // (6秒固定で待っていた箇所。速い機械では無駄、遅い機械では足りない)。
 for(let i=0;i<100&&tableCalls===0;i++)await new Promise(r=>setTimeout(r,100));
 await settleFlags(page);
 rec('「再計算」では情報源を取り直す(全件検証)',tableCalls>0,tableCalls+'回');
 const afterRecalc=await flags();
 rec('再計算後も判定が崩れない',!afterRecalc['is-unknown']&&(afterRecalc['is-ok']||0)>0,
   JSON.stringify(afterRecalc));

 // 後始末: この設備の編集セッションを明示的に手放してから閉じる。
 // 握ったまま終わると、TTLが切れるまで後続テストが「他端末が編集中」の
 // 画面になり、無関係な失敗を生む(実際にtest_colsを巻き込んだ)。
 try{
  const idsAfter=await planIds();
  const added=[...idsAfter].filter(id=>!idsBefore.has(id));
  for(const id of added)await post('/api/schedule/plan/delete',{id,user_id:'test'});
  if(added.length)console.log('  後始末: 追加した予定 '+added.length+'件を削除');
  await post('/api/schedule/session/release',{equipment:EQ});
 }catch(e){console.log('  後始末に失敗',e.message)}
 await setMode('edit');
 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 try{await post('/api/schedule/session/release',{equipment:EQ})}catch(_){}
 try{await setMode('edit')}catch(_){}
 process.exit(2)});
