/* test_scfail.js: 書き込みが失敗したら、必ず理由を言う（§9.372）
   ============================================================
   利用者の報告:
    ①「組み込んだスケジュールを仕掛へ外してみましたが一度は外れたように
       見えましたが時間が経つと５秒程したら再度ロットが復活しました」
    ③「一旦ロットを外しドラッグで作業スケジュールの段取りに入れようとしたが
       入りませんでした」

   **①と③は同じ1つの原因だった。** 書込キューは「`onFailure`を持つ操作は
   そちらが利用者へ知らせる責任を持つ」として`e.__reported=true`を立てて
   いたが、`onFailure`の中身はほとんどが**巻き戻すだけ**で何も言わない。
   結果、3回のリトライのあと**理由を告げずに**行が戻る＝「5秒程したら復活」。

   ここで固定すること:
    1. 外す書込が失敗したら、**行は戻り、かつ理由が出る**
    2. 足す書込が失敗したら、**行は消え、かつ理由が出る**
    3. 知らせは「何ができなかったか」から始まる（「一部の変更」ではない）
    4. 外せていないのに「仕掛一覧へ戻していません」と言わない（§9.368の別件）

   **待ちは条件で置く**（§9.347）。骨組みは`tests/lib/harness.js`。
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const HELD='テスト設備Aは other@PC-B が編集中です。';

run('test_scfail: 失敗は黙って巻き戻さない（§9.372）',
 async({page,rec,B,idle,W})=>{
  const made=[];
  const post=(p,body)=>page.evaluate(async a=>{
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-scfail'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   return {status:r.status,body:j};
  },{p,b:body||{}});
  /* 知らせは**溜まる**ので、見る前に空にしてから測る（前の節の文が混ざると
     「出た」が嘘になる）。 */
  const clearToasts=()=>page.evaluate(()=>{const a=document.getElementById('toastArea');if(a)a.innerHTML=''});
  const toastText=()=>page.evaluate(()=>[...document.querySelectorAll('#toastArea .toast')]
    .map(x=>(x.textContent||'').replace(/\s+/g,' ').trim()).join(' ／ '));
  /* **「出るはずの文」を条件で待つ**（§9.347）。出ないときだけ時間切れになる。 */
  const waitToast=async word=>page.waitForFunction(
    w=>[...document.querySelectorAll('#toastArea .toast')]
        .some(x=>(x.textContent||'').includes(w)),word,{timeout:20000}).then(()=>true,()=>false);
  const fail423=route=>route.fulfill({status:423,contentType:'application/json',
    body:JSON.stringify({error:HELD})});
  try{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                           localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
   await post('/api/access-mode',{mode:'schedule'});
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.waitForSelector('#openSchedule',{timeout:25000});
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-board-row',{timeout:25000});
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   await page.waitForSelector('.sc-row-line',{timeout:30000});
   await idle(400,20000);

   /* ---- 材料は自分で用意する（§9.351） ---- */
   const lot='SF'+process.pid;
   const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot});
   const id=String((add.body&&add.body.id)||'');
   made.push(id);
   rec('材料（予定1件）を用意できた',!!id,`id=${id} lot=${lot}`);
   await page.evaluate(()=>WL.refreshScheduleIfOpen());
   await page.waitForSelector(`.sc-row-line[data-id="${id}"]`,{timeout:20000});
   await idle(300,15000);

   /* ---- 1・3・4. 外す書込が失敗したとき ---- */
   await clearToasts();
   await page.route('**/api/schedule/plan/delete',fail423);
   await page.route('**/api/schedule/plan/batch',fail423);
   await page.click(`.sc-row-line[data-id="${id}"] .sc-row-delete`);
   await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:8000});
   await page.click('#appConfirmOk');
   /* 楽観的更新でいったん消える——**消えたことを条件で待つ** */
   const vanished=await page.waitForFunction(
     i=>!document.querySelector(`.sc-row-line[data-id="${i}"]`),id,{timeout:8000})
     .then(()=>true,()=>false);
   rec('押した直後はいったん消える（楽観的更新）',vanished);
   /* リトライを使い切ってから戻る——**戻ったことを条件で待つ** */
   const returned=await page.waitForFunction(
     i=>!!document.querySelector(`.sc-row-line[data-id="${i}"]`),id,{timeout:20000})
     .then(()=>true,()=>false);
   rec('外せなかったので行は戻る',returned);
   rec('外せなかった理由が出る（黙って戻さない）',
       await waitToast('予定から外せませんでした'));
   const t1=await toastText();
   rec('理由に「なぜ」が入っている',t1.includes('編集中'),t1.slice(0,160));
   rec('「仕掛一覧へ戻していません」は出さない（外せていないので別件）',
       !t1.includes('仕掛一覧へ戻していません'),t1.slice(0,160));
   await page.unroute('**/api/schedule/plan/delete');
   await page.unroute('**/api/schedule/plan/batch');

   /* ---- 2. 足す書込が失敗したとき ----
      追加の経路は「枠を入れる」を使う（`#scFrameBtn`）。**どの追加でも通るのは
      書込キューの同じ1箇所**なので、経路そのものは何でもよい。 */
   await clearToasts();
   await page.route('**/api/schedule/plan/add',fail423);
   await page.route('**/api/schedule/plan/batch',fail423);
   const n0=await page.evaluate(()=>document.querySelectorAll('#scTimeline .sc-row-line').length);
   const frameHidden=await page.evaluate(()=>{
    const b=document.getElementById('scFrameBtn');return b?!!b.hidden:null;
   });
   rec('前提: 「枠」ボタンが押せる',frameHidden===false,String(frameHidden));
   await page.click('#scFrameBtn');
   await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:8000});
   await page.click('#appConfirmOk');
   rec('足せなかった理由が出る（黙って消さない）',
       await waitToast('予定へ追加できませんでした'));
   const t2=await toastText();
   rec('理由に「なぜ」が入っている（足す側）',t2.includes('編集中'),t2.slice(0,160));
   /* 知らせが出たあと、仮の行が残っていないことを見る（数は増えていない）。 */
   await idle(300,15000);
   const n1=await page.evaluate(()=>document.querySelectorAll('#scTimeline .sc-row-line').length);
   rec('足せなかったので行は残らない',n1<=n0,`${n0} -> ${n1}`);
   await page.unroute('**/api/schedule/plan/add');
   await page.unroute('**/api/schedule/plan/batch');
  }finally{
   /* 後片付けは自分で（§9.351）。**消えたことまで確かめる**（§9.362）。 */
   for(const id of made)if(id)await post('/api/schedule/plan/delete',{equipment:EQ,id});
   const left=await page.evaluate(async e=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history_hours=8');
    const j=await r.json();
    return (j.entries||[]).filter(x=>x.kind==='枠'||String(x.lotNo||'').startsWith('SF'))
      .map(x=>String(x.id));
   },EQ).catch(e=>{console.log('残りを数えられない: '+e.message);return []});
   for(const cid of left)await post('/api/schedule/plan/delete',{equipment:EQ,id:cid});
   const after=await page.evaluate(async e=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history_hours=8');
    const j=await r.json();
    return (j.entries||[]).filter(x=>String(x.lotNo||'').startsWith('SF')).length;
   },EQ).catch(e=>{console.log('後始末の確認に失敗: '+e.message);return -1});
   rec('後片付け: 置いた予定が消えている',after===0,`残り${after}件`);
  }
 },{mode:'schedule'});
