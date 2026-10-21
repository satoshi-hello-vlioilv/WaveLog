/* test_recshareui.js: 別の PC で完了した記録は、この PC の一覧でも「完了」で見え、開いても消えない（§9.616）
   ============================================================
   利用者の報告「測定完了済みのデータが、測定したそのPCでしか閲覧できない」。

   物差し（評価関数）: 共有に**別の PC の完了**（記録IDはロットから決まる）を1件置き、この PC で
   ふつうの操作をしたあとに、その完了が ①一覧で「完了」として見えるか ②共有の中で完了のまま残るか を数える。
    U1. この PC に同じ記録の古い「編集中」がある（前にこのロットを開いた）→ 一覧は共有の新しい状態「完了」で出す
        （以前は手元の状態のまま「編集中」の側へ入り、完了の一覧に出なかった）
    U2. この PC で同じロットを測定画面から開く → 共有の完了を空の記録で上書きしない
        （以前は同じ記録IDの空の記録を作って共有へ送り、別の PC の完了がまるごと消えた）
        ——この PC に古い「編集中」が残っているとき（それで再開すると、古い中身で共有を上書きする）
    U3. 開くと「完了済み」と分かる（再編集するかを聞く。断れば何も書かない）
    U4. この PC に何も無いとき（初めてこのロットを開く PC）も U2・U3 と同じ
   ============================================================ */
'use strict';
const {run,seedRecord}=require('./lib/harness.js');
const API='http://127.0.0.1:5029',EQ='テスト設備A';

run('test_recshareui: 別の PC の完了はこの PC でも完了で見え、開いても消えない（§9.616）', async ({page,rec,W,idle})=>{
 await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:25000});
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 /* 分割の無い、この設備のロットを1つ。記録IDは製品と同じ`lotKey()`で作る。 */
 const pickRow=await page.evaluate(async eq=>{
  const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:50,include_hidden:1}));
  const rows=(await r.json()).rows||[];
  const row=rows.find(x=>String(x['BOX設計_設備名']||x['設備']||'').includes(eq)&&!WL.split.hasSplit(x));
  return row?{row,id:WL.base.lotKey(row),lot:String(row['ロット番号']||'')}:null;
 },EQ);
 rec('前提: 分割の無いこの設備のロットがある',!!pickRow,JSON.stringify(pickRow&&{id:pickRow.id}));
 if(!pickRow)return;
 const {row,id,lot}=pickRow;
 const doneAt=new Date().toISOString();
 const doneRecord={id,status:'完了',updatedAt:doneAt,basic:{lotNo:lot,inspectionNo:String(row['検査番号']||''),castingNo:String(row['鋳造番号']||'')},
  settings:{registeredEquipment:EQ},measurements:{width:[['123.4']]},workLog:{}};
 /* 別の PC が完了を共有へ送った（この PC の手元には無い）。 */
 await seedRecord({id,equipment:EQ,lotNo:lot,inspectionNo:doneRecord.basic.inspectionNo,castingNo:doneRecord.basic.castingNo,
  status:'完了',extra:{updatedAt:doneAt,measurements:doneRecord.measurements}});
 const shared=()=>page.evaluate(async id=>{const r=await fetch('/api/measurement/backup/get?id='+encodeURIComponent(id)).then(x=>x.json()).catch(()=>({}));
  const it=r.item;if(!it)return null;let p={};try{p=JSON.parse(it.payload)}catch(e){p={bad:String(e)}}return{status:it.status,width:p.measurements?.width?.[0]?.[0]||''}},id);

 /* U1: 前にこのロットを開いて残った古い「編集中」がこの PC にある。 */
 await page.evaluate(async([id,lot])=>{
  await WL.records.reliablePut({id,status:'編集中',updatedAt:'2026-01-01T00:00:00.000Z',basic:{lotNo:lot},settings:{},measurements:{}});
 },[id,lot]);
 const u1=await page.evaluate(async id=>{const all=await WL.records.mergedRecords();const x=all.find(r=>r.id===id);
  return x?{status:x.status,remoteNewer:!!x.remoteNewer}:null},id);
 rec('U1. 手元に古い「編集中」があっても、一覧は共有の新しい状態「完了」で出す',u1&&u1.status==='完了'&&u1.remoteNewer,JSON.stringify(u1));
 /* U2/U3: 古い「編集中」を残したまま、同じロットを測定画面から開く。確かめの窓が出たら「キャンセル」（再編集しない）。 */
 const openAndDecline=async()=>{
  let asked='';
  const opening=page.evaluate(async row=>{try{await WL.records.openMeasurement(row);return 'ok'}catch(e){return '例外: '+e.message}},row);
  const modal=await page.waitForFunction(()=>{const m=document.getElementById('appConfirmModal');return m&&!m.hidden?m.textContent.slice(0,200):''},null,{timeout:15000})
   .then(h=>h.jsonValue()).catch(()=>'');
  if(modal){asked=String(modal);await page.click('#closeAppConfirm').catch(()=>{})}
  const opened=await opening;
  await idle(500);
  await page.evaluate(()=>{try{WL.records.closeMeasureModal&&WL.records.closeMeasureModal()}catch(e){console.log('測定画面を閉じられない（次へ進む）: '+e.message)}});
  return{asked,opened,共有:await shared()};
 };
 const u2=await openAndDecline();
 rec('U2. 古い「編集中」が残っていても、開いて共有の完了を上書きしない（完了・中身のまま）',
  u2.共有&&u2.共有.status==='完了'&&u2.共有.width==='123.4',JSON.stringify({開いた:u2.opened,共有:u2.共有}));
 rec('U3. 開くと「完了済み」と分かり、再編集するかを聞く',/完了/.test(u2.asked),JSON.stringify(u2.asked.slice(0,120)));

 /* U4: この PC に何も無い。`reliableDelete`は共有の行も消すので、消したあとで別の PC の完了を置き直す。 */
 await page.evaluate(async id=>{await WL.records.reliableDelete(id)},id).catch(()=>{});
 await seedRecord({id,equipment:EQ,lotNo:lot,inspectionNo:doneRecord.basic.inspectionNo,castingNo:doneRecord.basic.castingNo,
  status:'完了',extra:{updatedAt:new Date().toISOString(),measurements:doneRecord.measurements}});
 const local0=await page.evaluate(async id=>!!(await WL.records.reliableGet(id)),id);
 const u4=await openAndDecline();
 rec('U4. この PC に何も無くても、開いて共有の完了を上書きしない・再編集するかを聞く',
  !local0&&u4.共有&&u4.共有.status==='完了'&&u4.共有.width==='123.4'&&/完了/.test(u4.asked),
  JSON.stringify({手元に在った:local0,開いた:u4.opened,共有:u4.共有,聞いた:u4.asked.slice(0,60)}));
},{viewport:{width:1728,height:1152}});
