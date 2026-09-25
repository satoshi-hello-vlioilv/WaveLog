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
   const sum=mine&&mine.querySelector('.sc-subtotal-sum[data-col="mfgMaterial"] .sc-st-v');
   const cell=mine&&(mine.querySelector('.sc-subtotal-cell[data-col="mfgMaterial"]')||mine.querySelector('.sc-subtotal-sum[data-col="mfgMaterial"]'));
   const head=document.querySelector('.sc-row-head [data-col="mfgMaterial"]');
   return {n:all.length,rows:document.querySelectorAll('#scTimeline .sc-row-line').length,
    count:mine?+mine.dataset.count:null,label:!!mine&&mine.classList.contains('is-label'),
    text:mine?mine.textContent.replace(/\s+/g,' ').trim():'',
    sum:sum?sum.textContent.trim():null,sumTitle:sum?(sum.closest('.sc-subtotal-sum').getAttribute('title')||''):'',
    dx:(cell&&head&&!mine.classList.contains('is-label'))?Math.round(Math.abs(cell.getBoundingClientRect().left-head.getBoundingClientRect().left)):null,
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
  /* 集計の項目を足す（§9.498で「合計する列」の札から「集計の項目」の一覧へ）。列の選択肢は
     数として読める件数を添え、足せない列（区分・日付・操作）は出さない。 */
  await page.waitForSelector('#scSubtotalAddAgg',{state:'visible',timeout:8000});
  await page.click('#scSubtotalAddAgg');
  await page.waitForSelector('#scSubtotalMore .sc-st-item[data-i="0"] [data-st-f="col"]',{state:'visible',timeout:8000});
  await page.selectOption('#scSubtotalMore .sc-st-item[data-i="0"] [data-st-f="col"]','mfgMaterial');
  const chip=await page.evaluate(()=>{const s=document.querySelector('#scSubtotalMore .sc-st-item[data-i="0"] [data-st-f="col"]');
   const o=[...s.options].find(x=>x.value==='mfgMaterial');
   return {txt:o?o.textContent.trim():'',
     never:[...s.options].map(x=>x.value).filter(k=>/^__(cat|date|actions)__$/.test(k))}});
  rec('列の選択肢に「数として読める件数」を添える（推測させない）',/\d+\/\d+/.test(chip.txt),JSON.stringify(chip));
  rec('足せない列（区分・日付・操作）は選択肢に出さない',chip.never.length===0,chip.never.join('/')||'なし');
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

  // ---- 9. 集計を複数の種類で・式・書式（§9.498、利用者の指示） ----------
  // 「小計機能を項目複数でも対応できるように。また数値の計算の場合、計算式を組んだり、
  //  書式を設定して数値の桁数や単位の設定ができるようにしてください」（項目複数＝集計の種類・利用者に確認）
  const valsFull=()=>page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   return el?[...el.querySelectorAll('.sc-subtotal-sum[data-item]')].map(x=>({v:(x.querySelector('.sc-st-v')||x).textContent.trim(),t:x.title})):null},TAG);
  // 9a) いままでの保存（合計する列）は読むときに「合計」の項目へ読み替える
  await page.evaluate(eq=>localStorage.setItem('ScheduleSubtotalV1',JSON.stringify({[eq]:
    {on:true,unit:'col',unitCol:'mfgTemper',style:'label',cols:['mfgMaterial']}})),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  await W.until(page,t=>[...document.querySelectorAll('.sc-subtotal')].some(x=>x.dataset.unit===t),TAG,{ms:15000,what:'読み替えた小計'});
  const m0=await valsFull();
  rec('いままでの保存（合計する列）はそのまま効く（§9.498）',!!m0&&m0.length===1&&m0[0].v==='2,000.5*',JSON.stringify(m0));
  // 9b) 同じ列で平均・最大・最小・件数を足す（押すたびに「まだ使っていない集計」）
  await page.click('#scViewMenuBtn');
  await page.waitForSelector('#scSubtotalAddAgg',{state:'visible',timeout:8000});
  for(let i=0;i<4;i++){
   await page.click('#scSubtotalAddAgg');
   await page.waitForSelector(`#scSubtotalMore .sc-st-item[data-i="${i+1}"]`,{state:'visible',timeout:8000});
  }
  const aggs=await page.evaluate(()=>[...document.querySelectorAll('#scSubtotalMore .sc-st-item')].map(r=>{
   const c=r.querySelector('[data-st-f="col"]'),a=r.querySelector('[data-st-f="agg"]');return (c?c.value:'')+':'+(a?a.value:'')}));
  rec('「列を集計」を押すと同じ列のまだ使っていない集計が足される（§9.498）',
      JSON.stringify(aggs)===JSON.stringify(['mfgMaterial:sum','mfgMaterial:avg','mfgMaterial:max','mfgMaterial:min','mfgMaterial:count']),JSON.stringify(aggs));
  // 9c) 式の項目（ほかの項目を[名前]で）と書式（桁・単位）
  await page.click('#scSubtotalAddCalc');
  const calc='#scSubtotalMore .sc-st-item[data-i="5"]';
  await page.waitForSelector(calc+' [data-st-f="expr"]',{state:'visible',timeout:8000});
  const put=async(sel,v)=>{const l=page.locator(sel);await l.fill(v);await l.dispatchEvent('change');
   await page.waitForFunction(([s,v])=>{const e=document.querySelector(s);return !!e&&e.value===v},[sel,v],{timeout:8000})};
  await put(calc+' [data-st-f="label"]','1ロットあたり');
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/[ロット数]');
  await page.selectOption(calc+' [data-st-f="dec"]','2');
  await put(calc+' [data-st-f="suffix"]','kg');
  const first='#scSubtotalMore .sc-st-item[data-i="0"]';
  await page.selectOption(first+' [data-st-f="dec"]','0');
  await put(first+' [data-st-f="suffix"]','kg');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   return !!el&&el.querySelectorAll('.sc-subtotal-sum[data-item]').length===6&&/kg/.test(el.textContent)},TAG,{ms:8000,what:'6項目の小計'});
  const m1=await valsFull();
  const want=['2,001kg*','1,000.25*','1,200.0*','800.5*','2','666.83kg'];
  rec('合計・平均・最大・最小・件数・式が並ぶ（書式: 桁0＋kg／式は桁2＋kg）（§9.498）',
      !!m1&&JSON.stringify(m1.map(x=>x.v))===JSON.stringify(want),JSON.stringify(m1&&m1.map(x=>x.v))+' 期待 '+JSON.stringify(want));
  rec('式の項目は式と材料を title で言う（§9.498）',!!m1&&m1[5]&&/\[製造材質 合計\]\/\[ロット数\]/.test(m1[5].t),m1&&m1[5]&&m1[5].t);
  // 9c') 「行」では同じ列の集計は列の真下の1つの器に集計の名つきで並び、式は名前の後ろ
  await page.click('#scSubtotalMore [data-st-style="row"]');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);return !!el&&!el.classList.contains('is-label')},TAG,{ms:8000,what:'行の小計'});
  const rowv=await page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   const cell=el.querySelector('.sc-subtotal-cell[data-col="mfgMaterial"]');
   const head=document.querySelector('.sc-row-head [data-col="mfgMaterial"]');
   return {parts:cell?cell.querySelectorAll('.sc-subtotal-sum').length:0,tags:cell?[...cell.querySelectorAll('small')].map(x=>x.textContent):[],
     calcInHead:!!el.querySelector('.sc-subtotal-head .sc-subtotal-sum[data-item]'),
     dx:cell&&head?Math.round(Math.abs(cell.getBoundingClientRect().left-head.getBoundingClientRect().left)):null}},TAG);
  rec('「行」では同じ列の集計が列の真下の器に名つきで並び、式は名前の後ろ（§9.498）',
      rowv.parts===5&&rowv.tags.join(',')==='合計,平均,最大,最小,件数'&&rowv.calcInHead&&rowv.dx!==null&&rowv.dx<=2,JSON.stringify(rowv));
  // 9d) 書けない式は画面にそう言い、小計は「—」
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/(');
  const bad=await page.evaluate(s=>{const r=document.querySelector(s);const n=r&&r.querySelector('.sc-st-err');return n?n.textContent.trim():''},calc);
  rec('書けない式はその場で理由を言う（§9.498）',!!bad,bad);
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/[ロット数]');
  if(process.env.WAVELOG_SHOT){await page.screenshot({path:`${process.env.WAVELOG_SHOT}/scsubtotal-multi-panel.png`})}
  await page.click('#scViewMenuBtn');
  if(process.env.WAVELOG_SHOT){
   await page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);if(el)el.scrollIntoView({block:'center'})},TAG);
   await page.screenshot({path:`${process.env.WAVELOG_SHOT}/scsubtotal-multi-label.png`});
  }

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
