/* test_msteps.js: 測定画面の3段構成（§9.123 第1段）
   ============================================================
   1枚に全部を出す作りをやめ、「準備 → 測定 → 確認」に分ける。この段で
   入れたのは器だけで、中身は今のペインをそのまま使う。

   ここで固定すること:
    - **開いたら①から始まる**（次にすることが1つに決まる）
    - **段は関門ではなくタブ**。順番は強制せず、いつでも行き来できる
    - **②測定は本体を1枚で使う**（面積は「頻度 × 重要度」で配る。実測で
      1/3しかなかった測定に、このとき全幅を渡す）
    - **文脈バーは段をまたいで動かない**（ロット・製品・測定表の形・公差）
    - **進めない理由は書く**（押せるのに何も起きないのがいちばん悪い）
    - **危ない操作を主要動線から外す**（削除は③でだけ出す）
    - **受信欄のDOMを作り直さない**（§9.122。段を往復しても同じノードで、
      ②へ戻ればフォーカスも戻る。ここが崩れると実機で転送が止まる） */
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
/* 入力内容の名前（§9.391で「母材」と「丈毎」の2つに分けた）。
   画面の`WL.measureItem.MATERIAL`／`.PIECE`と同じ。 */
const MATERIAL='全長';        /* §9.396で改名（母材→全長）。群の名前が「母材」 */
const PIECE='寸法・外観';     /* §9.396で改名（丈毎→寸法・外観）。群は「製品」 */
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

run('test_msteps: 測定画面の3段構成（§9.123 第1段）', async ({page,rec,idle,errs})=>{
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});

 const seen=()=>page.evaluate(()=>{
  const rc=s=>{const el=document.querySelector(s);if(!el)return{見:false,w:0};
    const r=el.getBoundingClientRect();
    return {見:r.width>0&&r.height>0&&getComputedStyle(el).display!=='none',w:Math.round(r.width)}};
  return {左:rc('.left-pane'),中:rc('.center-pane'),右:rc('.right-pane'),
    本体:rc('.measure-body'),削除:rc('#discard'),
    段:[...document.querySelectorAll('.mstep')].map(x=>({
      名:x.querySelector('.mstep-name')?.textContent||'',
      状態:x.querySelector('.mstep-state')?.textContent||'',
      いま:x.classList.contains('is-current')})),
    文脈:[...document.querySelectorAll('.mctx-item b')].map(x=>x.textContent.trim()),
    /* **上部帯に出ている一言**。「未測定 N項目」の器（`#mstepNote`）は
       §9.234 ④で廃止したので、ここは常に空になる（帯へ新しい常設の一言を
       置いたら、この検査が気づく）。残件数は段3の状態が言い、**どの項目か**は
       段3のボタンの`title`が持つ（幅を1pxも使わない）。 */
    理由:document.querySelector('#mstepNote')?.hidden===false
      ?(document.querySelector('#mstepNote')?.textContent||''):'',
    段3のtitle:document.querySelector('.mstep[data-mstep="3"]')?.getAttribute('title')||'',
    /* 母材の手入力の案内は**入れる場所のすぐ上**（§9.233 ③）。上部帯へ
       出していたためロット情報が見切れていた。読む場所が変わっただけで、
       「理由を書く」という約束は同じ。 */
    手入力の案内:document.getElementById('materialManualNote')?.hidden?''
      :(document.getElementById('materialManualNote')?.textContent||'')};
 });
 const go=async s=>{await page.evaluate(v=>WL.measureSteps.go(v),s);await paint()};
 /* 割り付けが確定するまで（§9.102「待ちは時間でなく条件で置く」）。道具は
    `tests/lib/wait.js`の1箇所——固定待ちを書き写さない（§9.347）。 */
 const W=require('./lib/wait.js');
 const paint=()=>W.paint(page);

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await idle();

  /* ---- 1) 開いたら①準備から始まる ---- */
  let v=await seen();
  rec('開いたら①準備から始まる',v.段[0]&&v.段[0].いま===true,JSON.stringify(v.段));
  rec('①では基本情報と選択項目が見える',v.左.見&&v.中.見,JSON.stringify({左:v.左,中:v.中}));
  rec('①では測定パネルを出さない',v.右.見===false,JSON.stringify(v.右));

  /* ---- 2) 文脈バーは開いた時点で埋まっている ----
     **段を移動してから埋まるのでは遅い。** 空欄のまま出ていると、
     利用者は「取れていない」のか「まだ描いていない」のか区別できない。 */
  const ctx1=v.文脈;
  rec('文脈バーが開いた時点で埋まっている',
      ctx1.length===4&&ctx1.every(x=>x&&x!=='—'),JSON.stringify(ctx1));
  rec('文脈バーにロット番号が出ている',/L\d+/.test(ctx1[0]||''),ctx1[0]);
  rec('文脈バーに測定表の形（条×丈）が出ている',/条.*丈/.test(ctx1[2]||''),ctx1[2]);
  rec('文脈バーに公差の出どころが出ている',/公差/.test(ctx1[3]||''),ctx1[3]);

  /* ---- 3) 段の状態は色だけでなく文字で出る ---- */
  rec('段に状態の文字が付いている',v.段.every(x=>x.状態&&x.状態.trim()!==''),
      JSON.stringify(v.段.map(x=>x.状態)));

  /* ---- 4) ②測定は「項目リスト＋測定表」の2枚（§9.124） ----
     基本情報（左）は出さず、設定（中）は**入力内容の一覧だけ**を残す。
     1回決めるだけの設定は①のもの。 */
  await go('2');
  const m2=await seen();
  const items=await page.evaluate(()=>{
   const lp=document.getElementById('lengthPos');
   return {
    一覧:document.querySelectorAll('#measureTypeGroup .type-chip').length,
    ほかの設定:[...document.querySelectorAll('.selectors>label')]
      .filter(x=>x.id!=='measureTypeGroup'&&x.id!=='lengthPosGroup'
                 &&x.getBoundingClientRect().height>0).length,
    件数の文字:[...document.querySelectorAll('#measureTypeGroup .type-chip-state')]
      .map(x=>x.textContent.trim()).filter(Boolean).length,
    /* 丈位置は**測定表の列見出し**が兼ねる（§9.136）。一覧は②から降ろした。 */
    丈が見える:[...document.querySelectorAll('#measurementGrid .measure-matrix thead th[class]')]
      .filter(x=>x.getBoundingClientRect().width>0).length>0,
    丈の列:document.querySelectorAll('#measurementGrid .measure-matrix thead th button').length,
    丈の選択肢:lp?lp.options.length:0,
    一覧を出していない:!(document.getElementById('lengthPosGroup')?.getBoundingClientRect().height>0),
   };
  });
  /* ②の3列目は**根拠だけ**（§9.131）。基本情報・幅分割情報は測っている
     最中に見る値なので出すが、品質等級・作業時間・分析は①③のもの。
     §9.124では左ペインごと隠していたが、実測すると母材・揃いのときに
     483〜542pxが空いており、そこへ置くべきものがあった。 */
  const ref2a=await page.evaluate(()=>[...document.querySelectorAll(
    '.left-pane [data-infopanel],.left-pane [data-leftpanel]')]
    .filter(x=>x.getBoundingClientRect().height>0)
    .map(x=>x.dataset.infopanel||x.dataset.leftpanel));
  /* **条の設計は本文グリッドの1枚のカードへ出した**(§9.137)。情報の壁の
     中にあると、①=全幅・②=下段左という骨子の割り付けができない。
     見えていること自体は変わらないので、`#splitCard`で数える。 */
  const split2=await page.evaluate(()=>{const e=document.querySelector('#splitCard');
    return !!e&&e.getBoundingClientRect().height>0});
  rec('②に出すのは根拠（基本情報・幅分割情報）だけ',
      ref2a.length===1&&ref2a.includes('basic')&&split2,
      JSON.stringify(ref2a)+' split='+split2);
  /* 板厚と板幅は枠の数がまるで違うので別々の項目にした（§9.138）＝9項目。 */
  /* 項目は9つ（§9.391で「母材」と「丈毎」を2つに分けた）。 */
  rec('②に入力内容の一覧（9項目）が出る',items.一覧===9,JSON.stringify(items));
  rec('②では1回決めるだけの設定を出さない',items.ほかの設定===0,JSON.stringify(items));
  /* **語彙（`WL.measureItem.ALL`）と画面の選択肢は同じ**（§9.391）。
     マスタの「開く条件」は語彙のほうを読むので、片方だけ足すと
     **画面に無い条件／条件に選べない項目**ができる。 */
  const vocab=await page.evaluate(()=>({
   語彙:(WL.measureItem.ALL||[]).slice(),
   選択肢:[...document.querySelectorAll('#measureType option')].map(o=>o.text.trim()),
  }));
  rec('入力内容の語彙と画面の選択肢が一致する（§9.391）',
      vocab.語彙.join('/')===vocab.選択肢.join('/')&&vocab.語彙.length===9,
      JSON.stringify(vocab));
  /* **丈位置は②に出す（§9.125）。** `PageUp/PageDown`で動かせるのに、
     以前はどの段にも出ておらず「いま何丈目か」は`#stepStatus`の文でしか
     分からなかった。高さは選択肢の数ぶん——7行固定だと空白が並ぶ。 */
  /* **見えているかは測る項目を選んでから**（下の「全丈位置の列が出る」）。
     ここでは母材が選ばれており、測定表そのものが降りている。 */
  rec('②の測定表に丈位置の列がある',items.丈の列===items.丈の選択肢&&items.丈の列>0,
      JSON.stringify(items));
  /* **同じものを選ぶ道具を2つ置かない**（§9.129）。列見出しが選択を兼ねる
     ので、一覧（リストボックス）は②から降ろした。 */
  rec('丈位置の一覧は②に出さない',items.一覧を出していない===true,JSON.stringify(items));
  rec('一覧の各項目に残り件数が文字で付く',items.件数の文字===9,JSON.stringify(items));
  /* 測定表は本体のいちばん広いカード。骨子（§9.137）で`2×3`＝**本体の半分**
     と決めたので、しきい値も半分ちょうどで見る（以前は3列＝3/4だった）。
     丈位置×条の1つの表（§9.136）は最大10列×40行なので2マス幅で足りる。 */
  /* **カード間の余白を見込む**（§9.137の意匠）。本文は灰色の地で、カードは
     `--gap-section`(12px)ずつ離して置くので、2マスぶんのカードは
     「本体の半分 − 余白1つぶん」になる。生の半分と比べると必ず落ちる。 */
  rec('②の測定表が本体の半分を占める',m2.右.w>=Math.floor(m2.本体.w*0.5)-40,
      `測定=${m2.右.w} / 本体=${m2.本体.w}`);

  /* ---- 4b) 測定表は「使う条数ぶんだけ」描く（§9.124／§9.136） ----
     以前は条数に関わらず 2列×20行＝40条を必ず描き、超えた行を灰色で残して
     いた。1条のロットでも39行の空欄が並ぶ。**探す対象を増やさない。**
     **条は1列で40行まで。2段に折らない**（§9.136）——横は丈位置が使う。 */
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await idle();
  const rowsFor=async n=>{
   await page.evaluate(v=>{const h=document.querySelector('#horizontalCount');
     h.value=String(v);h.dispatchEvent(new Event('change',{bubbles:true}))},n);
   await idle();
   return page.evaluate(()=>({
    行:document.querySelectorAll('#measurementGrid .measure-matrix tbody tr').length,
    /* 条の列は**1本だけ**。丈位置の列はこれとは別（横に並ぶ）。 */
    条の列:document.querySelectorAll('#measurementGrid .measure-matrix tbody tr:first-child th').length,
    灰色の行:document.querySelectorAll('#measurementGrid .measure-matrix tr.inactive').length}));
  };
  const r1=await rowsFor(1),r6=await rowsFor(6),r24=await rowsFor(24),r40=await rowsFor(40);
  rec('1条なら1行しか描かない',r1.行===1&&r1.条の列===1,JSON.stringify(r1));
  rec('6条なら6行',r6.行===6&&r6.条の列===1,JSON.stringify(r6));
  rec('20条を超えても2段に折らない',r24.行===24&&r24.条の列===1,JSON.stringify(r24));
  rec('40条でも1列40行',r40.行===40&&r40.条の列===1,JSON.stringify(r40));
  rec('使わない行(灰色)を残さない',
      [r1,r6,r24,r40].every(x=>x.灰色の行===0),
      JSON.stringify([r1.灰色の行,r6.灰色の行,r24.灰色の行,r40.灰色の行]));

  /* ---- 4c) 器も条数ぶんだけ（§9.126） ----
     行を条数ぶんに減らした後も、**CSSが40条ぶんの場所を取り続けていた**
     （`repeat(2,1fr)` × 20行が固定）。DOMの数を見るだけでは捕まらないので、
     **実際の寸法**で見る。 */
  const geom=async n=>{
   await page.evaluate(v=>{const h=document.querySelector('#horizontalCount');
     h.value=String(v);h.dispatchEvent(new Event('change',{bubbles:true}))},n);
   await idle();
   return page.evaluate(()=>{
    const r=e=>e?e.getBoundingClientRect():null;
    const cols=[...document.querySelectorAll('#measurementGrid .compact-other .measure-matrix')];
    const body=document.querySelector('#measurementGrid .compact-other .matrix-body');
    const tol=body&&body.querySelector('.compact-tolerance-side');
    const rows=[...document.querySelectorAll('#measurementGrid .compact-other .measure-matrix tbody th')];
    const cr=cols.map(x=>r(x)),br=r(body),tr=r(tol);
    const lay=document.querySelector('#measurementGrid .compact-other .mx-scroll');
    const lr=r(lay);
    return {列:document.querySelectorAll('#measurementGrid .measure-matrix tbody tr:first-child th').length,
      /* **列の数だけでは足りない。** CSSが2列ぶんの場所を取ったままだと
         DOMは1つでも幅は半分になる（実際にそれを見逃した）。 */
      入力表の幅:cr.length?Math.round(cr[0].width):0,
      セルの幅:(()=>{const c=document.querySelector('#measurementGrid .measure-matrix tbody td');
        return c?Math.round(c.getBoundingClientRect().width):0})(),
      器の幅:lr?Math.round(lr.width):0,
      表の高さ:cr.length?Math.round(cr[0].height):0,
      最後の行の下端:rows.length?Math.round(r(rows[rows.length-1]).bottom):0,
      表の下端:cr.length?Math.round(cr[0].bottom):0,
      /* 公差の図が無い項目（公差の登録が無い／指示公差）では左の列ごと
         畳んで表へ渡す（§9.140）。畳んだ器は`display:none`で寸法が0に
         なるので、**そのまま隙間を測ると1060pxという嘘の値になる**。
         どちらの形かを先に持っておき、見るものを切り替える。 */
      図あり:!!(body&&!body.classList.contains('no-graph')&&tr&&tr.width>0),
      公差と表のすきま:(tr&&cr.length&&tr.width>0)?Math.round(cr[0].left-tr.right):null,
      表の左と器の左のずれ:(br&&cr.length)?Math.round(cr[0].left-br.left):null,
      器の右の余り:(br&&cr.length)?Math.round(br.right-cr[cr.length-1].right):null};
   });
  };
  const g8=await geom(8),g40=await geom(40);
  rec('条の列は1本（8条）',g8.列===1,JSON.stringify(g8));
  /* **器いっぱいに引き伸ばさない**（§9.130）。器を埋めると丈位置4つの
     ロットで1セル222pxになり、`1234.56`（実測63px）の3倍以上になる。
     見るのは**下限**——値が入る幅があること（上の「中身より80px以上広い欄が
     無い」が上限を見ているので、これで両側から挟める）。 */
  rec('セルに値が入る幅がある',g8.セルの幅>=60,JSON.stringify(g8));
  rec('条の列は1本のまま（40条）',g40.列===1,JSON.stringify(g40));
  /* 行の数だけ器を取る。最後の行の下と器の下がほぼ一致すること
     （20行固定のままなら、8条では12行ぶん＝300px以上の白が残る）。 */
  rec('使う行数ぶんの高さしか取らない',
      Math.abs(g8.表の下端-g8.最後の行の下端)<=8,JSON.stringify(g8));
  /* **一緒に読むものを引き離さない。** 公差数直線は縦向きなので、空いた
     幅を公差側へ回すと数直線と入力表のあいだに900pxの空白ができる。 */
  /* 図が無い項目では列ごと畳むので（§9.140）、**表が器の左端から始まる**
     ことで見る。畳んだ器の寸法(0)を使って隙間を測ると、どこに何があっても
     通ってしまう。 */
  rec('公差と入力表が隣り合っている',
      g8.図あり?(g8.公差と表のすきま!==null&&g8.公差と表のすきま<40)
              :(g8.表の左と器の左のずれ!==null&&g8.表の左と器の左のずれ<40),
      JSON.stringify(g8));

  /* ---- 4d) 丈位置は測定表の列そのもの（§9.136） ----
     以前は「いまの丈の帯」＋「丈位置くらべ」の2枚で、同じ値が2箇所に
     あった。1つの表にしたので、**他の丈位置の値は同じ表の隣の列**にある。
     **公差の材料ごと注ぎ込む**——検証用フィクスチャには公差が無い。 */
  await rowsFor(8);
  const lcSetup=await page.evaluate(()=>{
   const m=S.measure;
   m.basic.mfgWidth=100;m.basic.mfgThickness=2;
   m.source=m.source||{};
   m.source['板幅公差_製造_プラス']=0.5;m.source['板幅公差_製造_マイナス']=0.5;
   m.measurements.width.forEach(r=>r.fill(''));
   m.measurements.width[0][0]='100.2';   // 合格（1丈目＝いま出ている）
   m.measurements.width[0][2]='150.0';   // 公差外
   m.measurements.width[1][1]='99.6';    // 合格（2丈目＝出ていない）
   WL.measureInput.renderMeasureGrid();
   return !!WL.measureInput.toleranceDetail('width',0,'板幅');
  });
  await paint();
  rec('公差の材料を注ぎ込めた(測定表)',lcSetup===true,String(lcSetup));
  const lc=()=>page.evaluate(()=>{
   const sec=document.querySelector('#measurementGrid .measure-matrix');
   if(!sec)return{出ている:false};
   const heads=[...sec.querySelectorAll('thead th')];
   const rows=[...sec.querySelectorAll('tbody tr')];
   /* 値は入力欄の中にある（この表は読むだけでなく**入れる**表）。 */
   const cellVal=(r,c)=>rows[r]?.querySelectorAll('td')[c]?.querySelector('input')?.value||'';
   const ng=[...sec.querySelectorAll('input.ng')];
   return{
    出ている:true,
    見出し:heads.map(x=>x.textContent.trim()),
    行数:rows.length,
    いまの列:heads.findIndex(x=>x.classList.contains('is-current')),
    /* 別の丈位置の値が**同じ表の隣の列**に出ていること。 */
    他の丈の値:cellVal(1,1),
    公差外の印:ng.length,
    公差外の値:ng.map(x=>x.value),
    幅:Math.round(sec.getBoundingClientRect().width),
   };
  });
  const lc1=await lc();
  rec('②の測定表に全丈位置の列が出る',lc1.出ている===true&&lc1.幅>150,JSON.stringify(lc1));
  rec('列は「条」＋丈位置の数',lc1.見出し.join('/')==='条/1(頭)/1(尾)',JSON.stringify(lc1.見出し));
  rec('行は条数ぶん',lc1.行数===8,String(lc1.行数));
  /* **出ていない丈の値が見えること。** ここが空なら、この表を出す意味がない。 */
  /* 板幅は**小数2桁**（§9.242 ②、利用者の指示）。注ぎ込んだ`99.6`は
     欄では`99.60`として出る（桁数は`WL.base.measurementDigits('width')`の1箇所）。 */
  rec('いま出ていない丈位置の値が見える',lc1.他の丈の値==='99.60',JSON.stringify(lc1));
  rec('いま入力している丈位置が分かる',lc1.いまの列===1,JSON.stringify(lc1));
  rec('公差外はここでも印が付く',lc1.公差外の印===1&&lc1.公差外の値[0]==='150.00',
      JSON.stringify(lc1.公差外の値));
  /* 見出しを押したらその丈位置へ移る（見えた値へすぐ行ける）。 */
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#measurementGrid .measure-matrix thead th button')];
   b[1].click();
  });
  await idle();
  const lc2=await lc();
  const movedTo=await page.evaluate(()=>document.querySelector('#lengthPos').value);
  rec('見出しを押すとその丈位置へ移る',movedTo==='1(尾)'&&lc2.いまの列===2,
      JSON.stringify({movedTo,いまの列:lc2.いまの列}));
  await page.evaluate(()=>{const lp=document.querySelector('#lengthPos');
    lp.selectedIndex=0;lp.dispatchEvent(new Event('change',{bubbles:true}))});
  await idle();
  /* **条数が増えても表は1つのまま**（§9.136）。以前は20条を超えると帯が
     2列になり、その場所を取るために丈位置くらべを降ろしていた。1つの表に
     したので、条が増えても列（丈位置）の並びは変わらない。 */
  await rowsFor(24);
  const lc3=await lc();
  rec('条数が増えても丈位置の列は変わらない',
      lc3.出ている===true&&lc3.見出し.length===lc1.見出し.length&&lc3.行数===24,
      JSON.stringify({見出し:lc3.見出し,行数:lc3.行数}));
  await rowsFor(8);
  /* 後始末: 次の検証（③の公差外の集計）へ値を持ち越さない。 */
  await page.evaluate(()=>{S.measure.measurements.width.forEach(r=>r.fill(''));WL.measureInput.renderMeasureGrid()});
  await paint();
  await rowsFor(1);

  /* ---- 5) 進めない理由を書く ----
     既定の入力内容は母材＝手動入力の項目なので、測定器からは受けられない。
     **そのことを画面に書く**（押せるのに何も起きないのが最悪）。
     出す場所は**母材のカードの題**（§9.233 ③）——上部帯へ出していたため、
     母材のときだけロット情報が33〜70px切れていた（実測1366px）。 */
  rec('②で測定器を使えない項目のときは理由を書く',
      /母材|手動|手入力/.test(m2.手入力の案内||''),m2.手入力の案内||'(空)');
  rec('その理由は上部帯には出さない（ロット情報を押し出さない）（§9.233 ③）',
      !/母材|手入力/.test(m2.理由||''),m2.理由||'(空)');
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await idle();
  const m2b=await seen();
  rec('測定器を使う項目に変えたら理由は消える',
      (m2b.理由||'')===''&&(m2b.手入力の案内||'')==='',
      JSON.stringify({帯:m2b.理由||'(空)',案内:m2b.手入力の案内||'(空)'}));

  /* ---- 5b) 入力内容・丈位置のキーボード操作は**持たない**（§9.160） ----
     利用者の指示「自動入力との競合かうまく効かない。自動入力が優先なので、
     無理にキーボードショートカット操作させる必要もないのできれいに削除」。
     消したのは案内（`.mnav-hint`）だけでなく**割り当てそのもの**——案内だけ
     消して受け付けたままにすると、打っている最中に項目が飛ぶ事故が残る。 */
  const noKeys=async()=>{
   await page.evaluate(()=>{const s=document.querySelector('#measureType');
     s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
   await idle();
   const before=await page.evaluate(()=>({
     項目:document.querySelector('#measureType').value,
     丈:document.querySelector('#lengthPos').value}));
   for(const k of ['ArrowRight','ArrowLeft','PageDown','PageUp','F2']){
    await page.keyboard.press(k);await paint();
    }
    /* 「動かないこと」は条件で待てない。動くなら動くはずの往復（保存など）が静まるまで待つ。 */
    await idle(800);
    const after=await page.evaluate(()=>({
     項目:document.querySelector('#measureType').value,
     丈:document.querySelector('#lengthPos').value}));
   return{before,after};
  };
  const keys=await noKeys();
  rec('→ ← PgUp PgDn F2 では入力内容・丈位置が動かない',
      keys.before.項目===keys.after.項目&&keys.before.丈===keys.after.丈,
      JSON.stringify(keys));
  const navGone=await page.evaluate(()=>({
   案内:!!document.querySelector('.mnav-hint'),
   割り当て:typeof (window.WL&&WL.measureNav)!=='undefined',
  }));
  rec('キーの案内も割り当ても残っていない',
      navGone.案内===false&&navGone.割り当て===false,JSON.stringify(navGone));

  /* ---- 5c) ①準備は役割ごとにまとまり、「その他」は畳む（§9.125） ----
     18個の選択項目が意味なく並んでいた。**毎回決めるもの**（誰が・形・機材）
     だけを出し、前の設定のままで済む5つは畳む。**畳んでも値は読める**
     ——隠したものが何かを書かずに隠すと、設定の存在ごと忘れられる。 */
  await go('1');
  const prep=()=>page.evaluate(()=>{
   const box=document.querySelector('.measure-shell .selectors');
   const vis=x=>x.getBoundingClientRect().height>0;
   const id=x=>x.querySelector('select,input')?.id||'';
   return {
    見出し:[...box.querySelectorAll('.prep-head')].filter(vis)
      .map(x=>(x.querySelector('.prep-fold-name')||x.querySelector('.prep-more-name')||x).textContent.trim()),
    出ている項目:[...box.querySelectorAll('label')].filter(vis).map(id),
    /* 「準備」に置いた欄で見えていないもの。**置き場で引く**——群も
       畳むかどうかもマスタが決めるので、`data-prep="usual"`のような
       固定の名前では引けない（§9.216 ②）。 */
    畳んでいる項目:[...box.querySelectorAll('label[data-opplace="準備"]')].filter(x=>!vis(x)).map(id),
    要約:document.querySelector('#prepMoreList')?.textContent.trim()||'',
    状態:document.querySelector('#prepMoreState')?.textContent.trim()||'',
    開いている:box.classList.contains('prep-open'),
   };
  });
  const p1=await prep();
  rec('①は群ごとの見出しを持つ（マスタが決める）',p1.見出し.length>=4,JSON.stringify(p1.見出し));
  /* **オペレータはプルダウン**(§9.133)。リストボックスは器の中で5,394px
     スクロールしており(実測)、1画面に収める方針にも反していた。
     **選択肢は1人も減らさない**——171人ぜんぶ入っていることを見る。 */
  const opList=await page.evaluate(()=>{
   const el=document.getElementById('operator');
   return {size:el.size,選択肢:el.options.length,
     はみ出し:Math.round(el.scrollHeight-el.clientHeight)};
  });
  rec('オペレータはプルダウン(リストボックスにしない)',opList.size<=1,JSON.stringify(opList));
  /* **数はマスタと突き合わせる**（§9.200）。「100人以上」と決め打ちして
     いたが、検証用フィクスチャのオペレータは29人なので**必ず落ちる**
     ——実データ(171人)を前提にした数字が残っていた。マスタの件数と
     選択肢の件数が合っていることを見れば、どちらの環境でも成り立つ
     （先頭の「-」は「選んでいない」ぶんなので1つ多い）。 */
  const opMaster=await page.evaluate(async()=>{
   /* オペレータは操業データ選択肢マスタの「オペレータ」まとまりへ移した
      （§9.221 ③）。数える先も一緒に移す。 */
   try{const r=await api('/api/operation-choice-master');
       return (r.items||[]).filter(x=>x.name==='オペレータ'&&x.enabled!==false).length}
   catch(e){return -1}
  });
  rec('オペレータの選択肢を減らしていない（マスタの件数と合う）',
      opMaster>0&&(opList.選択肢===opMaster||opList.選択肢===opMaster+1),
      JSON.stringify({...opList,マスタ:opMaster}));
  rec('オペレータ欄が器の中でスクロールしない',opList.はみ出し<=1,JSON.stringify(opList));
  /* 見出しの文字は**名前だけ**を見る。「いつもと同じ設定」の見出しには
     畳んだ5項目の現在値が続くので、innerTextをそのまま比べると必ず落ちる。 */
  rec('見出しの先頭は「誰が→形→機材→いつもと同じ」の順（マスタの並び）',
      p1.見出し.slice(0,4).join('/')==='誰が測るか/測定表の形/使う機材/いつもと同じ設定',
      p1.見出し.join('/'));
  /* 置き場が「入力内容」の群は①に出さない（§9.216 ③）。 */
  rec('①に「条の入力」の群を出さない',!p1.見出し.includes('条の入力'),p1.見出し.join('/'));
  /* ②で使う道具（入力内容・丈位置）は①に出さない。**1回決めるものと、
     測りながら何度も切り替えるものを同じ場所に並べない。** */
  rec('①に入力内容・丈位置を出さない',
      !p1.出ている項目.includes('measureType')&&!p1.出ている項目.includes('lengthPos'),
      JSON.stringify(p1.出ている項目));
  /* **①の準備の入力欄12個は全部出ている**（§9.143／§9.216 ②）。
     以前は14個で、そのうち「条入力順」「方向」は準備に無関係だったので
     ②の入力内容カードへ移した（§9.216 ③、利用者の指示）。
     **どの欄を出すかはマスタが決める**ようになったので、ここで見るのは
     「既定の設定でいままでどおり出ること」。 */
  const FOLDED=['unwind','burr','coilStop'];
  const ALWAYS=['operator','inspector','crewSize','verticalCount','horizontalCount',
                'innerDiameter','spool','thicknessGauge','widthGauge'];
  const ALL12=[...ALWAYS,...FOLDED];
  rec('①の準備の入力欄12個は全部出ている',
      ALL12.every(k=>p1.出ている項目.includes(k)),
      JSON.stringify(ALL12.filter(k=>!p1.出ている項目.includes(k))));
  rec('条入力順・方向は①に出さない（②の入力内容カードへ移した）',
      !p1.出ている項目.includes('widthOrder')&&!p1.出ている項目.includes('widthDirection'),
      JSON.stringify(p1.出ている項目.filter(k=>/width(Order|Direction)/.test(k))));
  /* 操業データの自由項目も**同じカード・同じ器**に並ぶ（§9.216 ⑤）。
     器が同じなら文字の大きさもそろう——別の器を別のカードへ置いていた
     ときは、名前・値・注記がそれぞれ違う大きさになっていた。 */
  const opFree=await page.evaluate(()=>{
   const box=document.querySelector('.measure-shell .selectors');
   const gen=[...box.querySelectorAll('label[data-opfield]')];
   const vis=gen.filter(x=>x.getBoundingClientRect().height>0);
   const builtin=box.querySelector('label[data-f="operator"]');
   const size=el=>el?getComputedStyle(el).fontSize:'';
   return {自由項目:gen.length,見えている:vis.length,
     器:vis[0]?vis[0].tagName:'',
     名前の大きさ:size(vis[0]&&vis[0].querySelector('.opf-name')),
     組み込みの名前の大きさ:size(builtin),
     値の大きさ:size(vis[0]&&vis[0].querySelector('select,input')),
     組み込みの値の大きさ:size(builtin&&builtin.querySelector('select,input'))};
  });
  rec('操業データの自由項目も準備と同じカードに並ぶ',
      opFree.自由項目>0&&opFree.見えている>0&&opFree.器==='LABEL',
      JSON.stringify(opFree));
  rec('自由項目と組み込みの入力欄は同じ文字サイズ（§9.216 ⑤）',
      opFree.値の大きさ===opFree.組み込みの値の大きさ,
      JSON.stringify({自由:opFree.値の大きさ,組み込み:opFree.組み込みの値の大きさ}));
  rec('①に畳んだままの項目は無い',p1.畳んでいる項目.length===0,JSON.stringify(p1.畳んでいる項目));
  /* 畳む道具は残っている。**畳んだときは値が読めること**が条件（§9.125）
     ——隠したものが何かを書かずに隠すと、設定の存在ごと忘れられる。
     **見出しはマスタの群から作られる**ので、idではなく群の名前で引く。 */
  const usual=await page.evaluate(async(ids)=>{
   const btn=document.querySelector('.selectors .prep-fold[data-opgroup="いつもと同じ設定"]');
   if(!btn)return{見出しなし:true};
   btn.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const now=document.querySelector('.selectors .prep-fold[data-opgroup="いつもと同じ設定"]');
   const sum=now&&now.querySelector('.prep-sum');
   const vals=ids.map(id=>{const e=document.getElementById(id);
       return e?((e.selectedOptions&&e.selectedOptions[0]?e.selectedOptions[0].text:e.value)||'').trim():''});
   const 隠れた=ids.filter(id=>{const e=document.getElementById(id);
       return e&&e.closest('label')&&e.closest('label').offsetParent===null});
   return{要約:(sum&&sum.textContent||'').trim(),値:vals,隠れた,
     畳んでいる:now?now.getAttribute('aria-expanded')==='false':null};
  },FOLDED);
  rec('開いた状態で始まり、押せば畳める',
      usual.畳んでいる===true&&usual.隠れた.length===FOLDED.length,JSON.stringify(usual));
  rec('畳んだときは現在値が読める',
      usual.値.filter(v=>v&&v!=='-').every(v=>usual.要約.includes(v)),
      JSON.stringify(usual));
  await page.evaluate(()=>{
   const b=document.querySelector('.selectors .prep-fold[data-opgroup="いつもと同じ設定"]');
   if(b)b.click();
  });
  await paint();
  /* **作業時間は①に置かない**（§9.143、利用者の指示）。「準備の入力」は
     測る前に1回決める設定の面で、時刻の記録はそこへ混ざると異物に見える。
     ③「確認して完了」へ移した（実作業時間は測り終えてから確定するもの）。 */
  const prepWt=await page.evaluate(()=>{
   const w=document.querySelector('.measure-shell .selectors [data-f="workTime"]');
   return {出ている:!!(w&&w.offsetParent!==null&&w.getBoundingClientRect().height>0),
     欄はある:!!document.getElementById('workStartAt')};
  });
  rec('①に作業時間を出さない',prepWt.出ている===false&&prepWt.欄はある,JSON.stringify(prepWt));
  /* **判定公差は①に出さない**（§9.143、利用者の指示）。通常は製造公差で
     触ることがなく、判定しているのは②③。選べないときは②③でも出さない。 */
  const tol1=await page.evaluate(()=>{
   const box=document.querySelector('.tolerance-source-control');
   return {出ている:!!(box&&box.offsetParent!==null&&box.getBoundingClientRect().height>0),
     欄はある:!!document.getElementById('toleranceSource')};
  });
  rec('①に判定公差の切替を出さない',tol1.出ている===false&&tol1.欄はある,JSON.stringify(tol1));

  /* ---- 6) ③確認 ---- */
  await go('3');
  const m3=await seen();
  /* ③は記録の壁**4枚**（§9.137）。作業時間は準備の入力の器を作業時間だけの
     表示にして4枚目に置くので、`.center-pane`も出る（測定パネルだけが降りる）。 */
  rec('③は記録の壁で、測定パネルだけが降りる',m3.左.見&&m3.中.見&&!m3.右.見,
      JSON.stringify({左:m3.左.見,中:m3.中.見,右:m3.右.見}));
  /* 「残っているか」は段の見出しにも本文にも出る。**どちらか片方だけを
     見ないこと**——`||`で拾うと先に空でないほうしか見ず、主張が変わる。 */
  const rest3=(m3.理由||'')+' / '+(m3.段[2].状態||'');
  rec('③には残りの件数を数で書く',/\d+\s*項目/.test(rest3),rest3);

  /* ---- 上部帯: ロット情報が見切れない（§9.234 ④、利用者の指示） ----
     帯は「段ナビ（縮まない）＋文脈＋保存の状態（縮まない）」で、足りないぶんは
     全部文脈が払う。以前は③のときだけ「未測定 N項目」がここへ載っており、
     **隣の段3の状態（残り N項目）と同じ数字**なのに、そのぶんロット情報が
     押されて全部見切れていた（実測: 1366pxで4項目とも33〜70px切れ）。
     **確かめるときは実際に窓を狭くすること**（§9.222 ⑥）——1920pxでは
     全部入るので、直す前でも通ってしまう（実際に通していた）。
     **幅0も見ること**——幅0の要素は溢れを報告しないので、`見切れ0`だけを
     見ると1280pxで実際に起きていた「値が幅0px＝完全に不可視」を素通りする。 */
  const barFit=[];
  for(const [vw,vh] of [[1280,768],[1366,768],[1600,900]]){
   await page.setViewportSize({width:vw,height:vh});
   for(const size of ['sm','md','lg']){
    await page.evaluate(s=>document.documentElement.setAttribute('data-ui-size',s),size);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    barFit.push(await page.evaluate(k=>{
     const box=e=>e?{w:e.clientWidth,over:Math.max(0,e.scrollWidth-e.clientWidth)}:null;
     const bar=document.querySelector('.measure-bar');
     return{k,
      note:!!document.getElementById('mstepNote'),
      帯の溢れ:Math.max(0,bar.scrollWidth-bar.clientWidth),
      ロット:box(document.getElementById('mctxLot')),
      段3:document.getElementById('mstepState3')?.textContent||'',
      段3のtitle:document.querySelector('.mstep[data-mstep="3"]')?.getAttribute('title')||''};
    },`${vw}x${vh}/${size}`));
   }
   await page.evaluate(()=>document.documentElement.setAttribute('data-ui-size','md'));
  }
  await page.setViewportSize({width:1920,height:1080});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  rec('帯の「未測定 N項目」は廃止した（段3の状態と同じ数字だった・§9.234 ④）',
      barFit.every(x=>x.note===false),JSON.stringify(barFit[0]));
  rec('ロット情報は見切れない（狭い窓×3段とも・§9.234 ④）',
      barFit.every(x=>x.ロット&&x.ロット.over<=1&&x.ロット.w>0),
      JSON.stringify(barFit.filter(x=>!(x.ロット&&x.ロット.over<=1&&x.ロット.w>0))||barFit[0]));
  rec('帯そのものが溢れない（狭い窓×3段とも）',
      barFit.every(x=>x.帯の溢れ<=1),JSON.stringify(barFit.map(x=>[x.k,x.帯の溢れ])));
  rec('残りの件数は段3の状態が言う（§9.234 ④）',
      barFit.every(x=>/\d+\s*項目|確認できます|終了 済/.test(x.段3)),
      JSON.stringify(barFit.map(x=>[x.k,x.段3])));
  /* **項目名は語彙から引く**（§9.389 の教訓）——綴りを直に書くと、
     正しい改名をしただけで落ちる（§9.396で`母材`→`全長`にしたとき実際に落ちた）。 */
  rec('未測定の項目名は段3のtitleが持つ（幅を使わない）',
      (barFit[1].段3のtitle||'').includes(MATERIAL),barFit[1].段3のtitle||'(無し)');

  /* ---- 5b) ③の公差一覧（§9.157、利用者の指摘） ----
     「公差指示がラテラルボーしか出ていませんが、板厚、板幅、板丈の公差が
     あります。設備マスタでコイルの場合は板丈はありませんが、板の設備の
     場合は板丈があります。」
     **検証用フィクスチャには公差が1件も入っていない**（CLAUDE.md）ので、
     **材料ごと注ぎ込む**——入れずに「0件」を見ても、壊れていても同じ
     結果になる。 */
  /* **注ぎ込んだ材料は必ず戻す**（§9.121の「前の実行の置き土産」と同じ罠の
     テスト内版）。戻さないと、この後の「公差が引けない項目は判定していないに
     回す」が板幅の公差を拾って落ちる（実際に2件落ちた）。 */
  const tolBackup=await page.evaluate(()=>({
   基本:{t:S.measure.basic.mfgThickness,w:S.measure.basic.mfgWidth,l:S.measure.basic.mfgLength},
   区分:S.measure.settings.equipmentKind}));
  const tolList=async kind=>{
   await page.evaluate(k=>{
    Object.assign(S.measure.source,{
     '板厚公差_製造_ﾌﾟﾗｽ':0.05,'板厚公差_製造_ﾏｲﾅｽ':0.05,
     '板幅公差_製造_ﾌﾟﾗｽ':1.0,'板幅公差_製造_ﾏｲﾅｽ':1.0,
     '板丈公差_製造_ﾌﾟﾗｽ':2.0,'板丈公差_製造_ﾏｲﾅｽ':0.0});
    S.measure.basic.mfgThickness=3.0;S.measure.basic.mfgWidth=1250.4;S.measure.basic.mfgLength=2500.8;
    S.measure.settings.equipmentKind=k;
   },kind);
   await go('3');
   return page.evaluate(()=>{
    const host=document.getElementById('toleranceList3');
    /* §9.166で6列の表から「1項目1枚」の積み重ねへ変えた。読むのは
       項目名と判定範囲で、根拠（基準・公差・出どころ）は2行目。 */
    return{項目:[...host.querySelectorAll('.tol-card-name')].map(e=>e.textContent.trim()),
      範囲:[...host.querySelectorAll('[data-tol-range]')].map(e=>e.textContent.trim()),
      根拠:[...host.querySelectorAll('.tol-card-basis')].map(e=>e.textContent.trim()),
      注記:(host.querySelector('.tol-list-note')?.textContent||'').trim(),
      /* 1項目ぶんの公差カードと同じ数字を2箇所に出さない（§9.129）。 */
      単品カード:(()=>{const f=document.querySelector('.tol-facts');if(!f)return false;
        const r=f.getBoundingClientRect();return r.width>0&&r.height>0})()};
   });
  };
  const tl板=await tolList('板');
  rec('③の公差一覧に板厚・板幅・板丈が出る（板の設備）',
      ['板厚','板幅','板丈'].every(n=>tl板.項目.includes(n)),JSON.stringify(tl板.項目));
  rec('③の公差一覧は判定範囲まで出す',
      tl板.範囲.some(v=>/～/.test(v)),JSON.stringify(tl板.範囲.slice(0,3)));
  /* §9.166: 左右対称の公差を`+0.500 -0.500`と2つ出さない（同じ数字を2度
     読ませたうえで桁がそろわない）。根拠の行に出どころも必ず添える。 */
  rec('左右対称の公差は「±」1つにまとめる',
      tl板.根拠.some(v=>/±/.test(v)),JSON.stringify(tl板.根拠.slice(0,3)));
  rec('公差の根拠に出どころを必ず添える',
      tl板.根拠.filter(v=>/公差/.test(v)).length>=2,JSON.stringify(tl板.根拠.slice(0,3)));
  const tlコイル=await tolList('コイル');
  rec('コイルの設備には板丈を出さず、理由を文で言う',
      !tlコイル.項目.includes('板丈')&&/コイル/.test(tlコイル.注記),
      JSON.stringify({項目:tlコイル.項目,注記:tlコイル.注記}));
  const tl未=await tolList('');
  rec('区分が未設定なら板丈を出さず、直し方を書く',
      !tl未.項目.includes('板丈')&&/マスタ管理/.test(tl未.注記),
      JSON.stringify({項目:tl未.項目,注記:tl未.注記}));
  rec('③に1項目ぶんの公差カードを重ねない',!tl板.単品カード,String(tl板.単品カード));
  await page.evaluate(b=>{
   ['板厚公差_製造_ﾌﾟﾗｽ','板厚公差_製造_ﾏｲﾅｽ','板幅公差_製造_ﾌﾟﾗｽ','板幅公差_製造_ﾏｲﾅｽ',
    '板丈公差_製造_ﾌﾟﾗｽ','板丈公差_製造_ﾏｲﾅｽ'].forEach(k=>{delete S.measure.source[k]});
   S.measure.basic.mfgThickness=b.基本.t;S.measure.basic.mfgWidth=b.基本.w;
   S.measure.basic.mfgLength=b.基本.l;S.measure.settings.equipmentKind=b.区分;
   if(typeof WL.measureInput.renderMeasureGrid==='function')WL.measureInput.renderMeasureGrid();
  },tolBackup);
  await go('3');

  /* ---- 6a) ③の作業時間（§9.143、利用者の指示でゼロベース） ----
     手で入れる開始・終了のほかに、**測定の操作そのものが知っている時刻**を
     3つだけ自動で残す（入力を始めた／転送を受け始めた／最後に入力した）。
     参考であって、開始・終了を勝手に書き換えないこと——実作業時間は段取りや
     中断を含み、人しか決められない。 */
  const wt3=await page.evaluate(()=>{
   const w=document.querySelector('.measure-shell .selectors [data-f="workTime"]');
   const vis=x=>!!(x&&x.offsetParent!==null&&x.getBoundingClientRect().height>0);
   const btn=document.getElementById('workFillFromAuto');
   /* 「作業時間」という題が縦に2つ並んでいないこと（§9.129）。 */
   const titles=[...document.querySelectorAll('.measure-shell .center-pane')]
     .flatMap(c=>[...c.querySelectorAll('.panel-title,.work-time-title b')])
     .filter(vis).map(x=>x.textContent.trim());
   return {出ている:vis(w),
     自動欄:['waFirstInput','waFirstTransfer','waLastInput'].filter(id=>vis(document.getElementById(id))),
     ボタン:!!btn,押せる:btn?!btn.disabled:null,
     理由:(document.getElementById('workAutoHint')||{}).textContent||'',
     題:titles};
  });
  rec('③に作業時間がある',wt3.出ている,JSON.stringify(wt3.題));
  rec('自動で記録した時刻を3つ出す',wt3.自動欄.length===3,JSON.stringify(wt3.自動欄));
  /* **できないことは、できないと書く**。まだ値が1つも入っていないので
     押せず、その理由が文で出ていること（灰色なだけでは伝わらない）。 */
  rec('参考値が無いときは押せず、理由が書いてある',
      wt3.ボタン&&wt3.押せる===false&&/まだ/.test(wt3.理由),JSON.stringify(wt3));
  rec('「作業時間」の題が2つ並んでいない',
      wt3.題.filter(t=>t==='作業時間').length===1,JSON.stringify(wt3.題));
  /* 自動の記録が**実際に効く**こと。手入力で1つ値を入れると、
     「入力を始めた」と「最後に入力した」が埋まり、押せるようになる。 */
  const wtAfter=await page.evaluate(async()=>{
   WL.workStamp.note('manual');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const btn=document.getElementById('workFillFromAuto');
   const t=id=>(document.getElementById(id)||{}).textContent||'';
   btn.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return {開始:t('waFirstInput'),転送:t('waFirstTransfer'),最終:t('waLastInput'),
     押せた:!btn.disabled,
     入った:!!(document.getElementById('workStartAt').value&&document.getElementById('workEndAt').value)};
  });
  rec('入力すると「入力を始めた」「最後に入力した」が埋まる',
      /\d/.test(wtAfter.開始)&&/\d/.test(wtAfter.最終),JSON.stringify(wtAfter));
  /* **手入力は「転送」に数えない**——混ぜると「転送を受け始めた時刻」が
     作れない（測定器を使い始めた時刻が知りたいのであって、何か入れた
     時刻ではない）。 */
  rec('手入力は「転送を受け始めた」に数えない',!/\d/.test(wtAfter.転送),JSON.stringify(wtAfter));
  rec('参考値を押すと開始・終了へ入る',wtAfter.押せた&&wtAfter.入った,JSON.stringify(wtAfter));

  /* ---- 6b) 完了前の確認表（§9.125） ----
     以前は未測定も公差外も**完了を押した後**の確認ダイアログでしか
     分からなかった。押す前に見えれば直しに戻れる。 */
  const check=()=>page.evaluate(()=>({
   行:[...document.querySelectorAll('.fc-row')].map(x=>({
     名:x.querySelector('.fc-name')?.textContent.trim()||'',
     値:x.querySelector('.fc-value')?.textContent.trim()||'',
     詳:x.querySelector('.fc-detail')?.textContent.trim()||'',
     直:x.querySelector('.fc-fix')?.textContent.trim()||'',
     状態:[...x.classList].find(c=>c.startsWith('fc-row--'))||''})),
   判定:document.querySelector('.fc-verdict')?.textContent.trim()||'',
   完了ボタン:document.querySelectorAll('.finish-check #complete, .finish-check button.rail-success').length,
  }));
  const c1=await check();
  rec('③に完了前の確認表が出る',c1.行.length>=3,JSON.stringify(c1.行.map(x=>x.名)));
  /* 行の名前は**公差と基準の両方**を持つ（§9.242 ⑤、利用者の指示）。
     この行は板厚・板幅（上下限＝公差）とラテラルボー等（片側＝基準）を
     同じ表に並べるので、片方の言葉だけだと もう片方は数えていないと読める。 */
  rec('確認表は測定・公差外/基準外・作業時間を並べる',
      ['測定','公差外・基準外','作業時間'].every(n=>c1.行.some(x=>x.名===n)),
      JSON.stringify(c1.行.map(x=>x.名)));
  /* **状態を色だけで伝えない。** すべての行が数か言葉を持つこと。 */
  rec('どの行も状態を文字で持つ',c1.行.every(x=>x.値!==''),JSON.stringify(c1.行.map(x=>x.値)));
  rec('残り件数を見出しに出す',/あと|完了できます/.test(c1.判定),c1.判定);
  /* 完了ボタンは操作レールに常時出ている。**同じボタンを2箇所に置かない。** */
  rec('確認表に完了ボタンを重ねて置かない',c1.完了ボタン===0,String(c1.完了ボタン));

  /* 公差外は**画面に描かれていない丈位置まで**数える。ここが画面依存だと、
     別の丈にある公差外は完了まで誰も気づけない（この集計の存在理由）。
     検証用フィクスチャには公差が入っていないので、**材料ごと注ぎ込む**
     ——入れずに「0件」を見ても、壊れていても同じ結果になる。 */
  const inject=await page.evaluate(()=>{
   const m=S.measure;
   m.basic.mfgWidth=100;m.basic.mfgThickness=2;
   m.source=m.source||{};
   m.source['板幅公差_製造_プラス']=0.5;m.source['板幅公差_製造_マイナス']=0.5;
   m.settings.verticalCount=1;m.settings.horizontalCount=3;
   /* **前の検証の値を持ち越さない**（この節の件数は自分で作った値だけで
      決まるようにする）。 */
   m.measurements.width.forEach(r=>r.fill(''));
   const r=WL.measureInput.toleranceDetail('width',0,'板幅')?.range;
   if(!r)return{skip:true,base:m.basic.mfgWidth,
     公差の元:WL.measureInput.toleranceDataForSource('width','manufacturing'),
     出どころ:WL.measureInput.configuredToleranceSource()};
   m.measurements.width[0][0]=String((r[0]+r[1])/2);  // 合格（1丈目＝描かれている）
   m.measurements.width[1][0]=String(r[1]+50);        // 上限超え（2丈目＝描かれていない）
   m.measurements.width[1][1]=String(r[0]-50);        // 下限割れ
   return{skip:false,range:r,集計:WL.measureReview.outOfTolerance()};
  });
  rec('公差の材料を注ぎ込めた',inject.skip===false,JSON.stringify(inject).slice(0,300));
  rec('描かれていない丈位置の公差外も数える',
      !inject.skip&&inject.集計.total===2
      &&inject.集計.items.length===1
      &&inject.集計.items[0].name==='板幅'
      &&inject.集計.items[0].hits.every(h=>h.length===1),
      JSON.stringify(inject.集計||{}));
  /* **項目ごとに公差を引き直す。** ラッパー(`measure-worklog.js`/
     `measure-tolerance.js`)が`#measureType`を見るため、項目名を
     渡さないと「いま選ばれている項目の公差」が全項目に当たる。実際に
     公差の無いラテラルボーが板幅の公差で判定され、偽の1件が出た。 */
  rec('公差の無い項目を他項目の公差で判定しない',
      !inject.skip&&!inject.集計.items.some(x=>x.name==='ラテラルボー'),
      JSON.stringify((inject.集計||{}).items||[]));
  rec('合格の値は数えない',!inject.skip&&inject.集計.items.every(x=>x.hits.every(h=>h.index<2)),
      JSON.stringify(inject.集計||{}));
  await go('1');await go('3');
  const c2=await check();
  const ngRow=c2.行.find(x=>x.名==='公差外・基準外');
  rec('確認表が公差外を件数で言う',!!ngRow&&/2件/.test(ngRow.値),JSON.stringify(ngRow||{}));
  rec('公差外はどの丈位置かまで言う',!!ngRow&&/1\(尾\)/.test(ngRow.詳),ngRow?.詳||'');
  rec('公差外の行には直しに行く手立てがある',!!ngRow&&ngRow.直!=='',JSON.stringify(ngRow||{}));
  /* **項目ごとに言葉を使い分ける**——板厚・板幅は「公差外」。 */
  rec('公差外の詳細は項目ごとの言葉で言う',!!ngRow&&/板幅 公差外/.test(ngRow.詳),ngRow?.詳||'');

  /* 「見に行く」は**直せる場所まで連れて行く**。番号を言うだけでは探させる。 */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.fc-row')].find(x=>x.querySelector('.fc-name')?.textContent.trim()==='公差外・基準外');
   r.querySelector('.fc-fix').click();
  });
  await idle();
  const jumped=await page.evaluate(()=>({
   段:document.querySelector('.mstep.is-current .mstep-name')?.textContent.trim()||'',
   項目:document.querySelector('#measureType').value,
   丈:document.querySelector('#lengthPos').value,
   NGセル:document.querySelectorAll('#measurementGrid input.ng').length,
  }));
  rec('「見に行く」で②の該当項目・該当丈へ行く',
      jumped.段==='測定'&&jumped.項目==='板幅'&&jumped.丈==='1(尾)',
      JSON.stringify(jumped));
  rec('飛んだ先で公差外のセルに印が付いている',jumped.NGセル>0,JSON.stringify(jumped));

  /* 公差が引けない値を「合格」に混ぜない。**判定していないなら、そう書く。** */
  const unj=await page.evaluate(()=>{
   const m=S.measure;
   delete m.source['板幅公差_製造_プラス'];delete m.source['板幅公差_製造_マイナス'];
   return WL.measureReview.outOfTolerance();
  });
  rec('公差が引けない項目は「判定していない」に回す',
      unj.total===0&&unj.unjudged.includes('板幅'),JSON.stringify(unj));
  await go('3');
  const c3=await check();
  rec('判定していない項目を画面にも出す',
      /判定していない項目/.test((c3.行.find(x=>x.名==='公差外・基準外')||{}).詳||''),
      (c3.行.find(x=>x.名==='公差外・基準外')||{}).詳||'');

  /* 作業時間を記録したら、その行だけが済みになる。 */
  await page.evaluate(()=>{
   S.measure.workTime={startAt:'2026-08-14T09:00:00',endAt:'2026-08-14T10:00:00'};
   WL.measureSteps.refresh();
  });
  await paint();
  const wt=(await check()).行.find(x=>x.名==='作業時間');
  rec('作業時間を記録すると済みになる',!!wt&&wt.状態==='fc-row--done'&&/記録済み/.test(wt.値),
      JSON.stringify(wt||{}));

  /* ---- 7) 危ない操作を主要動線から外す ----
     「このデータを削除」は「測定を完了」の真下にあり、押し間違いの的だった。 */
  rec('削除は①②では出さない',(await (async()=>{await go('1');return (await seen()).削除.見})())===false);
  await go('2');
  rec('②でも削除は出さない',(await seen()).削除.見===false);
  await go('3');
  rec('削除は③でだけ出す',(await seen()).削除.見===true);

  /* ---- 8) 順番は強制しない ---- */
  await go('3');await go('1');await go('3');
  const jump=await seen();
  rec('①を終えなくても③へ行ける（順番は強制しない）',jump.段[2].いま===true,
      JSON.stringify(jump.段.map(x=>x.いま)));

  /* ---- 9) **受信欄を作り直さない**（§9.122。ここが崩れると実機で転送が止まる） ---- */
  const keep=await page.evaluate(async()=>{
   const before=document.querySelector('#deviceInput');
   WL.measureSteps.go('1');WL.measureSteps.go('3');WL.measureSteps.go('2');
   await new Promise(r=>setTimeout(r,300));
   const after=document.querySelector('#deviceInput');
   return {同じノード:before===after,
     親も同じ:!!before&&!!after&&before.parentNode===after.parentNode,
     focus:document.activeElement?.id||''};
  });
  rec('段を往復しても受信欄が同じノードのまま',keep.同じノード===true,JSON.stringify(keep));
  rec('段を往復しても受信欄の親が変わらない',keep.親も同じ===true,JSON.stringify(keep));
  rec('②へ戻ると受信欄にフォーカスが戻る（転送を受けられる）',
      keep.focus==='deviceInput',JSON.stringify(keep));

  /* ---- 10) 見栄え: 重複・整列・枠の深さ（§9.129） ----
     「同じ情報を重ねない」「情報欄は縦にそろえる」「枠を何重にもしない」を
     **実測で**固定する。言葉で決めても、次に足す人には伝わらない。 */
  await go('1');
  const look=()=>page.evaluate(()=>{
   const shell=document.querySelector('.measure-shell');
   const vis=el=>{const r=el.getBoundingClientRect();
     return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'};
   /* 「N/M 項目」の形をした表示が画面にいくつあるか。役割が違っても、
      同じ数字が3つ並べば読む側は数えることになる。 */
   const frac=[...shell.querySelectorAll('*')].filter(el=>{
    if(!vis(el))return false;
    /* **日付（08/14）を拾わないこと。** 「N/M」そのもの、または
       「N/M 項目」だけを数える（最初に書いた緩い正規表現は予定日を
       拾って誤検知した）。 */
    const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
    return /^\d+\s*\/\s*\d+(\s*項目)?$/.test(own);
   }).map(el=>el.className||el.tagName);
   /* **枠の深さ。** 四辺すべてに線がある器を「枠」と数え、入れ子の深さを
      見る。入力欄・ボタンは中身の的なので数えない（枠を持って当然）。 */
   /* 「まとまりの枠」＝四辺に線がある**器**。キーの案内(kbd)・凡例の小さな
      四角・数直線の目盛りラベルのように、**中身を囲っていない小さな印**は
      数えない（最初に書いた判定はそれらを拾い、②だけ21個と出て意味の
      ある数にならなかった）。入力欄・ボタンは的なので対象外。 */
   const isFrame=el=>{
    if(/^(INPUT|SELECT|TEXTAREA|BUTTON|KBD)$/.test(el.tagName))return false;
    if(!el.children.length)return false;
    const r=el.getBoundingClientRect();
    if(r.width<120||r.height<32)return false;
    const c=getComputedStyle(el);
    return ['Top','Right','Bottom','Left']
      .every(k=>parseFloat(c['border'+k+'Width'])>=1&&c['border'+k+'Style']!=='none');
   };
   /* **深さだけでは足りない**（実測: 公差カードに枠を戻しても深さは2の
      ままで、注入が素通りした）。「同時に見えている枠の数」を数える
      ——横に並ぶ枠が増えるほど画面は騒がしくなる。表のセルは器ごとに
      1つと数える（罫線は表の中の仕切りで、まとまりの枠ではない）。 */
   let deepest=0,deepestPath='';const frames=[];
   [...shell.querySelectorAll('*')].forEach(el=>{
    if(!vis(el)||!isFrame(el))return;
    if(el.closest('table')&&/^(TD|TH|TR|THEAD|TBODY)$/.test(el.tagName))return;
    frames.push(el.className||el.tagName);
    let d=0,path=[],e=el;
    while(e&&e!==shell){if(isFrame(e)){d++;path.unshift(e.className||e.tagName)}e=e.parentElement}
    if(d>deepest){deepest=d;deepestPath=path.join(' > ')}
   });
   /* **情報欄の値の左端。** 左列・右列それぞれで1種類であること
      （ラベル列が可変だと項目ごとにずれる）。 */
   const outs=[...document.querySelectorAll('.basic-card .info-grid > .field:not(.full) output')]
     .filter(vis).map(el=>({左:Math.round(el.getBoundingClientRect().left),
       名:el.parentElement.querySelector('label')?.textContent.trim()||''}));
   return{分数:frac,枠の深さ:deepest,深いところ:deepestPath,枠の数:frames.length,枠:frames,
     値の左端:[...new Set(outs.map(x=>x.左))].sort((a,b)=>a-b),
     内訳:outs.map(x=>x.名+'='+x.左)};
  });
  const L=await look();
  await go('2');const L2=await look();
  await go('3');const L3=await look();
  await go('1');
  /* ヘッダーはバー（割合）だけにした。数字は段ナビ＝1箇所。 */
  rec('同じ「N/M」を画面に重ねない',L.分数.length<=1,JSON.stringify(L.分数));
  /* 枠は「まとまり1段＋中身」まで。3段は「枠の中の枠の中の枠」。 */
  rec('枠の入れ子は2段まで',L.枠の深さ<=2,`${L.枠の深さ}段: ${L.深いところ}`);
  /* **枠の数は上限で固定する**（§9.129）。深さだけでは足りない——公差
     カードに枠を戻しても深さは2のままで、注入が素通りした。**横に並ぶ
     枠が増えるほど画面は騒がしくなる**ので、いまの数を天井にする。
     増やしたくなったら、まず何を減らせるかを考えること。 */
  /* **上限は§9.131で引き上げた**（①4→6 / ②4→7 / ③6→10）。タブに畳んで
     いた5枚を同時に出すようにしたので、まとまりの枠はその数だけ増える
     ——これは「装飾が増えた」のではなく「情報が増えた」ぶん。
     **入れ子は増やさない**（上の「枠の入れ子は2段まで」が本体の規則で、
     品質等級の12項目は枠を外して地色だけにした）。 */
  const CAP={'①':6,'②':7,'③':10};
  [['①',L],['②',L2],['③',L3]].forEach(([k,x])=>{
   rec(`${k}のまとまりの枠は${CAP[k]}つまで`,x.枠の数<=CAP[k],`${x.枠の数}つ: ${x.枠.join(' / ')}`);
  });
  /* 2列組なので左端は2種類（左列・右列）。3種類以上＝そろっていない。 */
  rec('情報欄の値の左端がそろっている',L.値の左端.length<=2,JSON.stringify(L.内訳));

  /* ---- 11) 入れ物は中身の長さから決める（§9.130） ----
     実測で、「-」しか入っていないプルダウンが239px、1桁しか入らない欄が
     239px、日時の欄が494px、「異常情報なし」の6文字に1401×280pxだった。
     **中身の実寸と画面の実寸を突き合わせる**——DOMの数や有無を見る網では、
     器がグリッドの1マスぶんに伸びていても素通りする。
     天井は80px（＝1マスぶん伸びれば必ず超える。矢印・余白の見積もりの
     ずれでは超えない）。 */
  const SLACK=80;
  /* **群でそろえたものは、群の必要幅と比べる**（§9.131）。同じまとまりの
     中を最大へそろえる以上、群の中の短い項目が「中身より広い」のは
     正しい姿——ここを個別に見ると、そろえるほど落ちる網になる。
     群の外のものは今までどおり自分の中身と比べる。 */
  const W_GROUPS={who:['inspector','crewSize'],shape:['verticalCount','horizontalCount'],
    gear:['innerDiameter','spool','thicknessGauge','widthGauge'],
    usual:['unwind','widthOrder','widthDirection','burr','coilStop'],
    time:['workStartAt','workEndAt']};
  const wideBoxes=slack=>page.evaluate(([sl,G])=>{
   const ctx=document.createElement('canvas').getContext('2d');
   const out=[];
   const groupOf={};
   Object.keys(G).forEach(k=>G[k].forEach(id=>{groupOf[id]=k}));
   const groupNeed={};
   document.querySelectorAll('.measure-shell input,.measure-shell select,.measure-shell textarea')
    .forEach(el=>{
     const r=el.getBoundingClientRect();
     if(r.width<1||r.height<1)return;
     /* **マスタが幅を決めた欄は対象外**（§9.218 ②、利用者の指示「余白は
        無いようにUI幅で稼いでほしい」）。あちらは「器いっぱいに使う」のが
        正しい姿なので、中身と比べると器を使い切るほど落ちる網になる。
        器を使い切っていることは別に見る（下の「器いっぱい」）。 */
     if(el.closest('[data-opfill]'))return;
     const cs=getComputedStyle(el);
     if(cs.visibility==='hidden')return;
     ctx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
     const w=t=>ctx.measureText(t).width;
     let need=0;
     if(el.tagName==='SELECT'){
      /* 選択肢の最長＋矢印（size付きは縦スクロールバー）。 */
      for(const o of el.options)need=Math.max(need,w(o.text));
      need+=28;
     }else if(el.tagName==='TEXTAREA'){
      /* **読み取り専用の本文は器から幅をもらう**（§9.142/§9.143）ので、
         中身と比べない。真上に置いた表と右端をそろえることが要件で、
         そこだけ幅が違うほうが「そろっていない」（品質情報は実データでは
         何行にもなる。窓の大きさを決めるのは行数のほう）。 */
      if(el.readOnly)return;
      for(const ln of (el.value||'').split('\n'))need=Math.max(need,w(ln));
      need+=18;
     }else if(el.type==='datetime-local'){
      need=w('2026/08/14 15:04:05')+34;
     }else{
      /* **空の入力欄は「0文字」ではない。** これから入る値が収まる大きさが
         要る。桁数の分かるもの（max付きの数値）はその桁数、測定値の欄は
         `0000.00`、自由記述は24文字を下限にする（それ以上は折り返さない
         1行なので、長くしても読みやすくならない）。 */
      const free=el.type==='text'&&!el.classList.contains('numeric-input')
        &&!el.closest('.measure-matrix,.measure-grid-block');
      const sample=el.value||el.placeholder
        ||(el.type==='number'&&el.max?'0'.repeat(String(el.max).length)
          :free?'あ'.repeat(24):'0000.00');
      need=w(sample)+(el.type==='number'?30:20);
     }
     need+=parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
     const g=groupOf[el.id];
     if(g)groupNeed[g]=Math.max(groupNeed[g]||0,need);
     out.push({id:el.id||el.className||el.type,g,w:r.width,need,
       tag:el.tagName,type:el.type});
    });
   return out.filter(x=>Math.round(x.w-(x.g?groupNeed[x.g]:x.need))>sl)
     .map(x=>`${x.id}(${x.tag}/${x.type}):幅${Math.round(x.w)}/要${Math.round(x.g?groupNeed[x.g]:x.need)}`);
  },[slack,W_GROUPS]);
  const setType=async t=>{
   await page.evaluate(v=>{const s=document.querySelector('#measureType');
     s.value=v;s.dispatchEvent(new Event('change',{bubbles:true}))},t);
   await idle();
  };
  for(const st of ['1','2','3']){
   await go(st);
   const over=await wideBoxes(SLACK);
   rec(`${st==='1'?'①':st==='2'?'②':'③'}に中身より${SLACK}px以上広い欄が無い`,
       over.length===0,over.join(' / '));
  }
  /* ---- 11b) マスタが幅を決めた欄は器いっぱいに使う（§9.218 ②） ----
     利用者の指摘「項目間の余白が広く、かなり表示欄がもったいない」
     「2列分にしたときに1列と比べると余白が出てスカスカな印象。余白は
      無いようにUI幅で稼いでほしい」。実測で4マス（413px）の器に154pxの
     選択欄が入り、**259pxが空いていた**。
     **数や有無ではなく実寸で見ること**——`data-opfill`が付いているだけの
     網は、`fitControlWidths()`のインライン`max-width`が残っていても通る
     （実際に通った）。 */
  await go('1');
  const slim=await page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('.selectors>[data-opfill]').forEach(host=>{
    const ctl=host.querySelector('select,input[type=text],input[type=number],.opf-widget');
    if(!ctl)return;
    const hr=host.getBoundingClientRect(),cr=ctl.getBoundingClientRect();
    if(hr.width<1||cr.width<1)return;
    const gap=Math.round(hr.right-cr.right);
    if(gap>4)out.push(`${host.dataset.f||host.dataset.opfield}:器${Math.round(hr.width)}/欄${Math.round(cr.width)}/余り${gap}`);
   });
   return out;
  });
  rec('①のマスタが幅を決めた欄は器いっぱいに使う',slim.length===0,slim.slice(0,6).join(' / '));
  /* **②は入力内容で中身がまるごと変わる**ので、代表的な3つで見る。
     1つだけ見ると、そのとき選ばれていた項目しか網に掛からない
     （最初はそうなっており、板厚の3点入力と備考欄を取りこぼした）。 */
  await go('2');
  for(const t of ['板幅',MATERIAL,PIECE]){
   await setType(t);
   const over=await wideBoxes(SLACK);
   rec(`②「${t}」に中身より${SLACK}px以上広い欄が無い`,over.length===0,over.join(' / '));
  }
  /* 高さも同じ。読み取り専用の表示欄をpxで固定すると、6文字に280pxを
     与えたままになる。**行数（rows）で決まっていること**を見る。 */
  /* 品質情報は**基本情報カードの1箇所だけ**（§9.148、利用者の指摘）。
     母材の面にも同じ本文を持つ欄があり、②では基本情報カードのものと
     並んで2つ見えていた（§9.129「同じ情報を2箇所に出さない」）。 */
  await go('2');
  const qdup=await page.evaluate(()=>{
   const vis=e=>{const b=e.getBoundingClientRect();
     return b.width>2&&b.height>2&&getComputedStyle(e).display!=='none'};
   const all=[...document.querySelectorAll('.measure-shell textarea,.measure-shell output')]
     .filter(e=>vis(e)&&/異常情報|品質/.test(e.value||e.textContent||''));
   return{本文の数:all.length,母材側:!!document.getElementById('motherQualityInfo'),
     id:all.map(e=>e.id)};
  });
  rec('②で品質情報の本文が2つ出ていない',
      qdup.本文の数<=1&&qdup.母材側===false,JSON.stringify(qdup));
  const qbox=await page.evaluate(()=>{
   const el=document.getElementById('qualityInfo');
   if(!el)return{無し:true};
   const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
   return{幅:Math.round(r.width),高:Math.round(r.height),
     行高:Math.round(parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.4),
     見:r.width>0&&r.height>0};
  });
  rec('品質情報の幅が器に収まる',qbox.無し||qbox.幅<=760,JSON.stringify(qbox));
  await go('1');

  /* ---- 12) 規格・整列・情報密度（§9.131 ゼロベースの組み直し） ----
     利用者からの指摘——「中身の長さでUIの大きさを決めるのはそうだが、
     **いろんなサイズが生まれるときれいに並ばない。UIサイズも規格化し、
     整列させることがセット**」「位置がバラバラ」「余白もバラバラ」
     「**余白があるなら、タブで回避していた情報の配置を考え、情報量を
     上げる**」。実測（1920×1080）で前後を比べられる数で固定する。 */
  /* 幅の種類。**表の中は数えない**——測定表・丈位置くらべ・全丈表の欄は
     列で決まる構造的な幅で、規格とは別の決まり方をする。 */
  const widthKinds=()=>page.evaluate(()=>{
   const skip='.measure-matrix,.measure-grid-block,.product-rows-table';
   const ws=[];
   document.querySelectorAll('.measure-body input,.measure-body select,.measure-body textarea')
    .forEach(el=>{
     const r=el.getBoundingClientRect();
     if(r.width<8||r.height<1)return;
     if(getComputedStyle(el).visibility==='hidden')return;
     if(el.closest(skip))return;
     ws.push(Math.round(r.width));
    });
   const kinds=[];
   for(const w of [...new Set(ws)].sort((a,b)=>a-b))
    if(!kinds.length||w-kinds[kinds.length-1]>2)kinds.push(w);
   return kinds;
  });
  /* 空き＝ペインの中身の下に残った面積。**本体の面積に対する割合**で見る
     （ペイン単位だと、狭い列の空きも広い列の空きも同じ重さになる）。 */
  const emptyRate=()=>page.evaluate(()=>{
   const vis=el=>{const r=el.getBoundingClientRect();
     return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'};
   const body=document.querySelector('.measure-body').getBoundingClientRect();
   let unused=0;const detail=[];
   document.querySelectorAll('.left-pane,.center-pane,.right-pane,.finish-check')
    .forEach(p=>{
     if(!vis(p))return;
     const pr=p.getBoundingClientRect();let maxB=pr.top;
     p.querySelectorAll('*').forEach(el=>{
      if(!vis(el))return;
      const r=el.getBoundingClientRect();
      if(r.width<1||r.height<1)return;
      maxB=Math.max(maxB,Math.min(r.bottom,pr.bottom));
     });
     const rest=Math.round(pr.bottom-maxB);
     unused+=Math.round(pr.width)*Math.max(0,rest);
     detail.push(`${[...p.classList][0]}:余${rest}`);
    });
   return {率:Math.round(100*unused/(body.width*body.height)),内訳:detail.join(' ')};
  });

  await go('1');
  const w1=await widthKinds(),e1=await emptyRate();
  /* **同じ画面に何種類の幅があるか。** 直す前は①だけで19種類あった
     （中身に忠実な幅をそのまま使うと必ずこうなる）。規格へ丸めたので、
     実測では2種類（11em の選択欄と 4.5em の桁数欄）に収まる。 */
  rec('①の入力欄の幅が4種類以内',w1.length<=4,JSON.stringify(w1));
  /* **群の中でそろっているか**（縦に並ぶものの幅が同じであることが、
     整列して見える条件そのもの）。 */
  const groups=await page.evaluate(()=>{
   const G={'誰が測るか':['inspector','crewSize'],'測定表の形':['verticalCount','horizontalCount'],
     '使う機材':['innerDiameter','spool','thicknessGauge','widthGauge']};
   const out={};
   for(const k of Object.keys(G))
    out[k]=[...new Set(G[k].map(id=>document.getElementById(id))
      .filter(el=>el&&el.getBoundingClientRect().width>0)
      .map(el=>Math.round(el.getBoundingClientRect().width)))];
   return out;
  });
  for(const k of Object.keys(groups))
   rec(`①「${k}」の欄の幅がそろう`,groups[k].length===1,JSON.stringify(groups[k]));
  /* **タブで隠していたものを同時に出す**（余白があるのに畳んでいた）。 */
  /* **数える場所は本文グリッド全体**（§9.137）。情報の壁は`.left-pane`という
     1つの器に入れていたが、骨子は「カード1枚＝マス群」なので、基本情報・
     品質規格・測定データ分析はそれぞれ本文グリッドの直下にある。器の中を
     数えると、外へ出した瞬間に**0枚**と出て意図と食い違う。 */
  const wall=st=>page.evaluate(()=>({
   タブ:[...document.querySelectorAll('.measure-body .tabs,.measure-body .subtabs')]
     .filter(x=>x.getBoundingClientRect().height>0).length,
   面:[...document.querySelectorAll('.measure-body [data-infopanel],.measure-body [data-leftpanel]')]
     .filter(x=>x.getBoundingClientRect().height>0)
     .map(x=>x.dataset.infopanel||x.dataset.leftpanel),
  }));
  const wall1=await wall();
  /* **測定中に見るものは常時、見ないものはタブの裏**(§9.133)。
     §9.131では「タブを1枚も出さない」を固定していたが、品質規格と
     測定データ分析は**測定中に見る値ではない**(利用者の指摘⑥)。
     常時出すのは基本情報と幅分割で、残る2枚はタブ1枚に畳む。
     **2枚を同時に開かないこと**も見る——`openInfoWall`が全部開けてしまい、
     ③で品質規格と分析が同じ場所に重なっていた(実測 y=398)。 */
  const split1=await page.evaluate(()=>{const e=document.querySelector('#splitCard');
    return !!e&&e.getBoundingClientRect().height>0});
  rec('①の常時表示は基本情報と幅分割',
      wall1.面.includes('basic')&&split1,JSON.stringify(wall1)+' split='+split1);
  /* **①にタブは1枚も置かない**（§9.143、利用者の指示）。測定データ分析は
     「準備」の面に置く意味が無い——まだ1件も測っておらず、中身が空の面へ
     切り替えるだけのボタンになる。**タブごと消す**（押せるのに何も無い
     ボタンを残さない）。分析は③の記録の壁に別カードとして出る。 */
  rec('①にタブを置かない',wall1.タブ===0,JSON.stringify(wall1));
  /* **品質規格は基本情報カードのタブ裏**（§9.145、利用者の指示「品質規格は
     タブに回し」）。測る前に1回だけ確かめるもので、マスを1つ使うほどでは
     ない——ただし**1回の操作で必ず出せる場所**に置く。 */
  const grade1=await page.evaluate(async()=>{
   /* 品質規格は**基本情報の詳細の中の1つの群**（§9.154、利用者の指示）。
      「基本情報」カードの中に「基本情報」タブがあるのは冗長だったのでタブは
      廃止し、詳細の他の項目と同じ「ラベル＋値」の行にした。**ラベルが
      切れないこと**が要件（4×3の表は見出し列を`width:11%`で決め打ちして
      いたため「ラテラルボー」「アルマイト」「表面処理」が切れていた）。 */
   const more=document.getElementById('basicMore');
   if(!more)return{ボタン:false};
   if(document.getElementById('basicDetail')?.hidden)more.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const labs=[...document.querySelectorAll('#qualityGradeFields label')];
   const cut=labs.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
   const タブ=document.querySelectorAll('[data-basictab]').length;
   more.click();
   return{ボタン:true,行:labs.length,切れ:cut,タブ};
  });
  rec('①の品質規格は基本情報の詳細から1回の操作で出せる',
   grade1.ボタン&&grade1.行===12,JSON.stringify(grade1));
  rec('①の品質規格のラベルが切れない',
   grade1.ボタン&&Array.isArray(grade1.切れ)&&grade1.切れ.length===0,JSON.stringify(grade1.切れ));
  rec('①の基本情報カードにタブを残さない（題と同じ札は冗長）',
   grade1.タブ===0,String(grade1.タブ));
  rec('①に測定データ分析を出さない',!wall1.面.includes('analysis'),JSON.stringify(wall1));
  rec('タブの裏は同時に2枚出さない',
      !(wall1.面.includes('grade')&&wall1.面.includes('analysis')),JSON.stringify(wall1));
  /* **空き率は粗い目安**（中身の少ないロットでは正しく空く）。効くのは
     こちら——**中身のない器を置かない**。`.split-pane`は分割の無いロットでも
     290pxの下限を持っており、1行の文字に290pxの空箱が残っていた。 */
  const emptyBox=()=>page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('.measure-body [data-infopanel],.measure-body [data-leftpanel]')
    .forEach(p=>{
     const pr=p.getBoundingClientRect();
     if(pr.height<1)return;
     let maxB=pr.top;
     p.querySelectorAll('*').forEach(el=>{
      const r=el.getBoundingClientRect();
      if(r.width<1||r.height<1)return;
      maxB=Math.max(maxB,r.bottom);
     });
     const rest=Math.round(pr.bottom-maxB-parseFloat(getComputedStyle(p).paddingBottom||0));
     if(rest>120)out.push(`${p.dataset.infopanel||p.dataset.leftpanel}:余${rest}`);
    });
   return out;
  });
  const box1=await emptyBox();
  rec('①に中身のない器（120px超の空き）が無い',box1.length===0,box1.join(' / '));
  /* **空き率は記録するだけ**(§9.135)。粗いグリッド(横4×縦3)では、中身の
     少ないロットでマスが余る。合意した対処は「タブの裏を出す→カードを
     1段小さくする→**余らせたままにする**」で、埋めるために意味の薄い
     ものを置くのは禁止。だから閾値では縛らない——数字は出す(見比べる
     ために要る)が、これで落とさない。**そろって見えるか**は下の
     「左端が4通り以内・上端が3通り以内」で見る。 */
  rec('①の空きを記録した',true,JSON.stringify(e1));

  /* ②は「項目｜入力｜根拠」の3列。根拠（基本情報・幅分割情報）は測っている
     最中に見る値なので、空いた3列目へ出す。**測定表の列はいちばん広いまま**
     （面積は頻度×重要度。§9.123の判断は変えない）。 */
  await go('2');
  await setType('板幅');
  const ref2=await page.evaluate(()=>{
   const rc=s=>{const el=document.querySelector(s);if(!el)return 0;
     const r=el.getBoundingClientRect();
     return getComputedStyle(el).display==='none'?0:Math.round(r.width)};
   return {左:rc('.left-pane'),中:rc('.center-pane'),右:rc('.right-pane'),
     面:[...document.querySelectorAll('.left-pane [data-infopanel]')]
       .filter(x=>x.getBoundingClientRect().height>0).map(x=>x.dataset.infopanel)};
  });
  rec('②に根拠（基本情報・幅分割情報）が出る',
      ref2.面.includes('basic')&&split2,JSON.stringify(ref2)+' split='+split2);
  rec('②の測定の列がいちばん広い',ref2.右>ref2.左&&ref2.右>ref2.中,JSON.stringify(ref2));
  const e2=await emptyRate();
  rec('②（板幅）の空きを記録した',true,JSON.stringify(e2));

  /* **母材と丈毎は別々の面**（§9.391、利用者の指示「ボタンを分けて1枚の
     カードに配置するように変更してください」）。器（`.work-panel`）は1つの
     ままで、**出るカードが入れ替わる**。丈は全丈を1つの表で出す（丈番号
     タブは§9.131で廃止）。 */
  await setType(MATERIAL);
  const onlyMother=await page.evaluate(()=>{
   const vis=e=>!!e&&e.getBoundingClientRect().height>0;
   return {母材:vis(document.querySelector('.material-grid')),
     表:vis(document.querySelector('.product-rows-table')),
     面の数:[...document.querySelectorAll('.work-panel')].filter(vis).length};
  });
  rec('②で「母材」を選ぶと、出るのは母材のカード1枚だけ',
      onlyMother.母材&&!onlyMother.表&&onlyMother.面の数===1,JSON.stringify(onlyMother));
  await setType(PIECE);
  const prod=await page.evaluate(()=>{
   const t=document.querySelector('.product-rows-table');
   const tabs=document.getElementById('productLengthTabs');
   const n=Math.max(1,Math.min(9,+document.getElementById('verticalCount').value||1));
   const vis=e=>!!e&&e.getBoundingClientRect().height>0;
   return {表:vis(t),
     /* 内訳の段(.prt-detail)は丈の行ではない(§9.203)。 */
     行:document.querySelectorAll('#productRowsBody tr:not(.prt-detail)').length,丈:n,
     タブ:vis(tabs),
     母材:vis(document.querySelector('.material-grid')),
     面の数:[...document.querySelectorAll('.work-panel')].filter(vis).length,
     溢れ:t?Math.round(t.getBoundingClientRect().right
       -document.querySelector('.right-pane').getBoundingClientRect().right):0};
  });
  rec('②で「丈毎」を選ぶと、出るのは全丈の表1枚だけ',
      prod.表&&!prod.母材&&prod.行===prod.丈&&prod.面の数===1,JSON.stringify(prod));
  rec('②の揃いに丈番号タブを出さない',prod.タブ===false,JSON.stringify(prod));
  rec('②の全丈表が横に溢れない',prod.溢れ<=0,JSON.stringify(prod));
  /* **入力欄が見切れない**（§9.160、利用者の指摘）。見出しの文字数で列幅が
     決まっていたため、1文字しか入らない「1桁目 エッジ形状」が96pxで、6桁
     入る「長さ」が42px・自由記述の「備考」が65pxだった。代表的な値を入れて
     **実際に切れていないか**を見る（幅の数字だけでは足りない）。 */
  const clipped=await page.evaluate(()=>{
   const set=(k,v)=>{const el=document.querySelector(
     `#productRowsBody tr[data-row="0"] [data-product-field="${k}"]`);
     if(el){el.value=v;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))}};
   /* §9.203で揃いコード(4桁)は廃止し、名前で選ぶ形にした。**いちばん長い
      選択肢**を入れて確かめる（短い値だけを見ても切れは見つからない）。 */
   set('edgeShape','のこぎり状');
   set('productLength','2500.8');set('wallThickness','0.500');
   set('occurrencePosition','1/3〜2/3発生');set('regularity','不規則');
   set('direction','OS');set('pitch','125.5');set('alignmentValue','12.5');
   const out=[];
   document.querySelectorAll('#productRowsBody tr[data-row="0"] input').forEach(el=>{
    if(!el.value)return;
    if(el.scrollWidth>el.clientWidth+1)
     out.push(`${el.dataset.productField}:${Math.round(el.clientWidth)}<${el.scrollWidth}`);
   });
   /* 選択欄は**選んだ文字が器に収まっているか**を見る（`scrollWidth`は
      selectでは当てにならないので、文字幅を測って比べる）。 */
   const cv=document.createElement('canvas').getContext('2d');
   document.querySelectorAll('#productRowsBody tr[data-row="0"] select').forEach(el=>{
    const txt=el.options[el.selectedIndex]?el.options[el.selectedIndex].text:'';
    if(!txt)return;
    const cs=getComputedStyle(el);
    cv.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const need=cv.measureText(txt).width+26;   // 矢印と左右の余白ぶん
    if(need>el.clientWidth+1)
     out.push(`${el.dataset.productField}:${Math.round(el.clientWidth)}<${Math.round(need)}`);
   });
   return out;
  });
  rec('②の丈の入力欄が値を切り落とさない',clipped.length===0,clipped.join(' / '));

  /* ---- 丈毎の「外観」「巻ズレ OS/DS」（§9.393、利用者の指示） ----
     「丈毎の項目に、外観を追加し『○』『△』『×』を入れられるように」
     「丈毎の項目に、巻ズレの項目を追加し、OSDSを分けて入力できるように」
     **記号はフラットネスと同じ3つ**（〇/△/×）で、条ごとの入力内容
     「巻ずれ」とは別物（あちらは条ごと・測定器から受ける値）。 */
  const pk=await page.evaluate(async()=>{
   const head=[...document.querySelectorAll('.product-rows-table thead th')]
     .map(t=>t.textContent.trim());
   const sel=document.querySelector('#productRowsBody tr[data-row="0"] [data-product-field="appearance"]');
   const opts=sel?[...sel.options].map(o=>o.text.trim()):[];
   const put=(k,v)=>{const el=document.querySelector(
     `#productRowsBody tr[data-row="0"] [data-product-field="${k}"]`);
    if(!el)return false;
    el.value=v;el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));
    return true;};
   const ok=[put('appearance','△'),put('offsetOs','0.8'),put('offsetDs','1.2')];
   await new Promise(r=>setTimeout(r,150));
   const row=S.measure.product.rows[0]||{};
   /* **内訳の段には出さない**——外観は主役の列の欄で、異常の内訳ではない。 */
   const inDetail=!!document.querySelector('.prt-detail [data-product-field="appearance"]');
   return {見出し:head,選択肢:opts,打てた:ok,
     記録:[row.appearance,row.offsetOs,row.offsetDs],内訳に出た:inDetail};
  });
  rec('丈毎の表に「外観」「巻ズレ OS」「巻ズレ DS」の列がある（§9.393）',
      pk.見出し.join('/')==='丈/長さ/肉厚/判定/外観/巻ズレ OS/巻ズレ DS/エッジ形状/備考',
      JSON.stringify(pk.見出し));
  rec('外観は〇/△/×から選ぶ（記号はフラットネスと同じ）',
      pk.選択肢.filter(t=>t==='〇'||t==='△'||t==='×').length===3,
      JSON.stringify(pk.選択肢));
  rec('外観・巻ズレは打った時点でレコードへ入る（保存を待たない）',
      pk.打てた.every(Boolean)&&pk.記録.join('/')==='△/0.8/1.2',
      JSON.stringify(pk.記録));
  rec('外観は内訳の段には出さない（主役の列の欄なので）',
      pk.内訳に出た===false,String(pk.内訳に出た));
  /* 列を3つ足したので、**表が横に溢れていないか**を測り直す（§CLAUDE 11）。 */
  const wide2=await page.evaluate(()=>{
   const t=document.querySelector('.product-rows-table');
   return Math.round(t.getBoundingClientRect().right
     -document.querySelector('.right-pane').getBoundingClientRect().right);
  });
  rec('列を足しても全丈表が横に溢れない（§9.393）',wide2<=0,String(wide2));
  await page.evaluate(()=>{
   document.querySelectorAll('#productRowsBody tr[data-row="0"] input,#productRowsBody tr[data-row="0"] select')
    .forEach(el=>{if(el.value){el.value='';
      el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}))}});
  });

  /* ---- 備考は「畳んだ広い行」（§9.397、利用者の指示） ----
     「備考は通常使わないので、行数増やして対応しつつ折りたたんでおくように
      したいです」

     主役の9列目に置いていたときの取り分は**実測58px**で、2文字も読めなかった
     （エッジ形状12.6em・外観6.2em…を引いた残りが備考の幅だったため）。
     自由記述は器の幅がそのまま使い勝手なので、**列ではなく行**を与える。
     既定は畳む——畳んでいる丈では1pxも場所を取らない（§CLAUDE 1）。 */
  const note0=await page.evaluate(()=>{
   const body=document.getElementById('productRowsBody');
   const btn=body.querySelector('tr[data-row="0"] .prt-note-btn');
   return {段:body.querySelectorAll('tr.prt-detail').length,
     入口:!!btn,入口の字:btn?btn.textContent.trim():'',
     入口幅:btn?Math.round(btn.getBoundingClientRect().width):0,
     主役にtextarea:!!body.querySelector('tr:not(.prt-detail) textarea')};
  });
  rec('備考は既定で畳んである（段を出さない）',note0.段===0&&!note0.主役にtextarea,
      JSON.stringify(note0));
  rec('主役の行に残るのは開閉の入口だけ（書いていなければ「—」）',
      note0.入口&&/^—/.test(note0.入口の字),JSON.stringify(note0));
  await page.click('#productRowsBody tr[data-row="0"] .prt-note-btn');
  await paint();await paint();
  const note1=await page.evaluate(()=>{
   const ta=document.querySelector('#productRowsBody tr.prt-detail[data-row="0"] textarea[data-product-field="note"]');
   return {欄:!!ta,幅:ta?Math.round(ta.getBoundingClientRect().width):0,
     行数:ta?Number(ta.rows||0):0};
  });
  rec('押すと備考の欄が開き、主役の列より広い（実測58px→400px以上）',
      note1.欄&&note1.幅>=400&&note1.行数>=2,JSON.stringify({...note0,...note1}));
  await page.fill('#productRowsBody tr.prt-detail[data-row="0"] textarea[data-product-field="note"]',
                  '耳やけ気味。次工程へ申し送り。');
  await paint();
  const noteKept=await page.evaluate(()=>S.measure.product.rows[0].note);
  rec('打った備考は保存を待たずレコードへ入る',
      noteKept==='耳やけ気味。次工程へ申し送り。',String(noteKept));
  await page.click('#productRowsBody tr.prt-detail[data-row="0"] .prt-fold');
  await paint();await paint();
  const note2=await page.evaluate(()=>{
   const body=document.getElementById('productRowsBody');
   return {要約:(body.querySelector('tr.prt-detail[data-row="0"] .prt-sum')||{}).textContent||'',
     入口の字:(body.querySelector('tr[data-row="0"] .prt-note-btn .prt-note-txt')||{}).textContent||''};
  });
  /* **畳んでも値は読める**（§9.125）。主役の列は58pxしか無いので本文は
     写さず「あり/—」だけを言い（§CLAUDE 8）、本文は横いっぱいの要約が持つ。 */
  rec('畳んでも書いた備考が読める（要約が横いっぱいで持つ）',
      /耳やけ/.test(note2.要約),JSON.stringify(note2));
  rec('主役の列は「あるか無いか」だけを言う（同じ文を2箇所に出さない）',
      note2.入口の字.trim()==='あり',note2.入口の字);
  await page.evaluate(()=>{
   const ta=document.querySelector('#productRowsBody textarea[data-product-field="note"]');
   if(ta){ta.value='';ta.dispatchEvent(new Event('input',{bubbles:true}))}
   if(S.measure&&S.measure.product)S.measure.product.rows.forEach(r=>{if(r)r.note=''});
   WL.measureView.renderProductPanel&&WL.measureView.renderProductPanel();
  });

  /* ---- 揃いは「選んで記録」（§9.203、利用者の指示） ----
     4桁の揃いコードは**廃止**した。判定の起点はエッジ形状で、
     「揃い綺麗」ならそこで終わり（内訳は書かせない）。 */
  const align=await page.evaluate(()=>{
   const q=k=>document.querySelector(`#productRowsBody tr[data-row="0"] [data-product-field="${k}"]`);
   const opts=k=>[...(q(k)?q(k).options:[])].map(o=>o.value).filter(Boolean);
   return {code:!!q('alignmentCode'),
     edgeIsSelect:q('edgeShape')&&q('edgeShape').tagName==='SELECT',
     edge:opts('edgeShape'),
     /* **内訳はまだ出ていない**（エッジ形状を選ぶまで開かない）。 */
     detailYet:!!document.querySelector('#productRowsBody tr.prt-detail'),
     head:[...document.querySelectorAll('.product-rows-table thead th')].map(t=>t.textContent.trim())};
  });
  rec('揃いコードの入力欄は廃止',!align.code,String(align.code));
  rec('エッジ形状は選択欄',!!align.edgeIsSelect,String(align.edgeIsSelect));
  /* §9.204で「テレスコ状」→「テレスコープ状」へ名前をそろえた
     （基準の文言・測定項目名と1つにする）。 */
  rec('エッジ形状の選択肢（揃い綺麗・のこぎり状・テレスコープ状）',
      align.edge.join('/')==='揃い綺麗/のこぎり状/テレスコープ状',align.edge.join('/'));
  rec('エッジ形状を選ぶまで内訳は出さない',!align.detailYet,String(align.detailYet));
  rec('見出しに「揃いコード」を残さない',!align.head.some(t=>/揃いコード/.test(t)),align.head.join(','));

  const pick=async(k,v)=>{await page.evaluate(([kk,vv])=>{
    const el=document.querySelector(`#productRowsBody tr[data-row="0"] [data-product-field="${kk}"]`);
    el.value=vv;el.dispatchEvent(new Event('change',{bubbles:true}));},[k,v]);
   await idle()};

  /* 内訳の選択肢は**段が開いてから**確かめる。 */
  await pick('edgeShape','のこぎり状');
  const dopts=await page.evaluate(()=>{
   const q=k=>document.querySelector(`#productRowsBody tr[data-row="0"] [data-product-field="${k}"]`);
   const opts=k=>[...(q(k)?q(k).options:[])].map(o=>o.value).filter(Boolean);
   return {pos:opts('occurrencePosition'),reg:opts('regularity'),dir:opts('direction')};
  });
  rec('発生位置の選択肢は3つ',dopts.pos.length===3&&/2\/3以上発生/.test(dopts.pos[0]),dopts.pos.join('/'));
  rec('規則性は不規則・規則的',dopts.reg.join('/')==='不規則/規則的',dopts.reg.join('/'));
  rec('方向はOS・DS',dopts.dir.join('/')==='OS/DS',dopts.dir.join('/'));

  await pick('edgeShape','揃い綺麗');
  const okState=await page.evaluate(()=>{
   const tr=document.querySelector('#productRowsBody tr[data-row="0"]');
   return {judge:tr.querySelector('[data-product-judge]').textContent.trim(),
           allDisabled:!document.querySelector('#productRowsBody tr.prt-detail[data-row="0"]'),
           saved:S.measure.product.rows[0].edgeShape};
  });
  rec('「揃い綺麗」でOK判定',okState.judge==='OK',JSON.stringify(okState));
  rec('「揃い綺麗」なら内訳は書かせない',okState.allDisabled,JSON.stringify(okState));
  rec('選んだ値がレコードへ入る',okState.saved==='揃い綺麗',String(okState.saved));

  await pick('edgeShape','のこぎり状');
  const ngState=await page.evaluate(()=>{
   const tr=document.querySelector('#productRowsBody tr[data-row="0"]');
   const d=document.querySelector('#productRowsBody tr.prt-detail[data-row="0"]');
   return {judge:tr.querySelector('[data-product-judge]').textContent.trim(),
           noneDisabled:!!d&&[...d.querySelectorAll('[data-product-field]')].every(x=>!x.disabled)};
  });
  /* §9.204: 形状を選んだだけでは判定しない（値(mm)と基準を比べる）。
     フィクスチャに切断面等級が無いので、この時点では「基準なし」。 */
  rec('形状を選んだだけでは合否を決めない',
      ngState.judge==='値待ち'||ngState.judge==='基準なし',JSON.stringify(ngState));
  rec('異常のときは内訳を書ける',ngState.noneDisabled,JSON.stringify(ngState));
  const detail=await page.evaluate(()=>{
   const d=document.querySelector('#productRowsBody tr.prt-detail[data-row="0"]');
   const t=document.querySelector('.product-rows-table');
   const pane=document.querySelector('.right-pane');
   return {出る:!!d,
     欄:d?[...d.querySelectorAll('[data-product-field]')].map(x=>x.dataset.productField):[],
     溢れ:t&&pane?Math.round(t.getBoundingClientRect().right-pane.getBoundingClientRect().right):0};
  });
  rec('異常を選ぶと内訳の段が下に開く',detail.出る,JSON.stringify(detail).slice(0,140));
  rec('内訳の段には5欄そろう',
      ['occurrencePosition','regularity','direction','pitch','alignmentValue']
        .every(k=>detail.欄.includes(k)),JSON.stringify(detail.欄));
  rec('内訳を開いても表が横に溢れない',detail.溢れ<=0,String(detail.溢れ));

  /* **文字が切れないこと**（§9.206、実機で報告「新しく作ってもらった丈毎の
     『揃い』入力ですが、文字が見切れています」）。欄の**数や有無**を見る網では
     捕まらない——欄は在るのに、中の文字だけが上下または左右に切れている。
     `<select>`は中身をDOMで測れない（`scrollWidth`は選択肢の幅を映さない）ので、
     **高さは「文字×行送り＋余白＋罫線」と器を比べ、幅はcanvasで文字を測る**
     （§9.130の`fitControlWidths()`と同じ測り方）。 */
  const cutPrt=await page.evaluate(()=>{
   const cv=document.createElement('canvas'),ctx=cv.getContext('2d');
   const out=[];
   document.querySelectorAll('#productRowsBody [data-product-field]').forEach(el=>{
    const cs=getComputedStyle(el),box=el.getBoundingClientRect();
    const fs=parseFloat(cs.fontSize)||12;
    const pad=(k)=>parseFloat(cs[k])||0;
    /* 高さ: 1行ぶんの文字（行送りは既定の1.35で見る。`normal`のときも
       おおよそこの値）＋上下の余白＋上下の罫線。 */
    const needH=fs*1.35+pad('paddingTop')+pad('paddingBottom')
      +pad('borderTopWidth')+pad('borderBottomWidth');
    if(box.height+0.5<needH)
     out.push(`${el.dataset.productField} 縦 ${box.height.toFixed(1)}<${needH.toFixed(1)}`
       +`[fs${cs.fontSize} pad${cs.paddingTop}/${cs.paddingBottom}]`);
    if(el.tagName==='SELECT'){
     ctx.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
     const longest=[...el.options].reduce((m,o)=>Math.max(m,ctx.measureText(o.text).width),0);
     /* 選択欄は右端に▼の場所が要る（実測で約16px）。 */
     const needW=longest+pad('paddingLeft')+pad('paddingRight')
       +pad('borderLeftWidth')+pad('borderRightWidth')+16;
     if(box.width+0.5<needW)
      out.push(`${el.dataset.productField} 横 ${box.width.toFixed(1)}<${needW.toFixed(1)}`);
    }
   });
   return out;
  });
  rec('揃いの入力欄で文字が切れない',cutPrt.length===0,cutPrt.slice(0,4).join(' / '));

  /* ---- 内訳は手で畳める（§9.206、利用者の指示「拡張入力欄も手動では
     折りたためるようにしてください」） ----
     異常を選ぶと開くのは今までどおりだが、書き終えたら畳んで表を短くできる。
     **畳んでも記録は消さない**（表示だけの話）。 */
  const fold=await page.evaluate(()=>{
   const q=k=>document.querySelector(`#productRowsBody tr[data-row="0"] [data-product-field="${k}"]`);
   /* 畳んだときに読めることを確かめるため、先に1つ書いておく。 */
   const pos=q('occurrencePosition');
   pos.value='1/3未満発生';pos.dispatchEvent(new Event('change',{bubbles:true}));
   const btn=document.querySelector('#productRowsBody .prt-fold');
   if(!btn)return{ある:false};
   btn.click();
   const d=document.querySelector('#productRowsBody tr.prt-detail[data-row="0"]');
   const after={
    畳んだ:!!d&&d.classList.contains('is-folded')
      &&d.querySelectorAll('[data-product-field]').length===0,
    /* **畳んでも値は読める**（§9.125）。 */
    要約:d?d.textContent.replace(/\s+/g,''):'',
    値:S.measure.product.rows[0].occurrencePosition||''};
   document.querySelector('#productRowsBody .prt-fold').click();
   const back=document.querySelectorAll('#productRowsBody tr.prt-detail[data-row="0"] [data-product-field]').length;
   return{ある:true,...after,戻る:back};
  });
  rec('内訳を手で畳める',fold.ある&&fold.畳んだ===true,JSON.stringify(fold).slice(0,140));
  rec('畳んでも値は読める',fold.ある&&/1\/3未満発生/.test(fold.要約||''),String(fold.要約).slice(0,80));
  /* 開いた段に居る欄は**内訳5つ＋備考**の6つ（§9.397で備考が列から
     この段へ移った）。数を決め打ちにしているのは「開き直したら欄が戻る」を
     見るためで、欄が増えたらここも一緒に直す。 */
  rec('畳んでも記録は消さない・もう一度開ける',
      fold.ある&&fold.値==='1/3未満発生'&&fold.戻る===6,JSON.stringify(fold).slice(0,140));

  /* 旧データ(4桁コード)は**消さずに読める**こと。 */
  /* **必ず在る行(0)で見る**——縦割数が1のときは行1が無く、
     `querySelector`がnullになって網そのものが落ちる。 */
  const legacy=await page.evaluate(()=>{
   S.measure.product.rows[0]=Object.assign(S.measure.product.rows[0]||{},
     {edgeShape:'',occurrencePosition:'',regularity:'',direction:'',alignmentCode:'1203'});
   WL.measureView.renderProductPanel();
   const tr=document.querySelector('#productRowsBody tr[data-row="0"]');
   return {judge:tr.querySelector('[data-product-judge]').textContent.trim(),
           note:(tr.querySelector('.prt-old')||{}).textContent||''};
  });
  rec('旧コードのレコードも判定できる',legacy.judge==='NG',JSON.stringify(legacy));
  rec('旧コードを画面に残す',/1203/.test(legacy.note),legacy.note);

  /* 一括OKは全丈を「揃い綺麗」にする。 */
  await page.click('#productAllOk');
  await idle();
  const bulk=await page.evaluate(()=>{
   const n=document.querySelectorAll('#productRowsBody tr:not(.prt-detail)').length;
   const j=[...document.querySelectorAll('#productRowsBody [data-product-judge]')].map(x=>x.textContent.trim());
   return {n,ok:j.filter(x=>x==='OK').length,old:document.querySelectorAll('.prt-old').length};
  });
  rec('全丈OK一括入力で全部OKになる',bulk.n>0&&bulk.ok===bulk.n,JSON.stringify(bulk));
  rec('一括OKのあとに旧コードを残さない',bulk.old===0,String(bulk.old));

  /* ---- 切断面等級から出す揃いの基準（§9.204、利用者の指示） ----
     4級: のこぎり状2mm以下／テレスコープ状3mm以下
     3級: のこぎり状2mm以下／テレスコープ状5mm以下
     **検証用フィクスチャには品質ｸﾞﾚｰﾄﾞ_切断面の列が無い**ので、
     材料ごと注ぎ込んで確かめる——入れずに「出ない」を見ても、
     壊れていても同じ結果になる（§9.125/§9.160と同じ罠）。 */
  const cut=await page.evaluate(()=>{
   const src=S.measure.source;
   const keep=src['品質ｸﾞﾚｰﾄﾞ_切断面'];
   const out={};
   const rowState=()=>{
    const tr=document.querySelector('#productRowsBody tr[data-row="0"]');
    const b=tr.querySelector('[data-product-judge]');
    return {判定:b.textContent.trim(),理由:b.title,
      基準:(document.querySelector('#productRowsNote')||{}).textContent||''};
   };
   const setGrade=g=>{
    if(g===null)delete src['品質ｸﾞﾚｰﾄﾞ_切断面'];else src['品質ｸﾞﾚｰﾄﾞ_切断面']=g;
    WL.measureView.renderQualityGradePanel();WL.measureView.renderProductPanel();
   };
   const setRow=(edge,val)=>{
    const r=S.measure.product.rows[0];
    r.edgeShape=edge;r.alignmentValue=val;r.alignmentCode='';
    WL.measureView.renderProductPanel();
   };
   /* ① 等級が無いとき: 基準を出せないと書き、判定もしない */
   setGrade(null);setRow('のこぎり状','1.0');
   out.等級なし=rowState();
   /* ② 3級 */
   setGrade('3');
   out.三級の帯=(document.querySelector('#productRowsNote').textContent||'').replace(/\s+/g,' ');
   setRow('のこぎり状','');   out.三_のこぎり_値なし=rowState();
   setRow('のこぎり状','1.5');out.三_のこぎり_15=rowState();
   setRow('のこぎり状','2');  out.三_のこぎり_20=rowState();
   setRow('のこぎり状','2.5');out.三_のこぎり_25=rowState();
   setRow('テレスコープ状','4');out.三_テレ_40=rowState();
   /* ③ 4級では同じ4mmがNGになる（等級で基準が変わることを見る） */
   setGrade('4');
   out.四級の帯=(document.querySelector('#productRowsNote').textContent||'').replace(/\s+/g,' ');
   setRow('テレスコープ状','4');out.四_テレ_40=rowState();
   setRow('テレスコープ状','3');out.四_テレ_30=rowState();
   /* ④ 「3C」のような英字つき・「.」（未設定）の扱い */
   setGrade('3C');setRow('テレスコープ状','4');out.英字つき=rowState();
   setGrade('.');  setRow('テレスコープ状','4');out.ドット=rowState();
   /* ⑤ 旧名「テレスコ状」で保存された値でも基準が当たる */
   setGrade('3');  setRow('テレスコ状','4');   out.旧名=rowState();
   /* ⑥ 値が基準を超えたら欄そのものにも印が付く */
   setGrade('4');  setRow('テレスコープ状','9');
   out.超過の印=!!document.querySelector('#productRowsBody .prt-df.is-over');
   /* 後始末 */
   if(keep===undefined)delete src['品質ｸﾞﾚｰﾄﾞ_切断面'];else src['品質ｸﾞﾚｰﾄﾞ_切断面']=keep;
   S.measure.product.rows=S.measure.product.rows.map(()=>WL.measureView.blankProductRow());
   WL.measureView.renderQualityGradePanel();WL.measureView.renderProductPanel();
   return out;
  });
  rec('等級が読めないときは基準を出せないと書く',
      /基準を出せません/.test(cut.等級なし.基準),cut.等級なし.基準.slice(0,80));
  rec('等級が読めないときは合否を決めない',cut.等級なし.判定==='基準なし',
      JSON.stringify(cut.等級なし));
  rec('3級の基準を出す（のこぎり2.0/テレスコープ5.0）',
      /のこぎり状/.test(cut.三級の帯)&&/2\.0mm以下/.test(cut.三級の帯)
      &&/テレスコープ状/.test(cut.三級の帯)&&/5\.0mm以下/.test(cut.三級の帯),cut.三級の帯.slice(0,120));
  rec('4級の基準を出す（テレスコープ3.0）',
      /3\.0mm以下/.test(cut.四級の帯)&&/2\.0mm以下/.test(cut.四級の帯),cut.四級の帯.slice(0,120));
  rec('客先の個別要求は見ていないと書く',
      /客先の個別要求は反映していません/.test(cut.三級の帯),cut.三級の帯.slice(-90));
  rec('値がまだ無ければ「値待ち」',cut.三_のこぎり_値なし.判定==='値待ち',
      JSON.stringify(cut.三_のこぎり_値なし));
  rec('基準以内はOK（1.5mm ≦ 2.0mm）',cut.三_のこぎり_15.判定==='OK',JSON.stringify(cut.三_のこぎり_15));
  rec('ちょうど基準もOK（2.0mm ≦ 2.0mm）',cut.三_のこぎり_20.判定==='OK',JSON.stringify(cut.三_のこぎり_20));
  rec('基準超過はNG（2.5mm > 2.0mm）',cut.三_のこぎり_25.判定==='NG',JSON.stringify(cut.三_のこぎり_25));
  rec('等級で基準が変わる（テレスコープ4mm: 3級OK / 4級NG）',
      cut.三_テレ_40.判定==='OK'&&cut.四_テレ_40.判定==='NG',
      `3級=${cut.三_テレ_40.判定} / 4級=${cut.四_テレ_40.判定}`);
  rec('4級のテレスコープ3.0mmはOK',cut.四_テレ_30.判定==='OK',JSON.stringify(cut.四_テレ_30));
  rec('「3C」のような英字つきの等級も3級として読む',cut.英字つき.判定==='OK',JSON.stringify(cut.英字つき));
  rec('「.」（未設定）は等級として読まない',cut.ドット.判定==='基準なし',JSON.stringify(cut.ドット));
  rec('旧名「テレスコ状」で保存された値にも基準が当たる',cut.旧名.判定==='OK',JSON.stringify(cut.旧名));
  rec('超過した値の欄そのものにも印を付ける',cut.超過の印===true,String(cut.超過の印));
  rec('判定の理由を書く（基準と実測が読める）',
      /2\.0mm/.test(cut.三_のこぎり_25.理由)&&/2\.5/.test(cut.三_のこぎり_25.理由),cut.三_のこぎり_25.理由);

  /* ---- 内径は仕掛の「ｺｲﾙ_内径目標」から（§9.204、利用者の指示） ----
     0より大きい数値のときだけ。フィクスチャに列が無いので注ぎ込む。 */
  const inner=await page.evaluate(()=>{
   const src=S.measure.source,keep=src['ｺｲﾙ_内径目標'];
   const el=document.getElementById('innerDiameter');
   const note=document.getElementById('innerDiameterFrom');
   const P=r=>WL.innerDiameter.preset(r);
   const out={
    値あり:P({'ｺｲﾙ_内径目標':'508'}),
    全角別綴り:P({'コイル_内径目標':'508.0'}),
    ゼロ:P({'ｺｲﾙ_内径目標':'0'}),
    空:P({'ｺｲﾙ_内径目標':''}),
    文字:P({'ｺｲﾙ_内径目標':'なし'}),
    無い:P({}),
   };
   /* 当てる: 選択肢に無くても選べること・出どころが出ること */
   S.measure.settings.innerDiameter='-';el.value='-';
   src['ｺｲﾙ_内径目標']='508';
   out.当てた=WL.innerDiameter.apply(src);
   out.選択値=el.value;
   out.選択肢にある=[...el.options].some(o=>o.value==='508');
   out.出どころ=note.hidden?'':note.textContent.trim();
   out.出どころの詳細=note.hidden?'':(note.title||'');
   /* 器（①準備の1列）に収まっていること。溢れると`<label>`のフレックス行が
      その幅で組まれ、**内径の選択欄だけ広がって隣へ重なる**（§9.208 ①）。 */
   const lab=el.closest('label');
   out.欄の幅=Math.round(el.getBoundingClientRect().width);
   out.器の幅=Math.round(lab.getBoundingClientRect().width);
   out.隣の幅=Math.round(document.getElementById('spool').getBoundingClientRect().width);
   out.注記の幅=Math.round(note.getBoundingClientRect().width);
   out.隣と重なる=el.getBoundingClientRect().right
     >document.getElementById('spool').getBoundingClientRect().left+0.5;
   /* すでに選び直してあるときは上書きしない */
   S.measure.settings.innerDiameter='300';el.add(new Option('300','300'));el.value='300';
   WL.innerDiameter.apply(src);
   out.上書きしない=el.value;
   out.選び直したら出どころは消える=document.getElementById('innerDiameterFrom').hidden;
   /* 後始末 */
   if(keep===undefined)delete src['ｺｲﾙ_内径目標'];else src['ｺｲﾙ_内径目標']=keep;
   S.measure.settings.innerDiameter='-';el.value='-';WL.innerDiameter.refresh();
   return out;
  });
  rec('内径目標が0より大きければプリセットにする',inner.値あり==='508',String(inner.値あり));
  rec('別綴り（コイル_内径目標）でも引く',inner.全角別綴り==='508',String(inner.全角別綴り));
  rec('0・空欄・文字はプリセットにしない',
      inner.ゼロ===''&&inner.空===''&&inner.文字===''&&inner.無い==='',
      JSON.stringify({ゼロ:inner.ゼロ,空:inner.空,文字:inner.文字,無い:inner.無い}));
  rec('内径種別マスタに無くても選べる（候補へ足す）',
      inner.選択値==='508'&&inner.選択肢にある,JSON.stringify(inner).slice(0,120));
  /* 画面には**短く**書き、列の名前は`title`が持つ（§9.208 ①）。
     長い文をそのまま出すと器より広くなり、隣の欄へ重なる。 */
  rec('どこから来た値かを画面に書く',/仕掛/.test(inner.出どころ||''),inner.出どころ);
  rec('出どころの列名はtitleで読める',/ｺｲﾙ_内径目標/.test(inner.出どころの詳細||''),
      (inner.出どころの詳細||'').slice(0,50));
  rec('出どころの注記が器からはみ出さない（§9.208 ①）',
      inner.注記の幅<=inner.器の幅+1,`注記${inner.注記の幅} / 器${inner.器の幅}`);
  rec('内径の欄が隣（スプール）と同じ幅で重ならない（§9.208 ①）',
      inner.欄の幅===inner.隣の幅&&inner.隣と重なる===false,
      `内径${inner.欄の幅} / スプール${inner.隣の幅} / 重なり${inner.隣と重なる}`);
  rec('選び直してあるときは上書きしない',inner.上書きしない==='300',String(inner.上書きしない));
  rec('選び直したら出どころの注記は消える',inner.選び直したら出どころは消える===true,
      String(inner.選び直したら出どころは消える));
  await page.evaluate(()=>{
   S.measure.product.rows=S.measure.product.rows.map(()=>WL.measureView.blankProductRow());
   WL.measureView.renderProductPanel();
  });

  /* ---- 母材の計算全長（参考）（§9.160、利用者の指示） ----
     **元データがそろっているときだけ**出す。良品重量が0なら計算しない。
     フィクスチャにはBOX実績の列が無いので、**材料ごと注ぎ込んで**確かめる
     ——入れずに「出ない」を見ても、壊れていても同じ結果になる。
     長さ(m)=1000×重量/(比重×板厚×板幅)：1000×3200/(2.7×0.5×1030)=2301.3 */
  const calc=await page.evaluate(()=>{
   const src=S.measure.source;
   const keep={t:src['BOX実績_板厚'],w:src['BOX実績_板幅'],d:src['比重'],kg:src['BOX実績_良品重量']};
   const read=()=>({欄:!document.getElementById('motherCalcLengthField').hidden,
     値:(document.getElementById('motherCalcLength').textContent||'').trim(),
     根拠:(document.getElementById('motherCalcBasis').textContent||'').trim()});
   delete src['BOX実績_板厚'];delete src['比重'];delete src['BOX実績_良品重量'];
   WL.motherCalc.refresh();const 無し=read();
   src['BOX実績_板厚']=0.5;src['BOX実績_板幅']=1030;src['比重']=2.7;src['BOX実績_良品重量']=3200;
   WL.motherCalc.refresh();const そろった=read();
   src['BOX実績_良品重量']=0;
   WL.motherCalc.refresh();const 重量0=read();
   /* 後始末: 注ぎ込んだ材料を元へ戻す（無かったものは消す）。 */
   [['BOX実績_板厚',keep.t],['BOX実績_板幅',keep.w],['比重',keep.d],['BOX実績_良品重量',keep.kg]]
     .forEach(([k,v])=>{if(v===undefined)delete src[k];else src[k]=v});
   WL.motherCalc.refresh();
   return{無し,そろった,重量0};
  });
  rec('元データが欠けているときは計算全長を出さない',calc.無し.欄===false,JSON.stringify(calc.無し));
  rec('元データがそろうと計算全長を参考表示する',
      calc.そろった.欄===true&&/2301\.3/.test(calc.そろった.値)&&/m/.test(calc.そろった.値),
      JSON.stringify(calc.そろった));
  rec('計算全長は出どころ（板厚・板幅・比重・良品重量）を添える',
      /板厚/.test(calc.そろった.根拠)&&/板幅/.test(calc.そろった.根拠)
      &&/比重/.test(calc.そろった.根拠)&&/良品重量/.test(calc.そろった.根拠),
      calc.そろった.根拠);
  rec('良品重量が0のときは計算しない',calc.重量0.欄===false,JSON.stringify(calc.重量0));

  /* ③は基本情報が1×3で左に立ち、右の3列が「確認 → その根拠」の縦の対
     （§9.146、利用者の指示）。確認の3枚は真下のカードと**左端がそろう**。 */
  await go('3');
  const f3=await page.evaluate(()=>{
   const R=e=>e?e.getBoundingClientRect():null;
   const fc=R(document.querySelector('.finish-check'));
   const lp=R(document.querySelector('.left-pane'));
   const body=R(document.querySelector('.measure-body'));
   const rows=[...document.querySelectorAll('.fc-row')];
   /* **中心で見る。** 確認はカードの中に入ったので、器の余白ぶん左端は
      ずれる（§9.147）。「真下にあるか」を見たいので中心が下のカードの
      横幅に収まっているかで判定する。 */
   const 対=k=>{const r=rows.find(x=>x.dataset.fc===k);const b=r&&R(r);
     return b?Math.round(b.left+b.width/2):null};
   const 下=s=>{const e=document.querySelector(s);const b=e&&R(e);
     return b?[Math.round(b.left),Math.round(b.right)]:null};
   return {確認幅:Math.round(fc.width),本体幅:Math.round(body.width),
     確認左:Math.round(fc.left),基本左:Math.round(lp.left),基本高:Math.round(lp.height),
     本体高:Math.round(body.height),
     対:{測定:対('measure'),公差外:対('ng'),作業時間:対('worktime')},
     下:{記録した値:下('.recorded-pane'),分析:下('.analysis'),作業時間:下('.center-pane')},
     カード:rows.filter(x=>x.dataset.fc!=='skip').map(x=>Math.round(R(x).top))};
  });
  /* 基本情報は1×3。本文の縦をほぼ使い切る（上下の余白ぶんだけ短い）。 */
  rec('③の基本情報は縦3マスを使う',f3.基本高>=f3.本体高-40,JSON.stringify(f3));
  rec('③の確認表は基本情報の右（2〜4列）',f3.確認左>f3.基本左,JSON.stringify(f3));
  /* **確認の3件は真下のカードの上にある。** 対応が崩れると「縦の対」に
     見えず、引っかかった行の根拠を横へ探しに行くことになる。 */
  const 真上=(c,r)=>c!==null&&r&&c>=r[0]&&c<=r[1];
  rec('③の確認は真下のカードの上にある',
      真上(f3.対.測定,f3.下.記録した値)&&真上(f3.対.公差外,f3.下.分析)
      &&真上(f3.対.作業時間,f3.下.作業時間),
      JSON.stringify({対:f3.対,下:f3.下}));
  rec('③の確認カードが横に並ぶ',new Set(f3.カード).size===1,JSON.stringify(f3.カード));

  /* ---- カードの意匠と題（§9.147） ----
     利用者の指摘「③はやっぱり剥き出しでカードに入って無い」。**枠が無い
     ことは目で見ないと分からなかった**——この網が無いと、次にカードを
     1枚足したときも同じことが起きる。本文グリッドの直下に居るものは、
     全部カードの意匠（枠・地・角丸）を持つ。
     題も同じ。実測で**15px／13px／20pxの3種類**あった——クラスを1つ
     足すだけでは揃わない（後から書かれた要素セレクタが勝つ経路が複数ある）。 */
  const 意匠={};
  for(const s of ['1','2','3']){
   await go(s);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   意匠[s]=await page.evaluate(()=>{
    const vis=e=>{const b=e.getBoundingClientRect();
      return b.width>2&&b.height>2&&getComputedStyle(e).display!=='none'};
    const cards=[...document.querySelector('.measure-body').children].filter(vis);
    const 枠なし=[],題=[];
    cards.forEach(c=>{
     const cs=getComputedStyle(c);
     const name=(c.className||c.id||'').toString().split(' ')[0];
     if(parseFloat(cs.borderTopWidth)<1||cs.backgroundColor==='rgba(0, 0, 0, 0)'
        ||parseFloat(cs.borderTopLeftRadius)<1)枠なし.push(name);
     c.querySelectorAll('.card-title').forEach(t=>{
      if(!vis(t))return;
      const ts=getComputedStyle(t);
      題.push(ts.fontSize+'/'+ts.color+'/'+ts.fontWeight);
     });
    });
    return{カード:cards.length,枠なし,題:[...new Set(題)],題数:題.length,
      進捗バー:!!document.getElementById('headProgress')};
   });
  }
  const 段=['1','2','3'];
  rec('本文グリッドの直下はすべてカードの意匠',
      段.every(s=>意匠[s].枠なし.length===0),JSON.stringify(意匠));
  rec('カードの題は3段とも同じ大きさ・色・太さ',
      段.every(s=>意匠[s].題.length===1)&&new Set(段.map(s=>意匠[s].題[0])).size===1,
      JSON.stringify(Object.fromEntries(段.map(s=>[s,意匠[s].題]))));
  /* 題が無いカードは②の入力内容だけ（一覧の見出しが題を兼ねる）。 */
  rec('カードには題が付いている',
      段.every(s=>意匠[s].題数>=意匠[s].カード-1),JSON.stringify(意匠));
  /* ヘッダーの進捗バーは廃止（§9.147、利用者の指示）。段ナビの「N/M 項目」と
     ③の完了前の確認が同じことを正確に言っている。 */
  rec('ヘッダーに進捗バーを置かない',段.every(s=>意匠[s].進捗バー===false),
      JSON.stringify(段.map(s=>意匠[s].進捗バー)));
  await go('3');
  const w3=await widthKinds(),e3=await emptyRate();
  rec('③の入力欄の幅が4種類以内',w3.length<=4,JSON.stringify(w3));
  /* ③の記録の壁（記録した値・測定データ分析・作業時間）は**4枚とも同じ高さ**
     にする（§9.148、利用者の指摘「グリッドで決めた高さになっていない」）。
     壁の中の空きは「この1枚に中身が無い」のではなく**このロットの項目が
     少ない**ことの現れで、§9.135の「マスが余ったら余らせたままにする」に
     当たる。だから壁の中では空き量では落とさず、**高さがそろっているか**で
     見る（そろっていないほうが壁に見えない＝実際に指摘された）。 */
  const box3=(await emptyBox()).filter(x=>!/^analysis:/.test(x));
  rec('③に中身のない器（120px超の空き）が無い',box3.length===0,box3.join(' / '));
  const wall3=await page.evaluate(()=>{
   const h=s=>{const e=document.querySelector(s);
     return e?Math.round(e.getBoundingClientRect().height):0};
   return{記録した値:h('.recorded-pane'),分析:h('.analysis'),作業時間:h('.center-pane'),
     確認:h('.finish-check'),基本情報:h('.left-pane'),
     本体:h('.measure-body')};
  });
  rec('③の記録の壁は3枚とも同じ高さ',
      new Set([wall3.記録した値,wall3.分析,wall3.作業時間]).size===1,JSON.stringify(wall3));
  /* 確認カードは**マスの高さいっぱい**。中身なりに詰めると、下の壁との
     あいだに150pxの帯ができてグリッドの形が読めなくなる（実際にそうなった）。 */
  rec('③の確認カードがマスの高さを使う',
      wall3.確認>=Math.round(wall3.本体/3)-20,JSON.stringify(wall3));
  /* ---- 「記録した値」は値を切り詰めない（§9.206、実機で報告
     「その中の母材の項目が見切れています」） ----
     `.rv-group dd`は`text-overflow:ellipsis`なので、**器が足りないと
     「122…」と黙って切れる**。数字は切れた時点で別の数字になるので、
     ここは省略記号で逃がしてよい欄ではない。 */
  /* **長い値・長いラベルを注ぎ込んでから測る**（§9.206）。フィクスチャの
     母材は空か短いので、そのまま見ても切り詰めの経路を一度も通らない
     （§9.125・§9.160と同じ「材料ごと注ぎ込む」）。 */
  await page.evaluate(()=>{
   const w=document.getElementById('motherOriginalWidth');
   if(w)w.textContent='1225.0';
   const s=document.getElementById('motherScrapWidth');
   if(s)s.textContent='34.8';
   document.querySelectorAll('[data-mother]').forEach(el=>{if(!el.value)el.value='1234.5'});
   WL.measureView.renderRecordedValues();
  });
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const rvCut=await page.evaluate(()=>[...document.querySelectorAll('.rv-group dd')]
    .map((d,i)=>({t:d.textContent.trim(),over:Math.round(d.scrollWidth-d.clientWidth)}))
    .filter(x=>x.over>1).map(x=>`${x.t}(+${x.over}px)`));
  rec('「記録した値」の値が切り詰められない',rvCut.length===0,rvCut.slice(0,4).join(' / '));
  /* ①で選んだ値がそのまま出ること（§9.206、実機で報告「準備の入力など、
     選択状態にしたら、記録した値に入ってほしいところ何も表示されません」）。
     `settings`は`WL.measureView.collect()`＝保存のときにしか書かれないので、そこだけを
     見ていると**選んだ直後は「—」のまま**になる。 */
  const rvLive=await page.evaluate(async()=>{
   WL.measureSteps.go('1');
   const op=document.getElementById('operator');
   const val=[...op.options].map(o=>o.value).find(v=>v&&v!=='-')||'';
   op.value=val;op.dispatchEvent(new Event('change',{bubbles:true}));
   WL.measureSteps.go('3');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   /* **群の名前で探さない**（§9.242 ④）。群も並びも操業データ項目マスタが
      決めるようになったので、名前を決め打ちにすると現場が群名を変えた
      だけで落ちる。**項目名（`dt`）で引く**——こちらは役割の担い手が
      変わらないかぎり動かない。 */
   const dt=[...document.querySelectorAll('.rv-group dt')]
     .find(t=>t.textContent.trim()==='オペレータ');
   const dd=dt&&dt.parentElement?dt.parentElement.querySelector('dd'):null;
   return{選んだ:val,出た:dd?dd.textContent.trim():''};
  });
  rec('①で選んだ値が「記録した値」に出る',
      !!rvLive.選んだ&&rvLive.出た===rvLive.選んだ,JSON.stringify(rvLive));

  /* ==================================================================
     §9.208 測定画面の作り直し（利用者の指示）
     ================================================================== */

  /* ---- ② 入力数はその場で数え直す ----
     母材8欄は`WL.measureView.collect()`＝**保存のときだけ**回収する作りで、`m.mother`は
     打っても空のままだった。入力数は`m.mother`から数えるので、**全部
     埋めてもチップは 0/N のまま**（実機で報告）。
     **確かめるときは保存せずに見ること**——保存してから数えると、
     直す前の実装でも通ってしまう。 */
  await go('2');
  await setType(MATERIAL);
  const cnt=await page.evaluate(async()=>{
   /* **チップは項目ごと**（§9.391で母材と丈毎に分かれた）——どちらの数が
      動いたのかを名前で引く。 */
   const chip=name=>{
    const c=[...document.querySelectorAll('.type-chip')]
      .find(x=>x.dataset.typeChip===name);
    return c?c.querySelector('.type-chip-state').textContent.trim():'';
   };
   /* まっさらから始める（前の節が値を入れている） */
   document.querySelectorAll('[data-mother]').forEach(el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))});
   S.measure.mother={};
   (S.measure.product.rows||[]).forEach(r=>Object.keys(r).forEach(k=>r[k]=''));
   WL.measureView.renderProductPanel();refreshMeasureProgress();
   await new Promise(r=>setTimeout(r,120));
   const M=WL.measureItem.MATERIAL,P=WL.measureItem.PIECE;
   const before=chip(M),beforePiece=chip(P);
   const el=document.querySelector('[data-mother]');
   el.value='1234.5';el.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,120));
   const afterMother=chip(M),motherKept=String(S.measure.mother[el.dataset.mother]||'');
   const len=document.querySelector('#productRowsBody tr[data-row="0"] [data-product-field="productLength"]');
   len.value='2500';len.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,120));
   return{before,beforePiece,afterMother,motherKept,
          afterPiece:chip(P),motherUnchanged:chip(M),
          名前:[M,P],
          チップ名:[...document.querySelectorAll('.type-chip .type-chip-name')].map(x=>x.textContent.trim())};
  });
  const num=t=>Number(String(t).split('/')[0]);
  rec('母材を1つ打つと入力数がその場で増える（§9.208 ②）',
      num(cnt.afterMother)===num(cnt.before)+1,`${cnt.before} → ${cnt.afterMother}`);
  rec('母材の値は保存を待たずレコードへ入る',cnt.motherKept==='1234.5',cnt.motherKept);
  /* **数えるのは自分の項目だけ**（§9.391）——丈を打って増えるのは「丈毎」で、
     「母材」は動かない。合算していた頃はどちらが残っているか読めなかった。 */
  /* **埋まりきると札は「済」になる**ので、数だけで見ない（丈が1本の
     ロットでは 0/1 → 済 になり、`num()`がNaNになる）。 */
  const stepUp=(a,b)=>/済/.test(b)?!/済/.test(a):num(b)===num(a)+1;
  rec('丈を1つ打つと「丈毎」の入力数が増える（§9.208 ②・§9.391）',
      stepUp(cnt.beforePiece,cnt.afterPiece),`${cnt.beforePiece} → ${cnt.afterPiece}`);
  rec('丈を打っても「母材」の入力数は動かない（§9.391）',
      cnt.motherUnchanged===cnt.afterMother,`${cnt.afterMother} → ${cnt.motherUnchanged}`);
  /* 先頭2つは**手入力の面**（母材の「全長」と製品の「寸法・外観」）。
     **綴りは語彙から引く**——直に書くと改名のたびに落ちる（§9.389）。 */
  rec('入力内容の先頭2つは手入力の面（母材の全長・製品の寸法・外観）',
      cnt.名前[0]===MATERIAL&&cnt.名前[1]===PIECE
      &&cnt.チップ名[0]===MATERIAL&&cnt.チップ名[1]===PIECE,JSON.stringify(cnt.チップ名));

  /* ---- ② 角は1種類にそろえる（利用者の指示「四角の入力欄はすべて丸角に」） ---- */
  const radii=await page.evaluate(()=>{
   const box=document.querySelector('[data-workpanel="material"]');
   return [...box.querySelectorAll('input,select,output')]
     .filter(el=>el.getBoundingClientRect().width>0)
     .map(el=>({t:el.tagName+(el.dataset.mother||el.dataset.productField||''),
                r:parseFloat(getComputedStyle(el).borderTopLeftRadius)||0}))
     .filter(x=>x.r<2);
  });
  rec('母材/丈毎の面に直角の入力欄が無い（§9.208 ②）',radii.length===0,
      radii.slice(0,4).map(x=>x.t).join(' / '));

  /* ---- ③ 手で打つ数値欄（マイナス禁止・「.5」の省略打ち） ----
     `input[type=number]`の「妥当な浮動小数点数」には小数点の前の桁が要る
     ので、`.5`と打つと`value`が**空文字**になり打った値が消える。 */
  const typing=await page.evaluate(async()=>{
   const el=document.querySelector('[data-mother]');
   const put=v=>{el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}))};
   put('-12.5');const マイナス=el.value;
   put('.5');const 途中=el.value;
   el.dispatchEvent(new Event('blur'));
   const 離れたあと=el.value;
   put('１２.５');const 全角=el.value;
   put('');
   return{マイナス,途中,離れたあと,全角,型:el.type,印:el.classList.contains('numeric-input')};
  });
  rec('マイナスは打てない（§9.208 ③）',typing.マイナス==='12.5',typing.マイナス);
  rec('「.5」は打っている間そのまま受ける',typing.途中==='.5',typing.途中);
  rec('離れたら「.5」→「0.5」になる（§9.208 ③）',typing.離れたあと==='0.5',typing.離れたあと);
  rec('全角で打っても数字として入る',typing.全角==='12.5',typing.全角);
  rec('数値欄の印は残す（幅の見積りが日本語8文字へ倒れない）',
      typing.印===true,`type=${typing.型} numeric=${typing.印}`);

  /* ---- ③ 手動入力では印とカーソルが一致する ----
     「クリックしてもフォーカスは移動せず、入力しても自動では移動しない」
     （実機で報告）。**印(`.current`)だけが動いてカーソルが残る**と、打った
     文字は前の枠へ入り続ける。 */
  await go('1');
  await page.evaluate(()=>{const h=document.getElementById('horizontalCount');
    h.value='4';h.dispatchEvent(new Event('change',{bubbles:true}))});
  await go('2');
  await setType('ラテラルボー');
  await page.evaluate(()=>document.querySelector('[data-mode="manual"]').click());
  await idle();
  const nav=await page.evaluate(async()=>{
   const wait=()=>new Promise(r=>setTimeout(r,250));
   const at=()=>{const a=document.activeElement;
     return a&&a.dataset&&a.dataset.mkey?`${a.dataset.i}:${a.dataset.j}`:(a&&a.id)||'?'};
   const cur=()=>{const c=document.querySelector('[data-mkey].current');
     return c?`${c.dataset.i}:${c.dataset.j}`:''};
   const cell=(i,j)=>document.querySelector(`[data-mkey="lateral"][data-i="${i}"][data-j="${j}"]`);
   cell(0,2).click();await wait();
   const クリック後={印:cur(),カーソル:at()};
   cell(0,2).dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   await wait();
   const Enter後={印:cur(),カーソル:at()};
   const th=document.querySelector('.measure-matrix thead th button[data-mx-len="1"]');
   th.click();await wait();
   const 丈を押した後={印:cur(),カーソル:at()};
   return{クリック後,Enter後,丈を押した後};
  });
  rec('手動入力: クリックした枠に印もカーソルも移る（§9.208 ③）',
      nav.クリック後.印==='0:2'&&nav.クリック後.カーソル==='0:2',JSON.stringify(nav.クリック後));
  rec('手動入力: Enterで次の枠へ印もカーソルも進む（§9.208 ③）',
      nav.Enter後.印==='0:3'&&nav.Enter後.カーソル==='0:3',JSON.stringify(nav.Enter後));
  rec('手動入力: 丈の見出しを押すとその丈の先頭の枠へ移る（§9.208 ③）',
      nav.丈を押した後.印==='1:0'&&nav.丈を押した後.カーソル==='1:0',
      JSON.stringify(nav.丈を押した後));
  /* **自動転送では絶対にフォーカスを動かさない**（§9.122）。受信欄から
     外れた瞬間に転送を1件も受けなくなる。
     見るのは**板幅**——ラテラルボーは`MANUAL_ONLY_MEASURE_TYPES`で手動固定
     （受信の帯そのものを出さない）ので、あちらで自動転送は確かめられない。 */
  await setType('板幅');
  const autoFocus=await page.evaluate(async()=>{
   const c=document.querySelector('[data-mkey="width"][data-i="0"][data-j="1"]');
   c.click();await new Promise(r=>setTimeout(r,400));
   const a=document.activeElement;
   return{モード:S.measure.settings.inputMode,
          帯:!document.getElementById('inputStatusBox').hidden,
          欄:(a&&(a.id||a.tagName+':'+(a.dataset&&a.dataset.j)))||'(なし)'};
  });
  rec('自動転送ではセルを押しても受信欄からフォーカスを外さない（§9.122）',
      autoFocus.モード==='auto'&&autoFocus.帯===true&&autoFocus.欄==='deviceInput',
      JSON.stringify(autoFocus));
  await page.evaluate(()=>{const h=document.getElementById('horizontalCount');
    h.value='1';h.dispatchEvent(new Event('change',{bubbles:true}))});
  await go('3');


  /* ==================================================================
     §9.209 測定画面の縦を空けて多条を全部見せる（利用者の指示）
     ------------------------------------------------------------------
     以前は表の上に「受信の帯」「測定＋入力位置」「公差の帯」「項目名＋
     測定待ち」の**4本**が積まれ、23条ほどしか一度に出せなかった。
     ================================================================== */
  await go('2');
  await setType('板幅');
  const headRead=()=>page.evaluate(()=>{
   const h=document.querySelector('.editor-head');
   const r=h.getBoundingClientRect();
   /* **段は「上端」ではなく「中心」で数える**——`align-items:center`なので、
      背の違う部品の上端はそろわない（そろえると器の高さで判定したのと
      同じになり、何も確かめていない）。塊(`.mhead-line`)の中は折り返さない
      ので、数えるのは塊の中心でよい。 */
   const rows=[...h.querySelectorAll(':scope > .mhead-line')]
     .filter(e=>e.getBoundingClientRect().width>0)
     .map(e=>{const b=e.getBoundingClientRect();return Math.round((b.top+b.bottom)/2)});
   /* 文字の大きさは**題以外は1種類**（§9.210 ①）。中身のある葉だけ数える。 */
   const sizes={};
   h.querySelectorAll('*').forEach(x=>{
    const b=x.getBoundingClientRect();
    if(b.width<1||b.height<1||x.children.length)return;
    if(x.id==='measurePanelTitle')return;
    if(!(x.textContent||'').trim())return;
    const f=getComputedStyle(x).fontSize;sizes[f]=(sizes[f]||0)+1;
   });
   const cut=e=>e?Math.max(0,e.scrollWidth-e.clientWidth):0;
   return{高さ:Math.round(r.height),
     段:[...new Set(rows)].length,
     /* `nowrap`にした以上「段が1」だけでは切れているのを見逃す（§9.234 ③）。 */
     はみ出し:cut(h),
     帯:!!h.querySelector('#inputStatusBox'),
     帯が見える:!!h.querySelector('#inputStatusBox')
       &&h.querySelector('#inputStatusBox').getBoundingClientRect().width>0,
     帯の左:Math.round((h.querySelector('#inputStatusBox')||{getBoundingClientRect:()=>({left:0})})
       .getBoundingClientRect().left),
     切替:!!h.querySelector('.mode-tabs'),
     項目:(h.querySelector('.mhead-item')||{}).textContent||'',
     状態:(h.querySelector('.mhead-status')||{}).textContent||'',
     公差の器:!!h.querySelector('#tolSlot2'),
     旧見出し:!!document.querySelector('#measurementGrid .measure-grid-block-title'),
     凡例:!!h.querySelector('.legend'),
     題の大きさ:getComputedStyle(document.getElementById('measurePanelTitle')).fontSize,
     文字の種類:Object.keys(sizes),
     モード:(h.querySelector('.auto-mode-label')||{}).textContent||''};
  });
  const bar=await headRead();
  /* **1行に収める**（§9.234 ③、利用者の指示「2行にわたって公差情報や
     ボタンや説明などが入っていますが、1行に収めたいです」）。器は`nowrap`
     なので、行数だけでなく**横に溢れていないこと**も見る。 */
  rec('見出しは1行（§9.234 ③）',bar.段===1,JSON.stringify({段:bar.段,高さ:bar.高さ}));
  rec('見出しが横に溢れない（§9.234 ③）',bar.はみ出し<=1,String(bar.はみ出し));
  rec('受信の状態・自動手動の切替が見出しの中にある',bar.帯&&bar.切替&&/自動|手動/.test(bar.モード),
      JSON.stringify({帯:bar.帯,切替:bar.切替,モード:bar.モード}));
  rec('項目名と進捗も見出しへ寄せた（表の上の帯を廃止）',
      bar.項目==='板幅'&&!!bar.状態&&bar.旧見出し===false,JSON.stringify(bar));
  rec('公差の器も同じ段にある',bar.公差の器===true,String(bar.公差の器));
  rec('見出し4本ぶん（実測130px級）を1本へ詰めた',bar.高さ<=34,`${bar.高さ}px`);
  /* ---- 凡例（待ち・入力中・完了・異常）は廃止（§9.210 ①、利用者の指示） ---- */
  rec('表示案内（凡例）は出さない（§9.210 ①）',bar.凡例===false,String(bar.凡例));
  /* ---- 文字の大きさは題以外1種類（§9.210 ①、利用者の指示） ----
     以前は 11px・12px・14px の3種が1行に混ざっていた。 */
  rec('見出しの文字は題以外すべて同じ大きさ（§9.210 ①）',
      bar.文字の種類.length===1&&bar.文字の種類[0]!==bar.題の大きさ,
      JSON.stringify({題:bar.題の大きさ,他:bar.文字の種類}));
  /* ---- 題の位置は他のカードと同じ規格（§9.210 ③、利用者の指摘） ---- */
  const titlePos=await page.evaluate(()=>{
   const cardOf=el=>{let n=el.parentElement;
    while(n&&n!==document.body){const cs=getComputedStyle(n);
     if(cs.borderTopWidth!=='0px'||(cs.backgroundColor!=='rgba(0, 0, 0, 0)'
       &&cs.backgroundColor!=='transparent'))return n;
     n=n.parentElement}return null};
   const off=el=>{const r=el.getBoundingClientRect(),c=cardOf(el);
    if(!c)return null;const cr=c.getBoundingClientRect();
    return{左:Math.round(r.left-cr.left),上:Math.round(r.top-cr.top)}};
   const mine=off(document.getElementById('measurePanelTitle'));
   const others=[...document.querySelectorAll('.card-title')]
     .filter(x=>x.id!=='measurePanelTitle'&&x.getBoundingClientRect().width>0)
     .map(off).filter(Boolean);
   return{mine,others};
  });
  rec('測定カードの題も他のカードと同じ位置から始まる（§9.210 ③）',
      !!titlePos.mine&&titlePos.others.length>0
      &&titlePos.others.every(o=>o.左===titlePos.mine.左)
      &&titlePos.others.every(o=>Math.abs(o.上-titlePos.mine.上)<=4),
      JSON.stringify(titlePos));
  /* ---- 手入力だけの項目でも同じ位置に「手動」バッジ（§9.210 ③、利用者の指示） ----
     以前は帯ごと隠していたので、切り替えると右のバッジが左へ詰まっていた。
     **同じ位置で文字だけが入れ替わること**を見る（`display`は触らない
     ——受信欄はこの中にあり、寸法ゼロだとフォーカスを保持できない・§9.122）。 */
  await setType('ラテラルボー');
  const manualBar=await headRead();
  await setType('板幅');
  const autoBar=await headRead();
  rec('手入力だけの項目でも同じ位置にバッジが出る（§9.210 ③）',
      manualBar.帯が見える===true&&manualBar.モード==='手動'
      &&autoBar.モード==='自動'&&manualBar.帯の左===autoBar.帯の左,
      JSON.stringify({手動:manualBar.モード,自動:autoBar.モード,
        左:[manualBar.帯の左,autoBar.帯の左]}));
  /* 公差の**値**を言う場所は1つだけ（§9.129）。以前は「見出しのピル」と
     「内訳の3行帯（`#toleranceFacts`）」の2つがあり、`repaint()`が帯を
     無条件に描き戻すので見出しが2行になっていた（§9.234 ③）。帯は器ごと
     廃止し、値はピル1つが言う。
     **図（数直線の隣）は数に入れない**——あちらは「いま公差のどのへんか」で、
     ピルの「範囲はいくつか」とは別の問いに答える（§9.140）。 */
  const tolWhere=await page.evaluate(()=>{
   const vis=el=>!!el&&el.getBoundingClientRect().height>0&&(el.textContent||'').trim()!=='';
   return{facts:!!document.getElementById('toleranceFacts'),
          summary:vis(document.getElementById('toleranceSummary')),
          side:vis(document.querySelector('.compact-tolerance-side'))};
  });
  rec('公差の内訳の3行帯は廃止した（§9.234 ③）',tolWhere.facts===false,JSON.stringify(tolWhere));
  rec('公差の値を言う場所は1つだけ（§9.129）',
      [tolWhere.facts,tolWhere.summary].filter(Boolean).length<=1,
      JSON.stringify(tolWhere));

  /* ---- 条が入りきらないときだけ縮める（§9.209 ③） ----
     **足りないときだけ**縮めること。入っているのに縮めると、8条のロットで
     1行が19pxになって狙って押せなくなる（§9.146で一度そうなっている）。 */
  const fitOff=await page.evaluate(()=>{
   const t=document.querySelector('.measure-matrix');
   return{fitted:t.classList.contains('mx-fitted'),
          行:Math.round(t.tBodies[0].rows[0].getBoundingClientRect().height)};
  });
  rec('入りきっているときは縮めない',fitOff.fitted===false,JSON.stringify(fitOff));
  const before=await page.viewportSize();
  await page.setViewportSize({width:before.width,height:900});
  await go('1');
  await page.evaluate(()=>{const h=document.getElementById('horizontalCount');
    h.value='40';h.dispatchEvent(new Event('change',{bubbles:true}))});
  await go('2');
  await page.evaluate(()=>new Promise(r=>setTimeout(r,900)));
  const fitOn=await page.evaluate(()=>{
   const body=document.querySelector('#measurementGrid .matrix-body');
   const t=document.querySelector('.measure-matrix');
   return{fitted:t.classList.contains('mx-fitted'),
     行:Math.round(t.tBodies[0].rows[0].getBoundingClientRect().height),
     行数:t.tBodies[0].rows.length,
     縦スクロール:body.scrollHeight>body.clientHeight+1};
  });
  rec('40条でも縦スクロールを出さずに全部出す（§9.209 ③）',
      fitOn.行数===40&&fitOn.fitted===true&&fitOn.縦スクロール===false,JSON.stringify(fitOn));
  rec('縮めても読める大きさ（下限を割ったら諦めてスクロール）',
      fitOn.行>=15,`${fitOn.行}px`);
  /* ---- 26条以上は「空いた縦 ÷ 条数」を行の高さにする（§9.210 ②、利用者の指示） ----
     以前は25条までの`mx-roomy`（30px固定）から26条で`mx-dense`（器いっぱいへ
     引き伸ばす）へ切り替わり、**入力欄だけが自分の高さへ落ちて一気に小さく**
     見えていた。25条と26条を並べて、**段差が無いこと**と**割り当てが
     「空いた高さ÷条数」になっていること**を見る。 */
  const rowsAt=async n=>{
   await go('1');
   await page.evaluate(v=>{const h=document.getElementById('horizontalCount');
     h.value=String(v);h.dispatchEvent(new Event('change',{bubbles:true}))},n);
   await go('2');
   await page.evaluate(()=>new Promise(r=>setTimeout(r,700)));
   return page.evaluate(()=>{
    const body=document.querySelector('#measurementGrid .matrix-body');
    const t=document.querySelector('.measure-matrix');
    const head=t.tHead.rows[0].getBoundingClientRect().height;
    const row=t.tBodies[0].rows[0];
    const inp=row.querySelector('input');
    return{行数:t.tBodies[0].rows.length,
      行:Math.round(row.getBoundingClientRect().height),
      欄:inp?Math.round(inp.getBoundingClientRect().height):0,
      割り当て:Math.round((body.clientHeight-head)/t.tBodies[0].rows.length),
      縦スクロール:body.scrollHeight>body.clientHeight+1};
   });
  };
  const r25=await rowsAt(25),r26=await rowsAt(26);
  rec('26条は空いた縦を条数で割った高さを使う（§9.210 ②）',
      r26.行数===26&&Math.abs(r26.行-Math.min(36,r26.割り当て))<=2&&r26.縦スクロール===false,
      JSON.stringify(r26));
  rec('25条→26条で一気に小さくならない（§9.210 ②）',
      Math.abs(r25.行-r26.行)<=6,JSON.stringify({'25条':r25.行,'26条':r26.行}));
  rec('入力欄も行と同じ高さ（欄だけ縮まない）',
      Math.abs(r26.欄-r26.行)<=4,JSON.stringify(r26));
  /* ---- 丈は横へ詰めるが、**丈5以上は諦めてスクロール**（§9.209 ⑤） ----
     利用者の指示。細かくしすぎると数字が読めなくなるので、そこで打ち切る。 */
  await go('1');
  await page.evaluate(()=>{const h=document.getElementById('horizontalCount');
    h.value='2';h.dispatchEvent(new Event('change',{bubbles:true}));
    const v=document.getElementById('verticalCount');
    v.value='8';v.dispatchEvent(new Event('change',{bubbles:true}))});
  await go('2');
  await page.evaluate(()=>new Promise(r=>setTimeout(r,700)));
  const manySlots=await page.evaluate(()=>{
   const t=document.querySelector('.measure-matrix');
   return{丈の列:Number(t.style.getPropertyValue('--mx-cols')),
          列幅を詰めた:!!t.style.getPropertyValue('--mx-colw')};
  });
  rec('丈5以上は横に詰めない（諦めてスクロール・§9.209 ⑤）',
      manySlots.丈の列>5&&manySlots.列幅を詰めた===false,JSON.stringify(manySlots));
  await go('1');
  await page.evaluate(()=>{const h=document.getElementById('horizontalCount');
    h.value='1';h.dispatchEvent(new Event('change',{bubbles:true}));
    const v=document.getElementById('verticalCount');
    v.value='1';v.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.setViewportSize(before);
  await go('2');

  /* ---- 入力内容のボタン群は左右の余白を同じにする（§9.209 ⑥） ---- */
  const chipBox=await page.evaluate(()=>{
   const card=document.getElementById('measureTypeGroup');
   const chips=card.querySelector('.type-chips');
   const c=card.getBoundingClientRect(),k=chips.getBoundingClientRect();
   return{左:Math.round(k.left-c.left),右:Math.round(c.right-k.right)};
  });
  rec('入力内容のボタン群の左右の余白が同じ（§9.209 ⑥）',
      Math.abs(chipBox.左-chipBox.右)<=1,JSON.stringify(chipBox));
  await go('3');
  rec('③の空きを記録した',true,JSON.stringify(e3));
  /* ---- カードの整列（§9.135 可能な限り粗いグリッド） ----
     **そろって見えるかは「左端の候補が何通りあるか」で決まる。** 外側は
     横4×縦3なので、カードの左端は4通り・上端は3通りに収まるはず。増えて
     いたら、グリッドの外で場所を決めたカードがある。 */
  for(const st of ['1','2','3']){
   await go(st);
   const g=await page.evaluate(()=>{
    const body=document.querySelector('.measure-body');
    const br=body.getBoundingClientRect();
    const cells=[...body.children].filter(e=>e.offsetParent!==null&&e.getBoundingClientRect().width>1);
    const R=n=>Math.round(n);
    return {左端:[...new Set(cells.map(e=>R(e.getBoundingClientRect().left-br.left)))].sort((a,b)=>a-b),
            上端:[...new Set(cells.map(e=>R(e.getBoundingClientRect().top-br.top)))].sort((a,b)=>a-b),
            枚数:cells.length};
   });
   const m=st==='1'?'①':st==='2'?'②':'③';
   rec(`${m}カードの左端が4通り以内`,g.左端.length<=4,JSON.stringify(g));
   rec(`${m}カードの上端が3通り以内`,g.上端.length<=3,JSON.stringify(g));
  }
  /* ============================================================
     §9.159 v2.56.0の確認結果（利用者の指摘）
     ============================================================ */
  /* ---- 基本情報「分割ロット」は重複を落として番号順（§9.159） ----
     材料の`splitGroups`は「連続した区間」なので、条を並べ替えて同じロットが
     離れると`A・B・A`と2度出ていた（実機で「N526C52・N526C53・N526C51・
     N526C53」）。**重複を注ぎ込んで確かめること**——検証用データは重なって
     いないので、注がずに見ると直す前でも通る。 */
  await go('1');
  const split行=await page.evaluate(()=>{
   const bk=JSON.parse(JSON.stringify(S.measure.settings.splitGroups||[]));
   const one=(S.measure.settings.splitGroups||[])[0]||{lot:'X1',count:1};
   const two=(S.measure.settings.splitGroups||[])[1]||{lot:'X2',count:1};
   /* B → A → B の順（重複あり・番号順でもない）を注ぎ込む */
   S.measure.settings.splitGroups=[{...two},{...one},{...two}];
   if(typeof refreshSplitStatusPanel==='function')refreshSplitStatusPanel();
   const el=document.getElementById('basicSplit');
   const out={文:(el.textContent||'').replace(/\s+/g,' ').trim(),隠:!!el.hidden,
     並び:[...el.querySelectorAll('output')].map(o=>o.textContent.trim())};
   S.measure.settings.splitGroups=bk;
   if(typeof refreshSplitStatusPanel==='function')refreshSplitStatusPanel();
   return out;
  });
  {
   const list=(split行.並び[0]||'').split('・').filter(Boolean);
   rec('分割ロットに同じ番号を2度出さない',
    list.length>0&&new Set(list).size===list.length,JSON.stringify(split行));
   rec('分割ロットはロット番号の順に並べる',
    list.join('・')===[...list].sort().join('・'),JSON.stringify(split行.並び));
   rec('子ロット数は重複を数えない',split行.並び[1]===String(new Set(list).size),
    JSON.stringify(split行.並び));
  }

  /* ---- 基本情報の詳細: ラベル列は1種類・値が切れない（§9.159） ---- */
  const 詳細=await page.evaluate(async()=>{
   const btn=document.getElementById('basicMore'),dt=document.getElementById('basicDetail');
   if(dt.hidden)btn.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const R=e=>e.getBoundingClientRect();
   /* 見るのは**ラベルを列で持つ行**だけ。常時の3行（ロット№・用途名・
      材調質/製造寸法）は`.info-inline`で「ラベル 値」を横に流す作りなので、
      ラベル幅は中身なりでよい（列としてそろえる対象ではない）。 */
   const rows=[...document.querySelectorAll('#basicInfo .field:not(.info-inline)')]
     .filter(f=>R(f).height>0&&f.querySelector('label')&&f.querySelector('output'));
   const out=rows.map(f=>{
    const l=f.querySelector('label'),o=f.querySelector('output');
    return{名:l.textContent.trim(),ラベル幅:Math.round(R(l).width),
      ラベル切れ:l.scrollWidth-l.clientWidth,値切れ:o.scrollWidth-o.clientWidth,
      値幅:Math.round(R(o).width),全幅:f.classList.contains('full')};
   });
   const res={列の種類:[...new Set(out.map(x=>x.ラベル幅))],
     ラベルが切れた:out.filter(x=>x.ラベル切れ>1).map(x=>x.名),
     識別と製品の値幅:out.filter(x=>['鋳造No.','オーダーNo.','取引先','納入先'].includes(x.名))
       .map(x=>x.値幅)};
   if(!dt.hidden)btn.click();
   return res;
  });
  rec('基本情報のラベル列は1種類（詳細を開いても値の左端がずれない）',
   詳細.列の種類.length===1,JSON.stringify(詳細.列の種類));
  rec('ラベルが省略記号で切れない',詳細.ラベルが切れた.length===0,
   詳細.ラベルが切れた.join('/'));
  /* 2列に割ると値へ渡せるのは94px前後。全幅なら280px前後になる。 */
  rec('識別番号・製品の値は全幅を使う（会社名が入る）',
   詳細.識別と製品の値幅.length>0&&詳細.識別と製品の値幅.every(w=>w>200),
   JSON.stringify(詳細.識別と製品の値幅));

  /* ---- 詳細を開いても品質情報が読める（§9.159） ----
     以前は`flex:1 1 auto`で**縮む側**だったため、詳細を開くと高さ9pxまで
     潰れ、潰れたぶんペインのスクロール量も増えないので下まで送っても
     出てこなかった。 */
  const 品質=await page.evaluate(async()=>{
   const ta=document.getElementById('qualityInfo'),bk=ta.value;
   ta.value='異常あり\n'.repeat(6);
   const btn=document.getElementById('basicMore'),dt=document.getElementById('basicDetail');
   if(dt.hidden)btn.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const lp=document.querySelector('.left-pane'),qi=document.querySelector('.quality-info-block');
   lp.scrollTop=lp.scrollHeight;
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const R=e=>e.getBoundingClientRect(),r=R(qi),p=R(lp);
   const res={高さ:Math.round(r.height),
     下まで送れば全部見える:r.top>=p.top-1&&r.bottom<=p.bottom+1,
     ころがし:Math.max(0,lp.scrollHeight-lp.clientHeight)};
   if(!dt.hidden)btn.click();
   ta.value=bk;lp.scrollTop=0;
   return res;
  });
  rec('詳細を開いても品質情報が潰れない',品質.高さ>40,JSON.stringify(品質));
  rec('詳細を開いたら品質情報までスクロールで届く',品質.下まで送れば全部見える,
   JSON.stringify(品質));

  /* ---- ②入力内容: 題の意匠・器の内側に収まる（§9.159） ---- */
  await go('2');
  const 入力内容=await page.evaluate(()=>{
   const R=e=>e.getBoundingClientRect();
   const g=document.getElementById('measureTypeGroup'),cp=document.querySelector('.center-pane');
   const gs=getComputedStyle(g),cs=getComputedStyle(cp),rc=R(cp);
   const 題=document.querySelector('.measure-body .card-title');
   const ts=題?getComputedStyle(題):null;
   const box=document.getElementById('measureTypeChips');
   const chips=[...box.querySelectorAll('.type-chip')];
   const 内側右=rc.right-parseFloat(cs.paddingRight);
   const はみ出し=chips.length?Math.max(...chips.map(e=>{
    const s=getComputedStyle(e),r=R(e);
    const o=(s.outlineStyle&&s.outlineStyle!=='none')
      ?parseFloat(s.outlineWidth||0)+parseFloat(s.outlineOffset||0):0;
    return r.right+o-内側右;
   })):0;
   return{色:gs.color,大:gs.fontSize,太:gs.fontWeight,
     題の色:ts?ts.color:'',題の大:ts?ts.fontSize:'',
     はみ出し:Math.round(はみ出し),
     幅:Math.round(R(box).width),器の幅:Math.round(rc.width),
     現在の外枠:(()=>{const e=box.querySelector('.is-current');
       if(!e)return '';const s=getComputedStyle(e);
       return s.outlineStyle==='none'?'':s.outlineWidth})()};
  });
  rec('「入力内容」はカードの題と同じ意匠',
   入力内容.色===入力内容.題の色&&入力内容.大===入力内容.題の大&&Number(入力内容.太)>=700,
   JSON.stringify(入力内容));
  rec('入力内容のボタンがカードからはみ出さない（選択中の枠も含めて）',
   入力内容.はみ出し<=0,JSON.stringify(入力内容));
  rec('選択中の印は外枠で描かない',入力内容.現在の外枠===''||parseFloat(入力内容.現在の外枠)===0,
   JSON.stringify(入力内容.現在の外枠));
  rec('入力内容のボタンは器いっぱいに伸びない',
   入力内容.幅<入力内容.器の幅-40,`${入力内容.幅}px / 器${入力内容.器の幅}px`);

  /* ---- ②のカードの左右の余白は同じ（§9.219 ①） ----
     利用者の報告「条の入力…収まり切れておらず、はみ出している」。
     `.measure-shell.mstep-2 .center-pane`が長く`padding-right:0`を持って
     おり（②の中身が`.type-chips`だけで、器いっぱいに伸びるものが無かった
     ころの名残り）、§9.218 ②で操業データの欄が`data-opfill`＝器いっぱいに
     なった結果、**右端の欄だけがカードの枠に接していた**（実測 左13px／
     右1px）。角の丸みとフォーカスの輪が右側だけ切られる。
     **溢れ（scrollWidth-clientWidth）では捕まらない**——トラックは
     `minmax(0,1fr)`なので本当の横溢れは原理的に起きない。カードの内寸と
     欄の左右の位置を突き合わせること。 */
  const 条の入力=await page.evaluate(()=>{
   const h=[...document.querySelectorAll('.selectors>.prep-fold')]
     .find(x=>x.getAttribute('aria-expanded')==='false');
   if(h)h.click();
   const pane=document.querySelector('.center-pane'),cs=getComputedStyle(pane);
   const pr=pane.getBoundingClientRect();
   const inL=pr.left+parseFloat(cs.borderLeftWidth)+parseFloat(cs.paddingLeft);
   const inR=pr.right-parseFloat(cs.borderRightWidth)-parseFloat(cs.paddingRight);
   const kids=[...document.querySelectorAll('.selectors>[data-opplace="入力内容"]')]
     .filter(k=>getComputedStyle(k).display!=='none');
   if(!kids.length)return {件数:0};
   const L=Math.min(...kids.map(k=>k.getBoundingClientRect().left));
   const R=Math.max(...kids.map(k=>k.getBoundingClientRect().right));
   return {件数:kids.length,
     padL:Math.round(parseFloat(cs.paddingLeft)),
     padR:Math.round(parseFloat(cs.paddingRight)),
     左:Math.round((L-inL)*10)/10,右:Math.round((inR-R)*10)/10};
  });
  rec('②の入力内容カードは左右の余白が同じ（片側だけ0にしない）',
   条の入力.件数>0&&条の入力.padL===条の入力.padR&&条の入力.padL>0,
   JSON.stringify(条の入力));
  rec('②の操業データの欄がカードの内側に収まる',
   条の入力.件数>0&&条の入力.左>=-1&&条の入力.右>=-1,
   JSON.stringify(条の入力));

  /* ---- ②判定公差の切り替えは畳んでおく（§9.159） ----
     **選べる状態を作ってから見ること**——検証用データにはオーダー公差が
     1件も無く、そのままだと欄ごと非表示なので「畳んでいる」を見ても
     直す前でも通ってしまう。 */
  const 公差切替=await page.evaluate(async()=>{
   const src=S.measure.source,bk={};
   ['板幅公差_製造_ﾌﾟﾗｽ','板幅公差_製造_ﾏｲﾅｽ','板幅公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ','板幅公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ']
     .forEach(k=>{bk[k]=src[k]});
   Object.assign(src,{'板幅公差_製造_ﾌﾟﾗｽ':0.5,'板幅公差_製造_ﾏｲﾅｽ':0.5,
     '板幅公差_ｵｰﾀﾞｰ_ﾌﾟﾗｽ':0.8,'板幅公差_ｵｰﾀﾞｰ_ﾏｲﾅｽ':0.8});
   const mt=document.getElementById('measureType'),bkType=mt.value;
   mt.value='板幅';mt.dispatchEvent(new Event('change',{bubbles:true}));
   if(typeof WL.measureView.configureToleranceSelector==='function')WL.measureView.configureToleranceSelector();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const box=document.querySelector('.tolerance-source-control'),
     fold=document.getElementById('tolSourceFold'),
     pick=document.getElementById('toleranceSourcePick');
   const R=e=>e.getBoundingClientRect();
   /* **無ければ「畳めていない」と答える。** 例外で落とすと、畳む仕組みごと
      消したときにこの一連が丸ごと動かず、何も確かめられない。 */
   if(!box||!fold||!pick)return{選べる:!!box&&!box.hidden,入口が出ている:false,
     既定で畳んでいる:false,押すと出る:false,もう一度押すと畳む:false,
     欠け:[!box&&'欄',!fold&&'入口',!pick&&'選択欄'].filter(Boolean).join('/')};
   const out={選べる:!box.hidden,入口が出ている:R(fold).height>0,
     既定で畳んでいる:!!pick.hidden&&R(pick).height===0};
   fold.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   out.押すと出る=!pick.hidden&&R(pick).height>0;
   fold.click();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   out.もう一度押すと畳む=!!pick.hidden;
   Object.keys(bk).forEach(k=>{if(bk[k]===undefined)delete src[k];else src[k]=bk[k]});
   mt.value=bkType;mt.dispatchEvent(new Event('change',{bubbles:true}));
   if(typeof WL.measureView.configureToleranceSelector==='function')WL.measureView.configureToleranceSelector();
   return out;
  });
  rec('判定公差の切り替えは選べるときだけ出す',公差切替.選べる&&公差切替.入口が出ている,
   JSON.stringify(公差切替));
  rec('判定公差の選択欄は既定で畳んである',公差切替.既定で畳んでいる,JSON.stringify(公差切替));
  rec('入口を押せば選択欄が出て、もう一度押すと畳む',
   公差切替.押すと出る&&公差切替.もう一度押すと畳む,JSON.stringify(公差切替));

  /* ================= 操業データ（§9.215、利用者の指示） ================
     「条の設計 — 子ロットの内訳の部分には、『操業データ』という項目にして、
      『入力の準備』のエリアとカード統合(2×3にする)。名前は『操業データ』に
      変更する。必要なデータを追加しすべて記録できるようにします。」
     項目は**設備ごとのマスタ**が決めるので、画面側に項目名は書かれていない。
     ここでは「マスタの定義どおりの入力欄が出て、打った値がレコードへ入る」
     ことを見る。 */
  await go('1');
  /* 入力欄は**準備の`.selectors`と同じ器**に並ぶ（§9.216 ②⑤）。以前は
     `#opData`という別のカードだったので、名前・値・注記がそれぞれ違う
     大きさになっていた。 */
  await page.waitForFunction(()=>document.querySelectorAll('.selectors label[data-opfield]').length>0,
                             null,{timeout:20000}).catch(()=>{});
  const op=await page.evaluate(()=>{
   const card=document.querySelector('.center-pane');
   const host=document.querySelector('.selectors');
   const fold=document.getElementById('splitDetailFold');
   const body=fold&&fold.querySelector('.split-detail-body');
   const rect=el=>el?el.getBoundingClientRect():null;
   const r=rect(card);
   return{
    題:(card&&card.querySelector('[data-steptitle="1"]')||{}).textContent||'',
    欄:[...host.querySelectorAll('label[data-opfield]')].map(l=>l.dataset.opfield),
    群:[...host.querySelectorAll('.prep-head[data-opgroup]')].map(g=>g.dataset.opgroup),
    /* 子ロットの内訳は**条の設計カードの中**へ移した。既定は畳む。 */
    内訳が条の設計の中:!!(fold&&fold.closest('#splitCard')),
    内訳は畳んである:!!(fold&&!fold.open&&body&&body.getBoundingClientRect().height===0),
    /* 型ごとの入れ物。選択＝select、数値＝type=text（`.5`が消えないように）。 */
    選択の型:(()=>{const el=host.querySelector('[data-op="運転方式"]');return el?el.tagName:null})(),
    数値の型:(()=>{const el=host.querySelector('[data-op="スリット 刃径"]');
      return el?el.tagName+'/'+el.type+'/'+el.inputMode:null})(),
    選択肢:(()=>{const el=host.querySelector('[data-op="運転方式"]');
      return el?[...el.options].map(o=>o.value):null})(),
    カード幅:r?Math.round(r.width):0,
    画面幅:Math.round(document.querySelector('.measure-body').getBoundingClientRect().width),
   };
  });
  rec('カードの名前が「操業データ」になっている',op.題==='操業データ',op.題);
  rec('子ロットの内訳は条の設計カードの中へ移した',op.内訳が条の設計の中===true,
      String(op.内訳が条の設計の中));
  rec('子ロットの内訳は既定で畳んである（主役は条の割り付け）',
      op.内訳は畳んである===true,String(op.内訳は畳んである));
  /* **カードは下段いっぱい（横3マス）**。器4列のうち3列ぶんの幅がある。 */
  rec('操業データのカードは下段を横いっぱいに使う',
      op.カード幅>op.画面幅*0.6,`${op.カード幅} / ${op.画面幅}`);
  rec('マスタの項目が入力欄として出る',
      op.欄.includes('ラフレベラー 入')&&op.欄.includes('スリット 実ラップ'),
      `${op.欄.length}欄`);
  rec('群ごとにまとまって出る',
      op.群.includes('巻取り')&&op.群.includes('スリット'),JSON.stringify(op.群));
  rec('選択の型は選択欄で出す',op.選択の型==='SELECT',String(op.選択の型));
  rec('選択肢はマスタから当てる',
      JSON.stringify(op.選択肢)===JSON.stringify(['','D','SD']),JSON.stringify(op.選択肢));
  /* **`type=number`にしない**（§9.208 ③）——`.5`のような途中の形が黙って消える。 */
  rec('数値は文字の欄で受ける（打った値が黙って消えない）',
      op.数値の型==='INPUT/text/decimal',String(op.数値の型));

  /* 打った値が**その場でレコードへ入る**（§9.208 ②。保存を待たない）。 */
  const typed=await page.evaluate(async()=>{
   const set=async(k,v)=>{
    const el=document.querySelector(`.selectors [data-op="${CSS.escape(k)}"]`);
    if(!el)return null;
    el.focus();el.value=v;
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    el.dispatchEvent(new Event('blur',{bubbles:true}));
    await new Promise(r=>setTimeout(r,60));
    return el.value;
   };
   const 刃径=await set('スリット 刃径','.5');
   /* **直したことの案内はその欄を離れた直後に読む。** 次の欄へ移ると本物の
      blurがもう一度走り、そのときは直すところが無いので案内は消える
      （それが正しい振る舞い——古い注意書きを残さない）。 */
   const note=document.querySelector('[data-opfield="スリット 刃径"] .opf-note');
   const 直した=note&&!note.hidden?note.textContent.trim():'';
   const 実ラップ=await set('スリット 実ラップ','-1.25');
   const 速度=await set('その他 速度','-30');
   const 運転=await set('運転方式','SD');
   return{刃径,実ラップ,速度,運転,
     控え:JSON.parse(JSON.stringify((S.measure.settings||{}).opData||{})),
     直した};
  });
  rec('「.5」と打っても消えず小数桁へそろう',typed.刃径==='0.5',String(typed.刃径));
  rec('マイナスが入る型（実ラップ）はマイナスのまま',typed.実ラップ==='-1.3'||typed.実ラップ==='-1.2'||typed.実ラップ==='-1.25',
      String(typed.実ラップ));
  rec('正の整数の型ではマイナスを受け付けない',typed.速度==='30',String(typed.速度));
  rec('打った値は保存を待たずにレコードへ入る',
      typed.控え['スリット 刃径']==='0.5'&&typed.控え['運転方式']==='SD',
      JSON.stringify(typed.控え));
  /* **直したことは文字で言う**（黙って値が変わると打ち間違いに気づけない）。 */
  rec('桁をそろえたら、そう書く',/桁|そろえ/.test(typed.直した||''),typed.直した||'（何も出ていない）');

  /* 選択肢に無い記録も残す（§9.203と同じ罠。`select.value`へ無い値を入れると空になる）。 */
  const kept=await page.evaluate(async()=>{
   S.measure.settings.opData['運転方式']='むかしの値';
   WL.opData.apply();
   await new Promise(r=>setTimeout(r,60));
   const el=document.querySelector('.selectors [data-op="運転方式"]');
   return {値:el.value,選択肢:[...el.options].map(o=>o.value)};
  });
  rec('選択肢に無い記録も消さずに出す',kept.値==='むかしの値',JSON.stringify(kept));
  await page.evaluate(()=>{delete S.measure.settings.opData['運転方式'];WL.opData.apply()});

  /* ================= ③測定データ分析（§9.214、利用者の指示） ============
     「今カード内に出ている表は解体。中身のデータは表示は必要なものに絞り、
      表示内容や削ったそのエリアも使って、ロット単位で、板厚のMIN,MAX、
      板幅のMIN,MAXを表示できるようにしてください。」
     **値を自分で注ぎ込んでから見る**——検証用データには測定値が入って
     いないので、そのまま見ると「まだ測っていません」しか出ず、
     MIN/MAXの道を一度も通らない。 */
  await go('3');
  const an=await page.evaluate(async()=>{
   const m=S.measure;
   /* **先に空にする**——ここまでのテストが打ち込んだ値が残っており、
      そのまま足すとMIN/MAXがその値に引きずられる（実際に49.50が出た）。 */
   ['thickness','width','burr','lateral','telescope','offset'].forEach(k=>{
    (m.measurements[k]||[]).forEach(line=>{if(Array.isArray(line))line.fill('')});
   });
   /* 板厚は丈位置ごとに3点、板幅は丈位置ごとに条ごと。 */
   m.measurements.thickness[0][0]='1.234';
   m.measurements.thickness[0][1]='1.200';
   m.measurements.thickness[0][2]='1.260';
   m.measurements.width[0][0]='500.10';
   m.measurements.width[0][1]='499.80';
   m.measurements.width[1][0]='500.40';
   /* そのほかは1項目だけ入れる（測った項目とまだの項目が並ぶことを見る）。 */
   m.measurements.burr[0][0]='0.030';
   /* 子ロットごとの板幅（分割ありのときだけ出る）。 */
   m.splitSequence=['L0001','L0002'];
   WL.measureInput.renderStats();
   await new Promise(r=>setTimeout(r,200));
   const body=document.getElementById('stats');
   const cards=[...body.querySelectorAll('.an-card')].map(c=>({
     名:(c.querySelector('.an-card-head b')||{}).textContent||'',
     数:(c.querySelector('.an-card-head small')||{}).textContent||'',
     値:[...c.querySelectorAll('.an-slot')].map(x=>
        ((x.querySelector('i')||{}).textContent||'')+':'+((x.querySelector('b')||{}).textContent||'')),
   }));
   return{
    表がもう無い:!body.querySelector('table')&&!document.querySelector('.analysis table'),
    平均や3シグマを出さない:!/AVE|3σ/.test(body.textContent||''),
    カード:cards,
    そのほか:[...body.querySelectorAll('.an-sub-list li')].map(li=>
      ((li.querySelector('.an-name')||{}).textContent||'')),
    /* 重要度は低いので**畳んでおく**（§9.216 ⑥、利用者の指示）。
       畳んだままでも要約で件数と名前が読める（§9.125）。 */
    そのほかは畳んである:(()=>{const d=document.getElementById('anSubFold');return !!d&&!d.open})(),
    そのほかの要約:(document.querySelector('#anSubFold .an-sub-head small')||{}).textContent||'',
    測っていない行:[...body.querySelectorAll('.an-sub-list li.is-empty .an-name')]
      .map(x=>x.textContent||''),
    子ロット:[...body.querySelectorAll('.an-lot-list li')].map(li=>({
      名:(li.querySelector('.an-name')||{}).textContent||'',
      値:(li.querySelector('.an-val')||{}).textContent||''})),
    板厚は子ロット別に出せないと書く:/板厚は.*3点/.test(body.textContent||''),
   };
  });
  rec('表は解体した（MIN/AVE/MAX/3σ/N数の30マスをやめる）',
      an.表がもう無い===true&&an.平均や3シグマを出さない===true,
      JSON.stringify({表:an.表がもう無い,平均:an.平均や3シグマを出さない}));
  const th=an.カード.find(c=>c.名==='板厚'),wd=an.カード.find(c=>c.名==='板幅');
  rec('板厚のMIN/MAXを出す',
      !!th&&th.値.join('/')==='MIN:1.200/MAX:1.260',JSON.stringify(th));
  rec('板幅のMIN/MAXを出す',
      !!wd&&wd.値.join('/')==='MIN:499.80/MAX:500.40',JSON.stringify(wd));
  rec('何点で出した数字かを添える（1点と80点では当たる見込みが違う）',
      !!th&&/3点/.test(th.数)&&!!wd&&/3点/.test(wd.数),
      JSON.stringify({板厚:th&&th.数,板幅:wd&&wd.数}));
  /* **他の測定項目もカードに収まる範囲で出す**（§9.216 ⑥、利用者の指示）。
     測っていない項目も行として出す——出さないと「測っていない」のか
     「そもそも項目が無い」のかが読めない。 */
  rec('そのほかの測定項目を全部出す（測っていないものも行として）',
      an.そのほか.length===5&&an.そのほか.includes('バリ')&&an.そのほか.includes('フラットネス'),
      JSON.stringify(an.そのほか));
  rec('測っていない項目はそう書く（黙って消さない）',
      an.測っていない行.length===4&&!an.測っていない行.includes('バリ'),
      JSON.stringify(an.測っていない行));
  rec('そのほかは畳んである（重要度は低い）',an.そのほかは畳んである===true,
      String(an.そのほかは畳んである));
  rec('畳んだままでも件数と名前が読める',
      /測った 1 \/ 5 項目/.test(an.そのほかの要約)&&/バリ/.test(an.そのほかの要約),
      an.そのほかの要約);
  rec('子ロットごとの板幅を出す（条は子ロットに属する）',
      an.子ロット.length===2&&/L0001/.test(an.子ロット[0].名)
      &&/500\.10/.test(an.子ロット[0].値),JSON.stringify(an.子ロット));
  rec('板厚を子ロット別に出せない理由を書く（黙って空欄にしない）',
      an.板厚は子ロット別に出せないと書く===true,String(an.板厚は子ロット別に出せないと書く));

  /* ==========================================================
     §9.221 ⑧ フラットネスも丈を跨いで条を指定できる
     ----------------------------------------------------------
     利用者の指摘「入力内容のフラットネスについて丈を跨いでの直接条指定が
     できません。他の項目は直接丈を跨いだ条指定ができるので同じように
     修正してほしいです。強調表示も正しい挙動に合わせて確認してください」。
     `bindFlatnessInputs()`が`onclick`を上書きして**条だけ**を合わせて
     いたため、別の丈の枠を押しても印がそこへ来なかった。
     **確かめるときは丈が2本以上あること**——1本しか無いと「跨ぐ」道を
     一度も通らずに通ってしまう。
     ========================================================== */
  await go('2');
  const flat=await page.evaluate(async()=>{
   const sel=document.getElementById('measureType');
   const lp=document.getElementById('lengthPos');
   if(!sel||!lp||lp.options.length<2)return {丈が1本:true};
   sel.value='フラットネス';sel.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,400));
   lp.selectedIndex=0;lp.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,400));
   const before=lp.selectedIndex;
   /* **枠は探して押す**（決め打ちにしない）。条数はロット由来なので、
      `[data-j="1"]`が必ず在るとは限らない——無ければ「枠が無い」で
      落ちるだけで、跨ぐ道を一度も通らない。いま出ている丈と違う枠を
      探し、条は在るものの中でいちばん右を選ぶ。 */
   const cells=[...document.querySelectorAll('input[data-mkey="flatness"]')];
   const other=cells.filter(c=>Number(c.dataset.i)!==before);
   if(!other.length)return {枠が無い:true,前:before,枠の数:cells.length,
     丈:[...new Set(cells.map(c=>c.dataset.i))].join('/')};
   const wantI=Number(other[0].dataset.i);
   const row=other.filter(c=>Number(c.dataset.i)===wantI);
   const cell=row[row.length-1];
   cell.click();
   await new Promise(r=>setTimeout(r,500));
   const cur=document.querySelector('input[data-mkey="flatness"].current');
   return {前:before,後:document.getElementById('lengthPos').selectedIndex,
     押した丈:cell.dataset.i,押した条:cell.dataset.j,
     印の丈:cur&&cur.dataset.i,印の条:cur&&cur.dataset.j,
     /* **`window.S`で引かないこと**——`S`は`base.js`のトップレベルの
        `const`で`window`のプロパティにならない（§9.215と同じ罠）。
        `window.S&&…`と書くと常に`undefined`になり、印の条を一度も
        確かめないまま落ちる。 */
     条:(typeof S!=='undefined'&&S.measure&&S.measure.settings)?S.measure.settings.wStep:null};
  });
  if(flat.丈が1本||flat.枠が無い){
   rec('フラットネスで丈を跨いだ条指定ができる',false,
       '前提が揃っていない（丈が2本以上あり、2本目の枠が要る）: '+JSON.stringify(flat));
  }else{
   rec('フラットネスで丈を跨いだ条指定ができる（押した丈へ移る）',
       flat.前!==flat.後&&String(flat.後)===String(flat.押した丈),JSON.stringify(flat));
   /* **強調表示も押した枠へ来る**（印だけ元の丈に残ると、打った文字が
      別の丈へ入る）。 */
   rec('強調表示も押した枠に来る',
       flat.印の丈===flat.押した丈&&flat.印の条===flat.押した条
       &&Number(flat.条)===Number(flat.押した条),JSON.stringify(flat));
  }

  /* ==========================================================
     フラットネスの見出しも1行（§9.233 ④、利用者の指示）
     「入力内容のフラットネスを選んだときの右側のフラットネス入力欄の上部の
      表示やボタン類が2行になってしまっており、1行に収まるようにボタンや
      表示のコンパクト化アイコン化を検討し、他の入力項目と同じように1行で
      表示してください（できるだけ広い条数分の入力表示範囲を確保する必要が
      あるため）」
     **「行数」ではなく実寸で見る**——`.editor-head`は塊が折り返しても
     要素の数は変わらない。**他の項目（板幅）と突き合わせる**のが物差し。
     ========================================================== */
  const headOf=async t=>{
   await page.evaluate(v=>{const el=document.getElementById('measureType');
     if(el){el.value=v;el.dispatchEvent(new Event('change',{bubbles:true}))}},t);
   await idle();
   return page.evaluate(()=>{
    const h=document.querySelector('.editor-head');
    if(!h)return null;
    const r=h.getBoundingClientRect();
    const kids=[...h.children].filter(e=>e.getBoundingClientRect().height>0);
    const tops=[...new Set(kids.map(e=>Math.round(e.getBoundingClientRect().top)))];
    return {高さ:Math.round(r.height),段:tops.length,
      幅:Math.round(r.width),中身:h.scrollWidth,
      塊:kids.map(e=>e.className).slice(0,8)};
   });
  };
  const hFlat=await headOf('フラットネス');
  const hWidth=await headOf('板幅');
  rec('前提: 見出しの器がある（フラットネス・板幅とも）',
      !!(hFlat&&hWidth),JSON.stringify({flat:hFlat,width:hWidth}));
  rec('フラットネスの見出しが板幅と同じ高さに収まる（§9.233 ④）',
      !!(hFlat&&hWidth&&hFlat.高さ<=hWidth.高さ+2),
      JSON.stringify({フラットネス:hFlat&&hFlat.高さ,板幅:hWidth&&hWidth.高さ}));
  rec('フラットネスの見出しが横に溢れない（§9.233 ④）',
      !!(hFlat&&hFlat.中身<=hFlat.幅+1),
      JSON.stringify(hFlat&&{幅:hFlat.幅,中身:hFlat.中身}));

  /* ==========================================================
     「母材・丈は手入力です」は入れる場所のすぐ上（§9.233 ③）
     「母材の時だけ、『母材・丈は手入力です』という表示が出ることにより、
      ロット情報が見切れているので、表示を出す位置を入力する部分に近い
      ところに出すなどの修正をお願いします」
     **ロット情報が切れていないこと**を実寸で見る（`scrollWidth`）。
     ========================================================== */
  await page.evaluate(()=>{const el=document.getElementById('measureType');
    if(el){el.value=WL.measureItem.MATERIAL;el.dispatchEvent(new Event('change',{bubbles:true}))}});
  await idle();
  const ctxBar=await page.evaluate(()=>{
   const cut=id=>{const e=document.getElementById(id);
     if(!e)return null;return Math.max(0,e.scrollWidth-e.clientWidth)};
   const n=document.getElementById('materialManualNote');
   const title=n&&n.closest('.mat-block-title');
   return {印:!!n,隠:n?n.hidden:null,文:(n&&n.textContent)||'',
     題の中:!!title,
     題からのはみ出し:(n&&title&&!n.hidden)?Math.round(Math.max(
       n.getBoundingClientRect().right-title.getBoundingClientRect().right,
       n.getBoundingClientRect().bottom-title.getBoundingClientRect().bottom)):null,
     切れ:{ロット:cut('mctxLot'),製品:cut('mctxProduct'),
           形:cut('mctxShape'),公差:cut('mctxTolerance')},
     /* 帯の一言（`#mstepNote`）は§9.234 ④で廃止した。 */
     段の一言:document.getElementById('mstepNote')?'(まだ在る)':''};
  });
  rec('母材のとき手入力の案内は母材の題の中に出る（§9.233 ③）',
      !!(ctxBar.印&&ctxBar.隠===false&&ctxBar.題の中&&/手入力/.test(ctxBar.文)),
      JSON.stringify(ctxBar));
  rec('案内が母材の題からはみ出さない（§9.233 ③）',
      ctxBar.題からのはみ出し!==null&&ctxBar.題からのはみ出し<=1,
      String(ctxBar.題からのはみ出し));
  rec('上部帯のロット情報が切れない（§9.233 ③）',
      Object.values(ctxBar.切れ).every(v=>v!==null&&v<=1),
      JSON.stringify(ctxBar.切れ));
  await page.evaluate(()=>{const el=document.getElementById('measureType');
    if(el){el.value='板幅';el.dispatchEvent(new Event('change',{bubbles:true}))}});
  await idle();
  rec('測定器を使う項目では案内を出さない（§9.233 ③）',
      await page.evaluate(()=>{const n=document.getElementById('materialManualNote');
        return !!n&&n.hidden===true}));

  await go('1');

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  await cleanup();
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  await cleanup();
 }
 /* 作ったレコードは端末内・共有の両方から消す。**画面のidと保存側の記録IDは
    違う**ので末尾一致で消す（§9.122）。落ちた側でも通る。 */
 async function cleanup(){
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof WL.records.reliableDelete==='function')await WL.records.reliableDelete(id).catch(()=>{});
   /* **消えるまで確かめる。** 共有(shareRecord)は画面を待たせずに送るので、
      1回消しただけだと**遅れて届いた登録が後から復活する**（通しで1回だけ
      test_scdrop が落ち、L0001に身に覚えのない実績が残っていた）。
      消す→数える→残っていたらもう一度、を数回まで繰り返す。 */
   if(id){
    for(let k=0;k<6;k++){
     const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
     const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
     if(!ids.length)break;
     await fetch('/api/measurement/backup/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
     await new Promise(r2=>setTimeout(r2,250));
    }
   }
   const m=document.querySelector('#measureModal');if(m)m.hidden=true;
  })}catch(e){}
  try{await setMode('edit')}catch(e){}
 }
}, {viewport:{width:1920,height:1080}});
