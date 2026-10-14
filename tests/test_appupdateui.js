/* test_appupdateui.js: 版を置く間の進み具合（§9.556）
   ------------------------------------------------------------
   利用者の指摘:「アプリの更新の準備をして、版を置いたときに時間がかかっている間、ユーザーへの反応が
   ないのでわかりにくいです。版を置いている最中にアプリを終了した場合も問題が起きそうです。」

   ここで固定すること:
    1. ZIP を選んだ**その場で**（状態を取り直す前に）ボタンの行が進み具合の帯（共通の`WL.progress`）に替わる
    2. サーバーの進み具合（`/api/app/update/progress`）の段ごとに題が変わり、写す段では
       「n / N ファイル・量」と割合の棒を出す。割合が分からない段は棒を往復させる（`is-indef`）
    3. 置いている間は「この版を配る」を押せない（置き終わってから選ぶ）
    4. 置いている間に×で閉じようとすると、理由を言って確かめる（`WL.closeGuard`）
    5. 置き終わったら帯を下ろし、ボタンの行へ戻る
    6. 版を消す（§9.584）: 消すのは「版を整理する」を押した整理中だけ（ふだんの行は「この版を配る」だけ）。
       整理中は配るを伏せ、配っている版には消せない理由を字で書く。確かめの窓は量・戻す道を言い、危ない色の
       「消す」で送る。消せる版が無ければ整理の入口を出さない

   **サーバーの答えは差し替える**（共有の置き場は網に無い・遅い共有は網では作れない）。確かめるのは
   「答えが画面にどう出るか」。答えの中身（段の順・数）は`tests/test_appupdate.py`が見る。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const STATUS={dir:'\\\\srv\\share\\WaveLog',reachable:true,why:'',local:'2.443.0',
 release:{version:'2.442.0',setAt:'2026-10-04 22:46',setBy:'tester',previous:''},
 versions:[{version:'2.442.0',placedAt:'2026-10-04 22:46',placedBy:'tester',source:'WaveLog-main.zip',commit:'71b375c',files:188,bytes:15204352}],
 pending:false,payload:['backend','static','templates','program','README.md'],publishing:false,
 entry:{path:'\\\\srv\\share\\WaveLog\\WaveLog.exe',exists:true,seed:{master_db_path:'\\\\srv\\Records\\master.sqlite3'}},
 role:'開発者',canRelease:true};

run('test_appupdateui: 版を置く間の進み具合（§9.556）・版を消す（§9.584）',async({page,rec,W,idle})=>{
 await fetch(B+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 let prog={state:'idle'};
 let release=null;
 const held=new Promise(r=>{release=r});
 let status=STATUS;
 const sent=[];
 await page.route('**/api/app/update',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(status)}));
 await page.route('**/api/app/update/delete',async r=>{
  const v=JSON.parse(r.request().postData()||'{}').version;sent.push(v);
  status={...status,versions:status.versions.filter(x=>x.version!==v)};
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,version:v,files:200,bytes:16148480,notes:[]})});
 });
 await page.route('**/api/app/update/progress',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(prog)}));
 await page.route('**/api/app/update/publish**',async r=>{
  await held;
  await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,version:'2.443.0',files:10,bytes:1048576})});
 });
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);await idle();
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});await idle();
  await page.evaluate(()=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes('共通設定'));t&&t.click()});
  await idle(400,10000);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintForm [role=tab],#masterMaintForm button')].find(x=>x.textContent.trim().startsWith('アプリの更新'));b&&b.click()});
  await page.waitForSelector('#appUpdate #auZip',{state:'attached',timeout:10000});

  /* ---- 0) 新しい PC へ渡すもの（§9.559）: 入口のアドレス・コピー・初回に写る共有のマスタ ---- */
  const nw=await page.evaluate(()=>{const e=document.querySelector('#appUpdate .au-new');return e?{字:e.textContent,
   コピー:!!e.querySelector('[data-au-copy]'),道:(e.querySelector('[data-au-copy]')||{}).dataset?.auCopy||''}:null});
  rec('新しい PC へ渡すアドレス（配る入口）とコピーのボタンを出す',!!nw&&nw.コピー&&/WaveLog\.exe/.test(nw.道)&&/新しい PC へ/.test(nw.字),JSON.stringify(nw));
  rec('初回に写る共有のマスタの置き場を言う',!!nw&&/master\.sqlite3/.test(nw.字)&&/USERPROFILE/.test(nw.字),nw&&nw.字.slice(0,120));

  /* ---- 1) 選んだその場で帯に替わる ---- */
  const t0=Date.now();
  await page.setInputFiles('#auZip',{name:'WaveLog-main.zip',mimeType:'application/zip',buffer:Buffer.alloc(2048)});
  await page.waitForSelector('#appUpdate .au-progress',{timeout:5000});
  const first=Date.now()-t0;
  const s1=await page.evaluate(()=>{const p=document.querySelector('#appUpdate .au-progress');return{
   題:p.querySelector('.wl-progress-title').textContent,数:p.querySelector('.wl-progress-meta').textContent,
   往復:p.classList.contains('is-indef'),配る:document.querySelectorAll('#appUpdate [data-au-release]').length,
   ボタン:!!document.querySelector('#appUpdate #auZip')}});
  rec('ZIP を選んだその場で進み具合の帯に替わる（1秒以内）',first<1000&&/送っています/.test(s1.題),`${first}ms ${s1.題}`);
  rec('何を送っているか（名前と大きさ）を言う',/WaveLog-main\.zip/.test(s1.数),s1.数);
  rec('割合が分からない段は棒を往復させる（止まっていないと言う）',s1.往復===true);
  rec('置いている間は「この版を配る」とZIPのボタンを伏せる',s1.配る===0&&!s1.ボタン,JSON.stringify(s1));

  /* ---- 2) サーバーの段ごとに題・数・割合が変わる ---- */
  const seen=async(title,what)=>{await W.until(page,t=>{const p=document.querySelector('#appUpdate .au-progress .wl-progress-title');return !!p&&p.textContent.includes(t)},title,{ms:5000,what})};
  prog={state:'running',stage:'check',startedAt:1,elapsed:0.4};
  await seen('確かめています','確かめる段の題が出る');
  rec('確かめる段の題が出る',true);
  prog={state:'running',stage:'copy',version:'2.443.0',done:3,total:10,bytes:314573,totalBytes:1048576,elapsed:2.1};
  await seen('写しています','写す段の題が出る');
  await W.until(page,()=>/3 \/ 10 ファイル/.test(document.querySelector('#appUpdate .wl-progress-meta').textContent),null,{ms:5000,what:'写した数が出る'});
  const s2=await page.evaluate(()=>{const p=document.querySelector('#appUpdate .au-progress');const bar=p.querySelector('.wl-progress-bar');return{
   数:p.querySelector('.wl-progress-meta').textContent,割合:p.querySelector('.wl-progress-pct').textContent,
   棒:bar.getAttribute('aria-valuenow'),往復:p.classList.contains('is-indef')}});
  rec('写す段は「n / N ファイル・量・経過」と割合を言う',/3 \/ 10 ファイル/.test(s2.数)&&/MB/.test(s2.数)&&/経過 2 秒/.test(s2.数)
      &&s2.割合==='30%'&&s2.棒==='30'&&!s2.往復,JSON.stringify(s2));

  /* WAVELOG_SHOT=<dir> を付けたときだけ、写している途中の段を書き出す（見た目の確認用） */
  if(process.env.WAVELOG_SHOT)await page.screenshot({path:require('path').join(process.env.WAVELOG_SHOT,'appupdate_copy.png')});

  /* ---- 3) 置いている間の×は確かめる ---- */
  const why=await page.evaluate(()=>WL.closeGuard.reasons());
  rec('置いている間に閉じようとすると理由を言う',why.some(x=>/版を置いている最中/.test(x)),JSON.stringify(why));

  prog={state:'running',stage:'finish',version:'2.443.0',done:10,total:10,bytes:1048576,totalBytes:1048576,elapsed:3};
  await seen('仕上げています','仕上げの段の題が出る');
  rec('仕上げの段の題が出る',true);

  /* ---- 4) 置き終わったら帯を下ろす ---- */
  prog={state:'done',stage:'finish',result:{ok:true},elapsed:3.2};
  release();
  await page.waitForSelector('#appUpdate #auZip',{state:'attached',timeout:8000});
  const s4=await page.evaluate(()=>({帯:!!document.querySelector('#appUpdate .au-progress'),理由:WL.closeGuard.reasons()}));
  rec('置き終わったら帯を下ろしてボタンの行へ戻る',!s4.帯,JSON.stringify(s4));
  rec('置き終わったら閉じるときに確かめない',!s4.理由.some(x=>/版を置いている最中/.test(x)),JSON.stringify(s4.理由));

  /* ---- 5) 版を消す（§9.584） ---- */
  const look=()=>page.evaluate(()=>{const h=document.querySelector('#appUpdate .au-list-head');return{
   頭:h?h.textContent.replace(/\s+/g,' ').trim():'',整理:!!document.querySelector('#appUpdate [data-au-tidy]'),
   消す:[...document.querySelectorAll('#appUpdate [data-au-delete]')].map(b=>b.dataset.auDelete),
   配る:document.querySelectorAll('#appUpdate [data-au-release]').length,
   配っている行:(document.querySelector('#appUpdate tr.is-live .au-act')||{}).textContent||''}});
  const l0=await look();
  rec('消せる版が無ければ（配っている版だけ）整理の入口を出さない',!l0.整理&&l0.消す.length===0&&/置いてある版 1/.test(l0.頭),JSON.stringify(l0));
  status={...STATUS,release:{...STATUS.release,previous:'2.441.0'},versions:[STATUS.versions[0],
   {...STATUS.versions[0],version:'2.441.0',commit:'3b9c1c4',bytes:16148480},{...STATUS.versions[0],version:'2.440.0',commit:'9f8e7d6',bytes:15833088}]};
  await page.evaluate(()=>WL.appUpdate.refresh());
  await W.until(page,()=>!!document.querySelector('#appUpdate [data-au-tidy]'),null,{ms:5000,what:'整理の入口が出る'});
  const l1=await look();
  rec('ふだんの行には「消す」を出さない（「この版を配る」だけ）',l1.消す.length===0&&l1.配る===2,JSON.stringify(l1));
  rec('表の頭は置いてある版の数と合計の量を言う',/置いてある版 3・合計 45\.\d MB/.test(l1.頭),l1.頭);
  await page.click('#appUpdate [data-au-tidy]');
  await W.until(page,()=>document.querySelectorAll('#appUpdate [data-au-delete]').length>0,null,{ms:5000,what:'整理中の「消す…」が出る'});
  const l2=await look();
  rec('整理中は配っている版のほかに「消す…」を出し、「この版を配る」を伏せる',
   JSON.stringify(l2.消す)==='["2.441.0","2.440.0"]'&&l2.配る===0&&/整理を終える/.test(l2.頭)&&/整理中/.test(l2.頭),JSON.stringify(l2));
  rec('整理中は消せる版の数と量を言う（配っている版は数えない）',/消せるのは 2 版・30\.5 MB/.test(l2.頭),l2.頭);
  rec('配っている版は消せないと字で書く',/配っている版は消せません/.test(l2.配っている行),l2.配っている行);
  await page.click('#appUpdate [data-au-delete="2.441.0"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  const m=await page.evaluate(()=>({題:document.getElementById('appConfirmTitle').textContent,本文:document.getElementById('appConfirmBody').textContent,
   決定:document.getElementById('appConfirmOk').textContent,危ない:document.getElementById('appConfirmOk').className}));
  rec('確かめの窓は消す量・取り消せない・前に配った版へ戻せなくなる・戻す道を言う',
   /2\.441\.0/.test(m.題)&&/15\.4 MB/.test(m.本文)&&/取り消せません/.test(m.本文)&&/前に配った版/.test(m.本文)&&/もう一度置けば戻せます/.test(m.本文),JSON.stringify(m));
  rec('決定のボタンは「削除する」で危ない色（削除の動詞は1つ・§9.604）',m.決定==='削除する'&&/danger/.test(m.危ない),JSON.stringify(m));
  await page.click('#closeAppConfirm');
  await page.waitForSelector('#appConfirmModal',{state:'hidden',timeout:5000});
  rec('やめたら何も送らない',sent.length===0,JSON.stringify(sent));
  await page.click('#appUpdate [data-au-delete="2.441.0"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  await page.click('#appConfirmOk');
  await W.until(page,()=>!document.querySelector('#appUpdate [data-au-delete="2.441.0"]')&&!!document.querySelector('#appUpdate [data-au-delete="2.440.0"]'),null,{ms:5000,what:'消した版が一覧から消える'});
  rec('「消す」で選んだ版だけを送り、整理中のまま一覧から外す',JSON.stringify(sent)==='["2.441.0"]',JSON.stringify(sent));
  await page.click('#appUpdate [data-au-delete="2.440.0"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  await page.click('#appConfirmOk');
  await W.until(page,()=>!document.querySelector('#appUpdate [data-au-tidy]')&&document.querySelectorAll('#appUpdate [data-au-delete]').length===0,null,{ms:5000,what:'消せる版が尽きたら整理を終える'});
  const l3=await look();
  rec('消せる版が尽きたら整理を自分で終える',!l3.整理&&/置いてある版 1/.test(l3.頭)&&!/整理中/.test(l3.頭),JSON.stringify(l3));
 }finally{
  release&&release();
  for(const u of ['**/api/app/update','**/api/app/update/progress','**/api/app/update/publish**','**/api/app/update/delete'])
   await page.unroute(u).catch(()=>{/* 既に外れていれば何もしない（後片付け） */});
 }
},{viewport:{width:1728,height:1152}});
