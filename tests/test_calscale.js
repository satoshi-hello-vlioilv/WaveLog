const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openCalendar'); await page.waitForTimeout(2500);

 const read=async()=>page.evaluate(()=>{
  const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
  const h=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):null};
  return {month:g('.cal-month-label'),dayNum:g('.cal-day-num'),weekday:g('.cal-weekday-row span'),
   legend:g('.cal-legend'),cardLabel:g('.db-card-label'),cardValue:g('.db-card-value'),
   navBtn:h('.cal-nav .rp-btn-secondary'),cell:h('.cal-day'),swatch:h('.cal-legend-swatch'),
   detailW:Math.round((document.querySelector('.cal-detail')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)};
 });
 const set=async v=>{await page.evaluate(x=>document.documentElement.setAttribute('data-ui-size',x),v);await page.waitForTimeout(350)};

 await set('md'); const md=await read();
 await set('sm'); const sm=await read();
 await set('lg'); const lg=await read();
 console.log('md',JSON.stringify(md));console.log('sm',JSON.stringify(sm));console.log('lg',JSON.stringify(lg));

 const keys=['month','dayNum','weekday','legend','cardLabel','cardValue'];
 rec('カレンダーの全文字サイズが小<中<大で変わる',
  keys.every(k=>sm[k]<md[k]&&md[k]<lg[k]),keys.map(k=>`${k}:${sm[k]}/${md[k]}/${lg[k]}`).join(' '));
 // 比率がスケール(.92 / 1 / 1.1)どおりか
 const ratioOk=keys.every(k=>Math.abs(lg[k]/md[k]-1.1)<0.02&&Math.abs(sm[k]/md[k]-0.92)<0.02);
 rec('拡大率が--ui-scale(.92/1/1.1)と一致する',ratioOk,keys.map(k=>k+':'+(lg[k]/md[k]).toFixed(3)).join(' '));
 rec('日セル・ボタン・凡例の寸法も一緒に伸びる',
  lg.cell>md.cell&&lg.navBtn>md.navBtn&&lg.swatch>md.swatch&&sm.cell<md.cell,
  `cell ${sm.cell}/${md.cell}/${lg.cell} btn ${sm.navBtn}/${md.navBtn}/${lg.navBtn} swatch ${sm.swatch}/${md.swatch}/${lg.swatch}`);
 rec('右の明細ペイン幅も追随する',lg.detailW>md.detailW&&sm.detailW<md.detailW,
  `${sm.detailW}/${md.detailW}/${lg.detailW}`);
 rec('横スクロールバーが出ない(大)',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));

 await set('sm'); await page.screenshot({path:'cal_sm.png'});
 await set('lg'); await page.screenshot({path:'cal_lg.png'});
 await set('md');

 console.log('\n=== SUMMARY ===');
 const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
