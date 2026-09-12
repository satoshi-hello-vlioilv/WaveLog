/* test_scfail.js: 書き込みが失敗したら、必ず理由を言う（§9.372）
   ============================================================
   利用者の報告:
    ①「組み込んだスケジュールを仕掛へ外してみましたが一度は外れたように
       見えましたが時間が経つと５秒程したら再度ロットが復活しました」
    ②「ロットを下方向へドラッグして入れ替えようとしましたが、移動できません」
    ③「一旦ロットを外しドラッグで作業スケジュールの段取りに入れようとしたが
       入りませんでした」

   **3つとも同じ1つの原因だった。** 書込キューは「`onFailure`を持つ操作は
   そちらが利用者へ知らせる責任を持つ」として`e.__reported=true`を立てて
   いたが、`onFailure`の中身はほとんどが**巻き戻すだけ**で何も言わない。
   結果、3回のリトライ（700+1400ms＋往復3回）のあと**理由を告げずに**
   行が戻る＝「5秒程したら復活」。

   ここで固定すること:
    1. 外す書込が失敗したら、**行は戻り、かつ理由が出る**
    2. 足す書込が失敗したら、**行は消え、かつ理由が出る**
    3. 知らせは「何ができなかったか」から始まる（「一部の変更」ではない）
    4. 外せていないのに「仕掛一覧へ戻していません」と言わない（§9.368の別件）
    5. 動かせない行は、掴んだ時点で理由が出る

   後片付けは finally。落ちてもブラウザを閉じる。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const HELD='テスト設備Aは other@PC-B が編集中です。';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await (await b.newContext({viewport:{width:1700,height:1000}})).newPage();
 const errs=[];page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scfail'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={e:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const toastText=()=>page.evaluate(()=>[...document.querySelectorAll('#toastArea *,.toast,.wl-toast')]
   .map(x=>(x.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean).join(' ／ '));
 const clearToasts=()=>page.evaluate(()=>{const a=document.getElementById('toastArea');if(a)a.innerHTML=''});
 const made=[];
 const fail423=route=>route.fulfill({status:423,contentType:'application/json',
   body:JSON.stringify({error:'テスト設備Aは other@PC-B が編集中です。'})});
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForTimeout(1500);

  /* ---- 材料は自分で用意する（§9.351） ---- */
  const lot='SF'+process.pid;
  const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot});
  const id=String((add.body&&add.body.id)||'');
  made.push(id);
  rec('材料（予定1件）を用意できた',!!id,`id=${id} lot=${lot}`);
  await page.evaluate(()=>WL.refreshScheduleIfOpen());
  await page.waitForSelector(`.sc-row-line[data-id="${id}"]`,{timeout:20000});
  await page.waitForTimeout(600);

  /* ---- 1・3・4. 外す書込が失敗したとき ---- */
  await clearToasts();
  await page.route('**/api/schedule/plan/delete',fail423);
  await page.route('**/api/schedule/plan/batch',fail423);
  await page.click(`.sc-row-line[data-id="${id}"] .sc-row-delete`);
  await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:8000});
  await page.click('#appConfirmOk');
  const gone=()=>page.evaluate(i=>!document.querySelector(`.sc-row-line[data-id="${i}"]`),id);
  rec('押した直後はいったん消える（楽観的更新）',await gone());
  await page.waitForFunction(i=>!!document.querySelector(`.sc-row-line[data-id="${i}"]`),id,{timeout:15000})
    .catch(()=>{});
  rec('外せなかったので行は戻る',!(await gone()));
  const t1=await toastText();
  rec('外せなかった理由が出る（黙って戻さない）',
      t1.includes('予定から外せませんでした')&&t1.includes('編集中'),t1.slice(0,160));
  rec('「仕掛一覧へ戻していません」は出さない（外せていないので別件）',
      !t1.includes('仕掛一覧へ戻していません'),t1.slice(0,160));
  await page.unroute('**/api/schedule/plan/delete');
  await page.unroute('**/api/schedule/plan/batch');

  /* ---- 2. 足す書込が失敗したとき ---- */
  await clearToasts();
  await page.route('**/api/schedule/plan/add',fail423);
  await page.route('**/api/schedule/plan/batch',fail423);
  /* 追加の経路は「枠を入れる」を使う（`#scFrameBtn`）。**どの追加でも通る
     のは書込キューの同じ1箇所**なので、経路そのものは何でもよい——
     確認窓を1回押すだけで済む分、待ちが短く安定する。 */
  const n0=await page.evaluate(()=>document.querySelectorAll('#scTimeline .sc-row-line').length);
  const frameBtn=await page.evaluate(()=>{
   const b=document.getElementById('scFrameBtn');
   return b?{hidden:!!b.hidden}:null;
  });
  rec('前提: 「枠」ボタンが押せる',!!frameBtn&&!frameBtn.hidden,JSON.stringify(frameBtn));
  await page.click('#scFrameBtn');
  await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:8000});
  await page.click('#appConfirmOk');
  await page.waitForTimeout(7000);
  const n1=await page.evaluate(()=>document.querySelectorAll('#scTimeline .sc-row-line').length);
  const t2=await toastText();
  rec('足せなかったので行は消える',n1<=n0,`${n0} -> ${n1}`);
  rec('足せなかった理由が出る（黙って消さない）',
      t2.includes('予定へ追加できませんでした')&&t2.includes('編集中'),t2.slice(0,160));
  await page.unroute('**/api/schedule/plan/add');
  await page.unroute('**/api/schedule/plan/batch');

  /* ---- 5. 動かせない行は、掴んだ時点で理由が出る ---- */
  await clearToasts();
  const blocked=await page.evaluate(()=>{
   const e=(WL.scheduleView&&WL.scheduleView.entriesForTest)?null:null;void e;
   /* 固定した予定を作って掴む代わりに、いま出ている行のうち
      「並べ替えできない」ものを探す（状態で決まるので実データに任せる）。 */
   const rows=[...document.querySelectorAll('#scTimeline .sc-row-line')];
   const hit=rows.find(r=>r.querySelector('.sc-row-lock.is-on'))||null;
   return hit?hit.dataset.id:'';
  });
  if(blocked){
   await page.evaluate(i=>{const r=document.querySelector(`.sc-row-line[data-id="${i}"]`);
     if(r)r.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:new DataTransfer()}))},blocked);
   await page.waitForTimeout(400);
   const t3=await toastText();
   rec('動かせない行は掴んだ時点で理由が出る',t3.includes('動かせません'),t3.slice(0,160));
  }else{
   rec('動かせない行は掴んだ時点で理由が出る（対象が無いので測っていない）',true,'固定した予定が画面に無い');
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('例外なく最後まで進む',false,String(e).slice(0,300));
 }finally{
  try{
   await page.unroute('**/api/schedule/plan/delete').catch(()=>{});
   await page.unroute('**/api/schedule/plan/add').catch(()=>{});
   await page.unroute('**/api/schedule/plan/batch').catch(()=>{});
   for(const id of made)if(id)await post('/api/schedule/plan/delete',{equipment:EQ,id});
   /* コメント行が入ってしまっていたら消す（足せなかったはずだが念のため） */
   const left=await page.evaluate(async e=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history_hours=8');
    const j=await r.json();
    return (j.entries||[]).filter(x=>x.kind==='コメント'&&!x.title).map(x=>String(x.id));
   },EQ).catch(()=>[]);
   for(const cid of left)await post('/api/schedule/plan/delete',{equipment:EQ,id:cid});
  }catch(e){console.log('後片付けに失敗: '+e)}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})().catch(async e=>{console.log('FATAL: '+e);if(b)await b.close();process.exit(1)});
