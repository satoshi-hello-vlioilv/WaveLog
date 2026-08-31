/* test_changelogui.js: 更新履歴の窓（§9.286 ⑦、利用者の報告）

   ============================================================
   「更新履歴の<b>みたいなタグが出ているので修正をお願いします。更新履歴は
    モーダルを大きくし読みやすくわかりやすいように再構成してください」

   ここで固定すること
   ------------------------------------------------------------
    1. 強調・コードが**タグの字ではなく`<b>`/`<code>`として**出る
    2. 窓が大きく、左のレールと右の中身が**別々にスクロールする**
    3. レールには版と一言が出て、押すとその版へ跳ぶ
    4. いま動いている版に**文字で**印が付く（§CLAUDE 画面基準 3）
    5. 言葉で絞り込める。当たった言葉が光り、件数を文字で出す

   **中身まで見ること**——「窓が開く」だけを見る網は、タグが字のまま
   出ていても通る（実際に186個そのまま出ていた）。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('.build-badge.build-badge-clickable',{timeout:20000});

 await page.click('.build-badge');
 await page.waitForFunction(()=>{
  const m=document.querySelector('#changelogModal');
  return m&&!m.hidden&&document.querySelectorAll('#changelogList .changelog-entry').length>0;
 },{timeout:15000});

 /* ---- 1) 生のタグが字のまま出ていない ---- */
 /* **`<code>`の中の字は数えない**——更新履歴には「`<b>`のようなタグが出て
    いた」と**タグそのものを話題にしている行**がある。あれは字として出るのが
    正しく（`<code>`で囲ってある）、漏れたタグとは別のこと。数えたいのは
    「囲いの外へ字のまま出てしまったタグ」だけ。 */
 const tags=await page.evaluate(()=>{
  const main=document.querySelector('#changelogList');
  const c=main.cloneNode(true);
  c.querySelectorAll('code').forEach(x=>x.remove());
  const txt=c.textContent||'';
  return {raw:(txt.match(/<\/?[a-zA-Z][a-zA-Z0-9]*>/g)||[]).slice(0,4),
          marks:(txt.match(/\*\*/g)||[]).length,
          b:main.querySelectorAll('li b').length,
          code:main.querySelectorAll('li code').length,
          entries:main.querySelectorAll('.changelog-entry').length};
 });
 rec('囲いの外にHTMLタグの字が出ていない',tags.raw.length===0,JSON.stringify(tags.raw));
 rec('強調の印（**）が字のまま残っていない',tags.marks===0,String(tags.marks));
 rec('強調が<b>として出ている',tags.b>0,`b=${tags.b}`);
 rec('コードが<code>として出ている',tags.code>0,`code=${tags.code}`);
 rec('版が全部出ている',tags.entries>100,`${tags.entries}版`);

 /* ---- 2) 窓が大きい／2列が別々にスクロールする ---- */
 const box=await page.evaluate(()=>{
  const d=document.querySelector('.changelog-dialog');
  const rail=document.querySelector('#changelogRail'),main=document.querySelector('#changelogList');
  const r=d.getBoundingClientRect();
  return {w:Math.round(r.width),h:Math.round(r.height),
          vw:innerWidth,vh:innerHeight,
          railScroll:rail.scrollHeight>rail.clientHeight+1,
          mainScroll:main.scrollHeight>main.clientHeight+1,
          railLeft:Math.round(rail.getBoundingClientRect().left),
          mainLeft:Math.round(main.getBoundingClientRect().left)};
 });
 rec('窓が画面の6割以上の幅を使う',box.w>=box.vw*0.6,JSON.stringify(box));
 rec('窓が画面の7割以上の高さを使う',box.h>=box.vh*0.7,`${box.h}/${box.vh}`);
 rec('レールと中身が別々にスクロールする',box.railScroll&&box.mainScroll&&box.railLeft<box.mainLeft,
     JSON.stringify(box));

 /* ---- 3) いま動いている版の印（文字で） ---- */
 const now=await page.evaluate(()=>{
  const el=document.querySelector('.changelog-entry.is-now .cl-now');
  const row=document.querySelector('#changelogRail .cl-rail-row em');
  return {chip:(el?.textContent||'').trim(),rail:(row?.textContent||'').trim(),
          sub:(document.querySelector('#changelogSub')?.textContent||'').trim()};
 });
 rec('いま動いている版に文字の印が付く',/いま動いている版/.test(now.chip),JSON.stringify(now));
 rec('レールでもいまの版が分かる',now.rail==='いま',now.rail);
 rec('副題がいまの版を名乗る',/VER\d/.test(now.sub),now.sub);

 /* ---- 4) レールから跳べる ---- */
 const jump=await page.evaluate(async()=>{
  const raf=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const rows=[...document.querySelectorAll('#changelogRail [data-cl-ver]')];
  const target=rows[Math.min(60,rows.length-1)];
  const ver=target.dataset.clVer;
  const main=document.querySelector('#changelogList');
  const before=main.scrollTop;
  target.click();await raf();
  const el=main.querySelector(`[data-cl-entry="${CSS.escape(ver)}"]`);
  const gap=Math.round(el.getBoundingClientRect().top-main.getBoundingClientRect().top);
  return {ver,before,after:main.scrollTop,gap,
          active:target.classList.contains('is-active'),
          lead:(target.querySelector('small')?.textContent||'').trim().length};
 });
 rec('レールの行に一言（見出し）が出る',jump.lead>4,`${jump.lead}文字`);
 rec('レールを押すとその版が器の先頭に来る',jump.after>jump.before&&Math.abs(jump.gap)<=2,
     JSON.stringify(jump));
 rec('跳んだ先がレールで分かる',jump.active,String(jump.active));

 /* ---- 5) 言葉で絞り込める ---- */
 await page.fill('#changelogSearch','フィルタ');
 await page.waitForTimeout(400);
 const q=await page.evaluate(()=>({
  entries:document.querySelectorAll('#changelogList .changelog-entry').length,
  rows:document.querySelectorAll('#changelogRail [data-cl-ver]').length,
  marks:document.querySelectorAll('#changelogList mark').length,
  hits:(document.querySelector('#changelogHits')?.textContent||'').trim(),
  clear:!document.querySelector('#changelogClear')?.hidden,
 }));
 rec('絞り込むと版が減る',q.entries>0&&q.entries<tags.entries,`${q.entries}/${tags.entries}`);
 rec('レールも同じだけ絞られる',q.rows===q.entries,`${q.rows}/${q.entries}`);
 rec('当たった言葉が光る',q.marks>0,`mark=${q.marks}`);
 rec('当たった件数を文字で出す',/当たりました/.test(q.hits),q.hits);
 rec('絞り込みを外す手立てが同じ場所にある',q.clear,String(q.clear));
 /* 光らせるのは**タグの外だけ**（中に当てるとHTMLが壊れる）。 */
 const safe=await page.evaluate(()=>{
  const c=document.querySelector('#changelogList').cloneNode(true);
  c.querySelectorAll('code').forEach(x=>x.remove());
  const t=c.textContent||'';
  return {raw:(t.match(/<\/?[a-zA-Z][a-zA-Z0-9]*>/g)||[]).slice(0,3),
          b:document.querySelectorAll('#changelogList li b').length};
 });
 rec('絞り込んでもHTMLが壊れない',safe.raw.length===0&&safe.b>0,JSON.stringify(safe));

 await page.click('#changelogClear');
 await page.waitForTimeout(300);
 const back=await page.evaluate(()=>document.querySelectorAll('#changelogList .changelog-entry').length);
 rec('外すと全部戻る',back===tags.entries,`${back}/${tags.entries}`);

 await page.evaluate(()=>{const m=document.querySelector('#changelogModal');if(m)m.hidden=true});

 console.log('\n=== SUMMARY ===');
 const f=R.filter(r=>!r.ok);console.log(`${R.length-f.length}/${R.length} passed`);
 f.forEach(x=>console.log(' -',x.n,x.d||''));
 await b.close();process.exit(f.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
