/* test_stoprules.js: 足りない設備停止の提案と自動挿入（§9.588、利用者の指示）
   ============================================================
   「スケジュールを評価して不足している設備停止があれば、自動挿入か黄色などの目立つ色で警告して
    表示する機能」「黄色(変更可能)の表示から不足している設備停止をサジェストしてボタン1つで登録(修正も
    可能)できる」「判定はスケジュールからロットが追加・削除、並び替えされるごとに、ロットがもと居た場所の
    前後と新しく挿入された前後ロットの情報から判定」「その設備停止の挿入数、挿入すべきそれぞれの時間と
    自動挿入か、警告のみか選べる」

   物差し（前の値は §9.588 の決定記録）:
    M4. 条件に当たって足りない境目を知らせる数（前 0・機能なし）→ 当たる境目の数
    M5. 並べ替えで新しくできた境目に「自動で入れる」決まりの設備停止が入る数（前 0）→ 1
    M6. 前から在る境目には自動で入れない（人が外した設備停止を入れ直さない）
   ほかに固定すること:
    1. 判定（`WL.stopRules.evaluate`）: 前・後ろ・変わったか・差の4つの列、挿入数・それぞれの時間、足りている境目は出さない
    2. 帯は後ろのロットの行のすぐ上・既定は黄（行表示マスタ「足りない設備停止」）・字で「足りません」と理由
    3. 「入れる」で1手（後ろのロットの前・決まりの分）、入れたら帯が消える。外すとまた出る（状態を持たない）
    4. 「今回は入れない」はその境目だけ・読み直しても残る・「元に戻す」で戻る
    5. 「直して入れる…」は設備停止の窓を、停止内容と分を入れて開く
   材料（停止内容と挿入の条件）は自分で作り、自分で消す。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='RTR'+process.pid;

run('test_stoprules: 足りない設備停止（§9.588）', async ({page,rec,B,W,idle,errs})=>{
 let stopId=null;
 const post=(p,body)=>page.evaluate(async a=>{
  const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-stoprules'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   last={status:r.status,body:j};
   if(r.status!==423)return last;
   await new Promise(z=>setTimeout(z,400));   // 共有の書込ロックが空くのを待つ（§4.2）
  }
  return last;
 },{p,b:body||{}});
 const entries=()=>page.evaluate(()=>WL.scheduleView.entries());
 const idOf=async lot=>((await entries()).find(e=>e.kind==='作業'&&!e.parentId&&e.lotNo===lot)||{}).id;
 /* 帯: 後ろのロットの行のすぐ上の`.sc-stop-gap`（行ではない）。 */
 const gapBefore=id=>page.evaluate(i=>{
  const row=document.querySelector(`#scTimeline .sc-row-line[data-id="${i}"]`);
  let s=row&&row.previousElementSibling;
  while(s&&!s.classList.contains('sc-row-line')&&!s.classList.contains('sc-stop-gap'))s=s.previousElementSibling;
  return s&&s.classList.contains('sc-stop-gap')?{text:s.textContent.replace(/\s+/g,' '),cls:s.className,
   btns:[...s.querySelectorAll('[data-sg]')].map(b=>b.dataset.sg)}:null;
 },String(id));
 const stopsBefore=async id=>{
  const es=await entries();const i=es.findIndex(e=>String(e.id)===String(id));
  const out=[];for(let k=i-1;k>=0&&es[k].kind!=='作業';k--)if(es[k].kind==='設備停止'&&es[k].title===TAG+'段取り')out.push(es[k]);
  return out;
 };
 const reloadAll=async()=>{await page.evaluate(()=>WL.scheduleView.reloadStopReasons());await page.evaluate(()=>WL.scheduleView.reloadPlan());await idle()};
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);

  // ---- 1. 判定（純粋な関数・合成した予定で） ----
  const pure=await page.evaluate(()=>{
   const L=(id,v)=>({id,kind:'作業',state:'予定',lotNo:'L'+id,detail:v});
   const S=(id,t)=>({id,kind:'設備停止',state:'予定',title:t,detail:{}});
   const es=[L(1,{製造材質:'A5052',製造板厚:'0.5'}),L(2,{製造材質:'A1100',製造板厚:'0.8'}),S(3,'段'),
             L(4,{製造材質:'A1100',製造板厚:'0.8'}),L(5,{製造材質:'A1100',製造板厚:'1.5'})];
   const stop={id:9,name:'段',standardMinutes:30,insertRule:{stored:true,cols:[],rows:[
    {conditions:[{field:'chg.製造材質',op:'eq',value:'変わる'}],count:2,minutes:[40,15],action:'warn'},
    {conditions:[{field:'diff.製造板厚',op:'ge',value:'0.5'}],count:1,minutes:[],action:'auto'},
    {conditions:[],count:0,minutes:[],action:'warn'}]}};
   const vocab={sets:[{key:'prev',kind:'auto'},{key:'next',kind:'auto'},{key:'chg',kind:'choice',options:['変わる','同じ']},{key:'diff',kind:'num'}]};
   const val=(e,k)=>e.detail[k];
   return WL.stopRules.evaluate(es,[stop],val,vocab).map(s=>({pair:s.pair,need:s.need,have:s.have,minutes:s.minutes,action:s.action,reason:s.reason}));
  });
  rec('1: 材質が変わる境目（1>2）は2本要る・あいだに無いので2本とも足りない（時間は決まりの40・15）',
      pure.some(s=>s.pair==='1>2'&&s.need===2&&s.have===0&&s.minutes.join()==='40,15'),JSON.stringify(pure));
  rec('1: 変わらない境目（2>4）は当たらない・板厚の差 0.7（4>5）は既定の分（null）で自動の決まり',
      !pure.some(s=>s.pair==='2>4')&&pure.some(s=>s.pair==='4>5'&&s.action==='auto'&&s.minutes.join()===''&&s.minutes.length===1),
      JSON.stringify(pure));
  rec('1: 理由はその境目の実際の値を添える',pure.some(s=>s.pair==='1>2'&&/A5052 → A1100/.test(s.reason)),
      JSON.stringify(pure.map(s=>s.reason)));

  // ---- 材料: 停止内容と挿入の条件 ----
  const reg=await post('/api/schedule/stop-reason-master',{equipment:EQ,name:TAG+'段取り',category:'段取り',standardMinutes:30});
  stopId=reg.body.id;
  const L3='L0003',L6='L0006';
  const sv=await post('/api/schedule/stop-rule',{stopId,cols:['next.ロット番号'],rows:[
   {conditions:[{field:'next.ロット番号',op:'eq',value:L3}],count:1,minutes:[25],action:'warn'},
   {conditions:[{field:'next.ロット番号',op:'eq',value:L6}],count:1,minutes:[],action:'auto'},
   {conditions:[],count:0,minutes:[],action:'warn'}]});
  rec('材料: 停止内容と挿入の条件を保存できた',!!stopId&&sv.status===200,JSON.stringify(sv.body).slice(0,160));

  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await reloadAll();
  const id3=await idOf(L3),id6=await idOf(L6);
  await W.until(page,i=>!!document.querySelector(`#scTimeline .sc-row-line[data-id="${i}"]`)
   &&!!document.querySelector('#scTimeline .sc-stop-gap'),String(id3),{ms:20000,what:'黄色の帯'});

  // ---- 2. 帯 ----
  const g3=await gapBefore(id3);
  rec('2: 帯は後ろのロットの行のすぐ上・既定は黄・字で「足りません」と決まりの分',
      !!g3&&/sc-rs-yellow/.test(g3.cls)&&g3.text.includes(TAG+'段取り 25分')&&/足りません/.test(g3.text)&&g3.text.includes(L3),
      JSON.stringify(g3).slice(0,240));
  rec('2: スケジュールモードでは「入れる／直して入れる…／今回は入れない」の3つ',!!g3&&g3.btns.join()==='add,edit,skip',
      JSON.stringify(g3&&g3.btns));
  const nGaps=await page.evaluate(()=>document.querySelectorAll('#scTimeline .sc-stop-gap').length);
  rec(`M4: 足りない境目を知らせる数 2（前 0）——今は ${nGaps}`,nGaps===2,'');
  rec('M6: 前から在る境目には自動で入れない（自動の決まりでも帯で知らせるだけ）',
      (await stopsBefore(id6)).length===0&&!!(await gapBefore(id6)),'');

  // ---- 3. 入れる（1手）→ 帯が消える → 外すとまた出る ----
  await page.click(`#scTimeline .sc-stop-gap:has(+ .sc-row-line[data-id="${id3}"]) [data-sg="add"]`);
  await W.until(page,i=>{const es=WL.scheduleView.entries();const k=es.findIndex(e=>String(e.id)===i);
   return k>0&&es[k-1].kind==='設備停止'&&!es[k-1].__pending},String(id3),{ms:25000,what:'入れた設備停止が反映された'});
  await idle();
  const ins=await stopsBefore(id3);
  rec('3: 「入れる」で後ろのロットのすぐ前へ1本（決まりの分 25分）',ins.length===1&&((ins[0].estimate||{}).minutes===25),
      JSON.stringify(ins.map(e=>e.estimate)));
  rec('3: 入れたら帯が消える',!(await gapBefore(id3)),'');
  await post('/api/schedule/plan/delete',{equipment:EQ,id:ins[0]&&ins[0].id});
  await reloadAll();
  rec('3: 外すとまた出る（状態を持たずに数える）',!!(await gapBefore(id3)),'');

  // ---- 4. 今回は入れない → 読み直しても残る → 元に戻す ----
  await page.click(`#scTimeline .sc-stop-gap:has(+ .sc-row-line[data-id="${id3}"]) [data-sg="skip"]`);
  rec('4: 「今回は入れない」で帯が消える',!(await gapBefore(id3)),'');
  await W.until(page,()=>!document.querySelector('.sc-row-pending'),null,{ms:20000,what:'書込が済んだ'});
  await reloadAll();
  const e3=(await entries()).find(e=>e.id===id3);
  rec('4: 読み直しても残る（後ろのロットに「停止×前のロット」で控える）',!(await gapBefore(id3))
      &&(e3.stopSkips||[]).some(x=>x.stopId===stopId),JSON.stringify(e3&&e3.stopSkips));
  const undo=await post('/api/schedule/plan/update',{id:id3,stopSkip:{stopId,prevId:(e3.stopSkips||[])[0]&&e3.stopSkips[0].prevId,skip:false}});
  await reloadAll();
  rec('4: 外せば（元に戻す）また出る',undo.status===200&&!!(await gapBefore(id3)),JSON.stringify(undo.body).slice(0,120));

  // ---- 5. 直して入れる… ----
  await page.click(`#scTimeline .sc-stop-gap:has(+ .sc-row-line[data-id="${id6}"]) [data-sg="edit"]`);
  await W.until(page,()=>{const m=document.getElementById('scStopModal');return !!m&&!m.hidden},null,{ms:10000,what:'設備停止の窓'});
  const pane=await page.evaluate(()=>document.getElementById('scStopModal').textContent.replace(/\s+/g,' '));
  rec('5: 「直して入れる…」は設備停止の窓を、停止内容と分（既定 30分）を入れて開く',pane.includes(TAG+'段取り')&&pane.includes('30分'),
      pane.slice(0,200));
  await page.click('#scStopModalClose');

  // ---- M5: 並べ替えで新しくできた境目には自動で入る ----
  await page.focus(`#scTimeline .sc-row-line[data-id="${id6}"]`);
  await page.keyboard.down('Alt');await page.keyboard.press('ArrowUp');await page.keyboard.up('Alt');
  await W.until(page,i=>{const es=WL.scheduleView.entries();const k=es.findIndex(e=>String(e.id)===i);
   return k>0&&es[k-1].kind==='設備停止'&&!es[k-1].__pending},String(id6),{ms:30000,what:'自動で入った設備停止'});
  const auto=await stopsBefore(id6);
  rec(`M5: 並べ替えで新しくできた境目に自動で入る数 1（前 0）——今は ${auto.length}`,auto.length===1,JSON.stringify(auto.map(e=>e.title)));
  rec('JSエラーが出ていない',!errs.length,errs.slice(0,2).join(' / '));
 }finally{
  if(stopId){
   await post('/api/schedule/stop-rule',{stopId,reset:true});
   await post('/api/schedule/stop-reason-master/delete',{id:stopId});
  }
  await post('/api/access-mode',{mode:'edit'});
 }
},{viewport:{width:1728,height:1030}});
