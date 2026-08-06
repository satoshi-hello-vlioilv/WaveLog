/* 後から足されるナビ項目(カレンダー/ダッシュボード/DB一覧)にも、
   畳んだときツールチップが付くかを確認する(§9.58 MutationObserver) */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));

 // 畳んだ状態で読み込み直す = 動的ナビは「畳み済み」の後から生える
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.evaluate(()=>localStorage.setItem('navCollapsedV1','1'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.waitForTimeout(2500);

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

 // 開き直すと元のtitle(空)へ戻る
 await page.click('#navCollapseToggle');await page.waitForTimeout(400);
 const back=await page.evaluate(()=>[...document.querySelectorAll('aside .nav-item')]
   .filter(e=>e.title!==(e.dataset.navTitle??'')).map(e=>e.id+':'+e.title));
 rec('開くとツールチップは元の値へ戻る(元が空なら空)',back.length===0,JSON.stringify(back));

 await b.close();
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
