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
 /* **画面比では見ない**（§9.323 ⑥で書き直した。§9.200）——この網は§9.286 ⑦で
    「620pxの既定から広げた」ことを固定するために書かれたが、物差しが
    **画面の何割か**だった。利用者の指摘「余白が広すぎます」で器を中身から
    決めた（§CLAUDE 画面基準 11）ので、画面比の約束とは正面から反対になる。
    **守りたいのは「620pxの既定へ戻っていないこと」**なので、そう書く
    ——レールと本文の行長が両方収まっていれば、既定へは戻っていない。 */
 const need=await page.evaluate(()=>{
  const rail=document.querySelector('.cl-rail');
  const li=document.querySelector('.changelog-entry li');
  return {rail:rail?Math.round(rail.getBoundingClientRect().width):0,
          text:li?Math.round(parseFloat(getComputedStyle(li).maxWidth)||0):0};
 });
 rec('窓がレールと本文の行長を収めている（620pxの既定へ戻っていない）',
     box.w>=need.rail+need.text,JSON.stringify({窓:box.w,...need}));
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

 /* ---- 器は中身の長さから決める（§9.323 ⑥、利用者の報告） ----
    「更新履歴が表示されるエリアと改行の位置がずれていて余白が広すぎます」
    以前は幅が`1180px`の直値で、本文の行長（`li{max-width:76ch}`）と何の関係も
    無かった——実測で**器の使える幅868pxに対して文字は591px**、右に**277px
    （器の32%）**が空いていた。
    **宣言ではなく刷り上がりで見る**（§9.289）——「幅の式が在ること」を見る網は、
    式が間違っていても通る。**文字が実際に置かれた右端**（Range の矩形）と
    **器の内寸**を突き合わせる。 */
 const fit=await page.evaluate(()=>{
  const main=document.querySelector('.cl-main');
  if(!main)return null;
  const cs=getComputedStyle(main);
  const inner=main.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  let widest=0,lines=0;
  [...document.querySelectorAll('.changelog-entry li')].slice(0,40).forEach(li=>{
   const r=document.createRange();r.selectNodeContents(li);
   const rects=[...r.getClientRects()];
   lines+=rects.length;
   rects.forEach(x=>{if(x.width>widest)widest=x.width});
  });
  const li=document.querySelector('.changelog-entry li');
  return {内寸:Math.round(inner),いちばん長い行:Math.round(widest),
          行長の指定:li?getComputedStyle(li).maxWidth:'',行数:lines};
 });
 /* **器の3割が空いていない**こと。カードの内側の余白（12px×2）とバーの帯ぶんは
    残るので、そこは許容する。 */
 rec('器の右に大きな空きが残らない（中身の長さから決まっている）',
     !!fit&&(fit.内寸-fit.いちばん長い行)<=60,
     JSON.stringify(fit));
 /* **片側だけ見ない**——器を詰めるついでに行を短くしては本末転倒。
    行長は日本語で読みやすい全角40〜45文字の範囲に居ること。 */
 const em=await page.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize)||14);
 rec('行長は日本語で読みやすい範囲のまま（全角38〜48文字）',
     !!fit&&fit.いちばん長い行/em>=38&&fit.いちばん長い行/em<=48,
     JSON.stringify({全角:fit?Math.round(fit.いちばん長い行/em):null,em}));
 /* **器と本文が「同じ数」から作られているかは、動かして確かめる**（§9.163）。
    computed style では見分けが付かない——`76ch`と`42em`はこのフォントでは
    たまたま同じpxに解けるので、`px`で終わっているかを見る網は
    **直値へ戻しても通る**（実際に素通りした）。
    `--cl-text-w`を変えたときに**器と本文が一緒に動く**ことで見る。
    片方だけ動く実装＝どちらかが直値、が必ず落ちる。 */
 const linked=await page.evaluate(()=>{
  const d=document.querySelector('.changelog-dialog');
  const li=()=>document.querySelector('.changelog-entry li');
  const read=()=>({窓:Math.round(d.getBoundingClientRect().width),
                   行長:Math.round(parseFloat(getComputedStyle(li()).maxWidth)||0)});
  const before=read();
  const was=d.style.getPropertyValue('--cl-text-w');
  d.style.setProperty('--cl-text-w','300px');
  const after=read();
  if(was)d.style.setProperty('--cl-text-w',was);else d.style.removeProperty('--cl-text-w');
  return {before,after};
 });
 rec('器と本文が同じ数（--cl-text-w）から作られている（片方だけ直値ではない）',
     !!linked&&linked.after.行長===300&&linked.after.窓<linked.before.窓,
     JSON.stringify(linked));

 /* ---- 開発の記録の出し入れ（§9.336、REVIEW 3-12） ----
    現場の人が開く画面に、テストの名前・§番号・中のファイル名が並ぶのをやめた。
    **「ボタンが在る」だけを見ない**——伏せていない実装でも通る。
    伏せている版が**実際に描かれていないこと**と、押すと**出ること**、
    もう一度押すと**戻ること**（片道にしない）まで見る。 */
 const clSnap=()=>page.evaluate(()=>({
  vers:[...document.querySelectorAll('[data-cl-entry]')].map(e=>e.dataset.clEntry),
  btn:document.querySelector('#changelogDev')?.textContent.trim()||'',
  btnShown:!!document.querySelector('#changelogDev')&&!document.querySelector('#changelogDev').hidden,
  hits:document.querySelector('#changelogHits')?.textContent||'',
  now:document.querySelector('.changelog-entry.is-now')?.dataset.clEntry||'',
 }));
 /* **窓はここまで開いたまま。** もう一度バッジを押すと窓に覆われて届かない
    （クリックが時間切れになる）ので、覚えを消して描き直すだけにする。 */
 await page.evaluate(()=>{
  try{localStorage.removeItem('ChangelogShowDevV1')}
  catch(e){console.log('覚えを消せない（既定＝伏せるで続く）',e.message)}
  if(window.clRender)window.clRender();
 });
 await page.waitForFunction(()=>{
  const b=document.querySelector('#changelogDev');
  return !!b&&!b.hidden&&/開発の記録/.test(b.textContent||'');
 },{timeout:10000});
 const off=await clSnap();
 rec('開発の記録の出し入れボタンが出ている',off.btnShown&&/開発の記録も出す（\d+版）/.test(off.btn),off.btn);
 rec('既定では開発の記録の版が出ていない',
     !off.vers.includes('2.217.0')&&!off.vers.includes('2.216.0'),
     JSON.stringify(off.vers.slice(0,6)));
 rec('伏せていることと件数を文字で言う',/開発の記録 \d+版 は伏せています/.test(off.hits),off.hits);
 rec('いま動いている版は伏せていても出ている（唯一の手掛かり）',
     !!off.now&&off.vers.includes(off.now),JSON.stringify({now:off.now}));
 await page.click('#changelogDev');
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-cl-entry]')]
   .some(e=>e.dataset.clEntry==='2.217.0'),{timeout:10000});
 const on=await clSnap();
 rec('押すと開発の記録が出る',on.vers.includes('2.217.0')&&on.vers.length>off.vers.length,
     JSON.stringify({前:off.vers.length,後:on.vers.length}));
 rec('出していることも文字で言う',/開発の記録 \d+版 を含む/.test(on.hits),on.hits);
 rec('ボタンの文字が「伏せる」へ変わる',/開発の記録を伏せる/.test(on.btn),on.btn);
 await page.click('#changelogDev');
 await page.waitForFunction(()=>![...document.querySelectorAll('[data-cl-entry]')]
   .some(e=>e.dataset.clEntry==='2.217.0'),{timeout:10000});
 const again=await clSnap();
 rec('もう一度押すと戻る（片道にしない）',
     again.vers.length===off.vers.length&&!again.vers.includes('2.217.0'),
     JSON.stringify({前:off.vers.length,後:again.vers.length}));

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
