/* test_scbar.js: 操作列を1行に・親/子バッジ・差し込みの当たり判定（§9.199）
   ------------------------------------------------------------
   利用者の指示は3つ。
    1) 「親ロットにつけるバッジは『親』か『子*』として、親の場合には数字なし、
       子の場合は数字を表示するようにして切り替えられるように」
       ——§9.198の「親2」は**数字の意味と名前が食い違っていた**（2件の親、
       と読める）。
    2) 「メニューが伸びてきれいに収まっていません。（略）タイトルを除く、
       上部メニューバーは1行で収まるように」
       ——役割で束ねても総量は減らないので3行に折り返していた（実測114px）。
    3) 「マウスオーバーで挿入箇所が出るのですが、判定が範囲が広く、通常の
       スケジュール移動したい場合のロットの選択などにやや支障が出ます」
       ——行のどこにいても帯と吹き出しが出て、吹き出し（押せる）が下の行の
       ドラッグを食っていた。

   ここで固定すること:
    1. 操作列は**1行**（塊の上端が全部同じ・器からはみ出さない）
    2. 「表示」の入口に**いまの設定が文字で出る**（開かずに読める）
    3. 見え方の設定は**1枚のパネル**に集まり、**開く段は常に1つ**
    4. 中身が無い場面（全体俯瞰）では**入口ごと消える**
    5. 親ロットの印は「子N」（既定）と「親」から選べ、端末に残る
    6. 差し込みの帯は**境目のそばだけ**で出る（行の中央では出ない）
    7. 吹き出しは**取っ手の列を覆わない**／行は掴める（draggable）
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A',PARENT='L9000';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const W=require('./lib/wait.js');const {idle}=W.track(page);const paint=()=>W.paint(page);
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 page.on('dialog',d=>d.accept());
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const openView=()=>page.evaluate(()=>WL.scheduleView.openViewPop());
 const closeView=()=>page.evaluate(()=>WL.scheduleView.closeViewPop());
 const made=[];

 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    localStorage.setItem('AccessMeasurementUserId','tester');
    localStorage.removeItem('scChildOpenV1');
    localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await idle(400,15000);

  /* ---- 1) 操作列は1行 ----------------------------------------
     **「折り返していないこと」を高さではなく上端で見る**——高さは中身の
     大きさでも変わるので、1行かどうかの証拠にならない。 */
  const bar=await page.evaluate(()=>{
   const host=document.getElementById('headerViewBar');
   const items=[...host.querySelectorAll('.sc-head-left>*,.sc-head-right>*')]
     .filter(el=>!el.hidden&&el.getBoundingClientRect().width>0)
     .map(el=>({id:el.id||el.className,top:Math.round(el.getBoundingClientRect().top),
                w:Math.round(el.getBoundingClientRect().width)}));
   const head=document.getElementById('scHead').getBoundingClientRect();
   const right=document.querySelector('#scHead .sc-head-right').getBoundingClientRect();
   return {tops:[...new Set(items.map(i=>i.top))],items,
           headW:Math.round(head.width),headRight:Math.round(head.right),
           overflow:Math.round(right.right-head.right)};
  });
  /* 上端のばらつきは、縦位置の揃え(baseline/center)で1〜2px出ることがある。 */
  const spread=Math.max(...bar.tops)-Math.min(...bar.tops);
  rec('操作列は1行に収まる（折り返していない）',spread<=4,
      `上端=${bar.tops.join('/')} 幅=${bar.items.map(i=>i.id+':'+i.w).join(' ')}`);
  rec('操作列が器からはみ出していない',bar.overflow<=1,`はみ出し=${bar.overflow}px 器=${bar.headW}px`);

  /* ---- 1b) アイコンは同梱のFont Awesome（§9.298、利用者の指示
       「絵文字は控えて、認知心理学に基づき、FONTAWESOMEのアイコンを
        ボタン化するなど、コンパクトに」） ----------------------------
     **宣言（クラスが付いていること）だけを見ないこと**——フォントを
     取りに行けなければ字形は出ず、豆腐か空白になる（それが同梱した理由）。
     `document.fonts.check()`で**字形が使えること**と、`::before`の中身が
     **1文字**（プライベート領域の合字）であること、そして絵が実際に
     場所を取っていることまで見る。 */
  const fa=await page.evaluate(async()=>{
   try{await document.fonts.ready}catch(e){}
   const host=document.getElementById('scHead');
   const icons=[...host.querySelectorAll('i.fa-solid')]
     .filter(el=>el.offsetParent!==null);
   const bad=[];
   icons.forEach(el=>{
    const cs=getComputedStyle(el,'::before');
    const ch=(cs.content||'').replace(/^["']|["']$/g,'');
    const r=el.getBoundingClientRect();
    if(!/Font Awesome/.test(getComputedStyle(el).fontFamily))bad.push(el.className+':font');
    else if(ch.length!==1)bad.push(el.className+':content='+JSON.stringify(ch));
    else if(r.width<6||r.height<6)bad.push(el.className+':size='+Math.round(r.width));
   });
   return {n:icons.length,bad,
     loaded:document.fonts.check('900 1em "Font Awesome 6 Free"'),
     絵文字:[...host.querySelectorAll('i:not([class])')].map(e=>e.textContent.trim()).filter(Boolean)};
  });
  rec('操作列のアイコンは同梱のFont Awesome（字形まで出ている）',
      fa.loaded===true&&fa.n>=6&&fa.bad.length===0,JSON.stringify(fa));
  rec('操作列に生の絵文字を残していない',fa.絵文字.length===0,JSON.stringify(fa.絵文字));

  /* ---- 1c) 「いつのデータか」に答えるチップは1つ（§9.300 ①、利用者の指示
       「一番上の表示も含めて冗長な重複した表示内容ややたら長い説明の
        コメントがそのままボタンになっているものなど見直し、主要機能を
        1行にまとめてください」） -----------------------------------
     以前は`#scFreshness`「21:36 時点(たった今)」と`#scSyncChip`
     「共有: 1秒前に取込 ・ 書込役: このPC」が**同じ問いに並んで答えて**
     おり、実測で操作列1424pxのうち353px＝25%を占めていた。
     **「チップが在ること」だけを見ないこと**——2つ並んでいても通る。
     操作列の中で「時点／取込」を名乗る**見えている要素の数**を数える。 */
  const when=await page.evaluate(()=>{
   const box=document.getElementById('scToolsState');
   const vis=el=>el&&!el.hidden&&el.getBoundingClientRect().width>0;
   const says=[...box.querySelectorAll('*')].filter(el=>vis(el)
     &&!el.querySelector('*')&&/時点|取込/.test(el.textContent||''));
   return {n:says.length,txt:says.map(e=>e.textContent.trim()),
           freshness:!!document.getElementById('scFreshness'),
           chip:(document.getElementById('scSyncChip')||{}).hidden===false};
  });
  rec('「いつのデータか」に答えるチップは操作列に1つだけ',
      when.n===1&&when.chip&&!when.freshness,JSON.stringify(when));

  /* 畳んだ先が読めること。**打つ手を読む場所と同じところに置く**（§4）ので、
     メニューには「読み直す」（この画面）と「いま取り込む」（共有）の
     2つが並ぶ。 */
  await page.click('#scSyncChip');
  await page.waitForSelector('#scSyncMenu',{timeout:8000});
  const menu=await page.evaluate(()=>{
   const m=document.getElementById('scSyncMenu');
   return {keys:[...m.querySelectorAll('.sc-sync-k')].map(e=>e.textContent.trim()),
           acts:[...m.querySelectorAll('button')].map(e=>e.querySelector('span')?.textContent.trim())};
  });
  rec('畳んだ先に「この画面の読込」がある',menu.keys.includes('この画面の読込'),
      JSON.stringify(menu.keys));
  rec('打つ手は「読み直す」と「いま取り込む」の2つ',
      menu.acts.includes('読み直す')&&menu.acts.includes('いま取り込む'),
      JSON.stringify(menu.acts));
  await page.evaluate(()=>document.body.click());
  await page.waitForFunction(()=>!document.getElementById('scSyncMenu'),null,{timeout:8000});

  /* ---- 1d) 画面名の説明は畳んで`title`へ落とす（§9.300 ①・§9.234 ①）
     「設備ごとの作業予定と実績」は1回読めば足りる文なのに、いちばん上の
     行に常時居座っていた。**消さずに畳む**ので、読む手立ては残っている
     ことまで見る。 */
  const desc=await page.evaluate(()=>{
   const s=document.getElementById('headerContextSource');
   const t=document.getElementById('fileName');
   return {見えている:!!(s&&!s.hidden&&s.getBoundingClientRect().width>0),
           文:(s&&s.textContent||'').trim(),題:(t&&t.textContent||'').trim(),
           title:(t&&t.title)||''};
  });
  rec('画面名の説明は上の行に出していない',!desc.見えている,JSON.stringify(desc));
  rec('説明は消さずにtitleへ残す',/設備ごとの作業予定と実績/.test(desc.title),desc.title);

  /* ---- 1e) 「印刷」はこの画面に1つだけ（§9.300 ①） ------------------
     ヘッダーの「画面を印刷」（#printCurrentView。品質データ分析が作って
     `.global-actions`へ置いたまま残る汎用の操作）と、操作列の「印刷」
     （#scPrintBtn）が実機で並んでいた。**その端末で品質データ分析を
     開いていなければボタン自体が無い**ので、無ければテストが作ってから
     測る——「無いから通った」を作らない。 */
  const prints=await page.evaluate(()=>{
   if(!document.getElementById('printCurrentView')){
    const b=document.createElement('button');
    b.id='printCurrentView';b.type='button';b.className='print-button';
    b.textContent='画面を印刷';document.querySelector('.global-actions').append(b);
   }
   const vis=el=>!!el&&!el.hidden&&el.offsetParent!==null&&el.getBoundingClientRect().width>0;
   const generic=document.getElementById('printCurrentView');
   return {出ている:[...document.querySelectorAll('main>header button')]
             .filter(el=>vis(el)&&/印刷/.test(el.textContent||''))
             .map(el=>({id:el.id,txt:(el.textContent||'').replace(/\s+/g,' ').trim()})),
           汎用が在る:!!generic,汎用が見えている:vis(generic)};
  });
  rec('「印刷」はこの画面に1つだけ（汎用の「画面を印刷」は出さない）',
      prints.出ている.length===1&&prints.出ている[0].id==='scPrintBtn'
      &&prints.汎用が在る&&!prints.汎用が見えている,JSON.stringify(prints));

  /* ---- 2) 「表示」の入口にいまの設定が出る ---- */
  const vm=await page.evaluate(()=>{
   const btn=document.getElementById('scViewMenuBtn');
   const st=document.getElementById('scViewState');
   return {hidden:btn.hidden,txt:btn.textContent.replace(/\s+/g,''),
           state:st.textContent,title:btn.title};
  });
  rec('「表示」の入口が出ている',!vm.hidden,JSON.stringify(vm.txt));
  rec('畳んでいてもいまの設定が読める',/まとめ/.test(vm.state)&&/過去\d+時間/.test(vm.state),vm.state);
  rec('何の設定かを説明に書く',/予定そのものは変わりません/.test(vm.title||''),vm.title);

  /* ---- 3) 見え方の設定は1枚のパネルに集まる ---- */
  await openView();
  await page.waitForSelector('#scViewPop:not([hidden])',{timeout:8000});
  const pop=await page.evaluate(()=>({
   group:!!document.querySelector('#scViewPop #scGroupSelect'),
   hist:!!document.querySelector('#scViewPop #scHistorySelect'),
   /* **表示列だけはバーに出す**（§9.207、利用者の指示「よく使う表示列の
      カスタム機能だけはメニュー部分に出してほしい」）。畳んだ先ではなく
      1行のメニューに直接出ていること。 */
   cols:!!document.querySelector('#scToolsView #scContentModalBtn'),
   colsInPop:!!document.querySelector('#scViewPop #scContentModalBtn'),
   rowstyle:!!document.querySelector('#scViewPop #scRowStyleBtn'),
   layout:!!document.querySelector('#scViewPop #scLayoutBtn'),
   who:document.getElementById('scViewPop').textContent.replace(/\s+/g,' '),
  }));
  rec('まとめ・さかのぼり・行の色・配置が1枚のパネルに集まる',
      pop.group&&pop.hist&&pop.rowstyle&&pop.layout,JSON.stringify(pop));
  /* **よく使うものは畳まない**（§9.207）。同じ入口を2箇所に置かない
      （§8。どちらを押せばよいのか読む側が数え直すことになる）。 */
  rec('表示列はメニューに直接出す（パネルの中には置かない）',
      pop.cols&&!pop.colsInPop,JSON.stringify({bar:pop.cols,pop:pop.colsInPop}));
  rec('誰に効く設定かを段ごとに書く',
      /全員に効きます/.test(pop.who)&&/この端末だけ/.test(pop.who),
      pop.who.slice(0,140));
  /* **開くのは常に1つ**——2枚開くと、長い中身のどちらを見ているのか
     分からなくなる。逆順でも効くことを見る（片方だけが相手を畳む実装だと
     押す順で結果が変わる）。 */
  await page.click('#scLayoutBtn');await paint();
  await page.click('#scRowStyleBtn');await paint();
  const acc1=await page.evaluate(()=>({lay:document.getElementById('scLayoutPop').hidden,
                                       rs:document.getElementById('scRowStylePop').hidden}));
  await page.click('#scLayoutBtn');await paint();
  const acc2=await page.evaluate(()=>({lay:document.getElementById('scLayoutPop').hidden,
                                       rs:document.getElementById('scRowStylePop').hidden}));
  rec('開く段は常に1つ（どちらの順でも）',
      acc1.lay===true&&acc1.rs===false&&acc2.lay===false&&acc2.rs===true,
      JSON.stringify({acc1,acc2}));

  /* ---- 5) 親ロットの印を切り替えられる ---- */
  const badgeOpts=await page.evaluate(()=>[...document.querySelectorAll('#scLayoutPop input[name=scChildBadge]')]
    .map(r=>({v:r.value,on:r.checked})));
  rec('親ロットの印は2通りから選べる',
      badgeOpts.length===2&&badgeOpts.some(o=>o.v==='count')&&badgeOpts.some(o=>o.v==='parent'),
      JSON.stringify(badgeOpts));
  rec('既定は件数つき（子N）',(badgeOpts.find(o=>o.v==='count')||{}).on===true,JSON.stringify(badgeOpts));
  await closeView();

  // 分割ありの親を1件入れて、実際のバッジを見る
  // 追加はまとめ待ち→書込→応答。**押す前に**応答待ちを仕掛ける（§9.347 追補）
  const addDone=page.waitForResponse(r=>/\/plan\/(batch|add)/.test(r.url()),{timeout:20000}).catch(()=>null);
  const added=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return false;
   await window.scheduleAddFromRow(row);
   return true;
  },PARENT);
  await addDone;
  await page.waitForFunction(()=>!document.querySelector('.sc-flag-pending'),{timeout:20000}).catch(()=>{});
  await idle(400,8000);
  const pid=await page.evaluate(async e=>{
   const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e));
   const es=((await r.json()).entries||[]).filter(x=>x.lotNo==='L9000'&&x.parentId==null);
   return es.length?es[es.length-1].id:null;
  },EQ);
  if(pid)made.push(pid);
  const badge=()=>page.evaluate(()=>{const el=document.querySelector('.sc-child-toggle');
    if(!el)return null;const r=el.getBoundingClientRect();
    return {t:el.textContent,w:Math.round(r.width),vis:r.width>0&&r.height>0,title:el.title};});
  const bCount=await badge();
  rec('分割ありの親を入れられる',added&&!!pid&&!!bCount,JSON.stringify({added,pid,bCount}));
  rec('既定のバッジは「子」＋件数',
      !!bCount&&/子/.test(bCount.t)&&/2/.test(bCount.t)&&bCount.vis,JSON.stringify(bCount));
  await openView();
  await page.click('#scLayoutBtn');await paint();
  await page.click('#scLayoutPop input[name=scChildBadge][value=parent]');
  await idle(300,5000);  // 印の切り替えで行を描き直す
  await closeView();
  const bParent=await badge();
  rec('「親」を選ぶと数字が消える',
      !!bParent&&/親/.test(bParent.t)&&!/\d/.test(bParent.t)&&bParent.vis,JSON.stringify(bParent));
  rec('数字なしのほうが狭い',!!bParent&&!!bCount&&bParent.w<bCount.w,
      `親=${bParent&&bParent.w}px / 子N=${bCount&&bCount.w}px`);
  rec('件数を出していないことを説明に書く',/件数を出していません/.test((bParent||{}).title||''),
      (bParent||{}).title);
  rec('選んだ印は端末に残る',
      await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('scLayoutPrefsV1')||'{}').childBadge==='parent'}catch(e){return false}}));
  // 既定へ戻す
  await openView();
  await page.click('#scLayoutBtn');await paint();
  await page.click('#scLayoutPop input[name=scChildBadge][value=count]');
  await idle(300,5000);
  await closeView();
  rec('「子N」へ戻せる',/子/.test(((await badge())||{}).t||''),JSON.stringify(await badge()));

  /* ---- 5b) バッジを付ける列を選べる(§9.235 ②、利用者の指示「子ロットの
     バッジの位置は、一番左固定ではなく、バッジの位置はどの列にも付けられる
     ように位置を決められるようにしてください デフォルトはロット番号に
     つけてください」) ----
     以前は`.sc-row-title`（DOM順で最初の内容セル）へ固定で入っており、
     内容の項目を並べ替えてロット番号が先頭でなくなっても付く場所が
     変わらなかった（「一番左固定」）。 */
  const badgeColAt=()=>page.evaluate(()=>{
   const el=document.querySelector('.sc-child-toggle');
   const cell=el&&el.closest('[data-col]');
   return cell?cell.dataset.col:null;
  });
  rec('既定はロット番号の列に付く',await badgeColAt()==='lotNo',String(await badgeColAt()));
  const selInfo=await page.evaluate(()=>{
   const keys=WL.scheduleView.printColumnKeys();
   const sel=document.getElementById('scChildBadgeCol');
   const opts=sel?[...sel.options].map(o=>o.value):[];
   return {keys,hasAuto:opts.includes(''),
           matchesKeys:keys.every(k=>opts.includes(k))&&opts.filter(v=>v!=='').every(v=>keys.includes(v)),
           curValue:sel?sel.value:null};
  });
  rec('選択肢はいま画面に出ている列＋自動（今後も含めて全部並ぶ）',
      selInfo.matchesKeys&&selInfo.hasAuto,JSON.stringify(selInfo));
  rec('既定の選択は「自動（既定＝ロット番号）」',selInfo.curValue==='',String(selInfo.curValue));
  const altKey=selInfo.keys.find(k=>k!=='lotNo');
  if(altKey){
   await openView();
   await page.click('#scLayoutBtn');await paint();
   await page.selectOption('#scChildBadgeCol',altKey);
   await idle(300,5000);
   await closeView();
   rec('選んだ列へバッジが移る（一番左固定ではない）',
       await badgeColAt()===altKey,`${await badgeColAt()} / 選んだ:${altKey}`);
   rec('ロット番号の列からは無くなる（同じ行に2つ出さない）',
       await page.evaluate(()=>!document.querySelector('[data-col="lotNo"] .sc-child-toggle')));
   rec('選んだ列は端末に残る',
       (await page.evaluate(()=>{try{return JSON.parse(localStorage.getItem('scLayoutPrefsV1')||'{}').childBadgeCol}
         catch(e){return null}}))===altKey);
   // 自動へ戻す（デフォルトのロット番号を確かめてから、後始末を兼ねて戻す）
   await openView();
   await page.click('#scLayoutBtn');await paint();
   await page.selectOption('#scChildBadgeCol','');
   await idle(300,5000);
   await closeView();
   rec('「自動」に戻すとロット番号（既定）へ戻る',await badgeColAt()==='lotNo',String(await badgeColAt()));
  }else{
   rec('ロット番号以外の列がある(前提)',false,JSON.stringify(selInfo.keys));
  }

  /* ---- 6) 差し込みの当たり判定は境目のそばだけ ---------------
     **行の中央で出ないこと**を必ず見る——出るかどうかだけを見ると、
     全面が判定だった頃の実装でも通ってしまう。 */
  const geo=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#scTimeline .sc-row-line')].filter(r=>r.draggable);
   if(rows.length<2)return null;
   const t=rows[Math.min(2,rows.length-1)],b=t.getBoundingClientRect();
   return {top:Math.round(b.top),h:Math.round(b.height),mid:Math.round(b.top+b.height/2),
           x:Math.round(b.left+400),n:rows.length};
  });
  const ghostOn=()=>page.evaluate(()=>{const g=document.getElementById('scInsertGhost');
    return !!(g&&g.parentNode&&g.getBoundingClientRect().width>0)});
  await page.mouse.move(geo.x,geo.mid);await paint();
  const midGhost=await ghostOn();
  await page.mouse.move(geo.x,geo.top);await paint();
  const edgeGhost=await ghostOn();
  rec('行の中央では差し込みの帯が出ない（掴む場所として空ける）',midGhost===false,
      `中央y=${geo.mid} 行高=${geo.h}`);
  rec('境目では差し込みの帯が出る',edgeGhost===true,`境目y=${geo.top}`);

  /* ---- 7) 吹き出しは取っ手を覆わない／行は掴める ---- */
  const overlap=await page.evaluate(()=>{
   const t=document.querySelector('.sc-insert-tip');
   const line=document.querySelector('.sc-insert-line');
   /* **作業中の行は除く**——あちらはダブルクリックで再開できるので
      `pointer`のままが正しい（掴める合図とは別の話）。 */
   const row=[...document.querySelectorAll('#scTimeline .sc-row-line')]
     .filter(r=>r.draggable&&!r.classList.contains('sc-row-resumable'))[0];
   const h=row&&row.querySelector('.sc-row-handle');
   if(!t||!h||!line)return null;
   const a=h.getBoundingClientRect(),c=t.getBoundingClientRect(),l=line.getBoundingClientRect();
   return {handleRight:Math.round(a.right),tipLeft:Math.round(c.left),tipH:Math.round(c.height),
           lineH:Math.round(l.height),rowH:Math.round(row.getBoundingClientRect().height),
           cursor:getComputedStyle(row).cursor,draggable:row.draggable};
  });
  rec('吹き出しが取っ手の列を覆わない',!!overlap&&overlap.tipLeft>=overlap.handleRight,
      JSON.stringify(overlap));
  rec('吹き出しは1行の高さに収まる（行を丸ごと覆わない）',
      !!overlap&&overlap.tipH<overlap.rowH,`吹き出し=${overlap&&overlap.tipH}px 行=${overlap&&overlap.rowH}px`);
  rec('予定の行は掴めることが見た目で分かる',
      !!overlap&&overlap.draggable===true&&overlap.cursor==='grab',
      JSON.stringify({cursor:overlap&&overlap.cursor,draggable:overlap&&overlap.draggable}));

  /* ---- 3b) 一覧の下の余白（§9.292 ②、利用者の指示） ----
     「スケジュールの下側に余白を常に設けておき、スクロールで最後の
      スケジュールも上方向に押し上げられるように」。
     **確かめるのは「余白の箱がある」ことではなく、実際に最後の行が
     上まで上がること**——箱だけを見る網は高さ0の実装でも通る。 */
  const tail=await page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   const sp=document.getElementById('scTailSpace');
   if(!tl||!sp)return null;
   const rows=[...tl.querySelectorAll('.sc-row-line')];
   const last=rows[rows.length-1];
   const before=tl.scrollTop;
   tl.scrollTop=tl.scrollHeight;                 // いちばん下まで送る
   const top=last.getBoundingClientRect().top-tl.getBoundingClientRect().top;
   const rest={h:Math.round(sp.getBoundingClientRect().height),
               rowH:Math.round(last.getBoundingClientRect().height),
               clientH:tl.clientHeight,
               lastTopAtBottom:Math.round(top),
               text:(sp.textContent||'').trim()};
   tl.scrollTop=before;
   return rest;
  });
  rec('一覧の下に余白があり、最後の行が上まで押し上がる',
      !!tail&&tail.h>0&&tail.lastTopAtBottom<=tail.rowH+2,JSON.stringify(tail));
  rec('余白は「いちばん後ろへ入る」場所だと文字で書いてある',
      !!tail&&/いちばん後ろ/.test(tail.text),(tail&&tail.text||'').slice(0,60));
  /* **余白のどこでも「いちばん後ろ」の的**（行と行のあいだの±8pxは広げない）。 */
  const tailSlot=await page.evaluate(()=>{
   const tl=document.getElementById('scTimeline');
   const sp=document.getElementById('scTailSpace');
   const before=tl.scrollTop;tl.scrollTop=tl.scrollHeight;
   const r=sp.getBoundingClientRect();
   const y=Math.round(r.top+r.height/2);
   const x=Math.round(tl.getBoundingClientRect().left+40);
   const el=document.elementFromPoint(x,y);
   tl.scrollTop=before;
   return {inTail:!!(el&&el.closest&&el.closest('#scTailSpace')),y,h:Math.round(r.height)};
  });
  rec('余白のまん中は余白そのものが受ける（下の行に吸われない）',
      !!tailSlot&&tailSlot.inTail,JSON.stringify(tailSlot));

  /* ---- 3c) 同期のタイミングが読める（§9.292 ③、利用者の指示） ----
     「定期的にスケジュールの同期をしないといけないのでスケジュールデータの
      同期タイミングについてわかるようにしてください」。
     以前は「12秒前に取込」の1つだけで、**次はいつか・見張りは動いているか・
     間隔はいくつか**は`title`の中にしか無かった（触る画面では読めない・§4）。 */
  const chip=await page.evaluate(()=>{
   const el=document.getElementById('scSyncChip');
   return {exists:!!el,hidden:!!(el&&el.hidden),text:(el&&el.textContent||'').trim()};
  });
  if(chip.exists&&!chip.hidden){
   await page.click('#scSyncChip');
   await page.waitForSelector('#scSyncMenu',{timeout:5000});
   const menu=await page.evaluate(()=>{
    const m=document.getElementById('scSyncMenu');
    const keys=[...m.querySelectorAll('.sc-sync-k')].map(x=>x.textContent.trim());
    const vals=[...m.querySelectorAll('.sc-sync-v')].map(x=>x.textContent.trim());
    const r=m.getBoundingClientRect();
    return {keys,vals,now:!!m.querySelector('#scSyncNowBtn'),
            inView:r.left>=0&&r.right<=innerWidth+1&&r.top>=0,
            /* ラベル列がそろっているか（幅が1種類）。 */
            kw:[...new Set([...m.querySelectorAll('.sc-sync-k')]
                 .map(x=>Math.round(x.getBoundingClientRect().width)))],
            over:[...m.querySelectorAll('.sc-sync-v')]
                 .filter(x=>x.getBoundingClientRect().right>r.right-4).length};
   });
   rec('同期のチップを押すと「いつ・次はいつ・間隔」が開く',
       menu.keys.includes('見張り')&&menu.keys.includes('次の確認')
       &&menu.keys.includes('最後に取り込んだ'),JSON.stringify(menu.keys));
   rec('「次の確認」に値が入っている（—のままにしない）',
       (menu.vals[menu.keys.indexOf('次の確認')]||'').length>0
       &&menu.vals[menu.keys.indexOf('次の確認')]!=='—',
       JSON.stringify(menu.vals.slice(0,3)));
   rec('同じ場所に「いま取り込む」がある（読む場所と打つ手を分けない）',menu.now);
   rec('浮きメニューは画面の中に収まり、ラベル列がそろう',
       menu.inView&&menu.kw.length===1&&menu.over===0,JSON.stringify(menu));
   /* **外を押すと閉じる**（開いた器を控えていないと二度と閉じない・§9.222 ①）。 */
   await page.mouse.click(5,300);
   await paint();
   rec('外を押すと同期のメニューは閉じる',
       await page.evaluate(()=>!document.getElementById('scSyncMenu')));
  }else{
   rec('同期のチップを押すと「いつ・次はいつ・間隔」が開く',false,
       '同期チップが出ていない: '+JSON.stringify(chip));
  }

  /* ---- 3d) 一覧を広く使う（§9.292 ⑦、利用者の指示） ----
     「スケジュール作成時に、とにかく仕掛のデータを多く表示したいです。
      その時上部のメニューのほぼすべてを畳んで最大限広いスペースで仕掛の
      一覧表を表示できるような機能を実装してください」

     **確かめるのは「クラスが付く」ことではなく、一覧が実際に広くなること**
     ——印だけを見る網は、CSSが1行も効いていなくても通る。 */
  {
   const before=await page.evaluate(()=>({
    tl:Math.round(document.getElementById('scTimeline').clientHeight),
    head:Math.round((document.querySelector('main>header')||{getBoundingClientRect:()=>({height:0})})
      .getBoundingClientRect().height),
    btn:!!document.querySelector('#scWideBtn:not([hidden])'),
    pill:!!document.querySelector('#scWideExit:not([hidden])'),
   }));
   rec('「広く」の入口がある（畳む前は戻り道の札を出さない）',
       before.btn&&!before.pill&&before.head>0,JSON.stringify(before));
   await page.click('#scWideBtn');
   await paint();
   const after=await page.evaluate(()=>{
    const h=document.querySelector('main>header');
    const pill=document.getElementById('scWideExit');
    const r=pill?pill.getBoundingClientRect():null;
    return {tl:Math.round(document.getElementById('scTimeline').clientHeight),
            headShown:!!(h&&h.getBoundingClientRect().height>0),
            toolShown:!!(document.getElementById('scHead')||{}).getBoundingClientRect
              &&document.getElementById('scHead').getBoundingClientRect().height>0,
            pill:!!(pill&&!pill.hidden&&r.width>0&&r.top>=0&&r.bottom<=innerHeight+1),
            pillText:(pill&&pill.textContent||'').trim(),
            kept:(()=>{try{return !!JSON.parse(localStorage.getItem('scLayoutPrefsV1')||'{}').wide}catch(e){return false}})()};
   });
   rec('上の帯を畳むと一覧が実際に広くなる',after.tl>before.tl+40,
       JSON.stringify({before:before.tl,after:after.tl}));
   rec('上の帯（画面名・状態・操作列）と道具列が畳まれる',
       !after.headShown&&!after.toolShown,JSON.stringify(after));
   rec('戻り道の札が常に見えていて、戻し方を書いてある',
       after.pill&&/元の表示に戻す/.test(after.pillText)&&/Esc/.test(after.pillText),
       JSON.stringify({pill:after.pill,text:after.pillText}));
   rec('広く使う設定はこの端末に残る（毎回選び直させない）',after.kept,String(after.kept));
   /* **Escで戻せる**（畳んだ先から戻れない状態を作らない・§4）。 */
   await page.keyboard.press('Escape');
   await paint();
   const back=await page.evaluate(()=>({
    tl:Math.round(document.getElementById('scTimeline').clientHeight),
    headShown:!!(document.querySelector('main>header')||{}).getBoundingClientRect
      &&document.querySelector('main>header').getBoundingClientRect().height>0,
    pill:!!document.querySelector('#scWideExit:not([hidden])'),
    kept:(()=>{try{return !!JSON.parse(localStorage.getItem('scLayoutPrefsV1')||'{}').wide}catch(e){return false}})(),
   }));
   rec('Escで元の表示に戻る',back.headShown&&!back.pill&&!back.kept
       &&Math.abs(back.tl-before.tl)<=2,JSON.stringify({before:before.tl,back:back.tl,...back}));
  }

  /* ---- 4) 中身が無い場面では入口ごと消える ---- */
  await page.evaluate(()=>{const b=document.getElementById('scModeBoard');if(b)b.click()});
  await page.waitForSelector('.sc-board-row',{timeout:15000}).catch(()=>{});
  await idle(400,8000);
  const inBoard=await page.evaluate(()=>{
   const btn=document.getElementById('scViewMenuBtn');
   const grp=document.querySelector('#scHead .sc-tools[data-tools="view"]');
   return {btn:btn.hidden,group:grp.hidden,pop:document.getElementById('scViewPop').hidden};
  });
  rec('全体俯瞰では「表示」の入口ごと消える',inBoard.btn&&inBoard.group&&inBoard.pop,
      JSON.stringify(inBoard));

 }catch(e){console.log('FATAL',e.message)}finally{
  try{
   for(const id of made)await page.evaluate(async i=>{
    await fetch('/api/schedule/plan/delete',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:i,user_id:'test-scbar'})});
   },id);
   await page.evaluate(()=>{try{const p=JSON.parse(localStorage.getItem('scLayoutPrefsV1')||'{}');
     delete p.childBadge;delete p.childBadgeCol;delete p.wide;
     localStorage.setItem('scLayoutPrefsV1',JSON.stringify(p))}catch(e){}});
   await setMode('edit');
  }catch(e){}
  await b.close();
  console.log('\n=== SUMMARY ===');
  console.log(`${R.filter(r=>r.ok).length}/${R.length} PASS`);
  R.filter(r=>!r.ok).forEach(r=>console.log('  FAIL '+r.n+(r.d?' -- '+r.d:'')));
 }
})();
