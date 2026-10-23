/* test_dashboard.js: ダッシュボード（§9.628・LotScope のグリッドのパネルを移植）
   ============================================================
   WAVELOG_SHOT=<dir> で画面を撮る（利用者の PC 1728×1152 とフル HD・125% の 1536×864）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const path=require('path');
const SHOT=process.env.WAVELOG_SHOT||'';
const SIZES=[['1728',{width:1728,height:1152}],['1536',{width:1536,height:864}]];

run('test_dashboard: ダッシュボード',async({page,rec,B,W,idle})=>{
 for(const [tag,vp] of SIZES){
  await page.setViewportSize(vp);
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await W.nav(page,'#openDashboard');
  await W.until(page,()=>{const p=document.getElementById('dashboardPanel');return !!p&&!p.hidden},null,{ms:15000,what:'ダッシュボードが開く'});
  await idle();
  for(const v of ['status','equipment','pivot']){
   const tab=await page.$(`[data-dbview="${v}"]`);
   if(!tab)continue;
   await tab.click();await idle();
   if (process.env.WAVELOG_SHOT)await page.screenshot({path:path.join(SHOT,`before_${tag}_${v}.png`)});
  }
  rec(`ダッシュボードが開く（${tag}）`,await page.evaluate(()=>!!document.getElementById('dashboardPanel')));
 }
},{mode:'edit'});
