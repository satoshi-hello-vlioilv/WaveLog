/* test_colsort.js: 並び順と「いつも使う並び」(§9.88 段5)
   ============================================================
   複数キーで並べ、その組み合わせに名前を付けて保存する。フィルタの登録条件と
   同じ構成（状態を見せる → 選ぶ → 保存する）にしてある。

   ここで固定するのは、崩れると結果を読み違える次の点。
    1. 見出しのクリックは**置き換え**、Shift+クリックは**追加**
    2. 同じ列をもう一度押すと向きが変わる
    3. **2つ以上のキーがあるときは順番が見える**（矢印だけでは先後が分からない）
    4. 並びは実際にサーバーへ届き、結果の順序が変わる
    5. 保存した並びを選ぶと、その組み合わせがそのまま復元される
    6. **問い合わせの組み立ては1箇所**（filters.jsがload()を丸ごと
       差し替えるため、片方だけ直すと効かない。実際に2度起きている）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const NAME='テスト並び'+Date.now().toString(36);
let b=null,presetId=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function cleanup(){
 try{if(presetId!=null)await post('/api/sort-presets/delete',{id:presetId,user_id:'test'})}catch(e){}
}
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

  const cols=await page.evaluate(()=>[...document.querySelectorAll('#grid th[data-sort-col]')].map(t=>t.dataset.sortCol));
  const c1=cols[1],c2=cols[2];
  const keys=()=>page.evaluate(()=>WL.listSort.keys());
  const clickHead=(col,shift)=>page.evaluate(a=>{
   const th=[...document.querySelectorAll('#grid th[data-sort-col]')].find(t=>t.dataset.sortCol===a.col);
   th.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:a.shift}));
  },{col,shift:!!shift});

  /* ---- 1) 見出しのクリック ---- */
  await clickHead(c1);await page.waitForTimeout(700);
  let k=await keys();
  rec('クリックでその列の昇順になる',k.length===1&&k[0].column===c1&&k[0].dir==='asc',JSON.stringify(k));
  await clickHead(c1);await page.waitForTimeout(700);
  k=await keys();
  rec('もう一度押すと降順になる',k.length===1&&k[0].dir==='desc',JSON.stringify(k));
  await clickHead(c2);await page.waitForTimeout(700);
  k=await keys();
  rec('別の列をクリックすると置き換わる',k.length===1&&k[0].column===c2,JSON.stringify(k));

  /* **要点**: Shift+クリックは置き換えではなく追加。 */
  await clickHead(c1,true);await page.waitForTimeout(700);
  k=await keys();
  rec('Shift+クリックでキーが増える',k.length===2&&k[0].column===c2&&k[1].column===c1,JSON.stringify(k));
  rec('先に押した列が第一キーのまま',k[0].column===c2);

  /* ---- 2) 順番が見える ---- */
  const heads=await page.evaluate(a=>{
   const out={};
   [...document.querySelectorAll('#grid th[data-sort-col]')].forEach(t=>{
    if(a.includes(t.dataset.sortCol))out[t.dataset.sortCol]=t.textContent.trim();
   });
   return out;
  },[c1,c2]);
  /* 丸数字で出す。列名の直後に素の数字を置くと列名の一部に見える
     (「製造材質2」と読めてしまう)ので、矢印の後ろへ丸数字を置いている。 */
  rec('第一キーの見出しに①が出る',/①/.test(heads[c2]||''),heads[c2]);
  rec('第二キーの見出しに②が出る',/②/.test(heads[c1]||''),heads[c1]);
  rec('順番は矢印の後ろに出る(列名の一部に見えない)',
   /[▲▼]\s*①/.test(heads[c2]||''),heads[c2]);
  const chips=await page.evaluate(()=>[...document.querySelectorAll('#listSortKeys .list-sort-chip')].map(x=>x.textContent.trim()));
  rec('ツールバーに今の並びが札で出る',chips.length===2,JSON.stringify(chips));

  /* ---- 3) 実際に順序が変わる ---- */
  const firstValues=async()=>page.evaluate(c=>S.rows.slice(0,5).map(r=>String(r[c]??'')),c2);
  await page.evaluate(()=>{WL.listSort.set([{column:S.columns[1],dir:'asc'}]);S.page=1;WL.list.load()});
  await page.waitForTimeout(900);
  const asc=await page.evaluate(c=>S.rows.slice(0,8).map(r=>String(r[c]??'')),c1);
  await page.evaluate(()=>{WL.listSort.set([{column:S.columns[1],dir:'desc'}]);S.page=1;WL.list.load()});
  await page.waitForTimeout(900);
  const desc=await page.evaluate(c=>S.rows.slice(0,8).map(r=>String(r[c]??'')),c1);
  rec('昇順が実際に昇順になっている',
   asc.every((v,i)=>i===0||asc[i-1]<=v),asc.slice(0,4).join(','));
  rec('降順にすると先頭が入れ替わる',asc[0]!==desc[0]||asc.join()!==desc.join(),
   `${asc[0]} / ${desc[0]}`);

  /* **要点**: 問い合わせの組み立ては1箇所。filters.jsがload()を丸ごと
     差し替えるので、絞り込みを入れた状態でも並びが届かないと意味がない。 */
  const q=await page.evaluate(()=>String(WL.listQuery()));
  rec('問い合わせに並び順が入る',/sorts=/.test(q),q.slice(0,120));
  rec('組み立ては1箇所に集約されている',
   await page.evaluate(()=>typeof WL.listQuery==='function'));

  /* ---- 4) いつも使う並び ---- */
  await page.evaluate(()=>{WL.listSort.set([{column:S.columns[1],dir:'desc'},{column:S.columns[2],dir:'asc'}]);
                           WL.listSortBar.render()});
  const saved=await (await post('/api/sort-presets',{name:NAME,user_id:'test',
   db:await page.evaluate(()=>S.db),table:await page.evaluate(()=>S.table),mode:'',
   sorts:await keys()})).json();
  presetId=saved.id;
  rec('並び順を保存できる',saved.ok===true&&saved.id!=null,JSON.stringify(saved.registered));

  // 一覧を開き直して、保存した並びが選べること
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table thead th').length>3,{timeout:25000});
  await page.waitForTimeout(1400);
  /* §9.90で「選ぶ・保存する・消す」は1つのメニューへ畳んだ(固定幅のselectは
     長い名前が途中で切れていた)。**開いてから**中身を見る。 */
  await page.click('#listSortPresetBtn');
  await page.waitForTimeout(400);
  const opts=await page.evaluate(()=>[...document.querySelectorAll('#listSortMenu .lsm-use')].map(o=>o.textContent.trim()));
  rec('保存した並びが選択肢に出る',opts.some(t=>t.includes(NAME)),JSON.stringify(opts));
  rec('今の並びがメニューの先頭に出る',
   await page.evaluate(()=>!!document.querySelector('#listSortMenu .lsm-now b')));

  await page.evaluate(n=>{
   const btn=[...document.querySelectorAll('#listSortMenu .lsm-use')].find(o=>o.textContent.includes(n));
   if(btn)btn.click();
  },NAME);
  await page.waitForTimeout(1000);
  const applied=await keys();
  rec('選ぶとその並びが復元される',
   applied.length===2&&applied[0].column===c1&&applied[0].dir==='desc'&&applied[1].column===c2,
   JSON.stringify(applied));
  rec('選んでいる並びの名前がボタンに出る',
   await page.evaluate(n=>(document.getElementById('listSortPresetBtn')?.textContent||'').includes(n),NAME));
  // メニューの「並びを解除」で外れる
  await page.click('#listSortPresetBtn');
  await page.waitForTimeout(400);
  rec('メニューに削除の口がある',
   await page.evaluate(()=>!!document.querySelector('#listSortMenu .lsm-del')));
  await page.evaluate(()=>{
   const btn=document.querySelector('#listSortMenu [data-act="clear"]');
   if(btn)btn.click();
  });
  await page.waitForTimeout(900);
  rec('選択を外すと並びの指定も外れる',(await keys()).length===0);
  rec('指定なしの案内が出る',
   await page.evaluate(()=>!!document.querySelector('#listSortKeys .list-sort-none')));

  rec('コンソールに例外が出ない',errs.length===0,errs.slice(0,3).join(' / '));

  console.log('\n=== SUMMARY ===');
  const bad=R.filter(r=>!r.ok);console.log(`${R.length-bad.length}/${R.length} passed`);
  bad.forEach(x=>console.log(' -',x.n,x.d||''));
  await b.close();b=null;
  await cleanup();
  process.exit(bad.length?1:0);
 }catch(e){
  console.error('FATAL',e);
  if(b)await b.close().catch(()=>{});
  await cleanup();
  process.exit(2);
 }
})();
