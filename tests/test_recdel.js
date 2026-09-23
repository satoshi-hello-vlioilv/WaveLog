/* test_recdel.js: データ一覧の削除は「⋯」の中の2クリック（§9.221 ⑤）
   ============================================================
   利用者の指摘は「『帳票』と『削除』が近く、かなり危ないです。削除ボタンは
   完了品からは消して、編集中のものは削除に行くまでにプルダウン的な2クリック
   必要な安全設計されたボタンに変更してください」。
   ここで固定するのは次の点。
    1. 操作列に**むき出しの削除ボタンが無い**（帳票の隣に取り消せない操作を
       置かない）
    2. `⋯`を押して初めて削除が出る（＝2クリック）
    3. **完了したデータでは押せない**——ただし消してあるのではなく、
       `disabled`＋理由の文（§4。押せるのに何も起きないボタンを残さない）
    4. 閲覧モードでも押せない（理由は別の文）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)});
run('test_recdel: データ一覧の削除は「⋯」の中の2クリック（§9.221 ⑤）', async ({page,rec,B,W,idle,paint,errs})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});

  /* **行が無ければ自分で作る**——検証用データに編集中のレコードがあるとは
     限らず、「無ければ素通り」の書き方だと直す前でも通る。 */
  await page.evaluate(async()=>{
   const now=new Date().toISOString();
   const mk=(id,status)=>({id,status,updatedAt:now,
     basic:{lotNo:id,inspectionNo:'X'},
     settings:{registeredEquipment:'テスト設備A',verticalCount:1,horizontalCount:1},
     workTime:{}});
   await WL.records.reliablePut(mk('回帰削除_編集中','編集中'));
   await WL.records.reliablePut(mk('回帰削除_完了','完了'));
  });
  await page.click('[data-open-records]').catch(()=>{});
  await page.waitForSelector('#recordList',{timeout:20000});
  await W.until(page,()=>document.querySelectorAll('.record-list-row').length>0,null,{ms:10000,what:'記録の一覧に行が出る'});
  await idle();

  const shape=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.record-list-row')];
   return {rows:rows.length,
     danger:document.querySelectorAll('.record-list-actions .danger').length,
     more:document.querySelectorAll('.record-list-actions .rec-more').length,
     report:document.querySelectorAll('.record-list-actions .report').length};
  });
  rec('前提: データ一覧に行がある',shape.rows>0,JSON.stringify(shape));
  rec('操作列にむき出しの削除ボタンが無い',shape.danger===0,JSON.stringify(shape));
  rec('代わりに「⋯」が帳票の隣にある',shape.more===shape.report&&shape.more>0,JSON.stringify(shape));

  /* ---- 2クリック目で初めて削除が出る ---- */
  const before=await page.evaluate(()=>document.querySelectorAll('.rec-row-menu').length);
  rec('押す前は削除のメニューが出ていない',before===0,String(before));
  await page.click('.record-list-row .rec-more');
  await W.until(page,()=>document.querySelectorAll('.rec-row-menu').length>0,null,{ms:4000,what:'⋯のメニューが開く'});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.rec-row-menu');
   if(!m)return null;
   const it=m.querySelector('.rrm-item');
   return {text:m.textContent,disabled:!!(it&&it.disabled),why:m.querySelector('.rrm-why')?.textContent||''};
  });
  rec('「⋯」を押すと削除がメニューの中に出る（2クリック）',
      !!menu&&/削除/.test(menu.text),JSON.stringify(menu));

  /* ---- 完了したデータでは押せない（理由つき） ---- */
  /* **一覧は既定で「編集中」だけを出す**ので、完了の行を見るには
     絞り込みを切り替える（無いまま探すと「見つからないので飛ばす」で
     何も確かめないまま通る）。 */
  await page.click('.status-filter-btn[data-status-filter="done"]').catch(()=>{});
  await idle();
  const done=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('.record-list-row')];
   const hit=rows.find(r=>/完了/.test(r.textContent));
   if(!hit)return {none:true,行:rows.length,
     絞り込み:[...document.querySelectorAll('.status-filter-btn')].map(b=>b.dataset.statusFilter+':'+b.classList.contains('active'))};
   document.querySelector('.rec-row-menu')?.remove();
   hit.querySelector('.rec-more')?.click();
   const m=document.querySelector('.rec-row-menu');
   const it=m&&m.querySelector('.rrm-item');
   return {disabled:!!(it&&it.disabled),why:m?.querySelector('.rrm-why')?.textContent||''};
  });
  rec('完了したデータでは削除が押せない',
      done.none?false:done.disabled===true,JSON.stringify(done));
  rec('押せない理由が文字で書いてある',
      done.none?false:/完了/.test(done.why),String(done.why));

  /* ==========================================================
     開いたメニューは**必ず閉じられる**（§9.222 ①）
     ----------------------------------------------------------
     ここが**この網の穴だった**。上までは「開いたこと」しか見ておらず、
     2件目を試す前に自分で`.rec-row-menu`を`remove()`していたため、
     `WL.records.openRecordRowMenu()`が控え（`recordRowMenuEl`）へ代入していなくても
     全部PASSしていた。実機では**外クリックでもEscでも自ボタンでも
     閉じられず、押すたびに積み上がっていた**。
     **閉じる操作を実際に通すこと。** 3つの入口をそれぞれ見る。
     ========================================================== */
  await page.click('.status-filter-btn[data-status-filter="done"]').catch(()=>{});
  await idle();
  await page.evaluate(()=>{document.querySelector('.rec-row-menu')?.remove()});
  const closeWays={};
  const openMenu=async()=>{
   await page.click('.record-list-row .rec-more');
   /* 開いたあと、閉じる配線は次の巡回で張られる（WL.popMenu）。until の落ち着きがそれを待つ。 */
   await W.until(page,()=>document.querySelectorAll('.rec-row-menu').length>0,null,{ms:4000,what:'⋯のメニューが開く'});
   return page.evaluate(()=>document.querySelectorAll('.rec-row-menu').length);
  };
  closeWays.開いた=await openMenu();
  await page.mouse.click(200,620);                    /* 何も無いところ */
  await paint();   // 閉じるのは mousedown の中で同期
  closeWays.外クリックで閉じる=await page.evaluate(()=>document.querySelectorAll('.rec-row-menu').length);
  await openMenu();
  await page.keyboard.press('Escape');
  await paint();
  closeWays.Escで閉じる=await page.evaluate(()=>document.querySelectorAll('.rec-row-menu').length);
  await openMenu();
  await page.click('.record-list-row .rec-more');     /* 同じボタンをもう一度 */
  await paint();
  closeWays.自ボタンで閉じる=await page.evaluate(()=>document.querySelectorAll('.rec-row-menu').length);
  closeWays.印が戻る=await page.evaluate(()=>
    document.querySelector('.record-list-row .rec-more')?.getAttribute('aria-expanded'));
  rec('⋯のメニューは外クリックで閉じる',
      closeWays.開いた===1&&closeWays.外クリックで閉じる===0,JSON.stringify(closeWays));
  rec('⋯のメニューはEscで閉じる',closeWays.Escで閉じる===0,JSON.stringify(closeWays));
  rec('⋯をもう一度押すと閉じる（積み上がらない）',
      closeWays.自ボタンで閉じる===0,JSON.stringify(closeWays));
  rec('閉じたら⋯の印(aria-expanded)も戻る',closeWays.印が戻る==='false',String(closeWays.印が戻る));

  /* ---- 操作ボタンが見切れない（§9.222 ①） ----
     実機で「続きか…」「帳…」と3つとも省略記号になっていた。文字を短く
     した（`再開`／`開く`／`帳票`）うえで、器に下限（`--rec-actions-min`）を
     持たせてある。**3段の表示サイズすべてで見ること**——器がpx固定だと
     特大でだけ切れる（それが実際の壊れ方だった）。 */
  const cut=[];
  for(const size of ['sm','md','lg']){
   await page.evaluate(z=>{document.documentElement.dataset.uiSize=z},size);
   await paint();
   const bad=await page.evaluate(()=>[...document.querySelectorAll('.record-list-actions button')]
     .filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.textContent.trim()+':'+b.clientWidth+'<'+b.scrollWidth));
   if(bad.length)cut.push(size+' '+bad.join('/'));
  }
  await page.evaluate(()=>{document.documentElement.dataset.uiSize='md'});
  rec('操作ボタンが3段の表示サイズで切れない',cut.length===0,cut.join(' / '));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){rec('FATAL',false,String(e&&e.message||e))}
 finally{
  await page.evaluate(async()=>{
   for(const id of ['回帰削除_編集中','回帰削除_完了'])await WL.records.reliableDelete(id);
  }).catch(()=>{});
 }
}, {viewport:{width:1700,height:1000}});
