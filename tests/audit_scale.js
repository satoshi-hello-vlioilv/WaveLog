/* audit_scale.js — 文字サイズ・コントロール寸法の実測（調査用、判定はしない）
   ------------------------------------------------------------
   「揃っていない気がする」を数字にするための道具。各画面を開いて、
   実際に画面へ出ている要素の computed style を集める。

     ・文字サイズ  … 何px が何箇所に出ているか、トークンのどれに当たるか
     ・コントロール… ボタン/入力欄/セレクトの高さが何種類あるか
     ・角丸・余白  … 同じ役割の部品で値が割れていないか

   実行:  tests/with_fixture.sh /opt/node22/bin/node tests/audit_scale.js <出力.json>
   （パス設定の退避・復元は with_fixture.sh が持つ）
*/
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const OUT=process.argv[2]||'/tmp/audit_scale.json';
const fs=require('fs');

/* 収集本体。ページの中で走る。 */
const COLLECT=`(()=>{
 const root=getComputedStyle(document.documentElement);
 const tok={};
 ['--fs-tiny','--fs-badge','--fs-micro','--fs-sm','--fs-base-sm','--fs','--fs-title','--fs-lg','--fs-xl',
  '--ctl-h-xs','--ctl-h-sm','--ctl-h','--ctl-h-lg','--row-h']
  .forEach(k=>{tok[k]=parseFloat(root.getPropertyValue(k))});
 const px=v=>Math.round(parseFloat(v)*100)/100;
 /* 要素の「呼び名」。クラスの先頭2つまでで、どの部品かが分かる程度に。 */
 const nameOf=el=>{
  const cls=[...el.classList].slice(0,2).join('.');
  return el.tagName.toLowerCase()+(cls?'.'+cls:'')+(el.id?'#'+el.id:'');
 };
 const visible=el=>{
  const r=el.getBoundingClientRect();
  if(r.width<1||r.height<1)return false;
  const s=getComputedStyle(el);
  return s.visibility!=='hidden'&&s.display!=='none'&&parseFloat(s.opacity)>.05;
 };
 /* A4帳票(.rp-page/.df-page)は用紙の割り付けのためpx固定が正しいので数えない。 */
 const inPaper=el=>!!el.closest('.rp-page,.df-page,.rp-report,.df-print-area');
 const text=[],ctl=[];
 document.querySelectorAll('*').forEach(el=>{
  if(inPaper(el)||!visible(el))return;
  const s=getComputedStyle(el);
  /* 文字を実際に持っている要素だけ(器は数えない)。 */
  const own=[...el.childNodes].some(n=>n.nodeType===3&&n.nodeValue.trim());
  const isField=['INPUT','SELECT','TEXTAREA','BUTTON'].includes(el.tagName);
  if(own||isField){
   text.push({name:nameOf(el),fs:px(s.fontSize),fw:s.fontWeight,
              sample:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,18)});
  }
  if(isField){
   const r=el.getBoundingClientRect();
   ctl.push({name:nameOf(el),tag:el.tagName.toLowerCase(),h:Math.round(r.height),
             fs:px(s.fontSize),radius:s.borderTopLeftRadius,
             pad:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].join(' ')});
  }
 });
 return {tok,text,ctl};
})()`;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:1700,height:1000},timezoneId:'Asia/Tokyo',locale:'ja-JP'});
 const page=await ctx.newPage();
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const out={};
 const settle=async(ms=900)=>{
  await page.waitForTimeout(ms);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 /* 併せて画面も撮る(数字だけでは「どこが揃っていないか」が分からない)。
    出力先は <出力.json> と同じフォルダ。 */
 const SHOTDIR=require('path').dirname(OUT);
 const grab=async name=>{
  out[name]=await page.evaluate(COLLECT);
  await page.screenshot({path:SHOTDIR+'/'+name+'.png'});
  console.log('collected',name,out[name].text.length);
 };
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await settle(1600);

  await page.click('aside [data-db-key="SIKALOTNOW"]');await settle(2600);
  await grab('01_仕掛一覧');

  /* 品質データを選ぶと body.qa-mode になり、分析パネル(.qa-v7)が出る。 */
  await page.click('aside [data-db-key="SIKALOTDEF"]');await settle(3200);
  await grab('02_品質データ_元データ');
  await page.click('[data-qa-tab="graph"]');await settle(1400);
  /* 折りたたみカードをすべて開いてから測る(閉じていると中身が数えられない)。 */
  await page.evaluate(()=>{
   document.querySelectorAll('.qa-acc:not(.open) .qa-acc-head').forEach(b=>b.click());
  });
  await settle(1200);
  await page.click('#qaRefresh').catch(()=>{});
  await settle(2000);
  await grab('03_品質データ_グラフ');
  await page.click('[data-qa-tab="list"]');await settle(1600);
  await grab('04_品質データ_対象一覧');
  await page.click('[data-qa-tab="raw"]');await settle(800);

  await page.click('#openSchedule');await settle(3000);
  await grab('05_作業スケジュール');
  await page.click('#openDashboard');await settle(2600);
  await grab('06_ダッシュボード');
  await page.click('#openCalendar');await settle(2600);
  await grab('07_実績カレンダー');
  await page.click('#openMasterMaint');await settle(2600);
  await grab('08_マスタ管理');

  fs.writeFileSync(OUT,JSON.stringify(out,null,1));
  console.log('wrote',OUT);
  await b.close();process.exit(0);
 }catch(e){
  console.error('FATAL',e);
  try{fs.writeFileSync(OUT,JSON.stringify(out,null,1))}catch(_){}
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
