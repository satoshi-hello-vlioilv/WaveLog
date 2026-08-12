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

 /* ---- 接続の診断(§9.101) ----
    「ログ・診断」の診断の側。**開くまでは共有へ触らない**(応答の遅い共有を
    画面を開いただけで叩くと、ログを読みに来た人を待たせる)。 */
 const diagBefore=await page.evaluate(()=>({
  open:document.getElementById('lgDiag').open,
  body:document.getElementById('lgDiagBody').innerHTML.trim().length,
 }));
 rec('診断は畳んだ状態で始まる（開くまで共有へ触らない）',
     diagBefore.open===false&&diagBefore.body===0,JSON.stringify(diagBefore));

 await page.click('#lgDiag > summary');
 await page.waitForFunction(()=>document.querySelectorAll('#lgDiagBody .lg-diag-step').length>0,
                            null,{timeout:20000});
 const diag=await page.evaluate(()=>({
  steps:document.querySelectorAll('#lgDiagBody .lg-diag-step').length,
  targets:[...document.querySelectorAll('#lgDiagDb option')].map(o=>o.value),
  verdict:document.getElementById('lgDiagVerdict').textContent,
  head:document.querySelectorAll('#lgDiagBody .lg-diag-kv').length,
 }));
 rec('開くと段階ごとの結果が出る',diag.steps>=5,diag.steps+'段階');
 rec('対象の選択肢はサーバーが返した接続先から作る（決め打ちにしない）',
     diag.targets.length>=3&&diag.targets.includes('MASTER'),JSON.stringify(diag.targets));
 rec('読み込み先・UNCかどうかを添える',diag.head>=3,diag.head+'項目');

 /* **「走った」と「答えが是」を分ける。** 存在確認は例外を出さなければ
    ok=true だが、値が False なら「無い」という答え。✓を付けると成功と
    読めてしまうので、印を分けている（実際に紛らわしかった）。 */
 await page.selectOption('#lgDiagDb','MASTER');
 await page.click('#lgDiagRun');
 await page.waitForFunction(()=>/成功|止まった|失敗/.test(
   document.getElementById('lgDiagVerdict').textContent||''),null,{timeout:20000});
 const okCase=await page.evaluate(()=>({
  verdict:document.getElementById('lgDiagVerdict').textContent,
  ng:document.querySelectorAll('#lgDiagBody .lg-diag-step.is-ng').length,
  no:document.querySelectorAll('#lgDiagBody .lg-diag-step.is-no').length,
 }));
 rec('手元のDBは全段階を通る',okCase.verdict==='すべて成功'&&okCase.ng===0&&okCase.no===0,
     JSON.stringify(okCase));

 /* 届かないDBの見せ方は**応答を差し替えて**確かめる。検証用フィクスチャでは
    仕掛DBも手元に実在して全段階通ってしまい、失敗の描き分けを試せないため。
    ここで見たいのはサーバーの判定ではなく、**画面がどう見せるか**。 */
 const diagCase=async steps=>{
  await page.unroute(/\/api\/db-diagnose/).catch(()=>{});
  await page.route(/\/api\/db-diagnose/,route=>route.fulfill({status:200,
   contentType:'application/json',body:JSON.stringify({
    db:'SIKALOTNOW',path:'\\\\server\\share\\SIKALOTNOW.sqlite3',
    is_absolute:false,is_unc:true,ok:false,
    targets:[{key:'SIKALOTNOW',label:'仕掛（現在）'},{key:'MASTER',label:'マスタ一覧'}],
    steps})}));
  await page.evaluate(()=>{document.getElementById('lgDiagVerdict').textContent=''});
  await page.click('#lgDiagRun');
  await page.waitForFunction(()=>/止まった/.test(
    document.getElementById('lgDiagVerdict').textContent||''),null,{timeout:10000});
  return page.evaluate(()=>{
   const el=[...document.querySelectorAll('#lgDiagBody .lg-diag-step')];
   return {verdict:document.getElementById('lgDiagVerdict').textContent,
           marks:el.map(e=>e.querySelector('.lg-diag-mark').textContent),
           cls:el.map(e=>e.className.replace('lg-diag-step ','')),
           text:document.getElementById('lgDiagBody').textContent};
  });
 };

 /* (1) 例外は出ていないが答えが「無い」——**✓を付けない**。
    存在確認は例外を出さなければ ok=true なので、値を見ないと
    「確認できた＝有る」と読めてしまう(実際に紛らわしかった)。 */
 const noCase=await diagCase([
  {name:'親フォルダの存在確認 (Path.exists)',ok:true,value:'True'},
  {name:'ファイルの存在確認 (Path.exists / os.stat)',ok:true,value:'False'},
  {name:'サイズ・更新時刻 (Path.stat)',ok:false,error:'FileNotFoundError: なし'},
  {name:'SQLiteへ接続してテーブル一覧を取得',ok:false,error:'OperationalError'},
 ]);
 rec('どの段階で止まったかを名指しする',/「ファイルの存在確認」で止まった/.test(noCase.verdict),noCase.verdict);
 rec('答えが「無い」段階に✓を付けない',noCase.marks[1]==='−'&&noCase.cls[1]==='is-no',
     JSON.stringify(noCase.marks)+' / '+JSON.stringify(noCase.cls));
 rec('答えが「無い」ことを日本語で書く',/ありません/.test(noCase.text));
 rec('その先は道連れとして薄く出す（原因と取り違えない）',
     noCase.cls.slice(2).every(c=>c==='is-after'),JSON.stringify(noCase.cls));

 /* (2) 例外で落ちた場合。最初の1件だけが×で、WinErrorは添える
    (現地の切り分けでは番号が決め手になる)。 */
 const errCase=await diagCase([
  {name:'親フォルダの存在確認 (Path.exists)',ok:true,value:'True'},
  {name:'サイズ・更新時刻 (Path.stat)',ok:false,error:'OSError: 予期しないネットワークエラー',winerror:59},
  {name:'SQLiteへ接続してテーブル一覧を取得',ok:false,error:'OperationalError'},
 ]);
 rec('例外で落ちた最初の段階は×',errCase.marks[1]==='×'&&errCase.cls[1]==='is-ng',
     JSON.stringify(errCase.marks)+' / '+JSON.stringify(errCase.cls));
 rec('WinErrorがあれば添える（現地の切り分けで効く）',/WinError 59/.test(errCase.text));
 rec('2件目以降の失敗は薄くする',errCase.cls[2]==='is-after',JSON.stringify(errCase.cls));
 await page.unroute(/\/api\/db-diagnose/);

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
