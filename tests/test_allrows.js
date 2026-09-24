/* test_allrows.js: 表示件数の「全件」(§9.95)
   ============================================================
   200件・500件からしか選べなかった表示件数に「全件」を足した。
   素直に「全部まとめて1回で取って1枚に並べる」と、実データ(200列超)では
   3,000行=642,000セルになり、取るのも並べるのも数十秒その場で止まる。
   そこで全件は次の3つの約束で作ってある。ここではその3つを固定する。

    1. **250件ずつ最後まで取り続ける**（1回ぶんが小さいので、受け取って
       解く時間も小さく刻まれる）。1回目はいつもどおり出し、残りは裏で読む。
       読んでいる間も件数に「…件まで読み込み済み」と出し、操作できる。
    2. **DOMへ置くのは画面の前後だけ**（行の窓）。データは全件持っているので
       件数・並べ替え・絞り込みは全件に効くが、置くのは数十行。
       しきい値(600行)以下の表は今までと1行も変わらない。
    3. **ページの概念が無い**ので、ページ送りは押せなくする。

   併せて、途中で他の件数へ戻したら**続きの読み込みは止まる**ことも見る
   （止めないと、戻したはずの一覧へ後から行が足される）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
run('test_allrows: 表示件数の「全件」(§9.95)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 const tableCalls=[];
 page.on('request',r=>{const u=r.url();if(u.includes('/api/table?'))tableCalls.push(u)});

 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
  const total=await page.evaluate(()=>S.count);
  rec('検証の前提: フィクスチャの件数が窓のしきい値より多い',total>600,`${total}件`);

  // ---- 1. 選べること ----
  const opts=await page.evaluate(()=>[...document.querySelectorAll('#pageSize option')].map(o=>o.value));
  rec('表示件数に「全件」がある',opts.includes('all'),JSON.stringify(opts));
  /* §9.286 ③（利用者の指示「200,500,1000,2000,3000,5000を準備し、1000件としたい」）。
     **既定まで見ること**——選択肢が並ぶだけを見る網は、既定が200のままでも通る。 */
  rec('表示件数の選択肢が6段そろっている',
    ['200','500','1000','2000','3000','5000'].every(v=>opts.includes(v)),JSON.stringify(opts));
  const defSize=await page.evaluate(()=>document.querySelector('#pageSize').value);
  rec('表示件数の既定は1000件',defSize==='1000',defSize);

  const mark=tableCalls.length;
  await W.listView(page);await page.selectOption('#pageSize','all');
  await page.waitForFunction(()=>document.querySelector('#page')?.textContent==='全件',{timeout:20000});

  // ---- 2. ページ送りは押せない ----
  const pager=await page.evaluate(()=>({page:document.querySelector('#page').textContent,
    prev:document.querySelector('#prev').disabled,next:document.querySelector('#next').disabled}));
  rec('全件ではページ送りが押せない（押しても何も起きないボタンを見せない）',
    pager.prev===true&&pager.next===true&&pager.page==='全件',JSON.stringify(pager));

  // ---- 3. 1回目はすぐ出て、残りは裏で読む ----
  const early=await page.evaluate(()=>({rows:S.rows.length,count:document.querySelector('#count').textContent}));
  rec('1回ぶんだけ先に出る（全部そろうまで待たせない）',early.rows>0&&early.rows<=500,`${early.rows}行`);
  rec('読み込み中は「どこまで読めたか」を件数に出す',
    early.rows>=total||/読み込み済み/.test(early.count),early.count);
  // 読んでいる最中でも操作できる
  const scrolled=await page.evaluate(()=>{const g=document.querySelector('#grid');g.scrollTop=600;return g.scrollTop});
  rec('読み込み中でもスクロールできる',scrolled>0,`${scrolled}px`);

  await page.waitForFunction(t=>S.rows.length>=t,total,{timeout:90000});
  const done=await page.evaluate(()=>({rows:S.rows.length,dom:document.querySelectorAll('#grid tbody tr').length,
    count:document.querySelector('#count').textContent}));
  rec('最後には全件そろう',done.rows===total,`${done.rows}/${total}`);
  rec('そろったら件数から「読み込み済み」が消える',!/読み込み済み/.test(done.count),done.count);
  const calls=tableCalls.slice(mark).length;
  rec('全件は何回かに分けて取っている（1回で全部運ばない）',calls>=2,`${calls}回`);

  // ---- 4. DOMへ置くのは窓のぶんだけ ----
  rec('行が多くてもDOMへ置くのは画面の前後だけ',done.dom<total/2,`DOM ${done.dom}行 / データ ${total}行`);
  const spacer=await page.evaluate(()=>{
   const s=[...document.querySelectorAll('#grid tbody tr.grid-virtual-spacer')];
   return {n:s.length,h:s.map(x=>Math.round(x.getBoundingClientRect().height))};
  });
  rec('上下の詰め物でスクロールの長さは全行ぶんに見える',spacer.n>=1,JSON.stringify(spacer));

  // ---- 5. スクロールすると窓が入れ替わる ----
  const firstTop=await page.evaluate(()=>{
   const g=document.querySelector('#grid');g.scrollTop=0;
   return document.querySelector('#grid tbody tr:not(.grid-virtual-spacer) td:nth-child(1)')?.textContent;
  });
  await paint();
  const deep=await page.evaluate(async()=>{
   const g=document.querySelector('#grid');g.scrollTop=g.scrollHeight*0.6;
   await new Promise(r=>setTimeout(r,600));
   const tds=[...document.querySelectorAll('#grid tbody tr:not(.grid-virtual-spacer) td:nth-child(1)')];
   return {first:tds[0]?.textContent,n:tds.length};
  });
  // 1列目は行番号。窓が入れ替われば、先頭に見えている行番号が大きくなる。
  rec('下の方までスクロールすると、その辺りの行が出てくる',
    +deep.first>+firstTop+100&&deep.n>0,`先頭の行番号 ${firstTop} → ${deep.first}（${deep.n}行）`);
  const scrollDom=await page.evaluate(()=>document.querySelectorAll('#grid tbody tr').length);
  rec('スクロールしてもDOMの行数は増え続けない',scrollDom<total/2,`${scrollDom}行`);
  /* ---- §9.297 速いスクロールでも空きが見えない（利用者の指摘） ----
     組み直しは`requestAnimationFrame`にまとめてあるので**1フレームは必ず
     遅れる**。前後に画面1つぶんを先取りしておけば、その1フレームで画面より
     多く動いても空行（スペーサ）が見えない。
     **「前後に何行あるか」で見ること**——`overscan`の定数を読む網は、
     器の高さから決める作りになっていても通らない（実測で数える）。 */
  const buffer=await page.evaluate(()=>{
   const g=document.querySelector('#grid');
   const rows=[...g.querySelectorAll('tbody tr:not(.grid-virtual-spacer)')];
   if(!rows.length)return null;
   const rowH=rows[0].getBoundingClientRect().height||24;
   const view=g.getBoundingClientRect();
   const above=rows.filter(r=>r.getBoundingClientRect().bottom<=view.top).length;
   const below=rows.filter(r=>r.getBoundingClientRect().top>=view.bottom).length;
   return {above,below,viewRows:Math.ceil(g.clientHeight/rowH),dom:rows.length};
  });
  rec('画面の前後に「画面1つぶんに近い」行を先に作ってある（速いスクロールで空きが出ない）',
      !!buffer&&buffer.above>=Math.floor(buffer.viewRows*0.6)
      &&buffer.below>=Math.floor(buffer.viewRows*0.6),JSON.stringify(buffer));
  /* **先取りしすぎない**——1回の組み直しが重くなる（§9.94）。 */
  rec('先取りは画面3つぶんまで（組み直しを重くしない）',
      !!buffer&&buffer.dom<=buffer.viewRows*3+4,JSON.stringify(buffer));

  // ---- 6. 途中で戻したら続きの読み込みは止まる ----
  await W.listView(page);await page.selectOption('#pageSize','200');
  /* §9.286 ②: ページの札は「1–200」のように**何件目から何件目か**を出す
     （ページ番号は`title`。同じことを2通りで言わない・§CLAUDE 8）。 */
  await page.waitForFunction(()=>/^1[–-]/.test(document.querySelector('#page')?.textContent||''),{timeout:20000});
  await idle(1000,15000);  // 起きないこと（続きが後から足されない）を見る: 裏の読み込みが静まるまで
  const back=await page.evaluate(()=>({rows:S.rows.length,dom:document.querySelectorAll('#grid tbody tr').length,
    prev:document.querySelector('#prev').disabled,next:document.querySelector('#next').disabled}));
  rec('200件へ戻すと200行に戻る（続きの読み込みが後から足さない）',
    back.rows===200&&back.dom===200,JSON.stringify(back));
  rec('200件ではページ送りが使える',back.next===false,JSON.stringify(back));

  rec('コンソールに例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
}, {viewport:{width:1500,height:900},
    init:()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A')});
