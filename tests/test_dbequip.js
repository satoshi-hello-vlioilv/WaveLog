/* test_dbequip.js: ダッシュボードの「自設備」タブと、フィルタ条件の変数(§9.74)。
   ------------------------------------------------------------
   自設備ビューは端末内(IndexedDB)の測定データを集計するので、検証用の実績を
   reliablePut で直接入れてから測る(サーバーのバックアップではない)。 */
const API='http://127.0.0.1:5029';
const {run}=require('./lib/harness.js');
/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
run('test_dbequip: 使用設備は WL.equipment の1箇所（§9.285）',async({page,rec,setMode,W,idle,paint})=>{
 const EQ='テスト設備A',OTHER='テスト設備B';
  await setMode('edit');
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid',{timeout:20000});
  await W.booted(page);await idle();

  /* 自設備2件(60分/120分=平均90分)、他設備1件(30分)を入れる。
     平均の差(90-30=60分「遅い」)まで見て、自設備だけを集計していることを確かめる。 */
  const ids=await page.evaluate(async([eq,other])=>{
   const mk=(id,equipment,lot,min,agoDays)=>{
    const end=new Date(Date.now()-agoDays*86400000);
    const start=new Date(end.getTime()-min*60000);
    return {id,status:'完了',basic:{lotNo:lot,purposeName:'検証用途'},
      settings:{registeredEquipment:equipment,operator:'検証員',crewSize:'2',
                verticalCount:1,horizontalCount:1},
      workTime:{startAt:start.toISOString(),endAt:end.toISOString()},
      updatedAt:end.toISOString()};
   };
   const list=[mk('flowA1',eq,'ZZ001',60,1),mk('flowA2',eq,'ZZ002',120,2),
               mk('flowB1',other,'ZZ003',30,1)];
   for(const r of list)await reliablePut(r);
   return list.map(r=>r.id);
  },[EQ,OTHER]);

  await page.click('#openDashboard');await idle(400,15000);
  const tabs=await page.$$eval('[data-dbview]',n=>n.map(x=>x.dataset.dbview));
  rec('ダッシュボードに「自設備」タブがある',tabs.includes('equipment'),tabs.join(','));

  await page.click('[data-dbview="equipment"]');await idle(400,20000);
  const v=await page.evaluate(()=>({
   name:document.querySelector('#dbEquipName')?.textContent||'',
   kpi:[...document.querySelectorAll('#dbEquipKpi .db-card')].map(c=>({
     k:c.querySelector('.db-card-label')?.textContent||'',
     v:c.querySelector('.db-card-value')?.textContent||'',
     note:c.querySelector('.db-card-note')?.textContent||''})),
   product:document.querySelector('#dbEquipProduct')?.innerText||'',
   recent:document.querySelector('#dbEquipRecent')?.innerText||'',
   otherViews:[...document.querySelectorAll('#dbStatusView,#dbPivotView')].filter(e=>!e.hidden).length,
  }));
  rec('使用設備名を出す',v.name.includes(EQ),v.name);
  rec('他のビューは隠れている(重なり無し)',v.otherViews===0,String(v.otherViews));
  const kpi=Object.fromEntries(v.kpi.map(x=>[x.k,x]));
  rec('自設備の完了件数だけを数える(他設備を含めない)',
   kpi['完了ロット']?.v==='2件',JSON.stringify(kpi['完了ロット']));
  rec('平均作業時間が自設備の実績から出る',
   kpi['平均作業時間']?.v==='90分',JSON.stringify(kpi['平均作業時間']));
  rec('全設備平均との差を併記する(速い/遅いが分かる)',
   /遅い|速い|ほぼ同じ/.test(kpi['平均作業時間']?.note||''),kpi['平均作業時間']?.note);
  rec('直近の実績に自設備のロットが並ぶ',
   v.recent.includes('ZZ001')&&v.recent.includes('ZZ002'),v.recent.slice(0,60));
  rec('直近の実績に他設備のロットを混ぜない',!v.recent.includes('ZZ003'),v.recent.slice(0,60));
  rec('品種別の内訳が出る',v.product.includes('検証用途'),v.product.slice(0,50));

  /* ---- フィルタ条件の変数 ---- */
  await page.click('aside [data-db-key="SIKALOTNOW"]');await idle();
  await page.evaluate(()=>document.querySelector('#filterToggle')?.click());
  await idle();
  const chip=await page.evaluate(()=>{
   const w=document.querySelector('#filterVarChips');
   const btn=w?.querySelector('[data-var]');
   return {exists:!!w,label:(btn?.textContent||'').trim(),token:btn?.dataset.var||'',title:btn?.title||''};
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
  const typed=await page.evaluate(()=>{
   document.querySelector('#filterVarChips [data-var]')?.click();
   return document.querySelector('#filterValue')?.value||'';
  });
  rec('ボタンを押すと値欄へ変数が入る',typed==='{使用設備}',typed);

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
   await page.evaluate(()=>load());
   await page.waitForFunction(()=>!document.querySelector('#grid .loading'),{timeout:20000}).catch(()=>{});
   await paint();
  };
  /* 効いている条件は**アイコンと件数の1バッジ**に畳んだ（§9.287、利用者の指示
     「条件式はボタンには長すぎるのでアイコンだけに。その代わりポップオーバーで
      しっかり中身を確認できるように」）。**いまの値（`（=LS4）`）の置き場も
     そこ**——バッジの`title`と、押して開くポップオーバーの本文の両方で読める。 */
  const shot=()=>page.evaluate(()=>{
   const btn=document.querySelector('#filterCondBtn');
   const pop=document.querySelector('#filterCondMenu');
   return {
    rows:document.querySelectorAll('#grid tbody tr').length,
    count:(document.querySelector('#filterCount')||{}).textContent||'',
    tag:(btn&&btn.title)||'',
    pop:pop?[...pop.querySelectorAll('.fb-cond-text')].map(x=>x.textContent).join(' / '):'',
    eq:WL.equipment.get()};
  });
  await applyVarFilter();
  const before=await shot();
  rec('変数の条件が効いている（自設備の行が出る）',before.rows>0&&before.eq===EQ,JSON.stringify(before));
  rec('いまの値を絞り込みバーが文字で出す',before.tag.includes(EQ),before.tag);

  /* **設備を切り替える。読み直しは`WL.equipment.onChange`が起こす。** */
  await page.evaluate(e=>WL.equipment.set(e),OTHER);
  await page.waitForFunction(e=>{
   const b=document.querySelector('#filterCondBtn');
   return !!b&&(b.title||'').includes(e);
  },OTHER,{timeout:15000}).catch(()=>{});
  await idle();
  const after=await shot();
  rec('切り替えた瞬間に一覧が引き直される',
      after.eq===OTHER&&after.rows!==before.rows,
      JSON.stringify({前:before.rows,後:after.rows}));
  rec('絞り込みバーも新しい設備を名乗る',after.tag.includes(OTHER),after.tag);
  /* **ポップオーバーでも読めること**（§9.287。`title`は触る画面では読めない
     ので、それだけを見る網では「見える場所にある」ことを確かめていない）。 */
  await page.evaluate(()=>document.querySelector('#filterCondBtn')?.click());
  await page.waitForSelector('#filterCondMenu',{timeout:5000}).catch(()=>{});
  const popped=await shot();
  rec('ポップオーバーでいまの値まで読める',popped.pop.includes(OTHER),popped.pop.slice(0,80));
  await page.keyboard.press('Escape');

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
  await page.evaluate(()=>load());
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

  // 後始末: 入れた実績を消す
  await page.evaluate(async list=>{
   for(const id of list)if(typeof reliableDelete==='function')await reliableDelete(id);
  },ids).catch(()=>{});

},{viewport:{width:1600,height:1000}});
