/* test_navwords.js: 左メニューの「言葉と説明」を固定する（§9.447、利用者の指示）
   ============================================================
   点検で測ったのは4つ。**数で言える形にしてから**直した（§CLAUDE C）。

     E1 説明の無い行き先          3/11(27%) → 0
     E3 出どころが先に来る説明    3         → 0
     A1c 名前が中身を言わない行き先 2        → 1（残る1つはマスタの[表示名]）
     W  ラベルのはみ出し          0         → 0

   ここが見張るのは「**行き先は必ず説明を持つ**」「**説明は用途が先・
   出どころが後**」「**曖昧語を取り去ると何も残らない名前を作らない**」、
   そして「**数えられなかったときに理由が読める**」（§9.450）の4つ。
   畳んだ左メニューの浮き出し（§9.265）は`title`を本文に使うので、
   説明が無い行き先は**畳んだ瞬間に名前だけ**になる。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');

/* 中身を言わない語。「実績データ」の『データ』のように、取り去っても
   意味が変わらないもの。**ここを増やすときは理由を書くこと**。 */
const EMPTY=['データ','情報','もの','リスト'];
/* 出どころの印。説明の**頭**に来ていたら「機械語が先」。 */
const MACH=/キー |キー:|ファイル:|\.sqlite3|[A-Z]{4,}/;

run('test_navwords: 左メニューの言葉と説明（§9.447）', async ({page,rec,B,W,idle})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();
 /* 元データのボタンはカタログから組む（§9.87）。**黙って待たない**
    （§9.360）——出ないなら、それ自体がこの網の見るべき失敗。 */
 await page.waitForSelector('#nav [data-db-key]',{timeout:15000});
 await idle();
 const items=await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('aside nav.nav-group').forEach(g=>{
   const gl=((g.querySelector('.nav-group-label')||{}).textContent||'').trim();
   g.querySelectorAll('.nav-item').forEach(b=>{
    const sp=b.querySelector('span')||b;
    out.push({group:gl,label:(sp.textContent||'').trim(),
      title:(b.getAttribute('title')||'').trim(),
      fromMaster:!!b.dataset.dbKey,
      over:sp.scrollWidth-sp.clientWidth});
   });
  });
  document.querySelectorAll('.nav-foot .nav-item').forEach(b=>{
   const sp=b.querySelector('span')||b;
   out.push({group:'(足元)',label:(sp.textContent||'').trim(),
     title:(b.getAttribute('title')||'').trim(),fromMaster:false,
     over:sp.scrollWidth-sp.clientWidth});
  });
  return out;
 });
 rec('行き先を読めた（10件以上）',items.length>=10,items.length+'件');

 /* ---- E1: 説明の無い行き先は0 ---- */
 const noDesc=items.filter(x=>!x.title);
 rec('行き先は全部が説明を持つ（畳むと浮き出しが本文に使う・§9.265）',
     noDesc.length===0,noDesc.map(x=>x.label).join('・'));

 /* ---- E3: 出どころが先に来ていない ---- */
 const srcFirst=items.filter(x=>x.title&&MACH.test(x.title.slice(0,24)));
 rec('説明は用途が先・出どころが後（§CLAUDE 6は満たしたまま）',
     srcFirst.length===0,srcFirst.map(x=>x.label+'→'+x.title.slice(0,30)).join(' / '));

 /* 元データ（マスタ由来）の説明は、用途と出どころの両方を持つ */
 const ds=items.filter(x=>x.fromMaster);
 const bothOk=ds.filter(x=>x.title.includes('出どころ:')&&x.title.split('\n')[0].includes('｜'));
 rec('元データの説明は「用途｜…」＋「出どころ: …」の2行',
     ds.length>0&&bothOk.length===ds.length,
     ds.length+'件中'+bothOk.length+'件');

 /* ---- A1c: 曖昧語を取り去ると何も残らない名前 ---- */
 const WORDS=['実績','データ','一覧','測定','カレンダー','スケジュール','元データ'];
 const strip=t=>{let r=t;EMPTY.forEach(w=>{r=r.split(w).join('')});return r.trim()};
 const vague=WORDS.filter(w=>items.filter(x=>x.label.includes(w)).length>=2);
 const blind=items.filter(x=>vague.some(w=>x.label.startsWith(w)&&!strip(x.label.slice(w.length))));
 /* **コードで直せるのはコードが書いた名前だけ**——データソースマスタの
    [表示名]は利用者のものなので数に入れない（説明のほうで言い切る）。 */
 const mine=blind.filter(x=>!x.fromMaster);
 rec('曖昧語を取り去ると何も残らない名前が無い（マスタ由来は除く）',
     mine.length===0,blind.map(x=>x.label+(x.fromMaster?'(マスタ)':'')).join('・'));

 /* ---- W: ラベルが器からはみ出していない ---- */
 const over=items.filter(x=>x.over>0);
 rec('ラベルが器からはみ出していない',over.length===0,
     over.map(x=>x.label+'(+'+x.over+'px)').join('・'));

 /* ---- 「実績」が3つ別々の意味で並んでいないこと（§9.447 ①） ---- */
 const act=items.filter(x=>x.label.startsWith('実績'));
 rec('「実績」で始まる行き先は1つまで（元データの前工程実績だけ）',
     act.length<=1,act.map(x=>`${x.label}(${x.group})`).join('・'));

 /* ---- 件数を数えられなかったときに、理由が読めること（§9.450） ----
    以前は`!`の1文字だけで、何が起きたのか・次に何をすればよいのかが
    **画面にも記録にも残らなかった**。取り替えは`WL.measureHooks`の
    `own`（§9.352）で行い、**その場で戻す**（§9.399）。 */
 const bad=await page.evaluate(async()=>{
  const prev=WL.measureHooks.owner('reliableAll');
  WL.measureHooks.own('reliableAll',()=>{throw new Error('読めません（網の細工）')});
  try{
   await WL.records.refreshDraftCount();
   const b=document.getElementById('homeDraftCount');
   return {txt:(b.textContent||'').trim(),title:b.getAttribute('title')||'',
           marked:b.classList.contains('is-bad')};
  }finally{
   WL.measureHooks.own('reliableAll',prev||null);
   await WL.records.refreshDraftCount().catch(()=>{});
  }
 });
 rec('数えられなかったら理由と次の手立てを字で出す（黙って`!`だけにしない）',
     bad.txt==='!'&&bad.title.includes('読めません（網の細工）')&&/ログ・診断/.test(bad.title),
     JSON.stringify(bad).slice(0,160));
 rec('印は色だけでなく字も伴う（§CLAUDE 3）',bad.marked&&!!bad.title,String(bad.marked));
}, {mode:'edit', viewport:{width:1728,height:1030}});
