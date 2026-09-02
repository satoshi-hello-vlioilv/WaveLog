/* test_choicelinkui.js: 選択肢の親子（リンクマスタ）の盤（§9.306-B、利用者の指示）
   ============================================================
   「選択肢の値マスタ同士を親子関係として紐づけるためにリンクさせ…したがって、
    汎用性を向上させるために『リンクマスタ』の追加に伴い…」

   サーバー（`/api/choice-link-master`の4本と1段だけの規則）は
   `tests/test_choicelink.py`、**測定画面で実際に絞られるか**は
   `tests/test_opparent.js`が固定してある。ここが見るのは**盤**。

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. マスタ管理から開ける（ナビに出る）
    2. **まとまりの一覧は1枚だけ**（§CLAUDE 8）——最初は「親にする一覧／
       子にする一覧」を左右に並べたが、実機で見ると**同じ22行が2枚**並び、
       いちばん読みたい木が下端の帯に押し込まれていた
    3. **木のほうが入れ物より広い**（面積は頻度×重要度・§CLAUDE 1）
    4. **押す道**で親子が張れて、サーバーにも入る（§9.278）
    5. 仮の親は**「まだ保存していません」と字で言う**（§3）
    6. **掴む道**でも張れる（親の箱＝子。向きを位置が語る）
    7. **1段だけの断りが理由つきでその場に出る**（§4）
    8. 外すと消え、**「親の値は残しています」**と言う
    9. 役（親／子）が入れ物の行に**文字で**出る（§3）
   10. 器からはみ出さない
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TAG='CU'+process.pid;
const P=TAG+'材質',C=TAG+'品種',D=TAG+'形状';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(r=>r.json().catch(()=>({})));
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;const made=[];

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('!! '+e.message.slice(0,200)));
 page.on('dialog',d=>d.accept());

 const look=()=>page.evaluate(()=>({
  一覧の枚数:document.querySelectorAll('.cl-list').length,
  選んでいる:[...document.querySelectorAll('.cl-item.is-pick')].map(x=>x.dataset.clName),
  箱:[...document.querySelectorAll('.cl-box[data-cl-parent]')].map(x=>({
    親:x.querySelector('.cl-box-head b').textContent,
    仮:x.classList.contains('is-pending'),
    仮の字:(x.querySelector('.cl-box-pending')||{}).textContent||'',
    子:[...x.querySelectorAll('.cl-chip b')].map(y=>y.textContent),
    足す:(x.querySelector('.cl-add')||{}).textContent||''})),
  新しい親:(document.querySelector('.cl-box-new .cl-add')||{}).textContent
    ||(document.querySelector('.cl-box-new .cl-hint')||{}).textContent||'',
  帯:(document.getElementById('clState')||{}).textContent||'',
  役:[...document.querySelectorAll('.cl-item')].filter(x=>x.querySelector('.cl-item-role'))
     .map(x=>x.dataset.clName+':'+x.querySelector('.cl-item-role').textContent),
 }));
 const tap=async n=>{await page.evaluate(x=>{
   const el=[...document.querySelectorAll('.cl-item')].find(y=>y.dataset.clName===x);
   if(!el)throw Error('まとまりが無い: '+x);el.click();},n);
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
 /* 保存を伴う操作は**時間で待たない**（§9.102）——帯の文字が変わるまで待つ。 */
 const press=async(sel,until)=>{
  await page.evaluate(s=>{const el=document.querySelector(s);if(!el)throw Error('無い: '+s);el.click()},sel);
  await page.waitForFunction(t=>((document.getElementById('clState')||{}).textContent||'').includes(t),
    until,{timeout:15000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 };
 const links=async()=>((await get('/api/choice-link-master')).items||[])
   .filter(x=>String(x.parent).startsWith(TAG)||String(x.child).startsWith(TAG));

 try{
  await post('/api/access-mode',{mode:'edit'});
  /* 材料は自分で注ぎ込む（フィクスチャは親子を1本も持たない）。 */
  for(const [n,v] of [[P,'SUS'],[P,'SPCC'],[C,'SUS304'],[C,'SUS430'],[C,'SPCC-SD'],[D,'コイル']]){
   const r=await post('/api/operation-choice-master',
     {name:n,value:v,order:0,enabledText:'出す',user_id:'tests'});
   if(r&&r.id)made.push(r.id);
  }

  /* ---- 1) マスタ管理から開ける ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('.mm-nav',{timeout:20000});
  const inNav=await page.evaluate(()=>{
   const el=[...document.querySelectorAll('.mm-nav button')].find(x=>(x.textContent||'').includes('選択肢の親子'));
   if(el){el.click();return true}return false;
  });
  rec('① マスタ管理のナビに「選択肢の親子」が出る',inNav,'');
  if(!inNav)throw Error('ナビに無い');
  await page.waitForSelector('.cl-edit',{timeout:20000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

  /* ---- 2) まとまりの一覧は1枚だけ ---- */
  let s=await look();
  rec('② まとまりの一覧は1枚だけ（同じ一覧を左右に並べない）',
      s.一覧の枚数===1,'枚数='+s.一覧の枚数);

  /* ---- 3) 木のほうが広い ---- */
  const w=await page.evaluate(()=>{
   const t=document.querySelector('.cl-tree'),p=document.querySelector('.cl-pool');
   return (t&&p)?{木:t.getBoundingClientRect().width,入れ物:p.getBoundingClientRect().width}:null;
  });
  rec('③ 木のほうが入れ物より広い（面積は頻度×重要度）',
      !!w&&w.木>w.入れ物,JSON.stringify(w&&{木:Math.round(w.木),入れ物:Math.round(w.入れ物)}));

  /* ---- 4)(5) 押す道で張れる。仮の親は「まだ保存していません」 ---- */
  await tap(P);
  s=await look();
  rec('④-a まとまりを押すと「親にする」が出る',
      /親にする/.test(s.新しい親)&&s.新しい親.includes(P),s.新しい親);
  await press('#clNewParent','親にしました');
  s=await look();
  rec('⑤ 仮の親は「まだ保存していません」と字で言う',
      s.箱.length===1&&s.箱[0].仮===true&&/まだ保存していません/.test(s.箱[0].仮の字),
      JSON.stringify(s.箱));
  rec('⑤-b 仮の親はまだサーバーへ入っていない',(await links()).length===0,
      JSON.stringify(await links()));
  await tap(C);
  s=await look();
  rec('④-b 子を選ぶと箱に「子にする」が出る',
      s.箱.length===1&&s.箱[0].足す.includes(C),JSON.stringify(s.箱));
  await press('.cl-box[data-cl-parent] .cl-add','結びました');
  s=await look();
  const saved=await links();
  rec('④-c 押す道で親子が張れて、サーバーにも入る',
      saved.length===1&&saved[0].parent===P&&saved[0].child===C
      &&s.箱.length===1&&s.箱[0].仮===false&&s.箱[0].子.join()===C,
      JSON.stringify({保存:saved.map(x=>x.parent+'→'+x.child),箱:s.箱}));

  /* ---- 9) 役が文字で出る ---- */
  rec('⑨ 役（親／子）が入れ物の行に文字で出る',
      s.役.includes(P+':親')&&s.役.includes(C+':子'),JSON.stringify(s.役));

  /* ---- 7) 1段だけの断りが理由つきでその場に出る ---- */
  await tap(C);
  s=await look();
  rec('⑦ 子を親にはできない——理由と打つ手がその場に出る',
      /親にできません/.test(s.新しい親)&&/1段だけ/.test(s.新しい親)
      &&/外して/.test(s.新しい親),s.新しい親);
  await tap(C);  /* 選び直し（外す） */

  /* ---- 6) 掴む道でも張れる ---- */
  const drag=await page.evaluate(([src,par])=>{
   const el=[...document.querySelectorAll('.cl-item')].find(x=>x.dataset.clName===src);
   const box=[...document.querySelectorAll('.cl-box[data-cl-parent]')].find(x=>x.dataset.clParent===par);
   if(!el||!box)return 'src='+!!el+' box='+!!box;
   const dt=new DataTransfer();
   el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   const b2=[...document.querySelectorAll('.cl-box[data-cl-parent]')].find(x=>x.dataset.clParent===par);
   b2.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));
   b2.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));
   return 'ok';
  },[D,P]);
  await page.waitForFunction(t=>((document.getElementById('clState')||{}).textContent||'').includes(t),
    '結びました',{timeout:15000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  s=await look();
  const two=await links();
  rec('⑥ 掴んで親の箱へ落としても張れる（向きは位置が語る）',
      drag==='ok'&&two.length===2&&two.some(x=>x.parent===P&&x.child===D)
      &&s.箱[0].子.length===2,
      JSON.stringify({drag,保存:two.map(x=>x.parent+'→'+x.child),子:s.箱[0]&&s.箱[0].子}));

  /* ---- 8) 外す ---- */
  await press('.cl-chip-del','外しました');
  s=await look();
  const one=await links();
  rec('⑧ 外すと親子が1本減る',one.length===1&&s.箱[0].子.length===1,
      JSON.stringify({保存:one.map(x=>x.parent+'→'+x.child),子:s.箱[0]&&s.箱[0].子}));
  rec('⑧-b 外したときは「親の値は残しています」と言う',
      /親の値.*残/.test(s.帯),s.帯);

  /* ---- 10) はみ出さない ---- */
  const over=await page.evaluate(()=>{
   const e=document.querySelector('.cl-edit'),host=e&&e.parentElement;
   return (e&&host)?[e.scrollWidth-host.clientWidth,e.scrollHeight-host.clientHeight]:null;
  });
  rec('⑩ 器からはみ出さない',!!over&&over[0]<=1&&over[1]<=1,JSON.stringify(over));

 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **後始末は自分が作ったものだけ**（§9.121。マスタは実行をまたいで残る）。 */
  try{
   for(const x of ((await get('/api/choice-link-master')).items||[])){
    if(String(x.parent).startsWith(TAG)||String(x.child).startsWith(TAG))
     await post('/api/choice-link-master/delete',{id:x.id,user_id:'tests'});
   }
  }catch(e){}
  for(const id of made){try{await post('/api/operation-choice-master/delete',{id,user_id:'tests'})}catch(e){}}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng}/${R.length} PASS`);
 process.exit(ng?1:0);
})();
