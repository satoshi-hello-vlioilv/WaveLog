/* test_stopflow.js: 設備停止を入れる手順「内容 →（内訳）→ 時間」（§9.389）
   ------------------------------------------------------------
   利用者の指示「設備停止内容(サブカテゴリがある設備停止はそのあとサブカテゴリも
   選択)を選択し、その後時間を選択して登録するようにしたいです」
   「登録時には、**選択肢＋スライダー**で時間を変更して登録もできる」

   固定すること:
    1. 内訳を持つ停止では**段が2つ**（①内訳 ②時間）になり、内訳を選ぶまで
       **追加できない**（押せないボタンには理由を書く）
    2. 内訳を選ぶと、**その内訳の標準所要分**が時間として選ばれる
    3. 時間は**選択肢**でも**スライダー**でも決められる（手で触ったら、
       内訳を選び直しても勝手に戻さない）
    4. 追加すると **[予定名称]は停止内容の名前のまま**で、内訳は明細に入る
       （＝集計は名称で束ねたまま、内訳で割れる・利用者の狙いそのもの）
    5. 予定の行に**内訳の札**が出る（題名は名前のまま）
    6. やめて一覧へ戻れる（手順に閉じ込めない）  */
const H=require('./lib/harness.js');
const W=require('./lib/wait.js');
const TAG='FLW'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
const SNAP=['設備停止マスタ','設備停止サブカテゴリマスタ','設備停止時間マスタ','設備停止分類マスタ'];

H.run('test_stopflow: 設備停止を入れる手順（§9.389）',async({page,rec,B,W:WW,idle,setMode})=>{
 const snap=await H.masterSnapshot(SNAP);
 const api=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,a.body?{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-stopflow'},a.body))}:undefined);
  let j={};try{j=await r.json()}catch(e){j={}}
  return j;
 },{path,body});
 const plan=()=>fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))
   .then(r=>r.json()).then(j=>j.entries||[]);

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await WW.booted(page); await idle();

 const NAME=TAG+'刃組待ち';
 const stop=await api('/api/schedule/stop-reason-master',
   {equipment:EQ,name:NAME,category:'待ち',standardMinutes:60});
 await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'ゴムリング'});
 await api('/api/schedule/stop-sub-master',{stopReasonId:stop.id,name:'刃出し',standardMinutes:90});
 rec('材料（内訳を2つ持つ設備停止）を作れた',!!stop.id,String(stop.id));

 /* **浮き窓から開く**（`#scStopModalBtn`）。側パネルは畳まれていることが
    あり、DOMに在るだけのボタンは押せない（実測: `page.click`が30秒で落ちた）。
    器は同じ`#scStopButtons`なので、見るものは変わらない（§9.13）。 */
 await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
 await page.reload({waitUntil:'domcontentloaded'});
 await WW.booted(page);
 await WW.openSchedule(page,EQ,{rows:false});
 await page.click('#scStopModalBtn');
 await page.waitForSelector('#scStopModal:not([hidden])',{timeout:10000});
 await page.waitForSelector(`.sc-stop-button[data-id="${stop.id}"]`,{state:'visible',timeout:20000});

 // ---- ① 段が2つ・内訳を選ぶまで追加できない ---------------------------
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForSelector('.sc-sp',{timeout:10000});
 const s1=await page.evaluate(()=>({
  steps:[...document.querySelectorAll('.sc-sp-t')].map(x=>x.textContent.trim()),
  nums:[...document.querySelectorAll('.sc-sp-n')].map(x=>x.textContent.trim()),
  subs:[...document.querySelectorAll('[data-sp-sub]')].map(x=>x.textContent.trim()),
  go:(document.querySelector('#scSpGo')||{}).textContent||'',
  goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
  pick:[...document.querySelectorAll('.sc-sp-pick')].map(x=>x.textContent.trim()),
 }));
 rec('段は「内訳を選ぶ」→「時間を選ぶ」の2つ',
     s1.steps.join('/')==='内訳を選ぶ/時間を選ぶ'&&s1.nums.join('')==='12',
     s1.steps.join('/')+' / '+s1.nums.join(''));
 rec('内訳の札が2つ出る',s1.subs.join('/')==='ゴムリング/刃出し',s1.subs.join('/'));
 rec('内訳を選ぶまで追加できない（理由をボタンの字で言う）',
     s1.goOff&&s1.go.includes('内訳を選んでください'),`${s1.go} off=${s1.goOff}`);
 rec('時間は親の標準所要分（60分）で始まる',/60/.test(s1.pick[1]||''),s1.pick.join(' | '));

 // ---- ② 内訳を選ぶと、その内訳の標準所要分が入る ----------------------
 await page.evaluate(()=>{
  const b=[...document.querySelectorAll('[data-sp-sub]')].find(x=>x.textContent.trim()==='刃出し');
  if(b)b.click();
 });
 await page.waitForFunction(()=>{
  const p=[...document.querySelectorAll('.sc-sp-pick')];
  return p.length===2&&/刃出し/.test(p[0].textContent);
 },null,{timeout:8000});
 const s2=await page.evaluate(()=>({
  pick:[...document.querySelectorAll('.sc-sp-pick')].map(x=>x.textContent.trim()),
  go:(document.querySelector('#scSpGo')||{}).textContent||'',
  goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
 }));
 rec('内訳を選ぶと、その内訳の標準所要分（90分）に変わる',/90/.test(s2.pick[1]||''),s2.pick.join(' | '));
 rec('内訳を選ぶと追加できるようになる',!s2.goOff&&s2.go.includes('追加'),`${s2.go} off=${s2.goOff}`);
 /* **選んだ札が濃く見えることを実測する**（§9.386 の教訓）——規則の置き場が
    ずれていると、クラスは付くのに1pxも変わらない（見た目の網は「効いた」を
    色で確かめる）。 */
 const tint=await page.evaluate(()=>{
  const on=document.querySelector('[data-sp-sub].is-on');
  const off=[...document.querySelectorAll('[data-sp-sub]')].find(x=>!x.classList.contains('is-on'));
  const g=el=>el?getComputedStyle(el).backgroundColor:'';
  return {on:g(on),off:g(off)};
 });
 rec('選んだ内訳の札は、選んでいない札と色が違う（印が効いている）',
     !!tint.on&&tint.on!==tint.off,`${tint.on} / ${tint.off}`);

 // ---- ③ スライダーで直すと、選び直しても戻らない ----------------------
 const sl=await page.evaluate(()=>{
  const r=document.getElementById('scSpRange');
  if(!r)return null;
  const v=Math.min(Number(r.max),Number(r.value)+Number(r.step)*2);
  r.value=String(v);r.dispatchEvent(new Event('input',{bubbles:true}));
  return {v,txt:(document.getElementById('scSpMin')||{}).textContent||''};
 });
 rec('スライダーで時間を直せる（札がその場で追いつく）',
     !!sl&&/\d/.test(sl.txt),JSON.stringify(sl));
 await page.evaluate(()=>{
  const b=[...document.querySelectorAll('[data-sp-sub]')].find(x=>x.textContent.trim()==='ゴムリング');
  if(b)b.click();
 });
 await page.waitForFunction(()=>{
  const p=[...document.querySelectorAll('.sc-sp-pick')];
  return p.length===2&&/ゴムリング/.test(p[0].textContent);
 },null,{timeout:8000});
 const s3=await page.evaluate(()=>
   (document.querySelectorAll('.sc-sp-pick')[1]||{}).textContent||'');
 rec('手で触った時間は、内訳を選び直しても勝手に戻さない',
     !/^60分$/.test(s3.trim()),s3.trim());

 // ---- ④⑤ 追加すると名称はそのまま・内訳は明細・行に札 ------------------
 const mins=await page.evaluate(()=>{
  const b=[...document.querySelectorAll('[data-sp-min]')].find(x=>/30/.test(x.textContent));
  if(b)b.click();
  return (document.querySelectorAll('.sc-sp-pick')[1]||{}).textContent||'';
 });
 rec('選択肢からも時間を選べる',/30/.test(mins),mins);
 await page.click('#scSpGo');
 const after=await WW.poll(plan,es=>es.some(e=>e.kind==='設備停止'&&e.title===NAME),20000);
 const added=after.find(e=>e.kind==='設備停止'&&e.title===NAME);
 rec('[予定名称]は停止内容の名前のまま（集計は名称で束ねられる）',
     !!added&&added.title===NAME,added&&added.title);
 rec('内訳は明細に入る（名称を割らない）',
     !!added&&(added.detail||{}).stopSub==='ゴムリング',JSON.stringify(added&&added.detail));
 rec('選んだ時間が見積になる',!!added&&Number((added.estimate||{}).minutes)===30,
     JSON.stringify(added&&added.estimate));
 await page.waitForFunction(n=>[...document.querySelectorAll('.sc-row-nonwork')]
   .some(x=>x.textContent.includes(n)&&x.querySelector('.sc-nw-sub')),NAME,{timeout:15000});
 const row=await page.evaluate(n=>{
  const el=[...document.querySelectorAll('.sc-row-nonwork')].find(x=>x.textContent.includes(n));
  const sub=el&&el.querySelector('.sc-nw-sub');
  return {sub:sub?sub.textContent.trim():'',title:el?el.getAttribute('title'):''};
 },NAME);
 rec('予定の行に内訳の札が出る',row.sub==='ゴムリング',JSON.stringify(row).slice(0,140));
 rec('題名そのものは名前のまま（札は別の物）',
     (row.title||'').startsWith(NAME),String(row.title).slice(0,60));

 // ---- ⑥ やめて一覧へ戻れる -------------------------------------------
 await page.click(`.sc-stop-button[data-id="${stop.id}"]`);
 await page.waitForSelector('#scSpBack',{timeout:10000});
 await page.click('#scSpBack');
 await page.waitForFunction(()=>!document.querySelector('.sc-sp')
   &&!!document.querySelector('.sc-stop-button'),null,{timeout:8000});
 rec('「← 一覧へ」で戻れる（手順に閉じ込めない）',true);

 // ---- 後片付け --------------------------------------------------------
 for(const e of after.filter(x=>x.kind==='設備停止'&&x.title===NAME)){
  await fetch(B+'/api/schedule/plan/delete',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({id:e.id,user_id:'test-stopflow'})}).catch(()=>{});
 }
 /* **マスタを消す前に編集モードへ戻す**（§9.362 ⑤の追補）。素の表の書込は
    `master_tables`のBlueprint＝editモードだけなので、scheduleモードのまま
    消しにいくと**403で黙って弾かれる**——`dropNewMasterRows`は失敗しても
    件数を数えるので、「消した」と報告しながら3行残っていた（実測）。 */
 await setMode('edit');
 await H.dropNewMasterRows(snap);
 let rest=0;
 for(const [t,ids] of await H.masterSnapshot(SNAP))
  rest+=[...ids].filter(i=>!snap.get(t).has(i)).length;
 rec('後片付けで増やした行が1つも残っていない',rest===0,`${rest}行残り`);
 const left=await plan();
 rec('置いた予定も消した',!left.some(e=>e.title===NAME),
     left.filter(e=>e.title===NAME).length+'件残り');
},{mode:'schedule',viewport:{width:1700,height:1000}});
