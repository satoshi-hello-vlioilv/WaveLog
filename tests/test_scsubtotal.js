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
    formats:{},rules:{},formulas:{},locks:[],sorts:{},
    /* 集計する列は**右揃え**にしておく（数値の列の既定。§9.499の器を右隣まで広げた形で、揃えが器ぜんたいに
       効いて値が表の右端へ寄っていた——左揃えの列だけでは見つからない）。 */
    aligns:{mfgMaterial:{data:'right',head:''}}});

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
    /* 右揃えの列: 小計の値の右端と、ふつうの行の同じ列の値の右端の差（字の右端を Range で測る）。 */
    rx:(()=>{
     if(!sum||mine.classList.contains('is-label'))return null;
     const row=[...document.querySelectorAll('#scTimeline .sc-row-line')].find(r=>r.textContent.includes(t+'A'));
     const c=row&&row.querySelector('[data-col="mfgMaterial"]');
     if(!c)return null;
     const rg=document.createRange();rg.selectNodeContents(c);
     return Math.round(sum.getBoundingClientRect().right-rg.getBoundingClientRect().right);
    })(),
    after:!!mine&&(()=>{  // 小計の直前の行が区切りの最後の行（C）か
     const before=[...document.querySelectorAll('#scTimeline .sc-row-line')]
       .filter(r=>r.compareDocumentPosition(mine)&Node.DOCUMENT_POSITION_FOLLOWING);
     const last=before[before.length-1];
     return !!last&&last.textContent.includes(t+'C');
    })(),
    group:WL.scheduleView&&WL.scheduleView.groupModeLabel?WL.scheduleView.groupModeLabel():''};
  },TAG);

  /* 小計の設定は「表示」→「Σ 小計」の畳む段の中（§9.500）。人と同じ道で開く。 */
  const openSt=async()=>{
   if(await page.evaluate(()=>document.getElementById('scViewPop').hidden))await page.click('#scViewMenuBtn');
   if(await page.evaluate(()=>document.getElementById('scSubtotalPop').hidden))await page.click('#scSubtotalBtn');
   await page.waitForSelector('#scSubtotalCtl [data-st-on]',{state:'visible',timeout:8000});
  };
  // ---- 1. 既定は切 ---------------------------------------------------
  const s0=await snap();
  rec('既定は切（小計の器は0個）',s0.n===0,`小計${s0.n}個・行${s0.rows}本`);

  // ---- 2. 「表示」から入れる（人と同じ道） ----------------------------
  await openSt();
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
  console.log('#MEASURE '+JSON.stringify({rightAlignedGapPx:s1.rx}));
  rec('右揃えの列: 小計の値の右端はふつうの行の値の右端とそろう（差2px以内。前は器の右端＝表の右端へ寄っていた）',
      s1.rx!==null&&Math.abs(s1.rx)<=2,`差${s1.rx}px`);
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
  await openSt();
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
   return {parts:cell?cell.querySelectorAll('.sc-subtotal-sum[data-col]').length:0,tags:cell?[...cell.querySelectorAll('.sc-subtotal-sum[data-col] small')].map(x=>x.textContent):[],
     calcLast:!!cell&&(()=>{const box=cell.querySelector('.sc-st-in')||cell;return !!box.lastElementChild&&!box.lastElementChild.hasAttribute('data-col')})(),
     /* 列の幅に入らないときは**列の左端から**並べる（右揃えのまま押し出すと左の列へはみ出して切れる）。 */
     leftCut:cell?Math.round(cell.getBoundingClientRect().left-cell.querySelector('.sc-subtotal-sum').getBoundingClientRect().left):null,
     dx:cell&&head?Math.round(Math.abs(cell.getBoundingClientRect().left-head.getBoundingClientRect().left)):null}},TAG);
  rec('「行」では同じ列の集計が列の真下の器から名つきで並び、式は最後の器の後ろ（§9.498・§9.499）',
      rowv.parts===5&&rowv.tags.join(',')==='合計,平均,最大,最小,件数'&&rowv.calcLast&&rowv.dx!==null&&rowv.dx<=2,JSON.stringify(rowv));
  rec('右揃えの列でも、列の幅に入らない集計は器の左端から並ぶ（左へはみ出さない）',rowv.leftCut!==null&&rowv.leftCut<=0,`はみ出し${rowv.leftCut}px`);
  /* **1行に収める**（§9.499、利用者の指示「行に出すパターンもコンパクトに、すべて1行で納めた形に」）。
     物差し: 小計の行の高さ＝ふつうの行の高さ／字が切れている部品の数＝0（名前・ロット数・集計・式）。 */
  const fit=await page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   const line=document.querySelector('#scTimeline .sc-row-line');
   const cut=[...el.querySelectorAll('.sc-subtotal-name,.sc-subtotal-count,.sc-subtotal-sum')].filter(x=>x.scrollWidth>x.clientWidth+1||
     (x.getBoundingClientRect().right>x.closest('.sc-subtotal-head,.sc-subtotal-cell').getBoundingClientRect().right+1)).map(x=>x.textContent.trim().slice(0,14));
   return {h:Math.round(el.getBoundingClientRect().height),row:Math.round(line.getBoundingClientRect().height),cut}},TAG);
  rec('「行」の小計は1行（高さ＝ふつうの行）（§9.499）',Math.abs(fit.h-fit.row)<=1,`小計${fit.h}px／行${fit.row}px`);
  rec('「行」の小計で字が切れている部品は0（§9.499）',fit.cut.length===0,`${fit.cut.length}件 ${JSON.stringify(fit.cut)}`);
  // 10) 設定の画面の物差し（§9.500、利用者の指示「小計の表示設定については使いづらいので、UIを再構築し…」）
  const ui=await page.evaluate(()=>{
   const pop=document.getElementById('scViewPop');
   const sec=document.getElementById('scViewAccSubtotal')||document.getElementById('scSubtotalRange');
   const names=[...sec.querySelectorAll('.sc-st-step-name,.sc-view-row-name,.sc-subtotal-more-name')].map(x=>x.firstChild&&x.firstChild.textContent.trim()).filter(Boolean);
   const head=sec.querySelector('.sc-st-thead');
   const heads=head?[...head.children].map(x=>x.textContent.trim()):[];
   const row=sec.querySelector('.sc-st-item[data-i="0"]');
   const fields=row?[...row.querySelectorAll('[data-st-f]')].length:0;
   const cols=head&&row?[...head.children].slice(0,5).map((h,i)=>{const c=row.children[i];return c?Math.round(Math.abs(h.getBoundingClientRect().left-c.getBoundingClientRect().left)):99}):[];
   const prev=sec.querySelector('.sc-st-item[data-i="0"] .sc-st-prev');
   return {order:names,heads,fields,cols,preview:prev?prev.textContent.trim():null,
     height:Math.round(sec.getBoundingClientRect().height),popH:Math.round(pop.scrollHeight)};
  });
  console.log('#UI '+JSON.stringify(ui));
  /* 並びは**前後関係**で見る（顔ぶれを丸ごと固定しない・testing.md）。出す→区切り→集計の項目→見せる物（最後）。 */
  const at=n=>ui.order.indexOf(n);
  rec('設定: 節は決める順（出すが先頭・区切り→集計の項目・見せる物が最後）（§9.500・§9.503）',
      at('出す')===0&&at('区切り')>0&&at('区切り')<at('集計の項目')&&at('見せる物')===ui.order.length-1,JSON.stringify(ui.order));
  rec('設定: 集計の項目の欄はどれも見出しを持つ（§9.500）',ui.heads.length>=ui.fields&&ui.fields>0,`見出し${ui.heads.length}・欄${ui.fields} ${JSON.stringify(ui.heads)}`);
  rec('設定: 見出しと欄の左端がそろう（§9.500）',ui.cols.length===5&&ui.cols.every(d=>d<=1),JSON.stringify(ui.cols));
  rec('設定: 見本の値が設定の中で見える（§9.500）',ui.preview==='2,001kg*',JSON.stringify(ui.preview));
  /* 畳んだときの高さ（「表示」の中で小計が占める場所）。見出しにいまの状態を書く（思い出させない）。 */
  await page.click('#scSubtotalBtn');
  const shut=await page.evaluate(()=>({h:Math.round(document.getElementById('scViewAccSubtotal').getBoundingClientRect().height),
    state:(document.getElementById('scSubtotalState')||{}).textContent||''}));
  console.log('#UI-SHUT '+JSON.stringify(shut));
  rec('設定: 畳めば「表示」の中は1行・見出しにいまの状態（§9.500）',shut.h<=60&&/項目/.test(shut.state),JSON.stringify(shut));
  await page.click('#scSubtotalBtn');
  // 9c'') 単位だけ決めて桁は「自動」——桁は材料なり（合計＝材料の桁・式＝2桁まで）。前は浮動小数の誤差がそのまま出ていた
  await openSt();
  await page.selectOption(calc+' [data-st-f="dec"]','');
  await page.selectOption(first+' [data-st-f="dec"]','');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   const v=el&&el.querySelector('.sc-subtotal-sum[data-item] .sc-st-v');return !!v&&!/^2,001kg/.test(v.textContent.trim())},TAG,{ms:8000,what:'桁を自動へ戻した小計'});
  const m2=await valsFull();
  const want2=['2,000.5kg*','666.83kg'];
  console.log('#MEASURE '+JSON.stringify({unitOnly:m2&&[m2[0].v,m2[5].v]}));
  rec('単位だけ決めて桁は自動なら、桁は材料なり（合計＝材料の桁・式＝2桁まで）（§9.498 ③）',
      !!m2&&JSON.stringify([m2[0].v,m2[5].v])===JSON.stringify(want2),JSON.stringify(m2&&[m2[0].v,m2[5].v])+' 期待 '+JSON.stringify(want2));
  // 9d) 書けない式は画面にそう言い、小計は「—」
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/(');
  const bad=await page.evaluate(s=>{const r=document.querySelector(s);const n=r&&r.querySelector('.sc-st-err');return n?n.textContent.trim():''},calc);
  rec('書けない式はその場で理由を言う（§9.498）',!!bad,bad);
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/[ロット数]');
  // 9e) 無い名前を引く式も、その場で理由を言い、小計は「—」（§9.498の追補）。前は無い名前が空として通り、
  //     `+`では片方だけの値（ここでは [ロット数] の 3）が合計のように出ていた。
  await put(calc+' [data-st-f="expr"]','[重量 合計]+[ロット数]');
  await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   return !!el&&el.querySelectorAll('.sc-subtotal-sum[data-item]').length===6},TAG,{ms:8000,what:'式を書き換えた小計'});
  const unk=await page.evaluate(([s,t])=>{const r=document.querySelector(s);const n=r&&r.querySelector('.sc-st-err');
   const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   const v=el&&[...el.querySelectorAll('.sc-subtotal-sum[data-item]')].pop();
   return {err:n?n.textContent.trim():'',val:v?(v.querySelector('.sc-st-v')||v).textContent.trim():null,bad:!!v&&v.classList.contains('is-bad'),title:v?v.title:''}},[calc,TAG]);
  console.log('#MEASURE '+JSON.stringify({unknownName:unk}));
  rec('無い名前を引く式はその場で理由を言う（名前を出す）（§9.498の追補）',/重量 合計/.test(unk.err),JSON.stringify(unk));
  rec('無い名前を引く式の小計は「—」で、理由を title で言う（片方だけの値を合計のように出さない）（§9.498の追補）',
      unk.val==='—'&&unk.bad&&/重量 合計/.test(unk.title),JSON.stringify(unk));
  await put(calc+' [data-st-f="expr"]','[製造材質 合計]/[ロット数]');
  /* 9f) 集計した値に計算を続けて当てる（利用者の指示「合計するだけでなく÷1000×0.8といったような計算も
     セットで行えるように」）。書いたとおり（÷×・頭が演算子＝集計した値へ続ける）でも、[値] を使っても同じ答え。
     式の項目はその結果を [名前] で引く。 */
  const hasPost=await page.evaluate(s=>!!document.querySelector(s),first+' [data-st-f="expr"]');
  const firstVal=()=>page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   const v=el&&el.querySelectorAll('.sc-subtotal-sum[data-item]');return v?[...v].map(x=>(x.querySelector('.sc-st-v')||x).textContent.trim()):[]},TAG);
  let pf={has:hasPost};
  if(hasPost){
   await put(first+' [data-st-f="suffix"]','t');
   await put(first+' [data-st-f="expr"]','÷1000×0.8');
   await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
    const v=el&&el.querySelector('.sc-subtotal-sum[data-item] .sc-st-v');return !!v&&/t/.test(v.textContent)&&!/2,000/.test(v.textContent)},TAG,{ms:8000,what:'計算を当てた合計'});
   pf.typed=await firstVal();
   await put(first+' [data-st-f="expr"]','[値]/1000*0.8');
   pf.named=await firstVal();
   await put(first+' [data-st-f="expr"]','÷');
   pf.bad=await page.evaluate(s=>{const n=document.querySelector(s+' .sc-st-err');return n?n.textContent.trim():''},first);
   await put(first+' [data-st-f="expr"]','');
   await put(first+' [data-st-f="suffix"]','kg');
  }
  console.log('#MEASURE '+JSON.stringify({postFormula:pf}));
  rec('集計した値に計算を続けられる（÷1000×0.8 → 2,000.5 が 1.6t。書いたとおりで効く）',
      hasPost&&pf.typed[0]==='1.6t*',JSON.stringify(pf));
  rec('[値] を使っても同じ答え。式の項目はその結果を [名前] で引く（1.6004÷3＝0.53）',
      hasPost&&pf.named[0]==='1.6t*'&&pf.named[5]==='0.53kg',JSON.stringify(pf.named));
  rec('書けない計算はその場で理由を言う',hasPost&&!!pf.bad,JSON.stringify(pf.bad));
  /* 9g) 見せる物はどれも入切できる（利用者の指示「小計の表示から日付やロット数などもすべて、表示ONOFFできるように」）。
     「小計」の札・区切りの名前・ロット数と、項目ごとの「出す」。隠した項目も式の材料にはなる。 */
  const parts=()=>page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
   return el?{tag:!!el.querySelector('.sc-subtotal-tag'),name:!!el.querySelector('.sc-subtotal-name'),count:!!el.querySelector('.sc-subtotal-count'),
    items:[...el.querySelectorAll('.sc-subtotal-sum[data-item]')].map(x=>x.dataset.item)}:null},TAG);
  const hasShow=await page.evaluate(()=>!!document.querySelector('#scSubtotalMore [data-st-show="tag"]'));
  const sh={has:hasShow,before:await parts()};
  if(hasShow){
   for(const k of ['tag','name','count'])await page.click(`#scSubtotalMore [data-st-show="${k}"]`);
   await page.click('#scSubtotalMore .sc-st-item[data-i="1"] [data-st-f="show"]');
   await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
    return !!el&&!el.querySelector('.sc-subtotal-tag')&&!el.querySelector('[data-item="i2"]')},TAG,{ms:8000,what:'隠した小計'});
   sh.after=await parts();
   for(const k of ['tag','name','count'])await page.click(`#scSubtotalMore [data-st-show="${k}"]`);
   await page.click('#scSubtotalMore .sc-st-item[data-i="1"] [data-st-f="show"]');
   await W.until(page,t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);
    return !!el&&!!el.querySelector('.sc-subtotal-tag')&&!!el.querySelector('[data-item="i2"]')},TAG,{ms:8000,what:'戻した小計'});
   sh.back=await parts();
  }
  console.log('#MEASURE '+JSON.stringify({show:sh}));
  rec('「小計」の札・区切りの名前・ロット数を隠せる（利用者の指示④）',
      hasShow&&!!sh.after&&!sh.after.tag&&!sh.after.name&&!sh.after.count,JSON.stringify(sh));
  rec('項目ごとに隠せる（平均だけ消え、ほかは残る）。戻すと元どおり',
      hasShow&&!!sh.after&&!sh.after.items.includes('i2')&&sh.after.items.length===sh.before.items.length-1
      &&JSON.stringify(sh.back)===JSON.stringify(sh.before),JSON.stringify(sh));
  if(process.env.WAVELOG_SHOT){await page.screenshot({path:`${process.env.WAVELOG_SHOT}/scsubtotal-multi-panel.png`})}
  await page.click('#scViewMenuBtn');
  if(process.env.WAVELOG_SHOT){
   await page.evaluate(t=>{const el=[...document.querySelectorAll('.sc-subtotal')].find(x=>x.dataset.unit===t);if(el)el.scrollIntoView({block:'center'})},TAG);
   await page.screenshot({path:`${process.env.WAVELOG_SHOT}/scsubtotal-multi-label.png`});
  }

  // ---- 7. 切に戻す ----------------------------------------------------
  await openSt();
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
