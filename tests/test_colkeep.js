/* test_colkeep.js: 一覧の表示列が消えない／表示中・非表示中で絞れる（§9.248 ③④）
   ============================================================
   利用者の報告（③）:
     「一覧表関係（仕掛一覧、品質データ、作業スケジュール表など）の表示列が
      一部表示されなかったり消えていることがあります。」
   利用者の指示（④）:
     「列のカスタム機能の中の表示する列のフィルタ機能について、バッジを使って
      フィルタする機能がありますが、『表示中の列』と『非表示中の列』という
      バッジを追加してほしいです。」

   ③の原因は**「保存する並び」を『その瞬間に画面へ出ている列』だけから
   作っていた**こと。`S2.keys()`／`timelineAllColumnKeys()`の顔ぶれは場面で
   縮む（結合が当たっていない・別のモードで開いた・内容欄のマスタがまだ
   届いていない）ので、そのとき列幅や表示を1つ変えるだけで、**居なかった列が
   保存済みの並びから丸ごと消える**。消えた列は次に出てきたとき「知らない列」
   として末尾へ回るため、利用者からは「列の順番が勝手に変わった／列が消えた」
   と見える。`bindColumnHeaderTools`の`fullOrder()`は§9.216 ②で同じ理由から
   既に直っていたが、**右クリックのメニューと作業スケジュール表は
   取り残されていた**。

   ここで固定すること。**どれも直す前なら落ちる**ことを確かめてある。
    1. 保存済みの並びに「いま出せない列」が入っていても、右クリックの
       メニューから設定を変えたときに**落とさない**
    2. 列の設定パネルから保存したときも**落とさない**
    3. もう片側——いま出せる列は今までどおり並びに入る（何も保存しない
       実装でも通る網にしない）
    4. 「表示中の列」「非表示中の列」の札で絞れる（出どころとは**別の軸**で、
       かけ合わせて効く）
    5. 札の件数はチェックを触るたびに合う（画面の数と行数が食い違わない）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(body)}).then(async r=>({code:r.status,json:await r.json().catch(()=>({}))}));
let b=null,TARGET='';
/* 列レイアウトマスタは**実行をまたいで生き延びる**（§9.121）ので必ず消す。 */
const clear=()=>TARGET?post('/api/column-layout-master',{target:TARGET,clear:true,order:[],
  widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'tests'})
  .catch(()=>{}):Promise.resolve();

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,160)));
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  /* 使用設備を登録してから開き直す（他の一覧のテストと同じ手順）——
     登録していないと仕掛一覧が「設備を設定してください」で止まる。 */
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#grid table',{timeout:30000});
  await page.waitForSelector('#grid th[data-col]',{timeout:30000});
  await page.waitForTimeout(1200);
  TARGET=await page.evaluate(()=>WL.list.listLayoutTarget());
  rec('前提: 仕掛一覧が開けて対象が決まる',!!TARGET,TARGET);
  await clear();
  await page.evaluate(()=>WL.columnLayout.forget&&WL.columnLayout.forget());

  /* ==========================================================
     1) 右クリックのメニューから設定を変えても、いま出せない列を落とさない
     ---------------------------------------------------------
     **保存済みの並びに「幻の列」を仕込む**——結合が当たっていない状態や、
     別のモードで保存された並びの代わり。実データの列名と重ならない名前に
     しておく（重なると「落とさない」を確かめたことにならない）。
     ========================================================== */
  const GHOST='__回帰_いま出せない列__';
  const before=await page.evaluate(async g=>{
   const t=WL.list.listLayoutTarget();
   const live=WL.listColumnKeys();
   /* 幻の列を**先頭でも末尾でもない位置**へ入れる（端だけを見る網にしない）。 */
   const order=[...live.slice(0,3),g,...live.slice(3)];
   await WL.columnLayout.save(t,{order,widths:{},hidden:[],names:{},formats:{},
     rules:{},formulas:{},locks:[]});
   return (WL.columnLayout.saved(t).order||[]).includes(g);
  },GHOST);
  rec('前提: 保存済みの並びに「いま出せない列」を仕込めた',before,String(before));

  /* 右クリックのメニューから「幅を自動へ戻す」を押す＝`persist()`が走る。
     **画面の操作から起こすこと**——`patch()`を直に叩く網は、画面が
     何を送っているかを一度も通らない。 */
  const menuOk=await page.evaluate(()=>{
   const th=document.querySelector('#grid th[data-col]');
   if(!th)return false;
   th.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,
     clientX:Math.round(th.getBoundingClientRect().left+8),
     clientY:Math.round(th.getBoundingClientRect().top+8)}));
   return !!document.querySelector('.chm-hide');
  });
  rec('前提: 見出しの右クリックでメニューが開く',menuOk,String(menuOk));
  /* **`persist()`が確かに走る操作を押すこと**——押しても保存しないボタンだと、
     直す前の実装でも「並びが変わっていない」で通ってしまう（実際に素通りした）。
     `chm-autofit`（幅を内容に合わせる）は`persist({widths})`を通る。 */
  const pressed=await page.evaluate(()=>{
   const b=document.querySelector('.col-head-menu .chm-autofit');
   if(!b)return false;b.click();return true;
  });
  rec('前提: 保存が走るメニュー（幅を内容に合わせる）を押せた',pressed,String(pressed));
  await page.waitForTimeout(900);
  const afterMenu=await page.evaluate(g=>{
   const t=WL.list.listLayoutTarget();
   const o=WL.columnLayout.saved(t).order||[];
   return {残った:o.includes(g),件数:o.length,
     いま出せる列も入っている:WL.listColumnKeys().every(k=>o.includes(k))};
  },GHOST);
  rec('右クリックのメニューで設定を変えても、いま出せない列を落とさない',
      afterMenu.残った,JSON.stringify(afterMenu));
  /* **もう片側**——いま出せる列は今までどおり並びに入る（何も保存しない
     実装でも「落とさない」だけは通ってしまう）。 */
  rec('いま出せる列は今までどおり並びに入る',
      afterMenu.いま出せる列も入っている,JSON.stringify(afterMenu));

  /* ==========================================================
     2) 列の設定パネルから保存しても落とさない
     ========================================================== */
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  /* パネルには**出せない列は並ばない**（並べても押せない行になる）。
     そのうえで保存すると並びから消える、というのが直す前の姿。 */
  const inPanel=await page.evaluate(g=>
    [...document.querySelectorAll('#listColumnPanel .lc-item')].some(x=>x.dataset.key===g),GHOST);
  rec('前提: パネルには「いま出せない列」は並ばない',!inPanel,String(inPanel));
  await page.evaluate(()=>{const b=document.querySelector('#lcSave');if(b)b.click()});
  await page.waitForTimeout(900);
  const afterPanel=await page.evaluate(g=>{
   const t=WL.list.listLayoutTarget();
   const o=WL.columnLayout.saved(t).order||[];
   return {残った:o.includes(g),件数:o.length};
  },GHOST);
  rec('列の設定パネルから保存しても、いま出せない列を落とさない',
      afterPanel.残った,JSON.stringify(afterPanel));

  /* ==========================================================
     3) 「表示中の列」「非表示中の列」の札（§9.248 ④）
     ========================================================== */
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  const chips=await page.evaluate(()=>{
   const box=document.getElementById('lcOrigins');
   return {出どころ:[...box.querySelectorAll('.lc-origin-chip:not(.lc-state-chip)')]
      .map(x=>x.textContent.replace(/\s+/g,'')),
     状態:[...box.querySelectorAll('.lc-state-chip')].map(x=>x.textContent.replace(/\s+/g,'')),
     仕切り:box.querySelectorAll('.lc-chip-sep').length};
  });
  rec('「表示中」「非表示中」の札がある',
      chips.状態.length===2&&/表示中/.test(chips.状態[0])&&/非表示中/.test(chips.状態[1]),
      JSON.stringify(chips.状態));
  /* **出どころとは別の群**として仕切る——同じ並びに混ぜると、押したときに
     何が外れるのか読めない。 */
  rec('出どころとは別の群として仕切って置く',
      chips.仕切り===1&&chips.出どころ.length>=2,JSON.stringify(chips));

  /* 1列だけ外して、札の件数と実際の行数が合うことを見る。 */
  const off=await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#listColumnPanel .lc-item')]
     .find(x=>x.querySelector('input')&&x.querySelector('input').checked);
   if(!row)return null;
   row.querySelector('.lc-vis').click();
   const n=t=>{const b=[...document.querySelectorAll('.lc-state-chip')]
     .find(x=>x.dataset.state===t);return b?Number(b.querySelector('b').textContent):-1};
   return {key:row.dataset.key,表示中:n('on'),非表示中:n('off')};
  });
  rec('チェックを外すと札の件数がその場で合う',
      !!off&&off.非表示中===1,JSON.stringify(off));
  /* **押すと本当に絞れる**こと——件数だけを見る網は、絞りが効いていなくても通る。 */
  const filtered=await page.evaluate(()=>{
   const pick=t=>[...document.querySelectorAll('.lc-state-chip')].find(x=>x.dataset.state===t);
   pick('off').click();
   const rows=[...document.querySelectorAll('#listColumnPanel .lc-item')].map(x=>x.dataset.key);
   /* **押したあとは引き直す**——札の帯は`renderOrigins()`が丸ごと組み直すので、
      押した瞬間の要素は切り離された古いノードになる（そこを読むと
      いつまでも`false`のまま＝何も確かめていない）。 */
   return {行:rows.length,先頭:rows[0]||'',押した:pick('off').getAttribute('aria-pressed')};
  });
  rec('「非表示中」を押すと、外した列だけが並ぶ',
      filtered.行===1&&filtered.先頭===(off||{}).key&&filtered.押した==='true',
      JSON.stringify(filtered));
  /* **もう一度押したら外れる**（「すべて」を探させない）。 */
  const back=await page.evaluate(()=>{
   const b=[...document.querySelectorAll('.lc-state-chip')].find(x=>x.dataset.state==='off');
   b.click();
   return document.querySelectorAll('#listColumnPanel .lc-item').length;
  });
  rec('同じ札をもう一度押すと絞りが外れる',back>1,String(back));
  /* **出どころとかけ合わせて効く**——1つの群にまとめていたら、これは作れない。 */
  const both=await page.evaluate(()=>{
   const st=t=>[...document.querySelectorAll('.lc-state-chip')].find(x=>x.dataset.state===t);
   const src=o=>[...document.querySelectorAll('.lc-origin-chip:not(.lc-state-chip)')]
     .find(x=>x.dataset.origin===o&&!x.disabled);
   st('on').click();
   const o=src('calc')?'calc':'source';
   src(o).click();
   /* **押したあとは引き直す**（上と同じ理由）。 */
   return {状態:st('on').getAttribute('aria-pressed'),
     出どころ:src(o).getAttribute('aria-pressed'),
     行:document.querySelectorAll('#listColumnPanel .lc-item').length};
  });
  rec('出どころと状態はかけ合わせて効く（どちらも押されたまま）',
      both.状態==='true'&&both.出どころ==='true',JSON.stringify(both));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));
  console.log('\n=== SUMMARY ===');
  const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
  ng.forEach(x=>console.log(' -',x.n,x.d||''));
  process.exitCode=ng.length?1:0;
 }catch(e){
  console.error('FATAL',e);
  process.exitCode=1;
 }finally{
  /* **後始末**——列レイアウトマスタは実行をまたいで生き延びる（§9.121）。 */
  await clear();
  if(b)await b.close().catch(()=>{});
 }
})();
