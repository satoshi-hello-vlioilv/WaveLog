/* test_scale.js: 文字・UIの階層（役割 → 寸法）を実測で固定する。
   ------------------------------------------------------------
   §9.71。app.css のトークン(--fs-* / --ctl-h-* / --radius-*)は宣言だけ
   見ても守られているか分からない。**実際に画面へ出ている寸法**を数えて、
   「同じ役割は同じ寸法」が崩れていないことを確かめる。

   これを入れる前の実測（VER1.84.0時点）:
     ・ボタンの高さ … 22/24/26/28/30/31/32/34/35/36/38/40/42/44/46px の15種
     ・角丸         … 28種
     ・見出しの文字 … 8種、ラベル6種、補足5種、バッジ6種
   文字サイズ自体はトークン化済みだったのに「揃って見えない」原因はここ。

   既知の例外はテスト内に**理由付きで**列挙する。増やすときは理由も書くこと
   （理由の書けない例外を足し始めた時点で、この網は意味を失う）。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';

/* コントロールの高さトークン。**直値で持たない**(§9.112)——
   `--row-ctl-h`(表の行の中の部品)は行の中に入れる高さから決まるので、
   26/30/36/40 の並びには乗らない。以前ここが直値だったため、
   「行内ボタンは行に合わせて縮む」という決まり(§9.90)のほうを
   落としてしまう網になっていた。ページから実測して比べる。 */
const CTL_TOKENS=['--ctl-h-xs','--ctl-h-sm','--ctl-h','--ctl-h-lg','--row-ctl-h'];
/* 角丸トークン(--radius-xs/sm/md/lg/pill/round)。0(角を落とす)も可。 */
const RADIUS=['0px','4px','8px','10px','14px','999px'];
/* 例外。**理由が書けるものだけ**載せる。 */
const CTL_EXCEPT={
 '#search':'ヘッダーのチップの中に枠なしで置く検索欄。高さはチップ側が持つ',
 '#pageSize':'一覧ツールバーの中に枠なしで置く表示件数の選択。高さは器が持つ（§9.286 ③）',
 'cal-day':'実績カレンダーのマス目。コントロールではなく面',
 'qa-acc-head':'アコーディオンの見出し行。主要動作と同じ--ctl-h-lg',
 /* 段（タブ）の札は**器の下罫線1pxぶん低い**（§9.229 ⑥。
    `min-height:calc(var(--opf-h,var(--ctl-h-sm)) - 1px)`）。罫線を含めた
    見た目の高さは30pxで規格どおりなので、札だけを測ると1px足りない。
    **操業データ項目の入力方法に「タブ」を選ぶと必ず出る**ので、
    設定次第で赤くなる網にしない。 */
 'opf-tab-btn':'段（タブ）の札。器の下罫線1pxぶん低い（罫線込みで30px・§9.229 ⑥）',
};
/* 「面」＝1行の的ではないもの。高さは中身（行数）が決めるので
   26/30/36/40の並びには乗らない(§9.127)。**個別のidで例外にしない**
   ——増えるたびに一覧を足すことになり、理由も薄くなる。
   リストボックス(size>1のselect)と複数行の入力(textarea)がこれ。 */

let b=null,measureId='';
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 try{
  /* **待つのは「取得が静まって、割り付けが確定したこと」**(§9.102)。
     以前は画面ごとに1.8秒の固定待ちで、7画面で12.6秒を数えるだけに使って
     いた。速い画面では無駄、遅い画面では足りない。 */
  const quiet=async(ms=8000)=>{
   const t0=Date.now();
   let last=-1,same=0;
   while(Date.now()-t0<ms){
    const n=await page.evaluate(()=>(window.__pending||0)+document.querySelectorAll('.mm-empty,.sc-loading').length);
    if(n===last){if(++same>=3)break}else{same=0;last=n}
    await new Promise(r=>setTimeout(r,120));
   }
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  const settle=async(ms=900)=>{await quiet(Math.min(ms*3,8000))};
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await settle(1500);

  /* 画面に出ているコントロールを集める。A4帳票(.rp-page/.df-page)は用紙の
     割り付けのためpx固定が正しいので数えない。 */
  const collect=()=>page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('button,select,input,textarea').forEach(el=>{
    if(el.closest('.rp-page,.df-page,.rp-report,.df-print-area'))return;
    const r=el.getBoundingClientRect();
    if(r.width<1||r.height<1)return;
    const s=getComputedStyle(el);
    if(s.visibility==='hidden')return;
    /* チェックボックス・ラジオは文字の横に置く四角で、高さのスケール
       (26/30/36/40)には乗らない。一辺は --ctl-box で別に揃えてある。 */
    if(el.tagName==='INPUT'&&(el.type==='checkbox'||el.type==='radio')){
     out.push({name:'box:'+el.tagName.toLowerCase(),h:Math.round(r.height),
               radius:s.borderTopLeftRadius,over:0,box:Math.round(r.width)});
     return;
    }
    /* 面(リストボックス・複数行入力)は高さのスケールに乗らない。 */
    if(el.tagName==='TEXTAREA'||(el.tagName==='SELECT'&&el.size>1)){
     out.push({name:'area:'+el.tagName.toLowerCase()+(el.id?'#'+el.id:''),
               h:Math.round(r.height),radius:s.borderTopLeftRadius,over:0});
     return;
    }
    out.push({name:el.tagName.toLowerCase()+(el.id?'#'+el.id:'')+
                   (el.className&&typeof el.className==='string'?'.'+el.className.split(/\s+/).filter(Boolean).slice(0,2).join('.'):''),
              h:Math.round(r.height),radius:s.borderTopLeftRadius,
              over:el.scrollWidth-el.clientWidth});
   });
   return out;
  });
  /* 役割ごとの文字サイズ。同じ役割は1種類であること。 */
  const roles=()=>page.evaluate(()=>{
   const pick=sel=>[...document.querySelectorAll(sel)]
     .filter(el=>el.getBoundingClientRect().height>0)
     .map(el=>Math.round(parseFloat(getComputedStyle(el).fontSize)*100)/100);
   return {
    cardTitle:pick('.qa-v7 .qa-acc-title,.disclosure-title,.wtb-title,.record-list-head'),
    summary:pick('.qa-v7 .qa-acc-sum,.qa-v7 .qa-hint,.disclosure-sum,.split-hint-text'),
    chip:pick('.qa-v7 .qa-chip,.list-join-chip,.field-reorder-badge'),
   };
  });

  const all=[]; const roleAgg={cardTitle:[],summary:[],chip:[]};
  const visit=async(name,fn)=>{
   await fn(); await settle(1800);
   (await collect()).forEach(c=>all.push({...c,screen:name}));
   const r=await roles();
   Object.keys(roleAgg).forEach(k=>roleAgg[k].push(...r[k]));
  };
  await visit('仕掛一覧',()=>page.click('aside [data-db-key="SIKALOTNOW"]'));
  await visit('品質データ',()=>page.click('aside [data-db-key="SIKALOTDEF"]'));
  await visit('品質データ_グラフ',async()=>{
   await page.click('[data-qa-tab="graph"]');await settle(900);
   await page.evaluate(()=>document.querySelectorAll('.qa-acc:not(.open) .qa-acc-head').forEach(x=>x.click()));
  });
  await page.click('[data-qa-tab="raw"]');await settle(600);
  await visit('作業スケジュール',()=>page.click('#openSchedule'));
  await visit('ダッシュボード',()=>page.click('#openDashboard'));
  await visit('測定実績カレンダー',()=>page.click('#openCalendar'));
  await visit('マスタ管理',()=>page.click('#openMasterMaint'));
  /* **測定画面も網に載せる（§9.127）。** ここが巡回に入っていなかったため、
     アプリ全体の寸法を揃えた後も測定画面だけが取り残されていた
     （実測でコントロールの高さ13種・文字7種）。3段それぞれを見る。 */
  await visit('測定①準備',async()=>{
   await page.click('#openSchedule');
   await page.waitForSelector('.sc-row-line',{timeout:25000});
   const ok=await page.evaluate(()=>{
    const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
    if(!r)return false;r.querySelector('.sc-row-start').click();return true;
   });
   if(!ok)throw Error('開始できる行が無い');
   await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
   await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
   await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
   measureId=await page.evaluate(()=>S.measure?.id||'');
  });
  await visit('測定②測定',()=>page.evaluate(()=>WL.measureSteps.go('2')));
  await visit('測定③確認',()=>page.evaluate(()=>WL.measureSteps.go('3')));
  await page.evaluate(()=>{const m=document.querySelector('#measureModal');if(m)m.hidden=true});

  /* トークンの実測値。宣言は calc(...) のまま返るので、当てて測る。 */
  const CTL_H=await page.evaluate(names=>{
   const probe=document.createElement('div');
   probe.style.cssText='position:absolute;visibility:hidden;left:-9999px';
   document.body.appendChild(probe);
   const out=names.map(n=>{probe.style.height=`var(${n})`;
                           return Math.round(parseFloat(getComputedStyle(probe).height))});
   probe.remove();
   return [...new Set(out)].sort((a,b)=>a-b);
  },CTL_TOKENS);
  const excepted=c=>c.name.startsWith('box:')||c.name.startsWith('area:')||
                    Object.keys(CTL_EXCEPT).some(k=>c.name.includes(k.replace('#','')));
  const badH=all.filter(c=>!CTL_H.includes(c.h)&&!excepted(c));
  const hKinds=[...new Set(all.filter(c=>!excepted(c)).map(c=>c.h))].sort((a,b)=>a-b);
  rec(`コントロールの高さがトークン(${CTL_H.join('/')})に収まる`,badH.length===0,
   badH.length?[...new Set(badH.map(c=>`${c.screen}:${c.name}=${c.h}px`))].slice(0,6).join(' / '):`種類 ${hKinds.join(',')}`);
  /* **トークンの種類が増えていないこと**も見る。実測へ変えた副作用で
     「何でも通る」網にしないため(値は増やせても、種類は5つのまま)。 */
  rec('高さのトークンは5種類のまま',CTL_H.length<=5,`${CTL_H.length}種 ${CTL_H.join(',')}`);
  /* **「同じものを見ている」ことを数で固定する**(§9.102)。待ちを固定時間から
     条件へ変えた(25秒→8秒)ので、**早すぎて画面が出来ていないと、数える対象が
     減っただけで全部PASSしてしまう**。実測360件を下限として置く——増えるのは
     構わないが、大きく減ったら「速くなった」のではなく「見ていない」。 */
  const perScreen={};all.forEach(c=>{perScreen[c.screen]=(perScreen[c.screen]||0)+1});
  rec('数えた部品の数が減っていない(早すぎて空振りしていない)',all.length>=360,
   `${all.length}件 ${Object.entries(perScreen).map(([k,v])=>k+':'+v).join(' ')}`);

  const badR=all.filter(c=>!RADIUS.includes(c.radius)&&!excepted(c));
  rec('角丸がトークン(0/4/8/10/14/999)に収まる',badR.length===0,
   badR.length?[...new Set(badR.map(c=>`${c.name}=${c.radius}`))].slice(0,6).join(' / ')
             :[...new Set(all.map(c=>c.radius))].sort().join(','));

  /* ボタンの文字が枠からあふれていない(寸法を揃えた副作用の見張り)。 */
  const overflow=all.filter(c=>c.over>1&&!/input|select|textarea/.test(c.name));
  rec('寸法を揃えた結果、ボタンの文字があふれていない',overflow.length===0,
   overflow.length?[...new Set(overflow.map(c=>`${c.screen}:${c.name}+${c.over}px`))].slice(0,6).join(' / '):'あふれ0');

  const uniq=a=>[...new Set(a)];
  const boxes=[...new Set(all.filter(c=>c.name.startsWith('box:')).map(c=>c.box))];
  rec('チェックボックス・ラジオの一辺が1種類',boxes.length<=1,`${boxes.join(',')}px`);

  rec('カード見出しの文字サイズは1種類',uniq(roleAgg.cardTitle).length<=1,
   `${uniq(roleAgg.cardTitle).join(',')} (${roleAgg.cardTitle.length}件)`);
  rec('要約・補足の文字サイズは1種類',uniq(roleAgg.summary).length<=1,
   `${uniq(roleAgg.summary).join(',')} (${roleAgg.summary.length}件)`);
  rec('チップの文字サイズは1種類',uniq(roleAgg.chip).length<=1,
   `${uniq(roleAgg.chip).join(',')} (${roleAgg.chip.length}件)`);

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await cleanup();process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await cleanup();
  process.exit(2);
 }
 /* 測定画面を開いた副作用のレコードを消す。**消えるまで確かめる**——
    共有は画面を待たせずに送るので、1回消しただけでは後から復活する
    （§9.122。残すと無関係なスケジュールのテストが落ちる）。 */
 async function cleanup(){
  try{
   if(measureId)await page.evaluate(async id=>{
    if(typeof WL.records.reliableDelete==='function')await WL.records.reliableDelete(id).catch(()=>{});
    for(let k=0;k<6;k++){
     const r=await fetch('/api/measurement/backup/list').then(x=>x.json()).catch(()=>({items:[]}));
     const ids=(r.items||[]).map(i=>i.id).filter(x=>x===id||String(x).endsWith(id));
     if(!ids.length)break;
     await fetch('/api/measurement/backup/delete',{method:'POST',
       headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}).catch(()=>{});
     await new Promise(r2=>setTimeout(r2,250));
    }
   },measureId);
  }catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
