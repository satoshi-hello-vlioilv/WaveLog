/* tests/visual/capture.js — 画面キャプチャ(見た目の基準づくり)
   ------------------------------------------------------------
   「見た目を変えないリファクタリング」の前後で同じ画面を撮り、
   tests/visual/pngdiff.py で1画素ずつ突き合わせるための土台。

   撮り比べが成立するには、撮るたびに変わるものを潰しておく必要がある。
     ・時計       … Date を固定(タイムラインの「現在」線・更新日時・経過分)
     ・アニメ     … transition/animation を無効化し、キャレットも消す
     ・データ     … 実行前に tests/make_fixture.py で種データへ戻す(呼び出し側)
   これでも残る揺れ(スクロール位置など)は、各シーンで明示的に固定する。

   使い方(パス設定の退避・復元は run_all.sh と同じ仕掛けが要る):
     tests/visual/run.sh <出力ディレクトリ>
*/
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const OUT=process.argv[2];
if(!OUT){console.error('使い方: node capture.js <出力ディレクトリ>');process.exit(2)}
const fs=require('fs');
fs.mkdirSync(OUT,{recursive:true});

/* 固定する時刻。フィクスチャの作業予定が見える時間帯を選ぶ。 */
const FROZEN='2026-08-06T09:30:00+09:00';

/* 撮るたびに変わる描画を止める。キャレットの点滅とスクロールバーも消す。 */
const FREEZE_CSS=`
*,*::before,*::after{
  transition:none !important; animation:none !important;
  caret-color:transparent !important;
}
html{scrollbar-width:none}
::-webkit-scrollbar{width:0;height:0}
`;

const freezeClock=ts=>`(()=>{
  const FIXED=new Date(${JSON.stringify(ts)}).getTime();
  const RealDate=Date;
  class FrozenDate extends RealDate{
    constructor(...a){ if(a.length===0) super(FIXED); else super(...a); }
    static now(){ return FIXED }
  }
  FrozenDate.parse=RealDate.parse; FrozenDate.UTC=RealDate.UTC;
  window.Date=FrozenDate;
})()`;

let b=null;
const shots=[];
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--force-color-profile=srgb','--font-render-hinting=none']});
 const ctx=await b.newContext({viewport:{width:1700,height:1000},deviceScaleFactor:1,
                               timezoneId:'Asia/Tokyo',locale:'ja-JP',reducedMotion:'reduce'});
 await ctx.addInitScript(freezeClock(FROZEN));
 const page=await ctx.newPage();
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());

 const settle=async(ms=900)=>{
  await page.waitForTimeout(ms);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 /* 画面に出ている**数字を全部 0 に置き換えてから**撮る。
    ------------------------------------------------------------
    ブラウザの Date は固定できるが、経過分・残り時間などは**サーバーが
    計算して返す**ため撮るたびに進む(実測: 45枚中22枚がこれで数画素ずれた。
    タイムラインの「187分経過」やダッシュボードの見込み分など)。
    サーバーの時計まで凍らせるには本番コードに検証用の分岐が要るので、
    代わりに表示側を均す。

    ・base と head に**同じ変換**をかけるので、残った差は必ずCSS起因。
    ・桁数は変えないため、折り返し・列幅・文字の位置はそのまま検証できる。
    ・値そのものの正しさは回帰テスト(tests/run_all.sh)の担当で、
      ここは見た目だけを見る。 */
 const NUMS=`(()=>{
  const walk=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  const hit=[];let n;
  while((n=walk.nextNode())) if(/[0-9]/.test(n.nodeValue)) hit.push(n);
  hit.forEach(n=>{n.nodeValue=n.nodeValue.replace(/[0-9]/g,'0')});
  document.querySelectorAll('input,textarea').forEach(el=>{
   if(typeof el.value==='string'&&/[0-9]/.test(el.value)) el.value=el.value.replace(/[0-9]/g,'0');
  });
 })()`;
 const shot=async(name)=>{
  await settle(500);
  await page.evaluate(NUMS).catch(()=>{});
  await page.waitForTimeout(120);
  await page.screenshot({path:`${OUT}/${name}.png`,animations:'disabled'});
  shots.push(name);
  console.log('  撮影:',name);
 };
 const click=async(sel,wait=1800)=>{
  try{await page.click(sel,{timeout:6000});await settle(wait);return true}
  catch(e){console.log('  (押せず)',sel);return false}
 };

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.addStyleTag({content:FREEZE_CSS});
  await page.evaluate(()=>{
   localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
   localStorage.setItem('LotDspLastTabV1','1');
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.addStyleTag({content:FREEZE_CSS});
  await settle(2500);

  await shot('00-起動直後');

  // ---- 一覧系 ----
  await click('[data-db-key="SIKALOTNOW"]',2600); await shot('10-仕掛一覧');
  // フィルタバー(よく使う条件)を開いた状態
  if(await click('#genericFilterBar .filter-toggle,#genericFilterBar summary',900))
   await shot('11-仕掛一覧-フィルタ展開');
  await click('[data-db-key="SIKALOTDEF"]',2600); await shot('12-品質データ');

  // ---- 作業スケジュール ----
  await click('#openSchedule',3200); await shot('20-作業スケジュール');
  await click('#scModeBoard',2000); await shot('21-スケジュール-全体ボード');
  await click('#scModeSingle',2000);
  await click('#scListModalBtn',1600); await shot('22-スケジュール-仕掛ポップアップ');
  await page.keyboard.press('Escape').catch(()=>{}); await settle(700);
  await click('#scStopModalBtn',1600); await shot('23-スケジュール-設備停止ポップアップ');
  await page.keyboard.press('Escape').catch(()=>{}); await settle(700);

  // ---- ダッシュボード ----
  await click('#openDashboard',3200); await shot('30-ダッシュボード-稼働状況');
  await click('[data-dbview="equipment"]',2400); await shot('31-ダッシュボード-自設備');
  await click('[data-dbview="pivot"]',2400); await shot('32-ダッシュボード-自由集計');

  // ---- 実績カレンダー ----
  await click('#openCalendar',2600); await shot('40-実績カレンダー');

  // ---- マスタ管理(タブごと) ----
  await click('#openMasterMaint',3200); await shot('50-マスタ管理');
  const tabs=await page.$$eval('#masterMaintNav [data-master]',es=>es.map(e=>e.dataset.master));
  let i=0;
  for(const t of tabs){
   i++;
   if(await click(`#masterMaintNav [data-master="${t}"]`,1400))
    await shot(`51-マスタ-${String(i).padStart(2,'0')}-${t}`);
  }

  // ---- データ一覧 ----
  await click('#homeDrafts',2600); await shot('60-データ一覧');

  // ---- 測定画面 ----
  await click('[data-db-key="SIKALOTNOW"]',2600);
  const opened=await page.click('#grid table tbody tr:first-child .measurement-action-button',{timeout:6000})
    .then(()=>page.waitForSelector('#measureModal:not([hidden])',{timeout:20000}).then(()=>true))
    .catch(()=>false);
  if(opened){
   await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
   await settle(3000);
   await shot('70-測定画面-基本情報');
   // 3段（①準備→②測定→③確認。§9.123）。旧の左ペインの札（data-infotab／
   // data-lefttab）は無くなった——押せない選択子を残すと「撮れなかった」が
   // 「変わっていない」と読まれる（§9.349）。
   for(const [sel,name] of [['#measureSteps [data-mstep="2"]','71-測定画面-②測定'],
                            ['#measureSteps [data-mstep="3"]','72-測定画面-③確認']]){
    if(await click(sel,1400)) await shot(name);
   }
   await click('#measureSteps [data-mstep="1"]',1200);
   // 作業の札: 測定 / 母材・揃い / フラットネス
   for(const [key,name] of [['material','73-測定画面-母材揃い'],['flat','73b-測定画面-フラットネス']]){
    if(await click(`[data-worktab="${key}"]`,1400)) await shot(name);
   }
   await click('[data-worktab="measure"]',1200);
   // 入力内容(右ペインの描画がここで切り替わる)
   for(const [val,name] of [['板厚','74-測定画面-板厚'],['板幅','74b-測定画面-板幅'],
                            ['バリ','75-測定画面-バリ']]){
    const ok=await page.selectOption('#measureType',val).then(()=>true).catch(()=>false);
    if(ok){await settle(1600);await shot(name)}else{console.log('  (選べず) 入力内容',val)}
   }
   // 条の設計はカード（#splitCard。モーダルの #openSplit は廃止）・異常位置判定・帳票
   if(await page.$('#splitCard')){
    await page.evaluate(()=>document.querySelector('#splitCard').scrollIntoView({block:'start'}));
    await settle(600); await shot('76-測定画面-条の設計');
   }
   if(await click('#openDefect',1800)) await shot('77-異常位置判定');
   await page.keyboard.press('Escape').catch(()=>{}); await settle(700);
   if(await click('#openReport',2800)) await shot('78-帳票');
   await page.keyboard.press('Escape').catch(()=>{}); await settle(900);
   await page.evaluate(()=>{window.exitReportView&&window.exitReportView()}).catch(()=>{});
   await settle(800);
   // 後片付け(このロットを消す)
   await page.evaluate(async()=>{
    if(typeof S!=='undefined'&&S.measure&&typeof reliableDelete==='function')
     await reliableDelete(S.measure.id);
   }).catch(()=>{});
   await page.evaluate(()=>{document.querySelector('#measureModal')?.setAttribute('hidden','')}).catch(()=>{});
   await settle(800);
  }else{
   console.log('  (測定画面を開けなかった)');
  }

  // ---- 表示サイズ・メニュー畳み込み ----
  await click('[data-db-key="SIKALOTNOW"]',2400);
  for(const size of ['sm','lg']){
   await page.evaluate(v=>{document.documentElement.dataset.uiSize=v},size);
   await settle(900); await shot(`80-仕掛一覧-表示サイズ-${size}`);
  }
  await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
  await settle(700);
  await click('#openSchedule',2600);
  for(const size of ['sm','lg']){
   await page.evaluate(v=>{document.documentElement.dataset.uiSize=v},size);
   await settle(900); await shot(`81-スケジュール-表示サイズ-${size}`);
  }
  await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
  await settle(700);
  if(await click('#navCollapseToggle',1200)) await shot('82-メニュー畳み込み');

  // ---- 狭い画面幅 ----
  await page.setViewportSize({width:1280,height:900}); await settle(1200);
  await shot('90-幅1280-スケジュール');
  await click('[data-db-key="SIKALOTNOW"]',2400); await shot('91-幅1280-仕掛一覧');

  console.log(`\n合計 ${shots.length} 枚を ${OUT} へ保存`);
  await ctx.close(); await b.close();
 }catch(e){
  console.error('FATAL',e);
  await b.close().catch(()=>{});
  process.exit(2);
 }
})();
