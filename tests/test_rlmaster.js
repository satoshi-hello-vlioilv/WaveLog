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
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='report:'+EQ;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)});
const get=p=>fetch(B+p).then(r=>r.json());
const layout=()=>get('/api/column-layout-master?target='+encodeURIComponent(TARGET));
const clearLayout=()=>post('/api/column-layout-master',{target:TARGET,clear:true,user_id:'tests'});

run('test_rlmaster: 帳票レイアウトマスタ（§9.254 ③、利用者の指示）', async ({page,rec,B,W,idle,paint,errs})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  await clearLayout();
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
  await page.waitForSelector('#masterMaintList .mm-scopebar [data-mm-scope]',{timeout:20000});
  /* 紙（設備）は主役の上の対象の札（§9.602。前は左の一覧`[data-rly-paper]`）。 */
  const pickPaper=async eq=>{
   await page.click(`#masterMaintList .mm-scopebar [data-mm-scope="${eq}"]`).catch(()=>{});
   await page.waitForFunction(e=>{
    const h=document.querySelector('.rly-blocks-head');
    return !!h&&h.textContent.indexOf(e)>=0;
   },eq,{timeout:20000});
  };
  const saveDetail=async re=>{
   await page.click('#rlySave');
   await page.waitForFunction(r=>new RegExp(r).test((document.getElementById('masterMaintSay')||{}).textContent||''),re,{timeout:20000});
  };

  /* ---- 2) 上＝紙（親）の札／左＝その紙に載る塊（子）の表／右＝選んだ塊の詳細 ---- */
  const panes=await page.evaluate(()=>{
   const l=document.querySelector('.rly-blocks'),r=document.querySelector('.rly-detail');
   const rl=l&&l.getBoundingClientRect(),rr=r&&r.getBoundingClientRect();
   return {papers:document.querySelectorAll('#masterMaintList .mm-scopebar [data-mm-scope]').length,
           leftIsLeft:!!rl&&!!rr&&rl.left<rr.left,
           insideEdit:!!(l&&l.closest('.rly-edit'))&&!!(r&&r.closest('.rly-edit')),
           band:!!document.querySelector('#masterMaintForm .op-bar')};
  });
  rec('上＝紙の札／左＝塊の表／右＝選んだ塊の詳細（帯は持たない）',
      panes.papers>=1&&panes.leftIsLeft&&panes.insideEdit&&!panes.band,JSON.stringify(panes));

  await pickPaper(EQ);
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

  /* ---- 3) 出す/出さない が保存される（右の詳細で直して足元の保存・§9.602） ---- */
  const key=rows0[0];
  const before=await layout();
  const sel0=await page.evaluate(()=>(document.querySelector('.rly-row.is-on')||{dataset:{}}).dataset.rlyKey||'');
  rec('最初は先頭の塊を選んでいる（表の行の印と右の詳細が同じ塊）',sel0===key,JSON.stringify({sel0,key}));
  await page.click('[data-rly-d-shown="0"]');
  const dirty=await page.evaluate(()=>({st:(document.querySelector('.rly-foot .pc-dirty')||{}).textContent||'',
   save:!(document.getElementById('rlySave')||{}).disabled,
   mini:document.querySelectorAll('.rly-mini-blk').length,shown:document.querySelectorAll('.rly-row:not(.is-off)[data-rly-key]').length}));
  rec('詳細で変えると足元が「変更あり」と言い、保存が押せる',/変更あり/.test(dirty.st)&&dirty.save,JSON.stringify(dirty));
  await saveDetail('保存しました|保存できません');
  const afterHide=await layout();
  rec('「出さない」にするとサーバーへ残る（並びも書き下ろす）',
      (afterHide.hidden||[]).includes(key)&&(afterHide.order||[]).length>0
      &&(before.order||[]).length===0,
      JSON.stringify({key,hidden:(afterHide.hidden||[]).length,order:(afterHide.order||[]).length}));
  const shownText=await page.evaluate(k=>{
   const r=[...document.querySelectorAll('.rly-row[data-rly-key]')].find(x=>x.dataset.rlyKey===k);
   const b=r&&r.querySelector('.rly-vis');
   return b?b.textContent.trim():'';
  },key);
  rec('いまの状態を色だけでなく文字で言う',shownText==='出さない',shownText);

  /* ---- 4) 幅・高さが保存される ---- */
  const spanPick=await page.evaluate(()=>{
   const el=document.querySelector('select[data-rly-d-span]');
   if(!el)return null;
   const vals=[...el.options].map(o=>o.value);
   return {cur:el.value,next:vals.find(v=>v!==el.value)||''};
  });
  await page.selectOption('select[data-rly-d-span]',spanPick.next);
  await saveDetail('保存しました|保存できません');
  const afterSpan=await layout();
  rec('幅を変えるとサーバーへ残る',
      Object.prototype.hasOwnProperty.call(afterSpan.widths||{},key),
      JSON.stringify({key,w:(afterSpan.widths||{})[key],pick:spanPick}));

  const rowPick=await page.evaluate(()=>{
   const el=document.querySelector('select[data-rly-d-rows]');
   if(!el)return null;
   const vals=[...el.options].map(o=>o.value).filter(v=>v!=='0');
   return {cur:el.value,next:vals[vals.length-1]||''};
  });
  await page.selectOption('select[data-rly-d-rows]',rowPick.next);
  await saveDetail('保存しました|保存できません');
  const afterRows=await layout();
  /* 行と詳細が同じ値を言う（いまの値が選択肢に無くても欄が先頭へ落ちない・§9.602 で見つけた食い違い）。 */
  const agree=await page.evaluate(k=>{
   const r=[...document.querySelectorAll('.rly-row[data-rly-key]')].find(x=>x.dataset.rlyKey===k);
   const el=document.querySelector('select[data-rly-d-rows]');
   return {row:r?r.textContent.replace(/\s+/g,' '):'',sel:el?el.value:''};
  },key);
  rec('高さは表の行と右の詳細が同じ値を言う',agree.sel===rowPick.next&&agree.row.indexOf(`${rowPick.next}/`)>=0,JSON.stringify(agree));
  rec('高さを変えるとサーバーへ残る',
      Object.prototype.hasOwnProperty.call(afterRows.widths||{},'行数:'+key),
      JSON.stringify({key,v:(afterRows.widths||{})['行数:'+key],pick:rowPick}));

  /* ---- 5) 「中身を直す」で子（帳票ブロック）の編集窓が開く（右の詳細の ⋯・§9.602） ---- */
  const named=await page.evaluate(async eq=>{
   const info=await WL.reportLayout.info(eq);
   const b=(info.blocks||[]).find(x=>x.id);
   return b?{key:b.key,id:String(b.id)}:null;
  },EQ);
  rec('既定の塊にも「中身を直す」が出る（帳票ブロックの行と結んである）',!!named,JSON.stringify(named));
  if(named){
   await page.evaluate(k=>{const r=[...document.querySelectorAll('.rly-row[data-rly-key]')].find(x=>x.dataset.rlyKey===k);if(r)r.click()},named.key);
   await page.waitForSelector('#rlyBlockMore',{timeout:8000});
   await page.click('#rlyBlockMore');
   await page.click(`#mmActMenu [data-rly-edit="${named.id}"]`);
   await page.waitForSelector('#maintEditorModal .mm-editor-dialog.is-builder',{state:'visible',timeout:25000});
   const title=await page.evaluate(()=>(document.getElementById('maintEditorTitle')||{}).textContent||'');
   rec('子の編集窓がその塊の名前で開く（どれを開いたのか分かる）',
       title.indexOf(named.key)>=0,title);
   await page.click('#maintEditorCancel');
   await W.until(page,()=>{const m=document.getElementById('maintEditorModal');return !m||m.hidden},null,{ms:5000,what:'子の編集窓が閉じる'});
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
  await pickPaper(EQ);
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

  /* ---- 9) 既定に戻す（頭の ⋯・既定から変えた紙だけ・§9.602） ---- */
  await pickPaper(EQ);
  const tagged=await page.evaluate(eq=>{const b=document.querySelector(`#masterMaintList .mm-scopebar [data-mm-scope="${eq}"]`);return b?b.textContent:''},EQ);
  rec('既定から変えた紙の札は「設定あり」と言う',/設定あり/.test(tagged),tagged);
  await page.click('#masterMaintMore');
  await page.click('#mmActMenu [data-rly-more="reset"]');
  /* 消える操作なので1回確かめる。素の`confirm()`ではなくなった（§9.342）。 */
  await require('./lib/wait.js').answerConfirm(page);
  await page.waitForFunction(()=>/既定に戻しました|保存できません/.test(
    (document.getElementById('masterMaintSay')||{}).textContent||''),null,{timeout:20000});
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
   toggles:[...document.querySelectorAll('[data-rly-d-shown]')].every(b=>b.disabled),
   selects:[...document.querySelectorAll('.rly-dline select')].every(b=>b.disabled),
   why:(document.querySelector('.rly-note')||{}).textContent||''}));
  /* 消す操作（既定に戻す）は閲覧モードでは ⋯ に出さない（押しても何も起きない物を置かない・§4）。 */
  await page.click('#masterMaintMore');
  view.reset=await page.evaluate(()=>!document.querySelector('#mmActMenu [data-rly-more="reset"]'));
  await page.keyboard.press('Escape');
  rec('閲覧モードでは押せなくして理由を書く',
      view.arrange&&view.toggles&&view.selects&&view.reset&&/閲覧モード/.test(view.why),
      JSON.stringify(view).slice(0,220));

  rec('画面のJSエラーが無い',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* **後片付け**（§9.360）: 画面を触ると、その帳票・一覧の列レイアウトが
     保存される。**触った網は自分で消す**——残すと、単独で回したときに
     自分のDBを汚し、通しでは「共有状態を残した本」の報告がうるさくなって
     本物の置き土産が埋もれる（§9.284 の`list:`が積み上がる形）。 */
  /* 自前の`clearLayout()`は`report:<設備>`を消す。**`report:共通`は別の対象**で
     残っていた（§9.360で実測 +24）ので、こちらも消す。 */
  /* **消す前に画面を閉じる。** 帳票の配置は「触ったら裏で保存」（§9.113）
     なので、開いたままだと遅れて届いた保存が消したあとの表へ書き戻し得る。
     後片付けの順は「閉じる → モードを戻す → 消す」。 */
  try{await page.close()}catch(e){console.log('!! 画面を閉じられませんでした: '+(e&&e.message||e))}
  /* **モードは、消すより先に戻す。** この網は最後に閲覧モードへ切り替える
     ので、そのまま消しに行くと書き込みが`/api/access-mode`の関所で弾かれる
     ——`{"error":"現在のモードでは、この操作は実行できません。"}`が返るのに
     `catch`が握って**緑のまま24行残った**（§9.360で実測 +24）。 */
  try{await post('/api/access-mode',{mode:'edit'})}catch(e){}
  /* 自前の`clearLayout()`は`report:<設備>`を消す。**`report:共通`は別の対象**。 */
  try{await post('/api/column-layout-master',{target:'report:共通',clear:true,
    order:[],hidden:[],widths:{},names:{},formats:{},rules:{},formulas:{},
    locks:[],sorts:{},user_id:'tests'})}catch(e){console.log('!! 後片付けに失敗（残った設定が次の実行へ渡る）: '+(e&&e.message||e))}
  try{await clearLayout()}catch(e){console.log('!! 後片付けに失敗（残った設定が次の実行へ渡る）: '+(e&&e.message||e))}
 }
}, {viewport:{width:1760,height:1000}});
