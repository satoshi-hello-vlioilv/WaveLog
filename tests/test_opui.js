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
  /* §9.220 ①（利用者の指摘「ラジオボタンやタブがほぼ同じデザインに
     なっている」）。**形が違うものは別の名前で並ぶ**——4つから6つへ。 */
  rec('選ばせ方は6つから選ぶ（セグメント・ボタン群を足した）',
      built.選ばせ方.join('/')==='プルダウン/ラジオ/セグメント/タブ/ボタン群/一覧',
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
  /* **型ごとに効く形だけを出す**（§9.219 ③、利用者の指示「UIの種類を
     増やしたり」）。以前は選択肢を持たない型では選ばせ方を全部押せなく
     していたが、いまは数値・自由記述にもそれぞれの道具がある。
     **効かない形は並べない**（押せるのに何も起きない設定を作らない・§4）。 */
  await page.click('[data-op-type="文字"]');
  await page.waitForTimeout(250);
  const textW=await page.evaluate(()=>
    [...document.querySelectorAll('[data-op-widget]')].map(b=>b.dataset.opWidget));
  rec('自由記述の型では「メモ」が選べ、選択肢向けの形は並ばない',
      textW.includes('メモ')&&!textW.includes('ラジオ')&&!textW.includes('タブ'),
      JSON.stringify(textW));
  await page.click('[data-op-type="正の整数"]');
  await page.waitForTimeout(250);
  const numW=await page.evaluate(()=>
    [...document.querySelectorAll('[data-op-widget]')].map(b=>b.dataset.opWidget));
  rec('数値の型ではステッパー・スライダー・キーパッドが選べる',
      ['ステッパー','スライダー','キーパッド'].every(w=>numW.includes(w))
      &&!numW.includes('一覧'),JSON.stringify(numW));
  /* **見本は本物の部品**（§9.218 ①）。数値の器も`measure-opdata.js`が作る
     ので、設定画面と測定画面で形が食い違わない。 */
  await page.click('[data-op-widget="ステッパー"]');
  await page.waitForTimeout(300);
  const prev=await page.evaluate(()=>({
   ステッパー:document.querySelectorAll('#opPrevField .opf-step-btn').length,
   値の行:!!document.getElementById('opPrevValue'),
  }));
  rec('見本に本物のステッパーが出て、記録される値も書く',
      prev.ステッパー===2&&prev.値の行===true,JSON.stringify(prev));
  await page.click('[data-op-type="選択"]');
  await page.waitForTimeout(200);
  await page.click('[data-op-widget="タブ"]');
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

  /* ---- 8) 帯へ落とすと**その群**へ入る（§9.219 ③） ----
     利用者の報告「D&Dで並び替えるとき、『誰が測るか』と『測定表の形』には
     項目を移動できません」。原因は2つ:
       ① 当たり判定が `hypot(x-左端, y-中心)` で、**帯は横いっぱい**（実測
          1390px）なので、帯の右側へ運ぶと別の段のタイルのほうが近くなり
          まったく違う群へ飛んだ
       ② 帯の左側へ落とすと`insertBefore(帯)`＝**ひとつ上の群**（いちばん上の
          帯なら「その他」が生まれる）
     つまり**帯の上のどこへ落としてもその群には入らなかった**。
     直したので、帯の左・中・右のどこでも「その帯の群」になる。 */
  const bandDrop=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid[data-op-place="準備"]');
   const tiles=[...grid.querySelectorAll('.op-tile')];
   const grab=tiles[tiles.length-1];
   grab.classList.add('is-dragging');
   const out=[];
   [...grid.querySelectorAll('.op-band')].forEach(bd=>{
    const r=bd.getBoundingClientRect();
    [r.left+6,r.left+r.width/2,r.right-6].forEach((x,i)=>{
     const at=WL.opBoard.dropAt(grid,{clientX:x,clientY:r.top+r.height/2});
     out.push({帯:bd.dataset.opBand,側:['左','中','右'][i],
               群:WL.opBoard.groupAt(grid,at)});
    });
   });
   grab.classList.remove('is-dragging');
   WL.opBoard.clearMark();
   return out;
  });
  const bandNG=bandDrop.filter(x=>x.帯!==x.群);
  rec('帯のどこへ落としてもその群へ入る（左・中・右）',
      bandDrop.length>=9&&bandNG.length===0,
      bandNG.length?JSON.stringify(bandNG.slice(0,4)):`${bandDrop.length}箇所を確認`);
  /* **狙った群が文字で出ること**（§CLAUDE 2）。線だけでは帯の上と下の
     どちらへ入るのかが読めない——「移動できません」はここから始まった。 */
  const tagged=await page.evaluate(()=>{
   const grid=document.querySelector('#masterMaintList .op-board-grid[data-op-place="準備"]');
   const bd=grid.querySelector('.op-band');
   const r=bd.getBoundingClientRect();
   const at=WL.opBoard.dropAt(grid,{clientX:r.left+r.width/2,clientY:r.top+r.height/2});
   WL.opBoard.mark(grid,at);
   const t=grid.querySelector('[data-op-mark] .op-drop-tag');
   const text=t?t.textContent:'';
   WL.opBoard.clearMark();
   return {帯:bd.dataset.opBand,文言:text};
  });
  rec('落とす先の群を文字で出す',
      tagged.文言.indexOf(tagged.帯)>=0,JSON.stringify(tagged));

  /* **同じ群が2つの帯に割れない**（§9.219 ③）。保存された表示順が入り
     混じっていても、盤は名前でまとめてから描く（`measure-opdata.js`の
     `groupsFor()`と同じ読み方）。割れると「その群へ入れる場所」が読めない。 */
  const split=await page.evaluate(()=>{
   const out={};
   document.querySelectorAll('#masterMaintList .op-board-grid').forEach(g=>{
    const pl=g.dataset.opPlace;
    const names=[...g.querySelectorAll('.op-band')].map(b=>b.dataset.opBand);
    const dup=names.filter((n,i)=>names.indexOf(n)!==i);
    if(dup.length)out[pl]=dup;
   });
   return out;
  });
  rec('同じ群が2つの帯に割れない',Object.keys(split).length===0,JSON.stringify(split));

  /* **一部だけを保存しても並びが壊れない**（§9.219 ③、サーバー側）。
     以前は渡された行に`(i+1)*10`を振り直していたため、1行だけ送ると
     その行が先頭へ飛び、群のあいだへ割り込んだ（実機の並びが実際にそう
     なっていた）。**席の入れ替え**で書くので、渡していない行との前後関係は
     動かない。 */
  const before8=await get('/api/operation-item-master');
  const idsBefore=(before8.items||[]).map(x=>x.id);
  const last=(before8.items||[])[(before8.items||[]).length-1];
  if(last){
   await post('/api/operation-item-master/layout',
     {items:[{id:last.id,group:last.group,place:last.place,span:last.span,
              required:last.required,enabled:true,fold:last.fold,showWhen:last.showWhen}],
      user_id:TAG});
   const after8=await get('/api/operation-item-master');
   const idsAfter=(after8.items||[]).map(x=>x.id);
   rec('1行だけ保存しても全体の並びが変わらない',
       idsBefore.join()===idsAfter.join(),
       idsBefore.join()===idsAfter.join()?`${idsAfter.length}件`
         :JSON.stringify({前:idsBefore.slice(0,6),後:idsAfter.slice(0,6)}));
  }else rec('1行だけ保存しても全体の並びが変わらない',false,'項目が無い');

  /* ---- 9) §9.220 ①②③④⑤: 形・初期値・手打ち・サジェスト・刻み ---- */
  /* ① **4つの形が見た目で違うこと**（利用者の指摘「ラジオボタンやタブが
     ほぼ同じデザインになっている」）。器のクラスだけを見る網では、同じ
     CSSを当ててしまっても通る——**実際に計算された見た目**（器の角丸・地・
     選んだ札の地・丸ぽちの有無）を突き合わせ、4つとも違うことを見る。 */
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(600);
  await openTile(mkj.id);
  const shapes={};
  for(const w of ['ラジオ','セグメント','タブ','ボタン群']){
   await page.click(`[data-op-widget="${w}"]`);
   await page.waitForTimeout(250);
   shapes[w]=await page.evaluate(()=>{
    const box=document.querySelector('#opPrevField .opf-widget');
    if(!box)return null;
    const sh=box.querySelector('.opf-shape');
    const btn=box.querySelector('[data-opv]');
    const cs=sh?getComputedStyle(sh):null,cb=btn?getComputedStyle(btn):null;
    return {器:box.className.replace('opf-widget ',''),
            丸:box.querySelectorAll('.opf-dot').length,
            角:cs?cs.borderRadius:'',地:cs?cs.backgroundColor:'',
            下線:cs?cs.borderBottomWidth:'',
            札角:cb?cb.borderRadius:'',札枠:cb?cb.borderTopWidth:''};
   });
  }
  /* **見た目だけで比べる**——器のクラス名を署名へ入れると、CSSを同じに
     してしまっても（名前が違うだけで）通ってしまう。 */
  const sigs=Object.keys(shapes).map(k=>{
   const v=Object.assign({},shapes[k]);delete v.器;return JSON.stringify(v);
  });
  rec('4つの形は見た目が全部違う（同じ絵を2つ作らない）',
      shapes['ラジオ']&&new Set(sigs).size===4,
      JSON.stringify(shapes,null,0).slice(0,400));
  rec('ラジオは丸ぽちで描く',(shapes['ラジオ']||{}).丸>0,
      JSON.stringify(shapes['ラジオ']));
  rec('セグメントは1本の帯（器に地と丸みがある）',
      !!(shapes['セグメント']&&shapes['セグメント'].地!=='rgba(0, 0, 0, 0)'
         &&shapes['セグメント'].角!=='0px'),JSON.stringify(shapes['セグメント']));
  rec('タブは下線で示す（器に地を持たない）',
      !!(shapes['タブ']&&shapes['タブ'].下線!=='0px'
         &&shapes['タブ'].地==='rgba(0, 0, 0, 0)'),JSON.stringify(shapes['タブ']));

  /* ③ 手打ち。**候補にない値も入る**——`<select>`へ`<option>`を足してから
     入れる（足さずに代入すると黙って空になる。§9.203の罠）。 */
  await page.click('#opdFreeText');
  await page.waitForTimeout(300);
  const freeBox=await page.evaluate(()=>{
   const el=document.querySelector('#opPrevField .opf-free-in');
   if(!el)return null;
   el.value='むらさき';
   el.dispatchEvent(new Event('input',{bubbles:true}));
   const sel=document.querySelector('#opPrevField select');
   return {打てる:true,選択値:sel?sel.value:'',
           候補に足した:sel?[...sel.options].some(o=>o.value==='むらさき'):false};
  });
  rec('手打ちを入にすると打ち込む欄が出て、打った値がそのまま値になる',
      !!freeBox&&freeBox.選択値==='むらさき'&&freeBox.候補に足した,
      JSON.stringify(freeBox));
  /* **1文字ごとに候補が増えないこと。** 打つたびに`<option>`を足すと
     「む」「むら」「むらさ」…が溜まり、次に組み直したとき打ちかけの文字が
     そのままボタンとして並ぶ。手打ちの席は1つだけ。 */
  const grew=await page.evaluate(()=>{
   const el=document.querySelector('#opPrevField .opf-free-in');
   const sel=document.querySelector('#opPrevField select');
   if(!el||!sel)return null;
   const before=sel.options.length;
   ['あ','あお','あおい','あおいろ'].forEach(v=>{
    el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));
   });
   return {前:before,後:sel.options.length,
           手打ちの席:sel.querySelectorAll('option[data-op-free="1"]').length,
           値:sel.value};
  });
  rec('何文字打っても手打ちの席は1つ（候補が増えない）',
      !!grew&&grew.手打ちの席===1&&grew.後===grew.前&&grew.値==='あおいろ',
      JSON.stringify(grew));

  /* ② 初期値。**入力の方法によらず効く**ので、見本にも入る。 */
  await page.fill('#opdInitial','金');
  /* **打ちかけの文字を捨てないこと。** ボタンを押すと窓は組み直されるので、
     控えていないと打った初期値が消える（実際にそうなっていた）。 */
  await page.click('[data-op-widget="ラジオ"]');
  await page.waitForTimeout(300);
  const kept=await page.evaluate(()=>(document.getElementById('opdInitial')||{}).value);
  rec('打ちかけの初期値は、別のボタンを押しても消えない',kept==='金',String(kept));
  await page.click('[data-op-widget="セグメント"]');
  await page.waitForTimeout(250);
  await page.click('#opdSave');
  await page.waitForTimeout(1600);
  const form9=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const f9=(form9.items||[]).find(x=>String(x.id)===String(mkj.id));
  rec('初期値と手打ちが測定画面の定義に出る',
      !!f9&&f9.initial==='金'&&f9.freeText===true,
      JSON.stringify(f9&&{initial:f9.initial,freeText:f9.freeText}));
  const prefill=await page.evaluate(()=>{
   const sel=document.querySelector('#opPrevField select');return sel?sel.value:'(無い)';
  });
  rec('見本にも初期値が入る（設定した値の見え方を確かめられる）',prefill==='金',prefill);

  /* ④ 選択肢のまとまり名のサジェスト。**理由を必ず添える**。 */
  const sug=await page.evaluate(()=>{
   const btns=[...document.querySelectorAll('#opItemModal [data-op-suggest]')];
   return {件数:btns.length,
           名前:btns.map(b=>b.dataset.opSuggest),
           理由:btns.map(b=>(b.querySelector('small')||{}).textContent||'')};
  });
  rec('選択肢のまとまり名を候補として出す',sug.件数>0,JSON.stringify(sug.名前));
  rec('候補には勧める理由を添える',
      sug.件数>0&&sug.理由.every(t=>t&&t.length>2),JSON.stringify(sug.理由));
  if(sug.件数>0){
   await page.click(`#opItemModal [data-op-suggest="${sug.名前[0]}"]`);
   await page.waitForTimeout(300);
   const picked=await page.evaluate(()=>{
    const el=document.getElementById('opdChoice');return el?el.value:'';
   });
   rec('候補を押すとそのまとまりが当たる',picked===sug.名前[0],picked);
   /* 元へ戻す（この項目は他の網でも使う）。 */
   await page.evaluate(n=>{
    const el=document.getElementById('opdChoice');
    if(el){el.value=n;el.dispatchEvent(new Event('change',{bubbles:true}))}
   },TAG_+'-色');
   await page.waitForTimeout(300);
  }

  /* ⑤ 刻み。**押した1回ぶんがマスタの値になる**（既定は小数桁から作る）。 */
  const mkn=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 刻み',type:'正の数',decimals:1,
     step:0.5,widget:'ステッパー',user_id:TAG});
  const mknj=await mkn.json();
  if(mknj.id)made.push(mknj.id);
  await closeModal();
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  await openTile(mknj.id);
  const step=await page.evaluate(()=>{
   const el=document.querySelector('#opPrevField input');
   const up=document.querySelector('#opPrevField [data-opstep="1"]');
   if(!el||!up)return null;
   el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));
   up.click();up.click();
   return {値:el.value,刻みの欄:(document.getElementById('opdStep')||{}).value};
  });
  rec('マスタで決めた刻みで増える（小数桁からの既定ではない）',
      !!step&&step.値==='2.0'&&String(step.刻みの欄)==='0.5',JSON.stringify(step));
  await closeModal();

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
