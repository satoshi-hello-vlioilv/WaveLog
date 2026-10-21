/* test_splitjudge.js: 分割ロットの板幅の判定は「いまの並び」の子ロットで（§9.616）
   ============================================================
   利用者の報告「幅ロット分割の測定時、子ロットの並び位置を変えたときに幅公差の判定がうまくいかない。
   並びが変わったら並びを正として、入力済みデータも再判定してほしい」。

   物差し（評価関数）: 条ごとに「並びの子ロットの基準（製造板幅±製造公差）で決まる答え」と
   画面の答え（①その条の公差＝`toleranceDetail('width',j)`の範囲 ②欄の NG の印）を突き合わせ、
   食い違った条の数を数える。どの場面でも 0 が正。
    J1. 開いた直後（既定の並び A,B）
    J2. 帯を掴んで並べ替えた直後（B,A）——打ってあった値はその条のまま、新しい子ロットで判定し直す
    J3. 並べ替えたあとに打ち直した値
    J4. 「1つ戻す」で並びを戻したとき
    J5. 一時保存して開き直したあと（候補の控えが無く、確定済みの割当から材料を作る道）に並べ替えたとき
    J6. 完了前の確認が数える公差外（記録に残す「NGのまま完了」の件数）も条ごとの子ロットで数える
   子ロットの幅・公差は検証用の仕掛に無いので、取得の応答へ足して作る（親ロットにも親の幅を持たせる——
   子ロットの公差が落ちると親の幅で判定されて、全部の条が NG になる現場の形。親の横割数は条の合計）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029',EQ='テスト設備A',LOT='L9000';
/* 子ロットの基準（製造板幅・製造公差）。親は分割前の幅。 */
const SPEC={
 L9000:{w:1000,p:1,m:0,n:2},
 L90001:{w:500,p:0.2,m:0,n:1},
 L90002:{w:480,p:0.2,m:0,n:1},
};
const addSpec=row=>{
 const s=SPEC[String(row&&row['ロット番号']||'')];if(!s)return row;
 return Object.assign(row,{'製造板幅':s.w,'板幅公差_製造_ﾌﾟﾗｽ':s.p,'板幅公差_製造_ﾏｲﾅｽ':s.m,
  '製造板厚':1.0,'板厚公差_製造_ﾌﾟﾗｽ':0.05,'板厚公差_製造_ﾏｲﾅｽ':0.05,'BOX設計_横割数':s.n});
};

run('test_splitjudge: 分割ロットの板幅の判定は並びの子ロットで（§9.616）', async ({page,rec,W,idle})=>{
 await fetch(API+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 await page.route('**/api/table?*',async route=>{
  const res=await route.fetch();let j;
  try{j=await res.json()}catch(e){return route.fulfill({response:res})}
  if(Array.isArray(j.rows))j.rows.forEach(addSpec);
  if(Array.isArray(j.columns))['製造板幅','板幅公差_製造_ﾌﾟﾗｽ','板幅公差_製造_ﾏｲﾅｽ','製造板厚','板厚公差_製造_ﾌﾟﾗｽ','板厚公差_製造_ﾏｲﾅｽ','BOX設計_横割数']
   .forEach(c=>{if(!j.columns.includes(c))j.columns.push(c)});
  return route.fulfill({response:res,json:j});
 });
 await page.goto(API+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:25000});
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 const opened=await page.evaluate(async lot=>{
  const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
   include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
  const row=((await r.json()).rows||[])[0];
  if(!row)return 'ロットが見つからない';
  await WL.records.openMeasurement(row);return 'ok';
 },LOT).catch(e=>'例外: '+e.message);
 rec('前提: 分割ありロットを開ける',opened==='ok',String(opened));
 if(opened!=='ok')return;
 const toStep2=async()=>{
  await page.evaluate(()=>WL.measureSteps.go('2'));
  await page.evaluate(()=>{const mt=document.getElementById('measureType');mt.value='板厚・板幅';
   mt.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForFunction(()=>(S.measure?.settings?.splitGroups||[]).length===2
    &&document.getElementById('horizontalCount')?.value==='2',null,{timeout:20000})
   .catch(async e=>console.log('割当が2つにならない（続ける）: '+e.message+' '+JSON.stringify(await page.evaluate(()=>({
    groups:(S.measure?.settings?.splitGroups||[]).map(g=>g.lot+'×'+g.count),seq:S.measure?.settings?.splitSequence,
    条数:document.getElementById('horizontalCount')?.value,状態:document.getElementById('splitGrid')?.textContent.slice(0,200)})))));
  await page.evaluate(()=>{const b=document.querySelector('[data-mode="manual"]');if(b)b.click()});
  await page.waitForFunction(()=>!!document.querySelector('input[data-mkey="width"][data-j="1"]'),null,{timeout:20000})
   .catch(e=>console.log('2条目の欄が出ない（続ける）: '+e.message));
  await idle(300);await closeModal();
 };
 const closeModal=()=>page.evaluate(()=>{const m=document.getElementById('appConfirmModal');
  if(m&&!m.hidden){const b=document.getElementById('closeAppConfirm');if(b)b.click()}});
 await toStep2();

 /* 評価関数: 条ごとの食い違いの数と中身。 */
 const evaluate=()=>page.evaluate(spec=>{
  const st=S.measure.settings,seq=st.splitSequence||[];
  const out={並び:seq.slice(),食い違い:0,条:[]};
  seq.forEach((lot,j)=>{
   const s=spec[lot];
   const want=s?[s.w-s.m,s.w+s.p]:null;
   const got=WL.measureInput.toleranceDetail('width',j,'板幅')?.range||null;
   const el=document.querySelector(`input[data-mkey="width"][data-j="${j}"]`);
   const raw=el?String(el.value).trim():'',v=Number(raw);
   const wantNg=raw!==''&&want?(v<want[0]||v>want[1]):false;
   const gotNg=!!el&&el.classList.contains('ng');
   const pill=!!el&&!!el.closest('.strip-input-wrap')?.querySelector('.judge-pill');
   const ok=!!want&&!!got&&Math.abs(got[0]-want[0])<1e-9&&Math.abs(got[1]-want[1])<1e-9&&wantNg===gotNg&&pill===wantNg;
   if(!ok)out.食い違い++;
   out.条.push({j,lot,値:raw,公差:got,正:want,NG:gotNg,札:pill,正のNG:wantNg});
  });
  return out;
 },SPEC);
 /* 欄に入ると表が描き直されることがある（印を移す）ので、入ってから欄を引き直して打つ（人と同じ順）。 */
 const sel=j=>`input[data-mkey="width"][data-j="${j}"]`;
 const typeAt=async(j,v)=>{
  await page.evaluate(s=>document.querySelector(s)?.focus(),sel(j));await idle(150);
  await page.evaluate(([s,v])=>{const el=document.querySelector(s);if(!el)return;
   el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.blur()},[sel(j),String(v)]);
  await idle(150);
 };
 const drag=async()=>{
  const boxes=await page.$$('#splitVisualStrip .split-visual-block');
  if(boxes.length<2)return false;
  const p=await boxes[0].boundingBox(),q=await boxes[boxes.length-1].boundingBox();
  await page.mouse.move(p.x+p.width/2,p.y+p.height/2);
  await page.mouse.down();
  await page.mouse.move(p.x+p.width/2+20,p.y+p.height/2,{steps:3});
  await page.mouse.move(q.x+q.width-4,q.y+q.height/2,{steps:8});
  await page.mouse.up();
  await idle(300);await closeModal();
  return true;
 };

 await typeAt(0,'500.1');await typeAt(1,'480.1');
 const j1=await evaluate();
 rec('J1. 開いた直後（並び A,B）: 条の判定の食い違い 0',j1.並び.join()==='L90001,L90002'&&j1.食い違い===0,JSON.stringify(j1));

 const dragged=await drag();
 const j2=await evaluate();
 rec('J2. 並べ替えた直後（B,A）: 打ってあった値を新しい子ロットで判定し直す（食い違い 0）',
  dragged&&j2.並び.join()==='L90002,L90001'&&j2.食い違い===0&&j2.条.every(x=>x.NG),JSON.stringify(j2));

 await typeAt(0,'480.1');await typeAt(1,'500.1');
 const j3=await evaluate();
 rec('J3. 並べ替えたあとに打ち直した値（食い違い 0・NG なし）',j3.食い違い===0&&j3.条.every(x=>!x.NG),JSON.stringify(j3));

 await page.click('#undoSplit').catch(()=>{});await idle(300);await closeModal();
 const j4=await evaluate();
 rec('J4. 「1つ戻す」で並びを戻すと判定も戻る（食い違い 0）',j4.並び.join()==='L90001,L90002'&&j4.食い違い===0,JSON.stringify(j4));

 /* 完了前の確認が数える公差外（③のカード・記録の completedWithNg が読む同じ答え）。 */
 const reviewNg=()=>page.evaluate(()=>{
  const r=WL.measureReview.outOfTolerance(S.measure);
  return (r&&r.items||[]).flatMap(x=>x.hits).filter(h=>h.key==='width').map(h=>h.index).sort();
 });
 const wantNg=j=>j.条.filter(x=>x.正のNG).map(x=>x.j).sort();
 const j6a=await reviewNg();
 rec('J6. 完了前の確認の公差外も条ごとの子ロットで数える（並び A,B）',JSON.stringify(j6a)===JSON.stringify(wantNg(j4)),
  JSON.stringify({数えた条:j6a,正:wantNg(j4)}));

 /* J5: 一時保存して開き直す（候補の控えはこの画面の中にしか無い。開き直すと確定済みの割当から材料を作る）。 */
 const saved=await page.evaluate(async()=>{await WL.records.saveLocal('編集中');return S.measure.id||S.measure.recordId||'ok'}).catch(e=>'例外: '+e.message);
 rec('前提: 一時保存できる',!String(saved).startsWith('例外'),String(saved));
 await page.reload({waitUntil:'domcontentloaded'});
 await W.booted(page);await idle();
 const reopened=await page.evaluate(async lot=>{
  const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
   include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
  const row=((await r.json()).rows||[])[0];
  await WL.records.openMeasurement(row);return 'ok';
 },LOT).catch(e=>'例外: '+e.message);
 rec('前提: 開き直せる（続きから）',reopened==='ok',String(reopened));
 await toStep2();
 const j5a=await evaluate();
 rec('J5a. 開き直した直後（A,B・打った値のまま）: 食い違い 0',j5a.並び.join()==='L90001,L90002'&&j5a.食い違い===0,JSON.stringify(j5a));
 await drag();
 const j5=await evaluate();
 rec('J5. 開き直したあとに並べ替えても、新しい並びの子ロットで判定し直す（食い違い 0）',
  j5.並び.join()==='L90002,L90001'&&j5.食い違い===0,JSON.stringify(j5));
 const j6b=await reviewNg();
 rec('J6b. 並べ替えたあとの完了前の確認の公差外も新しい並びで数える',JSON.stringify(j6b)===JSON.stringify(wantNg(j5)),
  JSON.stringify({数えた条:j6b,正:wantNg(j5)}));

 /* J7: 子ロットの公差が無い形にする（割当と候補の控えの両方から公差を外す＝その形で開き直した記録と同じ）。
    期待: 基準は子ロットの板幅・幅は親ロットの公差（+1/-0）。 */
 const parentSpec=SPEC[LOT];
 const wantOf=lot=>{const s=SPEC[lot];return s?[s.w-parentSpec.m,s.w+parentSpec.p]:null};
 await page.evaluate(()=>{
  const st=S.measure.settings;
  (st.splitGroups||[]).forEach(g=>{g.tol=null});
  (st.splitSourcesCache||[]).forEach(s=>{if(s.tolData)s.tolData={thickness:{},width:{}}});
  WL.measureView.rejudgeInputs();WL.measureView.updateMeasurementHeading();
 });
 await idle(200);
 const j7=await page.evaluate(()=>{
  const seq=S.measure.settings.splitSequence||[];
  return seq.map((lot,j)=>{const el=document.querySelector(`input[data-mkey="width"][data-j="${j}"]`);
   return{j,lot,値:el?el.value:'',公差:WL.measureInput.toleranceDetail('width',j,'板幅')?.range||null,NG:!!el&&el.classList.contains('ng')}});
 });
 const j7bad=j7.filter(x=>{const w=wantOf(x.lot),v=Number(x.値);
  const okR=w&&x.公差&&Math.abs(x.公差[0]-w[0])<1e-9&&Math.abs(x.公差[1]-w[1])<1e-9;
  const wantNg=x.値!==''&&w?(v<w[0]||v>w[1]):false;return!(okR&&wantNg===x.NG)});
 rec('J7. 子ロットに公差が無くても、基準は条の子ロットの板幅（幅は親の公差）で判定する（食い違い 0）',j7.length===2&&j7bad.length===0,
  JSON.stringify({食い違い:j7bad.length,条:j7}));
 /* 見出しの公差の札は「いま入れている条」の範囲（1条目へ移ってから読む）。 */
 const pill=await page.evaluate(()=>{S.measure.settings.wStep=0;S.measure.settings.dimKey='width';WL.measureView.updateMeasurementHeading();
  return [...document.querySelectorAll('#measurementPanel .tol-pill,.measure-head .tol-pill,#toleranceSummary .tol-pill')].map(e=>e.textContent.trim()).join(' | ')});
 const w0=wantOf(j7[0]&&j7[0].lot)||[0,0];
 rec('J7b. 測定の見出しの公差の札は、いまの条の子ロットの範囲を言う（親の範囲を言わない）',
  pill.includes(String(w0[0].toFixed(2)))&&!pill.includes(String((parentSpec.w-parentSpec.m).toFixed(2))),
  JSON.stringify({札:pill,正:w0}));
},{viewport:{width:1728,height:1152}});
