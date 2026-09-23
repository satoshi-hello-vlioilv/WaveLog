'use strict';
const {run}=require('./lib/harness.js');
run('test_split_layout', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:15000});
 await page.click('#openSchedule');
 await page.waitForSelector('.sc-board-row',{timeout:10000});
 await page.evaluate(()=>{const r=[...document.querySelectorAll('.sc-board-row')].find(x=>x.dataset.equipment==='テスト設備A');if(r)r.click()});
 // 分割レイアウトは予定の描画より後に組み立てられる。固定待ちだと予定件数が
 // 増えたときに間に合わず、測定対象がnullのまま落ちる。出来上がりを待つ。
 await W.until(page,()=>!!document.querySelector('.sc-split-wrap #listToolbar')
   &&!!document.querySelector('.sc-split-wrap #grid table'),null,{ms:40000,what:'分割レイアウトが組み上がる'});
 await idle();
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
}, {viewport:{width:1600,height:950}});
