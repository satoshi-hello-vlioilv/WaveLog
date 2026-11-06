/* test_logclean.js: 報告に入る記録を片付ける（§9.641）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「アプリ内の報告ログやエラーログを消せるようにしてください。」

   物差し（**直す前にも同じ物差しで測った**・前の値は §9.641 の決定記録）:
    L1 画面の失敗（この端末のブラウザの記録・報告の ① に並ぶ物）を消す道があるか（前は 0本）
    L2 「報告する」の段から、画面の失敗とログのエラー・警告を消すまでの手数（前はログだけ 4手・失敗は消せない）
    L3 窓は出どころで2群・消した後の見通し（→ 0件）・決めるボタン「削除する」・焦点はキャンセル
    L4 外した群は「→ そのまま」、何も選ばなければ押せない
    L5 消すと、画面の失敗は 0件・ログは**いまのファイル**（app.log・launcher.log）を空にする口が呼ばれる
    L6 消す物が無い・編集モードでないときは札を出さず、字で言う
    L7 コピーした後、完了の文が片付ける場所を指す
   **本物のログは消さない**（`/api/logs/clear`は差し替えて、呼ばれた中身だけ数える）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');

run('test_logclean: 報告に入る記録を片付ける（§9.641）', async ({page,rec,B,W,idle,setMode})=>{
 const cleared=[];
 let zeroLogs=false;
 await page.route('**/api/logs/clear',async route=>{
  try{cleared.push(JSON.parse(route.request().postData()||'{}').file)}catch(e){cleared.push('?:'+e.message)}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,files:[]})});
 });
 /* 消した後の「ログの問題」は本物のログが消えていないので、消した後だけ 0 に差し替えて読む。 */
 await page.route('**/api/boot-report',async route=>{
  const res=await route.fetch();const j=await res.json();
  if(zeroLogs&&j.problems)j.problems.counts={error:0,warning:0};
  await route.fulfill({response:res,body:JSON.stringify(j)});
 });
 const openReport=async()=>{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openLogView',{timeout:20000});
  await page.click('#openLogView');
  await page.waitForSelector('#logPanel:not([hidden])',{timeout:15000});
  await page.waitForFunction(()=>/WaveLog 起動の状況/.test(document.getElementById('lgPreview')?.value||''),null,{timeout:15000});
  await idle(300,10000);
 };
 const state=()=>page.evaluate(()=>{
  const b=document.getElementById('lgClean'),why=document.getElementById('lgCleanWhy');
  return {btn:!!b&&!b.hidden&&b.getClientRects().length>0,why:why&&!why.hidden?why.textContent.trim():'',
          fails:(WL.feedback.log()||[]).length,
          facts:[...document.querySelectorAll('#lgFacts .lg-fact')].map(f=>f.textContent.replace(/\s+/g,' ').trim())};
 });
 try{
  await setMode('edit');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openLogView',{timeout:20000});
  await page.evaluate(()=>{WL.feedback.clear();for(const [w,s] of [['網: 追加',503],['網: 追加',503],['網: 保存',500]]){
   const e=new Error('網の失敗');e.status=s;WL.feedback.note(w,e,{設備:'網'})}});
  await openReport();
  const s0=await state();
  rec('L1 編集モードで、報告に入るものの見出しの右に「片付ける…」が出る（画面の失敗 3件）',s0.btn&&s0.fails===3&&!s0.why,JSON.stringify(s0).slice(0,200));

  /* L7: コピーした後、完了の文が片付ける場所を指す */
  const done=await page.evaluate(async()=>{
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.resolve()}});
   document.getElementById('lgReportCopy').click();
   for(let i=0;i<60&&!/コピーしました/.test(document.getElementById('lgReportDone').textContent);i++)await new Promise(r=>setTimeout(r,50));
   return document.getElementById('lgReportDone').textContent;
  });
  rec('L7 コピーした後、完了の文が「片付ける…」の場所を指す（入口は増やさない）',
      /片付ける…」で記録を消せます/.test(done)&&await page.evaluate(()=>document.querySelectorAll('#lgClean,.lg-clean').length)===1,done);

  /* L2・L3: 窓 */
  await page.click('#lgClean');
  await page.waitForSelector('#appConfirmModal:not([hidden]) input[data-clean]',{timeout:15000});
  const m=await page.evaluate(()=>{
   const body=document.getElementById('appConfirmBody');
   return {title:document.getElementById('appConfirmTitle').textContent,ok:document.getElementById('appConfirmOk').textContent,
           wheres:[...body.querySelectorAll('.lg-clean-where')].map(x=>x.textContent),
           after:[...body.querySelectorAll('.lg-clean-after')].map(x=>x.textContent),
           checked:[...body.querySelectorAll('input[data-clean]')].map(x=>x.dataset.clean+':'+x.checked),
           focus:document.activeElement&&document.activeElement.id,
           danger:/戻せません/.test(body.textContent)};
  });
  rec('L2 「報告する」から2手（片付ける…→削除する）で、画面の失敗とログの両方を選べる',
      m.checked.includes('fails:true')&&m.checked.some(x=>/^logs:/.test(x)),JSON.stringify(m.checked));
  rec('L3 窓は出どころで2群（この端末のブラウザ／この PC のログ）・消した後の見通し・「削除する」・戻せない・焦点はキャンセル',
      m.wheres.length===2&&/ブラウザ/.test(m.wheres[0])&&/app\.log・launcher\.log/.test(m.wheres[1])
      &&m.after[0]==='→ 0件'&&m.ok==='削除する'&&m.danger&&m.focus==='appConfirmCancel',JSON.stringify(m));

  /* L4: 外した群は「→ そのまま」、両方外すと押せない */
  const logsOn=m.checked.includes('logs:true');
  await page.click('#appConfirmBody input[data-clean="fails"]');
  const m1=await page.evaluate(()=>({after:document.querySelector('#appConfirmBody [data-after="fails"]').textContent,
                                      dis:document.getElementById('appConfirmOk').disabled}));
  if(logsOn)await page.click('#appConfirmBody input[data-clean="logs"]');
  const m2=await page.evaluate(()=>document.getElementById('appConfirmOk').disabled);
  rec('L4 外した群は「→ そのまま」、何も選ばなければ「削除する」を押せない',
      m1.after==='→ そのまま'&&m2===true,JSON.stringify({m1,none:m2,logsOn}));
  await page.click('#appConfirmBody input[data-clean="fails"]');
  if(logsOn)await page.click('#appConfirmBody input[data-clean="logs"]');

  /* L5: 消す */
  zeroLogs=true;
  await page.click('#appConfirmOk');
  await W.until(page,()=>(WL.feedback.log()||[]).length===0&&!/読んでいます/.test(document.getElementById('lgFacts').textContent),null,{ms:15000,what:'消した後の描き直し'});
  await idle(300,10000);
  const s1=await state();
  rec('L5 消すと、画面の失敗は0件・ログはいまのファイルだけを空にする口が呼ばれる（1世代前は触らない）',
      s1.fails===0&&(!logsOn||(cleared.length>0&&cleared.every(f=>/^(app|launcher)\.log$/.test(f))))
      &&s1.facts.some(f=>/画面の失敗 なし/.test(f)),JSON.stringify({cleared,facts:s1.facts.slice(1,3)}));

  /* L6: 消す物が無いときは札を出さず字で言う／編集モードでないときも字で言う */
  rec('L6 消す物が無いときは札を出さず「片付ける物はありません」',!s1.btn&&/片付ける物はありません/.test(s1.why),JSON.stringify(s1).slice(0,200));
  await setMode('view');
  await page.evaluate(()=>{const e=new Error('網の失敗');e.status=500;WL.feedback.note('網: 保存',e,{設備:'網'})});
  await openReport();
  const s2=await state();
  rec('L6 編集モードでない端末は札を出さず「編集モードの端末でできます」と字で言う',
      !s2.btn&&/編集モードの端末でできます/.test(s2.why)&&s2.fails===1,JSON.stringify(s2).slice(0,200));
 }finally{
  await page.evaluate(()=>WL.feedback?.clear?.()).catch(e=>console.log('後片付け: 画面の失敗を消せない',e.message));
  await setMode('edit');
 }
});
