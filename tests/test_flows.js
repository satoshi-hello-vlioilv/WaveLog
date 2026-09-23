/* test_flows.js: 測定・スケジュール・メンテナンスの各導線を巡回し、
   「実行エラー」と「レイアウト崩れ」を機械的に検出する。
   ------------------------------------------------------------
   個別機能のテストは他ファイルが持つ。ここが見るのは画面をまたいだときの
   壊れ方で、リファクタリング(画面切替の一本化・ファイル分割・接続のSQLite統一)
   で壊れるとすればこの層。各画面について:

     - JS実行時エラー(pageerror)とconsole.error
     - 失敗したリクエスト(4xx/5xx)
     - 横スクロールの発生(画面が横にはみ出していないか)
     - hidden属性が付いているのに見えている要素(§9.73と同じ事故)
     - トップレベルのパネルが2つ以上同時に見えている(画面の重なり)
     - スクロールできないのに中身がはみ出している要素(パス設定の見切れと同種)
*/
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
run('test_flows: 測定・スケジュール・メンテナンスの各導線を巡回し、', async ({page,rec,B,W,idle,paint,browser})=>{

 // --- 収集器(画面ごとに切り分けられるようラベルを差し替える) ---
 let where='起動';
 const errs=[],bad=[];
 page.on('console',m=>{if(m.type()==='error')errs.push(`${where}[console]: ${m.text().slice(0,160)}`)});
 page.on('response',r=>{
  if(r.status()>=400)bad.push(`${where}: HTTP ${r.status()} ${r.url().replace(API,'')}`);
 });

 /* 画面の健全性をまとめて測る。数値で返し、判定は呼び出し側で行う。 */
 const inspect=()=>page.evaluate(()=>{
  const vis=el=>{const s=getComputedStyle(el);
   return s.display!=='none'&&s.visibility!=='hidden'&&el.getClientRects().length>0};
  // hidden属性が付いているのに見えている要素
  const hiddenButVisible=[...document.querySelectorAll('[hidden]')]
   .filter(vis).map(el=>el.id||el.className||el.tagName).slice(0,5);
  // トップレベルのパネルが同時に見えていないか(画面の重なり)
  const PANELS=['recordModal','schedulePanel','calendarPanel','reportPanel',
                'dashboardPanel','masterMaintPanel','qualityAnalysisPanel'];
  const shown=PANELS.filter(id=>{const el=document.getElementById(id);return el&&vis(el)});
  // スクロールできないのに中身がはみ出している(見切れ)
  const clipped=[...document.querySelectorAll('section,div')].filter(el=>{
   if(!vis(el))return false;
   const s=getComputedStyle(el);
   if(s.overflowY==='auto'||s.overflowY==='scroll'||s.overflowY==='visible')return false;
   return el.scrollHeight-el.clientHeight>24&&el.clientHeight>80;
  }).map(el=>`${el.id||el.className}(${el.scrollHeight-el.clientHeight}px超過)`).slice(0,5);
  return {
   overflowX:document.documentElement.scrollWidth-document.documentElement.clientWidth,
   hiddenButVisible,shown,clipped,
   header:document.querySelector('#fileName')?.textContent||'',
  };
 });

 /* 1画面ぶんの検証。遷移→安定待ち→計測→記録。 */
 const check=async(label,go,opts={})=>{
  where=label;
  const before=errs.length,beforeBad=bad.length;
  await go();
  /* 画面ぶんの取得が出そろって静まるまで（時間で待たない・§9.102）。
     エラーを拾う網なので、静かさは少し長めに取る。 */
  await idle(600,opts.cap||8000);
  const x=await inspect();
  rec(`${label}: JS実行時エラーが出ない`,errs.length===before,errs.slice(before).join(' / ').slice(0,200));
  rec(`${label}: 失敗したリクエストが無い`,bad.length===beforeBad,bad.slice(beforeBad).join(' / ').slice(0,200));
  rec(`${label}: 横にはみ出していない`,x.overflowX<=1,`overflowX=${x.overflowX}px`);
  rec(`${label}: hidden属性が効いている`,x.hiddenButVisible.length===0,JSON.stringify(x.hiddenButVisible));
  rec(`${label}: パネルが重なっていない`,x.shown.length<=1,JSON.stringify(x.shown));
  rec(`${label}: 見切れている領域が無い`,x.clipped.length===0,JSON.stringify(x.clipped));
  if(opts.header)rec(`${label}: 見出しが「${opts.header}」`,x.header===opts.header,x.header);
  return x;
 };

 try{
  await setMode('edit');
  // --- 起動〜仕掛一覧(測定作業の入口) ---
  await check('起動(仕掛一覧)',async()=>{
   await page.goto(API+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openSchedule',{timeout:20000});
   await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForSelector('#grid',{timeout:20000});
  });

  // --- 測定作業導線 ---
  await check('測定データ一覧',()=>page.click('#homeDrafts'),{header:'測定データ一覧'});
  /* 一覧の見出しは**データソースマスタの表示名**(§9.87)。コード内に
     固定で書いていた頃は、左メニュー(表示名)とヘッダー(固定文字列)で
     別の名前が出ていた。表示名を変えても追随するよう、期待値もマスタから取る。 */
  const dsLabel=k=>page.evaluate(key=>WL.dataSource.label(key),k);
  await check('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'),
    {header:await dsLabel('SIKALOTNOW')});
  await check('品質データ',()=>page.click('aside [data-db-key="SIKALOTDEF"]'),
    {header:await dsLabel('SIKALOTDEF')});

  // --- スケジュール作業導線 ---
  await check('作業スケジュール',()=>page.click('#openSchedule'),
   {header:'作業スケジュール'});
  const rows=await page.$$eval('.sc-row-line',n=>n.length);
  rec('作業スケジュール: 予定行が描かれている',rows>0,`行数=${rows}`);

  // --- 分析導線 ---
  await check('ダッシュボード',()=>page.click('#openDashboard'),{header:'ダッシュボード'});
  await check('測定実績カレンダー',()=>page.click('#openCalendar'),{header:'測定実績カレンダー'});

  // --- メンテナンス導線(マスタ管理の各タブ) ---
  await check('マスタ管理',()=>page.click('#openMasterMaint'),{header:'マスタ管理'});
  const tabs=await page.$$eval('#masterMaintNav [data-master]',n=>n.map(x=>x.dataset.master));
  rec('マスタ管理: タブが並んでいる',tabs.length>=8,`${tabs.length}件: ${tabs.slice(0,6)}`);
  // 見切れ・実行エラーが出やすい特殊タブを重点的に見る
  for(const key of ['pathConfig','dataImport','shiftPattern','loadFactor','columnDisplay']){
   if(!tabs.includes(key))continue;
   await check(`マスタ管理/${key}`,async()=>{
    await page.click(`#masterMaintNav [data-master="${key}"]`);
   });
  }

  // --- 測定画面(未保存の保護。今回の変更点) ---
  where='測定画面';
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000}); await W.settleFlags(page); await idle();
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r)r.querySelector('.sc-row-start').click();
   return !!r;
  });
  if(started){
  await W.until(page,()=>{const m=document.querySelector('#measureModal');return !!m&&!m.hidden},null,
    {ms:20000,what:'測定画面が開く'});
  await idle();
   const open=await page.evaluate(()=>!document.querySelector('#measureModal')?.hidden);
   rec('測定画面: 予定から開始できる',open);
   if(open){
    const x=await inspect();
    rec('測定画面: 横にはみ出していない',x.overflowX<=1,`overflowX=${x.overflowX}px`);
    rec('測定画面: hidden属性が効いている',x.hiddenButVisible.length===0,JSON.stringify(x.hiddenButVisible));
    // 未保存にしてから別画面へ移ると、閉じずに残ること(VER1.74.14)。
    // **サイドバーのクリックでは到達しない**: .modal{inset:0}が全面を覆うため
    // 測定中はナビを押せない(Playwrightも「measureModalがpointer eventsを
    // 遮る」で30秒待って失敗する)。ガードが効く必要があるのは画面切替を
    // プログラムから呼ぶ経路なので、そちらで確かめる。
    await page.evaluate(()=>{if(typeof markDirty==='function')markDirty()});
    await page.evaluate(()=>WL.enterView('records'));
    await W.paint(page); await idle();
    const kept=await page.evaluate(()=>!document.querySelector('#measureModal')?.hidden);
    rec('測定画面: 未保存なら画面を移っても閉じない',kept,`hidden=${!kept}`);
    // 後始末: 破棄して閉じる
    await page.evaluate(()=>{if(typeof WL.base.measureDirty!=='undefined')WL.base.measureDirty=false;
     const m=document.querySelector('#measureModal');if(m)m.hidden=true});
   }
  }else rec('測定画面: 予定から開始できる',false,'開始ボタンのある行が無い');

  console.log('\n=== 収集したエラー ===');
  errs.slice(0,10).forEach(e=>console.log('  [err]',e));
  bad.slice(0,10).forEach(e=>console.log('  [http]',e));

  /* **置いた実績は自分で消す**（§9.351・§9.360）。残った実績は計画外実績と
     してタイムラインに現れ、行数・作業可否・「作業中」の有無を変える
     ——後片付けを忘れた1本が、無関係な網を落とす。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1600,height:1000}});
