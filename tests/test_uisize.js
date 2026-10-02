/* test_uisize.js: 表示サイズ（--ui-scale の3段）

   ============================================================
   `test_calscale.js` をここへ取り込んだ（§9.249 ④、利用者の指示
   「重複しているテストは統合できるか確認し必要に応じて統合して最適化」）
   ------------------------------------------------------------
   あちらは「実績カレンダーの文字と寸法が小<中<大で変わり、比率が
   `--ui-scale`(.92/1/1.1)どおりか」を見る56行で、そのためだけに
   ブラウザをもう1回立ち上げていた。**見ている軸は同じ**（表示サイズ）
   なので、段の選び方を確かめたこの流れの続きで測る。
   あちらが吐いていた `cal_sm.png` / `cal_lg.png`（誰も読まない置き土産）も
   ここでは撮らない。

   ここで固定すること
   ------------------------------------------------------------
    1. 段は3つ（sm/md/lg）で、既定は中
    2. 段を変えるとアプリ全体（本文・ナビ・バッジ）が同時に変わる
    3. 再読込しても選んだ段が残る
    4. 廃止した段（xs/xl）の保存値は近い段へ寄せる（§9.132）
    5. **実績カレンダー**も文字・マス・ボタン・明細幅が段どおりに伸び縮みし、
       大でも横スクロールが出ない
    6. **時間の書き方**（§9.341）も同じバッジの中にあり、既定は「分」、
       選ぶと**いま出ている画面の数字が書き直る**

   時間の書き方をここで見る理由
   ------------------------------------------------------------
   入口が`#uiSizeBadge`の1つに統合されたので（§9.341）、**バッジの中身は
   1本の網が見る**。片方だけの網にすると、節を1つ足したときに「開いたら
   もう片方が消えていた」を誰も見ない。

   **`WL.duration`の出力だけを見て終わりにしないこと**（§9.229 ⑥）。
   関数が正しくても、画面がその答えを使っていなければ何も変わらない。
   稼働状況（`#dbStatusView`）を実際に開き、**描かれた字が変わること**まで
   見る——ここは元の指摘（4-4 ⑰「150分と出ている」）そのものの画面。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
/* 待ちは`tests/lib/wait.js`の道具で置く（固定待ちを増やさない・§9.347）。 */
const W=require('./lib/wait.js');
run('test_uisize: 表示サイズ（--ui-scale の3段）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 rec('表示サイズボタンがヘッダーにある',true);
 rec('作業スケジュール専用の高密度トグルは廃止',(await page.$$('#scDenseToggle')).length===0);

 const measure=async()=>page.evaluate(()=>{
  const cs=getComputedStyle;
  return {
   size:document.documentElement.dataset.uiSize,
   body:cs(document.body).fontSize,
   nav:Math.round(document.querySelector('#openSchedule').getBoundingClientRect().height),
   badge:cs(document.querySelector('#accessModeBadge')).fontSize,
   scale:cs(document.documentElement).getPropertyValue('--ui-scale').trim(),
  };
 });
 const md=await measure();
 rec('既定は中(md)',md.size==='md',JSON.stringify(md));

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 const opts=await page.$$eval('#uiSizeMenu [data-ui-size-option]',bs=>bs.map(x=>x.dataset.uiSizeOption));
 rec('3段階の選択肢が出る',opts.length===3&&opts.join(',')==='sm,md,lg',opts.join(','));

 await page.click('#uiSizeMenu [data-ui-size-option="lg"]');
 await W.until(page,v=>document.documentElement.dataset.uiSize===v,'lg',{ms:4000,what:'表示サイズ=lg'});
 const lg=await measure();
 rec('大にするとアプリ全体(本文・ナビ・バッジ)が同時に大きくなる',
   parseFloat(lg.body)>parseFloat(md.body)&&lg.nav>md.nav&&parseFloat(lg.badge)>parseFloat(md.badge),
   JSON.stringify(lg));

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="sm"]');
 await W.until(page,v=>document.documentElement.dataset.uiSize===v,'sm',{ms:4000,what:'表示サイズ=sm'});
 const sm=await measure();
 rec('小にすると全体が小さくなる',
   parseFloat(sm.body)<parseFloat(md.body)&&sm.nav<md.nav,JSON.stringify(sm));

 // 永続化
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:10000});
 const after=await measure();
 rec('再読込後も選択した表示サイズが保持される',after.size==='sm',JSON.stringify(after));

 /* 廃止した段(極小xs・特大xl)を保存している端末の行き先(§9.132)。
    無効として既定(中)へ落とすと、**わざわざ選んでいた人ほど設定が黙って
    戻る**ので、残った段のいちばん近いものへ寄せる。ここは実機に既に
    保存されている値の話なので、消したから終わりにはできない。 */
 for(const [old,want] of [['xl','lg'],['xs','sm']]){
  await page.evaluate(v=>localStorage.setItem('MeasurementUiSizeV1',v),old);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#uiSizeBadge',{timeout:10000});
  const m=await measure();
  rec(`廃止した段(${old})の保存値は近い段(${want})へ寄せる`,m.size===want,JSON.stringify(m));
 }

 /* ---------- 読み込み中の見せ方（§9.421 → §9.436） ----------
    loaders.css（MIT）から写した28種＋既定の29種を同梱し、**選ぶのは
    共通設定＞この端末の盤**（「表示」バッジには行き先だけを置く）。
    **同梱**なので、回線の無い端末でも動く——外部CDNへ取りに行かない。 */
 await page.evaluate(()=>localStorage.removeItem('MeasurementLoaderV1'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 const ld0=await page.evaluate(()=>({
  attr:document.documentElement.dataset.loader,
  style:window.WL.loader.style(),
  n:window.WL.loader.STYLES.length,
  slots:window.WL.loader.SLOTS,
  keys:window.WL.loader.STYLES.map(l=>l.key).join(','),
  /* 族は全部が中身を持つこと（空の見出しを出さない）。 */
  groups:window.WL.loader.GROUPS.map(g=>g.key+':'+window.WL.loader.STYLES.filter(l=>l.group===g.key).length).join(' '),
  orphan:window.WL.loader.STYLES.filter(l=>!window.WL.loader.GROUPS.some(g=>g.key===l.group)).map(l=>l.key).join(','),
  empty:window.WL.loader.GROUPS.filter(g=>!window.WL.loader.STYLES.some(l=>l.group===g.key)).map(g=>g.key).join(','),
 }));
 rec('既定は「輪と点」（これまでの見せ方）',
     ld0.attr==='ring'&&ld0.style==='ring',JSON.stringify({a:ld0.attr,s:ld0.style}));
 rec('選べるのは29種（loaders.css から写した28種＋既定）',
     ld0.n===29&&/ball-pulse/.test(ld0.keys),String(ld0.n));
 /* **水の波紋は要件**（利用者の指示「水の波紋のようなものも使いたいです」）。 */
 rec('水の波紋（広がって消える輪）が在る',
     /ball-scale-ripple\b/.test(ld0.keys)&&/ball-scale-ripple-multiple/.test(ld0.keys),ld0.keys.slice(0,80));
 /* 族は「見出し＝中身が在るもの」だけ。**どちらの向きにも取りこぼさない**
    ——族の無い種類も、中身の無い族も出さない（§9.436）。 */
 rec('29種はすべて族に属し、空の族は無い',
     !ld0.orphan&&!ld0.empty,ld0.groups+' orphan='+ld0.orphan+' empty='+ld0.empty);
 /* **並びは1つ**（`<i>`が9つ＝格子3×3に要る数）。種類を変えてもDOMを
    作り直さないので、動いている最中に切り替えても飛ばない。 */
 const mk=await page.evaluate(()=>{
  const d=document.createElement('div');
  d.innerHTML=window.WL.loader.html(16);
  const el=d.firstElementChild;
  return {cls:el.className,kids:el.children.length,ld:el.dataset.ld,
          size:el.getAttribute('style')||'',
          tags:[...el.children].map(c=>c.tagName).join(',')};
 });
 rec('並びを作るのは`WL.loader.html()`の1箇所（`<i>`が9つ・種類は器が名乗る）',
     mk.cls==='wl-ld'&&mk.kids===9&&mk.ld==='ring'&&/--wl-ld:\s*16px/.test(mk.size),JSON.stringify(mk));
 /* 保存オーバーレイも同じ並びに載っている（呼び出しが自前の形を持たない）。 */
 const ov=await page.evaluate(()=>{
  const el=document.querySelector('#saveOverlay .wl-ld');
  return el?{kids:el.children.length,cls:el.className,ld:el.dataset.ld}:null;
 });
 rec('保存オーバーレイのローダーも同じ並びに載っている',
     !!ov&&ov.kids===9&&ov.ld==='ring',JSON.stringify(ov));
 /* **「表示」バッジには行き先だけ**（§9.436）。29種はポップオーバーに入らない
    （実測: 1種50pxで29種＝1450px、画面の高さ1152pxを超える）。 */
 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 const link=await page.evaluate(()=>{
  const b=document.getElementById('uiSizeLoaderLink');
  return {has:!!b,txt:b?b.innerText:'',
    opts:document.querySelectorAll('#uiSizeMenu [data-loader-option]').length,
    menuH:Math.round(document.getElementById('uiSizeMenu').getBoundingClientRect().height),
    vh:window.innerHeight};
 });
 rec('「表示」バッジの3つめの節は行き先1つ（29種は狭い器に入らない）',
     link.has&&link.opts===0&&/共通設定/.test(link.txt)&&link.menuH<link.vh,
     JSON.stringify(link));
 rec('行き先にはいまの種類の名前が出る（押す前に読める）',
     /輪と点/.test(link.txt),link.txt.replace(/\n/g,' | '));
 /* ---- 広い選び場（共通設定＞この端末）。§9.436 の主役 ---- */
 await page.click('#uiSizeLoaderLink');
 await page.waitForSelector('#pcLd .pc-ld-card',{timeout:25000});
 /* **章は畳んである**（§9.261。29種をそのまま置くと1687pxになり、728pxの
    器に収まらない——`test_setpage.js`が見張る）。「表示」から来たときだけ
    開いて連れて行くので、ここでは開いている。 */
 rec('盤は共通設定の畳み（`.pc-acc`）に載り、「表示」から来ると開く',
     await page.$eval('#pcLd',e=>e.tagName==='DETAILS'&&e.classList.contains('pc-acc')&&e.open));
 const gal=await page.evaluate(()=>{
  const cards=[...document.querySelectorAll('#pcLd .pc-ld-card')];
  /* **見本は札ごとに別の種類**（入れ子でも取り違えない・§9.436）。
     器そのものが`data-ld`を名乗り、`data-ld-fixed`でいまの設定に
     引きずられない。 */
  const wrong=cards.filter(c=>{
   const f=c.querySelector('.wl-ld');
   return !f||f.dataset.ld!==c.dataset.loaderOption
          ||!f.hasAttribute('data-ld-fixed')||f.children.length!==9;
  }).map(c=>c.dataset.loaderOption);
  /* 見本は**大きさを持って描かれている**（0×0の札を「選べる」と言わない）。 */
  const flat=cards.filter(c=>{
   const r=c.querySelector('.pc-ld-fig .wl-ld').getBoundingClientRect();
   return r.width<8||r.height<8;
  }).map(c=>c.dataset.loaderOption);
  const r0=cards[0].getBoundingClientRect();
  const f0=cards[0].querySelector('.pc-ld-fig .wl-ld').getBoundingClientRect();
  return {n:cards.length,wrong:wrong.join(','),flat:flat.join(','),
    groups:document.querySelectorAll('#pcLd .pc-ld-group').length,
    cur:(document.querySelector('#pcLd .pc-ld-card.is-current')||{}).dataset?.loaderOption,
    now:(document.getElementById('pcLdNow')||{}).textContent||'',
    cell:Math.round(r0.width*r0.height),fig:Math.round(f0.width*f0.height)};
 });
 rec('共通設定＞この端末に29種の盤が出る（族ごとに束ねる）',
     gal.n===29&&gal.groups===7,JSON.stringify({n:gal.n,g:gal.groups}));
 rec('札の見本は札ごとの種類で描かれる（入れ子でも取り違えない）',
     !gal.wrong&&!gal.flat,'wrong='+gal.wrong+' flat='+gal.flat);
 /* **選ぶ前に見える量**（§9.200）。バッジの見本は22×15の席で約330px²
    しか無かった。盤では見本だけで2000px²前後を持つ。 */
 rec('見本は札の面積の1割以上を占める（バッジの3.4%から広げた）',
     gal.fig>1200&&gal.fig/gal.cell>0.08,`fig=${gal.fig} cell=${gal.cell} 比=${(gal.fig/gal.cell).toFixed(3)}`);
 rec('いま使っているものに印が付き、字でも言う（色だけで言わない）',
     gal.cur==='ring'&&/輪と点/.test(gal.now),gal.cur+' / '+gal.now);
 /* 選ぶと`WL.loader`が覚え、**使っている側の器が全部入れ替わる**。 */
 await page.click('#pcLd [data-loader-option="ball-scale-ripple-multiple"]');
 const ld1=await page.evaluate(()=>({
  attr:document.documentElement.dataset.loader,
  saved:localStorage.getItem('MeasurementLoaderV1'),
  ov:(document.querySelector('#saveOverlay .wl-ld')||{}).dataset?.ld,
  /* 実際に動いているか——CSSが当たっていれば輪に動きが付く。 */
  anim:(()=>{const el=document.querySelector('#saveOverlay .wl-ld > i');
    return el?getComputedStyle(el).animationName:''})(),
  shown:(()=>{const el=document.querySelector('#saveOverlay .wl-ld > i:nth-child(4)');
    return el?getComputedStyle(el).display:''})(),
  /* 盤の見本は**いまの設定に引きずられない**（`ring`の札は`ring`のまま）。 */
  sample:(document.querySelector('#pcLd [data-loader-option="ring"] .wl-ld')||{}).dataset?.ld,
  cur:(document.querySelector('#pcLd .pc-ld-card.is-current')||{}).dataset?.loaderOption,
 }));
 rec('選ぶと端末に覚え、使っている器の種類が入れ替わる',
     ld1.attr==='ball-scale-ripple-multiple'&&ld1.saved==='ball-scale-ripple-multiple'
     &&ld1.ov==='ball-scale-ripple-multiple',JSON.stringify(ld1));
 rec('選んだ種類の動きが当たっている（同梱のCSSが効いている）',
     ld1.anim==='wl-ld-ripple'&&ld1.shown!=='none',JSON.stringify({a:ld1.anim,s:ld1.shown}));
 rec('盤の見本はいまの設定に引きずられない（`data-ld-fixed`）',
     ld1.sample==='ring',String(ld1.sample));
 rec('印は選んだ札へ移る',ld1.cur==='ball-scale-ripple-multiple',String(ld1.cur));
 /* 既定（輪と点）に戻すと、使わない`<i>`はまた伏せる——並びは同じまま。 */
 await page.click('#pcLd [data-loader-option="ring"]');
 const ld2=await page.evaluate(()=>{
  const el=document.querySelector('#saveOverlay .wl-ld > i:nth-child(4)');
  const r=document.querySelector('#saveOverlay .wl-ld > i:nth-child(1)');
  return {fourth:el?getComputedStyle(el).display:'',
          first:r?getComputedStyle(r).animationName:''};
 });
 rec('種類が変わると使わない`<i>`は伏せる（並びは同じまま）',
     ld2.fourth==='none'&&ld2.first==='wl-ld-rotate',JSON.stringify(ld2));
 /* **入口は1つのまま、行き先を出す**（§9.433、利用者の報告「設定画面にない
    ので設定できるようにしてください」）。設定を探しに来るのは共通設定なので、
    バッジの説明に節の顔ぶれを書き、「この端末の見え方」を名前空間から
    まとめて読めるようにした（共通設定の盤がこの3つを並べて出す）。 */
 const look=await page.evaluate(()=>({
  title:document.getElementById('uiSizeBadge').title,
  size:!!(window.WL&&WL.uiSize&&WL.uiSize.SIZES&&WL.uiSize.size),
  dur:!!(window.WL&&WL.duration&&WL.duration.STYLES&&WL.duration.style),
  ld:!!(window.WL&&WL.loader&&WL.loader.STYLES&&WL.loader.style),
  open:typeof (window.WL&&WL.openLookSettings),
 }));
 rec('バッジの説明に節を全部書く（畳んだ中に何が在るか外から読める）',
     /文字の大きさ/.test(look.title)&&/時間の書き方/.test(look.title)
     &&/読み込み/.test(look.title),look.title);
 rec('この端末の見え方の3つは同じ形で読める（`SIZES`/`STYLES`と現在値）',
     look.size&&look.dur&&look.ld,JSON.stringify(look));
 rec('行き先の実体はマスタ画面が名乗る（土台は口だけ持つ）',
     look.open==='function',look.open);
 /* 変わったことを1つの合図で知らせる（受ける側＝共通設定の「いまの値」）。 */
 const beat=await page.evaluate(()=>new Promise(res=>{
  let n=0;
  const on=()=>{n++};
  document.addEventListener('wl:look-change',on);
  WL.loader.setStyle('ball-beat');
  WL.uiSize.setSize('lg');
  setTimeout(()=>{document.removeEventListener('wl:look-change',on);res(n)},80);
 }));
 rec('見え方が変わったら合図を出す（いまの値を出す画面が塗り直せる）',
     beat>=2,String(beat));
 await page.evaluate(()=>{WL.uiSize.setSize('md');WL.loader.setStyle('ring')});
 await page.evaluate(()=>localStorage.removeItem('MeasurementLoaderV1'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});

 /* ---------- 時間の書き方（§9.341） ---------- */
 await page.evaluate(()=>localStorage.removeItem('WaveLogDurationStyleV1'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});

 const durOut=()=>page.evaluate(()=>({
  style:WL.duration.style(),
  text:WL.duration.text(150),compact:WL.duration.compact(150),
  short:WL.duration.text(45),empty:WL.duration.text(null),
  neg:WL.duration.text(-90),big:WL.duration.text(4830),
 }));
 const d0=await durOut();
 rec('既定は「分」（利用者の指示）',d0.style==='min'&&d0.text==='150分',JSON.stringify(d0));
 /* **密な列でも単位を落とさない**（§9.341）。以前の`fmtCompact`は`2:30`と
    書いていたが、見出しは「実績」としか言っておらず、時分か分秒かは値の
    側にしか手掛かりが無い。 */
 rec('「分」では密な列も単位を書く（裸の数字を作らない）',
   d0.compact==='150分',d0.compact);
 rec('値が無いときは「-」、負の値は符号を保つ',
   d0.empty==='-'&&d0.neg==='-90分',`${d0.empty} / ${d0.neg}`);

 await page.click('#uiSizeBadge');
 await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 const menu=await page.evaluate(()=>{
  const m=document.getElementById('uiSizeMenu');
  const r=m.getBoundingClientRect();
  const fs=[...m.querySelectorAll('*')].filter(e=>(e.textContent||'').trim())
    .map(e=>parseFloat(getComputedStyle(e).fontSize)).filter(Boolean);
  return {
  幅:Math.round(r.width),字の最小px:Math.min(...fs),
  入口:[...document.querySelectorAll('button')]
    .filter(b=>b.offsetParent&&/^表示$/.test((b.innerText||'').trim())).length,
  heads:[...document.querySelectorAll('#uiSizeMenu .ui-size-menu-head')].map(h=>h.textContent.trim()),
  sizes:document.querySelectorAll('#uiSizeMenu [data-ui-size-option]').length,
  durs:[...document.querySelectorAll('#uiSizeMenu [data-duration-style]')].map(b=>b.dataset.durationStyle),
  hints:[...document.querySelectorAll('#uiSizeMenu [data-duration-style] small')].map(x=>x.textContent.trim()),
  current:document.querySelector('#uiSizeMenu [data-duration-style].is-current')?.dataset.durationStyle,
 };});
 /* ---- 入口は1つ・字は小さくしすぎない（§9.444、利用者の指示「表示という
    ボタンがそもそも2つあるのでわかりにくい」「文字が小さくなりすぎないように
    わかりやすく再構成して」）----
    実測（直す前）: 「表示」という名のボタンが2つ／この窓は236×399pxで
    **いちばん小さい字が節の見出しの9.5px**だった（見出しが本文より小さい）。 */
 rec('「表示」という名のボタンは1つだけ（§9.444）',
   menu.入口===1,`${menu.入口}個`);
 rec('節の見出しを含めて字を11px未満にしない（§9.444）',
   menu.字の最小px>=11,`最小 ${menu.字の最小px}px`);
 rec('節が増えたぶん器を広げてある（折り返しで縦に伸ばさない）',
   menu.幅>=320,`${menu.幅}px`);
 /* **節の数を決め打ちしない**（§9.389）。「この端末の見え方」は増えるので
    （§9.421 で3つめが入った）、見るのは**どれも名前を持つこと**と
    **前後関係**——正しい位置へ1枚足しただけで落ちる網にしない。 */
 rec('1つのバッジに節が名前つきで並ぶ（入口を2つに増やさない）',
   menu.heads.length>=2&&menu.heads.every(h=>h.length>0)
   &&menu.heads.indexOf('文字の大きさ')===0
   &&menu.heads.indexOf('時間の書き方')===1,
   menu.heads.join('／'));
 rec('文字の大きさ3段と時間の書き方2種が同居する',
   menu.sizes===3&&menu.durs.join(',')==='min,hm',`${menu.sizes}段 / ${menu.durs.join(',')}`);
 /* 選ぶ前に見える（§9.200）。名前だけでは150分がどう出るか分からない。 */
 rec('札に見本が出ている（選ぶ前に見える）',
   menu.hints.join('／')==='150分／2時間30分',menu.hints.join('／'));
 rec('いまどれかは開いた先が言う（バッジの字は「表示」で固定）',
   menu.current==='min',String(menu.current));

 await page.click('#uiSizeMenu [data-duration-style="hm"]');
 await W.until(page,()=>WL.duration.style()==='hm',null,{ms:4000,what:'所要時間の書き方=hm'});
 const d1=await durOut();
 rec('「時間と分」を選ぶと書き方が変わる',
   d1.style==='hm'&&d1.text==='2時間30分'&&d1.short==='45分',JSON.stringify(d1));
 rec('「時間と分」では密な列だけ h:mm へ詰める',d1.compact==='2:30',d1.compact);
 rec('60時間を超えても時間で書き切る（日へ繰り上げない）',d1.big==='80時間30分',d1.big);
 rec('バッジの字は選んだ値ではなく「表示」のまま',
   (await page.$eval('#uiSizeBadge',e=>e.textContent.trim()))==='表示');

 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 rec('再読込しても選んだ書き方が残る',(await durOut()).style==='hm');

 /* **描かれた字まで見る**（§9.229 ⑥）。`WL.duration`が正しくても、画面が
    その答えを使っていなければ4-4 ⑰は直っていない。稼働状況は「見込」
    「経過」「遅れ」を出す、指摘そのものの画面。 */
 await page.click('#openDashboard');
 /* 稼働状況が描かれて、画面ぶんの取得が静まるまで。 */
 await W.until(page,()=>{const e=document.getElementById('dbStatusView');return !!e&&e.innerText.trim().length>0},null,
   {ms:15000,what:'稼働状況が描かれる'});
 await idle();
 const statusText=()=>page.$eval('#dbStatusView',e=>e.innerText.replace(/\s+/g,' '));
 const hmText=await statusText();
 rec('稼働状況が時間と分で描かれている',/\d+時間/.test(hmText)&&!/\d{3,}分/.test(hmText),
   hmText.slice(0,90));
 /* 書き方を変えたら**いま出ている表も書き直る**。次の描画まで待たせると、
    選んだのに変わらない＝設定が壊れているのと見分けが付かない。 */
 await page.evaluate(()=>WL.duration.setStyle('min'));
 /* 「その場で書き直る」を見るので、待つのは描画1巡だけ（遅れて書き直るなら落ちるべき）。 */
 await paint();
 const minText=await statusText();
 rec('書き方を変えると、いま出ている稼働状況がその場で書き直る',
   minText!==hmText&&/\d{3,}分/.test(minText)&&!/\d+時間/.test(minText),
   minText.slice(0,90));

 /* 後片付け: 既定へ戻す（端末の覚えを次の実行へ持ち越さない・§9.121）。 */
 await page.evaluate(()=>localStorage.removeItem('WaveLogDurationStyleV1'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});

 /* ---------- 実績カレンダー（旧 test_calscale.js） ----------
    段は`data-ui-size`を直に書き換えて確かめる（上でメニューの経路は
    確かめ済みなので、ここは**測ること**に集中する）。 */
 await page.evaluate(()=>localStorage.setItem('MeasurementUiSizeV1','md'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openCalendar',{timeout:15000});
 await W.booted(page); await idle();
 await page.click('#openCalendar');
 await W.until(page,()=>document.querySelectorAll('.cal-day').length>0,null,{ms:15000,what:'カレンダーが描かれる'});
 await idle();
 const read=async()=>page.evaluate(()=>{
  const g=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):null};
  const h=s=>{const e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):null};
  return {month:g('.cal-month-label'),dayNum:g('.cal-day-num'),weekday:g('.cal-weekday-row span'),
   legend:g('.cal-legend'),cardLabel:g('.db-card-label'),cardValue:g('.db-card-value'),
   navBtn:h('.cal-nav .rp-btn-secondary'),cell:h('.cal-day'),swatch:h('.cal-legend-swatch'),
   detailW:Math.round((document.querySelector('.cal-detail')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)};
 });
 const set=async v=>{await page.evaluate(x=>document.documentElement.setAttribute('data-ui-size',x),v);await paint()};
 await set('md');const cmd=await read();
 await set('sm');const csm=await read();
 await set('lg');const clg=await read();
 const keys=['month','dayNum','weekday','legend','cardLabel','cardValue'];
 rec('カレンダーの全文字サイズが小<中<大で変わる',
  keys.every(k=>csm[k]<cmd[k]&&cmd[k]<clg[k]),keys.map(k=>`${k}:${csm[k]}/${cmd[k]}/${clg[k]}`).join(' '));
 // 比率がスケール(.92 / 1 / 1.1)どおりか
 const ratioOk=keys.every(k=>Math.abs(clg[k]/cmd[k]-1.1)<0.02&&Math.abs(csm[k]/cmd[k]-0.92)<0.02);
 rec('拡大率が--ui-scale(.92/1/1.1)と一致する',ratioOk,keys.map(k=>k+':'+(clg[k]/cmd[k]).toFixed(3)).join(' '));
 rec('日セル・ボタン・凡例の寸法も一緒に伸びる',
  clg.cell>cmd.cell&&clg.navBtn>cmd.navBtn&&clg.swatch>cmd.swatch&&csm.cell<cmd.cell,
  `cell ${csm.cell}/${cmd.cell}/${clg.cell} btn ${csm.navBtn}/${cmd.navBtn}/${clg.navBtn} swatch ${csm.swatch}/${cmd.swatch}/${clg.swatch}`);
 rec('右の明細ペイン幅も追随する',clg.detailW>cmd.detailW&&csm.detailW<cmd.detailW,
  `${csm.detailW}/${cmd.detailW}/${clg.detailW}`);
 rec('横スクロールバーが出ない(大)',await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
 await set('md');

 /* ---------- デスクトップの起動アイコンは「表示」から（§9.445、利用者の指示
    「どのモードからも使えるショートカット作成」）----------
    元の困りごと: 盤は**共通設定＞この端末**にしか無く、共通設定は
    スケジュールモードのマスタ管理には出ない（`/api/schedule/`のマスタだけが
    残る）ので、**現場の端末からは作れなかった**——サーバーは3モードとも
    通していたのに、画面の入口だけが無い状態。
    入口は増やさず（§9.421）、**どの画面からも開ける「表示」へ節を1つ**。

    この端末はWindowsではないので、**盤そのもの**はサーバーの答え
    （`GET /api/app/shortcut`）を差し替えて見る。差し替えるのは
    **状態の読み取りだけ**で、作成（POST）は投げない。 */
 const setMode=async m=>{await fetch('http://127.0.0.1:5029/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
 const openLook=async()=>{
  await page.evaluate(()=>{
   const m=document.getElementById('uiSizeMenu');if(m)m.remove();
   document.getElementById('uiSizeBadge').click();
  });
  await page.waitForSelector('#lnkPanel',{timeout:8000});
  /* 「確認しています…」が答えに変わるまで待つ（時間ではなく条件で・§9.102）。 */
  await page.waitForFunction(()=>{
   const s=document.querySelector('#lnkPanel [data-sc-state]');
   return !!(s&&s.textContent&&s.textContent.indexOf('確認しています')<0);
  },{timeout:10000});
 };
 const lookRead=async()=>page.evaluate(()=>{
  const menu=document.getElementById('uiSizeMenu'),panel=document.getElementById('lnkPanel');
  const body=document.getElementById('lnkBody'),more=document.getElementById('lnkMore');
  const vis=el=>!!(el&&el.offsetParent);
  return {
   heads:[...menu.querySelectorAll('.ui-size-menu-head')].map(h=>h.textContent.trim()),
   state:(panel.querySelector('[data-sc-state]')||{}).textContent||'',
   bodyShown:vis(body),
   makes:[...document.querySelectorAll('button')].filter(b=>vis(b)&&/作る|作り直す/.test(b.textContent)).length,
   where:(document.getElementById('lnkWhere')||{}).textContent||'',
   folded:!!(more&&!more.open),
   now:(document.getElementById('lnkNow')||{}).textContent||'',
   ldLink:document.getElementById('uiSizeLoaderLink').tagName,
   ldNote:(document.querySelector('#uiSizeLoaderLink small')||{}).textContent||'',
   minFs:Math.min(...[...menu.querySelectorAll('*')]
     .filter(e=>e.textContent.trim()&&!e.children.length)
     .map(e=>parseFloat(getComputedStyle(e).fontSize))),
   menuH:Math.round(menu.getBoundingClientRect().height),
   menuMax:parseFloat(getComputedStyle(menu).maxHeight),
  };
 });
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:15000});
 await openLook();
 const sc0=await lookRead();
 rec('「表示」に「デスクトップの起動アイコン」の節が在る（§9.445）',
   sc0.heads.indexOf('デスクトップの起動アイコン')===sc0.heads.length-1,sc0.heads.join('／'));
 /* **作れない端末では、できないと書く**（§CLAUDE 4）——理由を出し、
    押しても何も起きないボタンは1つも見せない。 */
 rec('作れない端末では理由を字で出し、作るボタンを見せない',
   /Windows/.test(sc0.state)&&!sc0.bodyShown&&sc0.makes===0,
   `${sc0.state} / ボタン${sc0.makes}個`);

 await page.route('**/api/app/shortcut*',r=>r.request().method()==='GET'
  ? r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
      ok:true,supported:true,why:'',name:'測定伝送システム',defaultName:'測定伝送システム',
      savedName:'',icon:'',desktop:'C:\\Users\\x\\Desktop',
      link:'C:\\Users\\x\\Desktop\\測定伝送システム.lnk',
      target:'D:\\WaveLog\\Start.vbs',exists:false,updatedAt:'',
      iconSuffixes:['.ico','.exe','.dll']})})
  : r.continue());
 for(const mode of ['edit','view','schedule']){
  await setMode(mode);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#uiSizeBadge',{timeout:15000});
  await openLook();
  const sc=await lookRead();
  rec(`${mode}モードでも「表示」から作れる（入口は1つのまま）`,
    sc.heads.includes('デスクトップの起動アイコン')&&sc.bodyShown&&sc.makes===1,
    `${sc.state} / ボタン${sc.makes}個`);
  rec(`${mode}: 作成先と起動するものを押す前に読める（出どころ・§CLAUDE 6）`,
    /作成先/.test(sc.where)&&/Start\.vbs/.test(sc.where),sc.where.slice(0,80));
  if(mode==='edit'){
   /* 名前と絵は**畳む**（§CLAUDE 1 面積は頻度×重要度）。畳んだ札には
      いまの値を書く（§9.433）——開かずに何が効いているか読める。 */
   rec('名前と絵は畳んであり、畳んだ札にいまの値が出る',
     sc.folded&&/いま:/.test(sc.now)&&/測定伝送システム/.test(sc.now),`${sc.folded} ${sc.now}`);
   rec('節が増えても字を11px未満にしない・窓は縦に溢れない（§9.444）',
     sc.minFs>=11&&sc.menuH<=sc.menuMax+1,`最小${sc.minFs}px / ${sc.menuH}px≦${sc.menuMax}px`);
  }
  /* **開けない行き先は押す形にしない**（§9.445・§CLAUDE 4）。共通設定は
     スケジュールモードでは開けないので、以前は押すと換算係数マスタが開いた。 */
  rec(`${mode}: 読み込みの見せ方の行き先は、開けるときだけボタン`,
    mode==='schedule'?(sc.ldLink!=='BUTTON'&&/開けません/.test(sc.ldNote))
                     :(sc.ldLink==='BUTTON'&&!/開けません/.test(sc.ldNote)),
    `${sc.ldLink} / ${sc.ldNote}`);
 }
 /* ---------- 開き直しても答えが出る・重ねた窓でメニューを閉じない（§9.486、
    利用者の報告「確認していますと出て使えません」）----------
    土台が**器を文書に付ける前に**節を描いていたので、状態を覚えている2回目
    以降は塗り損ね、「確認しています…」のまま作るボタンも出なかった（実測4/5回）。
    上の網は毎回**再読込してから**開いていたので、この道を1度も通っていなかった。 */
 let stuck=0;
 for(let i=0;i<3;i++){
  await page.evaluate(()=>{
   const m=document.getElementById('uiSizeMenu');if(m)m.remove();
   document.getElementById('uiSizeBadge').click();
  });
  await page.waitForSelector('#lnkPanel',{timeout:8000});
  const ok=await page.waitForFunction(()=>{
   const s=document.querySelector('#lnkPanel [data-sc-state]'),b=document.getElementById('lnkBody');
   return !!(s&&s.textContent.indexOf('確認しています')<0&&b&&!b.hidden);
  },{timeout:5000}).then(()=>true,()=>false);
  if(!ok)stuck++;
 }
 rec('再読込せずに「表示」を開き直しても、状態の答えと作るボタンが出る（§9.486）',stuck===0,`止まった回 ${stuck}/3`);
 /* 「参照…」の場所選びは**メニューの上に重ねて**開く。その窓を押しただけで
    下のメニューを閉じると、選んだファイルの行き先が消える。 */
 await page.evaluate(()=>{
  document.getElementById('lnkMore').open=true;
  const r=document.querySelector('[data-sc-icon][value="file"]');r.checked=true;r.dispatchEvent(new Event('change'));
  document.querySelector('#lnkIconPath [data-path-browse]').click();
 });
 await page.waitForSelector('#pathPickerModal:not([hidden])',{timeout:8000});
 await page.click('#pathPickerCancel');
 await page.waitForSelector('#pathPickerModal[hidden]',{state:'attached',timeout:8000});
 rec('重ねて開いた窓（場所選び）を押しても「表示」のメニューは閉じない（§9.486）',
   await page.evaluate(()=>!!document.getElementById('lnkPanel')));
 await page.evaluate(()=>{const m=document.getElementById('uiSizeMenu');if(m)m.remove()});
 await page.unroute('**/api/app/shortcut*');
 await setMode('edit');

 /* ---------- すでに在るときは上書き・名前を変えたら付け替え（§9.446、
    利用者の指示「すでにある場合は上書きして書き換える機能も」）----------
    **押す前に何が起きるかを言う**（作り直し／別の物への上書き／付け替え）。
    ここも Windows の状態をサーバーの答えとして差し替えて見る——作成（POST）も
    差し替え、**何を送ったか**（`overwrite`）と**確認を挟んだか**まで見る。 */
 const SC={ok:true,supported:true,why:'',defaultName:'測定伝送システム',icon:'',
   desktop:'C:\\Users\\x\\Desktop',target:'D:\\WaveLog\\Start.vbs',
   iconSuffixes:['.ico','.exe','.dll'],updatedAt:''};
 const posts=[];
 const stubShortcut=async st=>{
  await page.unroute('**/api/app/shortcut*').catch(()=>{});
  await page.route('**/api/app/shortcut*',r=>{
   const req=r.request();
   if(req.method()==='GET')return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(st)});
   const body=JSON.parse(req.postData()||'{}');posts.push(body);
   /* 別の物の上は、**確認してから**でないと断る（サーバーと同じ約束）。 */
   if(st.exists&&!st.mine&&!body.overwrite)
    return r.fulfill({status:400,contentType:'application/json',
      body:JSON.stringify({error:'同じ名前の別のショートカットがあります: '+st.link,
        needConfirm:true,linkTarget:st.linkTarget,link:st.link})});
   return r.fulfill({status:200,contentType:'application/json',
     body:JSON.stringify({...st,exists:true,mine:true,linkTarget:st.target,created:true,
       updatedAt:'2026-09-22 13:00',renamedFrom:st.savedName&&st.savedName!==st.name?st.savedName:''})});
  });
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#uiSizeBadge',{timeout:15000});
  await openLook();
 };
 const planRead=async()=>page.evaluate(()=>({
   btn:(document.getElementById('lnkMake')||{}).textContent||'',
   plan:(document.getElementById('lnkPlan')||{}).textContent||'',
   warn:/is-warn/.test((document.getElementById('lnkPlan')||{className:''}).className)}));

 // ① 自分が作ったものが在る → 「作り直す」（＝上書き）と字で言う
 await stubShortcut({...SC,name:'測定伝送システム',savedName:'測定伝送システム',exists:true,mine:true,
   link:'C:\\Users\\x\\Desktop\\測定伝送システム.lnk',linkTarget:'D:\\WaveLog\\Start.vbs',
   updatedAt:'2026-09-20 09:10'});
 let pl=await planRead();
 rec('すでに在る（自分の）ときはボタンが「作り直す」になり、上書きすると字で言う',
   pl.btn==='作り直す'&&/上書き/.test(pl.plan)&&!pl.warn,`${pl.btn} / ${pl.plan}`);
 await page.evaluate(()=>document.getElementById('lnkMake').click());
 await page.waitForFunction(()=>/2026-09-22 13:00/.test(
   (document.querySelector('#lnkPanel [data-sc-state]')||{}).textContent||''),{timeout:8000});
 rec('自分のものの作り直しは確認を挟まず、そのまま上書きする',
   posts.length===1&&posts[0].overwrite===false,JSON.stringify(posts));

 // ② 同じ名前の**別の**ショートカットが在る → 確認してから上書き
 posts.length=0;
 await stubShortcut({...SC,name:'測定伝送システム',savedName:'',exists:true,mine:false,
   link:'C:\\Users\\x\\Desktop\\測定伝送システム.lnk',linkTarget:'D:\\old\\start_app.bat',
   updatedAt:'2025-04-01 08:00'});
 pl=await planRead();
 rec('別のショートカットが在るときは行き先を出し、上書きすると先に言う',
   pl.btn==='上書きして作る'&&/別のショートカット/.test(pl.plan)&&/start_app\.bat/.test(pl.plan)&&pl.warn,
   `${pl.btn} / ${pl.plan.slice(0,60)}`);
 await page.evaluate(()=>document.getElementById('lnkMake').click());
 await page.waitForFunction(()=>{
   const m=document.getElementById('appConfirmModal');return !!(m&&!m.hidden)},{timeout:8000});
 const ask=await page.evaluate(()=>({
   title:document.getElementById('appConfirmTitle').textContent,
   body:document.getElementById('appConfirmBody').textContent,
   ok:document.getElementById('appConfirmOk').textContent,
   cancel:!document.getElementById('appConfirmCancel').hidden}));
 rec('他人のものへ上書きする前に、行き先を見せて確認する（黙って消さない）',
   /start_app\.bat/.test(ask.body)&&ask.ok==='上書きする'&&ask.cancel,
   `${ask.title} / ${ask.ok}`);
 rec('確認する前は1度も作りに行かない（断られた1回だけ）',
   posts.length===1&&posts[0].overwrite===false,JSON.stringify(posts));
 await page.evaluate(()=>document.getElementById('appConfirmOk').click());
 /* 2本目が届くまでは**条件で待つ**（時間で待たない・§9.102）。 */
 await W.poll(()=>posts.length,n=>n>=2,8000,50);
 rec('「上書きする」を押すと、上書きしてよいと伝えて作り直す',
   posts.length===2&&posts[1].overwrite===true,JSON.stringify(posts));

 // ③ 名前を変えたら、前のものは付け替える（デスクトップに2つ残さない）
 posts.length=0;
 await stubShortcut({...SC,name:'現場PC-A',savedName:'測定伝送システム',exists:false,mine:false,
   link:'C:\\Users\\x\\Desktop\\現場PC-A.lnk',linkTarget:''});
 pl=await planRead();
 rec('名前を変えたときは、前の名前を付け替えると先に言う',
   /前の「測定伝送システム」/.test(pl.plan)&&/付け替え/.test(pl.plan)&&/2つ残しません/.test(pl.plan),
   pl.plan);
 await page.unroute('**/api/app/shortcut*');


}, {viewport:{width:1600,height:1000}});
