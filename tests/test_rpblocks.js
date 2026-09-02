/* test_rpblocks.js: 帳票の塊（ブロック）と配置の組み換え（§9.169）
   ============================================================
   利用者の指示は「データの塊ごとに(カードのように扱い)表示非表示を修正
   できるように／リアルタイムでその表示状況を確認しながら帳票の配置
   (グリッド化)も組み換えできるように／汎用的な構造に」。

   ここで固定するのは5点。
     1. 紙は24マス×48段のグリッドで、塊が`grid-column:span N`で載る（§9.222 ②）
     2. 組み換え中だけ操作帯が出る（**紙には1つも出ない**）
     3. 触った結果がその場の紙に出る（幅・隠す・並べ替え）
     4. 「やめる」で開いた時点へ戻り、「保存」でサーバーに残る
     5. 幅はマスの数として往復する——列レイアウトマスタの`widths`はpxとして
        40〜900へ丸められるので、マスの数をそのまま入れると全部40になり
        **保存した幅が黙って既定へ戻る**（実際にそうなった）

   後片付けは finally で必ず行う。**列レイアウトマスタは実行をまたいで
   生き延びる**（§9.121）ので、消し忘れると次の実行が引き継ぐ。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
/* 帳票の見せ方は**設備ごと**に覚える（§9.174）。フィクスチャのロットは
   テスト設備Aなので、その1件だけを触って後片付けする。 */
const TARGET='report:'+EQ;
let b=null;
/* エリアの塊（§9.234 ⑤）。**実行ごとに一意**にして、後片付けで必ず消す
   （帳票ブロックマスタは`db/master.sqlite3`に残り、実行をまたぐ・§9.121）。 */
const AREA_NAME='エリア確認-'+Date.now().toString(36);
let areaId=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
/* 操作帯と取っ手は**マウスオーバーのときだけ**出る層になった（§9.223 ①）。
   実際の操作と同じ順（塊へ触れる→押す）で辿ること——`page.click()`は
   押す前に「見えているか」を確かめるので、触れずに押すと必ず落ちる。 */
const tap=async(page,sel,dbl)=>{
 const m=/^(\[data-rp-block="[^"]+"\])/.exec(sel);
 if(m)await page.hover(m[1]);
 await (dbl?page.dblclick(sel):page.click(sel));
};
/* **この紙だけの見え方**は塊の左上の「紙」ボタンが開く（§9.274）。
   ダブルクリックは**帳票ブロックマスタへ移る**ようになった（利用者の指示
   「今のモーダルでできることは少ないのでマスタに繋いできちんと修正できる
   ようにしたい」）ので、ここでは押さない——移ってしまうと以降の操作が
   マスタ管理の画面で走る。行き先そのものは`tests/test_rbcells.js`が見る。
   開く→押す→閉じるを1本にしておく——呼ぶ側が毎回書くと、閉じ忘れた窓が
   次の操作を覆って「押せない」で落ちる。 */
const inDlg=async(page,key,fn)=>{
 await page.evaluate(k=>{
  const el=document.querySelector(`[data-rp-block="${CSS.escape(k)}"]`);
  if(!el)throw Error('塊が無い: '+k);
  const b=el.querySelector('[data-rp-paper]');
  if(!b)throw Error('「紙での見え方」の入口が無い: '+k);
  b.click();
 },key);
 await page.waitForFunction(()=>{
  const m=document.getElementById('rpBlockModal');return !!m&&!m.hidden;
 },null,{timeout:8000});
 await page.waitForTimeout(200);
 const out=await fn();
 await page.evaluate(()=>{const c=document.getElementById('rpBlockClose');if(c)c.click()});
 await page.waitForTimeout(200);
 return out;
};
const blocks=page=>page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));

/* 自動保存（§9.303 ③）が落ち着くのを待つ。**時間で待たないこと**
   （§9.102）——速い端末では保存前を見て通り、遅い端末では足りない。
   帯の`#rpArrangeAuto`が「保存しています…」でなくなるまで待つ。 */
const settleSave=async page=>{
 await page.waitForFunction(()=>{
  const e=document.getElementById('rpArrangeAuto');
  return !e||(e.textContent||'').indexOf('保存しています')<0;
 },null,{timeout:20000});
};
/* 保存を待ってから組み換えを終える（旧`#rpArrangeSave`の置き換え）。
   **既に閉じているときは押さない**——帯ごと伏せてあるので、押しに行くと
   「見えるまで」待って落ちる。 */
const endArrange=async page=>{
 await settleSave(page);
 const open=await page.evaluate(()=>{
  const bar=document.getElementById('rpArrangeBar');return !!bar&&!bar.hidden;
 });
 if(open)await page.click('#rpArrangeCancel');
 await page.waitForTimeout(300);
};

(async()=>{
 await cleanup();
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140))});
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await page.click('.record-list-row .report');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await settle(page);

  /* ---- 1) 紙は24マス×48段（§9.222 ②。利用者の指示で12→24・12→48へ） ---- */
  const base=await page.evaluate(()=>({
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length,
   spans:[...document.querySelectorAll('[data-rp-block]')].map(e=>e.style.gridColumn),
   /* 操作の道具は塊の中に1つも無い（§9.226 ⑤で浮き帯を廃止した）。 */
   bars:document.querySelectorAll('.rp-block-bar,.rp-block-tools').length,
   head:!!document.querySelector('.rp-report-head-id')}));
  rec('紙は24マス以上のグリッドで組む',base.cols>=24,String(base.cols)+'列');
  rec('塊は「何マスぶんか」で載る',
      base.spans.length>0&&base.spans.every(v=>/^span \d+$/.test(v)),
      base.spans.slice(0,4).join('／'));
  /* **操作帯は紙に1つも出ない。** CSSで隠す作りだと隠し忘れがそのまま紙に出る
     ので、組み換え中しか組み立てない。 */
  rec('紙にも組み換え中にも操作帯は無い（§9.226 ⑤で廃止）',base.bars===0,String(base.bars));
  /* 見出し（設備名・作業年月日・ロット番号）はブロックにしない——この紙が
     どれかを決める鍵で、隠せると配ったあとで区別が付かなくなる。 */
  const heads=await page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')]
    .some(e=>e.querySelector('.rp-report-head-id')));
  rec('帳票の頭は塊にしない（隠せない）',base.head&&!heads);

  const before=await blocks(page);

  /* ---- 2) 組み換えモード ---- */
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
  await settle(page);
  const arr=await page.evaluate(()=>({
   bar:!document.getElementById('rpArrangeBar').hidden,
   /* **道具は塊の中ではなく縁と窓**（§9.226 ⑤）。縁が**8方向**とも在ること
      （§9.283、四辺＋四隅。以前は右・下・右下の3つだけだった）。 */
   縁:document.querySelectorAll('.rp-block [data-rp-grip]').length,
   n:document.querySelectorAll('[data-rp-block]').length,
   empty:document.querySelectorAll('.rp-block.is-empty').length}));
  rec('組み換え中は下の帯と、塊の縁の取っ手が出る',
      arr.bar&&arr.n>0&&arr.縁===arr.n*8,JSON.stringify(arr));
  /* このロットに中身が無い塊も**組み換え中は見える**（黙って消えると、
     自分で隠したのかデータが無いのかが分からない）。 */
  const after=await blocks(page);
  rec('中身が無い塊も組み換え中は並ぶ',after.length>=before.length,
      `紙${before.length}件 / 組み換え${after.length}件`);

  /* ---- 3) 触った結果がその場の紙に出る ---- */
  /* **幅の数を直に書かない**（§9.222 ②でマス数が12→24になった）。選択肢は
     マス数から作られるので、いちばん狭い→いちばん広いの順に押して
     「押した結果が紙に出ること」を見る。**「全幅を選べば必ず全幅になる」は
     もう成り立たない**——大きさを変えても場所は動かさない（利用者の指示）
     ので、右寄りの塊は紙の端か隣に当たったところで止まる。 */
  const spanOf=v=>Number((/span (\d+)$/.exec(String(v||''))||[])[1]||0);
  const spanNow=()=>page.evaluate(()=>document.querySelector('[data-rp-block="基本情報"]').style.gridColumn);
  const spanPicks=await inDlg(page,'基本情報',()=>page.evaluate(()=>
    [...document.querySelectorAll('#rpBlockForm [data-e-span]')]
      .map(b=>Number(b.dataset.eSpan)||0).filter(Boolean).sort((a,b)=>a-b)));
  const narrow=spanPicks[0];
  const w0=await spanNow();                      /* 触る前の幅 */
  /* **広げる側では確かめない**（§9.222 ②）。大きさを変えても場所は動かさない
     ので、右寄りの塊は紙の端か隣に当たったところで止まり、押した幅と
     一致しない——しかも既定の幅とたまたま同じ数になることがあり、
     「戻った」のか「変わっていない」のかを見分けられなくなる（実際に
     ここで通らなくなった）。**狭める側は必ず通る**ので、そちらで見る。 */
  await inDlg(page,'基本情報',()=>page.click(`#rpBlockForm [data-e-span="${narrow}"]`));
  await settle(page);
  const w1=await spanNow();
  rec('幅を選ぶとその場で紙が変わる',spanOf(w1)===narrow&&spanOf(w1)<spanOf(w0),
      `${spanOf(w0)}マス → ${narrow}マスを押した結果 ${w1}`);
  await inDlg(page,'品質等級',()=>page.click('#rpBlockForm [data-e-vis]'));
  await settle(page);
  /* **外した塊は配置面から消える**（§9.222 ③、利用者の指示）。以前は薄く
     残していたが、マスを占有したままなので置き場所が無くなっていた。
     行き先は置き場（`#rpPalette`）——「消えた」だけを見ると、行き場を
     失っていても通る。 */
  const off=await page.evaluate(()=>({
   紙に無い:!document.querySelector('[data-rp-block="品質等級"]'),
   置き場に居る:[...document.querySelectorAll('#rpPalette [data-rp-pal]')]
     .some(x=>x.dataset.rpPal==='品質等級')}));
  rec('「隠す」を押すと紙から消えて置き場へ移る',
      off.紙に無い===true&&off.置き場に居る===true,JSON.stringify(off));

  /* ---- 塊は**置きたいマスへ**動く（§9.221 ⑨） ----
     以前は「落とした塊の前後へ挿す」並べ替えだったが、置き場所を利用者が
     決める形になったので、落とした先のマスへ移る。**空いているマスへ
     落とすこと**——埋まっているマスへ落とすと（正しく）断られるので、
     何も起きないのが不具合なのか仕様なのか分からなくなる。
     HTML5のD&Dは実際のイベントで確かめる（クリックでは通らない経路）。 */
  const moved=await page.evaluate(a=>{
   const grid=document.querySelector('.rp-blocks');
   const s=document.querySelector(`[data-rp-block="${a}"]`);
   const gr=grid.getBoundingClientRect();
   const cs=getComputedStyle(grid);
   const cols=(cs.gridTemplateColumns||'').split(' ').filter(Boolean).length||12;
   const rowPx=parseFloat(cs.gridAutoRows)||24;
   /* 誰も置いていない行を探す（いちばん下の塊より下）。 */
   const bottom=[...grid.querySelectorAll('[data-rp-block]')]
     .reduce((m,e)=>Math.max(m,e.getBoundingClientRect().bottom),gr.top);
   const y=bottom+rowPx*0.5,x=gr.left+2;
   const dt=new DataTransfer();
   const at={bubbles:true,dataTransfer:dt,clientX:Math.round(x),clientY:Math.round(y)};
   s.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   grid.dispatchEvent(new DragEvent('dragover',at));
   grid.dispatchEvent(new DragEvent('drop',at));
   s.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return {cols,row:Math.floor((y-gr.top)/(rowPx+(parseFloat(cs.rowGap)||0)))+1};
  },'ラベル貼付スペース');
  await settle(page);
  const placed=await page.evaluate(a=>{
   const e=document.querySelector(`[data-rp-block="${a}"]`);
   return e?{grid:e.style.gridRow,placed:e.classList.contains('is-placed')}:null;
  },'ラベル貼付スペース');
  rec('塊をドラッグで空いているマスへ動かせる',
      !!placed&&placed.placed===true&&/^\d+\s*\/\s*span/.test(placed.grid||''),
      JSON.stringify({...placed,...moved}));

  /* ---- 4) 触ったら裏で保存する（§9.303 ③、利用者の指示） ----
     「保存ボタンは無くしバックグラウンドで常に保存するタイプに変更して
      ほしい…帳票ブロックマスタに頻繁に移動…移動するたびに修正していた
      内容が飛ぶ」。**「やめる＝開いた時点へ戻る」は撤回した**（§9.200）
     ——保存ボタンが無い以上、閉じて戻ったら触ったぶんが消える。
     **帯の文字で「保存し終えた」ことまで見る**（`#rpArrangeAuto`）
     ——時間で待つ網は、速い端末では保存前を見て通ってしまう。 */
  rec('組み換えの帯に保存ボタンが無い',
      await page.evaluate(()=>!document.getElementById('rpArrangeSave')));
  /* **触った直後は「保存しています…」**（§3。黙って保存しない）。落ち着いたら
     「自動で保存します」へ戻る——**先に待たないこと**（待ってから見ると、
     保存中を一度も通らないまま通る）。 */
  const sav1=await page.evaluate(()=>{const e=document.getElementById('rpArrangeAuto');
    return e?(e.textContent||'').trim():null});
  rec('触った直後は「保存しています…」と文字で出す（§3）',/保存しています/.test(sav1||''),
      JSON.stringify(sav1));
  await settleSave(page);
  const sav2=await page.evaluate(()=>{const e=document.getElementById('rpArrangeAuto');
    return e?(e.textContent||'').trim():null});
  rec('保存し終えると「自動で保存します」へ戻る',/自動で保存/.test(sav2||''),JSON.stringify(sav2));
  await page.click('#rpArrangeCancel');
  await settle(page);
  const back=await page.evaluate(()=>({
   bars:document.querySelectorAll('.rp-block [data-rp-grip]').length,
   span:document.querySelector('[data-rp-block="基本情報"]').style.gridColumn,
   quality:!!document.querySelector('[data-rp-block="品質等級"]')}));
  rec('「組み換えを終える」で抜けても、触ったぶんは紙に残る（戻らない）',
      back.bars===0&&spanOf(back.span)===narrow&&back.quality===false,
      JSON.stringify({span:back.span,期待:'span '+narrow,quality:back.quality}));

  /* ---- 5) 保存はサーバーに残り、マスの数として往復する ---- */
  const saved=back;
  const srv=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json();
  rec('サーバーに「出さない塊」が残る',(srv.hidden||[]).includes('品質等級'),JSON.stringify(srv.hidden));
  /* **ここが要点**。`widths`はpxとして40〜900へ丸められるので、マスの数
     (3〜12)をそのまま入れると全部40になり、読み戻したときに既定へ落ちる。 */
  rec('幅は丸められない値で保存し、マスの数へ戻せる',
      Number(srv.widths&&srv.widths['基本情報'])>40,JSON.stringify(srv.widths));
  const reread=await page.evaluate(()=>{
   WL.columnLayout.forget('report:テスト設備A');
   return WL.columnLayout.load('report:テスト設備A').then(()=>{
    const el=document.querySelector('[data-rp-block="基本情報"]');
    if(typeof renderReport==='function'){}
    return WL.columnLayout.width('report:テスト設備A','基本情報');
   });
  });
  rec('読み直しても幅が残る（既定へ戻らない）',Number(reread)>40,String(reread));

  /* ==========================================================
     6) 測定データの「まとめ／分解」と紙のマス数（§9.173）
     ----------------------------------------------------------
     利用者の指示は「今までの縦方向に幅情報、横方向に検査した項目を並べる
     方式も残す／通常は組み合わせた形／分解したときに個別内容になる／
     グリッドサイズを標準で設定した上で各ブロックの使用マス数を変えられる／
     入りきらないときは絞れる内容を提示する」。
     ここで固定するのは**既定がまとめであること**と**往復できること**。
     ========================================================== */
  await cleanup();
  await page.evaluate(()=>{WL.columnLayout.forget('report:テスト設備A')});
  await page.click('.record-list-row .report').catch(()=>{});
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:20000});
  await settle(page);
  const baseKeys=await blocks(page);
  /* **既定はまとめ。** 一度も保存していないうちは、分解した1枚ずつは紙に
     出さない（出すと同じ測定値が2箇所に並ぶ）。中身の無い塊はそもそも紙に
     出ないので、紙では「個別が1枚も無い」ことを見る。 */
  rec('既定では分解した1枚ずつを紙に出さない',
      !baseKeys.some(k=>k.startsWith('測定データ・')),
      baseKeys.filter(k=>/測定/.test(k)).join('／')||'（測定の塊は紙に出ていない）');

  await page.click('#reportArrange');
  await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
  await settle(page);
  /* 組み換え中は中身の無い塊も並ぶので、そこで「まとめが出ていて個別は
     出さない」既定を確かめる。 */
  /* **外した塊は紙に出ない**（§9.222 ③）ので、出す/出さないは
     「紙に居るか／置き場に居るか」で見る（`is-off`はもう付かない）。 */
  const defaults=await page.evaluate(()=>{
   const pal=[...document.querySelectorAll('#rpPalette [data-rp-pal]')].map(x=>x.dataset.rpPal);
   return {combined:!!document.querySelector('[data-rp-block="板幅ほかの測定データ"]'),
     soloOff:!document.querySelector('[data-rp-block^="測定データ・"]'),
     solos:pal.filter(k=>k.startsWith('測定データ・')).length};
  });
  rec('既定は「まとめて1枚」（個別は出さない）',
      defaults.combined&&defaults.soloOff&&defaults.solos>=6,JSON.stringify(defaults));
  /* 紙のマス数は帯にあり、押すとグリッドが変わる。 */
  const grid0=await page.evaluate(()=>({
   picks:[...document.querySelectorAll('[data-rp-grid]')].map(b=>b.textContent),
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length}));
  /* **最小が24マス**（§9.222 ②、利用者の指示「マス数24×段数48を最小値に
     してそれ以上の数値も準備」）。粗い側（12以下）はもう出さない。 */
  rec('紙のマス数を標準として選べる',grid0.picks.join('/')==='24/36/48'&&grid0.cols===24,
      `${grid0.picks.join('/')} / いま${grid0.cols}列`);
  await page.click('[data-rp-grid="48"]');
  await settle(page);
  const grid1=await page.evaluate(()=>({
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length,
   labels:[]}));
  grid1.labels=await inDlg(page,'基本情報',()=>page.evaluate(()=>
    [...document.querySelectorAll('#rpBlockForm [data-e-span]')].map(b=>b.textContent)));
  rec('マス数を変えると紙の割りも変わる',grid1.cols===48,`${grid1.cols}列`);
  /* 幅の選択肢は**マス数から作る**。割り切れない刻みは近いマスへ寄せて
     同じ幅が2つ並ばないようにまとめる。 */
  rec('幅の選択肢はマス数から作る',grid1.labels.length>=3&&grid1.labels.includes('全幅'),
      grid1.labels.join('・'));
  await page.click('[data-rp-grid="24"]');
  await settle(page);

  /* ================================================================
     §9.221 ⑨の追補: 紙の段数は**保存して開き直しても残る**
     ----------------------------------------------------------------
     `widths`はpxとして40〜900へ丸められる（§9.169）ので、数を入れる
     倍率が大きすぎると上限に当たって黙って別の数になる。以前は16段(×60=960)と
     24段(×60=1440)がどちらも900→読み戻すと15→選択肢に無いので既定12へ、
     という形で**押しても保存されない設定**になっていた。
     §9.222 ②で**掛け算をやめて「40＋数」**にしたので、96段でも136。
     **確かめるときはいちばん大きい段数で見ること**——小さい側だけを見ると
     倍率が何であっても通る。
     ================================================================ */
  const rowChoices=await page.evaluate(()=>
    [...document.querySelectorAll('[data-rp-prow]')].map(b=>Number(b.dataset.rpProw)));
  rec('紙の段数を選べる',rowChoices.join('/')==='48/72/96',rowChoices.join('/'));
  for(const n of [72,96,48]){
   await page.click(`[data-rp-prow="${n}"]`);
   await settle(page);
   /* **保存してから読み直す**（下書きのまま見ると、上限で潰れていても
      画面は正しく見える——開き直した瞬間に12へ戻るのが実際の壊れ方）。 */
   const raw=await page.evaluate(t=>{
    const w=(WL.columnLayout.get(t)||{}).widths||{};return Number(w['__行グリッド__'])||0;
   },TARGET);
   const back=await page.evaluate(()=>{
    /* 画面が読み戻した段数＝1行の高さから逆算できる（紙の縦÷段数）。 */
    const g=document.querySelector('.rp-page .rp-blocks');
    return Math.round(g.getBoundingClientRect().width>0
      ?(parseFloat(getComputedStyle(g).getPropertyValue('--rp-page-rows'))||0):0);
   });
   rec(`段数${n}が上限で潰れずに保存される`,raw>0&&raw<=900&&back===n,
       `保存値=${raw} / 読み戻し=${back}`);
  }
  /* **保存して読み直すところまで見る。** 上の3件は下書きの段階で
     「保存値が上限を越えていない」ことを見ているが、それだけだと読む側の
     倍率を間違えた回帰は捕まらない。24段のまま保存し、写しを捨てて
     サーバーから読み直して、同じ24段で描かれることを確かめる。 */
  await page.click('[data-rp-prow="96"]');
  await settle(page);
  await endArrange(page);
  const roundTrip=await page.evaluate(async t=>{
   WL.columnLayout.forget(t);
   await WL.columnLayout.load(t);
   const w=(WL.columnLayout.get(t)||{}).widths||{};
   const raw=Number(w['__行グリッド__'])||0;
   return {raw,rows:raw-40};                 /* 40＋数（§9.222 ②） */
  },TARGET);
  rec('段数96は保存して読み直しても96のまま',
      roundTrip.raw>0&&roundTrip.raw<=900&&roundTrip.rows===96,JSON.stringify(roundTrip));
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
  await page.click('[data-rp-prow="48"]');
  await settle(page);

  /* ---- 分解 → 個別、まとめへ戻す ---- */
  await inDlg(page,'板幅ほかの測定データ',()=>page.click('#rpBlockForm [data-rp-split]'));
  await settle(page);
  const split=await page.evaluate(()=>({
   solo:[...document.querySelectorAll('[data-rp-block]')]
     .filter(e=>e.dataset.rpBlock.startsWith('測定データ・')).map(e=>e.dataset.rpBlock),
   combined:!document.querySelector('[data-rp-block="板幅ほかの測定データ"]')}));
  rec('「項目ごとに分ける」で個別の塊になる',
      split.solo.length>=6&&split.combined===true,
      `${split.solo.length}枚 / まとめ=${split.combined?'畳んだ':'出たまま'}`);
  /* **同じ内容を2箇所に出さない。** 分解したらまとめは畳む。 */
  rec('分解するとまとめは畳まれる',split.combined===true);
  await inDlg(page,'測定データ・板幅',()=>page.click('#rpBlockForm [data-rp-split]'));
  await settle(page);
  const rejoin=await page.evaluate(()=>({
   solo:!document.querySelector('[data-rp-block="測定データ・板幅"]'),
   combined:!!document.querySelector('[data-rp-block="板幅ほかの測定データ"]')}));
  rec('「まとめへ戻す」で1枚へ戻る',rejoin.solo===true&&rejoin.combined===true,JSON.stringify(rejoin));

  /* ---- 入りきらないときの案内（§9.226 ⑤で設定の窓へ移した） ----
     **落とせる列は測定データの塊だけ**が持つ。窓の中に在ることと、
     **紙には1つも出ない**ことの両方を見る（紙に出ると刷り上がりが変わる）。 */
  const guide=await inDlg(page,'板幅ほかの測定データ',()=>page.evaluate(()=>({
   drops:document.querySelectorAll('#rpBlockForm [data-rp-drop]').length,
   戻す:document.querySelectorAll('#rpBlockForm [data-rp-restore]').length})));
  rec('落とせる列の一覧を設定の窓が持っている（測定データの塊だけ）',
      guide.drops>0&&guide.戻す===1,JSON.stringify(guide));
  await endArrange(page);
  await settle(page);
  rec('紙には絞り込みの案内を出さない',
      await page.evaluate(()=>document.querySelectorAll('.rp-block-cols,[data-rp-drop]').length===0));

  /* ==========================================================
     7) 丈別データの「揃い」欄（§9.205、利用者の指示「内訳と合否両方
        (デフォルト)と内訳のみ、合否のみを切り替えほしい」）
     ----------------------------------------------------------
     以前の紙は**合否(OK/NG)しか載っていなかった**ので、形状も値も紙から
     分からなかった。ここで固定するのは3点。
       ・既定は内訳と合否の両方
       ・3つの出し方を往復できる（保存すると列レイアウトマスタに残る）
       ・**判定に使う切断面等級は「その紙のレコード」から引く**
         （`S.measure`＝いま開いている測定を見ていると、一括印刷で
           途中から全部同じ基準になる）
     **確かめるときは材料ごと注ぎ込む**——検証用フィクスチャの測定データは
     揃いも品質等級も持たないので、そのまま見ても内訳の行を一度も通らない
     （§9.125・§9.160と同じ）。 */
  await cleanup();
  await page.evaluate(()=>{WL.columnLayout.forget('report:テスト設備A')});
  /* 同じ内訳・同じ値(4.0mm)で**切断面等級だけ違う**2件。
     3級はテレスコープ5.0mm以下なのでOK、4級は3.0mm以下なのでNGになる。
     等級を見ていなければ**どちらも「基準なし」**になり、片方の等級しか
     見ていなければ**2件が同じ判定**になる。 */
  const mk=(id,grade)=>({id,grade});
  const made=await page.evaluate(async pair=>{
   const out=[];
   for(const{id,grade} of pair){
    const rec=ensureMeasureShape({
     id,status:'編集中',updatedAt:new Date().toISOString(),
     registeredEquipment:'テスト設備A',
     basic:{lotNo:id},
     qualityGrades:{'切断面':grade},
     settings:{registeredEquipment:'テスト設備A',verticalCount:3,
       measureType:WL.measureItem.MATERIAL},
     product:{rows:[
      {productLength:'1000',wallThickness:'0.50',edgeShape:'のこぎり状',
       occurrencePosition:'1/3未満発生',regularity:'不規則',direction:'OS',
       pitch:'12',alignmentValue:'1.5',note:''},
      {productLength:'1000',wallThickness:'0.50',edgeShape:'テレスコープ状',
       occurrencePosition:'2/3以上発生',regularity:'規則的',direction:'DS',
       pitch:'',alignmentValue:'4.0',note:''},
      {productLength:'1000',wallThickness:'0.50',edgeShape:'揃い綺麗',note:''},
     ]},
    });
    await reliablePut(rec);out.push(rec.id);
   }
   return out;
  },[mk('RPPROD-G3','3'),mk('RPPROD-G4','4')]);
  rec('揃いの材料を注ぎ込めた',made.length===2,made.join('／'));

  const readProduct=()=>page.evaluate(()=>{
   const sec=[...document.querySelectorAll('[data-rp-block="丈別データ"] .rp-section, .rp-section')]
     .find(s=>/丈別データ/.test(s.querySelector('h3')?.textContent||''));
   if(!sec)return null;
   const rows=[...sec.querySelectorAll('tbody tr')].map(tr=>{
    const cell=tr.children[3];
    return{
     judge:cell.querySelector('.product-judge')?.textContent.trim()||'',
     breaks:[...cell.querySelectorAll('.rp-pb')].map(b=>b.textContent.trim()),
     fits:[...cell.querySelectorAll('.rp-pb')].every(b=>
       b.getBoundingClientRect().right<=cell.getBoundingClientRect().right+1),
    };
   });
   const tbl=sec.querySelector('table'),host=sec.closest('.rp-block')||sec.parentElement;
   return{rows,note:sec.querySelector('.rp-note')?.textContent.trim()||'',
     wide:tbl.getBoundingClientRect().width<=host.getBoundingClientRect().width+2};
  });

  await page.evaluate(id=>window.openReportForRecord(id),'RPPROD-G3');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:20000});
  await settle(page);
  const both=await readProduct();
  rec('丈別データが紙に出る',!!both&&both.rows.length===3,
      both?`${both.rows.length}行`:'（節が無い）');
  /* **既定は内訳と合否の両方。** */
  rec('既定は内訳と合否の両方を出す',
      !!both&&both.rows[0].judge==='OK'&&both.rows[0].breaks.length>=4,
      both?`判定=${both.rows[0].judge} / 内訳${both.rows[0].breaks.length}件: ${both.rows[0].breaks.join('・')}`:'');
  /* 内訳は**ラベルと単位つき**（同じ数字でも意味が違う）。 */
  rec('内訳に形状・発生位置・方向・値(mm)が載る',
      !!both&&['のこぎり状','1/3未満発生','OS','1.5mm'].every(t=>both.rows[0].breaks.join('／').includes(t)),
      both?both.rows[0].breaks.join('／'):'');
  /* 「揃い綺麗」の丈は**内訳を書かない**（異常が無いので書くことが無い）。 */
  rec('「揃い綺麗」の丈は形状だけで内訳を並べない',
      !!both&&both.rows[2].judge==='OK'&&both.rows[2].breaks.length===1
        &&both.rows[2].breaks[0].includes('揃い綺麗'),
      both?`${both.rows[2].judge} / ${both.rows[2].breaks.join('／')}`:'');
  /* **内訳は切り詰めない・紙からはみ出さない。** 他の列はnowrap＋省略記号だが、
     「のこぎり…」では形状が読めないので、この欄だけ折り返して幅を回す。 */
  rec('内訳が欄からはみ出さない',
      !!both&&both.wide&&both.rows.every(r=>r.fits),
      both?`表が器に収まる=${both.wide} / 行ごと=${both.rows.map(r=>r.fits).join(',')}`:'');
  /* **合否の根拠を紙に書く**（紙にtitleは出ない）。 */
  rec('合否の根拠（切断面等級と基準）を紙に書く',
      !!both&&/切断面 3級/.test(both.note)&&/客先の個別要求/.test(both.note),both?both.note:'');

  /* ---- 等級はこの紙のレコードから引く ---- */
  const g3=both&&both.rows[1].judge;
  await page.evaluate(id=>window.openReportForRecord(id),'RPPROD-G4');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:20000});
  await settle(page);
  const g4rows=await readProduct();
  const g4=g4rows&&g4rows.rows[1].judge;
  rec('切断面等級はその紙のレコードから引く（3級OK・4級NG）',
      g3==='OK'&&g4==='NG',`3級=${g3} / 4級=${g4}`);

  /* ---- 3つの出し方を切り替えて往復する ---- */
  await page.evaluate(id=>window.openReportForRecord(id),'RPPROD-G3');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:20000});
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
  /* この紙だけの見え方は**左上の「紙」ボタン**（§9.274。ダブルクリックは
     帳票ブロックマスタへ移る）。 */
  await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="丈別データ"] [data-rp-paper]');
   if(el)el.click();
  });
  await page.waitForSelector('#rpBlockForm [data-e-pmode]',{timeout:8000});
  const modes=await page.evaluate(()=>[...document.querySelectorAll('#rpBlockForm [data-e-pmode]')]
    .map(b=>b.dataset.ePmode+'='+b.textContent.trim()));
  rec('揃いの出し方を3つから選べる',modes.length===3&&/既定/.test(modes[0]),modes.join(' / '));

  await page.click('#rpBlockForm [data-e-pmode="合否"]');
  await settle(page);
  const only=await readProduct();
  rec('「合否だけ」にすると内訳が消える',
      !!only&&only.rows[0].judge==='OK'&&only.rows.every(r=>r.breaks.length===0),
      only?`判定=${only.rows[0].judge} / 内訳=${only.rows[0].breaks.length}件`:'');

  await page.click('#rpBlockForm [data-e-pmode="内訳"]');
  await settle(page);
  const brk=await readProduct();
  rec('「内訳だけ」にすると合否が消える',
      !!brk&&brk.rows.every(r=>r.judge==='')&&brk.rows[0].breaks.length>=4,
      brk?`判定=「${brk.rows[0].judge}」 / 内訳=${brk.rows[0].breaks.length}件`:'');
  /* 合否を載せていないのに基準の話をしても読む相手が居ない（§「自明な文を消す」）。 */
  rec('内訳だけのときは基準の一文を出さない',!!brk&&brk.note==='',brk?brk.note:'');

  await page.click('#rpBlockClose');
  await endArrange(page);
  const srv2=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json();
  /* **文字列のまま保存しない**（§9.205）。サーバーの`normalize_format()`は
     辞書以外をNoneへ落とすので、`formats[k]='内訳'`と書くと画面では効くのに
     保存だけが黙って消える（「行と列の入れ替え」が実際にそうなっていた）。
     書式の`pattern`へ入れて往復させる。 */
  rec('揃いの出し方がサーバーに残る',
      ((srv2.formats||{})['丈別データ']||{}).pattern==='内訳',
      JSON.stringify(srv2.formats));
  /* **既定は行ごと消す**（空文字を保存すると「空という設定」になる）。 */
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
  await page.evaluate(()=>{
   const el=document.querySelector('[data-rp-block="丈別データ"] [data-rp-paper]');
   if(el)el.click();
  });
  await page.waitForSelector('#rpBlockForm [data-e-pmode]',{timeout:8000});
  await page.click('#rpBlockForm [data-e-pmode=""]');
  await settle(page);
  await page.click('#rpBlockClose');
  await endArrange(page);
  const srv3=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json();
  rec('既定へ戻すと設定の行ごと消える',!((srv3.formats||{})['丈別データ']),
      JSON.stringify(srv3.formats));

  /* ---- **組み換えしていない紙に塊が出ていること**（§9.219 ②） ----
     既定の塊をマスタへ載せたとき、画面が組み込み行を「自作の塊」として
     読むと`rpHiddenSet()`の「並びに載るまで出さない」が全部に当たり、
     **紙が丸ごと白紙になる**（実際にその窓があった）。
     **既存の判定では捕まらない**——`bars===0`も`after>=before`も塊0件で
     真になり、塊を名指しする判定は全部「組み換え中」で走る
     （`if(off&&(!arranging||paper))return ''`のため隠した塊も描かれる）。
     ここは**組み換えを閉じた紙**で、件数が0より大きいことを見る。 */
  await endArrange(page);
  await settle(page);
  const paper=await page.evaluate(()=>{
   const on=document.querySelector('#reportContent .rp-blocks.is-arranging');
   const list=[...document.querySelectorAll('#reportContent [data-rp-block]')]
     .map(e=>e.dataset.rpBlock);
   return {組み換え中:!!on,件数:list.length,基本情報:list.includes('基本情報'),
           見出し:[...document.querySelectorAll('#reportContent .rp-section>h3')]
             .map(e=>e.textContent).slice(0,4)};
  });
  rec('組み換えしていない紙に既定の塊が出ている（白紙にならない）',
      paper.組み換え中===false&&paper.件数>0&&paper.基本情報===true,
      JSON.stringify(paper));

  /* ---- **古い保存値（`__配置版__`の無い形）が1回の書き込みで飛ばない**
         （§9.222 ②） ----
     `widths`は「40＋数」へ切り替えたので、それ以前の保存値（位置×40 /
     幅×60 / 行数×30、しかも**当時のマス数・段数の中の位置**）は読み替えが
     要る。読み替えを`rpStage()`の中で「下に敷く」形にしていたときは、
     widthsを書く呼び出しが全て`{...rpLayoutNow().widths}`＝全件の写しを
     渡すため**後勝ちで変換値が全部捨てられ**、直後に`__配置版__`だけが
     刻まれて以降`値-40`として読まれていた（＝1回何か触っただけで配置が飛ぶ）。

     **「1つの塊だけ古い形」では捕まらない。** 場所を持たない塊が1つでも
     あると`rpSeedPositions()`が**全部の塊の位置を測って書き下ろす**ので、
     そこで正しい新しい形へ直ってしまう（前の版で保存した設定は全部の塊が
     位置を持っているので、実機ではこの道を通らない）。ここは
     **いま保存されている形を古い形へ焼き直して**注ぎ込み、書き下ろしが
     走らない状態を作ってから見る。 */
  /* **組み換えを開いた状態で数える。** 中身の無い塊は組み換え中だけ出るので、
     閉じた紙から作ると数が足りず、開いた瞬間に位置を持たない塊が残って
     `rpSeedPositions()`が走ってしまう（＝古い形が新しい形へ直ってしまい、
     変換の道を一度も通らない）。 */
  await page.click('#reportArrange');
  await page.waitForSelector('#reportContent .rp-blocks.is-arranging',{timeout:15000});
  await settle(page);
  /* **いま描かれている塊すべて**から作る（保存済みのキーからではなく）。
     1つでも位置を持たない塊が残ると`rpSeedPositions()`が全部を測り直して
     書き下ろし、そこで正しい新しい形へ直ってしまう＝変換の道を通らない。 */
  const legacyPayload=await page.evaluate(t=>{
   const out={'__グリッド__':6*60,'__行グリッド__':12*30};   /* 当時は6マス×12段 */
   const num=(s,i)=>{const m=String(s||'').split('/');return Math.max(1,parseInt(m[i]||'1',10)||1)};
   const span=s=>{const m=/span\s+(\d+)/.exec(String(s||''));return m?Math.max(1,Number(m[1])):1};
   let 塊=0;
   document.querySelectorAll('[data-rp-block]').forEach(e=>{
    const k=e.dataset.rpBlock;
    const c=num(e.style.gridColumn,0),r=num(e.style.gridRow,0);
    out['列:'+k]=Math.max(1,Math.min(6,Math.round((c-1)*6/24)+1))*40;
    out['行:'+k]=Math.max(1,Math.round((r-1)*12/48)+1)*40;
    out[k]=Math.max(1,Math.min(6,Math.round(span(e.style.gridColumn)*6/24)))*60;
    out['行数:'+k]=Math.max(1,Math.round(span(e.style.gridRow)*12/48))*30;
    塊++;
   });
   /* **`hidden`もそのまま持ち越す。** 空にすると隠れていた塊まで出てきて、
      その塊は位置を持たないので`rpSeedPositions()`が走ってしまう。 */
   return {widths:out,order:[...(WL.columnLayout.get(t).order||[])],
           hidden:[...(WL.columnLayout.get(t).hidden||[])],塊};
  },TARGET);
  const lgPost=await (await post('/api/column-layout-master',{target:TARGET,clear:true,user_id:'test',
    order:legacyPayload.order,hidden:legacyPayload.hidden,widths:legacyPayload.widths})).json().catch(e=>({error:String(e)}));
  const lgSrv=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(TARGET))).json();
  const lgSrvInfo={POST:JSON.stringify(lgPost).slice(0,80),
    サーバ版:(lgSrv.widths||{})['__配置版__']||0,
    キー数:Object.keys(lgSrv.widths||{}).length,
    列基本情報:(lgSrv.widths||{})['列:基本情報']||0};
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.evaluate(()=>openRecordsSafe('編集中'));
  await page.waitForSelector('.record-list-row',{timeout:25000});
  await page.click('.record-list-row .report');
  await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
  await page.click('#reportArrange');
  await page.waitForSelector('#reportContent .rp-blocks.is-arranging',{timeout:15000});
  await settle(page);
  const spot=()=>page.evaluate(()=>{
   const o={};
   document.querySelectorAll('[data-rp-block]').forEach(e=>{
    o[e.dataset.rpBlock]=e.style.gridColumn+' / '+e.style.gridRow;
   });
   return o;
  });
  const lgBefore=await spot();
  const seeded=await page.evaluate(t=>{
   const w=(WL.columnLayout.get(t).widths)||{};
   const miss=[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock)
     .filter(k=>!(Number(w['列:'+k])>0&&Number(w['行:'+k])>0));
   return {版:w['__配置版__']||0,位置なし:miss.slice(0,5),件数:miss.length};
  },TARGET);
  rec('前提: 古い形のまま（書き下ろしが走っていない）',
      legacyPayload.塊>0&&!(seeded.版>40),
      JSON.stringify({塊:legacyPayload.塊,...seeded,...lgSrvInfo}));
  /* いまと同じマス数のボタンを押す＝**見た目は変わらないが widths を書く**。
     変換が効いていなければ、この1回で全部の塊が置き直される。 */
  const clicked=await page.evaluate(()=>{
   const b=document.querySelector('#rpArrangeBar [data-rp-grid="24"]');
   if(!b)return false;b.click();return true;
  });
  await settle(page);
  const lgAfter=await spot();
  const lgMoved=Object.keys(lgBefore).filter(k=>lgBefore[k]!==lgAfter[k]);
  rec('前提: widthsを書く操作が実際に走った',
      clicked===true&&(await page.evaluate(t=>((WL.columnLayout.get(t).widths)||{})['__配置版__']||0,TARGET))>40,
      String(clicked));
  rec('古い保存値でも1回書いたら配置が飛ばない',
      Object.keys(lgBefore).length>0&&lgMoved.length===0,
      '動いた塊:'+JSON.stringify(lgMoved.slice(0,3).map(k=>k+' '+lgBefore[k]+'→'+lgAfter[k])));

  /* ---- エリアの塊と枠（§9.234 ⑤、利用者の指示「ラベル貼り付けエリアと
       同じタイプのエリア確保だけのタイプで文字を配置できる感じのものを
       追加してください」「エリアを枠(角丸の枠線)で囲う感じにしたいので
       サイズ調整に合うようにカードサイズとほぼ同じ枠を付けたり外したり
       カスタム機能に追加してください」） ---- */
  {
   /* マスタで「エリア」の塊を作る。**文字が空でも紙に出る**ことと、
      **改行が`<br>`で出る**ことを見る。 */
   const made=await (await post('/api/report-block-master',
     {equipment:'*',name:AREA_NAME,kindText:'エリア（枠と文字）',
      text:'確認印\n（承認者）',span:3,rows:'4',user_id:'test'})).json();
   if(made&&made.id)areaId=made.id;
   rec('前提: エリアの塊をマスタで作れた',!!(made&&made.ok&&made.id),JSON.stringify(made));
   /* **帳票を開き直して読み込ませる**（`forget()`だけでは控えが空になるだけ）。
      入口は一覧の行の「帳票」——`#openReport`のようなボタンは無い。 */
   await page.evaluate(()=>{
    if(WL.reportBlocks&&WL.reportBlocks.forget)WL.reportBlocks.forget();
    const c=document.getElementById('rpArrangeCancel');if(c&&!c.disabled)c.click();
   });
   await page.waitForTimeout(300);
   await page.evaluate(()=>openRecordsSafe('編集中'));
   await page.waitForSelector('.record-list-row',{timeout:25000});
   await page.click('.record-list-row .report');
   await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
   await settle(page);
   await page.waitForTimeout(600);
   await page.click('#reportArrange');
   await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
   await settle(page);
   /* 置き場（`#rpPalette`）から紙へ出す。 */
   const shown=await page.evaluate(n=>{
    const p=[...document.querySelectorAll('#rpPalette [data-rp-pal]')]
      .find(e=>e.dataset.rpPal===n);
    if(p){p.click();return 'placed'}
    return document.querySelector(`[data-rp-block="${CSS.escape(n)}"]`)?'already':'missing';
   },AREA_NAME);
   await settle(page);
   await page.waitForTimeout(400);
   const area=await page.evaluate(n=>{
    const el=document.querySelector(`[data-rp-block="${CSS.escape(n)}"]`);
    if(!el)return{出た:false};
    const inner=el.querySelector('.rp-area');
    const cs=getComputedStyle(el);
    const r=el.getBoundingClientRect(),ir=inner?inner.getBoundingClientRect():null;
    return{出た:true,エリア:!!inner,
      html:inner?inner.innerHTML:'',
      節:!!el.querySelector('.rp-section'),
      枠:cs.borderTopWidth,角:cs.borderTopLeftRadius,
      中枠:inner?getComputedStyle(inner).borderTopWidth:null,
      /* **枠はカードそのものに描く**——中身側に描く実装では、枠の矩形が
         カードより小さくなる（「枠が在ること」だけを見る網では素通りする）。 */
      器:{w:Math.round(r.width),h:Math.round(r.height)},
      中:ir?{w:Math.round(ir.width),h:Math.round(ir.height)}:null};
   },AREA_NAME);
   rec('前提: エリアの塊が紙に出た',area.出た===true,JSON.stringify({shown,...area}));
   rec('エリアの塊は値の節ではなく場所を空ける器になる',
       area.エリア===true&&area.節===false,JSON.stringify(area));
   rec('置いた文字が出る（改行は<br>）',
       /確認印/.test(area.html)&&/<br>/.test(area.html),area.html);
   rec('エリアの塊は既定で枠が付く（角丸）',
       parseFloat(area.枠)>0&&parseFloat(area.角)>0,JSON.stringify({枠:area.枠,角:area.角}));
   /* **枠の大きさはカードとほぼ同じ**（利用者の指示）。枠を描くのは
      `.rp-block`＝カードそのもので、中身側には描かない——中身側に描く旧実装
      では**中身なりの高さで止まる**（器と中の高さの比で見る。差のpxで見ると
      枠線と内側の余白ぶんで落ちるので、割合で突き合わせること）。 */
   rec('枠はカード（塊）とほぼ同じ大きさで出る',
       !!area.中&&area.中.h>=area.器.h*0.9&&area.中.w>=area.器.w*0.9
       &&parseFloat(area.中枠||'0')===0,
       JSON.stringify({器:area.器,中:area.中,中枠:area.中枠}));
   /* 枠は**既定の塊にも効く**。他の印（転置など）を巻き添えにしないことも見る。 */
   await inDlg(page,'基本情報',async()=>{
    await page.click('#rpBlockForm [data-e-frame="あり"]');
   });
   await settle(page);
   const on=await page.evaluate(()=>getComputedStyle(
     document.querySelector('[data-rp-block="基本情報"]')).borderTopWidth);
   rec('ふつうの塊にも枠を付けられる',parseFloat(on)>0,on);
   await inDlg(page,AREA_NAME,async()=>{
    await page.click('#rpBlockForm [data-e-frame="なし"]');
   });
   await settle(page);
   const off2=await page.evaluate(n=>getComputedStyle(
     document.querySelector(`[data-rp-block="${CSS.escape(n)}"]`)).borderTopWidth,AREA_NAME);
   rec('エリアの塊の枠を外せる',parseFloat(off2)===0,off2);
   /* **保存して開き直しても残る**（§9.205の罠。`formats[k]`へ文字列を入れる
      実装は、当てた直後だけは効いて保存で黙って消える）。 */
   await endArrange(page);
   await page.evaluate(t=>{if(WL.columnLayout.forget)WL.columnLayout.forget(t)},TARGET);
   await page.evaluate(()=>openRecordsSafe('編集中'));
   await page.waitForSelector('.record-list-row',{timeout:25000});
   await page.click('.record-list-row .report');
   await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
   await settle(page);
   await page.waitForTimeout(800);
   const kept=await page.evaluate(n=>{
    const a=document.querySelector(`[data-rp-block="${CSS.escape(n)}"]`);
    const b2=document.querySelector('[data-rp-block="基本情報"]');
    return{エリア:a?getComputedStyle(a).borderTopWidth:'(無し)',
           基本:b2?getComputedStyle(b2).borderTopWidth:'(無し)'};
   },AREA_NAME);
   rec('枠の入切は保存して開き直しても残る（§9.205）',
       parseFloat(kept.エリア)===0&&parseFloat(kept.基本)>0,JSON.stringify(kept));
  }


  /* ==========================================================
     §9.298 表は「縮める前に余白を詰める」
     ----------------------------------------------------------
     利用者の指示は「帳票ブロックマスタの『丈別データ(長さ、肉厚、揃い)』に
     関して、横方向の幅を小さくしたときに他の表と同じように余白を詰めて
     データの文字サイズを極力キープするような変化をするように」。

     直す前は`rpFitBlockBodies()`がいきなり`--rp-fit`で**丸ごと縮めて**おり、
     6/24マスで0.55倍＝本文7.5pxが4.1pxになっていた（実測）。
     ここで固定するのは3点。
       1. **入っている塊は1pxも変わらない**（広いマスでは詰めない）
       2. 狭くすると**余白が実際に小さくなる**（文字サイズは据え置き）
       3. 詰めを止めると**縮む倍率が下がる**＝詰めが効いている
     3つ目がこの網の背骨。**「余白が小さい」だけを見る網は素通りする**
     ——CSSが効いていても、縮める側が詰めた結果を見ていなければ意味が無い。
     ========================================================== */
  try{
   await page.click('#reportArrange');
   await page.waitForSelector('.rp-blocks.is-arranging',{timeout:8000});
   await settle(page);
   const placed=await page.evaluate(()=>{
    const p=[...document.querySelectorAll('#rpPalette [data-rp-pal]')]
      .find(e=>e.dataset.rpPal==='丈別データ');
    if(p){p.click();return 'placed'}
    return document.querySelector('[data-rp-block="丈別データ"]')?'already':'missing';
   });
   await settle(page);await page.waitForTimeout(300);
   rec('前提: 丈別データの塊が紙に出ている',placed!=='missing',placed);
   const picks=await inDlg(page,'丈別データ',()=>page.evaluate(()=>
     [...document.querySelectorAll('#rpBlockForm [data-e-span]')]
       .map(b=>Number(b.dataset.eSpan)).filter(Boolean).sort((a,b)=>a-b)));
   /* セルの見え方は**描画後の解決値**で見る（§9.289。宣言を見る網は
      `calc()`の中身が間違っていても通る）。 */
   const look=()=>page.evaluate(()=>{
    const el=document.querySelector('[data-rp-block="丈別データ"]');if(!el)return null;
    const t=el.querySelector('.rp-product-table');if(!t)return null;
    const td=t.querySelector('tbody td'),cs=getComputedStyle(td);
    const fit=el.querySelector(':scope>.rp-block-fit');
    return{px:parseFloat(cs.paddingLeft),py:parseFloat(cs.paddingTop),
      fs:parseFloat(cs.fontSize),lh:parseFloat(cs.lineHeight),
      fit:Number(fit&&fit.style.getPropertyValue('--rp-fit'))||1,
      dense:Number(fit&&fit.style.getPropertyValue('--rp-dense'))||1,
      /* 段の印（§9.303 ①）。どこまで進んだかを見る。 */
      pack:[...(fit?fit.classList:[])].filter(c=>c.indexOf('rp-pack-')===0).sort(),
      tl:getComputedStyle(t).tableLayout};
   });
   const wide=picks[picks.length-1],narrow=picks[0];
   await inDlg(page,'丈別データ',()=>page.click(`#rpBlockForm [data-e-span="${wide}"]`));
   await settle(page);await page.waitForTimeout(250);
   const W=await look();
   /* **入っている塊は詰めない。** 既定の見え方（余白2px/1px・行送り1.15）を
      1pxも変えないこと（§9.132。わざわざ設定していない現場の紙が黙って
      変わらない）。 */
   rec('広いマスでは余白を詰めない（今までの見え方のまま）',
       !!W&&W.dense===1&&W.px===2&&W.py===1&&Math.abs(W.lh-W.fs*1.15)<0.05,
       JSON.stringify(W));
   await inDlg(page,'丈別データ',()=>page.click(`#rpBlockForm [data-e-span="${narrow}"]`));
   await settle(page);await page.waitForTimeout(250);
   const N=await look();
   rec('狭くすると余白が詰まる（左右・上下・行送りとも）',
       !!N&&N.dense<1&&N.px<W.px&&N.py<W.py&&N.lh<W.lh,JSON.stringify(N));
   /* **文字サイズそのものは据え置き**（詰めるのは余白だけ）。実際に見える
      大きさは`--rp-fit`が掛かるので、そちらは次で見る。 */
   rec('詰めても文字サイズ（font-size）は変えない',
       !!N&&N.fs===W.fs,`広${W&&W.fs} / 狭${N&&N.fs}`);
   /* ---- 詰めを止めると縮む倍率が下がる（＝文字が小さくなる） ----
      inline の `--rp-dense` を `!important` で打ち消してから測り直す。
      **A/Bで見ること**——「狭いと縮む」だけを見る網は、詰めが1pxも
      効いていない実装でも通る。 */
   await page.addStyleTag({content:'.rp-block-fit{--rp-dense:1 !important}'});
   await page.evaluate(()=>WL.reportFit());
   await settle(page);await page.waitForTimeout(150);
   const OFF=await look();
   rec('詰めを止めると、そのぶん文字を縮めることになる（＝詰めが効いている）',
       !!OFF&&!!N&&OFF.fit<N.fit-0.001,
       `詰めるとき ${N&&N.fit} / 詰めないとき ${OFF&&OFF.fit}`);

   /* ==========================================================
      §9.303 ① 詰める順序（利用者の指示）
      ----------------------------------------------------------
      「列内の全体余白の調整→個別に余力のあるもの余白調整→改行による文字
        表示エリア確保(高さ方向への逃げ)→文字サイズ調整による表示用量アップ」

      §9.298は「余白→文字」の2手だったので、**折り返しが制御できていな
      かった**——幅が足りなくなると表のセルはその場で折り返し、伸びた高さで
      詰めと文字縮小が起きていた（利用者の報告「1行で納めたいところ2行に
      なってしまったりする」）。

      ここで固定するのは3点。
        1. **広いマスでは段に入らない**（今までの見え方のまま・§9.132）
        2. 狭くすると**文字より先に**余白と「余力のある列の配り直し」が起きる
        3. **段を止めると、そのぶん文字を縮めることになる**（＝段が効いている）
      3つ目が背骨。**「クラスが付いた」だけを見る網は素通りする**——
      印が付いても縮める側がその結果を見ていなければ意味が無い。
      ========================================================== */
   await page.evaluate(()=>{
    document.querySelectorAll('style').forEach(s=>{
     if((s.textContent||'').indexOf('--rp-dense:1 !important')>=0)s.remove();
    });
   });
   await page.evaluate(()=>WL.reportFit());
   await settle(page);await page.waitForTimeout(150);
   const W2=await look(),wideSpan=wide;
   await inDlg(page,'丈別データ',()=>page.click(`#rpBlockForm [data-e-span="${wideSpan}"]`));
   await settle(page);await page.waitForTimeout(250);
   const WP=await look();
   rec('広いマスでは詰めの段に入らない（印も付かない）',
       !!WP&&WP.pack.length===0&&WP.dense===1&&WP.fit===1,JSON.stringify(WP&&{pack:WP.pack,dense:WP.dense,fit:WP.fit}));
   await inDlg(page,'丈別データ',()=>page.click(`#rpBlockForm [data-e-span="${narrow}"]`));
   await settle(page);await page.waitForTimeout(250);
   const NP=await look();
   /* **余白を使い切ってから列を回す**——`share`が付いているのに余白が
      詰まっていなければ、順序が入れ替わっている。 */
   rec('狭いマスでは余白を詰め、余力のある列を詰まった列へ回す（table-layout:auto）',
       !!NP&&NP.pack.indexOf('rp-pack-share')>=0&&NP.dense<1&&NP.tl==='auto',
       JSON.stringify(NP&&{pack:NP.pack,dense:NP.dense,tl:NP.tl,fit:NP.fit}));
   /* ---- 段を止めると、そのぶん文字を縮めることになる（A/B） ---- */
   await page.addStyleTag({content:
     '.rp-block-fit.rp-pack-share .rp-product-table{table-layout:fixed !important}'
    +'.rp-block-fit.rp-pack-nowrap,.rp-block-fit.rp-pack-nowrap *:not(.rp-info-box){white-space:normal !important}'});
   await page.evaluate(()=>WL.reportFit());
   await settle(page);await page.waitForTimeout(150);
   const NOFF=await look();
   rec('段（1行を保つ・余力のある列を回す）を止めると、そのぶん文字を縮めることになる',
       !!NOFF&&!!NP&&NOFF.fit<NP.fit-0.001,
       `段あり ${NP&&NP.fit} / 段なし ${NOFF&&NOFF.fit}`);
  }catch(e){rec('FATAL(§9.298)',false,e.message)}

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  await cleanup();
  if(areaId){try{await post('/api/report-block-master/delete',{id:areaId,user_id:'test'})}catch(e){}}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
