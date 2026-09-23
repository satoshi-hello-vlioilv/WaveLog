/* test_gridchild.js: 分割ありの子ロットを親の直下へ畳む(§9.239 ⑤-2、利用者の指示)
   ============================================================
   「分割ありのものについて、親や子の情報が表示されますが、分割ありの子に
    ついては分割ありの対象の親の直下に添える形でたたみこんで表示するように
    してください。」

   ここで固定するのは次の点。
    1. **畳んでいる間は子の行を作らない**——親の下にも一覧の他の場所にも
       出ない（DOMに0行。既存の「行数を数える」網を1つも壊さない）
    2. 親の「分割」欄に**件数つきのつまみ**（`子N`）が出る
    3. 押すと**親の直後**に子の行が出る（DOM順で次）
    4. 子の行は**列の並びとずれない**（colspanの合計＝列数）
    5. **親がこの画面に居ない子は畳まない**（今までどおりそのまま並ぶ）
    6. **畳んだ件数を文字で出す**（黙って行を減らさない）
    7. 開閉のあとも**#の採番が飛ばない**（親の連番）

   材料は`tests/make_split_fixture.py`が入れた L9000（親）/ L90001・L90002
   （子）だけ。**rowidが末尾なので`#search`で絞ってから見る**。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
run('test_gridchild: 分割ありの子ロットを親の直下へ畳む(§9.239 ⑤-2、利用者の指示)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 /* 一覧が落ち着くまで（検索欄は300msの遅延のあと読み込む→その往復が静まるまで）。 */
 const settle=async()=>{
  await idle(600);
  return page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
 };
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('aside [data-db-key]',{timeout:25000});
  await W.booted(page); await idle();
  await page.click('aside [data-db-key]');
  await page.waitForSelector('#grid tbody tr',{timeout:25000});
  await settle();
  /* **絞ってから見る**——分割のフィクスチャは末尾3行なので1ページ目に出ない。 */
  await page.fill('#search','L900');
  await settle();

  const rows=await page.evaluate(()=>[...document.querySelectorAll('#grid tbody tr')]
    .filter(t=>!t.classList.contains('grid-virtual-spacer'))
    .map(t=>({子:t.classList.contains('grid-child-row'),
              ロット:(t.querySelector('.lot-cell')||{}).textContent||'',
              番号:(t.querySelector('.grid-no-cell')||{}).textContent||''})));
  rec('分割のフィクスチャが一覧に出ている',rows.length>=1,JSON.stringify(rows));

  /* ---- 1) 畳んでいる間は子の行を作らない ---- */
  const folded=await page.evaluate(()=>({
   子の行:document.querySelectorAll('#grid tbody tr.grid-child-row').length,
   本文:[...document.querySelectorAll('#grid tbody tr')]
     .filter(t=>!t.classList.contains('grid-virtual-spacer')).length,
   つまみ:document.querySelectorAll('#grid .grid-child-toggle').length,
   つまみの文字:(document.querySelector('#grid .grid-child-toggle')||{}).textContent||'',
  }));
  rec('既定では子の行をDOMへ作らない',folded.子の行===0,JSON.stringify(folded));
  rec('親の「分割」欄に畳むつまみが出る',folded.つまみ>=1,JSON.stringify(folded));
  rec('つまみは件数を数字で出す（子N）',/子\d+/.test(folded.つまみの文字),folded.つまみの文字);

  /* ---- 2) 子はトップレベルにも出ていない（同じ情報を2箇所に出さない） ---- */
  const lots=rows.map(r=>String(r.ロット).trim());
  rec('子ロットは一覧のどこにも出ていない（親の下へ畳んである）',
      !lots.includes('L90001')&&!lots.includes('L90002'),JSON.stringify(lots));

  /* ---- 3) 畳んだ件数を文字で出す ---- */
  const chip=await page.evaluate(()=>{
   const el=document.getElementById('listChildChip');
   return el&&!el.hidden?{文字:el.textContent,説明:el.title}:null;
  });
  rec('畳んだ件数をツールバーに文字で出す',!!chip&&/子ロット \d+件/.test(chip.文字),
      JSON.stringify(chip));

  /* ---- 4) 押すと親の直後に出る ---- */
  const beforeNo=await page.evaluate(()=>[...document.querySelectorAll('#grid .grid-no-cell')]
    .map(x=>x.textContent.trim()));
  await page.evaluate(()=>document.querySelector('#grid .grid-child-toggle').click());
  await W.until(page,()=>document.querySelectorAll('#grid tbody tr.grid-child-row').length>0,null,{ms:8000,what:'子の行が開く'});
  await idle();
  const opened=await page.evaluate(()=>{
   const trs=[...document.querySelectorAll('#grid tbody tr')]
     .filter(t=>!t.classList.contains('grid-virtual-spacer'));
   const at=trs.findIndex(t=>t.querySelector('.grid-child-toggle'));
   const kids=[];
   for(let i=at+1;i<trs.length&&trs[i].classList.contains('grid-child-row');i++)
    kids.push(trs[i].textContent.replace(/\s+/g,' ').trim());
   const cols=document.querySelectorAll('#grid thead th').length;
   const kidCells=trs[at+1]?[...trs[at+1].children].reduce((n,td)=>n+(td.colSpan||1),0):0;
   return {親の位置:at,子の数:kids.length,子:kids,列数:cols,子のマス:kidCells,
           つまみ:(document.querySelector('#grid .grid-child-toggle')||{}).getAttribute('aria-expanded')};
  });
  rec('押すと親の直後に子の行が出る',opened.子の数>=1,JSON.stringify(opened.子));
  rec('子の行はロット番号を出す',opened.子.some(t=>/L9000\d/.test(t)),JSON.stringify(opened.子));
  rec('子の行のマスの合計が列数と一致する（表がずれない）',
      opened.子のマス===opened.列数,JSON.stringify({マス:opened.子のマス,列:opened.列数}));
  rec('つまみが開いた状態を名乗る',opened.つまみ==='true',String(opened.つまみ));

  /* ---- 5) 開いても親の採番は変わらない ---- */
  const afterNo=await page.evaluate(()=>[...document.querySelectorAll('#grid .grid-no-cell')]
    .map(x=>x.textContent.trim()));
  rec('開いても#の採番は変わらない（子は番号を持たない）',
      JSON.stringify(beforeNo)===JSON.stringify(afterNo),
      JSON.stringify({前:beforeNo,後:afterNo}));

  /* ---- 6) しまは親の並び順で塗る（子を出しても親のしまが動かない） ---- */
  const stripe=await page.evaluate(()=>{
   const trs=[...document.querySelectorAll('#grid tbody tr')]
     .filter(t=>!t.classList.contains('grid-virtual-spacer')&&!t.classList.contains('grid-child-row'));
   return trs.map((t,i)=>({i,alt:t.classList.contains('is-alt')}));
  });
  rec('しまは親の並び順（クラス）で塗る',
      stripe.every(x=>x.alt===(x.i%2===1)),JSON.stringify(stripe));

  /* ---- 7) もう一度押すと畳む ---- */
  await page.evaluate(()=>document.querySelector('#grid .grid-child-toggle').click());
  await W.until(page,()=>document.querySelectorAll('#grid tbody tr.grid-child-row').length===0,null,{ms:8000,what:'子の行が畳まれる'});
  const closed=await page.evaluate(()=>({
   子の行:document.querySelectorAll('#grid tbody tr.grid-child-row').length,
   つまみ:(document.querySelector('#grid .grid-child-toggle')||{}).getAttribute('aria-expanded'),
  }));
  rec('もう一度押すと子の行が消える',closed.子の行===0,JSON.stringify(closed));
  rec('つまみが畳んだ状態を名乗る',closed.つまみ==='false',String(closed.つまみ));

  /* ---- 7b) 追い判定がつまみを消さない（§9.235 ④と同じ罠） ----
     `WL.list.checkSplitRowsForMissingChildren()`は分割のセルの文字を差し替える。
     **`textContent`で丸ごと入れ替えると、中に入れたつまみごと消える**
     ——押す手立てが無くなるので「子N」が出たあと押せなくなる。
     ここでは実際に差し替えを走らせて、つまみが残ることを見る。 */
  const survives=await page.evaluate(()=>{
   const cell=document.querySelector('#grid .split-flag-cell.split-yes');
   if(!cell)return {前提なし:'分割ありの行が無い'};
   if(typeof WL.list.setSplitCellText!=='function')return {前提なし:'setSplitCellText が無い'};
   const before=!!cell.querySelector('.grid-child-toggle');
   /* **製品の関数をそのまま呼ぶ**——テストの中で同じ処理を書き直すと、
      製品が`textContent`へ戻っても通ってしまう（何も確かめていない）。 */
   WL.list.setSplitCellText(cell,'分割あり・子ロット未検出(1)⚠','ためし');
   return {前:before,後:!!cell.querySelector('.grid-child-toggle'),
           文字:cell.textContent.replace(/\s+/g,' ').trim()};
  });
  rec('差し替えを確かめられる材料がある',!survives.前提なし,JSON.stringify(survives));
  rec('分割の文字を差し替えてもつまみが残る',
      survives.前===true&&survives.後===true,JSON.stringify(survives));
  rec('差し替えた文字はちゃんと入る',
      /子ロット未検出/.test(survives.文字||''),survives.文字||'');

  /* ---- 8) 親が居ないときは畳まない（子がそのまま並ぶ） ---- */
  await page.fill('#search','L90001');
  await settle();
  const alone=await page.evaluate(()=>{
   const trs=[...document.querySelectorAll('#grid tbody tr')]
     .filter(t=>!t.classList.contains('grid-virtual-spacer'));
   return {件数:trs.length,
           ロット:trs.map(t=>(t.querySelector('.lot-cell')||{}).textContent||''),
           チップ:(()=>{const el=document.getElementById('listChildChip');return el?el.hidden:true})()};
  });
  rec('親がこの画面に居ない子は今までどおりそのまま並ぶ',
      alone.ロット.some(t=>String(t).trim()==='L90001'),JSON.stringify(alone));
  rec('畳むものが無ければチップも出さない',alone.チップ,JSON.stringify(alone));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
  }
}, {viewport:{width:1700,height:1000}});
