/* test_scstop.js: 設備停止を入れる／その場で登録する(§9.181)
   ============================================================
   利用者の指摘は「設備停止モーダルが使いにくい・見栄えも改善して」
   「スケジュール作成時の設備停止入力の部分からも設備停止の登録ができるように
   （メンテナンスしながら登録しやすい形）」。
   ここで固定するのは次の点。
    1. **どこへ入るのか**が先に書いてある（設備名と入る位置）
    2. 分類は**分類マスタの名前**で出る（固定の5つへ丸めない）
    3. 追加できないもの（突発停止）は**理由を文字で**分けて出す
    4. 絞り込みが効き、**入力欄のフォーカスが飛ばない**
    5. その場で登録でき、登録したものがすぐ押せる（印が付く）
    6. モーダルと側パネルの**どちらでも同じもの**が出る（実装は1つ）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const NEW='点検（自動テスト）';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const reasons=()=>fetch(B+'/api/schedule/stop-reason-master?equipment='+encodeURIComponent(EQ)).then(r=>r.json());
const SEED=[['保全','定期メンテナンス',120],['保全','刃物交換',30],['段取り','段取り替え',45],
            ['突発','突発停止',0],['','清掃',15]];
async function cleanup(){
 try{
  const r=await reasons();
  for(const x of (r.items||[]))
   if(x.name===NEW||SEED.some(s=>s[1]===x.name))await post('/api/schedule/stop-reason-master/delete',{id:x.id});
 }catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await cleanup();
  for(const [category,name,standardMinutes] of SEED)
   await post('/api/schedule/stop-reason-master',{equipment:EQ,category,name,standardMinutes,user_id:'test'});
  await post('/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForTimeout(2200);
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);
  await page.click('#scStopModalBtn');
  await page.waitForSelector('#scStopModal:not([hidden])',{timeout:8000});
  await page.waitForTimeout(800);

  /* ---- 1) どこへ入るのか ---- */
  const where=await page.evaluate(()=>document.querySelector('#scStopWhere')?.textContent.replace(/\s+/g,' ').trim()||'');
  rec('どこへ入るのかが先に書いてある',where.includes(EQ)&&/いちばん後ろ/.test(where),where.slice(0,80));

  /* ---- 2) 分類は分類マスタの名前で ---- */
  const groups=await page.evaluate(()=>[...document.querySelectorAll('.sc-stop-group-title')]
    .map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  rec('分類ごとにまとまって件数も出る',groups.some(g=>/保全/.test(g)&&/2件/.test(g)),JSON.stringify(groups));
  rec('分類なしは「分類なし」と書く',groups.some(g=>/分類なし/.test(g)),JSON.stringify(groups));

  /* ---- 3) 追加できないものは理由を文字で ---- */
  const locked=await page.evaluate(()=>{
   const box=document.querySelector('.sc-stop-locked');
   return {txt:box?box.textContent.replace(/\s+/g,' ').trim():'',
    btn:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent)};
  });
  rec('追加できないものは押せるボタンにしない',!locked.btn.includes('突発停止'),JSON.stringify(locked.btn));
  rec('追加できない理由を文字で書く',/突発停止/.test(locked.txt)&&/連絡/.test(locked.txt),locked.txt.slice(0,70));

  /* ---- 4) 絞り込み ---- */
  await page.click('#scStopSearch');
  await page.type('#scStopSearch','刃物',{delay:40});
  await page.waitForTimeout(500);
  const filt=await page.evaluate(()=>({names:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent),
    more:document.querySelector('.sc-stop-more')?.textContent.trim()||'',
    focus:document.activeElement?.id||'',value:document.getElementById('scStopSearch').value}));
  rec('絞り込みが効く',filt.names.length===1&&filt.names[0]==='刃物交換',JSON.stringify(filt.names));
  rec('絞り込み中は何件中何件かを言う',/1 \/ \d+件/.test(filt.more),filt.more);
  /* **入力中に一覧だけを描き直す**(§9.117)。入力欄を作り直すと1文字ごとに
     カーソルが飛び、2文字目が打てない。 */
  rec('絞り込みの入力欄からフォーカスが飛ばない',
      filt.focus==='scStopSearch'&&filt.value==='刃物',JSON.stringify(filt));
  await page.fill('#scStopSearch','ないない');
  await page.waitForTimeout(400);
  const none=await page.evaluate(()=>document.querySelector('#scStopList')?.textContent.replace(/\s+/g,' ').trim()||'');
  rec('当たらないときは0件だと書く',/0件/.test(none),none.slice(0,60));
  await page.fill('#scStopSearch','');
  await page.waitForTimeout(400);

  /* ---- 5) その場で登録 ---- */
  await page.click('#scStopNewToggle');
  await page.waitForTimeout(400);
  const cats=await page.evaluate(()=>[...document.querySelectorAll('#scStopNewCat option')].map(o=>o.value));
  rec('分類はマスタの選択肢から選べる',cats.includes('保全')&&cats.includes(''),JSON.stringify(cats));
  const note=await page.evaluate(()=>document.querySelector('#scStopNewNote')?.textContent||'');
  rec('どこへ登録されるかを書く',note.includes(EQ),note.slice(0,60));
  await page.fill('#scStopNewName',NEW);
  await page.selectOption('#scStopNewCat','保全');
  await page.fill('#scStopNewMin','25');
  await page.click('#scStopNewSave');
  await page.waitForTimeout(2500);
  const saved=await page.evaluate(n=>({names:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent),
    isNew:[...document.querySelectorAll('.sc-stop-button.is-new b')].map(x=>x.textContent),
    formHidden:document.getElementById('scStopNewForm')?.hidden}),NEW);
  rec('登録したものがすぐ押せる',saved.names.includes(NEW),JSON.stringify(saved.names));
  rec('登録したものに印が付く（探し直させない）',saved.isNew.includes(NEW),JSON.stringify(saved.isNew));
  rec('登録したら入力欄は畳む',saved.formHidden===true,String(saved.formHidden));
  const master=await reasons();
  const hit=(master.items||[]).find(x=>x.name===NEW);
  rec('マスタへ入っている',!!hit&&String(hit.category||'')==='保全'&&Number(hit.standardMinutes)===25,
      JSON.stringify(hit&&{c:hit.category,m:hit.standardMinutes}));

  /* 押すと予定へ入る（この設備の予定として） */
  const before=(await (await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))).json()).entries||[];
  await page.evaluate(n=>{
   const btn=[...document.querySelectorAll('.sc-stop-button')].find(x=>x.querySelector('b')?.textContent===n);
   btn&&btn.click();
  },NEW);
  await page.waitForTimeout(3500);
  const after=(await (await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))).json()).entries||[];
  const added=after.find(e=>e.kind==='設備停止'&&e.title===NEW);
  rec('登録したものを押すと予定へ入る',!!added,`${before.length} → ${after.length}`);
  if(added)await post('/api/schedule/plan/delete',{id:added.id});

  /* ---- 6) 側パネルでも同じもの ---- */
  await page.click('#scStopModalClose');
  await page.waitForTimeout(600);
  const side=await page.evaluate(()=>{
   const tab=document.querySelector('#scSideToggle');if(tab)tab.click();
   const t=document.querySelector('#scStopSectionToggle');if(t)t.click();
   return true;
  });
  await page.waitForTimeout(700);
  const inSide=await page.evaluate(()=>({box:!!document.querySelector('#scSide #scStopButtons'),
    search:!!document.querySelector('#scSide #scStopSearch'),
    add:!!document.querySelector('#scSide #scStopNewToggle'),
    where:!!document.querySelector('#scSide #scStopWhere')}));
  rec('側パネルでも同じ道具が出る（実装は1つ）',
      inSide.box&&inSide.search&&inSide.add&&inSide.where,JSON.stringify(inSide));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
