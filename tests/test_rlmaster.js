/* test_rlayout.js: 帳票レイアウトマスタ（§9.254 ③、利用者の指示）
   ============================================================
   「帳票の表示画面からいける、レイアウト調整画面ですが、これは実質、帳票
    レイアウトマスタなので、マスタとしても配置し、この帳票レイアウトマスタと
    帳票ブロックマスタを配線しリンクさせてレイアウト調整画面から表示内容
    調整できたところなど、機能が重複する部分は統合して帳票マスタとして
    親子関係のある高性能マスタとしてさらに使いやすく改良再構成してください」

   ここで固定すること:
    1. マスタ管理に「帳票レイアウト」があり、**左＝設備ごとの紙（親）／
       右＝その紙に載る塊（子）**の2ペインで出る
    2. 出す/出さない・幅・高さが**サーバーへ保存される**（開き直しても残る）
    3. 「紙で組み換える」で**見本のロット**の紙が組み換えモードで開き、
       戻るとこのタブへ帰る（入口を2つにしない・§9.207）
    4. 「中身を直す」で帳票ブロックの編集窓が**その塊の名前**で開く（親→子）
    5. 帳票ブロックから「紙での見え方」でここへ渡れる（子→親）
    6. 「既定に戻す」で設定が消える
    7. 紙の割り（列×段）の選択肢は**`report-dashboard.js`が答える**
       ——画面へ綴りを写していない（§9.163。写した直後は実在しない
       6/12/24が並んでいた）

   **素通りに注意**: 「ボタンが在る」「押せた」だけを見る網は、保存していない
   実装でも通る。**押したあとに必ずAPIで突き合わせる。**

   後片付けは finally で必ず行う（列レイアウトマスタは実行をまたいで
   生き延びる・§9.121）。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)});
const get=p=>fetch(B+p).then(r=>r.json());
const layout=()=>get('/api/column-layout-master?target='+encodeURIComponent(TARGET));
const clearLayout=()=>post('/api/column-layout-master',{target:TARGET,clear:true,user_id:'tests'});
let b=null;

(async()=>{
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 try{
  await post('/api/access-mode',{mode:'edit'});
  await clearLayout();
  b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
  const page=await b.newPage({viewport:{width:1760,height:1000}});
  page.on('pageerror',e=>errs.push(String(e&&e.message||e).slice(0,140)));
  page.on('dialog',d=>d.accept());
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');

  /* ---- 1) タブが在り、親→子の順に並ぶ ---- */
  const nav=await page.evaluate(()=>{
   const b=[...document.querySelectorAll('#masterMaintNav [data-master]')].map(x=>x.dataset.master);
   return {has:b.indexOf('reportLayout')>=0,
           before:b.indexOf('reportLayout')>=0&&b.indexOf('reportBlock')>=0
                  &&b.indexOf('reportLayout')<b.indexOf('reportBlock'),
           label:(document.querySelector('#masterMaintNav [data-master="reportLayout"]')||{}).textContent||''};
  });
  rec('マスタ管理に「帳票レイアウト」がある',nav.has,nav.label.trim());
  rec('親（レイアウト）→子（ブロック）の順に並ぶ',nav.before,nav.label.trim());

  await page.click('#masterMaintNav [data-master="reportLayout"]');
  await page.waitForSelector('.rly-edit',{timeout:20000});
  await page.waitForSelector('[data-rly-paper]',{timeout:20000});

  /* ---- 2) 左＝紙（親）／右＝塊（子） ---- */
  const panes=await page.evaluate(()=>{
   const l=document.querySelector('.rly-papers'),r=document.querySelector('.rly-blocks');
   const rl=l&&l.getBoundingClientRect(),rr=r&&r.getBoundingClientRect();
   return {papers:document.querySelectorAll('[data-rly-paper]').length,
           leftIsLeft:!!rl&&!!rr&&rl.left<rr.left,
           insideEdit:!!(l&&l.closest('.rly-edit'))&&!!(r&&r.closest('.rly-edit'))};
  });
  rec('左＝設備ごとの紙／右＝その紙に載る塊の2ペイン',
      panes.papers>=1&&panes.leftIsLeft&&panes.insideEdit,JSON.stringify(panes));

  await page.click(`[data-rly-paper="${EQ}"]`);
  await page.waitForFunction(eq=>{
   const h=document.querySelector('.rly-blocks-head');
   return !!h&&h.textContent.indexOf(eq)>=0;
  },EQ,{timeout:20000});
  const rows0=await page.evaluate(()=>[...document.querySelectorAll('.rly-row[data-rly-key]')]
    .map(r=>r.dataset.rlyKey));
  rec('選んだ設備の紙に載る塊が並ぶ',rows0.length>=5,String(rows0.length)+'件');

  /* ---- 7) 紙の割りの選択肢はサーバー側（report-dashboard.js）が答える ---- */
  const grids=await page.evaluate(async()=>{
   const info=await WL.reportLayout.info('テスト設備A');
   return {cols:[...document.querySelectorAll('[data-rly-cols]')].map(b=>Number(b.dataset.rlyCols)),
           rows:[...document.querySelectorAll('[data-rly-rows]')].map(b=>Number(b.dataset.rlyRows)),
           infoCols:info.gridChoices,infoRows:info.pageRowChoices};
  });
  rec('紙の割りの選択肢は口が答えたものと一致する（画面へ写していない）',
      JSON.stringify(grids.cols)===JSON.stringify(grids.infoCols)
      &&JSON.stringify(grids.rows)===JSON.stringify(grids.infoRows),JSON.stringify(grids));

  /* ---- 3) 出す/出さない が保存される ---- */
  const key=rows0[0];
  const before=await layout();
  await page.click(`[data-rly-vis="${key.replace(/"/g,'\\"')}"]`);
  await page.waitForFunction(()=>/外しました|出しました|保存できません/.test(
    (document.getElementById('rlyState')||{}).textContent||''),null,{timeout:20000});
  const afterHide=await layout();
  rec('「出さない」にするとサーバーへ残る（並びも書き下ろす）',
      (afterHide.hidden||[]).includes(key)&&(afterHide.order||[]).length>0
      &&(before.order||[]).length===0,
      JSON.stringify({key,hidden:(afterHide.hidden||[]).length,order:(afterHide.order||[]).length}));
  const shownText=await page.evaluate(k=>{
   const b=document.querySelector(`[data-rly-vis="${k.replace(/"/g,'\\"')}"]`);
   return b?b.textContent.trim():'';
  },key);
  rec('いまの状態を色だけでなく文字で言う',shownText==='出さない',shownText);

  /* ---- 4) 幅・高さが保存される ---- */
  const spanPick=await page.evaluate(k=>{
   const el=document.querySelector(`select[data-rly-span="${k.replace(/"/g,'\\"')}"]`);
   if(!el)return null;
   const vals=[...el.options].map(o=>o.value);
   return {cur:el.value,next:vals.find(v=>v!==el.value)||''};
  },key);
  await page.selectOption(`select[data-rly-span="${key.replace(/"/g,'\\"')}"]`,spanPick.next);
  await page.waitForFunction(()=>/幅を変えました|保存できません/.test(
    (document.getElementById('rlyState')||{}).textContent||''),null,{timeout:20000});
  const afterSpan=await layout();
  rec('幅を変えるとサーバーへ残る',
      Object.prototype.hasOwnProperty.call(afterSpan.widths||{},key),
      JSON.stringify({key,w:(afterSpan.widths||{})[key],pick:spanPick}));

  const rowPick=await page.evaluate(k=>{
   const el=document.querySelector(`select[data-rly-rows-of="${k.replace(/"/g,'\\"')}"]`);
   if(!el)return null;
   const vals=[...el.options].map(o=>o.value).filter(v=>v!=='0');
   return {cur:el.value,next:vals[vals.length-1]||''};
  },key);
  await page.selectOption(`select[data-rly-rows-of="${key.replace(/"/g,'\\"')}"]`,rowPick.next);
  await page.waitForFunction(()=>/高さを変えました|保存できません/.test(
    (document.getElementById('rlyState')||{}).textContent||''),null,{timeout:20000});
  const afterRows=await layout();
  rec('高さを変えるとサーバーへ残る',
      Object.prototype.hasOwnProperty.call(afterRows.widths||{},'行数:'+key),
      JSON.stringify({key,v:(afterRows.widths||{})['行数:'+key],pick:rowPick}));

  /* ---- 5) 「中身を直す」で子（帳票ブロック）の編集窓が開く ---- */
  const named=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.rly-row[data-rly-key]')].find(x=>x.querySelector('[data-rly-edit]'));
   return r?{key:r.dataset.rlyKey,id:r.querySelector('[data-rly-edit]').dataset.rlyEdit}:null;
  });
  rec('既定の塊にも「中身を直す」が出る（帳票ブロックの行と結んである）',!!named,JSON.stringify(named));
  if(named){
   await page.click(`[data-rly-edit="${named.id}"]`);
   await page.waitForSelector('#maintEditorModal .mm-editor-dialog.is-builder',{state:'visible',timeout:25000});
   const title=await page.evaluate(()=>(document.getElementById('maintEditorTitle')||{}).textContent||'');
   rec('子の編集窓がその塊の名前で開く（どれを開いたのか分かる）',
       title.indexOf(named.key)>=0,title);
   await page.click('#maintEditorCancel');
   await page.waitForTimeout(300);
  }

  /* ---- 6) 子→親のリンク ---- */
  const linked=await page.evaluate(()=>{
   const b=document.getElementById('mmLinkMaster');
   return b?{text:b.textContent.trim(),
             tab:(document.querySelector('#masterMaintNav [data-master].active')||{}).dataset.master}:null;
  });
  rec('帳票ブロックの帯から親（帳票レイアウト）へ渡れる',
      !!linked&&linked.tab==='reportBlock'&&/帳票レイアウト/.test(linked.text),JSON.stringify(linked));
  if(linked){
   await page.click('#mmLinkMaster');
   await page.waitForSelector('.rly-edit',{timeout:20000});
   const back=await page.evaluate(()=>(document.querySelector('#masterMaintNav [data-master].active')||{}).dataset.master);
   rec('押すと帳票レイアウトへ移る',back==='reportLayout',String(back));
  }

  /* ---- 8) 「紙で組み換える」→ 見本のロットで組み換えモード → 戻る ---- */
  await page.click(`[data-rly-paper="${EQ}"]`);
  await page.waitForFunction(eq=>{
   const h=document.querySelector('.rly-blocks-head');
   return !!h&&h.textContent.indexOf(eq)>=0;
  },EQ,{timeout:20000});
  await page.click('#rlyArrange');
  await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:30000});
  await page.waitForFunction(()=>document.body.classList.contains('rp-arranging'),null,{timeout:30000});
  const arr=await page.evaluate(()=>({
   bar:!!document.getElementById('rpArrangeBar')&&!document.getElementById('rpArrangeBar').hidden,
   sample:!!document.getElementById('rpSampleBar'),
   back:(document.getElementById('reportBack')||{}).textContent.trim(),
   eq:(document.getElementById('rpSampleBar')||{}).innerText||''}));
  rec('「紙で組み換える」で見本のロットの紙が組み換えモードで開く',
      arr.bar&&arr.sample,JSON.stringify(arr));
  rec('その設備の配置で開く（帯が設備名を名乗る）',arr.eq.indexOf(EQ)>=0,arr.eq.replace(/\s+/g,' '));
  rec('戻り先を名乗る',/帳票レイアウト/.test(arr.back),arr.back);
  await page.click('#reportBack');
  await page.waitForSelector('.rly-edit',{timeout:25000});
  const backTab=await page.evaluate(()=>(document.querySelector('#masterMaintNav [data-master].active')||{}).dataset.master);
  rec('戻ると帳票レイアウトのタブへ帰る',backTab==='reportLayout',String(backTab));

  /* ---- 9) 既定に戻す ---- */
  await page.click(`[data-rly-paper="${EQ}"]`);
  await page.waitForFunction(eq=>{
   const h=document.querySelector('.rly-blocks-head');
   return !!h&&h.textContent.indexOf(eq)>=0;
  },EQ,{timeout:20000});
  await page.click('#rlyReset');
  /* 消える操作なので1回確かめる。素の`confirm()`ではなくなった（§9.342）。 */
  await require('./lib/wait.js').answerConfirm(page);
  await page.waitForFunction(()=>/既定に戻しました|保存できません/.test(
    (document.getElementById('rlyState')||{}).textContent||''),null,{timeout:20000});
  const cleared=await layout();
  rec('「既定に戻す」で設定が消える',
      (cleared.order||[]).length===0&&(cleared.hidden||[]).length===0
      &&Object.keys(cleared.widths||{}).length===0,
      JSON.stringify({order:(cleared.order||[]).length,hidden:(cleared.hidden||[]).length,
                      widths:Object.keys(cleared.widths||{}).length}));

  /* ---- 10) 閲覧モードでは触らせない（§4） ----
     列レイアウトマスタの保存はedit/scheduleにしか開いていないので、押せると
     403で断られる。**消さずに押せなくして理由を書く**。 */
  /* **同じタブのまま、モードだけ入れ替えて描き直す**（§9.98）——`reload()`は
     `pagehide`でタブ0件の合図を送るので、開き直す前にアプリが自分で終了
     しうる（終了すると設定したモードも既定へ戻る）。 */
  await post('/api/access-mode',{mode:'view'});
  await page.evaluate(()=>window.refreshAccessMode&&window.refreshAccessMode());
  await page.waitForFunction(()=>window.accessMode&&window.accessMode.mode==='view',
    null,{timeout:20000});
  await page.evaluate(()=>document.querySelector('#masterMaintNav [data-master="reportLayout"]').click());
  await page.waitForSelector('.rly-edit',{timeout:20000});
  await page.waitForFunction(()=>{
   const n=document.querySelector('.rly-note');
   return !!n&&/閲覧モード/.test(n.textContent||'');
  },null,{timeout:20000}).catch(()=>{});
  const view=await page.evaluate(()=>({
   arrange:!!(document.getElementById('rlyArrange')||{}).disabled,
   toggles:[...document.querySelectorAll('[data-rly-vis]')].every(b=>b.disabled),
   selects:[...document.querySelectorAll('.rly-pick>select')].every(b=>b.disabled),
   reset:!!(document.getElementById('rlyReset')||{}).disabled,
   why:(document.querySelector('.rly-note')||{}).textContent||''}));
  rec('閲覧モードでは押せなくして理由を書く',
      view.arrange&&view.toggles&&view.selects&&view.reset&&/閲覧モード/.test(view.why),
      JSON.stringify(view).slice(0,220));

  rec('画面のJSエラーが無い',errs.length===0,errs.join(' / '));
  const fail=R.filter(r=>!r.ok).length;
  console.log(`\n${R.length-fail} PASS / ${fail} FAIL`);
  process.exitCode=fail?1:0;
 }catch(e){
  console.log('FATAL: '+(e&&e.stack||e));process.exitCode=1;
 }finally{
  /* **後片付け**（§9.360）: 画面を触ると、その帳票・一覧の列レイアウトが
     保存される。**触った網は自分で消す**——残すと、単独で回したときに
     自分のDBを汚し、通しでは「共有状態を残した本」の報告がうるさくなって
     本物の置き土産が埋もれる（§9.284 の`list:`が積み上がる形）。 */
  /* 自前の`clearLayout()`は`report:<設備>`を消す。**`report:共通`は別の対象**で
     残っていた（§9.360で実測 +24）ので、こちらも消す。 */
  try{await post('/api/column-layout-master',{target:'report:共通',clear:true,
    order:[],hidden:[],widths:{},names:{},formats:{},rules:{},formulas:{},
    locks:[],sorts:{},user_id:'tests'})}catch(_){}
  /* **モードは必ず戻す**（同じ群の後続テストは編集モードで走る）。 */
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  try{await clearLayout()}catch(e){}
  if(b)await b.close();
 }
})();
