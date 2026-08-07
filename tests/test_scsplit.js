/* test_scsplit.js: 分割ありの親ロットと子ロットのまとまり（§9.83）
   ------------------------------------------------------------
   作業スケジュールへ「分割あり」の親ロットを入れると、そのタイミングで
   子ロットの仕掛データも引いて一緒に登録し、親にぶら下がるまとまりとして
   表示する（子は既定で折りたたむ）。

   ここで固定すること:
    - 親を1件入れると子も同時に作られ、親の予定IDにぶら下がること
    - **子は時間を持たない**こと。親ロット1本をスリットする1回の作業なので、
      タイムラインの長さを決めるのは親の見積だけ。子に時間があると
      分割ありのロットだけ予定終了が子の数だけ後ろへ伸びる
    - 既定で畳まれていて、つまみで開けること（開閉が残ること）
    - 子は並べ替えの行として数えないこと（サーバーは親だけを受け付ける）
    - 親を消すと子も消えること

   フィクスチャの L9000（親）/ L90001・L90002（子）は
   tests/make_split_fixture.py が作る。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A',PARENT='L9000';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const settle=(ms=700)=>page.waitForTimeout(ms);
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const post=(p,b2)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-scsplit'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:b2||{}});
 const plan=()=>page.evaluate(async e=>{
  const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
  return (await r.json()).entries||[];
 },EQ);
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester');
                          localStorage.removeItem('scChildOpenV1')},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await settle(1500);

  /* ---- 1) 分割ありと判定できる ---- */
  const split=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return {none:true};
   const api=window.WL&&window.WL.split;
   return {has:!!api&&api.hasSplit(row),lots:api?api.childLots(row,lot):[]};
  },PARENT);
  rec('分割ありの親ロットを見つけられる',!split.none&&split.has===true,JSON.stringify(split));
  rec('子ロット番号を復元できる',
      !!split.lots&&split.lots.length===2&&split.lots.includes('L90001')&&split.lots.includes('L90002'),
      JSON.stringify(split.lots));

  /* ---- 2) 予定へ入れると子も一緒に作られる ---- */
  // scheduleモードはまず俯瞰ボードが出る。設備の行を押して個別の
  // タイムラインへ入る(test_screorder.js と同じ手順)。
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:20000});
  await settle(1500);
  const beforeEnd=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
   const es=((await r.json()).entries||[]).filter(x=>x.plannedEnd);
   return es.length?es[es.length-1].plannedEnd:null;
  },EQ);

  const added=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     include_hidden:1,filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return false;
   await window.scheduleAddFromRow(row);
   return true;
  },PARENT);
  rec('分割ありの行を予定へ入れられる',added);
  await settle(3500);

  const entries=await plan();
  const parent=entries.find(e=>e.lotNo===PARENT&&e.parentId==null);
  const kids=entries.filter(e=>parent&&e.parentId===parent.id);
  if(parent)made.push(parent.id);
  rec('親が1件できる',!!parent,parent?`id=${parent.id}`:'なし');
  rec('子ロットも一緒に作られる',kids.length===2,`${kids.length}件`);
  rec('子は親の予定IDにぶら下がる',
      kids.length===2&&kids.every(k=>k.parentId===parent.id),
      JSON.stringify(kids.map(k=>[k.lotNo,k.parentId])));
  rec('子のロット番号が入っている',
      kids.map(k=>k.lotNo).sort().join(',')==='L90001,L90002',
      kids.map(k=>k.lotNo).join(','));
  /* 子ロットの内訳をスナップショットする。幅・公差は仕掛に列があるとき
     だけ入る(フィクスチャは分割の検出に要る列しか持たない。寸法・公差の
     列を足すと既存2000行がNULL=0扱いになり、公差スケールが壊れる。
     tests/make_split_fixture.py の説明を参照)。 */
  rec('子ロットの内訳がスナップショットされる',
      kids.every(k=>k.detail&&k.detail.__childLot===true&&k.detail.__childStrips>0),
      JSON.stringify(kids.map(k=>k.detail&&[k.detail.__childWidth,k.detail.__childStrips])));

  /* ---- 3) 子は時間を持たない（ここが要） ---- */
  rec('子は見積を持たない',kids.every(k=>k.estimate==null),
      JSON.stringify(kids.map(k=>k.estimate)));
  rec('子は親と同じ予定時刻を借りる',
      kids.every(k=>k.plannedStart===parent.plannedStart&&k.plannedEnd===parent.plannedEnd));
  const afterEnd=entries.filter(e=>e.plannedEnd&&e.parentId==null).slice(-1)[0]?.plannedEnd;
  const grew=beforeEnd&&afterEnd?(new Date(afterEnd)-new Date(beforeEnd))/60000:null;
  const est=parent&&parent.estimate?parent.estimate.minutes:0;
  rec('タイムラインは親1件ぶんだけ伸びる（子の数だけ伸びない）',
      grew!=null&&Math.abs(grew-est)<1,`伸び${grew}分 / 親の見積${est}分`);
  rec('子は並べ替えの対象にならない',kids.every(k=>!k.reorderable));

  /* ---- 4) 画面: 既定は折りたたみ ----
     測る前に行を画面内へ入れる。elementFromPointでの重なり確認は
     ビューポート内でしか効かない(外にあると常にnullで「見えない」判定)。 */
  await page.evaluate(id=>{const r=document.querySelector(`.sc-row-line[data-id="${id}"]`);
    if(r)r.scrollIntoView({block:'center'})},parent.id);
  await settle(400);
  const ui=await page.evaluate(id=>{
   const row=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   const box=document.querySelector(`.sc-child-box[data-parent="${id}"]`);
   const btn=row&&row.querySelector('.sc-child-toggle');
   return {row:!!row,box:!!box,hidden:box?box.hidden:null,
           lines:box?box.querySelectorAll('.sc-child-line').length:0,
           btn:btn?btn.textContent.trim():'',
           /* **幅が0でないだけでは「見えている」と言えない**。最初はこれを
              印の欄(overflow:hidden・幅固定)へ入れており、切られて画面には
              出ていないのに幅は正だった。器からはみ出していないか、
              その位置に本当にこの要素があるかまで見る。 */
           btnVisible:(()=>{
            if(!btn)return false;
            const r=btn.getBoundingClientRect(),c=btn.parentElement.getBoundingClientRect();
            if(r.width<=0||r.height<=0)return false;
            if(r.right>c.right+0.5||r.left<c.left-0.5)return false;
            const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
            return !!(top&&(top===btn||btn.contains(top)));
           })(),
           // 子行は .sc-row-line にしない(並べ替えの走査に混ざらないこと)
           childIsRowLine:box?!!box.querySelector('.sc-row-line'):false};
  },(await plan()).find(e=>e.lotNo===PARENT&&e.parentId==null).id);
  rec('親行の下に子ロットのまとまりができる',ui.box&&ui.lines===2,JSON.stringify(ui));
  rec('既定では折りたたまれている',ui.hidden===true,String(ui.hidden));
  rec('件数つきのつまみが出る',/子ロット2/.test(ui.btn)&&ui.btnVisible,ui.btn);
  rec('子行は並べ替えの走査対象に混ざらない',ui.childIsRowLine===false);

  /* ---- 5) 開ける・開閉が残る ---- */
  await page.evaluate(id=>{document.querySelector(`.sc-row-line[data-id="${id}"] .sc-child-toggle`).click()},parent.id);
  await settle(400);
  const opened=await page.evaluate(id=>{
   const box=document.querySelector(`.sc-child-box[data-parent="${id}"]`);
   const first=box.querySelector('.sc-child-line');
   return {hidden:box.hidden,text:first?first.innerText.replace(/\s+/g,' ').trim():'',
           h:first?Math.round(first.getBoundingClientRect().height):0};
  },parent.id);
  rec('つまみで開く',opened.hidden===false,String(opened.hidden));
  // 幅・公差は仕掛に列があるときだけ出る(フィクスチャには無い。上の注記参照)。
  // ここで確かめるのは「ロット番号と内訳が読める形で並ぶ」こと。
  rec('子ロットの番号と内訳が読める',/L9000[12]/.test(opened.text)&&/条/.test(opened.text),opened.text);
  rec('開いた子行に高さがある',opened.h>0,`${opened.h}px`);
  rec('開閉を覚えている',
      await page.evaluate(id=>{try{return JSON.parse(localStorage.getItem('scChildOpenV1')||'[]').includes(String(id))}catch(e){return false}},parent.id));

  /* ---- 6) 並べ替えは親だけ送れば通る ---- */
  const ids=(await plan()).filter(e=>e.reorderable).map(e=>e.id);
  const ro=await post('/api/schedule/plan/reorder',{equipment:EQ,orderedIds:[...ids].reverse()});
  rec('子を含めない並べ替えが通る',ro.status===200,JSON.stringify(ro.body).slice(0,120));
  const after=await plan();
  const pos=Object.fromEntries(after.map((e,i)=>[e.id,i]));
  const kids2=after.filter(e=>e.parentId===parent.id);
  rec('並べ替えても親子が離れない',
      kids2.length===2&&kids2.every(k=>pos[k.id]>pos[parent.id]&&pos[k.id]-pos[parent.id]<=2),
      JSON.stringify([pos[parent.id],...kids2.map(k=>pos[k.id])]));

  /* ---- 7) 親を消すと子も消える ---- */
  const del=await post('/api/schedule/plan/delete',{id:parent.id,equipment:EQ});
  rec('親を削除できる',del.status===200,JSON.stringify(del.body));
  const after2=await plan();
  rec('子も一緒に消える',!after2.some(e=>e.parentId===parent.id||e.lotNo==='L90001'),
      after2.filter(e=>String(e.lotNo).startsWith('L9000')).map(e=>e.lotNo).join(','));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 後片付けは process.exit より前に呼ぶこと(exitで即終了しfinallyは走らない)。 */
 async function cleanup(){
  try{
   for(const id of made)await post('/api/schedule/plan/delete',{id,equipment:EQ});
   await setMode('edit');
  }catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
