const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('dialog',d=>d.accept());
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 // 分割レイアウトは予定の描画より後に組み立てられる。固定待ちだと予定件数が
 // 増えたときに間に合わず、測定対象がnullのまま落ちる。出来上がりを待つ。
 await page.waitForFunction(()=>!!document.querySelector('.sc-split-wrap #listToolbar')
   &&!!document.querySelector('.sc-split-wrap #grid table'),null,{timeout:40000}).catch(()=>{});
 await page.waitForTimeout(600);
 const s=await page.evaluate(()=>{
  const wrap=document.querySelector('.sc-split-wrap');if(!wrap)return null;
  const q=sel=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();
    return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)}};
  const grid=document.querySelector('#grid');
  return {wrap:q('.sc-split-wrap'),filter:q('#genericFilterBar'),toolbar:q('#listToolbar'),
          grid:q('#grid'),panel:q('.sc-panel'),
          gridOverflowX:getComputedStyle(grid).overflowX,
          gridScrolls:grid.scrollWidth>grid.clientWidth,
          gridInsideWrap:!!document.querySelector('.sc-split-wrap #grid'),
          toolbarInsideWrap:!!document.querySelector('.sc-split-wrap #listToolbar')};
 });
 rec('分割表示が組み上がる',!!s&&s.gridInsideWrap,JSON.stringify({wrap:s&&s.wrap}));
 rec('ツールバーが分割レイアウト内に配置される',!!s&&s.toolbarInsideWrap);
 rec('ツールバーは一覧の上、パネルとは横並び(重なっていない)',
   !!s&&s.toolbar.y<s.grid.y&&s.toolbar.x<s.panel.x,JSON.stringify({toolbar:s&&s.toolbar,grid:s&&s.grid,panel:s&&s.panel}));
 rec('一覧とスケジュールパネルが左右に並ぶ',!!s&&s.grid.x<s.panel.x&&s.grid.y>=s.wrap.y,JSON.stringify({grid:s&&s.grid,panel:s&&s.panel}));
 rec('一覧が枠内に収まる(はみ出さない)',!!s&&(s.grid.y+s.grid.h)<=(s.wrap.y+s.wrap.h+2),`grid bottom=${s&&(s.grid.y+s.grid.h)}, wrap bottom=${s&&(s.wrap.y+s.wrap.h)}`);
 rec('分割表示でも横スクロールバーが常時表示',!!s&&s.gridOverflowX==='scroll',s&&s.gridOverflowX);
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
