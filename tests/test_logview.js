/* test_logview.js: ログ・診断の画面（§9.99）

   ============================================================
   ここで固定すること
   ------------------------------------------------------------
    1. 左メニューから開ける（画面が生えている）
    2. **起動セッションでまとまる**（最新の起動が上・最初から開いている）
    3. **1行ではなく1件**で並ぶ。トレースバックは畳まれ、「＋N行」で開く
    4. 選ぶ・選択解除が効き、件数が出る
    5. 絞り込みを変えるとサーバーへ取り直しに行く（画面側で二重に判定しない）
    6. 画面を出ると自動更新が止まる（別の画面で裏読みを続けない）

   2〜4は**中身が決まっていないと確かめられない**ので、そこだけ
   `/api/logs` の応答を差し替える。1・5・6は本物のサーバーで確かめる。
   **消す操作は押すが、応答を差し替えて本物のログには届かせない**（この端末の
   記録を消さないため）。見たいのは「ボタンが本当にAPIへ繋がっているか」で、
   消えた結果は tests/test_logs.py が一時フォルダで確かめている。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
let b=null;

const REC=(ts,level,text,extra,src,boot)=>({ts,ms:'000',level,levelRaw:level.toUpperCase(),
 logger:src,text,source:src,file:src==='launcher'?'launcher.log':'app.log',
 lines:[ts+',000 '+level.toUpperCase()+' ['+src+'] '+text].concat(extra||[]),
 extra:extra||[],boot:!!boot});

const FIXTURE={ok:true,total:6,matched:6,shown:6,clipped:false,
 counts:{error:1,warning:1,info:4,debug:0},windowBytes:2097152,
 sizes:{'app.log':1234,'launcher.log':567},dir:'/tmp/logs',targets:['app.log','launcher.log'],
 files:[{name:'app.log',stream:'app',streamLabel:'アプリ本体',current:true,generation:0,size:1234,mtime:'2026-08-12 10:00:00'},
        {name:'launcher.log',stream:'launcher',streamLabel:'起動入口',current:true,generation:0,size:567,mtime:'2026-08-12 10:00:00'}],
 records:[
  REC('2026-08-12 09:00:00','info','--- 起動 ---',null,'launcher',true),
  REC('2026-08-12 09:00:01','info','プロセスID  : 100',null,'launcher'),
  REC('2026-08-12 09:00:02','info','一覧を開いた db=SIKALOTNOW',null,'app'),
  REC('2026-08-12 10:00:00','info','--- 起動 ---',null,'launcher',true),
  REC('2026-08-12 10:00:01','error','予期しないエラー',
      ['Traceback (most recent call last):','  File "app.py", line 1','ValueError: 壊れた値'],'app'),
  REC('2026-08-12 10:00:02','warning','共有が遅い elapsed=9s',null,'app'),
 ]};

(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:950}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openLogView',{timeout:20000});

 // ---- 1. 本物のサーバーで開ける ----
 await page.click('#openLogView');
 await page.waitForSelector('#logPanel:not([hidden])',{timeout:15000});
 await page.waitForFunction(()=>!/読み込んでいます/.test(document.getElementById('lgSummary')?.textContent||''),
                            null,{timeout:15000});
 const live=await page.evaluate(()=>({
  mode:document.body.classList.contains('lg-mode'),
  head:document.getElementById('fileName')?.textContent||'',
  toolbarInHeader:!!document.querySelector('#headerViewBar #lgHead'),
  summary:document.getElementById('lgSummary')?.textContent||'',
  groups:document.querySelectorAll('#lgTree .lg-group').length,
  lines:document.querySelectorAll('#lgTree .lg-line').length,
 }));
 rec('左メニューからログ・診断を開ける',live.mode&&/ログ/.test(live.head),live.head);
 rec('この画面の操作列がヘッダーへ載る',live.toolbarInHeader);
 rec('本物のログが読める（1件以上）',live.lines>0,live.summary.slice(0,60));
 rec('起動セッションでまとまっている',live.groups>0,'グループ '+live.groups);

 // ---- 5. 絞り込みはサーバーへ取り直しに行く ----
 let asked=[];
 const LOGS_API=/\/api\/logs\?/;   // ?はPlaywrightのglobでは素の文字なので正規表現で書く
 await page.route(LOGS_API,route=>{asked.push(route.request().url());route.continue()});
 await page.selectOption('#lgLevel','problem');
 await page.waitForTimeout(900);
 rec('レベルを変えるとサーバーへ取り直す',asked.some(u=>/level=problem/.test(u)),String(asked.length)+'回');
 await page.fill('#lgQuery','起動');
 await page.waitForTimeout(1200);
 rec('検索は打ち終わってから1回だけ投げる（1文字ごとに投げない）',
     asked.filter(u=>/q=/.test(u)&&!/q=&/.test(u)).length<=2,
     asked.filter(u=>/q=/.test(u)&&!/q=&/.test(u)).length+'回');
 await page.unroute(LOGS_API);

 // ---- 2〜4. 中身を決めて、まとめ方と1件の扱いを確かめる ----
 await page.route(LOGS_API,route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify(FIXTURE)}));
 await page.fill('#lgQuery','');
 await page.selectOption('#lgLevel','all');
 await page.waitForTimeout(900);
 await page.evaluate(()=>WL.logView.load());
 await page.waitForFunction(()=>document.querySelectorAll('#lgTree .lg-group').length===2,null,{timeout:10000});

 const tree=await page.evaluate(()=>{
  const g=[...document.querySelectorAll('#lgTree .lg-group')];
  return {
   titles:g.map(x=>x.querySelector('b')?.textContent||''),
   times:g.map(x=>x.querySelector('.lg-group-time')?.textContent||''),
   open:g.map(x=>x.open),
   counts:g.map(x=>x.querySelectorAll('.lg-line').length),
   more:document.querySelectorAll('#lgTree .lg-more').length,
   extraHidden:[...document.querySelectorAll('#lgTree .lg-extra')].every(x=>x.hidden),
   errorRows:document.querySelectorAll('#lgTree .lg-line.is-error').length,
   warnRows:document.querySelectorAll('#lgTree .lg-line.is-warning').length,
  };
 });
 rec('起動セッションが2つに分かれる',tree.titles.length===2,JSON.stringify(tree.titles));
 rec('最新の起動が上に来る',tree.times[0]>tree.times[1],JSON.stringify(tree.times));
 rec('最新の起動だけ最初から開いている',tree.open[0]===true&&tree.open[1]===false,JSON.stringify(tree.open));
 rec('件はそれぞれの起動へ分かれる',JSON.stringify(tree.counts)==='[3,3]',JSON.stringify(tree.counts));
 rec('トレースバックは1件へ畳まれる（行が散らばらない）',tree.more===1,'＋N行ボタン '+tree.more);
 rec('畳んだ続きは既定で閉じている',tree.extraHidden);
 rec('レベルが行の見た目に出る',tree.errorRows===1&&tree.warnRows===1,
     'error='+tree.errorRows+' warning='+tree.warnRows);

 await page.click('#lgTree .lg-more');
 const opened=await page.evaluate(()=>{
  const pre=document.querySelector('#lgTree .lg-extra');
  return {hidden:pre.hidden,text:pre.textContent,label:document.querySelector('#lgTree .lg-more').textContent};
 });
 rec('「＋N行」で続きが開く',!opened.hidden&&/ValueError/.test(opened.text),opened.text.slice(0,30));
 rec('開いたら閉じる合図に変わる',/^−/.test(opened.label),opened.label);

 await page.click('#lgPickAll');
 const picked=await page.evaluate(()=>({
  checked:[...document.querySelectorAll('#lgTree .lg-pick')].filter(x=>x.checked).length,
  summary:document.getElementById('lgSummary').textContent,
 }));
 rec('表示中をすべて選べる',picked.checked===6,'選択 '+picked.checked);
 rec('選んだ件数が出る',/選択6件/.test(picked.summary),picked.summary.slice(-24));
 await page.click('#lgPickNone');
 const cleared=await page.evaluate(()=>[...document.querySelectorAll('#lgTree .lg-pick')].filter(x=>x.checked).length);
 rec('選択を解除できる',cleared===0,'選択 '+cleared);

 // 起動ごとの選択（この起動だけをコピー・削除するための入口）
 await page.click('#lgTree .lg-group-acts button[data-act="pick"]');
 const groupPick=await page.evaluate(()=>({
  checked:[...document.querySelectorAll('#lgTree .lg-pick')].filter(x=>x.checked).length,
  marked:document.querySelectorAll('#lgTree .lg-group.is-picked').length,
 }));
 rec('起動のまとまりごと選べる',groupPick.checked===3&&groupPick.marked===1,JSON.stringify(groupPick));

 /* ---- 消す操作が本当にサーバーへ届く ----
    **押しても本物のログは消さない**: 応答を差し替えて、届いた宛先だけを見る。
    画面にボタンがあるのにAPIへ繋がっていない（またはAPIがあるのにボタンが
    無い）状態は、押すまで気づけないので機械で見る。 */
 const sent=[];
 await page.route(/\/api\/logs\/(clear|rotate|delete-old|delete-lines)$/,async route=>{
  sent.push({url:route.request().url().replace(/^.*\/api/,'/api'),body:route.request().postData()});
  await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true,"removed":0}'});
 });
 await page.evaluate(()=>{window.confirm=()=>true});
 await page.click('#lgClear');
 await page.waitForTimeout(500);
 const clearReq=sent.find(x=>/clear$/.test(x.url));
 rec('「すべて」消去がサーバーへ届く（押せるのに繋がっていない、が無い）',
     !!clearReq&&/app\.log|launcher\.log/.test(clearReq.body||''),JSON.stringify(clearReq||null));
 await page.click('#lgRotate');
 await page.waitForTimeout(500);
 rec('「ここで区切る」もサーバーへ届く',sent.some(x=>/rotate$/.test(x.url)),
     sent.map(x=>x.url).join(' '));
 await page.unroute(/\/api\/logs\/(clear|rotate|delete-old|delete-lines)$/);

 // ---- 6. 画面を出ると自動更新が止まる ----
 await page.check('#lgAuto');
 const running=await page.evaluate(()=>WL.logView.state.auto);
 await page.click('#openMasterMaint');
 await page.waitForTimeout(400);
 const stopped=await page.evaluate(()=>({auto:WL.logView.state.auto,timer:WL.logView.state.timer,
   hidden:document.getElementById('logPanel').hidden,
   mode:document.body.classList.contains('lg-mode')}));
 rec('自動更新を入れられる',running===true);
 rec('別の画面へ移ると自動更新が止まる',stopped.auto===false&&stopped.timer===0,JSON.stringify(stopped));
 rec('別の画面へ移るとログ画面は閉じる',stopped.hidden===true&&stopped.mode===false,JSON.stringify(stopped));

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
