/* test_filter.js: 登録フィルタまわりの4つの指摘（§9.80）。
   ------------------------------------------------------------
   1. 削除の確認ダイアログが**下敷きになって押せない**
      #filterPresetModal も #appConfirmModal も同じ .record-modal
      (z-index:1500)で、同点どうしは**DOMの生成順**で前後が決まる。
      確認ダイアログが先に作られていると以後ずっと下になり、削除できない。
      重ね順をトークン化し、確認は常に最前面(--z-confirm)にした。
   2. 作成時に「適用」と「登録」が分かれていない
      以前はバーの「マスタへ保存」がアクティブな条件を全部まとめて個別
      登録する作りで、「今だけ効かせたい」と「次回も使いたい」を選べず、
      何が登録済みなのかも分からなかった。
   3. スケジュールモードで登録できない
      POST /api/filter-presets が 403(masters は edit 限定)。しかも画面は
      失敗をローカルへ退避した直後に loadMasterPresets() が丸ごと置き換えて
      いたため、退避したものまで消え「登録したのに出ない」と見えた。
      →「変数入りフィルタが登録できない」の正体もこれで、変数は無関係。
   4. 同じ仕掛一覧でもモードで条件が混ざる
      スケジュールモードは品質データを結合して列構成が変わるので、
      置き場を分ける。 */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(`${API}/api/access-mode`,
 {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const TAG='T'+Date.now().toString().slice(-6);

/* 触る前の行を控える（§9.362 ⑤）。製品の「登録フィルタを削除」は
   **論理削除**（`有効=0`）なので、APIで消しても行は残る。**この実行で
   増えた行だけ**を素の表から片付ける（名前で拾うと、同じ名前を使う
   他の網の期待と食い違う・§9.284）。 */
const H=require('./lib/harness.js');
const SNAP_TABLES=['フィルタプリセットマスタ'];
let snapM=null;
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 snapM=await H.masterSnapshot(SNAP_TABLES);
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const settle=(ms=700)=>page.waitForTimeout(ms);
 /* confirmModal() は押されるまで解決しない Promise を返す。
    page.evaluate は返り値の Promise を待つので、**返さないこと**
    (返すとテストがそこで固まる。実際に踏んだ)。 */
 const openList=async()=>{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('aside [data-db-key="SIKALOTNOW"]',{timeout:15000});
  await settle(2000);
 };
 /* 登録フィルタは**人のもの**になった(§9.172)ので、画面と同じ利用者IDで問い合わせる
    ——付けずに聞くと「みんなのもの」しか返らず、自分が登録したぶんが見えない。 */
 const presetNames=mode=>page.evaluate(async m=>{
  const q=new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',mode:m,
    user:localStorage.getItem('AccessMeasurementUserId')||''});
  const r=await fetch('/api/filter-presets?'+q);
  return ((await r.json()).items||[]).map(x=>x.name);
 },mode);

 try{
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A');
                           localStorage.setItem('AccessMeasurementUserId','tester')});
  await openList();

  /* ---- 0) 条件を足す入口は「検索欄」ではなく「ボタン」（§9.345） ----
     以前はここが常時開いた入力欄（実測1071px）で、ヘッダーの「一覧を検索」
     （行の全文検索）と**同じ顔なのに意味が違う**ものが同じ画面に2つ並んで
     いた。**機能は消していない**——押すと同じ欄が出る。 */
  const condUi=()=>page.evaluate(()=>{
   const g=id=>document.getElementById(id);
   const 見える=e=>!!(e&&!e.hidden&&e.offsetParent);
   /* 候補の箱は`position:fixed`。**`offsetParent`で見えるかを測らない**
      ——固定配置の要素は`offsetParent`が必ず`null`になるので、出ていても
      「見えない」と読めてしまう（この網自身が1度それで落ちた）。 */
   const sg=g('filterSuggest');
   return {ボタン:見える(g('filterAddCond')),欄:見える(g('filterTokenInput')),
           候補:!!sg&&!sg.hidden&&sg.childElementCount>0,
           一覧の検索欄:見える(g('search')),
           焦点:document.activeElement&&document.activeElement.id,
           字:(g('filterTokenSearch')||{}).value||''};
  });
  const c0=await condUi();
  rec('はじめは「＋ 条件を追加」のボタンだけが出ている',
      c0.ボタン===true&&c0.欄===false,JSON.stringify(c0));
  /* ③の本体。**同じ顔の欄を2つ同時に出さない。** */
  rec('検索欄の顔をした器は、同時にひとつだけ',
      c0.一覧の検索欄===true&&c0.欄===false,JSON.stringify(c0));

  await page.click('#filterAddCond');await settle(500);
  const c1=await condUi();
  rec('押すと欄が開き、そのまま打てる（焦点が乗る）',
      c1.欄===true&&c1.ボタン===false&&c1.焦点==='filterTokenSearch',JSON.stringify(c1));
  rec('開いた欄は器いっぱいに伸びない（中身なりの幅）',
      await page.evaluate(()=>{
       const w=document.getElementById('filterTokenInput').getBoundingClientRect().width;
       const row=document.querySelector('.filter-search-row').getBoundingClientRect().width;
       return w>0&&w<row*0.5;}),
      await page.evaluate(()=>Math.round(document.getElementById('filterTokenInput').getBoundingClientRect().width)+'px'));

  await page.fill('#filterTokenSearch','ロット');await settle(600);
  rec('打つと候補が出る（機能は消えていない）',(await condUi()).候補===true);
  await page.keyboard.press('Escape');await settle(400);
  const c2=await condUi();
  /* 畳むときは**打ちかけの字も捨てる**——条件はまだ足っていないので、
     残すと次に開いたとき「何か効いている」と読める。 */
  rec('Escで畳み、打ちかけの字も残さない',
      c2.ボタン===true&&c2.欄===false&&c2.字==='',JSON.stringify(c2));

  /* ---- 1) 適用と登録が別々に効く ---- */
  /* §9.286 ①: たまにしか使わない入口は`⋯`の浮きメニューへ畳んだ。**消していない**ので、開いてから押す。 */
  await page.click('#filterMoreBtn');await settle(200);
  await page.click('#filterToggle');await settle(600);
  rec('条件を作るビルダーに「適用」と「登録」がある',
      await page.evaluate(()=>!!document.querySelector('#addGenericFilter')&&!!document.querySelector('#registerGenericFilter')));
  /* §9.80で外した「マスタへ保存」は戻さない（何が登録されたのか・何が
     既に登録済みなのかが読めなくなる）。§9.286 ①の整理で、呼ばれていな
     かった`saveCurrentFiltersToMaster()`も消した。 */
  rec('バーから「マスタへ保存」は無くなっている',
      await page.evaluate(()=>!document.querySelector('#saveFilterPreset')));

  await page.evaluate(v=>{
   const c=document.querySelector('#filterColumn');c.value=c.options[0].value;
   document.querySelector('#filterOp').value='contains';
   const el=document.querySelector('#filterValue');el.value=v;
   el.dispatchEvent(new Event('input',{bubbles:true}));
  },TAG);
  const before=(await presetNames('')).length;
  await page.click('#addGenericFilter');await settle(1400);
  /* 効いている条件は**アイコンと件数の1バッジ**へ畳んだ（§9.287）。条件式と
     登録の印（★／☆）はポップオーバーが持つ——バッジに書くと必ず切れる。 */
  const openConds=async()=>{
   await page.evaluate(()=>{
    if(!document.querySelector('#filterCondMenu'))document.querySelector('#filterCondBtn')?.click();
   });
   await page.waitForSelector('#filterCondMenu',{timeout:5000}).catch(()=>{});
  };
  const closeConds=()=>page.evaluate(()=>{
   if(document.querySelector('#filterCondMenu'))document.querySelector('#filterCondBtn')?.click();
  });
  await openConds();
  rec('「適用」で条件が一覧へ効く（登録はしない）',
      await page.evaluate(t=>[...document.querySelectorAll('#filterCondMenu .fb-cond-text')]
        .some(x=>x.textContent.includes(t)),TAG)
      && (await presetNames('')).length===before,
      `登録件数 ${before}→${(await presetNames('')).length}`);
  rec('未登録の条件は☆で示される',
      await page.evaluate(()=>{const u=document.querySelector('#filterCondMenu .fb-cond-save');
        return !!u&&!u.classList.contains('is-saved')}));
  await closeConds();

  await page.click('#registerGenericFilter');await settle(2500);
  const after=await presetNames('');
  rec('「登録」でマスタへ保存される',after.length===before+1&&after.some(n=>n.includes(TAG)),
      `${before}→${after.length}`);
  await openConds();
  rec('登録済みの条件は★で示される',
      await page.evaluate(()=>{const u=document.querySelector('#filterCondMenu .fb-cond-save');
        return !!u&&u.classList.contains('is-saved')}));
  await closeConds();
  /* 変数はトークンのまま名前に入れる(今の値を焼き込むと、設備が変わる
     たびに同じ条件が別名で増える)。 */
  rec('登録名に今の値を焼き込まない',after.every(n=>!n.includes('（=')),after.slice(-1)[0]||'');

  /* ---- 2) 削除の確認ダイアログが最前面に出る（本題） ---- */
  // 確認ダイアログを先に作っておく＝以前はこれで下敷きになった条件。
  await page.evaluate(()=>{confirmModal('先に1回出しておく')});
  await settle(400);
  await page.evaluate(()=>document.getElementById('appConfirmCancel').click());
  await settle(300);
  await page.evaluate(()=>document.querySelector('#openFilterPresets').click());
  await settle(2500);
  const stack=await page.evaluate(()=>{
   const order=[...document.body.children].map(x=>x.id).filter(Boolean);
   const c=document.getElementById('appConfirmModal'),f=document.getElementById('filterPresetModal');
   return {confirmFirst:order.indexOf('appConfirmModal')<order.indexOf('filterPresetModal'),
           cz:+getComputedStyle(c).zIndex,fz:+getComputedStyle(f).zIndex,open:!f.hidden};
  });
  rec('登録フィルタ一覧が開く',stack.open);
  rec('確認ダイアログの方が手前の重ね順',stack.cz>stack.fz,`確認${stack.cz} > 一覧${stack.fz}`);
  rec('DOM順では確認が先（以前はこれで負けていた）',stack.confirmFirst);
  const clicked=await page.evaluate(t=>{
   const row=[...document.querySelectorAll('#filterPresetList .filter-preset-item')]
    .find(x=>x.textContent.includes(t));
   if(!row)return false;row.querySelector('.danger').click();return true;
  },TAG);
  rec('削除ボタンを押せる',clicked);
  await settle(700);
  const reach=await page.evaluate(()=>{
   const ok=document.getElementById('appConfirmOk');
   if(!ok||document.getElementById('appConfirmModal').hidden)return {none:true};
   const r=ok.getBoundingClientRect();
   const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
   return {reachable:!!(top&&(top===ok||ok.contains(top))),top:top?(top.id||top.className):'なし'};
  });
  rec('確認ダイアログのOKを実際に押せる（下敷きになっていない）',
      !!reach.reachable,JSON.stringify(reach));
  if(reach.reachable){
   await page.evaluate(()=>document.getElementById('appConfirmOk').click());
   await settle(2000);
   rec('削除が実行される',!(await presetNames('')).some(n=>n.includes(TAG)));
  }
  await page.evaluate(()=>{const m=document.getElementById('filterPresetModal');if(m)m.hidden=true});

  /* ---- 3) スケジュールモードでも登録でき、置き場が分かれる ---- */
  await setMode('schedule');
  await openList();
  const sc=await page.evaluate(async t=>{
   const r=await fetch('/api/filter-presets',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:'SC_'+t,db:'SIKALOTNOW',table:'仕掛',mode:'schedule',
      filters:[{column:'BOX設計_設備名',op:'eq',value:'{使用設備}'}],user_id:'tester'})});
   return r.status;
  },TAG);
  rec('スケジュールモードでも登録できる（以前は403）',sc===200,`HTTP ${sc}`);
  const scList=await presetNames('schedule'),common=await presetNames('');
  rec('変数を含む条件も登録できる',scList.some(n=>n.includes(TAG)),scList.join(' / ')||'なし');
  rec('スケジュールモードの条件は共通側へ混ざらない',
      !common.some(n=>n.startsWith('SC_')),`共通=${common.length}件`);

  // 後片付け
  await page.evaluate(async t=>{
   for(const m of ['','schedule']){
    const q=new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',mode:m});
    const items=((await (await fetch('/api/filter-presets?'+q)).json()).items||[]);
    for(const it of items) if(it.name.includes(t))
      await fetch('/api/filter-presets/delete',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({id:it.id,user_id:'tester'})});
   }
  },TAG);
  await setMode('edit');
  try{if(snapM)await H.dropNewMasterRows(snapM)}
  catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}

  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();
  process.exit(ng.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  await setMode('edit').catch(()=>{});
  try{if(snapM)await H.dropNewMasterRows(snapM)}
  catch(e){console.log('!! 増えた行を消せませんでした: '+(e&&e.message||e))}
  await b.close().catch(()=>{});
  process.exit(2);
 }
})().catch(async e=>{console.error('FATAL',e);if(b)await b.close().catch(()=>{});process.exit(2)});
