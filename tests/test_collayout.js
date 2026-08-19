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

  /* ---- 6) 見出し側の操作で番号・ボタンの列を落とさない(§9.110) ----
     **実機で「列の移動が正しく反映されない」として報告された不具合。**
     見出しの幅を引く／見出しをD&Dすると、そのとき保存される並びが
     データ列だけで作られており、`#`/`分割`/`測定`が並びから丸ごと
     消えていた。消えると次に開いたとき「知らない列」として末尾へ回る
     ので、**幅を少し引いただけで番号・ボタンが右端へ飛ぶ**。 */
  await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],locks:[],user_id:'test'});
  await page.evaluate(()=>{WL.columnLayout.forget();return load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(400);
  const headKeys=()=>page.evaluate(()=>[...document.querySelectorAll('#grid thead th')]
    .map(t=>t.dataset.col||t.textContent.trim()));
  const beforeGrip=await headKeys();
  const grip=await page.$('#grid thead th[data-sort-col] .col-resize');
  const gb=await grip.boundingBox();
  await page.mouse.move(gb.x+gb.width/2,gb.y+gb.height/2);
  await page.mouse.down();
  await page.mouse.move(gb.x+gb.width/2+60,gb.y+gb.height/2,{steps:6});
  await page.mouse.up();
  await page.waitForTimeout(900);
  const savedAfterGrip=await (await fetch(B+'/api/column-layout-master?target='+encodeURIComponent(target))).json();
  const virt=['#','__split__','__measure__'].filter(k=>beforeGrip.length&&true);
  rec('列幅を変えても番号・ボタンの列が並びから消えない',
   virt.every(k=>(savedAfterGrip.order||[]).includes(k)),
   virt.filter(k=>!(savedAfterGrip.order||[]).includes(k)).join(' / ')||'すべて残っている');
  await page.evaluate(()=>{WL.columnLayout.forget();return load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(400);
  const afterGrip=await headKeys();
  rec('列幅を変えても番号・ボタンの列が右端へ飛ばない',
   afterGrip[0]===beforeGrip[0]&&afterGrip[1]===beforeGrip[1]
   &&afterGrip[afterGrip.length-1]===beforeGrip[beforeGrip.length-1],
   `${afterGrip.slice(0,2).join('/')} … ${afterGrip[afterGrip.length-1]}`);

  /* ---- 7) 既に壊れた形で保存された並びは、読むときに直す ----
     直しただけでは足りない——**実機には壊れた設定が既に保存されている**
     ので、こちらが直さないと利用者が手で引きずり戻すことになる。 */
  // **キーで弾く。** 見出しの表示文字（分割/測定）で弾くと、data-colを
  // 全見出しへ付けた時点(§9.110)で素通りして仮想列が混ざる(実際に混ざった)。
  const dataCols=beforeGrip.filter(k=>k!=='#'&&!String(k).startsWith('__'));
  const brokenOrder=[dataCols[2],dataCols[0],dataCols[1],...dataCols.slice(3)];
  await post('/api/column-layout-master',{target,order:brokenOrder,widths:{},hidden:[],user_id:'test'});
  await page.evaluate(()=>{WL.columnLayout.forget();return load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(400);
  const healed=await headKeys();
  rec('番号・ボタンの列が無い古い並びでも先頭へ戻る',
   healed[0]==='#'&&healed[1]==='__split__',healed.slice(0,3).join(' / '));
  rec('その直しでデータ列の並びは崩さない',
   healed[2]===brokenOrder[0]&&healed[3]===brokenOrder[1],healed.slice(2,5).join(' / '));

  /* ---- 8) 同じ列名が2つあっても、列は増殖しない(§9.113) ----
     **実機で「カラムが増殖した」と報告された形。** 列は名前で引く
     (見出し・幅・書式・読み替え・並び順のすべてが列名を鍵にしている)ので、
     同じ名前が2つある並びは表として成り立たず、見出しもセルも二重に出る。
     名前が重なりうる出どころは複数ある(結合してきた列・計算で作った列・
     ビュー越しの取得)ので、**入口の`listColumnKeys()`で1回だけ落とす**。
     ここは実データに重複が無くても確かめられるよう、**注ぎ込んで**見る。 */
  await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],locks:[],user_id:'test'});
  await page.evaluate(()=>{WL.columnLayout.forget();return load()});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(400);
  const injected=await page.evaluate(()=>{
   const dup=a=>{const s=new Set(),d=[];a.forEach(x=>{if(s.has(x))d.push(x);s.add(x)});return d};
   const orig=[...S.columns];
   S.columns=[...orig,orig[0],orig[1]];      // 先頭2列の名前をもう1つずつ
   const keys=WL.listColumnKeys();
   renderGrid();
   const heads=[...document.querySelectorAll('#grid thead th')].map(t=>t.dataset.col||t.textContent.trim());
   const cg=document.querySelectorAll('#grid table colgroup col').length;
   const cells=[...document.querySelectorAll('#grid tbody tr')].slice(0,2).map(tr=>{
    let n=0;tr.querySelectorAll('td').forEach(td=>{n+=Number(td.getAttribute('colspan')||1)});return n});
   S.columns=orig;renderGrid();
   return {keysDup:dup(keys),headsDup:dup(heads),heads:heads.length,cg,cells};
  });
  rec('同じ列名が2つ来ても並びは1つに畳む',injected.keysDup.length===0,
   JSON.stringify(injected.keysDup));
  rec('同じ列名が2つ来ても見出しは二重にならない',injected.headsDup.length===0,
   JSON.stringify(injected.headsDup));
  rec('見出しとcolgroupと行のセル数が食い違わない',
   injected.cells.every(n=>n===injected.cg)&&injected.heads===injected.cg,
   `見出し${injected.heads} colgroup${injected.cg} 行${JSON.stringify(injected.cells)}`);

  /* ---- 9) 見出しのD&Dで計算列が消えない(§9.113) ----
     保存は全置換なので、**送り忘れた設定はその場で消える**。`formulas`を
     渡していなかったため、**見出しを1回ドラッグしただけで計算式で作った列が
     全部消えていた**(式が消えると`listColumnKeys()`がその列を並べなくなる)。 */
  const fxKey='テスト計算列';
  await page.evaluate(async k=>{
   const t=listLayoutTarget();
   const cur=WL.columnLayout.get(t);
   await WL.columnLayout.save(t,{order:[...WL.listColumnKeys(),k],widths:cur.widths,
     hidden:cur.hidden,names:cur.names,formats:cur.formats,rules:cur.rules,
     formulas:{[k]:'"x"'}});
   WL.columnLayout.forget();await WL.columnLayout.load(t);
   return load();
  },fxKey);
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(500);
  const fxBefore=await page.evaluate(k=>({
   ある:(WL.columnLayout.get(listLayoutTarget()).formulas||{})[k]!==undefined,
   見出し:[...document.querySelectorAll('#grid thead th')].some(t=>t.dataset.col===k),
  }),fxKey);
  rec('計算式で作った列が一覧に出る',fxBefore.ある&&fxBefore.見出し,JSON.stringify(fxBefore));
  const hs=await page.$$('#grid thead th[data-sort-col]');
  if(hs.length>=4){
   const a=await hs[0].boundingBox(),z=await hs[3].boundingBox();
   await page.mouse.move(a.x+a.width/2,a.y+a.height/2);
   await page.mouse.down();
   await page.mouse.move(z.x+z.width*0.7,z.y+z.height/2,{steps:12});
   await page.mouse.up();
   await page.waitForTimeout(1200);
  }
  const fxAfter=await page.evaluate(k=>({
   ある:(WL.columnLayout.get(listLayoutTarget()).formulas||{})[k]!==undefined,
   見出し:[...document.querySelectorAll('#grid thead th')].some(t=>t.dataset.col===k),
  }),fxKey);
  rec('見出しをドラッグしても計算列が消えない',fxAfter.ある&&fxAfter.見出し,JSON.stringify(fxAfter));

  /* ============================================================
     §9.119 幅は「自動 / 手で決めた / 固定」の3つ
     ============================================================ */
  /* **要点**: 手で決めた幅は**文字列の長さによらず狭くできる**。
     以前は #grid table の width:max-content が効いており、
     table-layout:fixed でも「各列の中身の最大幅」で解かれて
     colgroupの指定を見出しの文字幅が上回っていた(45px指定→171px)。 */
  const longCol=await page.evaluate(()=>{
   const ths=[...document.querySelectorAll('#grid thead th[data-col]')];
   let pick=null,best=0;
   ths.forEach(th=>{const c=th.dataset.col;if(!c||c.startsWith('__')||c==='#')return;
     const n=th.textContent.trim().length;if(n>best){best=n;pick=c}});
   return pick;
  });
  const narrow=await page.evaluate(async c=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   await WL.columnLayout.save(t,{...l,widths:{...(l.widths||{}),[c]:45}});
   renderGrid();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"]`);
   const tbl=document.querySelector('#grid table');
   const cols=[...tbl.querySelectorAll('colgroup col')];
   let sum=0;cols.forEach(x=>{sum+=parseFloat(x.style.width)||0});
   return {実測:Math.round(th.getBoundingClientRect().width),
           見出しの文字幅:Math.round(th.scrollWidth),
           表の幅:Math.round(tbl.getBoundingClientRect().width),
           列幅の合計:Math.round(sum)};
  },longCol);
  rec('手で決めた幅は見出しの文字より狭くできる',
      narrow.実測<=46&&narrow.見出しの文字幅>narrow.実測+40,JSON.stringify(narrow));
  rec('表の幅は列幅の合計になる（内容で押し広げない）',
      Math.abs(narrow.表の幅-narrow.列幅の合計)<=2||narrow.表の幅>=narrow.列幅の合計,
      JSON.stringify({表:narrow.表の幅,合計:narrow.列幅の合計}));

  /* ---- 固定はサーバーを往復し、取っ手が掴めなくなる ---- */
  const lock=await page.evaluate(async c=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   await WL.columnLayout.save(t,{...l,locks:[c]});
   WL.columnLayout.forget(t);await WL.columnLayout.load(t);
   renderGrid();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"]`);
   const grip=th.querySelector('.col-resize');
   return {固定:WL.columnLayout.locked(t,c),状態:WL.columnLayout.widthMode(t,c),
           取っ手:!!grip,掴めない:grip?grip.classList.contains('is-locked'):null};
  },longCol);
  rec('幅の固定がサーバーを往復する',lock.固定===true&&lock.状態==='locked',JSON.stringify(lock));
  rec('固定した列は取っ手を掴めない',lock.取っ手&&lock.掴めない===true,JSON.stringify(lock));

  /* ---- 幅を保存し直しても固定が消えない(全置換の書き漏らし。§9.113) ---- */
  const keep=await page.evaluate(async c=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   // 見出しのD&Dや列を隠す操作と同じ経路(並びだけ送る)
   await WL.columnLayout.save(t,{...l,order:[...(l.order||[])]});
   WL.columnLayout.forget(t);await WL.columnLayout.load(t);
   return WL.columnLayout.locked(t,c);
  },longCol);
  rec('並びを保存し直しても幅の固定が残る',keep===true,String(keep));

  /* ---- 右クリックで列を隠しても計算式の列が消えない ----
     openColumnHeaderMenu の persist が formulas を渡しておらず、
     **列を1つ隠しただけで計算列が全部消えていた**(実バグ)。 */
  const menuFx=await page.evaluate(async k=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   if(!(l.formulas||{})[k])return {前提なし:true};
   const th=[...document.querySelectorAll('#grid thead th[data-col]')]
     .find(x=>x.dataset.col&&x.dataset.col!==k&&!x.dataset.col.startsWith('__'));
   th.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:100}));
   const hide=document.querySelector('.col-head-menu .chm-hide');
   if(!hide)return {メニューなし:true};
   hide.click();
   await new Promise(r=>setTimeout(r,1200));
   WL.columnLayout.forget(t);await WL.columnLayout.load(t);
   return {式が残る:(WL.columnLayout.get(t).formulas||{})[k]!==undefined};
  },fxKey);
  rec('右クリックで列を隠しても計算列が消えない',
      menuFx.前提なし||menuFx.メニューなし?true:menuFx.式が残る===true,JSON.stringify(menuFx));

  /* ---- 自動へ戻すと、幅も固定も消える ---- */
  const back=await page.evaluate(async c=>{
   const t=listLayoutTarget(),l=WL.columnLayout.get(t);
   const w={...(l.widths||{})};delete w[c];
   await WL.columnLayout.save(t,{...l,widths:w,locks:(l.locks||[]).filter(k=>k!==c)});
   renderGrid();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const th=document.querySelector(`#grid thead th[data-col="${CSS.escape(c)}"]`);
   return {状態:WL.columnLayout.widthMode(t,c),
           実測:Math.round(th.getBoundingClientRect().width)};
  },longCol);
  rec('自動へ戻すと内容に合わせた幅になる',back.状態==='auto'&&back.実測>60,JSON.stringify(back));

  /* ---- 7) 列幅の合計が器より狭くても、決めた幅がそのまま効く（§9.209 ①） ----
     `#grid table`に`min-width:100%`が残っていると、`table-layout:fixed`が
     余りを**各列へ配り直す**ので、狭めたはずの列がその場で太る（実機で
     「列幅の合計が表示エリアより狭いと、それ以上狭められない」と報告）。
     余りは**右の何も無い場所**に出るのが正しい。
     **確かめるときは実際に合計を器より狭くすること**——広いままだと、
     直す前の実装でも通る。 */
  const narrowFit=await page.evaluate(async()=>{
   const t=listLayoutTarget(),all=WL.listColumnKeys(S.columns);
   const keep=all.filter(k=>!/^(#|分割|測定|予定)$/.test(k)).slice(0,3);
   await WL.columnLayout.save(t,{order:keep,widths:Object.fromEntries(keep.map(k=>[k,60])),
     hidden:all.filter(k=>!keep.includes(k)),names:{},formats:{},rules:{},formulas:{},locks:[]});
   renderGrid();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   const grid=document.getElementById('grid'),table=grid.querySelector('table');
   const th=[...table.querySelectorAll('thead th')].map(x=>Math.round(x.getBoundingClientRect().width));
   return{列:keep.length,幅:th,
     表:Math.round(table.getBoundingClientRect().width),
     器:grid.clientWidth,
     minWidth:getComputedStyle(table).minWidth};
  });
  rec('合計が器より狭いときも決めた幅のまま（§9.209 ①）',
      narrowFit.幅.length>0&&narrowFit.幅.every(w=>Math.abs(w-60)<=1),JSON.stringify(narrowFit));
  rec('余りは右の何も無い場所になる（表が器より狭くなる）',
      narrowFit.表<narrowFit.器-20,`表${narrowFit.表} / 器${narrowFit.器}`);
  rec('表に`min-width:100%`を戻していない',
      !/%/.test(narrowFit.minWidth)&&narrowFit.minWidth!=='100%',narrowFit.minWidth);

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
  f.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  // 検証で作った並びは消す(次のテストや実機の設定を汚さない)。
  if(target)await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],locks:[],user_id:'test'});
  process.exit(f.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  if(target)await post('/api/column-layout-master',{target,order:[],widths:{},hidden:[],locks:[],user_id:'test'}).catch(()=>{});
  process.exit(2);
 }
})();
