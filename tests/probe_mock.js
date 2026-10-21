/* 一時の網（コミットしない）: 案の試作を本物の仕掛一覧へ当てて撮る */
'use strict';
const {run}=require('./lib/harness.js');
const path=require('path'),fs=require('fs');
const DIR=process.env.MOCK_DIR,OUT=process.env.SHOT_DIR;
const LIST=(process.env.MOCKS||'A').split(',');
run('probe_mock',async({page,rec,W,idle,paint,setMode,errs})=>{
 await setMode('edit');
 const common=fs.readFileSync(path.join(DIR,'common.js'),'utf8');
 for(const [vw,vh] of [[1728,1152],[1536,864]]){
  await page.setViewportSize({width:vw,height:vh});
  for(const m of LIST){
   const code=fs.readFileSync(path.join(DIR,m+'.js'),'utf8');
   for(const st of [1,2,3,4]){
    await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
    await W.booted(page);await idle();
    await page.click('aside [data-db-key]');
    await page.waitForSelector('#grid tbody tr',{timeout:25000});await idle();
    /* 使用設備の案内（帯の上の橙の札）は撮る対象ではないので畳む */
    await page.evaluate(()=>{document.querySelectorAll('.eq-guide,.setup-banner,#eqSetupBanner,[class*="guide"]').forEach(e=>{if(/使用設備を設定/.test(e.textContent||'')&&e.getBoundingClientRect().height<120)e.style.display='none'})});
    await page.addScriptTag({content:common});
    await page.addScriptTag({content:code});
    const r=await page.evaluate(s=>{try{window.P.state(s);return 'ok'}catch(e){return String(e.stack||e)}},st);
    if(r!=='ok')console.log('ERR',m,st,r);
    await paint();
    await page.screenshot({path:path.join(OUT,`${m}-${vw}-${st}.png`)});
   }
  }
 }
 rec('shots',errs.length===0,errs.slice(0,3).join(' / '));
},{viewport:{width:1728,height:1152}});
