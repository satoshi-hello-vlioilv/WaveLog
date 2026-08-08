/* メインメニューの畳み込み(§9.58)と、
   作業可否フラグを予定ロット全件へ行き渡らせる修正(§9.57)の検証 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const { addOrphanPlan } = require('./orphan_lot');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null,orphan=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());

 // 作業可否の検証(後半)の前提: 仕掛に無いロットの予定が1件あること。
 // 無いと索引は1ページ目で打ち切られる(それが正しい動き)。
 orphan=await addOrphanPlan(EQ);

 // ---------- メニューの畳み込み ----------
 await setMode('edit');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
   localStorage.removeItem('navCollapsedV1')});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForTimeout(2200);

 const width=()=>page.evaluate(()=>Math.round(document.querySelector('.layout>aside').getBoundingClientRect().width));
 const open=await width();
 rec('畳むボタンがメニュー内にある',!!(await page.$('#navCollapseToggle')));
 await page.click('#navCollapseToggle');await page.waitForTimeout(400);
 const rail=await width();
 rec('畳むと細い帯になる',rail<open&&rail<80,`${open}px → ${rail}px`);

 const railState=await page.evaluate(()=>{
  const a=document.querySelector('.layout>aside');
  const ar=a.getBoundingClientRect();
  return {
   icons:[...a.querySelectorAll('.nav-item')].filter(x=>x.offsetParent).length,
   labelsVisible:[...a.querySelectorAll('.nav-item span')].filter(x=>x.offsetParent).length,
   overflow:[...a.querySelectorAll('*')].some(e=>e.offsetParent&&e.getBoundingClientRect().right>ar.right+1),
   tip:document.querySelector('#openSchedule')?.title||'',
   mainWider:document.querySelector('main').getBoundingClientRect().width,
  };
 });
 rec('行き先(アイコン)は畳んでも全部見えている',railState.icons>=5,railState.icons+'個');
 rec('ラベルは隠れる',railState.labelsVisible===0,railState.labelsVisible+'個表示');
 rec('帯からはみ出す要素が無い',!railState.overflow);
 rec('ラベルの代わりにツールチップで行き先が分かる',railState.tip==='作業スケジュール',railState.tip);

 // 畳んだ状態でも画面遷移できる
 await page.click('#openSchedule');await page.waitForTimeout(2500);
 rec('畳んだままでも画面を切り替えられる',
   await page.evaluate(()=>!document.querySelector('#schedulePanel')?.hidden));
 await page.click('[data-db-key="SIKALOTNOW"]');await page.waitForTimeout(1500);

 // 再読込しても畳んだまま
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForTimeout(2200);
 rec('再読込しても畳んだままになる',(await width())<80,(await width())+'px');

 // 開き直すと元の幅へ戻る
 await page.click('#navCollapseToggle');await page.waitForTimeout(400);
 rec('開き直すと元の幅へ戻る',(await width())===open,`${await width()}px (元 ${open}px)`);
 const back=await page.evaluate(()=>[...document.querySelectorAll('aside .nav-item span')].filter(x=>x.offsetParent).length);
 rec('開くとラベルが戻る',back>=5,back+'個');

 // ---------- 作業可否: 予定ロットが全部判定される ----------
 await setMode('schedule');
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:15000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 await page.waitForSelector('.sc-row-line',{timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('.sc-row-workable')]
   .some(n=>n.classList.contains('is-ok')||n.classList.contains('is-ng')),{timeout:40000});
 await page.waitForTimeout(3500);
 const wk=await page.evaluate(()=>{
  const c={};document.querySelectorAll('.sc-row-line .sc-row-workable').forEach(n=>{
   const k=[...n.classList].find(x=>x.startsWith('is-'));c[k]=(c[k]||0)+1});
  return {counts:c,state:window.scheduleWorkableState()};
 });
 rec('予定に「?」(判定できない)が残らない',
   !wk.counts['is-unknown'],JSON.stringify(wk.counts));
 rec('前提: 仕掛に無いロットの予定を用意できた',orphan.ok,`${orphan.lotNo} / ${orphan.detail}`);
 rec('仕掛の500件上限を越えて索引を作れている',
   wk.state.scanned>500&&wk.state.pages>1,
   `${wk.state.pages}ページ / ${wk.state.scanned}件走査 / 全${wk.state.total}件`);
 rec('索引が仕掛の全件をカバーしている',
   wk.state.indexSize>=wk.state.total,`索引${wk.state.indexSize}件 / 仕掛${wk.state.total}件`);

 await b.close();b=null;
 // 自分で足した予定は必ず消す(残すと後続テストの「不可」の件数や行位置が変わる)。
 await orphan.remove();
 // このテストは途中でscheduleモードへ切り替えるので、後続テスト(編集モード前提)の
 // ために必ずeditへ戻してから終わる。
 await setMode('edit');
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 if(orphan)await orphan.remove().catch(()=>{});
 await setMode('edit').catch(()=>{});
 process.exit(2);
});
