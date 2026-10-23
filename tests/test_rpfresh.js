/* test_rpfresh.js: 帳票は同じ記録IDの新しい版（手元・共有）で描く（§9.623）
   ============================================================
   利用者の指摘「測定実績のリスト上のフラグが『完了』のものを帳票表示させると、右上が『完了』と出るときと
   『編集中』と出るときがある」。一覧は手元と共有の新しいほうの状態を見せる（§9.616）が、帳票はこの端末の保存を
   そのまま描いていた。

   物差し（評価関数）: この端末の保存に古い「編集中」の版、共有に新しい「完了」の版を置き、帳票を開く。
    F1. 一覧から開いた帳票の右上の札が「完了」
    F2. 紙の中身も新しい版（共有の版だけにあるオペレータの字が紙に出る）
    F3. 帳票の左の一覧で選び直しても「完了」のまま
    F4. 手元のほうが新しいときは手元の版のまま（共有の古い版で上書きしない）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function share(rec){
 await post('/api/measurement/backup',{id:rec.id,equipment:EQ,lotNo:rec.basic.lotNo,inspectionNo:'K',castingNo:'C',status:rec.status,
  codec:'json-full-v32',user_id:'tests',updated_at_iso:rec.updatedAt,payload:JSON.stringify(rec)});
}
run('test_rpfresh: 帳票は同じ記録IDの新しい版で描く（§9.623）', async ({page,rec,W,idle,setMode})=>{
 const stamp=Date.now().toString(36);
 const A={id:`FRESH-${stamp}-A`,lot:`FRA${stamp}`},M={id:`FRESH-${stamp}-M`,lot:`FRM${stamp}`};
 const old=new Date(Date.now()-3600e3).toISOString(),now=new Date().toISOString();
 const mk=(x,status,at,note)=>({id:x.id,status,updatedAt:at,registeredEquipment:EQ,
  basic:{lotNo:x.lot,inspectionNo:'K',castingNo:'C'},settings:{operator:note,registeredEquipment:EQ},measurements:{},
  syncState:{status:'synced',lastAttempt:at,lastError:'',attempts:1}});
 try{
  await setMode('edit');
  await share(mk(A,'完了',now,'共有の版'));                 // 共有が新しい
  await share(mk(M,'完了',old,'共有の古い版'));             // 手元が新しい
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(async([a,m])=>{for(const r of [a,m])await WL.records.reliablePut(WL.measureView.ensureMeasureShape(r))},
   [mk(A,'編集中',old,'手元の古い版'),mk(M,'編集中',now,'手元の新しい版')]);
  const badge=()=>page.evaluate(()=>(document.querySelector('#reportContent .rp-report-head-meta .rp-status-badge')||{}).textContent||'');
  const paper=()=>page.evaluate(()=>(document.querySelector('#reportContent')||{}).textContent||'');
  const open=async id=>{await page.evaluate(id=>window.openReportForRecord(id),id);
   await page.waitForSelector('#reportContent .rp-report-head-meta',{timeout:25000});await idle()};
  await open(A.id);
  const b1=await badge(),t1=await paper();
  rec('F1. 共有の版が新しい記録は、帳票の右上の札が「完了」',/完了/.test(b1),`札「${b1}」`);
  rec('F2. 紙の中身も新しい版（オペレータ「共有の版」）',t1.includes('共有の版')&&!t1.includes('手元の古い版'),
   t1.includes('共有の版')?'共有の版':t1.includes('手元の古い版')?'手元の古い版':'字なし');
  await page.evaluate(id=>{const r=[...document.querySelectorAll('#reportLotList .rp-lot-main-btn')].find(b=>b.textContent.includes(id));if(r)r.click()},A.lot);
  await idle();
  const b3=await badge();
  rec('F3. 帳票の一覧で選び直しても「完了」',/完了/.test(b3),`札「${b3}」`);
  await open(M.id);
  const b4=await badge(),t4=await paper();
  rec('F4. 手元が新しい記録は手元の版のまま（編集中・オペレータ「手元の新しい版」）',/編集中/.test(b4)&&t4.includes('手元の新しい版'),`札「${b4}」`);
 }finally{
  await post('/api/measurement/backup/delete',{ids:[A.id,M.id]}).catch(()=>{});
  await page.evaluate(async ids=>{for(const id of ids)await WL.records.reliableDelete(id).catch(()=>{})},[A.id,M.id]).catch(()=>{});
 }
},{viewport:{width:1728,height:1152}});
