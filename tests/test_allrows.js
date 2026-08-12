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
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const ctx=await b.newContext({viewport:{width:1500,height:900}});
 await ctx.addInitScript(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 const page=await ctx.newPage();
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
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

  const mark=tableCalls.length;
  await page.selectOption('#pageSize','all');
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
  await page.waitForTimeout(300);
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

  // ---- 6. 途中で戻したら続きの読み込みは止まる ----
  await page.selectOption('#pageSize','200');
  await page.waitForFunction(()=>document.querySelector('#page')?.textContent==='1ページ',{timeout:20000});
  await page.waitForTimeout(2500);
  const back=await page.evaluate(()=>({rows:S.rows.length,dom:document.querySelectorAll('#grid tbody tr').length,
    prev:document.querySelector('#prev').disabled,next:document.querySelector('#next').disabled}));
  rec('200件へ戻すと200行に戻る（続きの読み込みが後から足さない）',
    back.rows===200&&back.dom===200,JSON.stringify(back));
  rec('200件ではページ送りが使える',back.next===false,JSON.stringify(back));

  rec('コンソールに例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  console.error('FATAL',e);
 }finally{
  await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
