/* test_dashsrc.js: ダッシュボードのパネルの「データ」（元）を選び直せる（利用者の報告・§9.630 ③）
   ============================================================
   「パネルを組み立てる際にデータ参照元を選びなおそうとしても選べない」——組む所の「データ」の選択肢が、
   サーバーが返さない鍵（place）で全部「選べない」にされていた（LotScope から移したときの名残り）。
   物差し（評価関数）:
     - 選べる元の数（直す前 0 / 元の数）
     - 選び直すと、パネルの元がその元へ変わる
     - 写しがまだ無い元は「写しています」と字で言う（選べるが、選んだときに読み直しを待つ）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');

run('test_dashsrc: パネルの元を選び直せる',async({page,rec,B,W,idle})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 const items=await page.evaluate(async()=>(await (await fetch('/api/dashboard/sources')).json()).items||[]);
 rec('元の並びに状態がある（ready／copying／unset のどれか）',items.length>0&&items.every(x=>['ready','copying','unset'].includes(x.state)),
     items.map(x=>`${x.key}:${x.state}`).join(' '));
 await page.evaluate(()=>{WL.dashboard.open();WL.dashboard._open('b:standard')});
 await W.until(page,()=>WL.dashboard._state().id==='b:standard'&&!!document.querySelector('#dashGrid .dash-p[data-id="wipTotal"]'),null,{ms:20000,what:'「仕掛と完了」が開く'});
 await page.click('#dashGrid .dash-p[data-id="wipTotal"] .dash-ph',{button:'right'});
 await page.waitForSelector('.wl-menu [role=menuitem]',{timeout:8000});
 await page.evaluate(()=>{const b=[...document.querySelectorAll('.wl-menu [role=menuitem]')].find(x=>/組む…/.test(x.textContent));if(b)b.click()});
 await page.waitForSelector('#dashEditor [data-de-src]',{timeout:15000});
 const opts=await page.$$eval('#dashEditor [data-de-src] option',os=>os.map(o=>({v:o.value,dis:o.disabled,t:o.textContent})));
 const ok=opts.filter(o=>!o.dis);
 rec(`選べる元がある（${ok.length}/${opts.length}）`,ok.length>=2,opts.map(o=>`${o.v}${o.dis?'×':''}`).join(' '));
 const want=items.filter(x=>x.state==='unset').map(x=>x.key);
 rec('選べないのは置き場が未設定の元だけ',opts.filter(o=>o.dis).every(o=>want.includes(o.v)),JSON.stringify(opts.filter(o=>o.dis)));
 await page.selectOption('#dashEditor [data-de-src]','rec');
 await W.until(page,()=>(document.querySelector('#dashEditor [data-de-src]')||{}).value==='rec',null,{ms:8000,what:'元が測定データに変わる'});
 rec('選び直すと元が測定データに変わる',await page.$eval('#dashEditor [data-de-src]',s=>s.value==='rec'));
 const copying=items.filter(x=>x.state==='copying').map(x=>x.key);
 rec('写し中の元は字で言う',opts.filter(o=>copying.includes(o.v)).every(o=>/写しています/.test(o.t)),JSON.stringify(opts));
},{mode:'edit',viewport:{width:1728,height:1152}});
