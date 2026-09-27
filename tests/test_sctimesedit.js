/* test_sctimesedit.js: 編集モードでも「時刻入力」が操作の列に在り、完了を字で言う（§9.518）
   ============================================================
   利用者の指摘（スクリーンショットは編集モード・区分の列なし）:
    「完了ロットが色付きでわかるようになったのは良いが、時刻を入れるボタンが『操作』になく、
     どうにもできないので戸惑います。『完了』のバッジのようなフラグもロット単位では
     立っていないので色で見分けるだけしかないのがわかりにくい点です。」
   選択「その場で入れられる」——編集モードでも、スケジュール可否／その設備の現場段取りを
   持つ端末は入れられる（答えはサーバーの`_times_allowed()`・予定の応答の`canEnterTimes`）。

   直す前（評価関数）: 押せる「時刻入力」0/2・操作の列の「完了」0/2・編集モードからの登録 403。

   固定すること:
    ① 時刻未登録の行は、操作の列に**押せる「時刻入力」**がある（編集モード）
    ② 完了の行は、区分の列を外していれば**操作の列に「完了」の字**（自動で完了なら理由を`title`）
    ③ 区分の列を出していれば操作の列には出さない（**「完了」は行に1つだけ**・§CLAUDE 8）
    ④ 操作の列の中身は列の幅からはみ出さない（全行）
    ⑤ 押すと窓が開き、登録できる（編集モードのまま）。登録した行は時刻未登録でなくなる
    ⑥ 入れられない端末（`canEnterTimes`が偽）では**押せない形で残し、理由を`title`で言う**。
       ダブルクリックでも開かない
    ⑦ 編集モードから通るのは**実際の時刻だけ**（備考などは403で断る）
   ============================================================ */
'use strict';
const H=require('./lib/harness.js');
const W=require('./lib/wait.js');
const B=H.B, EQ='テスト設備A', TARGET='timeline:'+EQ, TAG='RTE'+process.pid;
H.run('test_sctimesedit: 編集モードの時刻入力と完了の字（§9.518）',async({page,rec,setMode})=>{
 const made=[];
 const layout=await H.snapLayout(TARGET);
 const post=(p,b)=>page.evaluate(async a=>{const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-sctimesedit'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={}}last={status:r.status,body:j};
   if(r.status!==423)return last;await new Promise(z=>setTimeout(z,400))}   // 共有の書込ロックが空くのを待つ（§4.2）
  return last},{p,b:b||{}});
 const setLayout=(order,hidden)=>post('/api/column-layout-master',{target:TARGET,clear:true,order,hidden:hidden||[],widths:{},names:{},
   formats:{},rules:{},formulas:{},locks:[],sorts:{}});
 const open=async()=>{
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
  await W.openSchedule(page,EQ);
  await W.until(page,id=>!!document.querySelector(`.sc-row-line[data-id="${id}"]`),made[1],{ms:20000,what:'材料の行'});
 };
 /* 行ごとの読み取り: 時刻の要る行・完了の行・操作の列の中身とはみ出し */
 const scan=()=>page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.sc-row-line')].filter(r=>r.__scEntry);
  const act=r=>r.querySelector('[data-col="__actions__"]');
  return rows.map(r=>{const e=r.__scEntry,a=act(r),b=a&&a.querySelector('.sc-row-times'),st=a&&a.querySelector('.sc-row-state');
   return {id:String(e.id),need:!!e.timesNeeded,done:e.state==='完了',auto:!!e.doneReason,
    btn:b?{on:!b.disabled,text:b.textContent.trim(),title:b.title}:null,
    chip:st?{text:st.textContent.trim(),title:st.title}:null,
    doneWords:(r.textContent.match(/完了/g)||[]).length,
    over:a?Math.round(a.scrollWidth-a.clientWidth):0}});
 });
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  /* 材料（§9.351・自分で足して自分で消す）: 停止S1 → 仕掛落ちのロット → 停止S2 */
  await setMode('schedule');
  const reasons=await page.evaluate(async e=>((await (await fetch('/api/schedule/stop-reason-master?equipment='
    +encodeURIComponent(e))).json()).items||[]),EQ);
  const rid=(reasons[0]||{}).id;
  const add=async b=>{const r=await post('/api/schedule/plan/add',Object.assign({equipment:EQ},b));made.push(r.body.id);return r.body.id};
  await add({kind:'設備停止',title:TAG+'S1',stopReasonId:rid,estimateMinutes:30});
  const gone=await add({kind:'作業',lotNo:TAG+'GONE',castingNo:'C0001',title:TAG+'GONE',
    detail:{'ロット番号':TAG+'GONE','鋳造番号':'C0001','前工程実績_作業終了_日付':'2026-09-09'}});
  await add({kind:'設備停止',title:TAG+'S2',stopReasonId:rid,estimateMinutes:30});
  rec('材料を足せた（停止2件・仕掛落ちのロット1件）',made.every(Boolean),JSON.stringify(made));

  // ---- 編集モード・区分の列なし（利用者のスクリーンショットと同じ形） ----
  await setMode('edit');
  await setLayout(['__cat__','lotNo','mfgMaterial','__est__','__actions__'],['__cat__']);
  await open();
  let rows=await scan();
  const need=rows.filter(x=>x.need),done=rows.filter(x=>x.done);
  rec(`① 時刻未登録の行は操作の列に押せる「時刻入力」 ${need.filter(x=>x.btn&&x.btn.on).length}/${need.length}`,
      need.length>=2&&need.every(x=>x.btn&&x.btn.on&&x.btn.text==='時刻入力'),JSON.stringify(need.map(x=>x.btn)));
  rec(`② 区分の列が無ければ操作の列に「完了」 ${done.filter(x=>x.chip&&x.chip.text==='完了').length}/${done.length}`,
      done.length>=2&&done.every(x=>x.chip&&x.chip.text==='完了'),JSON.stringify(done.map(x=>x.chip)));
  rec('② 自動で完了にした行は、なぜ完了かを title で言う',
      done.filter(x=>x.auto).every(x=>x.chip&&/（.+）/.test(x.chip.title)),JSON.stringify(done.filter(x=>x.auto).map(x=>x.chip&&x.chip.title)));
  if(process.env.WAVELOG_SHOT)await page.screenshot({path:process.env.WAVELOG_SHOT,clip:{x:240,y:90,width:1488,height:260}});
  rec('④ 操作の列の中身は列の幅からはみ出さない（全行）',rows.length>0&&rows.every(x=>x.over<=0),
      `最大 ${Math.max(...rows.map(x=>x.over))}px / ${rows.length}行`);

  // ---- ⑤ 押して登録（編集モードのまま） ----
  await page.evaluate(id=>document.querySelector(`.sc-row-line[data-id="${id}"]`).scrollIntoView({block:'center'}),gone);
  await page.click(`.sc-row-line[data-id="${gone}"] .sc-row-times`);
  await W.until(page,()=>!!document.getElementById('sctForm'),null,{ms:8000,what:'時刻の窓'});
  await page.click('#appConfirmOk');
  const saved=await W.poll(()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json())
    .then(j=>(j.entries||[]).find(e=>String(e.id)===String(gone))),e=>!!(e&&e.actual&&e.actual.source==='手入力'),15000);
  rec('⑤ 編集モードのまま押して登録できる（手入力の時刻が入り、時刻未登録でなくなる）',
      !!(saved&&saved.actual&&saved.actual.source==='手入力'&&!saved.timesNeeded),JSON.stringify(saved&&saved.actual));

  // ---- ③ 区分の列を出していれば操作の列には出さない ----
  await setLayout(['__cat__','lotNo','mfgMaterial','__est__','__actions__']);
  await open();
  rows=await scan();
  const d2=rows.filter(x=>x.done);
  rec('③ 区分の列を出していれば「完了」は行に1つだけ（区分のセル）',
      d2.length>=2&&d2.every(x=>!x.chip&&x.doneWords===1),JSON.stringify(d2.map(x=>({chip:!!x.chip,n:x.doneWords}))));

  // ---- ⑥ 入れられない端末: 押せない形・理由・ダブルクリックも開かない ----
  await page.route('**/api/schedule/plan?*',async route=>{
   const r=await route.fetch();const j=await r.json();
   j.canEnterTimes=false;j.timesDenied='テスト: この端末では入れられません';
   route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(j)});
  });
  await open();
  rows=await scan();
  const n3=rows.filter(x=>x.need);
  rec('⑥ 入れられない端末では押せない形で残し、理由を title で言う',
      n3.length>=1&&n3.every(x=>x.btn&&!x.btn.on&&/入れられません/.test(x.btn.title)),JSON.stringify(n3.map(x=>x.btn)));
  if(n3[0]){
   await page.dblclick(`.sc-row-line[data-id="${n3[0].id}"] [data-col="lotNo"]`).catch(()=>{});
   await W.settle(page);
   rec('⑥ ダブルクリックでも窓は開かない',!(await page.evaluate(()=>!!document.getElementById('sctForm'))));
  }
  await page.unroute('**/api/schedule/plan?*');

  // ---- ⑦ 編集モードから通るのは実際の時刻だけ ----
  const r7=await post('/api/schedule/plan/update',{id:made[0],equipment:EQ,remark:'編集モードからの備考'});
  rec('⑦ 編集モードから備考などは直せない（403・理由つき）',r7.status===403&&/実際の時刻だけ/.test(r7.body.error||''),
      JSON.stringify(r7));
 }finally{
  await setMode('schedule');
  for(const id of made)if(id)await post('/api/schedule/plan/delete',{id,equipment:EQ});
  await H.restoreLayout(TARGET,layout);
  await setMode('edit');
 }
},{viewport:{width:1728,height:1050}});
