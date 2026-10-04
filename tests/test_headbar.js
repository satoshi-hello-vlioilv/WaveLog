/* test_headbar.js: ヘッダーの作り（§9.48 寸法／§9.60 画面名／§9.100 操作列）

   ============================================================
   3本を1本へまとめた（§9.249 ④、利用者の指示「重複しているテストは統合
   できるか確認し必要に応じて統合して最適化してください」）
   ------------------------------------------------------------
   `test_hdr.js`（3グループと寸法）・`test_hdctx.js`（画面名と名残）・
   `test_headbar.js`（操作列）は、**どれもヘッダーを見るために画面を
   開き直していた**——ブラウザを3回立ち上げ、同じ起動を3回待っていた。
   見ている対象が同じなので、直すときも3ファイルを開くことになる。

   まとめても**1件も落としていない**（下の3部が元の3本と同じ順で並ぶ）。

   ここで固定すること
   ------------------------------------------------------------
   ① 形（§9.48）  … 「状況/状態/操作」の3グループ・高さ/天端/角丸が揃う・
                     バッジは「項目名＋値」・表示サイズに追随・狭い幅でも1行
   ② 文脈（§9.60）… 画面名はデータソースマスタの表示名・前の画面の名残が
                     残らない・同期バナー・`hidden`が効いている
   ③ 操作（§9.100）… 画面ごとの操作列がヘッダーへ載り、パネルに二重に
                      残らず、出るときは元の親へ戻る

   **順番に意味がある。** ①は表示サイズと窓幅を触るので、必ず元へ戻してから
   ②③へ進む（戻し忘れると、後ろの2部が「大きい文字・狭い窓」で測られる）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};

/* 画面 → [ナビのid, ヘッダーへ載る操作列のid] */
const VIEWS=[
 ['作業スケジュール','openSchedule','scHead'],
 ['ダッシュボード','openDashboard','dbHeadActions'],
 ['測定実績カレンダー','openCalendar','calToolbar'],
 ['マスタ管理','openMasterMaint','mmHead'],
 ['ログ・診断','openLogView','lgHead'],
];

run('test_headbar: ヘッダーの作り（§9.48 寸法／§9.60 画面名／§9.100 操作列）', async ({page,rec,B,W,idle,paint})=>{
 await setMode('edit');

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openSchedule',{timeout:20000});
 /* 使用設備を入れてから読み直す。**先に済ませる**——後ろで読み直すと、
    そこまでに開いた画面の状態が全部消える。 */
 await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','LS4'));
 await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForSelector('#uiSizeBadge',{timeout:20000});
 await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
 await idle();

 /* =========================================================
    ① 形（§9.48 ヘッダー再設計）
    ========================================================= */
 const groups=await page.evaluate(()=>['.hd-context','.hd-status','.hd-actions']
   .map(s=>!!document.querySelector('header '+s)));
 rec('ヘッダーが「状況/状態/操作」の3グループに分かれている',groups.every(Boolean),JSON.stringify(groups));

 const metrics=async()=>page.evaluate(()=>{
  const sel='header .hd-chip,header .hd-btn,header .hd-search,header .hd-field,header #printCurrentView';
  return [...document.querySelectorAll(sel)].filter(e=>e.offsetParent).map(e=>{
   const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
   return {id:e.id||e.className.split(' ')[1]||e.className,
           h:Math.round(r.height),y:Math.round(r.top),
           radius:cs.borderTopLeftRadius};
  });
 });
 const m=await metrics();
 const hs=[...new Set(m.map(x=>x.h))],ys=[...new Set(m.map(x=>x.y))],rs=[...new Set(m.map(x=>x.radius))];
 rec('ヘッダーの全コントロールが同じ高さ',hs.length===1,'高さ='+hs.join('/')+' 対象'+m.length+'件');
 rec('ヘッダーの全コントロールが同じ天端(縦位置が揃う)',ys.length===1,'top='+ys.join('/'));
 rec('ヘッダーの全コントロールが同じ角丸',rs.length===1,'radius='+rs.join('/'));

 const chips=await page.evaluate(()=>[...document.querySelectorAll('header .hd-chip')]
   .filter(e=>e.offsetParent)
   .map(e=>({k:e.querySelector('.hd-chip-key')?.textContent,v:e.querySelector('.hd-chip-val')?.textContent})));
 rec('バッジが「項目名＋値」の形で内容を明示している',
   chips.length>0&&chips.every(c=>c.k&&c.v),JSON.stringify(chips));
 /* 右側（状態の札＋操作）の字は1種・札の名前は読める濃さ（§9.508）。前は名前9.5・値13・ボタン14pxの3種で、
    名前は白地に2.6:1だった。濃さは**描かれた色**を札の地と重ねて測る。 */
 const right=await page.evaluate(()=>{
  const lum=c=>{const m=c.match(/[\d.]+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};
   return .2126*f(m[0])+.7152*f(m[1])+.0722*f(m[2])};
  const vis=e=>e.getClientRects().length>0;
  const texts=[...document.querySelectorAll('header .hd-status .hd-chip-key,header .hd-status .hd-chip-val,header .hd-actions .hd-btn,header .hd-actions #printCurrentView')].filter(vis);
  const cr=[...document.querySelectorAll('header .hd-chip-key')].filter(vis).map(e=>{
   const a=lum(getComputedStyle(e).color),b=lum(getComputedStyle(e.closest('.hd-chip')).backgroundColor);
   return +((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)});
  return {fs:[...new Set(texts.map(e=>getComputedStyle(e).fontSize))],n:texts.length,cr};
 });
 rec('ヘッダー右側（状態の札・操作）の字は1種（§9.508）',right.n>0&&right.fs.length===1,JSON.stringify(right));
 rec('札の名前は地に対して4.5:1以上で読める（§9.508）',right.cr.length>0&&right.cr.every(v=>v>=4.5),JSON.stringify(right.cr));

 /* 状態チップの色が語っていること（§9.338）。**宣言ではなく描かれた色で見る**
    ——クラスが付くだけでは絵は変わらない（§9.229 ⑥）。見るのは3つ:
      ・正常（並べ替え可）は**中立**＝地に色を足さない
      ・「設定要」は**橙**で、すぐ隣の「使用設備 未設定」と**同じ色**
      ・「設定要」に**赤（危険）を使わない**——赤は取り消せない操作の色
    以前は逆に付いていた（正常＝橙／設定要＝赤）ので、**両方向**を見る。

    **クラスを足した直後に読まないこと**（§9.229 ⑥）——`button.hd-chip`は
    `transition:border-color .12s,background .12s` を持つので、直後の
    `getComputedStyle`は**遷移の途中（＝前の色）**を返す。実際に
    「使用設備 未設定」が白のまま読めて、直したはずのCSSを疑うことになった。
    `<span>`の現場段取りチップには遷移が無いので**片方だけ正しく読める**——
    この食い違いが手掛かりだった。 */
 const setChips=on=>page.evaluate(v=>{
  const badge=document.querySelector('#fieldReorderBadge');
  const equip=document.querySelector('.hd-chip-equip');
  if(!badge||!equip)return false;
  badge.hidden=false;
  badge.classList.toggle('is-warn',v);
  equip.classList.toggle('is-unset',v);
  return true;
 },on);
 const readChips=()=>page.evaluate(()=>{
  const read=e=>{const s=getComputedStyle(e);
    return {bg:s.backgroundColor,bd:s.borderTopColor,
            fg:getComputedStyle(e.querySelector('.hd-chip-val')).color}};
  // 危険の色は**トークンを器に載せてブラウザに解かせる**（`#rrggbb`と
  // `rgb(...)`はそのままでは比べられない）。
  const probe=document.createElement('span');
  probe.style.cssText='background:var(--danger-bg);border-color:var(--danger-border);color:var(--danger)';
  document.body.appendChild(probe);
  const ps=getComputedStyle(probe);
  const danger={bg:ps.backgroundColor,bd:ps.borderTopColor,fg:ps.color};
  probe.remove();
  return {badge:read(document.querySelector('#fieldReorderBadge')),
          equip:read(document.querySelector('.hd-chip-equip')),danger};
 });
 const okSet=await setChips(false);
 await W.until(page,()=>['#fieldReorderBadge','.hd-chip-equip'].every(s=>{const e=document.querySelector(s);return !e||e.getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).length===0}),null,{ms:3000,what:'状態チップの色の遷移が終わる'});
 const normal=okSet?await readChips():null;
 await setChips(true);
 await W.until(page,()=>['#fieldReorderBadge','.hd-chip-equip'].every(s=>{const e=document.querySelector(s);return !e||e.getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).length===0}),null,{ms:3000,what:'状態チップの色の遷移が終わる'});
 const warned=okSet?await readChips():null;
 rec('状態チップの色を読めている',!!normal&&!!warned,
     JSON.stringify({正常:normal&&normal.badge,設定要:warned&&warned.badge}));
 if(normal&&warned){
  const ok=normal.badge,warn=warned.badge,unset=warned.equip,d=warned.danger;
  rec('正常の「並べ替え可」は中立（地に色を足さない）',
      ok.bg==='rgb(255, 255, 255)'||ok.bg==='rgba(0, 0, 0, 0)',JSON.stringify(ok));
  rec('「設定要」は正常と違う色で言う',
      warn.bg!==ok.bg&&warn.bd!==ok.bd,JSON.stringify({ok,warn}));
  rec('「設定要」は「使用設備 未設定」と同じ橙',
      warn.bg===unset.bg&&warn.bd===unset.bd&&warn.fg===unset.fg,
      JSON.stringify({warn,unset}));
  rec('「設定要」に危険の赤を使っていない（赤は取り消せない操作の色）',
      warn.bg!==d.bg&&warn.bd!==d.bd&&warn.fg!==d.fg,JSON.stringify({warn,danger:d}));
 }
 await setChips(false);
 await page.evaluate(()=>{const b=document.querySelector('#fieldReorderBadge');if(b)b.hidden=true});

 /* 使用設備チップから設備設定が開ける(旧 .equipment-header-button の役割を継承) */
 await page.click('.hd-chip-equip');
 await W.until(page,()=>{const m=document.querySelector('#appSettingsModal');return !!m&&!m.hidden},null,{ms:5000,what:'設備設定の窓が開く'});
 const opened=await page.evaluate(()=>!document.querySelector('#appSettingsModal').hidden);
 rec('使用設備チップから設備設定が開く',opened);
 if(opened){await page.click('#cancelAppSettings');await W.until(page,()=>{const m=document.querySelector('#appSettingsModal');return !m||m.hidden},null,{ms:5000,what:'設備設定の窓が閉じる'})}

 /* 表示サイズを変えるとヘッダーも一括で追随する(統一が崩れない) */
 const md=await metrics();
 await page.click('#uiSizeBadge');await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="lg"]');await W.until(page,s=>document.documentElement.dataset.uiSize===s&&document.querySelector('header').getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).length===0,'lg',{ms:4000,what:'表示サイズが大になる'});
 const lg=await metrics();
 const lgHs=[...new Set(lg.map(x=>x.h))];
 rec('大でもヘッダーの高さが揃ったまま拡大する',
   lgHs.length===1&&lgHs[0]>md[0].h,'md='+md[0].h+' lg='+lgHs.join('/'));
 await page.click('#uiSizeBadge');await page.waitForSelector('#uiSizeMenu',{timeout:4000});
 await page.click('#uiSizeMenu [data-ui-size-option="md"]');await W.until(page,s=>document.documentElement.dataset.uiSize===s&&document.querySelector('header').getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).length===0,'md',{ms:4000,what:'表示サイズが中になる'});

 /* 横幅が狭くても操作群が折り返して縦に伸びない
    (画面ごとの操作列#headerViewBarは「ヘッダーの2行目」として意図的に
     別の行に置く。ここで見るのは1行目の並び。) */
 await page.setViewportSize({width:1100,height:900});
 await paint();
 const narrow=await page.evaluate(()=>{
  const h=document.querySelector('header').getBoundingClientRect();
  const list=[...document.querySelectorAll('header .hd-chip,header .hd-btn,header .hd-search,header .hd-field')]
    .filter(e=>e.offsetParent&&!e.closest('#headerViewBar')).map(e=>Math.round(e.getBoundingClientRect().top));
  const bar=document.getElementById('headerViewBar');
  const barShown=!!(bar&&bar.offsetParent);
  return {height:Math.round(h.height),rows:[...new Set(list)].length,barShown};
 });
 rec('幅1100pxでもヘッダーの1行目が1行に収まる',
   narrow.rows===1&&narrow.height<(narrow.barShown?130:80),JSON.stringify(narrow));
 /* 狭い窓では札の名前を畳み、値だけにする。名前は説明（title）が持つ（§9.508）。 */
 const keys=await page.evaluate(()=>[...document.querySelectorAll('header .hd-status .hd-chip')].filter(e=>e.getClientRects().length)
   .map(e=>({key:getComputedStyle(e.querySelector('.hd-chip-key')).display,title:!!e.title})));
 rec('幅1100pxでは札の名前を畳み、名前は説明が持つ（§9.508）',keys.length>0&&keys.every(k=>k.key==='none'&&k.title),JSON.stringify(keys));
 /* 題の器に中身が**入りきらない**幅で見る——画面名は縮ませず、譲るのは出どころの1行だけ。題が札の下へ
    重なっていないこと（§9.508 で踏んだ・最大76px）。1100pxではこの網の状態だと余りが大きく（札2枚・設備名
    が短い）、欠陥を入れても通ったので、器を狭めて確かめる。字が大きいほど厳しいので「大」でも見る。 */
 const fitOf=()=>page.evaluate(()=>{
  const ctx=document.querySelector('header .hd-context'),st=document.querySelector('header .hd-status');
  const name=document.getElementById('fileName');
  const kids=[...ctx.children].filter(c=>c.getClientRects().length);
  const edge=Math.max(...kids.map(c=>c.getBoundingClientRect().right));
  const src=document.getElementById('headerContextSource');
  return {name:name.textContent,nameCut:name.scrollWidth>name.clientWidth+1,
   srcCut:!!src&&src.getClientRects().length>0&&src.scrollWidth>src.clientWidth+1,
   overlap:Math.round(edge-st.getBoundingClientRect().left),
   parts:kids.map(c=>(c.id||c.className)+':'+Math.round(c.getBoundingClientRect().width))};
 });
 const setSize=async sz=>{
  await page.click('#uiSizeBadge');await page.waitForSelector('#uiSizeMenu',{timeout:4000});
  await page.click(`#uiSizeMenu [data-ui-size-option="${sz}"]`);await W.until(page,s=>document.documentElement.dataset.uiSize===s&&document.querySelector('header').getAnimations({subtree:true}).filter(a=>a instanceof CSSTransition).length===0,sz,{ms:4000,what:'表示サイズが'+sz+'になる'});
 };
 await page.setViewportSize({width:880,height:900});
 await paint();
 const fitMd=await fitOf();
 await setSize('lg');const fitLg=await fitOf();await setSize('md');
 const fits={中:fitMd,大:fitLg};
 rec('前提: 880pxでは出どころの1行が譲っている（器に入りきらない状態で見ている）',fitMd.srcCut&&fitLg.srcCut,JSON.stringify(fits));
 rec('題が入りきらなくても画面名は切れない（中・大・§9.508）',!fitMd.nameCut&&!fitLg.nameCut,JSON.stringify(fits));
 rec('題が状態の札に重ならない（中・大・§9.508）',fitMd.overlap<=0&&fitLg.overlap<=0,JSON.stringify(fits));
 /* **必ず戻す。** ②③は元の広さで測る。 */
 await page.setViewportSize({width:1700,height:1000});
 await paint();

 /* =========================================================
    ② 文脈（§9.60 画面名／§9.59 hidden／同期バナー）
    ========================================================= */
 const ctx=()=>page.evaluate(()=>({
   title:document.querySelector('#fileName').textContent.trim(),
   src:document.querySelector('#headerContextSource')?.hidden?'':document.querySelector('#headerContextSource').textContent.trim()}));
 /* 画面を開いて、その画面の読み込みが済むまで（以前は画面ごとに1.8〜2.5秒の固定待ち）。 */
 const go=async sel=>{await page.click(sel);await idle(400,10000)};

 /* ヘッダーの画面名は**データソースマスタの表示名**を使う(§9.87)。
    以前は'SIKALOTNOW'なら'仕掛一覧'と固定で書いており、左メニュー
    (マスタの表示名＝「仕掛（現在）」)とヘッダーで別の名前が出ていた。
    表示名を変えても追随するよう、期待値もマスタから取る。 */
 const navLabel=k=>page.evaluate(key=>WL.dataSource.label(key),k);
 await go('[data-db-key="SIKALOTNOW"]');
 let c=await ctx();
 rec('仕掛(現在): 画面名が主・ファイル名が副',
   c.title===await navLabel('SIKALOTNOW')&&/sikalotnow/i.test(c.src),JSON.stringify(c));
 for(const [sel,want] of [['#homeDrafts','測定データ一覧'],['#openDashboard','ダッシュボード'],
                          ['#openCalendar','測定実績カレンダー'],['#openSchedule','作業スケジュール'],
                          ['#openMasterMaint','マスタ管理']]){
  await go(sel);c=await ctx();
  rec(`${want}: 見出しが画面名になる`,c.title===want,JSON.stringify(c));
  rec(`${want}: 前に見たDBファイル名が残らない`,!/sikalot/i.test(c.title+' '+c.src),JSON.stringify(c));
 }
 await go('[data-db-key="SIKALOTDEF"]');c=await ctx();
 rec('品質データ: 画面名が主',c.title===await navLabel('SIKALOTDEF'),JSON.stringify(c));
 await go('#homeDrafts');c=await ctx();
 rec('品質データ→測定データ一覧でも名残なし',c.title==='測定データ一覧'&&!/sikalot/i.test(c.src),JSON.stringify(c));

 const bar=await page.evaluate(()=>{
  const el=document.querySelector('#recordSyncBar');
  return {visible:!!el&&getComputedStyle(el).display!=='none',
          count:document.querySelector('#recordSyncCount')?.textContent,
          text:el?el.textContent.replace(/\s+/g,' ').trim():''};
 });
 rec('未送信0件なら同期バナーを出さない',!bar.visible,JSON.stringify(bar));
 const accessLeft=await page.evaluate(()=>{
  const walk=document.body.innerText;
  const titles=[...document.querySelectorAll('[title]')].map(e=>e.title).join(' ');
  return (walk+' '+titles).match(/Access[^\s]*/g)||[];
 });
 rec('画面文言に「Access」が残っていない',accessLeft.length===0,JSON.stringify(accessLeft));
 const badHidden=await page.evaluate(()=>[...document.querySelectorAll('[hidden]')]
   .filter(e=>getComputedStyle(e).display!=='none').length);
 rec('hidden属性が効いていない要素が無い',badHidden===0,badHidden+'件');

 /* =========================================================
    ③ 操作（§9.100 画面ごとの操作列）
    ---------------------------------------------------------
    この土台の約束は「**画面名はヘッダーが持ち、操作ボタンは
    `#headerViewBar` へ相乗りさせる**」(base.js の mountViewToolbar)。
    画面ごとに見出しの帯を持つと、画名がヘッダーと二重に出るうえ、
    バー1本ぶん(40〜50px)本文の高さを食う。守られているかは
    **画面を開くまで分からない**ので機械で見る。
    ========================================================= */
 await page.setViewportSize({width:1600,height:950});
 for(const [label,nav,barId] of VIEWS){
  await page.click('#'+nav);
  await W.until(page,id=>{const el=document.getElementById(id);return !!el&&el.parentElement===document.getElementById('headerViewBar')},barId,{ms:10000,what:label+'の操作列がヘッダーへ載る'});
  await idle();
  const s=await page.evaluate(id=>{
   const el=document.getElementById(id);
   if(!el)return {missing:true};
   const slot=document.getElementById('headerViewBar');
   const ctls=[...slot.querySelectorAll('input,select,button')].filter(e=>e.offsetParent!==null);
   return {
    inHeader:el.parentElement===slot,
    // 同じ操作がパネル側にも残っていないか(id は文書内で一意なので、
    // 「ヘッダーの外にも同じ操作がある」形＝別要素の重複を見る)
    strays:[...document.querySelectorAll('#headerViewBar input,#headerViewBar select')]
      .map(e=>e.id).filter(Boolean)
      .filter(x=>document.querySelectorAll('#'+CSS.escape(x)).length>1),
    heights:[...new Set(ctls.map(e=>Math.round(e.getBoundingClientRect().height)))].sort((a,b)=>a-b),
    // アイコンだけのボタン(‹ ›)は記号なので文字サイズの対象外。
    // tests/test_theme.js が既に置いている例外と同じ扱いにする。
    fonts:[...new Set(ctls.filter(e=>!e.classList.contains('rp-btn-icon'))
                          .map(e=>getComputedStyle(e).fontSize))],
    clipped:ctls.filter(e=>e.scrollWidth-e.clientWidth>2).map(e=>e.id||e.className),
   };
  },barId);
  rec(`${label}: 操作列がヘッダーへ載る`,!s.missing&&s.inHeader===true,JSON.stringify(s.missing?'#'+barId+'が無い':s.inHeader));
  rec(`${label}: 同じ操作がパネル側に二重に残らない`,!s.missing&&s.strays.length===0,JSON.stringify(s.strays||[]));
  rec(`${label}: 操作の高さがトークンに収まる(30/26px)`,
      !s.missing&&s.heights.length>0&&s.heights.every(h=>h===30||h===26),JSON.stringify(s.heights));
  rec(`${label}: 操作の文字サイズが1種類(アイコンのみのボタンを除く)`,
      !s.missing&&s.fonts.length===1,JSON.stringify(s.fonts));
  rec(`${label}: 操作の中身が見切れていない`,!s.missing&&s.clipped.length===0,JSON.stringify(s.clipped||[]));
 }

 /* マスタ管理は移設(§9.100)の当事者なので、個別に確かめる。
    再読込がヘッダーにあり、パネルには見出しだけが残ること。絞り込みは§9.556で外した
    （利用者の指示「最上部の絞り込みの検索バーもあまり意味がないので基本的に削除」）。 */
 await page.click('#openMasterMaint');
 await W.until(page,id=>{const el=document.getElementById(id);return !!el&&el.parentElement===document.getElementById('headerViewBar')},'mmHead',{ms:10000,what:'マスタ管理の操作列がヘッダーへ載る'});
 await idle();
 const mm=await page.evaluate(()=>{
  const inBar=id=>!!document.querySelector('#headerViewBar #'+id);
  return {
   search:!!document.getElementById('masterMaintSearch'),reload:inBar('reloadMasterMaint'),user:inBar('masterUserId'),
   toolbarCtls:document.querySelectorAll('.mm-toolbar input,.mm-toolbar button,.mm-toolbar select').length,
   title:!!document.querySelector('.mm-toolbar #masterMaintTitle'),
  };
 });
 rec('マスタ管理: 絞り込みの欄は無い（§9.556）',!mm.search);
 rec('マスタ管理: 再読込がヘッダーにある',mm.reload);
 rec('マスタ管理: 更新者IDもヘッダーのまま',mm.user);
 rec('マスタ管理: パネルに残るのは見出しだけ(操作は0件)',mm.toolbarCtls===0&&mm.title,
     '操作 '+mm.toolbarCtls+'件 / 見出し '+mm.title);

 /* 相乗りは**入るときだけ**（§9.509）。窓を狭めたら2行目へ移り、戻したら1行目へ戻る——載せたまま
    画面名を札の下へ潰さない（§9.508 のあと1366pxで「マス」しか見えなかった）。 */
 const mmFit=()=>page.evaluate(()=>{
  const vb=document.getElementById('headerViewBar'),ctx=document.querySelector('main>header>.hd-context');
  return {w:innerWidth,inline:vb.classList.contains('is-inline'),ctxOver:ctx.scrollWidth>ctx.clientWidth+1};
 });
 const wide=await mmFit();
 /* 700px＝どの状態でも1行目に入りきらない幅（この網の状態では1280pxでも入る——札2枚・使用設備「LS4」）。
    §9.556で絞り込みの欄（約300px）を外したので、以前の900pxでは入るようになった。 */
 await page.setViewportSize({width:700,height:1000});await paint();
 const narrowMm=await mmFit();
 await page.setViewportSize({width:wide.w,height:1000});await paint();
 const wideAgain=await mmFit();
 rec('マスタ管理: 広い窓では操作列が1行目へ相乗りする（§9.266）',wide.inline&&!wide.ctxOver,JSON.stringify(wide));
 rec('マスタ管理: 入らない窓では2行目へ移り、画面名を潰さない（§9.509）',!narrowMm.inline&&!narrowMm.ctxOver,JSON.stringify(narrowMm));
 rec('マスタ管理: 窓を戻すと1行目へ戻る（§9.509）',wideAgain.inline&&!wideAgain.ctxOver,JSON.stringify(wideAgain));

 // 画面を出たら元の場所へ戻る(次の画面のものと混ざらない)
 await page.click('#openSchedule');
 await W.until(page,id=>{const el=document.getElementById(id);return !!el&&el.parentElement===document.getElementById('headerViewBar')},'scHead',{ms:10000,what:'作業スケジュールの操作列がヘッダーへ載る'});
 await idle();
 const back=await page.evaluate(()=>({
  inHeader:[...document.getElementById('headerViewBar').children].map(e=>e.id),
  mmHome:document.getElementById('mmHead')?.parentElement?.className||'(無し)',
 }));
 rec('別の画面へ移ると前の操作列はヘッダーから外れる',
     !back.inHeader.includes('mmHead')&&back.inHeader.includes('scHead'),JSON.stringify(back.inHeader));
 rec('外した操作列は元の親へ戻る(捨てない)',/mm-dialog/.test(back.mmHome),back.mmHome);

}, {viewport:{width:1600,height:1000}});
