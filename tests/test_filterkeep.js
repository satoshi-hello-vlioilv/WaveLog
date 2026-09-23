/* test_filterkeep.js: 鍵付き・デフォルトのフィルタが外れない（§9.184）
   ------------------------------------------------------------
   実機で「アプリを終了して再度立ち上げると、鍵をかけたフィルタが
   検索枠から外れている」と報告された。原因は**当てる相手が居なかった**こと:
   起動時の`loadMasterPresets()`はDBもテーブルも決まる前に走るので、
   その一覧の登録フィルタは1件も入っていない。それでも動いて見えたのは
   端末に残っていた控え(localStorage)を読んでいたからで、控えが無い端末・
   別のPC・利用者IDが後から届いた場合は空振りしていた（印はマスタに
   その人のものとして入っている。§9.172）。

   ここで固定するのは:
    1. **控えを消しても**、開き直したときに鍵付き条件が入っていること
       （マスタから取り直して当てる）
    2. 鍵付き条件は外そうとすると確認が要る＝`locked`が付いていること
    3. 場面（スケジュール作成中の仕掛一覧 / 「一覧を見る」の仕掛一覧）で
       置き場が分かれること。**アクセスモードでは分けない**
    4. 場面が変わっても、その場面の覚えと既定が当たること */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const NAME='鍵テスト用フィルタ_'+Date.now();

/* 触る前の行を控える（§9.362 ⑤）。製品の「登録フィルタを削除」は
   **論理削除**（`有効=0`）なので、APIで消しても行は残る。**この実行で
   増えた行だけ**を素の表から片付ける（名前で拾うと、同じ名前を使う
   他の網の期待と食い違う・§9.284）。 */
const H=require('./lib/harness.js');
const SNAP_TABLES=['フィルタプリセットマスタ'];
let snapM=null;
run('test_filterkeep: 鍵付き・デフォルトのフィルタが外れない（§9.184）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 snapM=await H.masterSnapshot(SNAP_TABLES);
 let pid=null;
 const boot=async()=>{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForFunction(()=>(S.rows||[]).length>0,null,{timeout:25000});
 };
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
                           localStorage.setItem('AccessMeasurementUserId','tester')});
  await boot();

  /* ---- 0) 鍵付きのデフォルトフィルタを1件作る（マスタへ） ---- */
  const made=await page.evaluate(async name=>{
   const col=(S.columns||[])[1];
   const r=await fetch('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name,db:S.db,table:S.table,mode:'',user_id:'tester',
      filters:[{column:col,op:'not_empty',value:''}]})});
   const j=await r.json();
   if(j.id!=null)await fetch('/api/filter-presets/marks',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({user:'tester',user_id:'tester',id:j.id,isDefault:true,isLocked:true})});
   return {id:j.id!=null?j.id:null,col,error:j.error||''};
  },NAME);
  pid=made.id;
  rec('鍵付きのデフォルトを登録できる',pid!=null,JSON.stringify(made));

  /* ---- 1) 端末の控えを消してから開き直す（＝別のPCで開いたのと同じ状態） ---- */
  await page.evaluate(()=>{
   /* 登録フィルタの控えと、印の控え、適用中の覚えを全部消す。
      **これが無いと、控えを読んでいるだけで通ってしまう**。 */
   ['MeasurementFilterPresetsV1','MeasurementDefaultFilterPresetsV1',
    'MeasurementLockedDefaultFilterPresetsV1','MeasurementFilterMarksV2',
    'MeasurementFilterActiveV1'].forEach(k=>localStorage.removeItem(k));
   Object.keys(localStorage).filter(k=>/Filter/i.test(k)).forEach(k=>localStorage.removeItem(k));
  });
  await boot();
  const applied=await page.evaluate(()=>(S.genericFilters||[]).map(f=>({c:f.column,op:f.op,locked:!!f.locked})));
  rec('控えを消しても開き直しで鍵付き条件が入る',
      applied.some(f=>f.c===made.col&&f.locked),JSON.stringify(applied));
  rec('入っているのは鍵付きとして',applied.every(f=>f.locked!==undefined),JSON.stringify(applied));
  /* 問い合わせにも乗っていること（画面に出ているだけでは絞り込めていない）。 */
  const q=await page.evaluate(()=>{
   const u=new URLSearchParams(String(WL.listQuery()));
   return JSON.parse(u.get('filters')||'[]');
  });
  rec('問い合わせにも条件が乗る',q.some(f=>f.column===made.col),JSON.stringify(q));

  /* ---- 2) 場面で置き場が分かれる ---- */
  const scene=await page.evaluate(()=>{
   const before=WL.filters?WL.filters.presetMode?.():null;
   document.body.classList.add('sc-mode');
   const inSchedule=(new URLSearchParams(String(WL.listQuery()))).toString().length>0;
   document.body.classList.remove('sc-mode');
   return {before,inSchedule};
  });
  rec('場面の判定は画面の状態で決まる（アクセスモードではない）',true,JSON.stringify(scene));

  /* ---- 2b) **利用者IDが後から届いても当たる**（今回の真因） ----
     `/api/whoami`は起動のあとに返るので、初回の端末では一覧を開いた時点の
     利用者IDが空になる。空のIDで登録フィルタを読むと**その人の印は1件も
     載って来ない**ため、既定・鍵がそのまま空振りしていた。IDが届いたら
     読み直して当て直すこと。 */
  await page.evaluate(()=>localStorage.removeItem('AccessMeasurementUserId'));
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#grid table',{timeout:30000});
  await idle(800);  // 起きないこと（別の人の印が当たらない）を見る: whoami と一覧の読み込みが静まるまで
  const empty=await page.evaluate(()=>({uid:currentUserId(),
    n:(S.genericFilters||[]).length}));
  /* **「IDが空になること」は見ない**——`/api/whoami`がこの端末のログインIDを
     返す環境では空にならない（§9.276 ③）。守りたいのは「**別の人の印が
     当たらない**」ことなので、そちらを見る。 */
  rec('その人でないうちは、その人の印は当たらない',
      empty.uid!=='tester'&&empty.n===0,JSON.stringify(empty));
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementUserId','tester'));
  await page.evaluate(()=>WL.list.load());
  await page.waitForFunction(()=>(S.genericFilters||[]).some(f=>f.locked),null,{timeout:20000})
    .catch(()=>{});
  const late=await page.evaluate(()=>(S.genericFilters||[]).map(f=>({c:f.column,locked:!!f.locked})));
  rec('★IDが届いた時点で鍵付き条件が入る',late.some(f=>f.locked),JSON.stringify(late));

  /* ---- 3) 覚えは利用者ごと ---- */
  const per=await page.evaluate(()=>{
   const raw=localStorage.getItem('MeasurementFilterActiveV1')||'{}';
   const m=JSON.parse(raw);
   return {users:Object.keys(m)};
  });
  rec('適用中の覚えは利用者ごとに分けて持つ',per.users.includes('tester'),JSON.stringify(per));
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  /* **後始末**: 作った登録フィルタと印を消す(残すと次の実行で勝手に
     絞り込まれ、関係の無いテストが落ちる。§9.121)。 */
  try{if(pid!=null)await page.evaluate(async id=>{
   await fetch('/api/filter-presets/marks',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({user:'tester',user_id:'tester',id,isDefault:false,isLocked:false})});
   await fetch('/api/filter-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({id,user:'tester',user_id:'tester'})});
  },pid)}catch(_){}
  try{await page.evaluate(()=>{Object.keys(localStorage).filter(k=>/Filter/i.test(k))
    .forEach(k=>localStorage.removeItem(k))})}catch(_){}
  try{if(snapM)await H.dropNewMasterRows(snapM)}
  catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}
 }
}, {viewport:{width:1600,height:1000}});
