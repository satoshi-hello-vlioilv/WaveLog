/* test_scsubtotal.js: 作業スケジュールの小計（§9.493、利用者の指示）
   ------------------------------------------------------------
   「日単位または直単位でまとめ機能はありますが、それと同じように、でも独立して集計を
    まとめて小計として指定した単位ごとに行またはラベルとして出すようにしたいです。
    作業ロット数、指定した項目列の合計値（例えば重量）など…ONOFFの機能も実装お願いします。」

   物差し（前後で数える）:
    1. 既定は切 … 小計の器は0個
    2. 入れると区切りごとに1つ … 作業ロット数・選んだ列の合計（桁区切り`,`も読む）
    3. 数として読めない値は足さずに**件数を言う**（0として足さない）
    4. 「行」は合計が**足した列の真下**（見出しのセルと左端が2px以内）
    5. 「ラベル」は1行の帯で、どの列の合計かを字で添える
    6. まとめとは**別の軸**（まとめを変えても小計は残り、小計を触ってもまとめは変わらない）
    7. 切に戻すと0個・並べ替えの行（`.sc-row-line`）の数は小計で変わらない
    8. 再読み込みしても設定が残る（この端末・設備ごと）

   材料は自分で作る: 同じ`mfgTemper`（区切りの列）を持つ作業3件。`mfgMaterial`へ
   「1,200」「800.5」「abc」を入れ、合計は 2,000.5・読めない1件。 */
const H=require('./lib/harness.js');
const TAG='ST'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;
const USER='test-scsubtotal';

H.run('test_scsubtotal: 作業スケジュールの小計（§9.493）',async({page,rec,B,W,idle,errs})=>{
 const post=(path,body)=>fetch(B+path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:USER},body))}).then(r=>r.json().catch(()=>({})));
 const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))
   .then(r=>r.json()).then(j=>j.entries||[]);
 const layout0=await H.snapLayout(TARGET);
 try{
  const lots=[[TAG+'A','1,200'],[TAG+'B','800.5'],[TAG+'C','abc']];
  for(const [lot,w] of lots)
   await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot,
     detail:{lotNo:lot,mfgMaterial:w,mfgTemper:TAG}});
  const es=await W.poll(plan,x=>lots.every(([n])=>x.some(e=>e.lotNo===n)),20000);
  rec('材料の予定を3件作れた',lots.every(([n])=>es.some(e=>e.lotNo===n)),
      es.filter(e=>String(e.lotNo||'').startsWith(TAG)).length+'件');
  await post('/api/column-layout-master',{target:TARGET,clear:true,
    order:['__cat__','lotNo','mfgMaterial','mfgTemper','__est__','__actions__'],hidden:[],widths:{},names:{},
    formats:{},rules:{},formulas:{},locks:[],sorts:{}});

  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  await page.waitForFunction(t=>[...document.querySelectorAll('.sc-row-line')].some(r=>r.textContent.includes(t+'C')),TAG,{timeout:20000});
  await idle();

  const snap=()=>page.evaluate(t=>{
   const all=[...document.querySelectorAll('#scTimeline .sc-subtotal')];
   const mine=all.find(el=>el.dataset.unit===t);
   const sum=mine&&mine.querySelector('.sc-subtotal-sum[data-col="mfgMaterial"]');
   const head=document.querySelector('.sc-row-head [data-col="mfgMaterial"]');
   return {n:all.length,rows:document.querySelectorAll('#scTimeline .sc-row-line').length,
    count:mine?+mine.dataset.count:null,label:!!mine&&mine.classList.contains('is-label'),
    text:mine?mine.textContent.replace(/\s+/g,' ').trim():'',
    sum:sum?sum.textContent.trim():null,sumTitle:sum?sum.getAttribute('title')||'':'',
    dx:(sum&&head&&!mine.classList.contains('is-label'))?Math.round(Math.abs(sum.getBoundingClientRect().left-head.getBoundingClientRect().left)):null,
    after:!!mine&&(()=>{  // 小計の直前の行が区切りの最後の行（C）か
     const before=[...document.querySelectorAll('#scTimeline .sc-row-line')]
       .filter(r=>r.compareDocumentPosition(mine)&Node.DOCUMENT_POSITION_FOLLOWING);
     const last=before[before.length-1];
     return !!last&&last.textContent.includes(t+'C');
    })(),
    group:WL.scheduleView&&WL.scheduleView.groupModeLabel?WL.scheduleView.groupModeLabel():''};
  },TAG);

  // ---- 1. 既定は切 ---------------------------------------------------
  const s0=await snap();
  rec('既定は切（小計の器は0個）',s0.n===0,`小計${s0.n}個・行${s0.rows}本`);

  // ---- 2. 「表示」から入れる（人と同じ道） ----------------------------
  await page.click('#scViewMenuBtn');
  await page.waitForSelector('#scSubtotalCtl [data-st-on="1"]',{state:'visible',timeout:8000});
  await page.click('#scSubtotalCtl [data-st-on="1"]');
  await page.selectOption('#scSubtotalUnit','col');
  await page.selectOption('#scSubtotalUnitCol','mfgTemper');
  await page.waitForSelector('#scSubtotalMore [data-st-col="mfgMaterial"]',{state:'visible',timeout:8000});
  const chip=await page.evaluate(()=>{const b=document.querySelector('#scSubtotalMore [data-st-col="mfgMaterial"]');
   return {dis:b.disabled,txt:b.textContent.trim(),title:b.title,
     never:[...document.querySelectorAll('#scSubtotalMore [data-st-col]')].map(x=>x.dataset.stCol).filter(k=>/^__(cat|date|actions)__$/.test(k))}});
  rec('列の札に「数として読める件数」を添える（推測させない）',!chip.dis&&/\d+\/\d+/.test(chip.txt),JSON.stringify(chip));
  rec('足せない列（区分・日付・操作）は札に出さない',chip.never.length===0,chip.never.join('/')||'なし');
  await page.click('#scSubtotalMore [data-st-col="mfgMaterial"]');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   return !!el&&!!el.querySelector('.sc-subtotal-sum[data-col="mfgMaterial"]')},TAG,{ms:8000,what:'小計の合計のセル'});
  const s1=await snap();
  /* 目で確かめるための写真。**指定があるときだけ**撮る（§9.432）。 */
  const shot=async n=>{if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/scsubtotal-${n}.png`})};
  await shot('row-panel');
  if(process.env.WAVELOG_SHOT){
   await page.click('#scViewMenuBtn');
   await page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);if(el)el.scrollIntoView({block:'center'})},TAG);
   await shot('row');
   await page.click('#scViewMenuBtn');
  }
  rec('入れると区切りごとに小計が出る（作業ロット数＝3）',s1.n>0&&s1.count===3,`小計${s1.n}個・この区切り${s1.count}ロット`);
  rec('小計は区切りの最後の行（C）の後ろ',s1.after===true,String(s1.after));
  rec('合計は桁区切りも読む（1,200＋800.5＝2,000.5）',s1.sum==='2,000.5*'||s1.sum==='2,000.5',JSON.stringify(s1.sum));
  rec('読めない値は足さずに件数を言う（abc の1件）',/読めない.*1件/.test(s1.sumTitle)&&/\*$/.test(s1.sum||''),s1.sumTitle.replace(/\n/g,' / '));
  rec('「行」は合計が足した列の真下（左端の差2px以内）',s1.dx!==null&&s1.dx<=2,`差${s1.dx}px`);
  rec('並べ替えの行の数は小計で変わらない',s1.rows===s0.rows,`${s0.rows}→${s1.rows}`);
  const bar=await page.evaluate(()=>(document.getElementById('scViewState')||{}).textContent||'');
  rec('畳んだ入口に「小計」の設定が出る（思い出させない）',/小計/.test(bar),bar);

  // ---- 5. ラベル ------------------------------------------------------
  await page.click('#scSubtotalMore [data-st-style="label"]');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);return !!el&&el.classList.contains('is-label')},TAG,{ms:8000,what:'ラベルの小計'});
  const s2=await snap();
  if(process.env.WAVELOG_SHOT){
   await page.click('#scViewMenuBtn');
   await shot('label');
   await page.click('#scViewMenuBtn');
  }
  rec('「ラベル」は1行の帯で、列名と合計と件数を字で出す',s2.label&&/3ロット/.test(s2.text)&&/2,000\.5/.test(s2.text)&&s2.text.includes('mfgMaterial')===false,s2.text);

  // ---- 6. まとめとは別の軸 --------------------------------------------
  const g0=s2.group;
  await page.selectOption('#scGroupSelect','category');
  await idle();
  const s3=await snap();
  rec('まとめを変えても小計は残る（別の軸）',s3.count===3,`まとめ=${s3.group}・この区切り${s3.count}ロット`);
  rec('小計を触ってもまとめは変わっていなかった（まとめない のまま）',g0==='まとめない',`${g0}→${s3.group}`);
  await page.selectOption('#scGroupSelect','none');

  // ---- 8. 再読み込みしても残る ----------------------------------------
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  await W.until(page,t=>[...document.querySelectorAll('.sc-subtotal')].some(x=>x.dataset.unit===t),TAG,{ms:15000,what:'読み直した後の小計'});
  const s4=await snap();
  rec('再読み込みしても設定が残る（この端末・設備ごと）',s4.count===3&&s4.label,JSON.stringify({count:s4.count,label:s4.label}));

  // ---- 7. 切に戻す ----------------------------------------------------
  await page.click('#scViewMenuBtn');
  await page.waitForSelector('#scSubtotalCtl [data-st-on="0"]',{state:'visible',timeout:8000});
  await page.click('#scSubtotalCtl [data-st-on="0"]');
  await W.until(page,()=>!document.querySelector('.sc-subtotal'),null,{ms:8000,what:'小計が消える'});
  const s5=await snap();
  const more=await page.evaluate(()=>document.getElementById('scSubtotalMore').hidden);
  rec('切に戻すと小計は0個・出し方と列の札も畳む',s5.n===0&&more,`小計${s5.n}個・畳み${more}`);
  rec('画面の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.stack||e));
 }finally{
  try{
   for(const e of await plan())
    if(String(e.lotNo||'').startsWith(TAG))await post('/api/schedule/plan/delete',{id:e.id});
  }catch(_){/* 片付けの失敗は次の実行が開始時に戻す（ランナーの reseed） */}
  try{await H.restoreLayout(TARGET,layout0,USER)}catch(_){/* 片付けの失敗は次の実行が開始時に戻す（ランナーの restore_master） */}
 }
},{mode:'schedule',viewport:{width:1700,height:1000}});
