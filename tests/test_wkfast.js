/* §9.67 作業可否フラグを予定側の保存値で即座に作る。
   ・仕掛一覧から投入した予定は往復ゼロで「可」になるか
   ・1件追加しても既存行のフラグが「?」へ戻らないか
   ・取り直しは「可でない行」だけに絞られているか */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const post=async(p,b)=>{const r=await fetch(B+p,{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return r.json()};
run('test_wkfast: §9.67 作業可否フラグを予定側の保存値で即座に作る。', async ({page,rec,B,W,idle,errs,browser})=>{
 try{
 /* 仕掛への問い合わせ回数を数える(作業可否の判定材料の取得)。
    **`include_hidden=1`で見分けないこと**(§9.200)——§9.165で表示マスタごと
    廃止したので、いまの画面はこの引数を付けない（付けるなと明記されている）。
    数えているつもりで**1件も数えていなかった**ため、「再計算では情報源を
    取り直す」が常に0回で落ちていた。仕掛(役割=仕掛のDB)への
    問い合わせかどうかだけで数える。 */
 let tableCalls=0;
 await page.route('**/api/table?*',route=>{
   if(route.request().url().includes('SIKALOTNOW'))tableCalls++;
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
 // **この実行で仕掛一覧から投入した行**を控える。§9.67が保証するのは
 // 「投入時に残仕掛設備ｺｰｽを保存した行は往復ゼロで確定する」ことなので、
 // 見るべきはその行であって、予定に載っている全部ではない。
 const addedIds=[...await planIds()].filter(id=>!idsBefore.has(id));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
   .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
 await page.waitForSelector('.sc-row-line',{timeout:20000});
 /* **1回の測定で取る**。`flags()`のあとに別の往復で行を見に行くと、その
    数ミリ秒のあいだに裏の取り直しが終わってしまい、「最初の描画」ではなく
    「取り直したあと」を測ることになる（保存値を読まない欠陥を注入しても
    素通りした——測っている場所が違った）。全体の内訳と、投入した行の状態を
    **同じ評価の中で**そろえて持ち帰る。 */
 const paint=await page.evaluate(ids=>{
  const c={};
  document.querySelectorAll('.sc-row-line .sc-row-workable').forEach(n=>{
   const k=[...n.classList].find(x=>x.startsWith('is-'));c[k]=(c[k]||0)+1});
  const unknown=ids.filter(id=>{
   const q=document.querySelector(
     `.sc-row-line[data-id="${CSS.escape(id)}"] .sc-row-workable`);
   return !q||q.classList.contains('is-unknown');
  });
  return {flags:c,unknown};
 },addedIds);
 const firstPaint=paint.flags;
 // 投入時に残仕掛設備ｺｰｽを保存している予定は、**仕掛を1回も読まずに**
 // 最初の描画で確定している（「?」が1つも無い）。
 // **取り直しに行くのは「可」でない行のため**（§9.67 の `lotsNeedingLookup` は
 // `state!=='ok'` を集める）。種データは「可」と「不可」の両方を持つ（不可10件。
 // `make_fixture.py` が意図してそうしている）ので、**`pages===0` は成り立たない**
 // ——以前ここで見ていた「1回も読んでいない」は、前の実行が残した実績で予定の
 // 状態が変わり、たまたま不可が0になった回にだけ通っていた（§9.356）。
 const resolvedAtPaint=(firstPaint['is-ok']||0)+(firstPaint['is-ng']||0);
 rec('開き直した直後から保存値で判定できている行がある',resolvedAtPaint>0,
   JSON.stringify(firstPaint));
 const st0=await page.evaluate(()=>window.scheduleWorkableState());
 /* **予定の全部に「?」が無い**とは言えない。保存を持たない古い予定
    （他の網がAPIで直に作った行など）は最初の描画で「?」になり、すぐ下の
    「裏の取り直しで解消される」がまさにそれを見ている——2つの言い切りは
    同時には成り立たない。単独では保存の無い行がたまたま0件だったので
    通っていただけで、通しの実行でだけ落ちていた（§9.356。この直前の
    `pages===0` と同じ形の言い過ぎが1つ残っていた）。
    **投入した行だけ**を見れば、保存値で確定しているかを取り違えずに測れる
    ——保存を持つ行が「?」になれば、残りが何件あっても落ちる。 */
 rec('仕掛一覧から投入した行は開き直した直後から「?」でない',
   addedIds.length>0&&paint.unknown.length===0,
   `投入${addedIds.length}件 / うち「?」${paint.unknown.length}件 -- `
   +JSON.stringify(firstPaint));
 rec('仕掛を読みに行くのは「可」でない行があるときだけ',
   st0.pages===0||(firstPaint['is-ng']||0)>0,
   JSON.stringify({...st0,firstPaint}));
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
 // eslint-disable-next-line no-unmodified-loop-condition -- tableCalls は page.route の側で増える
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
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  try{await post('/api/schedule/session/release',{equipment:EQ})}catch(_){}
 }
}, {mode:'schedule', viewport:{width:1700,height:1000}});
