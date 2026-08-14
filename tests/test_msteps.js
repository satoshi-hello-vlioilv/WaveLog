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
  rec('②では基本情報の面を出さない',m2.左.見===false,JSON.stringify(m2.左));
  rec('②に入力内容の一覧（8項目）が出る',items.一覧===8,JSON.stringify(items));
  rec('②では1回決めるだけの設定を出さない',items.ほかの設定===0,JSON.stringify(items));
  /* **丈位置は②に出す（§9.125）。** `PageUp/PageDown`で動かせるのに、
     以前はどの段にも出ておらず「いま何丈目か」は`#stepStatus`の文でしか
     分からなかった。高さは選択肢の数ぶん——7行固定だと空白が並ぶ。 */
  rec('②に丈位置が出る',items.丈が見える===true,JSON.stringify(items));
  rec('丈位置の高さは選択肢の数ぶん',items.丈の行数===Math.max(2,Math.min(7,items.丈の選択肢)),
      JSON.stringify(items));
  rec('一覧の各項目に残り件数が文字で付く',items.件数の文字===8,JSON.stringify(items));
  /* 測定表は本体の大半を取る。3ペインのときは本体の約4/10だった。 */
  rec('②の測定表が本体の半分より広い',m2.右.w>m2.本体.w*0.5,
      `測定=${m2.右.w} / 本体=${m2.本体.w}`);

  /* ---- 4b) 測定表は「使う条数ぶんだけ」描く（§9.124） ----
     以前は条数に関わらず 2列×20行＝40条を必ず描き、超えた行を灰色で残して
     いた。1条のロットでも39行の空欄が並ぶ。**探す対象を増やさない。**
     20条を超えたときだけ2列にする（縦に41行並べると画面から溢れる）。 */
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板厚/板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
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
    const cols=[...document.querySelectorAll('#measurementGrid .compact-width .strip-column')];
    const body=document.querySelector('#measurementGrid .compact-width .compact-width-body');
    const tol=body&&body.querySelector('.compact-tolerance-side');
    const rows=[...document.querySelectorAll('#measurementGrid .compact-width .strip-row label')];
    const cr=cols.map(x=>r(x)),br=r(body),tr=r(tol);
    const lay=document.querySelector('#measurementGrid .compact-width .compact-strip-layout');
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
  await rowsFor(1);

  /* ---- 5) 進めない理由を書く ----
     既定の入力内容は母材＝手動入力の項目なので、測定器からは受けられない。
     **そのことを画面に書く**（押せるのに何も起きないのが最悪）。 */
  rec('②で測定器を使えない項目のときは理由を書く',
      /母材|手動/.test(m2.理由||''),m2.理由||'(空)');
  await page.evaluate(()=>{const s=document.querySelector('#measureType');
    s.value='板厚/板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
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
    s.value='板厚/板幅';s.dispatchEvent(new Event('change',{bubbles:true}))});
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
  /* オペレータ一覧の高さは`size`（行数）で決める（§9.126）。pxで詰めると
     **最後の行が途中で切れる**し、表示サイズを変えるとずれる。 */
  const opList=await page.evaluate(()=>{
   const el=document.getElementById('operator');
   const r=el.getBoundingClientRect();
   const opt=el.options[0]?el.options[0].getBoundingClientRect():null;
   return {size:el.size,選択肢:el.options.length,高さ:Math.round(r.height),
     行の高さ:opt?Math.round(opt.height):0,
     はみ出し:Math.round(el.scrollHeight-el.clientHeight)};
  });
  /* **行数は減らさない。** 実データでオペレータは100人を超えるので、
     見える行を減らすほど探すのが大変になる。直したのは「pxで半端に
     詰めていた」ことのほうで、`size`の意図どおりの高さにする。 */
  rec('①のオペレータ一覧の行数を減らさない',opList.size>=7,JSON.stringify(opList));
  rec('オペレータ一覧が行の途中で切れない',
      opList.行の高さ>0&&Math.abs(opList.高さ-opList.size*opList.行の高さ)<=4,
      JSON.stringify(opList));
  rec('見出しは「誰が→形→機材→その他」の順',
      p1.見出し.join('/')==='誰が測るか/測定表の形/使う機材/その他の設定',
      p1.見出し.join('/'));
  /* ②で使う道具（入力内容・丈位置）は①に出さない。**1回決めるものと、
     測りながら何度も切り替えるものを同じ場所に並べない。** */
  rec('①に入力内容・丈位置を出さない',
      !p1.出ている項目.includes('measureType')&&!p1.出ている項目.includes('lengthPos'),
      JSON.stringify(p1.出ている項目));
  rec('①に出るのは毎回決める9項目',
      ['operator','inspector','crewSize','verticalCount','horizontalCount',
       'innerDiameter','spool','thicknessGauge','widthGauge']
        .every(k=>p1.出ている項目.includes(k))&&p1.出ている項目.length===9,
      JSON.stringify(p1.出ている項目));
  rec('その他の5項目は既定で畳んである',
      p1.畳んでいる項目.length===5&&p1.開いている===false,JSON.stringify(p1.畳んでいる項目));
  /* **畳んだままでも値が読めること。** ここが空だと、ただ隠しただけになる。 */
  rec('畳んだままでも5項目の現在値が要約に出る',
      ['巻出方向','条入力順','方向','バリ揃え','コイル止め'].every(k=>p1.要約.includes(k)),
      p1.要約);
  rec('触っていないことも書く',/既定/.test(p1.状態),p1.状態);
  await page.click('#prepMore');await page.waitForTimeout(250);
  const p2=await prep();
  rec('押すと5項目が出る',p2.出ている項目.length===14&&p2.開いている===true,
      JSON.stringify(p2.出ている項目.length));
  /* 既定と違う値にしたら、畳んだままでもそれが分かる。 */
  await page.evaluate(()=>{const s=document.getElementById('widthDirection');
    s.value='降順';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.waitForTimeout(250);
  const p3=await prep();
  rec('既定と違う設定は件数で知らせる',/1件/.test(p3.状態),p3.状態);
  await page.evaluate(()=>{const s=document.getElementById('widthDirection');
    s.value='昇順';s.dispatchEvent(new Event('change',{bubbles:true}))});
  await page.click('#prepMore');await page.waitForTimeout(250);
  rec('もう一度押すと畳まる',(await prep()).開いている===false);

  /* ---- 6) ③確認 ---- */
  await go('3');
  const m3=await seen();
  rec('③では作業時間・分析の面だけになる',m3.左.見&&!m3.中.見&&!m3.右.見,
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
   const r=toleranceDetail('width',0,'板厚/板幅')?.range;
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
      &&inject.集計.items[0].name==='板厚/板幅'
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
      jumped.段==='測定'&&jumped.項目==='板厚/板幅'&&jumped.丈==='1(尾)',
      JSON.stringify(jumped));
  rec('飛んだ先で公差外のセルに印が付いている',jumped.NGセル>0,JSON.stringify(jumped));

  /* 公差が引けない値を「合格」に混ぜない。**判定していないなら、そう書く。** */
  const unj=await page.evaluate(()=>{
   const m=S.measure;
   delete m.source['板幅公差_製造_プラス'];delete m.source['板幅公差_製造_マイナス'];
   return WL.measureReview.outOfTolerance();
  });
  rec('公差が引けない項目は「判定していない」に回す',
      unj.total===0&&unj.unjudged.includes('板厚/板幅'),JSON.stringify(unj));
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
