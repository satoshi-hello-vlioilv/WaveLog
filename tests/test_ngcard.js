/* test_ngcard.js: 完了前の確認カードの強調と「NGが発生した」（§9.242 ⑤⑥）
   ============================================================
   利用者の指示（⑤）:
     「板厚、板幅は公差ですが、ラテラルボーやバリ、テレスコープ、巻ズレ、
      フラットネスなどは公差ではなく『基準』なので名称を変更し違和感の
      ないようにしてください。公差は上下限があります」
   利用者の指示（⑥）:
     「公差外、基準外などが発生したときにカード自体を背景色または縁の色
      などを変えて視覚的に気付くように…今のままか強調か、色なども含めて
      変更できるように設計してください。さらに、NG回数として記録という
      ボタン…をカード内に表示、今のメニュー位置のボタンは削除。15分に
      1回以上は押せないように制限し、作業導線に組み込む形に」

   ここで固定すること:
    - **上下限のある項目だけが「公差」**。それ以外は「基準」
    - **強調は実際に色が変わる**（クラスが付くだけでは絵は変わらない）
    - **強調しないも選べる**（既定は強調する側）
    - **NGのボタンは確認カードの中だけ**（操作レールには無い）
    - **15分に1回**。押せないときは理由と残り時間を文字で出す（§4）

   **公差の材料は自分で注ぎ込む**——検証用フィクスチャは公差を持たないので、
   入れずに「公差外0件」を見ても、壊れていても同じ結果になる。 */
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
 page.on('dialog',d=>d.accept());

 const go=async s=>{await page.evaluate(v=>WL.measureSteps.go(v),s);await page.waitForTimeout(500)};
 const setType=async v=>{
  await page.evaluate(t=>{const el=document.getElementById('measureType');
    el.value=t;el.dispatchEvent(new Event('change',{bubbles:true}))},v);
  await page.waitForTimeout(450);
 };
 const pill=()=>page.evaluate(()=>{
  const el=document.querySelector('#toleranceSummary .tol-pill');
  return el?{文:el.textContent.trim(),説明:el.getAttribute('title')||''}:null;
 });
 /* 強調は**実際の色**で見る（クラスが付くだけでは絵は変わらない）。 */
 const card=()=>page.evaluate(()=>{
  const el=document.getElementById('finishCheck');
  if(!el)return null;
  const cs=getComputedStyle(el);
  return {強調:el.classList.contains('fc-alert'),
    しかた:el.dataset.fcAlert||'',
    地:cs.backgroundColor,縁:cs.borderColor,影:cs.boxShadow,
    説明:el.getAttribute('title')||''};
 });
 const ngBtn=()=>page.evaluate(()=>{
  const el=document.getElementById('fcNgBtn');
  if(!el)return{ある:false};
  const r=el.getBoundingClientRect();
  return{ある:true,見える:r.width>0&&r.height>0,文:el.textContent.trim(),
    押せる:!el.disabled,説明:el.getAttribute('title')||'',
    /* 行のどこに居るか——「作業導線に組み込む」＝公差外・基準外の行の中。 */
    行:(el.closest('.fc-row')||{}).dataset?.fc||'',
    添え書き:(document.querySelector('.fc-ng-note')||{}).textContent||''};
 });

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    localStorage.removeItem('WaveLogFinishAlertV1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  rec('予定から測定画面を開ける',started);
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>document.querySelector('#saveOverlay')?.hidden!==false,null,{timeout:30000}).catch(()=>{});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});

  /* ======================================================
     ⑤ 「公差」と「基準」を言い分ける
     ====================================================== */
  /* 素性を答えるのは`WL.measureItem`の1箇所（項目名の一覧を増やさない）。 */
  const words=await page.evaluate(()=>{
   const w=t=>WL.measureItem.limitWord(t);
   return {板厚:w('板厚'),板幅:w('板幅'),ラテラルボー:w('ラテラルボー'),
     バリ:w('バリ'),テレスコープ:w('テレスコープ'),巻ずれ:w('巻ずれ'),
     フラットネス:w('フラットネス')};
  });
  rec('板厚・板幅だけが「公差」',words.板厚==='公差'&&words.板幅==='公差',JSON.stringify(words));
  rec('上下限の無い5項目は「基準」',
      ['ラテラルボー','バリ','テレスコープ','巻ずれ','フラットネス']
        .every(k=>words[k]==='基準'),JSON.stringify(words));

  await go('2');
  /* **公差の材料を注ぎ込む**（フィクスチャは持っていない）。 */
  const seeded=await page.evaluate(()=>{
   const m=S.measure;
   m.basic.mfgWidth=100;m.basic.mfgThickness=2;
   m.source=m.source||{};
   m.source['板幅公差_製造_プラス']=0.5;m.source['板幅公差_製造_マイナス']=0.5;
   m.measurements.width.forEach(r=>r.fill(''));
   m.measurements.burr.forEach(r=>r.fill(''));
   WL.measureInput.renderMeasureGrid();
   return !!WL.measureInput.toleranceDetail('width',0,'板幅');
  });
  rec('公差の材料を注ぎ込めた',seeded===true,String(seeded));

  await setType('板幅');
  const pWidth=await pill();
  rec('板幅では「公差」の言葉で言う',
      !!pWidth&&/公差/.test(pWidth.文)&&!/基準なし/.test(pWidth.文),JSON.stringify(pWidth));
  await setType('バリ');
  const pBurr=await pill();
  rec('バリでは「基準なし」と言う（公差とは言わない）',
      !!pBurr&&pBurr.文==='基準なし'&&!/公差/.test(pBurr.文),JSON.stringify(pBurr));
  rec('バリでは理由も基準の言葉で書く',
      !!pBurr&&/基準/.test(pBurr.説明)&&!/公差区分/.test(pBurr.説明),pBurr&&pBurr.説明);

  /* ③の一覧の見出しは**両方の言葉**を出す（片方だけだと もう片方が
     数えられていないように読める）。 */
  await go('3');
  const listHead=await page.evaluate(()=>
    (document.querySelector('#toleranceList3 .tol-list-head')||{}).textContent||'');
  rec('③の一覧の見出しは「公差・基準」を両方言う',
      /公差/.test(listHead)&&/基準/.test(listHead),listHead);

  /* ======================================================
     ⑥ カードの強調
     ====================================================== */
  const clean=await card();
  rec('公差外が無いうちは強調しない',!!clean&&clean.強調===false,JSON.stringify(clean));
  const cleanBg=clean&&clean.地;

  /* 公差外を1件作る（板幅 150.00 は 99.5〜100.5 の外）。 */
  await page.evaluate(()=>{S.measure.measurements.width[0][0]='150.00';WL.measureInput.renderMeasureGrid()});
  await go('2');await go('3');
  const bad=await card();
  rec('公差外が出るとカードが強調される',!!bad&&bad.強調===true,JSON.stringify(bad));
  rec('強調は既定で「縁と面」',!!bad&&bad.しかた==='both',bad&&bad.しかた);
  /* **色が実際に変わること**まで見る（クラスだけでは絵は変わらない）。 */
  rec('強調すると地の色が変わる',!!bad&&bad.地!==cleanBg,JSON.stringify({前:cleanBg,後:bad&&bad.地}));
  rec('なぜ強調しているかを説明が持つ（色だけで伝えない）',
      !!bad&&/公差外|基準外/.test(bad.説明),bad&&bad.説明);
  /* 行の文字でも言っている（§3）。 */
  const ngRowName=await page.evaluate(()=>
    [...document.querySelectorAll('.fc-row')].map(x=>x.querySelector('.fc-name')?.textContent.trim()));
  rec('行の名前は公差外・基準外の両方を持つ',
      ngRowName.includes('公差外・基準外'),JSON.stringify(ngRowName));

  /* 強調のしかたを変えられる（利用者の指示「今のままか強調か、色なども含めて」）。 */
  await page.click('#fcAlertConf');
  await page.waitForSelector('.fc-alert-pop',{timeout:5000});
  const popped=await page.evaluate(()=>{
   const p=document.querySelector('.fc-alert-pop');
   const r=p.getBoundingClientRect();
   return{見える:r.width>0&&r.height>0,
     画面内:r.left>=0&&r.top>=0&&r.right<=window.innerWidth+1&&r.bottom<=window.innerHeight+1,
     しかた:[...p.querySelectorAll('[data-fc-mode]')].map(x=>x.dataset.fcMode),
     色:[...p.querySelectorAll('[data-fc-color]')].map(x=>x.dataset.fcColor),
     /* **色の顔ぶれを網へ書き写さないこと**（§9.288 ③）。§9.242 ⑥では7色
        だったが§9.286 ⑥で14色になり、数を直に書いていたこの網だけが
        **約束が変わったあとも古いまま赤く残っていた**（§9.200）。
        表は`WL.columnTint.PALETTE`の1箇所なので、画面から引いて比べる。 */
     語彙:Object.keys((window.WL&&WL.columnTint&&WL.columnTint.PALETTE)||{})};
  });
  rec('強調の設定を開ける',popped.見える===true,JSON.stringify(popped));
  rec('浮き窓が画面の外へ出ない',popped.画面内===true,JSON.stringify(popped));
  rec('「強調しない」も選べる',popped.しかた.includes('off'),JSON.stringify(popped.しかた));
  rec('色は`WL.columnTint.PALETTE`から選ぶ（16進を選ばせない）',
      popped.語彙.length>0&&JSON.stringify(popped.色)===JSON.stringify(popped.語彙),
      JSON.stringify({札:popped.色,語彙:popped.語彙}));

  await page.click('[data-fc-color="amber"]');
  await page.waitForTimeout(400);
  const amber=await card();
  rec('色を変えると実際に変わる',!!amber&&amber.地!==(bad&&bad.地),
      JSON.stringify({赤:bad&&bad.地,橙:amber&&amber.地}));

  await page.evaluate(()=>document.getElementById('fcAlertConf').click());
  await page.waitForSelector('.fc-alert-pop',{timeout:5000});
  await page.click('[data-fc-mode="off"]');
  await page.waitForTimeout(400);
  const off=await card();
  rec('「強調しない」を選ぶと今までどおりに戻る',
      !!off&&off.強調===false&&off.地===cleanBg,JSON.stringify({いま:off&&off.地,元:cleanBg}));
  /* 覚えていること（この端末の設定）。 */
  const stored=await page.evaluate(()=>localStorage.getItem('WaveLogFinishAlertV1')||'');
  rec('設定はこの端末に覚える',/"mode":"off"/.test(stored)&&/amber/.test(stored),stored);
  /* 戻す（この先の検証は強調ありで見る）。 */
  await page.evaluate(()=>document.getElementById('fcAlertConf').click());
  await page.waitForSelector('.fc-alert-pop',{timeout:5000});
  await page.click('[data-fc-mode="both"]');
  await page.waitForTimeout(300);
  /* 外クリックで閉じられる（開いた器を控えていないと、どの経路でも閉じない）。
     **押す先はカードの中の文**にする——画面の隅（`.shade`）を押すと
     `closeMeasureModal()`が走り、未保存の確認モーダルが前に出て以降の
     操作を全部塞ぐ（実際にそうなった）。 */
  await page.click('#finishCheck .fc-note');
  await page.waitForTimeout(300);
  const closed=await page.evaluate(()=>!document.querySelector('.fc-alert-pop'));
  rec('外をクリックすると浮き窓が閉じる',closed===true,String(closed));

  /* ======================================================
     ⑥ 「NGが発生した」ボタン
     ====================================================== */
  const railNg=await page.evaluate(()=>!!document.getElementById('ngLot'));
  rec('操作レールの「NGとして記録」は無い（入口を2つにしない）',railNg===false,String(railNg));
  const n1=await ngBtn();
  rec('NGのボタンは確認カードの中にある',n1.ある&&n1.見える,JSON.stringify(n1));
  rec('NGのボタンは公差外・基準外の行にある（作業導線）',n1.行==='ng',n1.行);
  rec('まだ押せる',n1.押せる===true,JSON.stringify(n1));
  /* 添え書きは**短く**（§9.234 ①。この行はカード3枚のうち1枚ぶんの幅しか
     無いので、文にすると必ず折り返す）。全文は`title`が持つ。 */
  rec('これまでの回数を文字で出す',/記録 0回/.test(n1.添え書き),n1.添え書き);

  await page.click('#fcNgBtn');
  /* **取り消せない操作なので1回だけ確認する**（§5）。何回目になるのかも
     出す——押す前に分からないまま押させない。 */
  await page.waitForFunction(()=>{
   const m=document.getElementById('appConfirmModal');
   return !!m&&m.hidden===false;
  },null,{timeout:5000});
  const ask=await page.evaluate(()=>
    (document.getElementById('appConfirmBody')||{}).textContent||'');
  rec('押す前に確認する（何回目かも言う）',/1回目/.test(ask)&&/15分/.test(ask),ask);
  await page.click('#appConfirmOk');
  await page.waitForTimeout(1800);
  const after=await page.evaluate(()=>({
   回数:Number(S.measure.settings.ngCount||0),
   状態:S.measure.status,
   最後:S.measure.settings.ngLastAt||''}));
  rec('押すとNG回数が1つ増える',after.回数===1,JSON.stringify(after));
  rec('押した時刻をレコードに控える（端末を替えても効く）',
      !!after.最後,JSON.stringify(after));
  const n2=await ngBtn();
  rec('押したあとは15分押せない',n2.押せる===false,JSON.stringify(n2));
  rec('押せない理由と残り時間を文字で出す（§4）',
      /あと\d+分/.test(n2.文)&&/15分/.test(n2.説明),JSON.stringify(n2));
  rec('記録した回数も文字で出す',/記録 1回/.test(n2.添え書き),n2.添え書き);

  /* 15分たてば押せる——**時計を進めて確かめる**（待たない）。 */
  await page.evaluate(()=>{
   S.measure.settings.ngLastAt=new Date(Date.now()-16*60*1000).toISOString();
   WL.measureSteps.refresh();
  });
  await page.waitForTimeout(400);
  const n3=await ngBtn();
  rec('15分たつとまた押せる',n3.押せる===true,JSON.stringify(n3));

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
 /* 後片付け（§9.121）。**落ちた側でも通す**。画面のidと保存側のIDは
    同じではない（設備名が前に付く）ので**末尾一致で消す**。 */
 async function cleanup(){
  try{await page.evaluate(()=>localStorage.removeItem('WaveLogFinishAlertV1'))}catch(e){}
  try{await page.evaluate(async()=>{
   const id=(typeof S!=='undefined'&&S.measure)?S.measure.id:'';
   if(id&&typeof reliableDelete==='function')await reliableDelete(id).catch(()=>{});
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
