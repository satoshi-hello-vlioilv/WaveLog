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
 await set('xs'); const xs=await read();
 await set('xl'); const xl=await read();
 console.log('md',JSON.stringify(md));console.log('xs',JSON.stringify(xs));console.log('xl',JSON.stringify(xl));

 const keys=['month','dayNum','weekday','legend','cardLabel','cardValue'];
 rec('カレンダーの全文字サイズがxs<md<xlで変わる',
  keys.every(k=>xs[k]<md[k]&&md[k]<xl[k]),keys.map(k=>`${k}:${xs[k]}/${md[k]}/${xl[k]}`).join(' '));
 // 比率がスケール(.84 / 1 / 1.22)どおりか
 const ratioOk=keys.every(k=>Math.abs(xl[k]/md[k]-1.22)<0.02&&Math.abs(xs[k]/md[k]-0.84)<0.02);
 rec('拡大率が--ui-scale(.84/1/1.22)と一致する',ratioOk,keys.map(k=>k+':'+(xl[k]/md[k]).toFixed(3)).join(' '));
 rec('日セル・ボタン・凡例の寸法も一緒に伸びる',
  xl.cell>md.cell&&xl.navBtn>md.navBtn&&xl.swatch>md.swatch&&xs.cell<md.cell,
  `cell ${xs.cell}/${md.cell}/${xl.cell} btn ${xs.navBtn}/${md.navBtn}/${xl.navBtn} swatch ${xs.swatch}/${md.swatch}/${xl.swatch}`);
 rec('右の明細ペイン幅も追随する',xl.detailW>md.detailW&&xs.detailW<md.detailW,
  `${xs.detailW}/${md.detailW}/${xl.detailW}`);
 rec('横スクロールバーが出ない(xl)',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));

 await set('xs'); await page.screenshot({path:'cal_xs.png'});
 await set('xl'); await page.screenshot({path:'cal_xl.png'});
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
