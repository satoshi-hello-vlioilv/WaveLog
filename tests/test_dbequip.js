/* test_dbequip.js: ダッシュボードの「自設備」と、フィルタ条件の変数(§9.74・§9.628)。
   ------------------------------------------------------------
   自設備は組み込みのダッシュボード「自設備」（§9.628）。パネルの設備は「この端末の使用設備」（@mine）で、
   画面が問い合わせる前に WL.equipment の設備へ置き換える。数えるのはサーバーの測定データなので、
   検証用の実績はサーバーへ入れる（seedRecord）。 */
const API='http://127.0.0.1:5029';
const {run,seedRecord,clearRecords}=require('./lib/harness.js');
/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。 */
run('test_dbequip: 使用設備は WL.equipment の1箇所（§9.285）',async({page,rec,setMode,W,idle,paint})=>{
 const EQ='テスト設備A',OTHER='テスト設備B';
 await clearRecords();
 try{
  await setMode('edit');
  /* 自設備2件(60分/120分=平均90分)、他設備1件(30分)を入れる。全設備の平均は 70分 → 自設備は 20分「遅い」。
     平均の差まで見て、自設備だけを数えていることと、全設備と比べていることを確かめる。 */
  const mk=(equipment,lot,min,agoDays)=>{
   const end=new Date(Date.now()-agoDays*86400000),start=new Date(end.getTime()-min*60000);
   return seedRecord({equipment,status:'完了',lotNo:lot,extra:{basic:{lotNo:lot,purposeName:'検証用途'},
    settings:{registeredEquipment:equipment,operator:'検証員',crewSize:'2',verticalCount:1,horizontalCount:1},
    workTime:{startAt:start.toISOString(),endAt:end.toISOString()}}});
  };
  await mk(EQ,'ZZ001',60,1);await mk(EQ,'ZZ002',120,2);await mk(OTHER,'ZZ003',30,1);
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid',{timeout:20000});
  await W.booted(page);await idle();

  await W.nav(page,'#openDashboard');
  await W.until(page,()=>!!document.querySelector('#dashGrid .dash-p'),null,{ms:20000,what:'ダッシュボードが開く'});
  const list=await page.evaluate(async()=>(await (await fetch('/api/dashboards')).json()).items.map(x=>x.id));
  rec('組み込みに「自設備」がある',list.includes('b:mine'),list.join(','));
  const panel=id=>page.evaluate(id=>{
   const p=document.querySelector(`#dashGrid .dash-p[data-id="${id}"]`);
   return p?{num:(p.querySelector('.dp-num')||{}).textContent||'',text:p.innerText.replace(/\s+/g,' ')}:null;
  },id);
  const openMine=async want=>{
   await page.evaluate(()=>WL.dashboard._open('b:mine'));
   /* 押した物（開いたダッシュボード）の全部のパネルが数を出すまで（数えています… が1枚も無い） */
   await W.until(page,w=>{const p=document.querySelector('#dashGrid .dash-p[data-id="mineLots"] .dp-num');
    return !!p&&p.textContent.startsWith(w)&&![...document.querySelectorAll('#dashGrid .dash-p')].some(x=>x.querySelector('.dp-wait'))},want,{ms:30000,what:`自設備の完了ロットが ${want}`});
  };
  await openMine('2');
  const lots=await panel('mineLots'),avg=await panel('mineAvg');
  rec('自設備の完了件数だけを数える(他設備を含めない)',lots.num.startsWith('2'),JSON.stringify(lots));
  /* 設備の名前は、多くのパネルで同じなら道具の行の「パネル共通」に1回（§9.628）、違えばパネルの添え書きに */
  const common=await page.evaluate(()=>(document.querySelector('#dashBar .dash-common')||{}).textContent||'');
  rec('使用設備名を出す（@mine の字を出さない）',(lots.text.includes(EQ)||common.includes(EQ))&&!(lots.text+common).includes('@mine'),`${lots.text.slice(0,60)} ／ 共通 ${common}`);
  rec('平均作業時間が自設備の実績から出る',avg.num.startsWith('90'),JSON.stringify(avg));
  rec('全設備との差を併記する(速い/遅いが分かる)',/全設備/.test(avg.text)&&/20/.test(avg.text),avg.text.slice(0,120));
  const rows=await page.evaluate(()=>(document.querySelector('#dashGrid .dash-p[data-id="mineOp"]')||{}).innerText||'');
  rec('オペレータごとの実績に自設備の作業が並ぶ',rows.includes('検証員')&&/\b2\b/.test(rows),rows.slice(0,80));
  const kind=await page.evaluate(()=>(document.querySelector('#dashGrid .dash-p[data-id="mineKind"]')||{}).innerText||'');
  rec('品種ごとの内訳が出る',kind.includes('検証用途'),kind.slice(0,50));
  /* 使用設備を切り替えたら、その瞬間に自設備が引き直される（WL.equipment.onChange） */
  await page.evaluate(e=>WL.equipment.set(e),OTHER);
  await W.until(page,()=>{const p=document.querySelector('#dashGrid .dash-p[data-id="mineLots"] .dp-num');return !!p&&p.textContent.startsWith('1')},null,{ms:20000,what:'切り替えた設備で数え直す'});
  rec('使用設備を切り替えると自設備が数え直される',(await panel('mineLots')).num.startsWith('1'));
  await page.evaluate(e=>WL.equipment.set(e),EQ);
  await openMine('2');

  /* ---- フィルタ条件の変数 ---- */
  await page.click('aside [data-db-key="SIKALOTNOW"]');await idle();
  await page.waitForSelector('#grid tbody tr',{timeout:20000});
  /* 変数の挿入ボタンは列の値の一覧の「値ではなく条件で絞る」の中（§9.614）。 */
  await page.evaluate(()=>WL.filters.openColumn('BOX設計_設備名',document.getElementById('filterSavedBtn')));
  await page.waitForSelector('#filterColPop .flt-cp-cond',{timeout:10000});
  await page.evaluate(()=>{document.querySelector('#filterColPop .flt-cp-cond').open=true});
  const chip=await page.evaluate(()=>{
   const btn=document.querySelector('#filterColPop [data-var]');
   return {exists:!!btn,label:(btn?.textContent||'').trim(),token:btn?.dataset.var||'',title:btn?.title||''};
  });
  rec('変数の挿入ボタンがある',chip.exists&&chip.token==='{使用設備}',JSON.stringify(chip));
  rec('今の値をボタンの説明に出す',chip.title.includes(EQ),chip.title);

  const exp=await page.evaluate(()=>({
   only:WL.expandFilterVars('{使用設備}'),
   mixed:WL.expandFilterVars('前{使用設備}後'),
   plain:WL.expandFilterVars('ただの文字'),
  }));
  rec('変数が使用設備へ展開される',exp.only===EQ,JSON.stringify(exp));
  rec('文字列の途中でも展開される',exp.mixed===`前${EQ}後`,exp.mixed);
  rec('変数を含まない値はそのまま',exp.plain==='ただの文字',exp.plain);

  // 押すと値欄へトークンが入る(手打ちさせない)
  await page.click('#filterColPop [data-var]');
  const typed=await page.evaluate(()=>document.querySelector('#filterColPop .flt-cp-cond-row input')?.value||'');
  rec('ボタンを押すと値欄へ変数が入る',typed==='{使用設備}',typed);
  await page.keyboard.press('Escape');

  /* ---- 使用設備を切り替えたら、その瞬間に効く（§9.285 ①） ----
     利用者の報告「フィルタの変数『使用設備』が、使用設備を切り替えても
     その切り替えた瞬間に反映されない」。展開は送信直前なので**値は最初から
     正しかった**——足りなかったのは「もう一度引く人」。
     **素通りに注意**: `WL.expandFilterVars`だけを見る網は直す前でも通る
     （あれは最初から新しい値を返す）。**一覧の件数**と**絞り込みバーの
     文字**が実際に変わることまで見る。 */
  const applyVarFilter=async()=>{
   await page.evaluate(()=>{
    S.genericFilters=[{column:'BOX設計_設備名',op:'eq',value:'{使用設備}'}];
    S.page=1;
   });
   await page.evaluate(()=>WL.list.load());
   await page.waitForFunction(()=>!document.querySelector('#grid .loading'),{timeout:20000}).catch(()=>{});
   await paint();
  };
  /* 効いている条件は件数の右の札（§9.614）。**いまの値（`（=LS4）`）は札の字そのもの**で読める
     （前は畳んだバッジの`title`とポップオーバーにしか無かった）。 */
  const shot=()=>page.evaluate(()=>({
    rows:document.querySelectorAll('#grid tbody tr').length,
    tag:[...document.querySelectorAll('#filterChips .flt-chip')].map(x=>x.textContent).join(' / '),
    eq:WL.equipment.get()}));
  await applyVarFilter();
  const before=await shot();
  rec('変数の条件が効いている（自設備の行が出る）',before.rows>0&&before.eq===EQ,JSON.stringify(before));
  rec('いまの値を絞り込みバーが文字で出す',before.tag.includes(EQ),before.tag);

  /* **設備を切り替える。読み直しは`WL.equipment.onChange`が起こす。** */
  await page.evaluate(e=>WL.equipment.set(e),OTHER);
  await page.waitForFunction(e=>[...document.querySelectorAll('#filterChips .flt-chip')].some(x=>x.textContent.includes(e)),OTHER,{timeout:15000}).catch(()=>{});
  await idle();
  const after=await shot();
  rec('切り替えた瞬間に一覧が引き直される',
      after.eq===OTHER&&after.rows!==before.rows,
      JSON.stringify({前:before.rows,後:after.rows}));
  rec('絞り込みバーも新しい設備を名乗る',after.tag.includes(OTHER),after.tag);
  /* 戻したら元へ戻る（片道にしない）。 */
  await page.evaluate(e=>WL.equipment.set(e),EQ);
  await page.waitForFunction(n=>document.querySelectorAll('#grid tbody tr').length===n,
                             before.rows,{timeout:15000}).catch(()=>{});
  const back=await shot();
  rec('戻すと元の件数に戻る',back.rows===before.rows&&back.eq===EQ,
      JSON.stringify({戻り:back.rows,元:before.rows}));

  /* **変数を使っていない一覧は読み直さない**——関係の無い一覧まで引き直すと、
     重い一覧では設備を選び直しただけで数秒止まる。 */
  await page.evaluate(()=>{S.genericFilters=[];S.page=1});
  await page.evaluate(()=>WL.list.load());
  await idle();
  const quiet=await page.evaluate(async(other)=>{
   let n=0;
   const orig=window.load;
   window.load=function(){n++;return orig.apply(this,arguments)};
   WL.equipment.set(other);
   await new Promise(r=>setTimeout(r,600));
   window.load=orig;
   return n;
  },OTHER);
  rec('変数を使っていないときは引き直さない',quiet===0,String(quiet));
  await page.evaluate(e=>WL.equipment.set(e),EQ);
  await idle();

 }finally{await clearRecords()}
},{viewport:{width:1600,height:1000}});
