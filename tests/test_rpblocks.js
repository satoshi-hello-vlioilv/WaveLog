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
const cleanup=()=>post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],
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
  /* 置き場所を持つようになった（§9.221 ⑨）ので、`gridColumn`は
     `<列> / span <幅>`の形になる。**入らないときは左へ寄せる**ので、
     全幅を選べば必ず12マスになる。 */
  const span12=v=>/(^|\/\s*)span 12$/.test(String(v||''));
  rec('幅を選ぶとその場で紙が変わる',span12(w1),w1);
  await page.click('[data-rp-block="品質等級"] [data-rp-toggle]');
  await settle(page);
  const off=await page.evaluate(()=>document.querySelector('[data-rp-block="品質等級"]').classList.contains('is-off'));
  rec('「隠す」を押すとその場で外れる',off===true,String(off));

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

  /* ---- 4) やめる＝開いた時点へ戻る ---- */
  await page.click('#rpArrangeCancel');
  await settle(page);
  const back=await page.evaluate(()=>({
   bars:document.querySelectorAll('.rp-block-bar').length,
   span:document.querySelector('[data-rp-block="基本情報"]').style.gridColumn,
   quality:!!document.querySelector('[data-rp-block="品質等級"]'),
   order:[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock)}));
  rec('「やめる」で開いた時点の配置へ戻る',
      back.bars===0&&!span12(back.span)&&back.quality===true,JSON.stringify({span:back.span,quality:back.quality}));
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
      saved.bars===0&&span12(saved.span)&&saved.quality===false,JSON.stringify(saved));
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
  await page.waitForSelector('.rp-block-bar',{timeout:8000});
  /* 塊を大きく開くのは**ダブルクリック**（§9.174）。帯のボタンではない。 */
  await page.dblclick('[data-rp-block="丈別データ"] .rp-block-name');
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
  await page.click('#rpArrangeSave');
  await page.waitForTimeout(1200);
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
  await page.waitForSelector('.rp-block-bar',{timeout:8000});
  await page.dblclick('[data-rp-block="丈別データ"] .rp-block-name');
  await page.waitForSelector('#rpBlockForm [data-e-pmode]',{timeout:8000});
  await page.click('#rpBlockForm [data-e-pmode=""]');
  await settle(page);
  await page.click('#rpBlockClose');
  await page.click('#rpArrangeSave');
  await page.waitForTimeout(1200);
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
  await page.evaluate(()=>{const b=document.getElementById('rpArrangeCancel');if(b)b.click()});
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
