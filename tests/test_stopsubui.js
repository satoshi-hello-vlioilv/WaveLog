/* test_stopsubui.js: 設備停止の内訳と時間のマスタ画面（§9.389、利用者の指示）
   ------------------------------------------------------------
   「刃組待ちだったら、ゴムリングとフィンガーと刃出しの3種類があります。
    そのような種類の違いも後でわかるようにしたいが**同じ刃組というグループ
    には入れておきたい**」
   「時間のマスタは全体で共通…**あくまで選択肢を作るマスタ**。登録時には
    **選択肢＋スライダー**で時間を変更して登録もできる」

   固定すること:
    1. **3階層が1枚で見える**——左に分類の節と停止内容、右にその内訳
    2. 内訳を足せて、**別の停止に同じ名前の内訳**も足せる（親で割れている）
    3. 内訳の分の欄に**親の標準所要分**が出ている（空欄にすると何分かが読める）
    4. 左を押し替えても**左のスクロール位置が飛ばない**（右だけ差し替える）
    5. 設備停止の一覧に「内訳」列が出て、**0件は「—」**（0のままにしない）
    6. 時間の画面は札＋スライダーの見本で、**範囲は選択肢の最小〜最大**
    7. どちらの画面も**横にはみ出さない**（文字が切れない・器に収まる）  */
const H=require('./lib/harness.js');
const TAG='SSB'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
/* 分類は**設備停止の登録で自動的に増える**（未登録の分類を書くと分類マスタへも
   入る・§5.3.1）。控える表に入れておかないと、この本が「置き土産」を残す。 */
const SNAP=['設備停止マスタ','設備停止サブカテゴリマスタ','設備停止時間マスタ','設備停止分類マスタ'];

H.run('test_stopsubui: 設備停止の内訳と時間のマスタ画面（§9.389）',
 async({page,rec,B,W,idle})=>{
 const snap=await H.masterSnapshot(SNAP);
 const post=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-stopsubui'},a.body))});
  let j={};try{j=await r.json()}catch(e){j={}}
  return {status:r.status,body:j};
 },{path,body});

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();

 /* 材料は自分で注ぐ（§9.351）。**2つの停止**を作る——1つだけだと
    「親で割れている」ことを確かめられない。 */
 const a=await post('/api/schedule/stop-reason-master',
   {equipment:EQ,name:TAG+'刃組待ち',category:TAG+'待ち',standardMinutes:60});
 const b=await post('/api/schedule/stop-reason-master',
   {equipment:EQ,name:TAG+'段取り待ち',category:TAG+'待ち',standardMinutes:30});
 rec('材料の設備停止を2件作れた',a.status===200&&b.status===200,`${a.status}/${b.status}`);
 const idA=a.body.id,idB=b.body.id;

 const openTab=async key=>{
  const open=await page.$('#openMasterMaint');
  if(open&&await page.evaluate(()=>!document.getElementById('masterMaintForm')))await open.click();
  else if(!await page.$('#masterMaintForm'))await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintForm',{timeout:10000});
  await page.evaluate(k=>{const el=document.querySelector(`[data-master="${k}"]`);if(el)el.click()},key);
 };

 // ---- ① 3階層が1枚で見える -------------------------------------------
 await openTab('stopSub');
 await page.waitForSelector('.ssb-edit',{timeout:15000});
 await idle();
 const shape=await page.evaluate(t=>{
  const cats=[...document.querySelectorAll('.ssb-cat span')].map(x=>x.textContent.trim());
  const stops=[...document.querySelectorAll('[data-ssb-stop]')].map(x=>x.querySelector('b').textContent.trim());
  return {cats,stops,mine:stops.filter(s=>s.startsWith(t)).length,
          hasCat:cats.includes(t+'待ち'),
          paneL:!!document.querySelector('.ssb-stops'),paneR:!!document.querySelector('.ssb-subs')};
 },TAG);
 rec('左に「分類」の節が出る（3階層の1段目）',shape.hasCat,shape.cats.slice(0,6).join('/'));
 rec('その分類の中に作った停止内容が2件並ぶ',shape.mine===2,`${shape.mine}件`);
 rec('左＝停止内容／右＝内訳の2ペインになっている',shape.paneL&&shape.paneR);

 // ---- ② 内訳を足す。別の親に同じ名前も足せる --------------------------
 const pick=async id=>{
  await page.evaluate(i=>{const el=document.querySelector(`[data-ssb-stop="${i}"]`);if(el)el.click()},id);
  await page.waitForFunction(i=>{
   const on=document.querySelector('[data-ssb-stop].is-on');
   return on&&Number(on.dataset.ssbStop)===Number(i);
  },id,{timeout:8000});
 };
 const addSub=async(name,min)=>{
  await page.fill('#ssbNewName',name);
  await page.fill('#ssbNewMin',min==null?'':String(min));
  await page.click('#ssbAdd');
  await page.waitForFunction(n=>[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="name"]')]
    .some(i=>i.value===n),name,{timeout:10000});
 };
 await pick(idA);
 await addSub('ゴムリング',null);
 await addSub('刃出し',90);
 await pick(idB);
 await addSub('刃出し',null);
 const subs=await page.evaluate(()=>({
  rows:[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="name"]')].map(i=>i.value),
  minPh:[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="min"]')].map(i=>i.placeholder),
 }));
 rec('別の停止にも同じ名前（刃出し）の内訳を足せる',subs.rows.length===1&&subs.rows[0]==='刃出し',
     subs.rows.join('/'));
 /* **数えるのは自分が作った親のぶんだけ**（§9.284）。全体の件数で見ると、
    前の実行の置き土産や他の本の行まで数えてしまう（実測で11件を数えた）。 */
 const srv=await page.evaluate(async ids=>{
  const r=await fetch('/api/schedule/stop-sub-master');const j=await r.json();
  return (j.items||[]).filter(x=>ids.includes(Number(x.stopReasonId)))
    .map(x=>`${x.stopReasonId}:${x.name}`);
 },[idA,idB]);
 rec('この2つの親のもとに3件（同名2件は親が違う）',
     srv.length===3&&srv.filter(x=>x.endsWith(':刃出し')).length===2
     &&srv.filter(x=>x.endsWith(':ゴムリング')).length===1,
     srv.join(' / '));

 // ---- ③ 親の標準所要分が画面に出ている（出どころ・§CLAUDE 6） ---------
 const baseTxt=await page.textContent('.ssb-base');
 rec('右のヘッダに親の標準所要分が出る',/30/.test(baseTxt||''),(baseTxt||'').trim().slice(0,60));
 rec('分の欄のプレースホルダが「空欄ならこの時間」を言う',
     subs.minPh.length===1&&/30/.test(subs.minPh[0]||''),subs.minPh.join('/'));

 // ---- ④ 左を押し替えても左のスクロール位置が飛ばない -------------------
 const keep=await page.evaluate(async ids=>{
  const list=document.querySelector('.ssb-stop-list');
  list.scrollTop=list.scrollHeight;            // いちばん下まで送る
  const before=list.scrollTop;
  document.querySelector(`[data-ssb-stop="${ids[0]}"]`).click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const after=document.querySelector('.ssb-stop-list').scrollTop;
  return {before,after,same:document.querySelector('.ssb-stop-list')===list};
 },[idA]);
 rec('左のDOMを作り直していない（位置が飛ばない）',keep.same&&keep.after===keep.before,
     `${keep.before}→${keep.after} same=${keep.same}`);
 /* 選んだ行が濃く見えることを**実測する**（§9.386）——クラスは付くのに
    規則の置き場がずれていて1pxも変わらない、が実際に起きた。 */
 const tint=await page.evaluate(()=>{
  const on=document.querySelector('.ssb-stop.is-on');
  const off=[...document.querySelectorAll('.ssb-stop')].find(x=>!x.classList.contains('is-on'));
  const g=el=>el?getComputedStyle(el).backgroundColor:'';
  return {on:g(on),off:g(off)};
 });
 rec('選んだ停止内容は、選んでいない行と色が違う（印が効いている）',
     !!tint.on&&tint.on!==tint.off,`${tint.on} / ${tint.off}`);

 // ---- ⑤ 設備停止の一覧に「内訳」列 -------------------------------------
 await openTab('stopReason');
 await page.waitForFunction(()=>document.querySelectorAll('#masterMaintList .mm-row').length>0,null,{timeout:15000});
 const col=await page.evaluate(t=>{
  const head=[...document.querySelectorAll('#masterMaintList .mm-row.head .mm-th b')]
    .map(x=>x.textContent.trim());
  const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')].filter(r=>r.textContent.includes(t));
  const texts=rows.map(r=>[...r.children].map(c=>c.textContent.trim()));
  return {head,texts};
 },TAG);
 const flat=col.texts.map(t=>t.join('|')).join(' // ');
 rec('設備停止の一覧に「内訳」の見出しがある',col.head.includes('内訳'),col.head.join('/'));
 rec('内訳を持つ行は件数、持たない行は「—」',/2件/.test(flat)&&/1件/.test(flat),flat.slice(0,200));

 // ---- ⑥ 時間の画面（札＋スライダーの見本） ------------------------------
 await openTab('stopMinutes');
 await page.waitForSelector('.smn-wrap',{timeout:15000});
 await idle();
 await page.fill('#smnNew','7');
 await page.click('#smnAdd');
 await page.waitForFunction(()=>[...document.querySelectorAll('.smn-chip b')].some(b=>/7/.test(b.textContent)),
   null,{timeout:10000});
 const mn=await page.evaluate(()=>{
  const chips=[...document.querySelectorAll('.smn-chip b')].map(b=>b.textContent.trim());
  const r=document.querySelector('.smn-range input[type=range]');
  return {chips,min:r&&+r.min,max:r&&+r.max,step:r&&+r.step,disabled:!!(r&&r.disabled)};
 });
 const vals=await page.evaluate(async()=>{
  const j=await (await fetch('/api/schedule/stop-minutes-master')).json();
  return (j.items||[]).map(x=>Number(x.minutes));
 });
 rec('選択肢を足せる（札が増える）',mn.chips.length===vals.length&&vals.includes(7),
     `${mn.chips.length}札 / ${vals.length}件`);
 rec('スライダーの範囲は選択肢の最小〜最大',
     mn.min===Math.min(...vals)&&mn.max===Math.max(...vals),`${mn.min}〜${mn.max} / ${vals.join(',')}`);
 rec('見本のスライダーは動かせない（押せるのに効かない物を置かない）',mn.disabled);

 // ---- ⑦ どちらの画面も横にはみ出さない ---------------------------------
 const fitM=await page.evaluate(()=>{
  const l=document.getElementById('masterMaintList');
  return {over:l.scrollWidth-l.clientWidth,w:l.clientWidth};
 });
 rec('時間の画面が器からはみ出さない',fitM.over<=1,`はみ出し${fitM.over}px（器${fitM.w}px）`);
 await openTab('stopSub');
 await page.waitForSelector('.ssb-edit',{timeout:15000});
 await idle();
 const fitS=await page.evaluate(()=>{
  const l=document.getElementById('masterMaintList');
  const cut=[...document.querySelectorAll('.ssb-add input,.ssb-row input')]
    .filter(i=>i.scrollWidth>i.clientWidth+2).length;
  return {over:l.scrollWidth-l.clientWidth,w:l.clientWidth,cut};
 });
 rec('内訳の画面が器からはみ出さない',fitS.over<=1,`はみ出し${fitS.over}px（器${fitS.w}px）`);
 rec('入力欄の中の字が切れていない',fitS.cut===0,`${fitS.cut}件`);

 // ---- 後片付け（この実行で増えた行だけ・§9.362 ⑤） ---------------------
 const dropped=await H.dropNewMasterRows(snap);
 rec('後片付けで増やした行を消した',dropped>0,`${dropped}行`);
 const left=await H.masterSnapshot(SNAP);
 let rest=0;
 for(const [t,ids] of left)rest+=[...ids].filter(i=>!snap.get(t).has(i)).length;
 rec('触る前の状態へ戻っている',rest===0,`${rest}行残り`);
},{mode:'edit',viewport:{width:1700,height:1000}});
