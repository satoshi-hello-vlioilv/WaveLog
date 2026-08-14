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
  const items=await page.evaluate(()=>({
   一覧:document.querySelectorAll('#measureTypeGroup .type-chip').length,
   ほかの設定:[...document.querySelectorAll('.selectors>label')]
     .filter(x=>x.id!=='measureTypeGroup'&&x.getBoundingClientRect().height>0).length,
   件数の文字:[...document.querySelectorAll('#measureTypeGroup .type-chip-state')]
     .map(x=>x.textContent.trim()).filter(Boolean).length,
  }));
  rec('②では基本情報の面を出さない',m2.左.見===false,JSON.stringify(m2.左));
  rec('②に入力内容の一覧（8項目）が出る',items.一覧===8,JSON.stringify(items));
  rec('②では1回決めるだけの設定を出さない',items.ほかの設定===0,JSON.stringify(items));
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

  /* ---- 6) ③確認 ---- */
  await go('3');
  const m3=await seen();
  rec('③では作業時間・分析の面だけになる',m3.左.見&&!m3.中.見&&!m3.右.見,
      JSON.stringify({左:m3.左.見,中:m3.中.見,右:m3.右.見}));
  /* 「残っているか」は段の見出しにも本文にも出る。**どちらか片方だけを
     見ないこと**——`||`で拾うと先に空でないほうしか見ず、主張が変わる。 */
  const rest3=(m3.理由||'')+' / '+(m3.段[2].状態||'');
  rec('③には残りの件数を数で書く',/\d+\s*項目/.test(rest3),rest3);

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
