/* test_designfix.js: 設計値（丈数・条数・元幅）の訂正を受け付け、元と変更後が分かる（§9.637）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「メイン測定画面から、設計情報を取り込んだ時に、ごくまれに間違っていることがあり、
    丈数や条数の変更を行わなければならないことがあります。このとき、元幅よりも製品幅×条数の
    計算値が広くなってしまう場合は元幅の修正も必要になりますが、元データの状態と変更した
    データの内容がわかり、変更したということがわかるようにして修正を受け付けるようにしてほしい」

   物差し（**直す前にも同じ物差しで測った**・前の値は §9.637 の決定記録）:
    M1. 条数を変えたあと、仕掛の完全な行の取り直し（開き直し）で設計値へ戻されないか
    M2. 元幅を直す道があるか（直した値が屑幅・条数の上限に効くか）
    M3. 設計値と変更後・誰が・いつが記録に残るか（元に戻せば記録も消える）
    M4. 元幅を超える条数を打ったとき、行き止まりでなく直す窓が開くか
    M5. 画面に「設計 → 変更後」が字で出るか
   **材料は自分で注ぎ込む**——検証用の仕掛は BOX設計_横割数・BOX実績_板幅・製造板幅を持たないので、
   一覧の応答（/api/table）へその列を足す（現場の行と同じ形）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A',LOT='L0007';
const SHOT=process.env.WAVELOG_SHOT||'';
const DESIGN={'BOX設計_横割数':'4','BOX設計_縦割数':'3','BOX実績_板幅':'430','製造板幅':'100'};

run('test_designfix: 設計値の訂正（§9.637）', async ({page,rec,B,W,idle})=>{
 /* 一覧の応答の対象ロットへ設計の列を足す（開く時の行も、開いた後の取り直しも同じ口を通る）。 */
 await page.route('**/api/table?*',async route=>{
  const res=await route.fetch();
  let j;try{j=await res.json()}catch(_){return route.fulfill({response:res})}
  (j.rows||[]).forEach(r=>{if(r&&r['ロット番号']===LOT)Object.assign(r,DESIGN)});
  if(Array.isArray(j.columns))Object.keys(DESIGN).forEach(k=>{if(!j.columns.includes(k))j.columns.push(k)});
  return route.fulfill({response:res,json:j});
 });
 const st=()=>page.evaluate(()=>({
  条数:document.getElementById('horizontalCount').value,丈数:document.getElementById('verticalCount').value,
  元幅:S.measure.basic.originalWidth,
  記録:WL.designFix?WL.designFix.list().map(x=>`${x.key}:${x.design}→${x.value}`):null,
 }));
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);
 const opened=await page.evaluate(async lot=>{
  const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
    include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
  const row=((await r.json()).rows||[])[0];
  if(!row)return 'ロットが見つからない';
  await WL.records.openMeasurement(row);return 'ok';
 },LOT).catch(e=>'例外: '+e.message);
 rec('材料のロットを開ける',opened==='ok',String(opened));
 await W.until(page,()=>typeof S!=='undefined'&&!!S.measure&&S.measure.basic.originalWidth==='430',null,{ms:25000,what:'設計の列が届く'});
 await idle(300);
 /* WAVELOG_SHOT=<dir> のときだけ画面を撮る（利用者の PC 1728×1152 と フル HD・125% 1536×864）。 */
 const shootAll=async tag=>{
  for(const [w,h] of [[1728,1152],[1536,864]]){
   await page.setViewportSize({width:w,height:h});await idle(200);
   for(const st2 of ['1','2']){
    await page.evaluate(x=>WL.measureSteps.go(x),st2);await idle(200);
    await page.screenshot({path:`${SHOT}/df-${tag}-s${st2}-${w}.png`});
   }
  }
  await page.setViewportSize({width:1700,height:1000});await page.evaluate(()=>WL.measureSteps.go('1'));await idle(200);
 };
 const shoot=async tag=>{if(process.env.WAVELOG_SHOT)await shootAll(tag)};
 await shoot('open');
 const a=await st();
 rec('開いた時点は設計どおり（条4・丈3・元幅430）',a.条数==='4'&&a.丈数==='3'&&a.元幅==='430',JSON.stringify(a));

 const typeIn=async(key,val)=>{
  const sel=`#designFixPanel [data-dfx-in="${key}"]`;
  await page.waitForSelector(sel,{timeout:10000});
  await page.fill(sel,String(val));await page.press(sel,'Enter');await idle(300);
 };
 const panel=()=>page.evaluate(()=>{const h=document.getElementById('designFixPanel');return h?{
  見える:h.getBoundingClientRect().height>0,字:h.textContent.replace(/\s+/g,' '),
  焦点:document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.dfxIn||'':'',
  欄を伏せた:getComputedStyle(document.querySelector('label[data-f="horizontalCount"]')).display==='none'}:null});
 const p0=await panel();
 rec('M5 測定表の形が「設計（元データ）｜使う値｜差」の表になり、設計どおりと言う',
     !!p0&&p0.見える&&p0.欄を伏せた&&/設計（元データ）/.test(p0.字)&&/設計どおり/.test(p0.字),JSON.stringify(p0));

 /* ---- M1: 条数を変え、保存して、仕掛の完全な行を取り直しても戻されない ---- */
 await typeIn('horizontalCount',3);
 await page.evaluate(()=>{WL.measureView.collect();return WL.measureHooks.run('afterResumeStoredMeasure')});
 await W.until(page,()=>!!document.getElementById('designFixPanel'),null,{ms:5000,what:'取り直しの描画'});
 await idle(300);
 const b=await st();
 const kept=String(await page.evaluate(()=>S.measure.settings.horizontalCount));
 rec('M1 変えた条数は取り直しで設計値へ戻されない',b.条数==='3'&&kept==='3',JSON.stringify({...b,記録の条数:kept}));
 rec('M3 設計値と変更後・誰が・いつが記録に残る',await page.evaluate(()=>{const f=S.measure.settings.designFix.horizontalCount;
   return S.measure.settings.designBase.horizontalCount===4&&f&&f.value===3&&!!f.at&&'by' in f&&S.measure.settings.designFixLog.length>=1}),
   JSON.stringify(await page.evaluate(()=>({base:S.measure.settings.designBase,fix:S.measure.settings.designFix}))));
 const p1=await panel();
 rec('M5 変えた行は「－1 変更」、表の上に「変更 1項目」と字で出る',/－1 変更/.test(p1.字)&&/変更 1項目/.test(p1.字),p1.字.slice(0,200));
 /* 戻す道は差のセルを押した先（主の動線に置かない） */
 await page.click('#designFixPanel [data-dfx-diff="horizontalCount"]');
 await page.click('#designFixPanel [data-dfx-revert="horizontalCount"]');await idle(300);
 const c=await st();
 rec('M3 設計値へ戻すと記録の「変更」も消える（経過は残る）',c.条数==='4'&&c.記録.length===0
     &&await page.evaluate(()=>S.measure.settings.designFixLog.length>=2),JSON.stringify(c));

 /* ---- M4: 元幅を超える条数（430 ÷ 100 ＝ 4 条まで）を打つと、行き止まりにせず元幅の欄へ ---- */
 await typeIn('horizontalCount',5);
 const d=await st(),pd=await panel();
 rec('M4 元幅が足りない条数は測定表に当てず、元幅の欄へ移って直す数を言う',
     d.条数==='4'&&pd.焦点==='originalWidth'&&/元幅を 500\.0 以上に/.test(pd.字)&&/足りない/.test(pd.字),JSON.stringify({d,焦点:pd.焦点,字:pd.字.slice(0,260)}));

 await shoot('short');
 /* ---- M2: 元幅を直すと、待たせていた条数も入る ---- */
 await typeIn('originalWidth',520);
 const e=await st();
 const scrap=await page.evaluate(()=>WL.split.scrapInfo());
 rec('M2 元幅を直せて、待たせていた条数がそこで入る（屑幅も直した元幅で出る）',
     e.条数==='5'&&e.元幅==='520'&&e.記録.length===2&&scrap&&Math.abs(scrap.scrap-20)<1e-6,JSON.stringify({e,scrap}));
 await page.evaluate(()=>{WL.measureView.collect();return WL.measureHooks.run('afterResumeStoredMeasure')});
 await idle(400);
 const f=await st();
 rec('M2 直した元幅も取り直しで仕掛の値（430）へ戻されない',f.元幅==='520'&&f.条数==='5',JSON.stringify(f));
 const txt=await page.evaluate(()=>{WL.measureView.collect();return S.measure.settings.designFixText});
 rec('M3 記録の字（帳票・一覧が読む）に設計→変更後が並ぶ',txt==='条数 4→5・元幅 430.0→520.0',txt);
 await shoot('changed');
});
