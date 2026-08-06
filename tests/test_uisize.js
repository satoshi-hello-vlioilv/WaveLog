const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 rec('表示サイズボタンがヘッダーにある',true);
 rec('作業スケジュール専用の高密度トグルは廃止',(await page.$$('#scDenseToggle')).length===0);

 const measure=async()=>page.evaluate(()=>{
  const cs=getComputedStyle;
  return {
   size:document.documentElement.dataset.uiSize,
   body:cs(document.body).fontSize,
   nav:Math.round(document.querySelector('#openSchedule').getBoundingClientRect().height),
   badge:cs(document.querySelector('#accessModeBadge')).fontSize,
   scale:cs(document.documentElement).getPropertyValue('--ui-scale').trim(),
  };
 });
 const md=await measure();
 rec('既定は中(md)',md.size==='md',JSON.stringify(md));

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 const opts=await page.$$eval('#uiSizeMenu [data-ui-size-option]',bs=>bs.map(x=>x.dataset.uiSizeOption));
 rec('5段階の選択肢が出る',opts.length===5&&opts.join(',')==='xs,sm,md,lg,xl',opts.join(','));

 await page.click('#uiSizeMenu [data-ui-size-option="xl"]');
 await page.waitForTimeout(300);
 const xl=await measure();
 rec('特大にするとアプリ全体(本文・ナビ・バッジ)が同時に大きくなる',
   parseFloat(xl.body)>parseFloat(md.body)&&xl.nav>md.nav&&parseFloat(xl.badge)>parseFloat(md.badge),
   JSON.stringify(xl));

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="xs"]');
 await page.waitForTimeout(300);
 const xs=await measure();
 rec('極小にすると全体が小さくなる',
   parseFloat(xs.body)<parseFloat(md.body)&&xs.nav<md.nav,JSON.stringify(xs));

 // 永続化
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:10000});
 const after=await measure();
 rec('再読込後も選択した表示サイズが保持される',after.size==='xs',JSON.stringify(after));

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
