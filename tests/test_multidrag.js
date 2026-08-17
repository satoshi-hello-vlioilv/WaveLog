/* test_multidrag.js: 選んでからまとめて動かす(§9.177)
   ============================================================
   「まとめて選択してドラッグアンドドロップ」の要望のうち、投入(§9.5)と
   除外(§9.170)は既にある。残りの2つ——**スケジュール内の並べ替え**と
   **列の設定パネルの列移動**——をここで固定する。
    1. パネルの列はCtrl/⌘クリックで複数選べ、件数が文字で出る
    2. 選んだ列はドラッグでまとめて動く(順番は画面の並びのまま)
    3. 掴んだ写しに件数が出る(1列だけ運んでいるように見せない)
    4. タイムラインで複数選ぶと、掴んだ行と一緒に全部が動く
    5. 選択バーに「まとめて並べ替えられる」ことが文字で出る
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
 try{
  // ================= 列の設定パネル =================
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await page.waitForTimeout(700);
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await page.waitForTimeout(1500);
  await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:8000});
  await page.waitForTimeout(800);
  const keys=await page.evaluate(()=>[...document.querySelectorAll('#lcList .lc-item')].map(x=>x.dataset.key).slice(0,6));
  await page.click(`#lcList .lc-item[data-key="${keys[2]}"]`);
  await page.click(`#lcList .lc-item[data-key="${keys[3]}"]`,{modifiers:['Control']});
  await page.click(`#lcList .lc-item[data-key="${keys[4]}"]`,{modifiers:['Control']});
  await page.waitForTimeout(400);
  const m=await page.evaluate(()=>({marked:[...document.querySelectorAll('#lcList .lc-item.is-marked')].map(x=>x.dataset.key),
   count:document.getElementById('lcCount')?.textContent||''}));
  rec('Ctrlクリックで複数の列を選べる',m.marked.length===3,JSON.stringify(m.marked));
  rec('選択件数が文字で出る',/3列を選択中/.test(m.count),m.count);
  // 掴んで先頭へ
  const from=await page.evaluate(k=>{const r=document.querySelector(`#lcList .lc-item[data-key="${k}"]`).getBoundingClientRect();
   return {x:r.x+120,y:r.y+r.height/2}},keys[3]);
  const to=await page.evaluate(k=>{const r=document.querySelector(`#lcList .lc-item[data-key="${k}"]`).getBoundingClientRect();
   return {x:r.x+120,y:r.y+2}},keys[0]);
  await page.mouse.move(from.x,from.y);await page.mouse.down();
  await page.mouse.move(from.x,from.y-24,{steps:5});
  await page.waitForTimeout(200);
  const ghost=await page.evaluate(()=>{const g=document.querySelector('.lc-ghost');
   return g?{n:g.querySelector('.lc-ghost-count')?.textContent||'',dragging:document.querySelectorAll('.lc-item.lc-dragging').length}:null});
  rec('掴んだ写しに件数が出る',!!ghost&&ghost.n==='3列',JSON.stringify(ghost));
  rec('選んだ行がすべて掴まれている',!!ghost&&ghost.dragging===3,JSON.stringify(ghost));
  await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
  await page.waitForTimeout(800);
  const after=await page.evaluate(()=>[...document.querySelectorAll('#lcList .lc-item')].map(x=>x.dataset.key).slice(0,6));
  rec('選んだ3列がまとめて先頭へ動く',
      after.slice(0,3).join(',')===[keys[2],keys[3],keys[4]].join(','),
      JSON.stringify({before:keys,after}));
  rec('並びは画面の順のまま(選んだ順ではない)',after[0]===keys[2]&&after[2]===keys[4],JSON.stringify(after.slice(0,3)));
  await page.evaluate(()=>{const p=document.getElementById('listColumnPanel');if(p)p.hidden=true});

  /* タイムラインのまとめて並べ替えは test_scpick.js が持つ(§9.177)。
     **1本のテストでモードを切り替えない**——切り替えは再読込を伴い、
     読み直しのあいだタブが0件になる。重い一覧を読む端で8秒の猶予
     (CLOSED_GRACE_SEC、§9.98)を跨ぐと、テストの途中でアプリが自分から
     終了する(実際にそうなった)。 */
  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
