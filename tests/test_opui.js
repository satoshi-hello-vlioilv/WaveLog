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
/* 組み込みの行の並び・幅・出す出さないは**実行をまたいで生き延びる**
   （§9.121。`db/master.sqlite3`に残る）。落ちた場所によらず戻せるよう、
   触る前に元の姿をここへ積み、`finally`で戻す——途中に書いた戻しだけでは
   FATALが挟まった実行が次の実行を汚す（実際に`test_msteps`が巻き込まれた）。 */
const restore=[];
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1800,height:1000}});
 const TAG_=TAG;const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 /* タイルを押して設定の窓が開くのを待つ。**窓が開くまで待つこと**——
    開く前に中を読むと、直っていても落ちる網になる。 */
 /* 決めることは**タブで4段**（§9.223 ②）。段を開いてから中を見る。 */
 const tab=async k=>{
  await page.evaluate(key=>{
   const b=document.querySelector(`#opModalTabs [data-op-tab="${key}"]`);
   if(!b)throw Error('タブが無い: '+key);
   b.click();
  },k);
  await page.waitForFunction(key=>{
   const b=document.querySelector(`#opModalTabs [data-op-tab="${key}"]`);
   return !!b&&b.classList.contains('is-on');
  },k,{timeout:8000});
 };
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
  /* 決めることは**タブで4段**に分かれた（§9.223 ②、利用者の指示）。
     実際の操作と同じ順で辿ること——タブを開かずに中の欄を探すと、
     「無い」のか「別の段にある」のかを見分けられない。 */
  await tab('data');
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
    役割の欄:!!document.getElementById('opdRole'),
    理由:/画面がもともと持っている部品/.test(m.textContent||''),
    逃げ道:/同じ役割を持たせて/.test(m.textContent||''),
   };
  });
  rec('タイルを押すと設定のモーダルが開く',built.開いた===true,built.題);
  rec('モーダルの左に実物の見本が出る',built.見本===true&&built.見本の幅>40,
      `幅${built.見本の幅}`);
  rec('組み込みの欄では型を選ばせない（効かない欄を置かない）',built.型の欄===false);
  /* **できないことは、逃げ道つきで書く**（§9.223 ①）。型は画面の部品で
     決まるが、**同じ役割を別の項目へ移せば自由な型で記録できる**——
     行き止まりのままにしない。 */
  rec('型を変えられない理由と、その逃げ道を書く',
      built.理由===true&&built.逃げ道===true,JSON.stringify(built));
  rec('役割の欄がある（必須は構成が持つ）',built.役割の欄===true,JSON.stringify(built));
  await tab('place');
  const where=await page.evaluate(()=>({
    幅の欄:!!document.querySelector('[data-op-span]'),
    置き場の欄:!!document.querySelector('[data-op-place]'),
    必須の欄:!!document.getElementById('opdRequired')}));
  rec('組み込みでも幅・置き場・必須は決められる',
      where.幅の欄&&where.置き場の欄&&where.必須の欄,JSON.stringify(where));
  /* §9.223 ③（利用者の指示「6種類しかないので…バリエーションを増やして」）。
     選択肢の型では8つ。**見本つき**であることも見る——名前だけで選ばせない。 */
  await tab('look');
  const lookPane=await page.evaluate(()=>({
    選ばせ方:[...document.querySelectorAll('[data-op-widget]')].map(x=>x.dataset.opWidget),
    見本:document.querySelectorAll('.op-widget-demo .opd').length,
    色:document.querySelectorAll('[data-op-look="color"]').length,
    形:document.querySelectorAll('[data-op-look="shape"]').length,
    大きさ:document.querySelectorAll('[data-op-look="size"]').length,
    並べ方:document.querySelectorAll('[data-op-layout]').length}));
  /* §9.226 ①で`段階`と`入切`を足した（選択肢を持つ型では10）。
     **数だけでなく綴りまで見る**——名前が変わるとマスタの保存値が
     「知らない値」になってプルダウンへ倒れる（保存済みの設定が黙って消える）。 */
  rec('選ばせ方は10から選ぶ（段階・入切を足した）',
      lookPane.選ばせ方.join('/')==='プルダウン/ラジオ/セグメント/タブ/ボタン群/一覧/カード/トグル/段階/入切',
      JSON.stringify(lookPane.選ばせ方));
  /* **並べ方は選ばせ方とは別の軸**（§9.226 ①）。効かない形では欄ごと
     出さない（§4）ので、ここではプルダウンなので0件が正しい。 */
  rec('並べ方はプルダウンでは選ばせない（並べる先が無い）',
      lookPane.並べ方===0,JSON.stringify({並べ方:lookPane.並べ方}));
  rec('選ばせ方の札には実データ入りの見本が付く',
      lookPane.見本===lookPane.選ばせ方.length,JSON.stringify({見本:lookPane.見本,札:lookPane.選ばせ方.length}));
  rec('意匠は色・形・大きさの3軸で選べる',
      lookPane.色>=8&&lookPane.形>=3&&lookPane.大きさ>=3,JSON.stringify(lookPane));

  /* ---- 3) 幅を変えて保存するとマスタに入る ---- */
  const before=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const target=(before.items||[]).find(x=>x.builtin==='verticalCount');
  rec('前提: 組み込みの行がマスタにある',!!target,target?`span=${target.span}`:'なし');
  if(target)restore.push({id:target.id,group:target.group,place:target.place,
    span:target.span,required:target.required,enabled:true,fold:target.fold,
    showWhen:target.showWhen});
  await openTile(target.id);
  await tab('place');
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
  if(off)restore.push({id:off.id,group:off.group,place:off.place,span:off.span,
    required:off.required,enabled:true,fold:off.fold,showWhen:off.showWhen});
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
  await tab('data');
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
  await tab('look');
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
  /* **保存すると窓は閉じる**（§9.222 ⑦）。続きを触るには開き直す。 */
  await openTile(mkj.id);
  /* **型ごとに効く形だけを出す**（§9.219 ③、利用者の指示「UIの種類を
     増やしたり」）。以前は選択肢を持たない型では選ばせ方を全部押せなく
     していたが、いまは数値・自由記述にもそれぞれの道具がある。
     **効かない形は並べない**（押せるのに何も起きない設定を作らない・§4）。 */
  await tab('data');
  await page.click('[data-op-type="文字"]');
  await page.waitForTimeout(250);
  await tab('look');
  const textW=await page.evaluate(()=>
    [...document.querySelectorAll('[data-op-widget]')].map(b=>b.dataset.opWidget));
  rec('自由記述の型では「メモ」が選べ、選択肢向けの形は並ばない',
      textW.includes('メモ')&&!textW.includes('ラジオ')&&!textW.includes('タブ'),
      JSON.stringify(textW));
  await tab('data');
  await page.click('[data-op-type="正の整数"]');
  await page.waitForTimeout(250);
  await tab('look');
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
  await tab('data');
  await page.click('[data-op-type="選択"]');
  await page.waitForTimeout(200);
  await tab('look');
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
  await tab('look');
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
  await tab('data');
  await page.click('#opdFreeText');
  await page.waitForTimeout(300);
  /* **形をプルダウンへ戻してから見る**——直前のループでボタン群になって
     いる。手打ちの見せ方は形ごとに違う（プルダウン＝器そのものが打てる、
     ボタン系＝末尾の「その他」）ので、どちらを見ているかを決めてから測る。 */
  await tab('look');
  await page.click('[data-op-widget="プルダウン"]');
  await page.waitForTimeout(400);
  /* **打つ場所は「選ぶ器そのもの」**（§9.226 ①、利用者の指示）。以前は
     選ぶ器の下に打ち込み欄をもう1つ足していた（`.opf-free-in`）ので、
     打つ場所と選ぶ場所が2つ並んでいた。いまはプルダウンなら器が
     コンボボックス（`.opf-combo-in`）になり、**素の`<select>`は裏へ回る**。 */
  const freeBox=await page.evaluate(()=>{
   const el=document.querySelector('#opPrevField .opf-combo-in');
   if(!el)return null;
   el.value='むらさき';
   el.dispatchEvent(new Event('input',{bubbles:true}));
   const sel=document.querySelector('#opPrevField select');
   return {打てる:true,選択値:sel?sel.value:'',
           別の欄を足していない:!document.querySelector('#opPrevField .opf-free-in'),
           選ぶ器が兼ねている:!!document.querySelector('#opPrevField .opf-combo-open'),
           候補に足した:sel?[...sel.options].some(o=>o.value==='むらさき'):false};
  });
  rec('手打ちは「選ぶ器そのもの」で打てる（欄を2つ並べない）',
      !!freeBox&&freeBox.選択値==='むらさき'&&freeBox.候補に足した
      &&freeBox.別の欄を足していない&&freeBox.選ぶ器が兼ねている,
      JSON.stringify(freeBox));
  /* **1文字ごとに候補が増えないこと。** 打つたびに`<option>`を足すと
     「む」「むら」「むらさ」…が溜まり、次に組み直したとき打ちかけの文字が
     そのままボタンとして並ぶ。手打ちの席は1つだけ。 */
  const grew=await page.evaluate(()=>{
   const el=document.querySelector('#opPrevField .opf-combo-in');
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
  /* ボタン系は**末尾の「その他」がその場で入力欄に変わる**（§9.226 ①）。
     欄を下へ足さないので、器の高さも並びも他の項目と同じまま。 */
  await page.click('[data-op-widget="ボタン群"]');
  await page.waitForTimeout(500);
  const other=await page.evaluate(()=>{
   const w=document.querySelector('#opPrevField .opf-widget');
   const btn=w&&w.querySelector('.opf-other-btn');
   const inp=w&&w.querySelector('.opf-other-in');
   if(!btn||!inp)return null;
   const 前=getComputedStyle(inp).display;
   btn.click();
   const 後=getComputedStyle(inp).display;
   inp.value='特注';inp.dispatchEvent(new Event('input',{bubbles:true}));
   const sel=document.querySelector('#opPrevField select');
   return {前,後,値:sel.value,
           /* 席は選択肢の並びの中（下へ別の欄を足していない）。 */
           並びの中:!!(w.querySelector('.opf-shape .opf-other'))};
  });
  rec('ボタン系の手打ちは末尾の席がその場で入力欄に変わる',
      !!other&&other.前==='none'&&other.後!=='none'&&other.値==='特注'
      &&other.並びの中===true,JSON.stringify(other));
  /* **②の段へ戻す**——このあとの網は`#opdInitial`（②の欄）を触る。
     段を戻さないと「欄が無い」で落ちる（直っていても落ちる網になる）。 */
  await tab('data');

  /* ② 初期値。**入力の方法によらず効く**ので、見本にも入る。 */
  await page.fill('#opdInitial','金');
  /* **打ちかけの文字を捨てないこと。** ボタンを押すと窓は組み直されるので、
     控えていないと打った初期値が消える（実際にそうなっていた）。
     **段をまたいでも消えないこと**（§9.223 ②）——決めることは4段に分かれた
     ので、②で打ってから③のボタンを押すのが普通の道筋になった。 */
  await tab('look');
  await page.click('[data-op-widget="ラジオ"]');
  await page.waitForTimeout(300);
  await tab('data');
  const kept=await page.evaluate(()=>(document.getElementById('opdInitial')||{}).value);
  rec('打ちかけの初期値は、別のボタンを押しても消えない',kept==='金',String(kept));
  /* **打った段を離れたまま保存しても消えない**（§9.223 ②）。いま描かれて
     いるのは1段ぶんだけなので、DOMだけを見て保存を組み立てると、②の設定が
     まるごと空で上書きされる（`item_upsert`は全列を書く）。 */
  await tab('look');
  await page.click('[data-op-widget="セグメント"]');
  await page.waitForTimeout(250);
  await page.click('#opdSave');
  await page.waitForTimeout(1600);
  const form9=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const f9=(form9.items||[]).find(x=>String(x.id)===String(mkj.id));
  rec('初期値と手打ちが測定画面の定義に出る',
      !!f9&&f9.initial==='金'&&f9.freeText===true,
      JSON.stringify(f9&&{initial:f9.initial,freeText:f9.freeText}));
  /* **保存すると窓は閉じる**（§9.222 ⑦、利用者の指示）。見本は窓の中なので、
     続きを見るには開き直す。 */
  await openTile(mkj.id);
  const prefill=await page.evaluate(()=>{
   const sel=document.querySelector('#opPrevField select');return sel?sel.value:'(無い)';
  });
  rec('見本にも初期値が入る（設定した値の見え方を確かめられる）',prefill==='金',prefill);

  /* ④ 選択肢のまとまり名のサジェスト。**理由を必ず添える**。 */
  await tab('data');
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

  /* ==========================================================
     §9.221 ⑦ 単位の位置・値の寄せ・値の見せ方
     ----------------------------------------------------------
     利用者の指示「単位を出す位置(外上左、外上中央、外上右、内部、外下左、
     外中央、外下右)、出し方、データの表示方法、桁数、左詰め、右詰め、
     中央寄せなど、さらにカスタマイズできるように」。
     **見本は本物の部品**なので、盤を押した結果がそのまま出る。
     ========================================================== */
  const mku=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 単位',type:'正の数',decimals:1,unit:'mm',user_id:TAG});
  const mkuj=await mku.json();
  if(mkuj.id)made.push(mkuj.id);
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  await openTile(mkuj.id);
  /* 単位の置き場・寄せ・見せ方は③（どう見せるか）。 */
  await tab('look');
  const pad=await page.evaluate(()=>{
   const cells=[...document.querySelectorAll('#opItemModal [data-op-unitplace]')];
   return {盤:cells.map(c=>c.dataset.opUnitplace),
           選択中:cells.filter(c=>c.classList.contains('is-on')).map(c=>c.dataset.opUnitplace)};
  });
  rec('単位の置き場を9マスの盤で選べる',
      ['外上左','外上中央','外上右','内部','外下左','外下中央','外下右','出さない']
        .every(v=>pad.盤.includes(v)),pad.盤.join('/'));
  rec('既定は「外下左」（今までの見え方）',pad.選択中.join('/')==='外下左',pad.選択中.join('/'));
  /* **既定のとおり、単位は欄の下に左詰めで出ている**（クラスの有無だけを
     見ると、器が無くても通る）。 */
  const at0=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   const line=l&&l.querySelector('.opf-unit-line');
   return {place:l&&l.dataset.opunit,at:line&&line.dataset.at,text:line&&line.textContent};
  });
  rec('見本にも単位が既定の場所で出る',
      at0.place==='外下左'&&at0.at==='左'&&at0.text==='mm',JSON.stringify(at0));
  await page.click('#opItemModal [data-op-unitplace="内部"]');
  await page.waitForTimeout(400);
  const inside=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   const em=l&&l.querySelector('.opf-unit-in');
   const ctl=l&&l.querySelector('input,select');
   if(!em||!ctl)return{none:true};
   const a=em.getBoundingClientRect(),b=ctl.getBoundingClientRect();
   const r=x=>[Math.round(x.left),Math.round(x.top),Math.round(x.right),Math.round(x.bottom)].join(',');
   /* **欄の中に重なっていること**を実寸で見る（クラスだけでは下に並んでいても通る）。
      落ちたときに「どちらの軸でずれたか」が読めるように、段と矩形も出す。 */
   return {place:l.dataset.opunit,
     重なっている:a.left>=b.left-1&&a.right<=b.right+1&&a.top>=b.top-2&&a.bottom<=b.bottom+2,
     右寄り:(a.left-b.left)>(b.width/2),
     単位の段:getComputedStyle(em).gridRow,欄の段:getComputedStyle(ctl).gridRow,
     単位:r(a),欄:r(b),器:r(l.getBoundingClientRect()),
     欄の幅指定:getComputedStyle(ctl).width,欄の最大:getComputedStyle(ctl).maxWidth,
     器の列:getComputedStyle(l).gridTemplateColumns,
     子:[...l.children].map(c=>c.className||c.tagName).join('/')};
  });
  rec('「内部」で単位が欄の中に重なる',
      !inside.none&&inside.place==='内部'&&inside.重なっている&&inside.右寄り,JSON.stringify(inside));
  await page.click('#opItemModal [data-op-unitplace="出さない"]');
  await page.waitForTimeout(400);
  const none=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   return {place:l&&l.dataset.opunit,
           単位:!!(l&&l.querySelector('.opf-unit'))};
  });
  rec('「出さない」で単位が消える',none.place==='なし'&&none.単位===false,JSON.stringify(none));
  await page.click('#opItemModal [data-op-unitplace="外上中央"]');
  await page.waitForTimeout(300);
  await page.click('#opItemModal [data-op-align="右"]');
  await page.waitForTimeout(300);
  await page.click('#opItemModal [data-op-vfmt="3桁区切り"]');
  await page.waitForTimeout(400);
  const look=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   const ctl=l&&l.querySelector('input');
   if(!ctl)return{none:true};
   ctl.value='1234';ctl.dispatchEvent(new Event('input',{bubbles:true}));
   ctl.dispatchEvent(new Event('blur',{bubbles:true}));
   return {align:l.dataset.opalign,寄せ:getComputedStyle(ctl).textAlign,
     fmt:ctl.dataset.opfmt,値:ctl.value,
     桁数の欄:!!document.getElementById('opdDigits')};
  });
  rec('値の寄せが効く（右詰め）',!look.none&&look.align==='右'&&look.寄せ==='right',JSON.stringify(look));
  rec('3桁区切りは欄を離れたときに当たる',!look.none&&look.値==='1,234.0',JSON.stringify(look));
  /* **保存して読み直しても残る**（§9.113の「送り漏らすと消える」の網）。 */
  await page.click('#opdSave');
  await page.waitForTimeout(1500);
  const back=await (await fetch(B+'/api/operation-item-master')).json();
  const savedItem=(back.items||[]).find(x=>x.id===mkuj.id)||{};
  rec('単位の置き場・寄せ・見せ方が保存される',
      savedItem.unitPlace==='外上中央'&&savedItem.align==='右'&&savedItem.valueFormat==='3桁区切り',
      JSON.stringify({p:savedItem.unitPlace,a:savedItem.align,f:savedItem.valueFormat,u:savedItem.unit}));
  rec('単位そのものも消えていない',savedItem.unit==='mm',String(savedItem.unit));
  /* 保存で窓が閉じたことを見る（§9.222 ⑦）。**閉じるのは成功したときだけ**。 */
  const closedAfterSave=await page.evaluate(()=>{
   const m=document.getElementById('opItemModal');return !m||m.hidden;
  });
  rec('保存すると設定の窓が閉じる',closedAfterSave===true,String(closedAfterSave));
  await closeModal();

  /* ==========================================================
     §9.221 ⑦の追補: **`<select>`には見せ方を当てない**
     ----------------------------------------------------------
     値が選択肢そのものなので、3桁区切りやゼロ埋めを掛けると
     `putValue()`が`1234`を`1,234`にし、どの`<option>`にも当たらず
     **`select.value`が空になる**——画面から記録が消え、そのまま保存すると
     空で上書きされる。型を「選択」に変えても`[表示書式]`は保存値として
     残る（widgetと同じ約束）ので、この組み合わせは普通に作れる。
     **確かめるときは実際に値を入れて`select.value`を読むこと**
     ——`data-opfmt`の有無だけを見ると、当てた先が`<input>`でも通る。
     ========================================================== */
  const mkc=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 選択',type:'選択',choice:TAG+'g',
     valueFormat:'3桁区切り',unit:'mm',user_id:TAG});
  const mkcj=await mkc.json();
  if(mkcj.id)made.push(mkcj.id);
  const chSel=await post('/api/operation-choice-master',{name:TAG+'g',value:'1234',user_id:TAG});
  const chSelJ=await chSel.json();if(chSelJ.id)madeChoices.push(chSelJ.id);
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  await openTile(mkcj.id);
  const sel=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   const s=l&&l.querySelector('select');
   if(!s)return{none:true};
   /* 選択肢そのものの値を入れて、整形で潰れないことを見る。 */
   s.value='1234';s.dispatchEvent(new Event('change',{bubbles:true}));
   s.dispatchEvent(new Event('blur',{bubbles:true}));
   return{fmt:s.dataset.opfmt||'',値:s.value,
     選択肢:[...s.options].map(o=>o.value).join('/')};
  });
  /* 見るのは**印が付いていないこと**の1点。見本の`<select>`は`apply()`を
     通らないので「値が消えていない」を並べても壊れていても通ってしまう
     （実際に、印を外す前でも値だけは`1234`のままだった）。印が付かなければ
     `putValue()`は素通しになる——そこが1本の道。 */
  rec('「選択」型の見本では<select>に見せ方が付かない',
      !sel.none&&sel.fmt==='',JSON.stringify(sel));
  await closeModal();

  /* ==========================================================
     §9.223 ①③④ 役割・意匠・メモ
     ========================================================== */
  /* ---- ① 役割を別の項目へ移すと、組み込みの欄が下がる ----
     窓には「役割を別の項目へ移すと、この欄は自動で下がります」と書いて
     ある。**書いたことが起きること**を見る（§4）——起きないと、同じ役割の
     欄が2つ並び、どちらの値が使われるのか決められない。 */
  const beforeRole=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const hadSpool=(beforeRole.items||[]).some(x=>x.builtin==='spool');
  rec('前提: 組み込みの「スプール」が測定画面の定義に居る',hadSpool===true,
      String((beforeRole.items||[]).length)+'件');
  const mkr=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 巻取り',type:'選択',choice:TAG+'-色',
     role:'spool',user_id:TAG});
  const mkrj=await mkr.json();
  if(mkrj.id)made.push(mkrj.id);
  const afterRole=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  rec('役割を引き取ると組み込みの欄は測定画面から下がる',
      !(afterRole.items||[]).some(x=>x.builtin==='spool')
      &&(afterRole.builtinOff||[]).includes('spool'),
      JSON.stringify({居る:(afterRole.items||[]).some(x=>x.builtin==='spool'),
                      下がった:(afterRole.builtinOff||[]).includes('spool')}));
  rec('引き取った項目のほうは残る',
      (afterRole.items||[]).some(x=>String(x.id)===String(mkrj.id)),String(mkrj.id));
  /* **下がったぶんを「二重」と数えないこと**——数えると、正しく付け替えた
     構成が永久に赤いままになる（直しようのない指摘・§4）。 */
  const repo=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const rr=repo.roleReport||{};
  rec('正しく付け替えた役割を「二重」と言わない',
      Array.isArray(rr.duplicated)&&!rr.duplicated.includes('spool'),
      JSON.stringify(rr.duplicated));
  rec('下がった欄は名指しで返す（画面が理由を書けるように）',
      (rr.steppedDown||[]).some(h=>h.builtin==='spool'),
      JSON.stringify((rr.steppedDown||[]).map(h=>h.builtin)));
  /* 画面にも出る（探させない・§2）。 */
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  const stripTxt=await page.evaluate(()=>{
   const el=document.querySelector('.op-role-strip');return el?el.textContent||'':'';
  });
  rec('構成チェックが「下がった欄」を文字で言う',/役割を譲って下がった欄/.test(stripTxt),
      stripTxt.slice(0,160));
  /* 役割を外すと戻る（行き止まりにしない）。 */
  await post('/api/operation-item-master/update',
    {id:mkrj.id,user_id:TAG,equipment:EQ,group:TAG,name:TAG+' 巻取り',type:'選択',
     choice:TAG+'-色',role:'',note:''});
  const backRole=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  rec('役割を外すと組み込みの欄が戻る',
      (backRole.items||[]).some(x=>x.builtin==='spool'),
      JSON.stringify((backRole.builtinOff||[])));

  /* ---- ③ 意匠（色・形・大きさ）は保存され、測定画面の定義に出る ----
     **押した結果が保存されること**を見る（§9.113の「送り漏らすと消える」）。 */
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(700);
  await openTile(mkrj.id);
  await tab('look');
  await page.click('#opItemModal [data-op-look="color"][data-op-val="緑"]');
  await page.waitForTimeout(250);
  await page.click('#opItemModal [data-op-look="shape"][data-op-val="丸"]');
  await page.waitForTimeout(250);
  await page.click('#opItemModal [data-op-look="size"][data-op-val="大"]');
  await page.waitForTimeout(300);
  /* 見本にその場で当たる（保存する前に確かめられる・§9.218 ①）。 */
  const lookNow=await page.evaluate(()=>{
   const l=document.querySelector('#opPrevField .opf');
   return l?[...l.classList].filter(c=>/^opf-(c|r|z)-/.test(c)).sort().join('/'):'(無い)';
  });
  rec('意匠は押した瞬間に見本へ当たる',lookNow==='opf-c-green/opf-r-pill/opf-z-lg',lookNow);
  await page.click('#opdSave');
  await page.waitForTimeout(1600);
  const lookForm=await get('/api/operation-form?equipment='+encodeURIComponent(EQ));
  const lf=(lookForm.items||[]).find(x=>String(x.id)===String(mkrj.id));
  rec('意匠が保存され、測定画面の定義に出る',
      !!lf&&lf.look&&lf.look.color==='緑'&&lf.look.shape==='丸'&&lf.look.size==='大',
      JSON.stringify(lf&&lf.look));
  /* **意匠を触っただけで他の設定が消えないこと**（§9.212 ②と同じ形の
     不具合。決めることを段に分けたので、③だけを触って保存する道がある）。 */
  rec('意匠を触っても名前・型・選択肢は消えない',
      !!lf&&lf.name===TAG_+' 巻取り'&&lf.type==='選択'&&lf.choice===TAG_+'-色',
      JSON.stringify(lf&&{name:lf.name,type:lf.type,choice:lf.choice}));

  /* ---- ④ メモは広い（利用者の指示「メモ欄狭すぎる」） ----
     **実寸で見る**——`rows`だけを見ると、CSSが高さを潰していても通る。 */
  await openTile(mkrj.id);
  await tab('note');
  const memo=await page.evaluate(()=>{
   const el=document.getElementById('opdNote');
   if(!el)return null;
   const r=el.getBoundingClientRect();
   const cs=getComputedStyle(el);
   const line=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.5;
   return {高さ:Math.round(r.height),幅:Math.round(r.width),
           行数:Math.round(r.height/line),tag:el.tagName};
  });
  rec('メモは複数行の広い欄',
      !!memo&&memo.tag==='TEXTAREA'&&memo.行数>=6&&memo.幅>=280,JSON.stringify(memo));
  await closeModal();

  /* ================================================================
     §9.226 ①③（利用者の指示「UIの種類をもっと増やしてほしい」
     「同じUIでもいくつかパターンがあるとよい」「まとまりを作りやすく
      できるように列にも区切りをつけられるようにしたい」）
     ================================================================ */
  /* ---- 見本は実物と同じ大きさ（利用者の指摘「再現する部分の表示エリアの
     横幅が足りず、見切れています」）。**1マスの実寸で組む**ので、
     文字が実物と同じ比率で入る（縮めると確かめられない絵になる）。 ---- */
  /* **選択肢が2つ以上ある項目で見る**（段階は空の選択肢を並べないので、
     1つしか無いと段が1本になり、塗りの網が何も確かめない）。
     **前の網が値を消しているので、ここで注ぎ直す**——「無ければ素通り」に
     すると、塗りが1段でも通ってしまう（§CLAUDE「材料ごと注ぎ込む」）。 */
  for(const v of ['一','二','三']){
   const r=await post('/api/operation-choice-master',
     {name:TAG+'-段',value:v,user_id:TAG});
   const j=await r.json();if(j.id)madeChoices.push(j.id);
  }
  const mkS=await post('/api/operation-item-master',
    {equipment:EQ,group:TAG,name:TAG+' 段',type:'選択',choice:TAG+'-段',user_id:TAG});
  const mkSj=await mkS.json();
  if(mkSj.id)made.push(mkSj.id);
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('#masterMaintList .op-board-grid',{timeout:20000});
  await page.waitForTimeout(600);
  await openTile(mkSj.id);
  await tab('look');
  const scale=await page.evaluate(()=>{
   const card=document.querySelector('.op-prev-card');
   if(!card)return null;
   const cs=getComputedStyle(card).gridTemplateColumns.split(/\s+/).filter(Boolean);
   return {列:cs.length,マス幅:Math.round(parseFloat(cs[0])||0),
           /* 器に入らないときは横へ流す（縮めない）。 */
           流す:!!document.querySelector('.op-prev-scroll')};
  });
  /* 実測の1マスは1920幅で94px。**60px未満なら縮んでいる**（以前は56px）。 */
  rec('見本は実物と同じ大きさの1マスで組む（縮めない）',
      !!scale&&scale.列===12&&scale.マス幅>=60&&scale.流す===true,JSON.stringify(scale));

  /* ---- 並べ方は選ばせ方とは別の軸。**効く形でだけ選ばせる**（§4） ---- */
  await page.evaluate(()=>{
   const b=document.querySelector('[data-op-widget="ボタン群"]');if(b)b.click();
  });
  await page.waitForTimeout(500);
  const lay=await page.evaluate(()=>({
   選べる:[...document.querySelectorAll('[data-op-layout]')].map(x=>x.dataset.opLayout),
   いま:(document.querySelector('[data-op-layout].is-on')||{}).dataset,
  }));
  rec('選択肢を並べる形では並べ方を選べる',
      lay.選べる.length>=5&&lay.選べる.indexOf('2列')>=0,JSON.stringify(lay.選べる));
  await page.evaluate(()=>{
   const b=document.querySelector('[data-op-layout="2列"]');if(b)b.click();
  });
  await page.waitForTimeout(600);
  const applied=await page.evaluate(()=>{
   const w=document.querySelector('#opPrevField .opf-widget');
   if(!w)return null;
   const shape=w.querySelector('.opf-shape');
   return {印:[...w.classList].filter(c=>/^opf-l-/.test(c)),
           列:shape?getComputedStyle(shape).gridTemplateColumns.split(/\s+/).filter(Boolean).length:0};
  });
  rec('並べ方は見本にその場で効く（2列なら2列で並ぶ）',
      !!applied&&applied.印.indexOf('opf-l-g2')>=0&&applied.列===2,JSON.stringify(applied));

  /* ---- 段階は「選んだところまで塗る」。**数だけでなく塗りを見る**
     ——1つだけ光る作りでも「印が付く」網は通ってしまう。 ---- */
  await page.evaluate(()=>{
   const b=document.querySelector('[data-op-widget="段階"]');if(b)b.click();
  });
  await page.waitForTimeout(600);
  const stage=await page.evaluate(()=>{
   const w=document.querySelector('#opPrevField .opf-stage');
   if(!w)return null;
   /* **段だけを数える**（手打ちの「その他」の席は`data-opv`を持たない）。 */
   const btns=[...w.querySelectorAll('.opf-stage-btn[data-opv]')];
   if(btns.length<2)return {段:btns.length};
   btns[1].click();
   return {段:btns.length,
           塗り:btns.map(b=>b.classList.contains('is-fill')),
           選んだ:btns.map(b=>b.classList.contains('is-on'))};
  });
  rec('段階は選んだところまで塗る',
      !!stage&&stage.段>=2&&stage.塗り[0]===true&&stage.塗り[1]===true
      &&stage.選んだ[1]===true&&stage.選んだ[0]===false,JSON.stringify(stage));

  /* ---- 入切は1つのスイッチ。**状態を文字でも出す**（§3） ---- */
  await page.evaluate(()=>{
   const b=document.querySelector('[data-op-widget="入切"]');if(b)b.click();
  });
  await page.waitForTimeout(600);
  const sw=await page.evaluate(()=>{
   const w=document.querySelector('#opPrevField .opf-switch');
   const b=w&&w.querySelector('.opf-switch-btn');
   if(!b)return null;
   const sel=document.querySelector('#opPrevField select');
   const before={文字:b.querySelector('.opf-switch-text').textContent,値:sel.value};
   b.click();
   return {前:before,後:{文字:b.querySelector('.opf-switch-text').textContent,値:sel.value}};
  });
  rec('入切は1つのスイッチで、状態を文字でも出す',
      !!sw&&sw.前.文字!==sw.後.文字&&sw.前.値!==sw.後.値,JSON.stringify(sw));
  await closeModal();

  /* ---- 群を列でも区切れる（§9.226 ③）。**盤と測定画面は同じ関数**で
     割り付けるので、ここでは盤で見る（横に並ぶこと＝同じ段・違う左端）。 ---- */
  const bands=await page.$$eval('#masterMaintList .op-band',es=>es.map(e=>e.dataset.opBand));
  let side={前提なし:bands.length<2};
  if(bands.length>=2){
   for(const n of bands.slice(0,2)){
    await page.evaluate(nm=>{
     const b=document.querySelector(`.op-band[data-op-band="${nm}"] [data-op-gspan="6"]`);
     if(b)b.click();
    },n);
    await page.waitForFunction(()=>!/保存しています/.test(
      (document.querySelector('#opLayoutState')||{}).textContent||''),null,{timeout:8000})
      .catch(()=>{});
    await page.waitForTimeout(900);
   }
   side=await page.evaluate(bs=>{
    const r=bs.slice(0,2).map(n=>{
     const e=document.querySelector(`.op-band[data-op-band="${n}"]`);
     if(!e)return null;
     const b=e.getBoundingClientRect();
     return {n,x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width)};
    });
    return {a:r[0],b:r[1]};
   },bands);
   /* 戻す（§9.121。盤の設定は実行をまたいで生き延びる）。 */
   for(const n of bands.slice(0,2)){
    await page.evaluate(nm=>{
     const b=document.querySelector(`.op-band[data-op-band="${nm}"] [data-op-gspan="0"]`);
     if(b)b.click();
    },n);
    await page.waitForTimeout(900);
   }
  }
  rec('群に幅を与えると横に並ぶ（列でも区切れる）',
      !side.前提なし&&!!side.a&&!!side.b&&side.a.y===side.b.y&&side.b.x>side.a.x,
      JSON.stringify(side));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **触った組み込みの行を必ず元へ戻す**（§9.121）。消せない行なので、
     戻さないと次の実行が「幅6のまま・spoolは出さない」から始まる。 */
  for(const r of restore){
   try{await post('/api/operation-item-master/layout',{items:[r],user_id:TAG})}catch(e){}
  }
  for(const id of made){try{await post('/api/operation-item-master/delete',{id,user_id:TAG})}catch(e){}}
  for(const id of madeChoices){try{await post('/api/operation-choice-master/delete',{id,user_id:TAG})}catch(e){}}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
