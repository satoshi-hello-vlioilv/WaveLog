/* ヘッダー再設計(§9.48)の検証: 3グループ構成・高さ/角丸の統一・ui-scale追随 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 await page.waitForTimeout(1200);

 /* 1. 役割ごとの3グループが揃っている */
 const groups=await page.evaluate(()=>['.hd-context','.hd-status','.hd-actions']
   .map(s=>!!document.querySelector('header '+s)));
 rec('ヘッダーが「状況/状態/操作」の3グループに分かれている',groups.every(Boolean),JSON.stringify(groups));

 /* 2. 表示されているコントロールの高さ・角丸が完全に一致する */
 const metrics=async()=>page.evaluate(()=>{
  const sel='header .hd-chip,header .hd-btn,header .hd-search,header .hd-field,header #printCurrentView';
  return [...document.querySelectorAll(sel)].filter(e=>e.offsetParent).map(e=>{
   const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
   return {id:e.id||e.className.split(' ')[1]||e.className,
           h:Math.round(r.height),y:Math.round(r.top),
           radius:cs.borderTopLeftRadius};
  });
 });
 const m=await metrics();
 const hs=[...new Set(m.map(x=>x.h))],ys=[...new Set(m.map(x=>x.y))],rs=[...new Set(m.map(x=>x.radius))];
 rec('ヘッダーの全コントロールが同じ高さ',hs.length===1,'高さ='+hs.join('/')+' 対象'+m.length+'件');
 rec('ヘッダーの全コントロールが同じ天端(縦位置が揃う)',ys.length===1,'top='+ys.join('/'));
 rec('ヘッダーの全コントロールが同じ角丸',rs.length===1,'radius='+rs.join('/'));

 /* 3. バッジは「見出し+値」の2段で、何の情報かが読める */
 const chips=await page.evaluate(()=>[...document.querySelectorAll('header .hd-chip')]
   .filter(e=>e.offsetParent)
   .map(e=>({k:e.querySelector('.hd-chip-key')?.textContent,v:e.querySelector('.hd-chip-val')?.textContent})));
 rec('バッジが「項目名＋値」の形で内容を明示している',
   chips.length>0&&chips.every(c=>c.k&&c.v),JSON.stringify(chips));

 /* 4. 使用設備チップから設備設定が開ける(旧 .equipment-header-button の役割を継承) */
 await page.click('.hd-chip-equip');
 await page.waitForTimeout(400);
 const opened=await page.evaluate(()=>!document.querySelector('#appSettingsModal').hidden);
 rec('使用設備チップから設備設定が開く',opened);
 if(opened){await page.click('#cancelAppSettings');await page.waitForTimeout(300)}

 /* 5. 表示サイズを変えるとヘッダーも一括で追随する(統一が崩れない) */
 const md=await metrics();
 await page.click('#uiSizeBadge');await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="lg"]');await page.waitForTimeout(400);
 const lg=await metrics();
 const lgHs=[...new Set(lg.map(x=>x.h))];
 rec('大でもヘッダーの高さが揃ったまま拡大する',
   lgHs.length===1&&lgHs[0]>md[0].h,'md='+md[0].h+' lg='+lgHs.join('/'));
 await page.click('#uiSizeBadge');await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="md"]');await page.waitForTimeout(400);

 /* 6. 横幅が狭くても操作群が折り返して縦に伸びない
    (画面ごとの操作列#headerViewBarは「ヘッダーの2行目」として意図的に
     別の行に置く。ここで見るのは1行目の並び——画面名・状態チップ・全体操作が
     狭い幅で折り返して段が増えないこと。) */
 await page.setViewportSize({width:1100,height:900});
 await page.waitForTimeout(400);
 const narrow=await page.evaluate(()=>{
  const h=document.querySelector('header').getBoundingClientRect();
  const list=[...document.querySelectorAll('header .hd-chip,header .hd-btn,header .hd-search,header .hd-field')]
    .filter(e=>e.offsetParent&&!e.closest('#headerViewBar')).map(e=>Math.round(e.getBoundingClientRect().top));
  const bar=document.getElementById('headerViewBar');
  const barShown=!!(bar&&bar.offsetParent);
  return {height:Math.round(h.height),rows:[...new Set(list)].length,barShown};
 });
 rec('幅1100pxでもヘッダーの1行目が1行に収まる',
   narrow.rows===1&&narrow.height<(narrow.barShown?130:80),JSON.stringify(narrow));

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
