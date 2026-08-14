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

  /* ---- 4) ②測定は本体を1枚で使う ---- */
  await go('2');
  const m2=await seen();
  rec('②では測定パネルだけになる',m2.右.見&&!m2.左.見&&!m2.中.見,
      JSON.stringify({左:m2.左.見,中:m2.中.見,右:m2.右.見}));
  rec('②の測定パネルは本体の全幅を使う',
      Math.abs(m2.右.w-m2.本体.w)<=2,`測定=${m2.右.w} / 本体=${m2.本体.w}`);
  /* 3ペインのときは本体の約4/10だった。1枚にして倍以上になることを数で見る。 */
  rec('②の測定パネルは3ペインのときより広い',m2.右.w>m2.本体.w*0.9,
      `${m2.右.w}px（本体 ${m2.本体.w}px）`);

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
   if(id){
    const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
    const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
    if(ids.length)await fetch('/api/measurement/backup/delete',{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
   }
   const m=document.querySelector('#measureModal');if(m)m.hidden=true;
  })}catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
