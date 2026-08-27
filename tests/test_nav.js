/* test_nav.js: メインメニューの畳み込み（§9.58）

   ============================================================
   `test_navdyn.js` をここへ取り込んだ（§9.249 ④、利用者の指示
   「重複しているテストは統合できるか確認し必要に応じて統合して最適化」）
   ------------------------------------------------------------
   あちらは「**後から足されるナビ項目**（カレンダー／ダッシュボード／DB一覧）
   にも畳んだときのツールチップが付くか」だけを見る54行で、そのために
   ブラウザをもう1回立ち上げて同じ起動を待っていた。見ているのは同じ
   MutationObserver の仕掛けなので1本にまとめる。

   **作業可否の索引（§9.57）の検証はここから外した。** まったく同じ前提
   （仕掛に無いロットの予定を1件作る）と同じ確認が `test_audit.js` にもあり、
   **2本が同じ索引を2回作っていた**。索引は性能の話なので `test_audit.js`
   （問い合わせ回数を数える側）へ寄せ、ここはメニューだけを見る。
   おかげでこのテストは**モードを切り替えなくなった**——`test_nav` が
   scheduleモードのまま終わって後続が落ちる事故（tests/README.md）の
   種そのものが消える。

   ここで固定すること
   ------------------------------------------------------------
    1. 畳むと細い帯になり、行き先(アイコン)は全部見えたままラベルだけ隠れる
    2. ラベルの代わりにツールチップで行き先が分かる
    3. 畳んだままでも画面を切り替えられ、再読込しても畳んだまま
    4. 開き直すと元の幅とラベルへ戻る
    5. **後から足されるナビ項目**にもツールチップが付き、開くと元へ戻る
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());

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

 /* ---------- 後から足されるナビ項目（旧 test_navdyn.js・§9.58 MutationObserver） ----------
    いまは**畳んだ状態で読み込み直した直後**なので、カレンダー・
    ダッシュボードは「畳み済みの後から生えた」項目そのもの。 */
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.waitForTimeout(1500);
 const st=await page.evaluate(()=>{
  const t=id=>{const e=document.getElementById(id);return e?{title:e.title,
    label:(e.querySelector('span')||{}).textContent.trim()||'',orig:e.dataset.navTitle}:null};
  const all=[...document.querySelectorAll('aside .nav-item')];
  return {collapsed:document.body.classList.contains('nav-collapsed'),
   cal:t('openCalendar'),dash:t('openDashboard'),
   missing:all.filter(e=>!e.title).map(e=>e.id||e.className)};
 });
 rec('畳んだ状態で復元されている',st.collapsed);
 // 元の説明文を持つ項目は「ラベル：説明」、持たない項目はラベルのみ
 const tipOk=x=>!!x&&x.title===(x.label?(x.orig?x.label+'：'+x.orig:x.label):x.orig)&&!!x.title
              &&x.title.startsWith(x.label);
 rec('後から足されるカレンダーにツールチップが付く',tipOk(st.cal),JSON.stringify(st.cal));
 rec('後から足されるダッシュボードにツールチップが付く',tipOk(st.dash),JSON.stringify(st.dash));
 rec('元の説明文は畳んでも失われない',!!st.cal&&st.cal.title.includes(st.cal.orig),st.cal.title);
 rec('ツールチップの無いナビ項目が無い',st.missing.length===0,JSON.stringify(st.missing));

 // 開き直すと元の幅・ラベル・title へ戻る
 await page.click('#navCollapseToggle');await page.waitForTimeout(400);
 rec('開き直すと元の幅へ戻る',(await width())===open,`${await width()}px (元 ${open}px)`);
 const back=await page.evaluate(()=>[...document.querySelectorAll('aside .nav-item span')].filter(x=>x.offsetParent).length);
 rec('開くとラベルが戻る',back>=5,back+'個');
 const tips=await page.evaluate(()=>[...document.querySelectorAll('aside .nav-item')]
   .filter(e=>e.title!==(e.dataset.navTitle??'')).map(e=>e.id+':'+e.title));
 rec('開くとツールチップは元の値へ戻る(元が空なら空)',tips.length===0,JSON.stringify(tips));

 await b.close();b=null;
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
