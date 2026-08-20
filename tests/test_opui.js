/* test_opui.js: 操業データの配置と設定（§9.216 ②④／§9.218 ①②③④）
   ============================================================
   利用者の指示（§9.216）:
     「描画可能なエリア(縦2×横3のカード)内の中でレイアウトも含めてマスタ上で
      視覚的に調整D&Dで並び替え編集ができる汎用設定機能を実装したいです」
   利用者の指示（§9.218）:
     ①「操業データ項目を選んだときにメニューが右側で固定され、設定しにくい。
        モーダルで表示して設定させる形にしてください」
     ②「バリエーションも少なく1列と2列の間もほしい」「プルダウンだけでなく、
        ラジオボタンやタブっぽいボタン、フローティングモーダル…」
     ④「ドラッグアンドドロップで移動した後元の位置に戻らなくなりました」

   行を1つずつ編集する一覧では、**並べたときにどう見えるか**が分からない。
   ここで固定するのは、崩れると「視覚的に調整できる」が成り立たなくなる点。
    1. 測定画面と同じ12マスのグリッドが出る（準備・入力内容の2枚）
    2. 群は帯で区切られ、**帯より下がその群**
    3. 押すと**モーダル**が開き、そこに実物の見本と設定が並ぶ
    4. 幅を変えて保存すると**マスタに入り、測定画面の定義にも出る**
    5. 選択肢は**その場で足せる**／どの項目が使っているかが分かる
    6. 掴んで動かした先が**狙った境目**になる（元の位置へ戻せる）
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
 /* タイルを押して設定の窓が開くのを待つ。**窓が開くまで待つこと**——
    開く前に中を読むと、直っていても落ちる網になる。 */
 const openTile=async id=>{
  await page.evaluate(i=>{
   const t=document.querySelector(`#masterMaintList .op-tile[data-op-id="${i}"]`);
   if(!t)throw Error('タイルが無い: '+i);
   t.click();
  },String(id));
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
  },null,{timeout:10000});
  await page.waitForTimeout(250);
 };
 /* 窓は画面を覆うので、左のタブへ戻る前に必ず閉じる（実機でも同じ）。 */
 const closeModal=async()=>{
  await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
  await page.waitForTimeout(200);
 };
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
    目盛:document.querySelectorAll('#masterMaintList .op-ruler-cell').length,
    柱:!!document.querySelector('#masterMaintList .op-detail'),
   };
  });
  rec('置き場ごとにボードが出る（準備・入力内容）',
      board.枚数===2&&board.置き場.join('/')==='準備/入力内容',JSON.stringify(board.置き場));
  /* §9.218 ②: 6マス（選べるのは1/2/3/6の4通り）では「1列と2列の間」が
     作れなかった。12マスにして刻みを細かくする。 */
  rec('測定画面と同じ12マスのグリッド',board.列.every(n=>n===12),JSON.stringify(board.列));
  rec('マスの目盛が出る（あと何マス入るかが読める）',board.目盛===24,String(board.目盛));
  rec('群は帯で区切る（帯より下がその群）',
      board.帯.includes('誰が測るか')&&board.帯.includes('条の入力'),JSON.stringify(board.帯));
  rec('項目はタイルとして並び、掴める',board.タイル>10&&board.掴める===true,
      `${board.タイル}件`);
  /* §9.218 ①: 右の固定の柱は廃止した（盤が狭く、設定が縦に長かった）。 */
  rec('右に固定の柱を置かない（設定はモーダル）',board.柱===false);

  /* ---- 2) 押すとモーダルが開き、実物の見本が出る（§9.218 ①） ---- */
  const builtinId=await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#masterMaintList .op-tile')]
     .find(x=>x.querySelector('.op-chip-builtin'));
   if(!t)throw Error('組み込みのタイルが無い');
   return t.dataset.opId;
  });
  await openTile(builtinId);
  const built=await page.evaluate(()=>{
   const m=document.getElementById('opItemModal');
   const prev=document.getElementById('opPrevField');
   const pr=prev?prev.getBoundingClientRect():null;
   return {
    開いた:!!m&&!m.hidden,
    題:(document.getElementById('opModalTitle')||{}).textContent||'',
    見本:!!(prev&&prev.querySelector('select,input')),
    見本の幅:pr?Math.round(pr.width):0,
    型の欄:!!document.querySelector('[data-op-type]'),
    幅の欄:!!document.querySelector('[data-op-span]'),
    置き場の欄:!!document.querySelector('[data-op-place]'),
    必須の欄:!!document.getElementById('opdRequired'),
    選ばせ方:[...document.querySelectorAll('[data-op-widget]')].map(x=>x.dataset.opWidget),
    消せない:/消せません/.test(m.textContent||''),
    理由:/画面がもともと持って/.test(m.textContent||''),
   };
  });
  rec('タイルを押すと設定のモーダルが開く',built.開いた===true,built.題);
  rec('モーダルの左に実物の見本が出る',built.見本===true&&built.見本の幅>40,
      `幅${built.見本の幅}`);
  rec('組み込みの欄では型を出さない（効かない欄を置かない）',built.型の欄===false);
  rec('組み込みでも幅・置き場・必須は決められる',
      built.幅の欄&&built.置き場の欄&&built.必須の欄,JSON.stringify(built));
  rec('選ばせ方は4つから選ぶ',built.選ばせ方.join('/')==='プルダウン/ラジオ/タブ/一覧',
      JSON.stringify(built.選ばせ方));
  rec('できないことは文字で書く',built.消せない&&built.理由,JSON.stringify(built));

  /* ---- 3) 幅を変えて保存するとマスタに入る ---- */
  const before=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const target=(before.items||[]).find(x=>x.builtin==='verticalCount');
  rec('前提: 組み込みの行がマスタにある',!!target,target?`span=${target.span}`:'なし');
  await openTile(target.id);
  await page.click('[data-op-span="6"]');
  await page.waitForTimeout(200);
  await page.click('#opdSave');
  await page.waitForTimeout(1500);
  const after=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const t2=(after.items||[]).find(x=>x.builtin==='verticalCount');
  rec('マスの数を変えるとマスタに入る',!!t2&&t2.span===6,JSON.stringify(t2&&{span:t2.span}));
  const form=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const f2=(form.items||[]).find(x=>x.builtin==='verticalCount');
  rec('測定画面へ渡す定義にも出る',!!f2&&f2.span===6,JSON.stringify(f2&&{span:f2.span}));
  rec('マスの数と1列ぶんの対応をサーバーが答える',form.gridCols===12&&form.spanUnit===2,
      JSON.stringify({gridCols:form.gridCols,spanUnit:form.spanUnit}));
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
  await closeModal();
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(800);
  await openTile(mkj.id);
  const hasBox=await page.evaluate(()=>!!document.getElementById('opdNewChoiceValue'));
  rec('「選択」の項目では選択肢の値をその場で足せる',hasBox===true);
  await page.fill('#opdNewChoiceValue','金');
  await page.fill('#opdNewChoiceNote','いちばん明るい色');
  await page.click('#opdAddChoiceValue');
  await page.waitForTimeout(1800);
  const ch=await get('/api/operation-choice-master');
  const mine=(ch.items||[]).filter(x=>x.name===TAG+'-色');
  mine.forEach(x=>madeChoices.push(x.id));
  rec('足した値がマスタに入る',mine.length===1&&mine[0].value==='金',
      JSON.stringify(mine.map(x=>x.value)));
  /* §9.218 ②: 説明は「一覧から選ぶ」で出す材料。**値と一緒に足せる**。 */
  rec('説明も一緒に足せる',mine.length===1&&mine[0].note==='いちばん明るい色',
      JSON.stringify(mine.map(x=>x.note)));
  rec('どの項目が使っているかを一覧の列で答える',
      mine.length===1&&String(mine[0].usedBy||'').includes(TAG+' 色'),
      String(mine[0]&&mine[0].usedBy));
  const shown=await page.evaluate(()=>({
   値:[...document.querySelectorAll('#opItemModal .op-choice-row>b')].map(x=>x.textContent),
   使い道:[...document.querySelectorAll('#opItemModal .op-form-note')]
     .map(x=>x.textContent).filter(t=>/使っている項目/.test(t))[0]||'',
  }));
  rec('足した値がその場で見える',shown.値.includes('金'),JSON.stringify(shown.値));
  rec('この選択肢を使っている項目を書く',/使っている項目/.test(shown.使い道),shown.使い道);

  /* ---- 6) 選ばせ方を変えると測定画面の定義に出る（§9.218 ②） ---- */
  await page.click('[data-op-widget="タブ"]');
  await page.waitForTimeout(200);
  await page.click('#opdSave');
  await page.waitForTimeout(1500);
  const form3=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const f3=(form3.items||[]).find(x=>String(x.id)===String(mkj.id));
  rec('選ばせ方を変えると測定画面の定義に出る',!!f3&&f3.widget==='タブ'&&f3.widgetLive==='タブ',
      JSON.stringify(f3&&{widget:f3.widget,live:f3.widgetLive}));
  rec('選択肢の説明も測定画面の定義に付いてくる',
      !!f3&&(f3.choiceNotes||{})['金']==='いちばん明るい色',
      JSON.stringify(f3&&f3.choiceNotes));
  /* **選択肢を持たない型では効かないと言う**（§4）。設定は残す。 */
  await page.click('[data-op-type="文字"]');
  await page.waitForTimeout(200);
  const noChoice=await page.evaluate(()=>({
   使えない:[...document.querySelectorAll('[data-op-widget]')].every(b=>b.disabled),
   理由:/効きません/.test(document.getElementById('opModalForm').textContent||''),
  }));
  rec('選択肢を持たない型では選ばせ方を押せなくし、理由を書く',
      noChoice.使えない&&noChoice.理由,JSON.stringify(noChoice));
  await page.click('[data-op-type="選択"]');
  await page.waitForTimeout(200);

  /* ---- 7) 掴んで動かした先が狙った境目になる（§9.218 ④） ----
     利用者の報告「ドラッグアンドドロップで移動した後元の位置に戻らなく
     なりました」。原因は**落とす場所の印そのもの**が次の当たり判定の
     候補に入っていたことで、印が1つずつ先へ歩いていた。
     **`opDropAt`を直に呼んで確かめる**——HTML5のD&Dはヘッドレスでは
     座標を作れないが、狙いを決めているのはこの関数なので、ここが
     正しければ落ちる先も正しい（印を挿してから同じ座標でもう一度聞く）。 */
  await closeModal();
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(600);
  const drop=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   const tiles=[...grid.querySelectorAll('.op-tile')];
   if(tiles.length<4)return {少ない:tiles.length};
   /* 3つ目のタイルの左寄りを狙う＝そこへ挿し込む、が期待値。 */
   const t=tiles[2],r=t.getBoundingClientRect();
   const ev={clientX:r.left+3,clientY:r.top+r.height/2};
   const grab=tiles[tiles.length-1];
   grab.classList.add('is-dragging');
   const seen=[];
   for(let i=0;i<4;i++){
    /* 画面と同じ順番でまわす: 狙いを聞く→印を置く。 */
    const at=WL.opBoard.dropAt(grid,ev);
    seen.push(at?(at.dataset.opId||at.dataset.opBand||at.className):'(末尾)');
    WL.opBoard.mark(grid,at);
   }
   const mark=grid.querySelector('[data-op-mark]');
   const mr=mark?mark.getBoundingClientRect():null;
   grab.classList.remove('is-dragging');
   document.querySelectorAll('[data-op-mark]').forEach(x=>x.remove());
   return {狙い:t.dataset.opId,見た:seen,
           印の左:mr?Math.round(mr.left):null,狙いの左:Math.round(r.left)};
  });
  rec('落とす先は何度聞いても同じ（印が先へ歩かない）',
      !drop.少ない&&new Set(drop.見た).size===1&&drop.見た[0]===drop.狙い,
      JSON.stringify(drop.見た));
  rec('印は狙った境目に出る',!drop.少ない&&drop.印の左!==null
      &&Math.abs(drop.印の左-drop.狙いの左)<8,
      JSON.stringify({印:drop.印の左,狙い:drop.狙いの左}));
  /* **印を出しても盤が1pxも動かないこと**（§9.218 ④）。流れの中へ挿すと
     後ろのタイルがずれ、同じ座標で違う境目がいちばん近くなる。 */
  const still=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid');
   const tiles=[...grid.querySelectorAll('.op-tile')];
   const before=tiles.map(t=>Math.round(t.getBoundingClientRect().left));
   WL.opBoard.mark(grid,tiles[2]);
   const after=tiles.map(t=>Math.round(t.getBoundingClientRect().left));
   const mark=grid.querySelector('[data-op-mark]');
   const pos=mark?getComputedStyle(mark).position:'';
   WL.opBoard.clearMark();
   return {同じ:before.join()===after.join(),位置:pos,
           ずれ:before.map((v,i)=>after[i]-v).filter(d=>d!==0).length};
  });
  rec('印を出しても盤が動かない（浮かせて置く）',
      still.同じ===true&&still.位置==='absolute',JSON.stringify(still));

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
