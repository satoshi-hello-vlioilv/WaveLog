/* test_collayout.js: 一覧の列の並び・幅・表示(§9.88 段1)
   ============================================================
   利用者が決めた「どの順で、どの幅で、出すか出さないか」を覚えて、
   次に同じ一覧を開いたときも同じ形で出す。

   ここで固定するのは、崩れると使い物にならなくなる次の点。
    1. 覚えている並び・非表示・幅が実際の表に効く
    2. **データ側の項目が増減しても設定が壊れない**
       (記録に無い列は末尾へ、記録にあって今は無い列は捨てる)
    3. 幅は colgroup で与える(thへ直接書くとセルの内容で押し広げられる)
    4. 見出しは掴める(並べ替え)し、右端に幅の取っ手がある
    5. 保存するのは**許可された全列の並び**。見えている分だけ保存すると、
       非表示にしていた列の位置が失われる
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null,target='';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,90))});
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'load'});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);

  const cols=()=>page.evaluate(()=>[...document.querySelectorAll('#grid th[data-sort-col]')].map(t=>t.dataset.sortCol));
  const base=await cols();
  target=await page.evaluate(()=>listLayoutTarget());
  rec('この一覧のスコープが決まる',/^list:.+:.+$/.test(target),target);
  rec('列が並んでいる',base.length>=5,`${base.length}列`);

  /* ---- 1) 見出しの操作の受け口があること ---- */
  const afford=await page.evaluate(()=>({
   draggable:[...document.querySelectorAll('#grid th[data-sort-col]')].filter(t=>t.draggable).length,
   grips:document.querySelectorAll('#grid th[data-sort-col] .col-resize').length,
   total:document.querySelectorAll('#grid th[data-sort-col]').length,
  }));
  rec('見出しは掴んで並べ替えできる',afford.draggable===afford.total,`${afford.draggable}/${afford.total}`);
  rec('見出しに列幅の取っ手がある',afford.grips===afford.total,`${afford.grips}/${afford.total}`);

  /* ---- 2) 並び・非表示・幅が効く ---- */
  const apply=(order,widths,hidden)=>page.evaluate(async a=>{
   await WL.columnLayout.save(listLayoutTarget(),a);renderGrid();
  },{order,widths:widths||{},hidden:hidden||[]});

  await apply([base[2],base[0],base[1],...base.slice(3)],{[base[0]]:222},[base[1]]);
  await page.waitForTimeout(250);
  const after=await cols();
  rec('決めた順で並ぶ',after[0]===base[2]&&after[1]===base[0],`${after.slice(0,3).join(' / ')}`);
  rec('非表示にした列は出ない',!after.includes(base[1]),base[1]);
  const w=await page.evaluate(()=>{
   const cg=document.querySelector('#grid table colgroup');
   return cg?[...cg.children].map(c=>c.style.width||'').filter(Boolean):[];
  });
  rec('幅はcolgroupで与える',w.includes('222px'),JSON.stringify(w));

  /* ---- 3) 一覧を開き直しても残る ---- */
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1200);
  const reloaded=await cols();
  rec('開き直しても同じ並びで出る',reloaded[0]===base[2]&&!reloaded.includes(base[1]),
   reloaded.slice(0,3).join(' / '));

  /* ---- 4) 項目が増減しても壊れない ---- */
  // **これが要点**。データ側の列は運用中に変わる。知らない列が来ても
  // 落ちず、記録にある列が消えても引きずらない。
  const mixed=await page.evaluate(k=>{
   const l=WL.columnLayout;
   const t=listLayoutTarget();
   // 記録には「今は無い列」を混ぜ、実際の列には「記録に無い列」を混ぜる
   const cur=l.get(t);
   l.get(t).order=['存在しない列X',...cur.order];
   return {
    withNew:l.apply(t,[...S.columns,'新しく増えた列Z']),
    hiddenKept:l.get(t).hidden,
   };
  },null);
  rec('記録に無い列は末尾に回る',
   mixed.withNew[mixed.withNew.length-1]==='新しく増えた列Z',
   mixed.withNew.slice(-2).join(' / '));
  rec('記録にあって今は無い列は捨てる',!mixed.withNew.includes('存在しない列X'));

  /* ---- 5) 非表示の列の位置も覚えている ---- */
  // 見えている分だけ保存すると、非表示を戻したときに末尾へ飛ぶ。
  const saved=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target))).json();
  rec('保存には非表示の列も並びとして残る',
   (saved.order||[]).includes(base[1]),`${(saved.order||[]).length}列を記録`);
  rec('非表示の指定も保存されている',(saved.hidden||[]).includes(base[1]),
   JSON.stringify(saved.hidden));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  // 検証で作った並びは消す(次のテストや実機の設定を汚さない)。
  if(target)await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],user_id:'test'});
  process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  if(target)await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],user_id:'test'}).catch(()=>{});
  process.exit(2);
 }
})();
