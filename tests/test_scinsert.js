/* test_scinsert.js: 開いたときの表示とカーソル位置への追加(§9.179)
   ============================================================
   要望は2つ。
    ・スケジュール表と仕掛一覧の**左右入れ替え**、**開いたときの表示**
      （分割／スケジュールだけ）を設定できること
    ・**スケジュールだけで開いているときの追加方法**——カーソルの位置に
      ゴーストで隙間が開き、クリック／ダブルクリックで仕掛・設備停止の
      モーダルから、その位置へ入れられること
   ここで固定するのは次の点。
    1. 設定は画面の中のポップで、開いたときの表示と左右を選べる
    2. 「右」を選ぶと仕掛一覧が右へ動く（区画ごと入れ替わる）
    3. 「スケジュールだけで開く」を選ぶと畳んだ状態で開く
    4. 隙間は**本当に隙間が開く**（行に重ならない）
    5. 隙間は行き来してもちらつかない（同じ位置に留まる）
    6. 何ができるかが隙間に書いてある
    7. クリックで仕掛一覧のモーダルが開く
    8. 追加はその位置へ入る（サーバーの並びで確かめる）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
let b=null;const made=[];
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json());
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await post('/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   localStorage.removeItem('scLayoutPrefsV1');localStorage.removeItem('scSplitListCollapsedV1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForTimeout(2200);
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);

  // ---- 1. 設定ポップ
  await page.click('#scLayoutBtn');
  await page.waitForTimeout(500);
  const pop=await page.evaluate(()=>{const x=document.getElementById('scLayoutPop');
   return x&&!x.hidden?{modes:[...x.querySelectorAll('input[name=scOpenMode]')].map(r=>r.value),
     sides:[...x.querySelectorAll('input[name=scSide]')].map(r=>r.value),
     txt:x.textContent.replace(/\s+/g,' ').trim()}:null});
  rec('開いたときの表示を選べる',!!pop&&pop.modes.join(',')==='last,split,schedule',JSON.stringify(pop&&pop.modes));
  rec('仕掛一覧の位置を選べる',!!pop&&pop.sides.join(',')==='left,right',JSON.stringify(pop&&pop.sides));
  rec('どちらも何が起きるかを書いてある',!!pop&&pop.txt.includes('畳んで開きます')&&pop.txt.includes('スケジュールは左'),
      String(pop&&pop.txt).slice(0,90));

  // ---- 2. 左右入れ替え
  const posBefore=await page.evaluate(()=>({g:Math.round(document.querySelector('#grid').getBoundingClientRect().x),
   p:Math.round(document.querySelector('.sc-panel').getBoundingClientRect().x)}));
  await page.click('#scLayoutPop input[name=scSide][value=right]');
  await page.waitForTimeout(700);
  const posAfter=await page.evaluate(()=>({g:Math.round(document.querySelector('#grid').getBoundingClientRect().x),
   p:Math.round(document.querySelector('.sc-panel').getBoundingClientRect().x),
   cls:document.querySelector('.sc-split-wrap').className}));
  rec('「右」で仕掛一覧が右へ動く',posBefore.g<posBefore.p&&posAfter.g>posAfter.p,
      JSON.stringify({before:posBefore,after:posAfter}));
  await page.click('#scLayoutPop input[name=scSide][value=left]');
  await page.waitForTimeout(500);

  // ---- 3. 「スケジュールだけで開く」
  await page.click('#scLayoutPop input[name=scOpenMode][value=schedule]');
  await page.waitForTimeout(400);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForTimeout(2200);
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);
  const only=await page.evaluate(()=>({collapsed:!!document.querySelector('.sc-split-wrap.sc-list-collapsed'),
   insertable:!!document.querySelector('#scTimeline.sc-insertable'),
   hint:document.querySelector('#scSplitHint')?.textContent.replace(/\s+/g,' ').trim()||''}));
  rec('「スケジュールだけ」で開くと仕掛一覧が畳まれる',only.collapsed,String(only.collapsed));
  /* **選んだ瞬間に効く**(§9.179改訂。利用者の指摘「切り替えた直後に
     スケジュール表だけになりません」)。 */
  await page.click('#scLayoutBtn');await page.waitForTimeout(400);
  await page.click('#scLayoutPop input[name=scOpenMode][value=split]');
  await page.waitForTimeout(900);
  const nowSplit=await page.evaluate(()=>!document.querySelector('.sc-split-wrap.sc-list-collapsed'));
  await page.click('#scLayoutPop input[name=scOpenMode][value=schedule]');
  await page.waitForTimeout(900);
  const nowOnly=await page.evaluate(()=>!!document.querySelector('.sc-split-wrap.sc-list-collapsed'));
  await page.evaluate(()=>document.body.click());
  await page.waitForTimeout(300);
  rec('選んだ瞬間に表示が切り替わる',nowSplit===true&&nowOnly===true,
      JSON.stringify({split:nowSplit,only:nowOnly}));
  rec('その状態では行間クリックで入れられると分かる',only.insertable&&only.hint.includes('隙間が開き'),
      only.hint.slice(0,80));

  // ---- 4-6. 隙間
  const t=await page.evaluate(()=>{const rows=[...document.querySelectorAll('.sc-row-line')]
    .filter(r=>r.draggable);const r=rows[3];const bb=r.getBoundingClientRect();
   return {x:Math.round(bb.x+300),y:Math.round(bb.top),id:r.dataset.id,
           lot:r.querySelector('[data-col="lotNo"]')?.textContent.trim()}});
  await page.mouse.move(t.x,t.y+40);await page.waitForTimeout(150);
  await page.mouse.move(t.x,t.y);await page.waitForTimeout(500);
  const ghost=await page.evaluate(()=>{const g=document.querySelector('#scInsertGhost');
   if(!g||!g.parentNode)return null;
   const gb=g.getBoundingClientRect();
   const over=[...document.querySelectorAll('.sc-row-line')]
     .filter(r=>{const rb=r.getBoundingClientRect();return rb.top<gb.bottom-2&&rb.bottom>gb.top+2}).length;
   return {h:Math.round(gb.height),before:g.dataset.beforeId,over,
           txt:g.textContent.replace(/\s+/g,' ').trim()}});
  rec('カーソル位置に隙間が開く',!!ghost&&ghost.h>=20,JSON.stringify(ghost&&{h:ghost.h}));
  rec('隙間は行に重ならない（行を隠さない）',!!ghost&&ghost.over===0,String(ghost&&ghost.over));
  rec('隙間に何ができるか書いてある',!!ghost&&ghost.txt.includes('クリック')&&ghost.txt.includes('設備停止'),
      String(ghost&&ghost.txt).slice(0,70));
  /* ---- クリックとダブルクリックを分ける(§9.179改訂) ----
     利用者の指摘「クリックでもダブルクリックでも仕掛表が開きました」。
     clickは2回目でも飛ぶので、少し待ってからdblclickが来ていなければ
     単クリックとして扱う。 */
  await page.click('#scInsertGhost');
  await page.waitForTimeout(900);
  const byClick=await page.evaluate(()=>({stop:document.querySelector('#scStopModal')?.hidden===false,
    list:document.querySelector('#scListModal')?.hidden===false}));
  rec('クリックでは設備停止が開く（仕掛表は開かない）',byClick.stop===true&&byClick.list===false,
      JSON.stringify(byClick));
  await page.evaluate(()=>{document.querySelector('#scStopModalClose')?.click()});
  await page.waitForTimeout(600);
  const seen=[];
  for(let dy=-5;dy<=5;dy++){
   await page.mouse.move(t.x,t.y+dy);await page.waitForTimeout(50);
   seen.push(await page.evaluate(()=>{const g=document.querySelector('#scInsertGhost');
    return g&&g.parentNode?g.dataset.beforeId:'-'}));
  }
  rec('少し動かしても隙間がちらつかない',new Set(seen).size===1&&seen[0]!=='-',JSON.stringify([...new Set(seen)]));

  /* ---- 7-8. ダブルクリック → 仕掛表 → その位置へ入る ---- */
  await page.mouse.move(t.x,t.y+40);await page.waitForTimeout(120);
  await page.mouse.move(t.x,t.y);await page.waitForTimeout(420);
  await page.dblclick('#scInsertGhost');
  await page.waitForTimeout(1600);
  const modal=await page.evaluate(()=>({list:document.querySelector('#scListModal')?.hidden===false,
    stop:document.querySelector('#scStopModal')?.hidden===false,
    pinned:!!document.querySelector('#scInsertGhost.is-pinned'),
    txt:document.querySelector('#scInsertGhost')?.textContent.replace(/\s+/g,' ').trim()||''}));
  rec('ダブルクリックで仕掛一覧のモーダルが開く',modal.list===true&&modal.stop===false,
      JSON.stringify({l:modal.list,s:modal.stop}));
  /* **開いている間ゴーストを残す**(利用者の指示)。どこへ入るのか読めなくなる。 */
  rec('仕掛表を開いている間も入る位置が見えている',
      modal.pinned===true&&/ここへ入ります/.test(modal.txt),modal.txt.slice(0,60));
  await page.waitForSelector('#scListModal #grid tbody tr',{timeout:20000});
  /* 行のダブルクリックでその位置へ入る(位置を決めて開いたときだけ効く)。 */
  const lot=await page.evaluate(()=>{
   const trs=[...document.querySelectorAll('#scListModal #grid tbody tr')];
   for(const tr of trs){const c=tr.querySelector('[data-col="ロット番号"]');
    if(c&&c.textContent.trim()){tr.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));return c.textContent.trim()}}
   return null});
  await page.waitForTimeout(4500);
  const j=await plan();
  const ids=(j.entries||[]).map(e=>e.lotNo);
  const at=ids.indexOf(lot),ref=ids.indexOf(t.lot);
  const added=(j.entries||[]).find(e=>e.lotNo===lot);
  if(added)made.push(added.id);
  rec('選んだロットがその位置へ入る',at>=0&&ref>=0&&at===ref-1,
      JSON.stringify({lot,at,refLot:t.lot,ref,around:ids.slice(Math.max(0,at-1),at+2)}));
  /* 続けて入れられるよう、入れた後も位置は残る(利用者の指示)。 */
  const kept=await page.evaluate(()=>!!document.querySelector('#scInsertGhost.is-pinned'));
  rec('入れた後も差し込み位置は残る',kept===true,String(kept));
  /* 閉じたら忘れる——残ると次の追加が思い出しもしない位置へ入る。 */
  await page.evaluate(()=>document.querySelector('#scListModalClose')?.click());
  await page.waitForTimeout(800);
  const cleared=await page.evaluate(()=>!!document.querySelector('#scInsertGhost'));
  rec('仕掛表を閉じたら位置の固定も外れる',cleared===false,String(cleared));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  try{
   await post('/api/access-mode',{mode:'schedule'});
   await post('/api/schedule/session/acquire',{equipment:EQ});
   for(const id of made)await post('/api/schedule/plan/delete',{id});
  }catch(e){}
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
