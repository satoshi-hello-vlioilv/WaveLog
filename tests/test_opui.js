/* test_opui.js: 操業データの配置（§9.216 ②④）
   ============================================================
   利用者の指示:
     「描画可能なエリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で
      視覚的に調整D&Dで並び替え編集ができる汎用設定機能を実装したいです」
     「特に『操業データ項目』と『操業データ選択肢』について、相互リンク、
      連携を強めてより登録の負荷を下げて汎用性を向上させてほしいです」

   行を1つずつ編集する一覧では、**並べたときにどう見えるか**が分からない。
   ここで固定するのは、崩れると「視覚的に調整できる」が成り立たなくなる点。
    1. 測定画面と同じ6列のグリッドが出る（準備・入力内容の2枚）
    2. 群は帯で区切られ、**帯より下がその群**
    3. 組み込みの欄は印が付き、型・上下限を出さない（効かない欄を置かない）
    4. 列幅を変えて保存すると**マスタに入り、測定画面の定義にも出る**
    5. 選択肢は**その場で足せる**／どの項目が使っているかが分かる
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TAG='opui-'+process.pid;
const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
const get=p=>fetch(B+p).then(r=>r.json());
let b=null;const made=[];const madeChoices=[];
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1800,height:1000}});
 const TAG_=TAG;const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  /* 更新者IDが無いと保存は断られる（マスタ共通の約束）。**入ったことを
     確かめてから進む**——入っていないと、以降の「保存できる」を見る網が
     全部「更新者IDが無いだけ」で落ち、原因が読めなくなる。 */
  await page.fill('#masterUserId',TAG);
  const uid=await page.evaluate(()=>document.getElementById('masterUserId').value);
  rec('前提: 更新者IDを入れてある',uid===TAG_,uid);

  /* ---- 1) 測定画面と同じ形のボードが出る ---- */
  const board=await page.evaluate(()=>{
   const grids=[...document.querySelectorAll('#masterMaintList .op-board-grid')];
   return{
    枚数:grids.length,
    置き場:grids.map(g=>g.dataset.opPlace),
    列:grids.map(g=>getComputedStyle(g).gridTemplateColumns.split(' ').length),
    帯:[...document.querySelectorAll('#masterMaintList .op-band')].map(x=>x.dataset.opBand),
    タイル:document.querySelectorAll('#masterMaintList .op-tile').length,
    掴める:[...document.querySelectorAll('#masterMaintList .op-tile')].every(x=>x.draggable),
   };
  });
  rec('置き場ごとにボードが出る（準備・入力内容）',
      board.枚数===2&&board.置き場.join('/')==='準備/入力内容',JSON.stringify(board.置き場));
  rec('測定画面と同じ6列のグリッド',board.列.every(n=>n===6),JSON.stringify(board.列));
  rec('群は帯で区切る（帯より下がその群）',
      board.帯.includes('誰が測るか')&&board.帯.includes('条の入力'),JSON.stringify(board.帯));
  rec('項目はタイルとして並び、掴める',board.タイル>10&&board.掴める===true,
      `${board.タイル}件`);

  /* ---- 2) 組み込みの欄は印が付き、効かない欄を出さない ---- */
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#masterMaintList .op-tile')]
     .find(x=>x.querySelector('.op-chip-builtin'));
   if(!t)throw Error('組み込みのタイルが無い');
   t.click();
  });
  await page.waitForTimeout(400);
  const built=await page.evaluate(()=>({
   題:(document.querySelector('#opDetail .op-detail-head b')||{}).textContent||'',
   印:!!document.querySelector('#opDetail .op-chip-builtin'),
   型の欄:!!document.getElementById('opdType'),
   幅の欄:!!document.getElementById('opdSpan'),
   置き場の欄:!!document.getElementById('opdPlace'),
   必須の欄:!!document.getElementById('opdRequired'),
   消せない:/消せません/.test(document.getElementById('opDetail').textContent||''),
   理由:/画面がもともと持って/.test(document.getElementById('opDetail').textContent||''),
  }));
  rec('組み込みの欄には印が付く',built.印===true,built.題);
  rec('組み込みの欄では型を出さない（効かない欄を置かない）',built.型の欄===false);
  rec('組み込みでも幅・置き場・必須は決められる',
      built.幅の欄&&built.置き場の欄&&built.必須の欄,JSON.stringify(built));
  rec('できないことは文字で書く',built.消せない&&built.理由,JSON.stringify(built));

  /* ---- 3) 幅を変えて保存するとマスタに入る ---- */
  const before=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const target=(before.items||[]).find(x=>x.builtin==='verticalCount');
  rec('前提: 組み込みの行がマスタにある',!!target,target?`span=${target.span}`:'なし');
  await page.evaluate(id=>{
   const t=document.querySelector(`#masterMaintList .op-tile[data-op-id="${id}"]`);
   if(!t)throw Error('タイルが無い');
   t.click();
  },target.id);
  await page.waitForTimeout(400);
  await page.selectOption('#opdSpan','3');
  await page.click('#opdSave');
  await page.waitForTimeout(1500);
  const after=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const t2=(after.items||[]).find(x=>x.builtin==='verticalCount');
  rec('列幅を変えるとマスタに入る',!!t2&&t2.span===3,JSON.stringify(t2&&{span:t2.span}));
  const form=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const f2=(form.items||[]).find(x=>x.builtin==='verticalCount');
  rec('測定画面へ渡す定義にも出る',!!f2&&f2.span===3,JSON.stringify(f2&&{span:f2.span}));
  /* 元へ戻す（この設定は実行をまたいで生き延びる・§9.121）。 */
  await post('/api/operation-item-master/layout',
    {items:[{id:target.id,group:target.group,place:target.place,span:target.span,
             required:target.required,enabled:true,fold:target.fold,showWhen:target.showWhen}],
     user_id:TAG});

  /* ---- 4) 「出さない」にすると画面へ出さないと伝える ---- */
  const off=(before.items||[]).find(x=>x.builtin==='spool');
  await post('/api/operation-item-master/layout',
    {items:[{id:off.id,group:off.group,place:off.place,span:off.span,
             required:off.required,enabled:false,fold:off.fold,showWhen:off.showWhen}],
     user_id:TAG});
  const form2=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  rec('「出さない」にした組み込みの欄は名指しで返る（画面が消せるように）',
      (form2.builtinOff||[]).includes('spool'),JSON.stringify(form2.builtinOff));
  await post('/api/operation-item-master/layout',
    {items:[{id:off.id,group:off.group,place:off.place,span:off.span,
             required:off.required,enabled:true,fold:off.fold,showWhen:off.showWhen}],
     user_id:TAG});

  /* ---- 5) 選択肢はその場で足せる／誰が使っているか分かる ---- */
  const mk=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 色',type:'選択',choice:TAG+'-色',user_id:TAG});
  const mkj=await mk.json();
  if(mkj.id)made.push(mkj.id);
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(800);
  await page.evaluate(id=>{
   const t=document.querySelector(`#masterMaintList .op-tile[data-op-id="${id}"]`);
   if(!t)throw Error('作った項目のタイルが無い');
   t.click();
  },mkj.id);
  await page.waitForTimeout(400);
  const hasBox=await page.evaluate(()=>!!document.getElementById('opdNewChoiceValue'));
  rec('「選択」の項目では選択肢の値をその場で足せる',hasBox===true);
  await page.fill('#opdNewChoiceValue','金');
  await page.click('#opdAddChoiceValue');
  await page.waitForTimeout(1500);
  const ch=await get('/api/operation-choice-master');
  const mine=(ch.items||[]).filter(x=>x.name===TAG+'-色');
  mine.forEach(x=>madeChoices.push(x.id));
  rec('足した値がマスタに入る',mine.length===1&&mine[0].value==='金',
      JSON.stringify(mine.map(x=>x.value)));
  rec('どの項目が使っているかを一覧の列で答える',
      mine.length===1&&String(mine[0].usedBy||'').includes(TAG+' 色'),
      String(mine[0]&&mine[0].usedBy));
  const shown=await page.evaluate(()=>({
   値:[...document.querySelectorAll('#opDetail .op-choice-vals .op-chip')].map(x=>x.textContent),
   使い道:(document.querySelector('#opDetail .op-choice-use')||{}).textContent||'',
  }));
  rec('足した値がその場で見える',shown.値.includes('金'),JSON.stringify(shown.値));
  rec('この選択肢を使っている項目を書く',/使っている項目/.test(shown.使い道),shown.使い道);

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  for(const id of made){try{await post('/api/operation-item-master/delete',{id,user_id:TAG})}catch(e){}}
  for(const id of madeChoices){try{await post('/api/operation-choice-master/delete',{id,user_id:TAG})}catch(e){}}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
