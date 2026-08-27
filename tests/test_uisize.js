/* test_uisize.js: 表示サイズ（--ui-scale の3段）

   ============================================================
   `test_calscale.js` をここへ取り込んだ（§9.249 ④、利用者の指示
   「重複しているテストは統合できるか確認し必要に応じて統合して最適化」）
   ------------------------------------------------------------
   あちらは「実績カレンダーの文字と寸法が小<中<大で変わり、比率が
   `--ui-scale`(.92/1/1.1)どおりか」を見る56行で、そのためだけに
   ブラウザをもう1回立ち上げていた。**見ている軸は同じ**（表示サイズ）
   なので、段の選び方を確かめたこの流れの続きで測る。
   あちらが吐いていた `cal_sm.png` / `cal_lg.png`（誰も読まない置き土産）も
   ここでは撮らない。

   ここで固定すること
   ------------------------------------------------------------
    1. 段は3つ（sm/md/lg）で、既定は中
    2. 段を変えるとアプリ全体（本文・ナビ・バッジ）が同時に変わる
    3. 再読込しても選んだ段が残る
    4. 廃止した段（xs/xl）の保存値は近い段へ寄せる（§9.132）
    5. **実績カレンダー**も文字・マス・ボタン・明細幅が段どおりに伸び縮みし、
       大でも横スクロールが出ない
   ============================================================ */
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
 rec('3段階の選択肢が出る',opts.length===3&&opts.join(',')==='sm,md,lg',opts.join(','));

 await page.click('#uiSizeMenu [data-ui-size-option="lg"]');
 await page.waitForTimeout(300);
 const lg=await measure();
 rec('大にするとアプリ全体(本文・ナビ・バッジ)が同時に大きくなる',
   parseFloat(lg.body)>parseFloat(md.body)&&lg.nav>md.nav&&parseFloat(lg.badge)>parseFloat(md.badge),
   JSON.stringify(lg));

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="sm"]');
 await page.waitForTimeout(300);
 const sm=await measure();
 rec('小にすると全体が小さくなる',
   parseFloat(sm.body)<parseFloat(md.body)&&sm.nav<md.nav,JSON.stringify(sm));

 // 永続化
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:10000});
 const after=await measure();
 rec('再読込後も選択した表示サイズが保持される',after.size==='sm',JSON.stringify(after));

 /* 廃止した段(極小xs・特大xl)を保存している端末の行き先(§9.132)。
    無効として既定(中)へ落とすと、**わざわざ選んでいた人ほど設定が黙って
    戻る**ので、残った段のいちばん近いものへ寄せる。ここは実機に既に
    保存されている値の話なので、消したから終わりにはできない。 */
 for(const [old,want] of [['xl','lg'],['xs','sm']]){
  await page.evaluate(v=>localStorage.setItem('MeasurementUiSizeV1',v),old);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#uiSizeBadge',{timeout:10000});
  const m=await measure();
  rec(`廃止した段(${old})の保存値は近い段(${want})へ寄せる`,m.size===want,JSON.stringify(m));
 }

 /* ---------- 実績カレンダー（旧 test_calscale.js） ----------
    段は`data-ui-size`を直に書き換えて確かめる（上でメニューの経路は
    確かめ済みなので、ここは**測ること**に集中する）。 */
 await page.evaluate(()=>localStorage.setItem('MeasurementUiSizeV1','md'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await page.waitForTimeout(1200);
 await page.click('#openCalendar');await page.waitForTimeout(2500);
 const read=async()=>page.evaluate(()=>{
  const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
  const h=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):null};
  return {month:g('.cal-month-label'),dayNum:g('.cal-day-num'),weekday:g('.cal-weekday-row span'),
   legend:g('.cal-legend'),cardLabel:g('.db-card-label'),cardValue:g('.db-card-value'),
   navBtn:h('.cal-nav .rp-btn-secondary'),cell:h('.cal-day'),swatch:h('.cal-legend-swatch'),
   detailW:Math.round((document.querySelector('.cal-detail')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)};
 });
 const set=async v=>{await page.evaluate(x=>document.documentElement.setAttribute('data-ui-size',x),v);await page.waitForTimeout(350)};
 await set('md');const cmd=await read();
 await set('sm');const csm=await read();
 await set('lg');const clg=await read();
 const keys=['month','dayNum','weekday','legend','cardLabel','cardValue'];
 rec('カレンダーの全文字サイズが小<中<大で変わる',
  keys.every(k=>csm[k]<cmd[k]&&cmd[k]<clg[k]),keys.map(k=>`${k}:${csm[k]}/${cmd[k]}/${clg[k]}`).join(' '));
 // 比率がスケール(.92 / 1 / 1.1)どおりか
 const ratioOk=keys.every(k=>Math.abs(clg[k]/cmd[k]-1.1)<0.02&&Math.abs(csm[k]/cmd[k]-0.92)<0.02);
 rec('拡大率が--ui-scale(.92/1/1.1)と一致する',ratioOk,keys.map(k=>k+':'+(clg[k]/cmd[k]).toFixed(3)).join(' '));
 rec('日セル・ボタン・凡例の寸法も一緒に伸びる',
  clg.cell>cmd.cell&&clg.navBtn>cmd.navBtn&&clg.swatch>cmd.swatch&&csm.cell<cmd.cell,
  `cell ${csm.cell}/${cmd.cell}/${clg.cell} btn ${csm.navBtn}/${cmd.navBtn}/${clg.navBtn} swatch ${csm.swatch}/${cmd.swatch}/${clg.swatch}`);
 rec('右の明細ペイン幅も追随する',clg.detailW>cmd.detailW&&csm.detailW<cmd.detailW,
  `${csm.detailW}/${cmd.detailW}/${clg.detailW}`);
 rec('横スクロールバーが出ない(大)',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
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
