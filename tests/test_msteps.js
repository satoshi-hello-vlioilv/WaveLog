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
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const setMode=m=>fetch(API+'/api/access-mode',{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});

let b=null,page=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 page.on('dialog',d=>d.accept());

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
    理由:document.querySelector('#mstepNote')?.hidden?'':(document.querySelector('#mstepNote')?.textContent||'')};
 });
 const go=async s=>{await page.evaluate(v=>WL.measureSteps.go(v),s);await page.waitForTimeout(450)};

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
  await page.waitForTimeout(1200);

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
    丈が見える:document.getElementById('lengthPosGroup')?.getBoundingClientRect().height>0,
    丈の行数:lp?lp.size:0,丈の選択肢:lp?lp.options.length:0,
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
  rec('②に入力内容の一覧（9項目）が出る',items.一覧===9,JSON.stringify(items));
  rec('②では1回決めるだけの設定を出さない',items.ほかの設定===0,JSON.stringify(items));
  /* **丈位置は②に出す（§9.125）。** `PageUp/PageDown`で動かせるのに、
     以前はどの段にも出ておらず「いま何丈目か」は`#stepStatus`の文でしか
     分からなかった。高さは選択肢の数ぶん——7行固定だと空白が並ぶ。 */
  rec('②に丈位置が出る',items.丈が見える===true,JSON.stringify(items));
  rec('丈位置の高さは選択肢の数ぶん',items.丈の行数===Math.max(2,Math.min(7,items.丈の選択肢)),
      JSON.stringify(items));
  rec('一覧の各項目に残り件数が文字で付く',items.件数の文字===9,JSON.stringify(items));
  /* 測定表は本体のいちばん広いカード。骨子（§9.137）で`2×3`＝**本体の半分**
     と決めたので、しきい値も半分ちょうどで見る（以前は3列＝3/4だった）。
     丈位置×条の1つの表（§9.136）は最大10列×40行なので2マス幅で足りる。 */
  /* **カード間の余白を見込む**（§9.137の意匠）。本文は灰色の地で、カードは
     `--gap-section`(12px)ずつ離して置くので、2マスぶんのカードは
     「本体の半分 − 余白1つぶん」になる。生の半分と比べると必ず落ちる。 */
  rec('②の測定表が本体の半分を占める',m2.右.w>=Math.floor(m2.本体.w*0.5)-40,
      `測定=${m2.右.w} / 本体=${m2.本体.w}`);

  /* ---- 4b) 測定表は「使う条数ぶんだけ」描く（§9.124） ----
     以前は条数に関わらず 2列×20行＝40条を必ず描き、超えた行を灰色で残して
     いた。1条のロットでも39行の空欄が並ぶ。**探す対象を増やさない。**
     20条を超えたときだけ2列にする（縦に41行並べると画面から溢れる）。 */
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(500);
  const rowsFor=async n=>{
   await page.evaluate(v=>{const h=document.querySelector('#horizontalCount');
     h.value=String(v);h.dispatchEvent(new Event('change',{bubbles:true}))},n);
   await page.waitForTimeout(500);
   return page.evaluate(()=>({
    行:document.querySelectorAll('#measurementGrid .strip-row').length,
    列:document.querySelectorAll('#measurementGrid .strip-column').length,
    灰色の行:document.querySelectorAll('#measurementGrid .strip-row.inactive').length}));
  };
  const r1=await rowsFor(1),r6=await rowsFor(6),r24=await rowsFor(24),r40=await rowsFor(40);
  rec('1条なら1行しか描かない',r1.行===1&&r1.列===1,JSON.stringify(r1));
  rec('6条なら6行',r6.行===6&&r6.列===1,JSON.stringify(r6));
  rec('20条を超えたら2列にする',r24.行===24&&r24.列===2,JSON.stringify(r24));
  rec('40条でも数は合う',r40.行===40&&r40.列===2,JSON.stringify(r40));
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
   await page.waitForTimeout(500);
   return page.evaluate(()=>{
    const r=e=>e?e.getBoundingClientRect():null;
    const cols=[...document.querySelectorAll('#measurementGrid .compact-other .strip-column')];
    const body=document.querySelector('#measurementGrid .compact-other .compact-width-body');
    const tol=body&&body.querySelector('.compact-tolerance-side');
    const rows=[...document.querySelectorAll('#measurementGrid .compact-other .strip-row label')];
    const cr=cols.map(x=>r(x)),br=r(body),tr=r(tol);
    const lay=document.querySelector('#measurementGrid .compact-other .compact-strip-layout');
    const lr=r(lay);
    return {列:cols.length,
      /* **列の数だけでは足りない。** CSSが2列ぶんの場所を取ったままだと
         DOMは1つでも幅は半分になる（実際にそれを見逃した）。 */
      入力表の幅:cr.length?Math.round(cr[0].width):0,
      器の幅:lr?Math.round(lr.width):0,
      表の高さ:cr.length?Math.round(cr[0].height):0,
      最後の行の下端:rows.length?Math.round(r(rows[rows.length-1]).bottom):0,
      表の下端:cr.length?Math.round(cr[0].bottom):0,
      公差と表のすきま:(tr&&cr.length)?Math.round(cr[0].left-tr.right):null,
      器の右の余り:(br&&cr.length)?Math.round(br.right-cr[cr.length-1].right):null};
   });
  };
  const g8=await geom(8),g40=await geom(40);
  rec('20条までは1列',g8.列===1,JSON.stringify(g8));
  rec('1列のときは入力表が器の幅いっぱいを使う',
      g8.器の幅>0&&g8.入力表の幅>=g8.器の幅*0.9,JSON.stringify(g8));
  rec('20条を超えたら2列',g40.列===2,JSON.stringify(g40));
  /* 行の数だけ器を取る。最後の行の下と器の下がほぼ一致すること
     （20行固定のままなら、8条では12行ぶん＝300px以上の白が残る）。 */
  rec('使う行数ぶんの高さしか取らない',
      Math.abs(g8.表の下端-g8.最後の行の下端)<=8,JSON.stringify(g8));
  /* **一緒に読むものを引き離さない。** 公差数直線は縦向きなので、空いた
     幅を公差側へ回すと数直線と入力表のあいだに900pxの空白ができる。 */
  rec('公差と入力表が隣り合っている',g8.公差と表のすきま!==null&&g8.公差と表のすきま<40,
      JSON.stringify(g8));

  /* ---- 4d) 丈位置くらべ（§9.128） ----
     ②では**いま選んでいる丈位置しか出ない**ので、頭と尾を見比べるには
     丈を切り替えるしかなく、切り替えると今度はさっきの値が見えなかった。
     1列のときに余る右側へ、同じ項目の全丈位置を1枚で出す。
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
   renderMeasureGrid();
   return !!toleranceDetail('width',0,'板幅');
  });
  await page.waitForTimeout(500);
  rec('公差の材料を注ぎ込めた(丈位置くらべ)',lcSetup===true,String(lcSetup));
  const lc=()=>page.evaluate(()=>{
   const sec=document.querySelector('#measurementGrid .length-compare');
   if(!sec)return{出ている:false};
   const heads=[...sec.querySelectorAll('thead th')];
   const rows=[...sec.querySelectorAll('tbody tr')];
   const cellText=(r,c)=>rows[r]?.querySelectorAll('td')[c]?.textContent.trim()||'';
   return{
    出ている:true,
    見出し:heads.map(x=>x.textContent.trim()),
    行数:rows.length,
    いまの列:heads.findIndex(x=>x.classList.contains('is-current')),
    /* 出ていない丈の値がここには出ていること（これがこの表の存在理由）。 */
    他の丈の値:cellText(1,1),
    公差外の印:sec.querySelectorAll('td.is-ng').length,
    公差外の値:[...sec.querySelectorAll('td.is-ng')].map(x=>x.textContent.trim()),
    幅:Math.round(sec.getBoundingClientRect().width),
   };
  });
  const lc1=await lc();
  rec('②に丈位置くらべが出る',lc1.出ている===true&&lc1.幅>150,JSON.stringify(lc1));
  rec('列は「条」＋丈位置の数',lc1.見出し.join('/')==='条/1(頭)/1(尾)',JSON.stringify(lc1.見出し));
  rec('行は条数ぶん',lc1.行数===8,String(lc1.行数));
  /* **出ていない丈の値が見えること。** ここが空なら、この表を出す意味がない。 */
  rec('いま出ていない丈位置の値が見える',lc1.他の丈の値==='99.6',JSON.stringify(lc1));
  rec('いま入力している丈位置が分かる',lc1.いまの列===1,JSON.stringify(lc1));
  rec('公差外はここでも印が付く',lc1.公差外の印===1&&lc1.公差外の値[0]==='150.0',
      JSON.stringify(lc1.公差外の値));
  /* 見出しを押したらその丈位置へ移る（見えた値へすぐ行ける）。 */
  await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#measurementGrid .length-compare thead th button')];
   b[1].click();
  });
  await page.waitForTimeout(600);
  const lc2=await lc();
  const movedTo=await page.evaluate(()=>document.querySelector('#lengthPos').value);
  rec('見出しを押すとその丈位置へ移る',movedTo==='1(尾)'&&lc2.いまの列===2,
      JSON.stringify({movedTo,いまの列:lc2.いまの列}));
  await page.evaluate(()=>{const lp=document.querySelector('#lengthPos');
    lp.selectedIndex=0;lp.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(400);
  /* 2列（20条超）のときは場所が無いので出さない。 */
  await rowsFor(24);
  rec('2列のときは出さない',(await lc()).出ている===false);
  await rowsFor(8);
  /* 後始末: 次の検証（③の公差外の集計）へ値を持ち越さない。 */
  await page.evaluate(()=>{S.measure.measurements.width.forEach(r=>r.fill(''));renderMeasureGrid()});
  await page.waitForTimeout(300);
  await rowsFor(1);

  /* ---- 5) 進めない理由を書く ----
     既定の入力内容は母材＝手動入力の項目なので、測定器からは受けられない。
     **そのことを画面に書く**（押せるのに何も起きないのが最悪）。 */
  rec('②で測定器を使えない項目のときは理由を書く',
      /母材|手動/.test(m2.理由||''),m2.理由||'(空)');
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(600);
  const m2b=await seen();
  rec('測定器を使う項目に変えたら理由は消える',(m2b.理由||'')==='',m2b.理由||'(空)');

  /* ---- 5b) 受信欄から手を離さずに巡回できる（§9.124） ----
     利用者はマウス＆キーボードで作業する。空いているキーは3組しかないので、
     その3組が確実に効くこと、そして**フォーカスが常に「実際に入力する場所」へ
     載る**ことを固定する（転送の項目＝受信欄、手動の項目＝セル）。 */
  const where=()=>page.evaluate(()=>{
   const a=document.activeElement;
   return {項目:document.querySelector('#measureType').value,
     丈:document.querySelector('#lengthPos')?.value||'',
     居場所:!a?'なし':(a.id||(a.dataset&&a.dataset.mkey?'セル':a.tagName))};
  });
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(500);
  const k0=await where();
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(500);
  const k1=await where();
  rec('→ で次の項目へ移る',k1.項目!==k0.項目,`${k0.項目} → ${k1.項目}`);
  rec('手動入力の項目ではセルへフォーカスが載る',k1.居場所==='セル',JSON.stringify(k1));
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(500);
  const k2=await where();
  rec('セルからでも → が効く（キーの割り当ては1箇所）',k2.項目!==k1.項目,
      `${k1.項目} → ${k2.項目}`);
  rec('転送で入れる項目では受信欄へフォーカスが載る',k2.居場所==='deviceInput',
      JSON.stringify(k2));
  await page.keyboard.press('ArrowLeft');await page.waitForTimeout(500);
  rec('← で前の項目へ戻る',(await where()).項目===k1.項目,JSON.stringify(await where()));
  const b4=await where();
  await page.keyboard.press('PageDown');await page.waitForTimeout(500);
  const af=await where();
  rec('PageDown で丈位置が移る',af.丈!==b4.丈,`${b4.丈} → ${af.丈}`);
  await page.keyboard.press('F2');await page.waitForTimeout(600);
  const f2=await where();
  rec('F2 で未測定の項目へ飛ぶ',f2.項目!==af.項目,`${af.項目} → ${f2.項目}`);

  /* **打っている最中の ← → は奪わない。** 空でないときは文字の中を動く。 */
  const typing=await page.evaluate(async()=>{
   const el=document.getElementById('deviceInput');
   if(!el||el.offsetParent===null)return{対象外:true};
   el.focus();el.value='26.1';el.setSelectionRange(4,4);
   const before=document.querySelector('#measureType').value;
   el.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true}));
   await new Promise(r=>setTimeout(r,300));
   const after=document.querySelector('#measureType').value;
   el.value='';
   return {項目が変わらない:before===after,前:before,後:after};
  });
  rec('数値を打っている最中は ← で項目を変えない',
      typing.対象外===true||typing.項目が変わらない===true,JSON.stringify(typing));

  /* キーは画面に書く（覚えさせない）。 */
  const hint=await page.evaluate(()=>{
   const h=document.querySelector('.mnav-hint');
   if(!h)return null;const r=h.getBoundingClientRect();
   return {文:h.textContent.replace(/\s+/g,' ').trim(),
           見えている:r.width>0&&r.height>0&&getComputedStyle(h).display!=='none'};
  });
  rec('キーの案内が画面に出ている',
      !!hint&&hint.見えている&&/F2/.test(hint.文)&&/項目/.test(hint.文),JSON.stringify(hint));

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
      .map(x=>(x.querySelector('.prep-more-name')||x).textContent.trim()),
    出ている項目:[...box.querySelectorAll('label')].filter(vis).map(id),
    畳んでいる項目:[...box.querySelectorAll('label[data-prep="usual"]')].filter(x=>!vis(x)).map(id),
    要約:document.querySelector('#prepMoreList')?.textContent.trim()||'',
    状態:document.querySelector('#prepMoreState')?.textContent.trim()||'',
    開いている:box.classList.contains('prep-open'),
   };
  });
  const p1=await prep();
  rec('①は役割ごとの見出しを持つ',p1.見出し.length===4,JSON.stringify(p1.見出し));
  /* **オペレータはプルダウン**(§9.133)。リストボックスは器の中で5,394px
     スクロールしており(実測)、1画面に収める方針にも反していた。
     **選択肢は1人も減らさない**——171人ぜんぶ入っていることを見る。 */
  const opList=await page.evaluate(()=>{
   const el=document.getElementById('operator');
   return {size:el.size,選択肢:el.options.length,
     はみ出し:Math.round(el.scrollHeight-el.clientHeight)};
  });
  rec('オペレータはプルダウン(リストボックスにしない)',opList.size<=1,JSON.stringify(opList));
  rec('オペレータの選択肢を減らしていない',opList.選択肢>=100,JSON.stringify(opList));
  rec('オペレータ欄が器の中でスクロールしない',opList.はみ出し<=1,JSON.stringify(opList));
  rec('見出しは「誰が→形→機材→いつもと同じ」の順',
      p1.見出し.join('/')==='誰が測るか/測定表の形/使う機材/いつもと同じ設定',
      p1.見出し.join('/'));
  /* ②で使う道具（入力内容・丈位置）は①に出さない。**1回決めるものと、
     測りながら何度も切り替えるものを同じ場所に並べない。** */
  rec('①に入力内容・丈位置を出さない',
      !p1.出ている項目.includes('measureType')&&!p1.出ている項目.includes('lengthPos'),
      JSON.stringify(p1.出ている項目));
  /* **入力させる項目は折りたたまない**(§9.133)。畳むと現在値を要約でもう一度
     書くことになり、同じ情報が2箇所に出る。場所は実測で足りている。 */
  rec('①の入力項目は14個すべて出ている(折りたたまない)',
      ['operator','inspector','crewSize','verticalCount','horizontalCount',
       'innerDiameter','spool','thicknessGauge','widthGauge',
       'unwind','widthOrder','widthDirection','burr','coilStop']
        .every(k=>p1.出ている項目.includes(k))&&p1.出ている項目.length===14,
      JSON.stringify(p1.出ている項目));
  rec('畳んでいる項目が無い',p1.畳んでいる項目.length===0,JSON.stringify(p1.畳んでいる項目));
  /* **開始/終了時刻は準備の面に置く**(§9.133、項目5)。以前は左の情報カードの
     中にあり、準備の必須入力なのに導線から外れていた。 */
  const prepWt=await page.evaluate(()=>{
   const box=document.querySelector('.measure-shell .selectors');
   const w=box?.querySelector('[data-f="workTime"]');
   if(!w)return null;
   const r=w.getBoundingClientRect(),b=box.getBoundingClientRect();
   return {中にある:true,最後:Math.round(r.bottom)>=Math.round(b.bottom)-2,
     全幅:Math.round(r.width)>=Math.round(b.width)-2,
     開始:!!document.getElementById('workStartAt'),終了:!!document.getElementById('workEndAt')};
  });
  rec('開始/終了時刻が準備の入力面にある',!!prepWt&&prepWt.開始&&prepWt.終了,JSON.stringify(prepWt));
  /* **置き場所は「いちばん右」から「いちばん下・全幅」へ**（§9.137）。準備の
     入力は骨子で`1×2`＝1マス幅になり、カテゴリを縦に積む形になった。
     作業時間は入力欄に`min-width:190px`があるので1列（204px）には入らず、
     2列ぶんを使って最後に置く。 */
  rec('開始/終了時刻は準備の最後に全幅で置く',!!prepWt&&prepWt.最後&&prepWt.全幅,JSON.stringify(prepWt));

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
  rec('確認表は測定・公差外・作業時間を並べる',
      ['測定','公差外','作業時間'].every(n=>c1.行.some(x=>x.名===n)),
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
   const r=toleranceDetail('width',0,'板幅')?.range;
   if(!r)return{skip:true,base:m.basic.mfgWidth,
     公差の元:toleranceDataForSource('width','manufacturing'),
     出どころ:configuredToleranceSource()};
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
  /* **項目ごとに公差を引き直す。** ラッパー(`measurement-worklog.js`/
     `measurement-tolerance.js`)が`#measureType`を見るため、項目名を
     渡さないと「いま選ばれている項目の公差」が全項目に当たる。実際に
     公差の無いラテラルボーが板幅の公差で判定され、偽の1件が出た。 */
  rec('公差の無い項目を他項目の公差で判定しない',
      !inject.skip&&!inject.集計.items.some(x=>x.name==='ラテラルボー'),
      JSON.stringify((inject.集計||{}).items||[]));
  rec('合格の値は数えない',!inject.skip&&inject.集計.items.every(x=>x.hits.every(h=>h.index<2)),
      JSON.stringify(inject.集計||{}));
  await go('1');await go('3');
  const c2=await check();
  const ngRow=c2.行.find(x=>x.名==='公差外');
  rec('確認表が公差外を件数で言う',!!ngRow&&/2件/.test(ngRow.値),JSON.stringify(ngRow||{}));
  rec('公差外はどの丈位置かまで言う',!!ngRow&&/1\(尾\)/.test(ngRow.詳),ngRow?.詳||'');
  rec('公差外の行には直しに行く手立てがある',!!ngRow&&ngRow.直!=='',JSON.stringify(ngRow||{}));

  /* 「見に行く」は**直せる場所まで連れて行く**。番号を言うだけでは探させる。 */
  await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.fc-row')].find(x=>x.querySelector('.fc-name')?.textContent.trim()==='公差外');
   r.querySelector('.fc-fix').click();
  });
  await page.waitForTimeout(700);
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
      /判定していない項目/.test((c3.行.find(x=>x.名==='公差外')||{}).詳||''),
      (c3.行.find(x=>x.名==='公差外')||{}).詳||'');

  /* 作業時間を記録したら、その行だけが済みになる。 */
  await page.evaluate(()=>{
   S.measure.workTime={startAt:'2026-08-14T09:00:00',endAt:'2026-08-14T10:00:00'};
   WL.measureSteps.refresh();
  });
  await page.waitForTimeout(300);
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
        &&!el.closest('.strip-row,.measure-grid-block');
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
   await page.waitForTimeout(500);
  };
  for(const st of ['1','2','3']){
   await go(st);
   const over=await wideBoxes(SLACK);
   rec(`${st==='1'?'①':st==='2'?'②':'③'}に中身より${SLACK}px以上広い欄が無い`,
       over.length===0,over.join(' / '));
  }
  /* **②は入力内容で中身がまるごと変わる**ので、代表的な3つで見る。
     1つだけ見ると、そのとき選ばれていた項目しか網に掛からない
     （最初はそうなっており、板厚の3点入力と備考欄を取りこぼした）。 */
  await go('2');
  for(const t of ['板幅','揃い/肉厚/長さ','母材']){
   await setType(t);
   const over=await wideBoxes(SLACK);
   rec(`②「${t}」に中身より${SLACK}px以上広い欄が無い`,over.length===0,over.join(' / '));
  }
  /* 高さも同じ。読み取り専用の表示欄をpxで固定すると、6文字に280pxを
     与えたままになる。**行数（rows）で決まっていること**を見る。 */
  await go('2');
  const qbox=await page.evaluate(()=>{
   const el=document.getElementById('motherQualityInfo');
   if(!el)return{無し:true};
   const r=el.getBoundingClientRect(),cs=getComputedStyle(el);
   return{幅:Math.round(r.width),高:Math.round(r.height),rows:el.rows,
     行:(el.value||'').split('\n').length,
     行高:Math.round(parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.4),
     見:r.width>0&&r.height>0};
  });
  if(qbox.見){
   /* 器の高さ ≒ rows×1行＋枠。行数ぶんの2倍を超えていたら「高すぎる」。 */
   rec('品質情報の高さが中身の行数どおり',
       qbox.高<=qbox.rows*qbox.行高+40&&qbox.rows<=Math.max(2,qbox.行+1),
       JSON.stringify(qbox));
   rec('品質情報の幅が中身なりに収まる',qbox.幅<=760,JSON.stringify(qbox));
  }
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
   const skip='.strip-row,.measure-grid-block,.product-rows-table,.lc-table';
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
  rec('①のタブは1枚だけ（品質規格・分析）',wall1.タブ===1,JSON.stringify(wall1));
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

  /* 揃い/肉厚/長さは**全丈を1つの表**で出す（丈番号タブを廃止）。
     タブは「横スクロールを避ける」ためだったが、②の作業面は実測1059×920pxで、
     9丈 × 9項目は横スクロールなしで収まる。 */
  await setType('揃い/肉厚/長さ');
  const prod=await page.evaluate(()=>{
   const t=document.querySelector('.product-rows-table');
   const tabs=document.getElementById('productLengthTabs');
   const n=Math.max(1,Math.min(9,+document.getElementById('verticalCount').value||1));
   return {表:!!t&&t.getBoundingClientRect().height>0,
     行:document.querySelectorAll('#productRowsBody tr').length,丈:n,
     タブ:!!tabs&&tabs.getBoundingClientRect().height>0,
     溢れ:t?Math.round(t.getBoundingClientRect().right
       -document.querySelector('.right-pane').getBoundingClientRect().right):0};
  });
  rec('②の揃いは全丈を1つの表で出す',prod.表&&prod.行===prod.丈,JSON.stringify(prod));
  rec('②の揃いに丈番号タブを出さない',prod.タブ===false,JSON.stringify(prod));
  rec('②の全丈表が横に溢れない',prod.溢れ<=0,JSON.stringify(prod));

  /* ③は1枚の確認シート。上に「あと何が残っているか」、下に「何が記録されたか」。 */
  await go('3');
  const f3=await page.evaluate(()=>{
   const fc=document.querySelector('.finish-check').getBoundingClientRect();
   const lp=document.querySelector('.left-pane').getBoundingClientRect();
   const body=document.querySelector('.measure-body').getBoundingClientRect();
   return {確認幅:Math.round(fc.width),本体幅:Math.round(body.width),
     確認下:Math.round(fc.bottom),記録上:Math.round(lp.top),
     カード:[...document.querySelectorAll('.fc-row')].map(x=>Math.round(x.getBoundingClientRect().top))};
  });
  /* 本文の左右の余白（`--gap-section`×2）を差し引いて比べる（§9.137の意匠）。 */
  rec('③の確認表が本体の全幅を使う',f3.確認幅>=f3.本体幅-40,JSON.stringify(f3));
  rec('③は確認表が上・記録が下',f3.確認下<=f3.記録上+2,JSON.stringify(f3));
  rec('③の確認カードが横に並ぶ',new Set(f3.カード).size===1,JSON.stringify(f3.カード));
  const w3=await widthKinds(),e3=await emptyRate();
  rec('③の入力欄の幅が4種類以内',w3.length<=4,JSON.stringify(w3));
  const box3=await emptyBox();
  rec('③に中身のない器（120px超の空き）が無い',box3.length===0,box3.join(' / '));
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
  await go('1');

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 作ったレコードは端末内・共有の両方から消す。**画面のidと保存側の記録IDは
    違う**ので末尾一致で消す（§9.122）。落ちた側でも通る。 */
 async function cleanup(){
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof reliableDelete==='function')await reliableDelete(id).catch(()=>{});
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
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
