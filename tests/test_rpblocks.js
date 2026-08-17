/* test_rpblocks.js: 帳票の塊（ブロック）と配置の組み換え（§9.169）
   ============================================================
   利用者の指示は「データの塊ごとに(カードのように扱い)表示非表示を修正
   できるように／リアルタイムでその表示状況を確認しながら帳票の配置
   (グリッド化)も組み換えできるように／汎用的な構造に」。

   ここで固定するのは5点。
     1. 紙は12マスの粗いグリッドで、塊が`grid-column:span N`で載る
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
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,order:[],widths:{},hidden:[],
  names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'}).catch(()=>{});
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
const blocks=page=>page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));

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

  /* ---- 1) 紙は12マスの粗いグリッド ---- */
  const base=await page.evaluate(()=>({
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length,
   spans:[...document.querySelectorAll('[data-rp-block]')].map(e=>e.style.gridColumn),
   bars:document.querySelectorAll('.rp-block-bar').length,
   head:!!document.querySelector('.rp-report-head-id')}));
  rec('紙は12マスのグリッドで組む',base.cols===12,String(base.cols)+'列');
  rec('塊は「何マスぶんか」で載る',
      base.spans.length>0&&base.spans.every(v=>/^span \d+$/.test(v)),
      base.spans.slice(0,4).join('／'));
  /* **操作帯は紙に1つも出ない。** CSSで隠す作りだと隠し忘れがそのまま紙に出る
     ので、組み換え中しか組み立てない。 */
  rec('組み換えしていない紙に操作帯は無い',base.bars===0,String(base.bars));
  /* 見出し（設備名・作業年月日・ロット番号）はブロックにしない——この紙が
     どれかを決める鍵で、隠せると配ったあとで区別が付かなくなる。 */
  const heads=await page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')]
    .some(e=>e.querySelector('.rp-report-head-id')));
  rec('帳票の頭は塊にしない（隠せない）',base.head&&!heads);

  const before=await blocks(page);

  /* ---- 2) 組み換えモード ---- */
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-block-bar',{timeout:8000});
  await settle(page);
  const arr=await page.evaluate(()=>({
   bar:!document.getElementById('rpArrangeBar').hidden,
   bars:document.querySelectorAll('.rp-block-bar').length,
   n:document.querySelectorAll('[data-rp-block]').length,
   empty:document.querySelectorAll('.rp-block.is-empty').length}));
  rec('組み換え中は帯と操作が出る',arr.bar&&arr.bars===arr.n&&arr.n>0,JSON.stringify(arr));
  /* このロットに中身が無い塊も**組み換え中は見える**（黙って消えると、
     自分で隠したのかデータが無いのかが分からない）。 */
  const after=await blocks(page);
  rec('中身が無い塊も組み換え中は並ぶ',after.length>=before.length,
      `紙${before.length}件 / 組み換え${after.length}件`);

  /* ---- 3) 触った結果がその場の紙に出る ---- */
  await page.click('[data-rp-block="基本情報"] [data-rp-span="12"]');
  await settle(page);
  const w1=await page.evaluate(()=>document.querySelector('[data-rp-block="基本情報"]').style.gridColumn);
  rec('幅を選ぶとその場で紙が変わる',w1==='span 12',w1);
  await page.click('[data-rp-block="品質等級"] [data-rp-toggle]');
  await settle(page);
  const off=await page.evaluate(()=>document.querySelector('[data-rp-block="品質等級"]').classList.contains('is-off'));
  rec('「隠す」を押すとその場で外れる',off===true,String(off));

  /* 並べ替え。HTML5のD&Dは実際のイベントで確かめる（クリックでは通らない
     経路なので、押しただけでは網にならない）。 */
  const order1=await blocks(page);
  await page.evaluate(([a,c])=>{
   const s=document.querySelector(`[data-rp-block="${a}"]`),t=document.querySelector(`[data-rp-block="${c}"]`);
   const dt=new DataTransfer(),r=t.getBoundingClientRect();
   const at={bubbles:true,dataTransfer:dt,clientX:r.left+r.width*0.75,clientY:r.top+5};
   s.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   t.dispatchEvent(new DragEvent('dragover',at));
   t.dispatchEvent(new DragEvent('drop',at));
   s.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
  },['ラベル貼付スペース','コース情報']);
  await settle(page);
  const order2=await blocks(page);
  rec('塊をドラッグで並べ替えられる',
      order2.indexOf('ラベル貼付スペース')>order1.indexOf('ラベル貼付スペース'),
      order2.slice(0,4).join('／'));

  /* ---- 4) やめる＝開いた時点へ戻る ---- */
  await page.click('#rpArrangeCancel');
  await settle(page);
  const back=await page.evaluate(()=>({
   bars:document.querySelectorAll('.rp-block-bar').length,
   span:document.querySelector('[data-rp-block="基本情報"]').style.gridColumn,
   quality:!!document.querySelector('[data-rp-block="品質等級"]'),
   order:[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock)}));
  rec('「やめる」で開いた時点の配置へ戻る',
      back.bars===0&&back.span!=='span 12'&&back.quality===true,JSON.stringify({span:back.span,quality:back.quality}));
  rec('「やめる」で並びも戻る',JSON.stringify(back.order)===JSON.stringify(before),
      back.order.slice(0,4).join('／'));

  /* ---- 5) 保存＝サーバーに残り、マスの数として往復する ---- */
  await page.click('#reportArrange');
  await page.waitForSelector('.rp-block-bar',{timeout:8000});
  await page.click('[data-rp-block="基本情報"] [data-rp-span="12"]');
  await page.click('[data-rp-block="品質等級"] [data-rp-toggle]');
  await settle(page);
  await page.click('#rpArrangeSave');
  await page.waitForTimeout(1200);
  const saved=await page.evaluate(()=>({
   bars:document.querySelectorAll('.rp-block-bar').length,
   span:document.querySelector('[data-rp-block="基本情報"]').style.gridColumn,
   quality:!!document.querySelector('[data-rp-block="品質等級"]')}));
  rec('保存すると組み換えを抜けて、結果が紙に残る',
      saved.bars===0&&saved.span==='span 12'&&saved.quality===false,JSON.stringify(saved));
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
  await page.waitForSelector('.rp-block-bar',{timeout:8000});
  await settle(page);
  /* 組み換え中は中身の無い塊も並ぶので、そこで「まとめが出ていて個別は
     出さない」既定を確かめる。 */
  const defaults=await page.evaluate(()=>({
   combined:!document.querySelector('[data-rp-block="板幅ほかの測定データ"]').classList.contains('is-off'),
   soloOff:[...document.querySelectorAll('[data-rp-block^="測定データ・"]')].every(e=>e.classList.contains('is-off')),
   solos:document.querySelectorAll('[data-rp-block^="測定データ・"]').length}));
  rec('既定は「まとめて1枚」（個別は出さない）',
      defaults.combined&&defaults.soloOff&&defaults.solos>=6,JSON.stringify(defaults));
  /* 紙のマス数は帯にあり、押すとグリッドが変わる。 */
  const grid0=await page.evaluate(()=>({
   picks:[...document.querySelectorAll('[data-rp-grid]')].map(b=>b.textContent),
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length}));
  rec('紙のマス数を標準として選べる',grid0.picks.join('/')==='12/8/6/4'&&grid0.cols===12,
      `${grid0.picks.join('/')} / いま${grid0.cols}列`);
  await page.click('[data-rp-grid="6"]');
  await settle(page);
  const grid1=await page.evaluate(()=>({
   cols:getComputedStyle(document.querySelector('.rp-blocks')).gridTemplateColumns.split(' ').length,
   labels:[...document.querySelectorAll('[data-rp-block="基本情報"] [data-rp-span]')].map(b=>b.textContent)}));
  rec('マス数を変えると紙の割りも変わる',grid1.cols===6,`${grid1.cols}列`);
  /* 幅の選択肢は**マス数から作る**。割り切れない刻みは近いマスへ寄せて
     同じ幅が2つ並ばないようにまとめる。 */
  rec('幅の選択肢はマス数から作る',grid1.labels.length>=3&&grid1.labels.includes('全幅'),
      grid1.labels.join('・'));
  await page.click('[data-rp-grid="12"]');
  await settle(page);

  /* ---- 分解 → 個別、まとめへ戻す ---- */
  await page.click('[data-rp-block="板幅ほかの測定データ"] [data-rp-split]');
  await settle(page);
  const split=await page.evaluate(()=>({
   solo:[...document.querySelectorAll('[data-rp-block]')].filter(e=>e.dataset.rpBlock.startsWith('測定データ・')&&!e.classList.contains('is-off')).map(e=>e.dataset.rpBlock),
   combined:document.querySelector('[data-rp-block="板幅ほかの測定データ"]').classList.contains('is-off')}));
  rec('「項目ごとに分ける」で個別の塊になる',
      split.solo.length>=6&&split.combined===true,
      `${split.solo.length}枚 / まとめ=${split.combined?'畳んだ':'出たまま'}`);
  /* **同じ内容を2箇所に出さない。** 分解したらまとめは畳む。 */
  rec('分解するとまとめは畳まれる',split.combined===true);
  await page.click('[data-rp-block="測定データ・板幅"] [data-rp-split]');
  await settle(page);
  const rejoin=await page.evaluate(()=>({
   solo:document.querySelector('[data-rp-block="測定データ・板幅"]').classList.contains('is-off'),
   combined:!document.querySelector('[data-rp-block="板幅ほかの測定データ"]').classList.contains('is-off')}));
  rec('「まとめへ戻す」で1枚へ戻る',rejoin.solo===true&&rejoin.combined===true,JSON.stringify(rejoin));

  /* ---- 入りきらないときの案内は、組み換え中しか組み立てない ---- */
  const guide=await page.evaluate(()=>({
   inArrange:document.querySelectorAll('.rp-block-cols').length,
   drops:document.querySelectorAll('[data-rp-drop]').length}));
  rec('落とせる列の一覧を持っている（測定データの塊だけ）',
      guide.inArrange>0&&guide.drops>0,JSON.stringify(guide));
  await page.click('#rpArrangeCancel');
  await settle(page);
  rec('紙には絞り込みの案内を出さない',
      await page.evaluate(()=>document.querySelectorAll('.rp-block-cols,[data-rp-drop]').length===0));

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  await cleanup();
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
