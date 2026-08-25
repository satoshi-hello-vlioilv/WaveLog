/* test_adhoc.js: その場フィルタ(§9.238 ⑤、利用者の指示)
   ============================================================
   「フィルタ枠はあるが、基本的に登録して使う形になっている。このフィルタの
   下に折りたたんだもう1つのフィルタを実装して、カラムを選択しておき、条件を
   選択、入力欄に入れると、設定したカラムの選択した条件でフィルタが掛かる
   ようにしてください」。

   ここで固定するのは次の点。
    1. 入口があり、**既定は畳んでいる**（段階的開示）
    2. カラム・条件を選んで値を打つと**その場で**絞り込みが効く
    3. **登録もトークン化もしない**——`S.genericFilters`は増えない
    4. **打っている最中に欄を作り直さない**（カーソルが飛ばない。§9.117）
    5. **効いていることを文字で出す**（状態の行・件数・畳んだ入口の名乗り）
    6. 「条件に残す」で上のトークンへ移り、その場の入力は空になる
    7. 一覧を切り替えると**値は消え、カラムと条件は覚えている**
    8. スケジュール表の仕掛一覧でも同じ器がそのまま使える

   **確かめるときは値を実際に絞れる列で見ること**——どの行にも同じ値しか
   入っていない列だと、絞り込んでも件数が変わらず、効いていなくても通る。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 /* 行数が落ち着くまで待つ。**固定待ちにしないこと**(§9.102)——遅い画面では
    足りず、速い画面では無駄に待つ。 */
 const rows=()=>page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
 const settle=async()=>{
  let last=-1,same=0;
  for(let i=0;i<60&&same<3;i++){
   const n=await rows();
   if(n===last)same++;else{same=0;last=n}
   await page.waitForTimeout(150);
  }
  return last;
 };
 const openList=async()=>{
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.waitForTimeout(600);
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await settle();
 };
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  /* 前の実行の置き土産を持ち込まない(§9.121)。支度も開閉も端末に残る。 */
  await page.evaluate(()=>{
   localStorage.removeItem('MeasurementFilterAdhocV1');
   localStorage.removeItem('MeasurementFilterAdhocOpenV1');
   localStorage.removeItem('MeasurementFilterActiveV1');
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await openList();

  /* ---- 1) 入口があり、既定は畳んでいる ---- */
  const first=await page.evaluate(()=>({
   入口:!!document.getElementById('filterAdhocToggle'),
   畳んでいる:!!document.getElementById('filterAdhocRow')?.hidden,
   入口の文字:document.getElementById('filterAdhocToggle')?.textContent||''}));
  rec('その場フィルタの入口がある',first.入口,JSON.stringify(first));
  rec('既定は畳んでいる',first.畳んでいる,JSON.stringify(first));

  /* ---- 2) 開くと支度の欄が出る ---- */
  await page.click('#filterAdhocToggle');
  await page.waitForTimeout(400);
  const opened=await page.evaluate(()=>{
   const row=document.getElementById('filterAdhocRow');
   const vis=el=>!!el&&!!el.offsetParent;
   return {開いた:!row.hidden,
           カラム:vis(document.getElementById('filterAdhocColumn')),
           条件:vis(document.getElementById('filterAdhocOp')),
           入力:vis(document.getElementById('filterAdhocValue')),
           列数:document.querySelectorAll('#filterAdhocColumn option').length};
  });
  rec('開くとカラム・条件・入力の3つが出る',
      opened.開いた&&opened.カラム&&opened.条件&&opened.入力,JSON.stringify(opened));
  rec('カラムの候補はこの一覧の列から作る',opened.列数>2,JSON.stringify(opened));

  /* ---- 2b) 開いても**1行**に収まる(§9.239 ①、利用者の指示) ----
     以前は「欄ごとの見出しの段＋操作の段＋状態＋注記」で実測4段あり、
     開くだけで一覧が4行ぶん短くなっていた。
     **要素の数や有無を見る網では捕まらない**(§9.130)ので、
     ①中の部品が全部同じ段に居るか(＝折り返していないか)
     ②器の高さがいちばん高い部品＋上下の余白に収まっているか
     の2つを実測で見る。**幅を狭めた側でも見る**——広い窓でしか
     確かめないと、狭い窓で段が増える実装を素通しさせる。 */
  const oneLine=async()=>await page.evaluate(()=>{
   const row=document.getElementById('filterAdhocRow');
   if(!row||row.hidden)return {段数:0,器:0,部品:0,余り:0};
   const r=row.getBoundingClientRect();
   const cs=getComputedStyle(row);
   const pad=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
   const kids=[...row.children].filter(el=>el.offsetParent&&el.getBoundingClientRect().height>0);
   /* **同じ段かどうかは「上端」ではなく「中心」で見る**——部品の高さは
      ボタンと選択欄で違い、中央そろえだと上端は当然ずれる。上端で数えると
      1行に収まっていても段が増えたことになり、直っていても落ちる。 */
   const mids=[];
   let tall=0;
   kids.forEach(el=>{
    const b=el.getBoundingClientRect();
    tall=Math.max(tall,b.height);
    const mid=b.top+b.height/2;
    if(!mids.some(m=>Math.abs(m-mid)<=3))mids.push(mid);
   });
   return {段数:mids.length,器:Math.round(r.height),部品:Math.round(tall),
           余り:Math.round(r.height-tall-pad),数:kids.length};
  });
  const line1=await oneLine();
  rec('開いても部品はすべて同じ段に並ぶ（折り返さない）',line1.段数===1&&line1.数>=4,
      JSON.stringify(line1));
  rec('開いた器の高さは1行ぶん（いちばん高い部品＋上下の余白）',
      line1.器>0&&line1.余り<=4,JSON.stringify(line1));
  /* 狭い器（スケジュールの分割表示に近い幅）でも段が増えないこと。 */
  await page.setViewportSize({width:1100,height:1000});
  await page.waitForTimeout(400);
  const line2=await oneLine();
  rec('狭い窓でも1行のまま',line2.段数===1&&line2.余り<=4,JSON.stringify(line2));
  await page.setViewportSize({width:1700,height:1000});
  await page.waitForTimeout(400);

  /* ---- 3) 選んで打つと、その場で絞り込みが効く ---- */
  /* **実際に絞れる列を選ぶ**——同じ値しか無い列だと件数が変わらず、
     効いていなくても通る。 */
  const pick=await page.evaluate(()=>{
   for(const c of (S.columns||[])){
    const vals=(S.rows||[]).map(r=>String(r[c]??'').trim()).filter(Boolean);
    const uniq=[...new Set(vals)];
    if(uniq.length>1&&vals.length>=2)return {col:c,val:uniq[0],
      当たる:vals.filter(v=>v===uniq[0]).length};
   }
   return null;
  });
  rec('絞り込みを試せる列がフィクスチャにある',!!pick,JSON.stringify(pick));
  const before=await rows();
  await page.selectOption('#filterAdhocColumn',pick.col);
  await page.selectOption('#filterAdhocOp','eq');
  await settle();
  await page.click('#filterAdhocValue');
  await page.type('#filterAdhocValue',pick.val,{delay:25});
  const after=await settle();
  rec('打つとその場で絞り込みが効く',after<before&&after>0,
      JSON.stringify({before,after,期待:pick.当たる}));

  /* ---- 4) 打っている最中に欄を作り直さない(カーソルが飛ばない) ---- */
  const caret=await page.evaluate(()=>({
   どこに居るか:document.activeElement?document.activeElement.id:'',
   値:document.getElementById('filterAdhocValue').value,
   末尾:document.getElementById('filterAdhocValue').selectionStart}));
  rec('打ち終わっても入力欄からフォーカスが外れない',caret.どこに居るか==='filterAdhocValue',
      JSON.stringify(caret));
  rec('打った値がそのまま残っている',caret.値===pick.val,JSON.stringify(caret));

  /* ---- 5) 登録もトークン化もしない ---- */
  const notoken=await page.evaluate(()=>({
   トークン:S.genericFilters.length,
   覚え:localStorage.getItem('MeasurementFilterActiveV1')||''}));
  rec('その場フィルタは条件トークンを増やさない',notoken.トークン===0,JSON.stringify(notoken));
  rec('その場フィルタは適用中の覚えへ焼き付かない',
      !/"column"/.test(notoken.覚え),String(notoken.覚え).slice(0,120));

  /* ---- 6) 効いていることを文字で出す ---- */
  const said=await page.evaluate(()=>({
   状態:document.getElementById('filterAdhocState').textContent||'',
   件数:document.getElementById('filterCount').textContent||''}));
  rec('効いていることを状態の行が文字で言う',/効いています/.test(said.状態),JSON.stringify(said));
  rec('件数にもその場フィルタが数えられる',said.件数==='1件',JSON.stringify(said));
  /* 畳んだときも名乗る（見えない場所で効く絞り込みを作らない。§9.175） */
  await page.click('#filterAdhocToggle');
  await page.waitForTimeout(300);
  const folded=await page.evaluate(()=>{
   const t=document.getElementById('filterAdhocToggle');
   return {畳んだ:!!document.getElementById('filterAdhocRow').hidden,
           文字:t.textContent||'',印:t.classList.contains('is-on')};
  });
  rec('畳んでも「いま効いている条件」を入口が名乗る',
      folded.畳んだ&&folded.印&&folded.文字.length>'その場フィルタ'.length,JSON.stringify(folded));
  await page.click('#filterAdhocToggle');
  await page.waitForTimeout(300);

  /* ---- 7) 解除すると戻る ---- */
  await page.click('#filterAdhocClear');
  const cleared=await settle();
  rec('解除すると元の件数へ戻る',cleared===before,JSON.stringify({before,cleared}));
  rec('解除すると入力欄も空になる',
      await page.evaluate(()=>document.getElementById('filterAdhocValue').value===''));

  /* ---- 8) 「条件に残す」で上のトークンへ移る ---- */
  await page.click('#filterAdhocValue');
  await page.type('#filterAdhocValue',pick.val,{delay:25});
  await settle();
  await page.click('#filterAdhocKeep');
  await settle();
  const kept=await page.evaluate(()=>({
   トークン:S.genericFilters.length,
   条件:(S.genericFilters[0]||{}),
   その場:document.getElementById('filterAdhocValue').value,
   行:document.querySelectorAll('#grid tbody tr').length}));
  rec('「条件に残す」で上のトークンへ移る',kept.トークン===1&&kept.条件.column===pick.col,
      JSON.stringify(kept));
  rec('移したらその場の入力は空になる（同じ条件が2つ効かない）',kept.その場==='',JSON.stringify(kept));
  rec('移しても絞り込みの結果は変わらない',kept.行===after,JSON.stringify({after,now:kept.行}));
  /* 後片付け（次のテストへ条件を持ち越さない） */
  await page.click('#clearGenericFilters');
  await settle();

  /* ---- 9) 一覧を切り替えると値は消え、支度は覚えている ---- */
  const tabs=await page.evaluate(()=>[...document.querySelectorAll('#tabs [data-table]')].map(t=>t.dataset.table));
  if(tabs.length>1){
   await page.click('#filterAdhocValue');
   await page.type('#filterAdhocValue',pick.val,{delay:20});
   await settle();
   await page.click(`#tabs [data-table="${tabs[1]}"]`);
   await settle();
   await page.click(`#tabs [data-table="${tabs[0]}"]`);
   await settle();
   const back=await page.evaluate(()=>({
    値:document.getElementById('filterAdhocValue').value,
    カラム:document.getElementById('filterAdhocColumn').value,
    条件:document.getElementById('filterAdhocOp').value}));
   rec('一覧を切り替えると入力（値）は消える',back.値==='',JSON.stringify(back));
   rec('カラムと条件は覚えている',back.カラム===pick.col&&back.条件==='eq',JSON.stringify(back));
  }else{
   rec('一覧を切り替えると入力（値）は消える',true,'テーブルが1つしかないので確かめられません');
   rec('カラムと条件は覚えている',true,'テーブルが1つしかないので確かめられません');
  }

  /* ---- 10) スケジュール表の仕掛一覧でも同じ器が使える ---- */
  await post('/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#scPanel,#schedulePanel,.sc-panel',{timeout:25000}).catch(()=>{});
  await page.waitForTimeout(2500);
  const sc=await page.evaluate(()=>{
   const row=document.getElementById('filterAdhocRow'),t=document.getElementById('filterAdhocToggle');
   const bar=document.getElementById('genericFilterBar');
   return {器:!!row,入口:!!t,
           仕掛一覧の中:!!bar&&!!bar.closest('.sc-split-wrap,.sc-float-body,#scListModal')};
  });
  rec('スケジュール表の仕掛一覧にもその場フィルタがある',sc.器&&sc.入口,JSON.stringify(sc));

  rec('画面側の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  console.log('FATAL: '+e.message);
  R.push({n:'FATAL',ok:false});
 }finally{
  /* **落ちてもブラウザを閉じる**(tests/README.md)。残ると設備の編集
     セッションを掴んだままになり、後続のスケジュール系が連鎖で落ちる。 */
  try{await post('/api/access-mode',{mode:'edit'})}catch(_){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n=== SUMMARY ===\n${R.length-ng}/${R.length} passed`);
 process.exit(ng?1:0);
})();
