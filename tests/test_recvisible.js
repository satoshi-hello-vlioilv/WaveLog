/* test_recvisible.js: 共有に在る測定データは、どのモード・どの設備の設定の PC からも一覧で見つけられる（§9.618）
   ============================================================
   利用者の報告「測定したPCからは完了データがみられるのに、そのPC以外からはやはり見られない。権限によるロックの
   可能性もあるのではないか」。

   物差し（評価関数）: 共有へ**別の PC の記録**を4件置く（この PC と同じ設備／違う設備 × 編集中／完了）。
   この PC（設備＝テスト設備A）が モード（編集／閲覧／スケジュール）× タブ（編集中／完了）で一覧を開き、
   ①出ている記録 ②伏せている件数の札（「◯◯のみ 他N件」）を数える。**届いているのに出ず、札も言わない**記録が 0 が正。
    V1. 同じ設備の記録は、どのモードでも状態のタブに出る（完了は「完了」・編集中は「編集中」）
    V2. 違う設備の記録は、伏せるなら札が件数で言い、「すべての設備」にすると出る
    V3. モードで出る記録が変わらない（権限・モードで伏せない）
   ============================================================ */
'use strict';
const {run,seedRecord}=require('./lib/harness.js');
const API='http://127.0.0.1:5029',EQ='テスト設備A',OTHER='別の設備X';

run('test_recvisible: 共有の測定データはどのモード・どの設備の設定でも見つけられる（§9.618）', async ({page,rec,W,idle,setMode})=>{
 const stamp=Date.now().toString(36);
 const seeds=[
  {key:'同じ設備・編集中',equipment:EQ,status:'編集中'},{key:'同じ設備・完了',equipment:EQ,status:'完了'},
  {key:'違う設備・編集中',equipment:OTHER,status:'編集中'},{key:'違う設備・完了',equipment:OTHER,status:'完了'},
 ].map((s,i)=>Object.assign(s,{id:`VIS-${stamp}-${i}`,lotNo:`VIS${stamp}${i}`}));
 for(const s of seeds)await seedRecord({id:s.id,equipment:s.equipment,lotNo:s.lotNo,status:s.status,
  extra:{updatedAt:new Date().toISOString()}});
 const ids=seeds.map(s=>s.id);
 const open=async(mode,tab,scope)=>{
  await setMode(mode);
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(([e,s])=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   if(s)localStorage.setItem('MeasurementRecordScopeV1',s);else localStorage.removeItem('MeasurementRecordScopeV1')},[EQ,scope||'']);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.evaluate(t=>WL.records.openRecords(t),tab==='完了'?'履歴':'編集中');
  await W.until(page,()=>{const l=document.getElementById('recordList');return l&&!/読み込んでいます/.test(l.textContent)},null,{ms:15000,what:'一覧'});
  await idle();
  return page.evaluate(ids=>({shown:[...document.querySelectorAll('#recordList [data-rec-id]')].map(r=>r.dataset.recId).filter(x=>ids.includes(x)),
   scope:(document.getElementById('recordScopeBtn')||{}).textContent||''}),ids);
 };
 const result={};
 for(const mode of ['edit','view','schedule'])for(const tab of ['編集中','完了']){
  const got=await open(mode,tab,'');
  result[`${mode}/${tab}`]=got;
  const want=seeds.filter(s=>s.equipment===EQ&&s.status===tab).map(s=>s.id);
  rec(`V1. ${mode}・${tab}: 同じ設備の${tab}の記録が出る`,want.every(x=>got.shown.includes(x)),JSON.stringify({出た:got.shown.map(x=>seeds.find(s=>s.id===x).key),札:got.scope}));
  const hidden=seeds.filter(s=>s.equipment!==EQ&&s.status===tab&&!got.shown.includes(s.id));
  rec(`V2. ${mode}・${tab}: 違う設備の記録は、出ていなければ札が「他N件」で言う`,!hidden.length||/他\s*\d+件/.test(got.scope),JSON.stringify({伏せた:hidden.map(s=>s.key),札:got.scope}));
 }
 const sameAcross=['編集中','完了'].every(tab=>{const a=['edit','view','schedule'].map(m=>JSON.stringify([...result[`${m}/${tab}`].shown].sort()));return a.every(x=>x===a[0])});
 rec('V3. モード（編集／閲覧／スケジュール）で出る記録が変わらない',sameAcross,JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.shown.length]))));
 await setMode('edit');
 await page.evaluate(async ids=>{await fetch('/api/measurement/backup/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})})},ids);
},{viewport:{width:1728,height:1152}});
