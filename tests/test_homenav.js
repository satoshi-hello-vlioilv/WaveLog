/* test_homenav.js: ダッシュボードはメニューの上・起動時の初期画面（利用者の指示・§9.630 ⑤）
   ============================================================
   「左メニューのダッシュボードの位置はメニュー上部に持ってきて、起動時の初期画面にしてください。」
   物差し:
     - 左メニューで「ダッシュボード」の上にある行き先の数（直す前 7 前後・後 0）
     - まっさらな端末で起動したとき、ダッシュボードが開いているか
     - 「表示」の「起動時に開く画面」で仕掛一覧を選ぶと、次の起動から仕掛一覧で始まる（端末に覚える）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');

run('test_homenav: ダッシュボードはメニューの上・起動時の画面',async({page,rec,B,W,idle})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 const above=await page.evaluate(()=>{
  const all=[...document.querySelectorAll('aside .nav-item')],i=all.findIndex(b=>b.id==='openDashboard');
  return {i,names:all.slice(0,Math.max(0,i)).map(b=>b.textContent.trim())};
 });
 rec(`ダッシュボードはメニューのいちばん上（上にある行き先 ${above.i}）`,above.i===0,above.names.join('・'));
 await W.until(page,()=>document.body.classList.contains('db-mode')&&!!document.querySelector('#dashGrid .dash-p'),null,{ms:20000,what:'起動するとダッシュボードが開く'});
 rec('まっさらな端末で起動するとダッシュボードが開いている',await page.evaluate(()=>document.body.classList.contains('db-mode')&&!document.getElementById('dashScreen').hidden),
  await page.evaluate(()=>`起動時の画面=${WL.startView.get()} 本体=${document.body.className}`));
 rec('左メニューの印もダッシュボード',await page.evaluate(()=>document.getElementById('openDashboard').classList.contains('active')||document.getElementById('openDashboard').getAttribute('aria-current')==='page'));
 /* 「表示」の節で仕掛一覧を選ぶ（人と同じ道） */
 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu [data-start-view="list"]',{timeout:8000});
 const word=await page.$eval('#uiSizeMenu',m=>m.textContent);
 rec('「表示」に「起動時に開く画面」があり、次の起動から効くと書いてある',/起動時に開く画面（次の起動から）/.test(word));
 rec('いまの選び（ダッシュボード）に印',await page.$eval('#uiSizeMenu [data-start-view="dashboard"]',b=>b.classList.contains('is-current')));
 await page.click('#uiSizeMenu [data-start-view="list"]');
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 rec('仕掛一覧を選ぶと、次の起動は仕掛一覧で始まる',await page.evaluate(()=>!document.body.classList.contains('db-mode')&&WL.startView.get()==='list'));
},{mode:'edit',start:'dashboard',viewport:{width:1728,height:1152}});
