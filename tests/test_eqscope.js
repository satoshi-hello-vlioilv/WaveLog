/* test_eqscope.js: 見せる範囲を「実施した設備」で絞る（§9.248 ⑥）
   ============================================================
   利用者の指示:
     「データ一覧や実績データ、作業スケジュール表(これは既に対応済みと
      思いますが)については、実施した設備ごとに見せる範囲を変えたいです。
      設備設定を変えても他の設備の情報が表示されていたら混乱してしまい
      データも混ざってしまうと問題になるため修正をお願いします。」

   実測すると、**データ一覧には設備の条件が1つも無かった**
   （`WL.records.mergedRecords()`＝端末内の全件＋共有DBの見出し全件）。共有DBは
   全設備ぶんが入るので、設備Aの端末で開いても設備Bの測定が並ぶ。
   実績データには設備の選択欄があったが、**既定が「すべての設備」**だった。

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. 既定はこの端末の使用設備だけ（他の設備の記録は並ばない）
    2. **黙って絞らない**——切替のボタンが「何で絞っているか」と
       「隠している件数」を文字で名乗る（§3・§8）
    3. 押すとすべての設備に戻り、もう一度押すと絞りに戻る
    4. **設備の分からない古い記録は隠さない**（隠すと戻す手立てが消える）
    5. 使用設備が未登録の端末では**絞らず、そう書く**（§4）
    6. 実績データの既定もこの端末の設備（覚えがあればそちらが勝つ）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A',OTHER='テスト設備B';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
const MADE=['eqscope-other','eqscope-mine','eqscope-unknown'];
/* 共有DBの行は**実行をまたいで生き延びる**（§9.121）ので必ず消す。 */
const cleanup=async()=>{for(const id of MADE){
  await post('/api/measurement/backup/delete',{id,user_id:'tests'}).catch(()=>{});}};

run('test_eqscope: 見せる範囲を「実施した設備」で絞る（§9.248 ⑥）', async ({page,rec,W,idle,errs})=>{
 await cleanup();
 try{
  await post('/api/access-mode',{mode:'edit'});
  /* **材料は自分で注ぎ込む**（§CLAUDE「確かめるときは自分で用意する」）
     ——検証用DBに他設備の記録がある保証は無く、「無ければ素通り」の
     書き方だと直す前でも通る。 */
  const put=(id,equipment,lotNo)=>post('/api/measurement/backup',
    {id,equipment,lotNo,payload:'x',status:'編集中',codec:'json-full-v32',user_id:'tests'});
  await put('eqscope-mine',EQ,'EQS-MINE');
  await put('eqscope-other',OTHER,'EQS-OTHER');
  /* 設備の記録が無い古いデータ（隠してはいけない側）。 */
  await put('eqscope-unknown','','EQS-UNKNOWN');

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  /* 前の実行の覚えを消しておく（既定を確かめたいので）。 */
  await page.evaluate(()=>{try{localStorage.removeItem('MeasurementRecordScopeV1');
    localStorage.removeItem('ActualsViewPrefV1')}catch(e){}});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await idle();  // 一覧の読み込みが済むまで

  const shot=()=>page.evaluate(()=>({
    行:[...document.querySelectorAll('.record-list-row')]
      .map(r=>r.textContent.replace(/\s+/g,' ')),
    件数:document.querySelectorAll('.record-list-row').length,
    ボタン:(document.getElementById('recordScopeBtn')||{}).textContent||'',
    説明:(document.getElementById('recordScopeBtn')||{}).title||'',
    絞り:document.getElementById('recordScopeBtn')
      ?document.getElementById('recordScopeBtn').classList.contains('is-on'):null}));
  const s1=await shot();
  const has=(o,t)=>o.行.some(x=>x.includes(t));
  rec('前提: 3件とも共有DBへ入った（自分・他設備・設備不明）',
      s1.件数>0,`${s1.件数}件`);
  /* **本丸**——他の設備の記録が並ばないこと。 */
  rec('既定ではこの端末の設備の記録だけが並ぶ',
      has(s1,'EQS-MINE')&&!has(s1,'EQS-OTHER'),
      JSON.stringify({自分:has(s1,'EQS-MINE'),他設備:has(s1,'EQS-OTHER')}));
  /* **設備の分からない記録は隠さない**（隠すと戻す手立てが画面から消える）。 */
  rec('設備の記録が無い古いデータは隠さない',has(s1,'EQS-UNKNOWN'),
      String(has(s1,'EQS-UNKNOWN')));
  /* **黙って絞らない**（§3）——何で絞っているかと隠している件数を文字で出す。 */
  rec('絞っていることをボタンが名乗る（設備名つき）',
      s1.ボタン.includes(EQ)&&s1.絞り===true,JSON.stringify(s1.ボタン));
  rec('隠している件数を文字で出す',/他\d+件/.test(s1.ボタン)||/伏せ/.test(s1.説明),
      JSON.stringify({b:s1.ボタン,t:s1.説明.slice(0,60)}));

  /* 押すとすべての設備。**もう一度押すと戻る**（片道にしない）。 */
  await page.click('#recordScopeBtn');
  await W.until(page,want=>{const b=document.getElementById('recordScopeBtn');return !!b&&b.classList.contains('is-on')===want},false,{ms:5000,what:'絞りが外れる'});await idle();
  const s2=await shot();
  rec('押すとすべての設備が並ぶ',
      has(s2,'EQS-MINE')&&has(s2,'EQS-OTHER')&&s2.絞り===false,
      JSON.stringify({自分:has(s2,'EQS-MINE'),他設備:has(s2,'EQS-OTHER'),絞り:s2.絞り}));
  /* **書いた件数と、押して増えた行数が合うこと**（§CLAUDE 8）。状態や検索で
     既に落ちている行まで「伏せている」と数えると、押しても増えない件数を
     出すことになる。**「他N件」の文字だけを見る網では捕まらない。** */
  const 名乗り=Number((s1.ボタン.match(/他(\d+)件/)||[])[1]||0);
  rec('「他N件」は押したときに実際に増える行数と合う',
      名乗り===s2.件数-s1.件数,
      JSON.stringify({名乗り,増えた:s2.件数-s1.件数,絞り時:s1.件数,全部:s2.件数}));
  await page.click('#recordScopeBtn');
  await W.until(page,want=>{const b=document.getElementById('recordScopeBtn');return !!b&&b.classList.contains('is-on')===want},true,{ms:5000,what:'絞りが戻る'});await idle();
  const s3=await shot();
  rec('もう一度押すとこの設備だけに戻る',
      has(s3,'EQS-MINE')&&!has(s3,'EQS-OTHER'),
      JSON.stringify({自分:has(s3,'EQS-MINE'),他設備:has(s3,'EQS-OTHER')}));

  /* 使用設備が未登録の端末では**絞れないので絞らず、そう書く**（§4）。 */
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment',''));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await idle();
  const s4=await page.evaluate(()=>({
    行:[...document.querySelectorAll('.record-list-row')].map(r=>r.textContent).join(' '),
    押せる:!(document.getElementById('recordScopeBtn')||{}).disabled,
    説明:(document.getElementById('recordScopeBtn')||{}).title||''}));
  rec('使用設備が未登録なら絞らない（全部出る）',
      s4.行.includes('EQS-MINE')&&s4.行.includes('EQS-OTHER'),
      JSON.stringify({自分:s4.行.includes('EQS-MINE'),他:s4.行.includes('EQS-OTHER')}));
  rec('絞れない理由を文字で書き、押せなくする',
      s4.押せる===false&&/未登録|登録されていない/.test(s4.説明),
      JSON.stringify({押せる:s4.押せる,説明:s4.説明.slice(0,60)}));

  /* ---- 実績データの既定（§9.248 ⑥） ---- */
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.evaluate(()=>{try{localStorage.removeItem('ActualsViewPrefV1')}catch(e){}});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  const acOk=await page.evaluate(()=>{
   const b=document.getElementById('openActuals')
        ||[...document.querySelectorAll('[data-view],button')]
          .find(x=>/測定実績|実績データ|実績一覧/.test(x.textContent||''));
   if(b){b.click();return true}return false;
  });
  if(acOk){
   await page.waitForSelector('#acEquipment',{timeout:20000}).catch(()=>{});
   const ac=await page.evaluate(()=>{
    const s=document.getElementById('acEquipment');
    return s?{値:s.value,件数:s.options.length}:null;
   });
   rec('実績データの既定はこの端末の設備',!!ac&&ac.値===EQ,JSON.stringify(ac));
  }else rec('実績データの既定はこの端末の設備',false,'実績データを開く入口が見つかりません');

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  await cleanup();
 }
}, {viewport:{width:1700,height:1000}});
