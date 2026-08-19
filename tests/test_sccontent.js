/* test_sccontent.js: 内容欄の設定を仕掛一覧と同じパネルで開く（§9.120）
   ------------------------------------------------------------
   タイムラインの「内容」欄も**列レイアウトマスタに乗った列**（§9.88 段6）
   なので、並び・幅・表示名・書式・読み替えは仕掛一覧とまったく同じ仕組みで
   効く。設定画面を2つ持つ理由が無い——覚えることが2倍になり、片方にしか
   無い機能ができる。

   ここで固定すること:
    - **同じパネルが両方で開く**こと。仕掛一覧側の動きは1つも変わらない
      （汎用化のために既存の画面が変わるなら、それは流用ではない）。
    - **どの対象の設定かが見出しに出る**こと。同じ見た目のパネルを使い
      回すので、名前が変わらないと何を触っているか分からない。
    - **いま出している項目だけがチェック済み**で開くこと。「出す項目」を
      持つのはスケジュール内容表示マスタで、列レイアウトマスタのhiddenは
      空。そちらをそのまま使うと候補が全部チェック済みになり、保存した
      瞬間に**選んだ覚えの無い項目まで内容欄へ並ぶ**（実際にそうなった）。
    - **保存が2つのマスタへ振り分けられる**こと（出す項目＝内容表示マスタ、
      それ以外＝列レイアウトマスタ）。
    - **使えない機能はボタンごと消える**こと（並べ替えの決まりは持たない
      ——行の並びは時刻の一本道）。**計算式は§9.207で使えるようにした。**
    - **読み込みは今ある列だけに当て、飛ばした件数を必ず言う**こと。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 /* 見え方の設定（まとめ・さかのぼり・表示列・行の色・配置）は「表示」
    パネル(§9.199)の中にある。開く→選ぶ→**閉じる**まで1つの手順にする
    ——開いたままにすると、パネルが表の右上を覆って次のクリックが
    「要素が隠れている」で落ちる（実際に落ちた）。 */
 const openView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>window.WL&&WL.scheduleView&&WL.scheduleView.closeViewPop&&WL.scheduleView.closeViewPop());
 const pickView=async(sel,val)=>{await openView();await page.selectOption(sel,val).catch(()=>{});await closeView()};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForFunction(()=>(WL.scheduleView?.entries?.()||[]).length>0,null,{timeout:30000});

  /* ---- 1) 内容欄の設定ボタンで、仕掛一覧と同じパネルが開く ---- */
  await openView();
  await page.click('#scContentModalBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:10000});
  await page.waitForTimeout(600);
  const p=await page.evaluate(()=>{
   const el=document.getElementById('listColumnPanel');
   const r=el.getBoundingClientRect();
   const boxes=[...el.querySelectorAll('#lcList .lc-vis input')];
   return {見出し:document.getElementById('lcTitle').textContent,
           分野:document.getElementById('lcEyebrow').textContent,
           項目数:el.querySelectorAll('#lcList .lc-item').length,
           チェック済み:boxes.filter(x=>x.checked).length,
           式ボタン隠れる:document.getElementById('lcAddCol').hidden,
           プリセット出る:!document.querySelector('#listColumnPanel .lc-presets').hidden,
           分類の数:el.querySelectorAll('.lc-origin-chip').length,
           画面内:r.left>=0&&r.top>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};
  });
  rec('内容欄の設定が仕掛一覧と同じパネルで開く',p.項目数>4,JSON.stringify(p.項目数));
  /* §9.176で言葉を他の一覧へ揃えた（ボタンも「☰ 表示列」）。**どの表かを
     出す**という要件は変わらないので、設備名まで入っていることを見る。 */
  rec('どの対象の設定かが見出しに出る',
      /表示列の設定/.test(p.見出し)&&/作業スケジュール表/.test(p.見出し)
      &&p.見出し.includes(EQ)&&p.分野==='作業スケジュール',
      `${p.分野} / ${p.見出し}`);
  /* **要点**: いま出している項目だけがチェック済み。 */
  rec('いま出している項目だけがチェック済みで開く',
      p.チェック済み>0&&p.チェック済み<p.項目数,`${p.チェック済み} / ${p.項目数}`);
  /* §9.207で**計算式の列を足せるようにした**（利用者の指示「計算式などを
     組むために空の列(名前は必須)を追加できるようにしたい」）。以前は
     「内容欄に計算式は無い」としてボタンごと消していたので、期待を反転する。 */
  rec('計算式の列を足せる（§9.207）',p.式ボタン隠れる===false,String(p.式ボタン隠れる));
  rec('保存した設定（プリセット・入出力）は使える',p.プリセット出る===true);
  /* §9.176で固定列（区分・日付・操作など）も同じ並びへ乗ったので、分類は
     「すべて＋元データ＋計算・操作」の3つ。**結合は使わないので出さない**
     ——使わない分類を並べても覚える手間が増えるだけ（§9.120）。 */
  rec('分類は対象に合わせて減らす（結合は出さない）',p.分類の数===3,`${p.分類の数}個`);
  rec('パネルは画面の中に開く',p.画面内);

  /* ---- 2) 右ペインは1項目ぶんの見え方を出す ---- */
  const picked=await page.evaluate(()=>{
   const it=[...document.querySelectorAll('#lcList .lc-item')][1];
   it&&it.click();return it?it.dataset.key:'';
  });
  await page.waitForTimeout(400);
  const detail=await page.evaluate(()=>({
   幅の3択:[...document.querySelectorAll('input[name="lcWidthMode"]')].map(m=>m.value).join(','),
   書式:!!document.getElementById('lcKinds'),
   読み替え:!!document.getElementById('lcRule'),
   式の段:!!document.getElementById('lcFormula'),
   見本に実データ:/[A-Za-z0-9一-龠ぁ-んァ-ヶー]/.test(
     (document.querySelector('.lc-preview')||{}).textContent||''),
  }));
  rec('幅・書式・読み替えは仕掛一覧と同じものが使える',
      detail.幅の3択==='auto,manual,locked'&&detail.書式&&detail.読み替え,JSON.stringify(detail));
  rec('式の段は出さない',detail.式の段===false);
  rec('見本に実データが出る',detail.見本に実データ,picked);

  /* ---- 3) 保存が2つのマスタへ振り分けられる ---- */
  /* **内容欄の項目だけを外す**(§9.176)。同じ並びに固定列（`__cat__`等）が
     混ざるようになったので、区別せず外すと「内容表示マスタの件数」と
     食い違う（固定列は列レイアウトマスタ側の話）。 */
  const saved=await page.evaluate(async a=>{
   const items=[...document.querySelectorAll('#lcList .lc-item')]
     .filter(x=>!/^__/.test(x.dataset.key));
   const on=items.filter(x=>x.querySelector('.lc-vis input').checked);
   if(on.length<2)return {前提なし:true};
   on[on.length-1].querySelector('.lc-vis input').click();   // 内容の項目を1つ外す
   await new Promise(r=>setTimeout(r,400));
   const want=[...document.querySelectorAll('#lcList .lc-item')]
     .filter(x=>!/^__/.test(x.dataset.key)&&x.querySelector('.lc-vis input').checked)
     .map(x=>x.dataset.key);
   document.getElementById('lcSave').click();
   await new Promise(r=>setTimeout(r,1600));
   const m=await (await fetch('/api/schedule-content-master?equipment='+encodeURIComponent(a.eq))).json();
   WL.columnLayout.forget(a.target);
   const l=await WL.columnLayout.load(a.target);
   return {出す項目:(m.items||[]).length,残したかった数:want.length,
           一致:JSON.stringify((m.items||[]))===JSON.stringify(want),
           並び:(l.order||[]).length,隠す:(l.hidden||[]).length};
  },{eq:EQ,target:TARGET});
  rec('外した項目が内容表示マスタから消える',
      saved.前提なし||saved.一致===true,JSON.stringify(saved));
  rec('並び・幅などは列レイアウトマスタへ行く',
      saved.前提なし||(saved.並び>0&&saved.隠す>0),JSON.stringify(saved));
  /* タイムラインへ反映されること(保存しなくても当たるのが方針。§9.90) */
  const applied=await page.evaluate(()=>document.querySelectorAll('.sc-row-title-head').length);
  rec('タイムラインの内容欄に反映される',applied>0,`見出し${applied}個`);

  /* ---- 3b) 旧モーダルから引き継いだ約束 ----
     専用モーダルを消したので、そこで見ていた業務仕様はここで固定する。 */
  const naming=await page.evaluate(()=>{
   const items=[...document.querySelectorAll('#lcList .lc-item')];
   const labels=items.map(x=>(x.querySelector('.lc-name')||x).textContent.trim());
   /* **alias名(purposeName)をそのまま出さない**。選んだ本人以外には
      何の項目か分からない。 */
   const raw=labels.filter(t=>/^(purposeName|mfgMaterial|mfgTemper|lotNo)$/.test(t));
   /* **同義の項目を2つ並べない**（用途名とpurposeNameは同じもの）。
      canonicalContentKeyが1つへ畳む。 */
   const keys=items.map(x=>x.dataset.key);
   const dup=keys.filter(k=>k==='用途名')&&keys.includes('purposeName')&&keys.includes('用途名');
   return {生のキーのまま:raw.length,同義が2つ:!!dup,件数:items.length};
  });
  rec('項目名は日本語で出す（alias名をそのまま出さない）',
      naming.生のキーのまま===0,`生のまま ${naming.生のキーのまま}件`);
  rec('同義の項目が重複して並ばない',naming.同義が2つ===false);

  /* **既定と同じ組み合わせなら「未設定」のまま保存する。** 設定済みに
     すると、既定側を後から変えても追随しなくなる。 */
  const asDefault=await page.evaluate(async a=>{
   document.getElementById('lcReset')?.click();      // 既定に戻す
   await new Promise(r=>setTimeout(r,500));
   // 既定の4項目だけを出す状態へ
   const items=[...document.querySelectorAll('#lcList .lc-item')];
   const want=new Set(['lotNo','purposeName','mfgMaterial','mfgTemper']);
   items.forEach(it=>{
    const box=it.querySelector('.lc-vis input');
    if(!box)return;
    const on=want.has(it.dataset.key);
    if(box.checked!==on)box.click();
   });
   await new Promise(r=>setTimeout(r,400));
   document.getElementById('lcSave').click();
   await new Promise(r=>setTimeout(r,1600));
   const m=await (await fetch('/api/schedule-content-master?equipment='+encodeURIComponent(a.eq))).json();
   return {項目:(m.items||[]).length};
  },{eq:EQ});
  rec('既定と同じ組み合わせなら「未設定」のまま保存する',
      asDefault.項目===0,`${asDefault.項目}件`);

  /* ---- 4) 読み込みは今ある項目だけに当て、飛ばした件数を言う ---- */
  /* ファイル入力へ直接流し込む(実機と同じ経路)。 */
  /* §9.178で「読み込み…」は入出力の帯（この一覧へ当てる／全部書き込む）に
     なった。**ファイルを選ぶ→当てる**の2手を実機と同じ順で通す。 */
  const skip=await page.evaluate(async a=>{
   const el=document.getElementById('lcList');
   const have=[...el.querySelectorAll('.lc-item')].map(x=>x.dataset.key);
   const payload={kind:'wavelog-column-preset',version:1,target:a.target,
     body:{order:[have[0],'消えた項目A','消えた項目B',have[1]],hidden:[],
           widths:{[have[0]]:88,'消えた項目A':120},
           names:{[have[0]]:'テスト名'},formats:{},rules:{},formulas:{},locks:[]}};
   document.getElementById('lcImport').click();
   await new Promise(r=>setTimeout(r,300));
   const file=new File([JSON.stringify(payload)],'test.json',{type:'application/json'});
   const dt=new DataTransfer();dt.items.add(file);
   const input=document.getElementById('lcImportFile');
   input.files=dt.files;
   input.dispatchEvent(new Event('change',{bubbles:true}));
   await new Promise(r=>setTimeout(r,600));
   const one=document.querySelector('#lcIo input[name=lcIoImp][value=one]');
   if(one&&!one.disabled){one.checked=true;one.dispatchEvent(new Event('change',{bubbles:true}))}
   await new Promise(r=>setTimeout(r,300));
   document.getElementById('lcIoRun').click();
   await new Promise(r=>setTimeout(r,1200));
   const foot=document.getElementById('lcFootNote');
   return {案内:(foot?foot.textContent:'').trim(),
           幅が当たった:WL.columnLayout.get(a.target)?true:true,
           項目数:document.querySelectorAll('#lcList .lc-item').length};
  },{target:TARGET});
  rec('読み込みで「飛ばした件数」を必ず言う',
      /飛ばしました/.test(skip.案内)&&/2列/.test(skip.案内),skip.案内.slice(0,110));
  rec('この対象に無い項目を読んでも項目が増えない',
      skip.項目数===p.項目数,`${skip.項目数} / ${p.項目数}`);
  await page.evaluate(()=>WL.listColumns.close());

  /* ---- 5) 仕掛一覧側は1つも変わらない ---- */
  await setMode('edit');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:30000});
  await page.waitForTimeout(1200);
  await page.evaluate(()=>WL.listColumns.open());
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
  const list=await page.evaluate(()=>({
   見出し:document.getElementById('lcTitle').textContent,
   分野:document.getElementById('lcEyebrow').textContent,
   式ボタン出る:!document.getElementById('lcAddCol').hidden,
   分類の数:document.querySelectorAll('.lc-origin-chip').length,
   列数:document.querySelectorAll('#lcList .lc-item').length,
  }));
  /* §9.176で**どの表かを見出しに出す**ようにした（利用者の指摘。同じパネルを
     3画面で使い回すため）。仕掛一覧側も「表示列の設定（仕掛一覧：DB / 表）」。
     分野・機能・列数は今までどおり。 */
  rec('仕掛一覧側の見出しもどの表かを言う',
      /^表示列の設定（仕掛一覧/.test(list.見出し)&&list.分野==='一覧の見せ方',
      JSON.stringify(list));
  rec('仕掛一覧側は計算式が使える',list.式ボタン出る===true);
  rec('仕掛一覧側の分類は「すべて＋3分類」のまま',list.分類の数===4,`${list.分類の数}個`);
  await page.evaluate(()=>WL.listColumns.close());

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
 async function cleanup(){
  /* 検証で作った設定は消す(次のテストや実機の設定を汚さない)。 */
  try{await page.evaluate(async a=>{
   await fetch('/api/schedule-content-master',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:a.eq,items:[],user_id:'test-sccontent'})});
   await WL.columnLayout.save(a.target,
    {order:[],hidden:[],widths:{},names:{},formats:{},rules:{},formulas:{},locks:[]});
  },{eq:EQ,target:TARGET})}catch(e){}
  try{await setMode('edit')}catch(e){}
  if(b)await b.close().catch(()=>{});
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
