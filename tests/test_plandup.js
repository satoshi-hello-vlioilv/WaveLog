/* test_plandup.js: 応答が届かなかった追加を、再送で二重に入れない（§9.438）
   ============================================================
   利用者の報告:「スケジュール作成時、同じロットが2つ表示されてしまう不具合が
   発生しています。同期し直しても直りません。」

   **原因は再送**。予定の書込キューは、失敗した操作を最大3回まで投げ直す
   （通信不良・503のような「待てば通るかもしれない」失敗のため）。ところが
   HTTPは「サーバーが書いたか」を答えない——**書けたのに応答だけ落ちた**とき、
   画面には失敗としか見えず、同じ`add`をもう一度投げる。`plan_add`は素の
   INSERTなので、そのたびに1行増える。**どちらも本物の行**なので、
   取り込み直しても消えない（利用者の「同期し直しても直らない」）。

   ここで測ること（評価関数）:
     1操作あたり、共有DBに増える行数。**理想は1**。

   欠陥の注入は**1件ずつ入れて、その場で戻す**（§9.399）。
   `route.fetch()`でサーバーへは本当に届け、`route.abort()`で応答だけ落とす
   ——「書けたが届かなかった」を、実際の経路でそのまま作る。
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const B='http://127.0.0.1:5029';

const planEntries=async()=>{
 const r=await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)+'&history_hours=8');
 const j=await r.json();
 return j.entries||[];
};
const countLot=(entries,lot)=>entries.filter(
  e=>e.kind==='作業'&&e.parentId==null&&String(e.lotNo||'')===String(lot)).length;
const removeLot=async lot=>{
 for(const e of await planEntries()){
  if(String(e.lotNo||'')!==String(lot))continue;
  if(e.parentId!=null)continue;                       // 子は親を消せば一緒に消える
  if(String(e.id||'').startsWith('actual:'))continue; // 合成行は共有DBに無い
  await fetch(B+'/api/schedule/plan/delete',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:e.id,user_id:'test-plandup'})}).catch(()=>{});
 }
};

run('test_plandup: 届かなかった応答の再送で予定が二重にならない（§9.438）',
 async({page,rec,idle,W})=>{
  const used=[];
  /* サーバーへは届け、応答だけ落とす（＝「書けたのに失敗に見える」）。 */
  const swallow=async route=>{
   try{await route.fetch()}catch(e){/* 届かなくても、落とす側は同じ */}
   await route.abort('failed').catch(()=>{});
  };
  const open=async()=>{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-board-row',{timeout:25000});
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   await page.waitForSelector('.sc-row-line',{timeout:30000});
   await idle(400,25000);
  };
  try{
   await open();
   /* 予定にまだ載っていない仕掛の行を使う（載っている行は仕掛一覧から
      伏せられているので、`S.rows`の先頭が既に予定に居ることがある）。 */
   const before=await planEntries();
   const inPlan=new Set(before.filter(e=>e.kind==='作業').map(e=>String(e.lotNo||'')));
   const lots=await page.evaluate(has=>{
    const rows=(typeof S!=='undefined'&&S.rows||[]);
    const out=[];
    for(const r of rows){
     const lot=String((typeof pick==='function'?pick(r,'lotNo'):r.lotNo)||'').trim();
     if(lot&&!has.includes(lot)&&!out.some(x=>x.lot===lot))out.push({lot,i:rows.indexOf(r)});
     if(out.length>=3)break;
    }
    return out;
   },[...inPlan]);
   if(lots.length<3){rec('仕掛一覧に使える行が3件ある',false,`見つかったのは${lots.length}件`);return}
   lots.forEach(x=>used.push(x.lot));

   /* ---- ① 1件ずつの追加（単発の`/plan/add`） ---- */
   await page.route('**/api/schedule/plan/add',swallow);
   await page.evaluate(i=>window.scheduleAddFromRow(S.rows[i]),lots[0].i);
   /* 書込キューが諦める（再送を使い切る）まで待つ。**黙って握り潰さない**
      （§9.360）——片付かないまま先へ進むと、行が1つなのは「まだ書いて
      いないから」かもしれず、数えたことにならない。 */
   await W.until(page,()=>!document.querySelector('.sc-flag-pending'),null,
                 {ms:60000,what:'書込キューが片付く（再送を使い切る）'});
   await idle(600,30000);
   await page.unroute('**/api/schedule/plan/add');
   const n1=countLot(await planEntries(),lots[0].lot);
   rec('応答が届かなかった単発の追加でも、予定は1行だけ（§9.438）',n1<=1,
       `ロット${lots[0].lot} は ${n1}行`);

   /* ---- ② まとめ追加（`/plan/batch`。失敗すると個別経路へ落ちる） ---- */
   await open();
   await page.route('**/api/schedule/plan/batch',swallow);
   await page.route('**/api/schedule/plan/add',swallow);
   await page.evaluate(ix=>{ix.forEach(i=>window.scheduleAddFromRow(S.rows[i]))},
                       [lots[1].i,lots[2].i]);
   await W.until(page,()=>!document.querySelector('.sc-flag-pending'),null,
                 {ms:60000,what:'書込キューが片付く（再送を使い切る）'});
   await idle(600,30000);
   await page.unroute('**/api/schedule/plan/batch');
   await page.unroute('**/api/schedule/plan/add');
   const after=await planEntries();
   const n2=countLot(after,lots[1].lot),n3=countLot(after,lots[2].lot);
   rec('応答が届かなかったまとめ追加でも、予定は1行ずつ（§9.438）',n2<=1&&n3<=1,
       `${lots[1].lot}=${n2}行 / ${lots[2].lot}=${n3}行`);

   /* ---- ③ 素直に通るときは今までどおり1行入る（塞ぎすぎていない） ---- */
   await open();
   const lot=used[0];
   await removeLot(lot);
   await page.evaluate(i=>window.scheduleAddFromRow(S.rows[i]),lots[0].i);
   await W.until(page,()=>!document.querySelector('.sc-flag-pending'),null,
                 {ms:60000,what:'書込キューが片付く（再送を使い切る）'});
   await idle(600,30000);
   rec('通信が正常なら、追加はこれまでどおり1行入る',countLot(await planEntries(),lot)===1,
       `ロット${lot} は ${countLot(await planEntries(),lot)}行`);
  }finally{
   /* 置いた予定は自分で消す（§9.351）。 */
   for(const lot of used)await removeLot(lot).catch(()=>{});
  }
 },{mode:'schedule'});
