const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await setMode('edit');
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.waitForTimeout(1200);
 // 端末内データの読み出し(reliableAll)を人工的に遅くする
 await page.evaluate(()=>{const o=window.reliableAll||reliableAll;
  window.reliableAll=reliableAll=async function(){await new Promise(r=>setTimeout(r,900));return o.apply(this,arguments)}});
 const watch=()=>page.evaluate(()=>{
  window.__seen={shown:false,title:'',progress:''};
  const ov=document.querySelector('#saveOverlay');
  new MutationObserver(()=>{if(!ov.hidden){window.__seen.shown=true;
   window.__seen.title=document.querySelector('#saveOverlayTitle').textContent;
   window.__seen.progress=document.querySelector('#waitingProgress').textContent}})
   .observe(ov,{attributes:true,attributeFilter:['hidden']});});
 const seen=()=>page.evaluate(()=>window.__seen);
 const closed=()=>page.evaluate(()=>document.querySelector('#saveOverlay').hidden);

 await watch(); await page.click('#openCalendar'); await page.waitForTimeout(3000);
 let s=await seen();
 rec('実績カレンダー: 遅い読み込みでWAITINGが出る',s.shown&&/実績カレンダー/.test(s.title),JSON.stringify(s));
 rec('実績カレンダー: 読み込み後に閉じている',await closed());
 rec('カレンダーが実際に描画されている',await page.evaluate(()=>!!document.querySelector('.cal-grid')));

 await watch(); await page.click('#openDashboard'); await page.waitForTimeout(3200);
 s=await seen();
 // §9.64でダッシュボードの既定表示が「稼働状況」になり、待機表示の見出しも
 // その処理のものに変わった。どちらの見出しでも「出ている」ことを確認する。
 rec('分析ダッシュボード: 遅い読み込みでWAITINGが出る',
   s.shown&&/分析データ|稼働状況/.test(s.title),JSON.stringify(s));
 rec('分析ダッシュボード: 読み込み後に閉じている',await closed());

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
