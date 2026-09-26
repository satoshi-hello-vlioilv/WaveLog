/* test_presenceui.js: 接続状況の画面（§9.272、利用者の指示「誰がアクセス中か
   見える化し、接続中のユーザーを視覚化し、強制的に接続切断したりする機能」）。

   固定するのは6つ。
    ① マスタ管理 > 管理 > 接続状況 が**どの区分でも開ける**（見るだけなら全員）
    ② いま繋いでいる端末が**行として並ぶ**（ログインID・PC名・区分・画面）
    ③ **切断できるかを決めるのはサーバー**——`canDisconnect`が真の行にだけ
       ボタンが出る（画面が区分を見て判断していたら、この網は落ちる）
    ④ **押せない行には理由が文字で出る**（§4。押せるのに何も起きないボタンを
       残さない／黙って消さない）
    ⑤ いまの自分の区分とできることを**必ず文字で**出す（§3）
    ⑥ 切断されている端末は「切断中」と出て、**取り消し**が同じ場所にある

    ⑦ **版と接続の記録**（§9.513）: 運用中の最新版・最新でない端末の数・接続した時刻と
       接続時間・端末ごと／利用者ごとの記録・最新でない版だけ・表をコピー（見えている表のまま）

   ③④⑥⑦は`/api/presence`を差し替えて確かめる。**実データに他の端末が居る
   保証は無い**ので、「無ければ素通り」の書き方だと直す前でも通る。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};

/* 差し替える答え。**行ごとに canDisconnect を変える**ので、画面が自分で
   区分を見て決めていたら必ず食い違う。 */
const FAKE=(role,canDisc)=>({ok:true,
 items:[
  {key:'PC-ME@me',login:'me',pc:'PC-ME',role:role,mode:'edit',view:'master',at:'',idleSec:2,
   version:'2.400.0',since:'2026-09-26T09:00:00',durationSec:3720,outdated:false,
   revoked:null,isMe:true,canDisconnect:false},
  {key:'PC-A@u1',login:'u1',pc:'PC-A',role:'一般ユーザー',mode:'edit',view:'schedule',at:'',idleSec:8,
   version:'',since:'',durationSec:null,outdated:true,
   revoked:null,isMe:false,canDisconnect:canDisc},
  {key:'PC-B@u2',login:'u2',pc:'PC-B',role:'開発者',mode:'view',view:'records',at:'',idleSec:40,
   revoked:null,isMe:false,canDisconnect:false},
  {key:'PC-C@u3',login:'u3',pc:'PC-C',role:'一般ユーザー',mode:'edit',view:'list',at:'',idleSec:5,
   revoked:{by:'boss',byPc:'PC-BOSS',reason:'点検',remainingSec:240},isMe:false,canDisconnect:canDisc},
 ],
 readable:true,shared:true,source:'master',dir:'\\\\srv\\share\\presence',
 me:{login:'me',pc:'PC-ME',key:'PC-ME@me',role:role,mode:'edit'},
 can:{role:role,canView:true,canDisconnect:canDisc,canDisconnectDeveloper:role==='開発者',canForget:canDisc},
 roles:['開発者','メンテナンス者','一般ユーザー'],ttlSec:75,cooldownSec:300,revoked:null,
 /* 版と接続の記録（§9.513）。答えはサーバー（fleet_summary）なので、網も答えをそのまま渡す。 */
 fleet:{latestVersion:'2.400.0',myVersion:'2.400.0',recordingSince:'2.400.0',
  counts:{terminals:3,users:2,online:2,outdated:2,outdatedOnline:1},
  terminals:[
   {key:'PC-A@u1',login:'u1',pc:'PC-A',version:'',online:true,outdated:true,sessions:0,totalSec:0,lastAt:'2026-09-26T10:00:00',firstAt:'',versions:{}},
   {key:'PC-OLD@u1',login:'u1',pc:'PC-OLD',version:'2.398.0',online:false,outdated:true,sessions:4,totalSec:5400,lastAt:'2026-09-20T09:00:00',firstAt:'2026-09-01T08:00:00',versions:{'2.398.0':'2026-09-20T09:00:00'}},
   {key:'PC-ME@me',login:'me',pc:'PC-ME',version:'2.400.0',online:true,outdated:false,sessions:9,totalSec:36000,lastAt:'2026-09-26T10:00:00',firstAt:'2026-08-01T08:00:00',versions:{}}],
  users:[
   {login:'u1',terminals:2,pcs:['PC-A','PC-OLD'],sessions:4,totalSec:5400,lastAt:'2026-09-26T10:00:00',versions:['2.398.0',''],online:true,outdated:true},
   {login:'me',terminals:1,pcs:['PC-ME'],sessions:9,totalSec:36000,lastAt:'2026-09-26T10:00:00',versions:['2.400.0'],online:true,outdated:false}]},
 historyReadable:true});

run('test_presenceui: 接続状況の画面（§9.272）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 await setMode('edit');

 let fake=null;   // null のあいだは本物を通す
 await page.route('**/api/presence',route=>{
  if(!fake)return route.continue();
  route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fake)});
 });

 const openPresence=async()=>{
  await page.evaluate(()=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')]
    .find(x=>x.textContent.includes('接続状況'));if(t)t.click()});
  await page.waitForSelector('#pzList',{timeout:8000});
 };

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('#openMasterMaint',{timeout:15000});
 await page.click('#openMasterMaint');await idle();

 // ---- ① 入口がある（本物の答えで開く）----------------------------------
 const hasEntry=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintNav [data-master]')]
   .some(x=>x.textContent.includes('接続状況')));
 rec('マスタ管理に「接続状況」の入口がある',hasEntry);
 await openPresence();
 const realRows=await page.evaluate(()=>document.querySelectorAll('#pzList .pz-row:not(.pz-headrow)').length);
 rec('本物の答えでも一覧が組み上がる（自分の端末が出る）',realRows>=1,String(realRows));
 const meText=await page.evaluate(()=>document.querySelector('.pz-me')?.textContent||'');
 rec('⑤ いまの自分の区分を文字で出す',/一般ユーザー|メンテナンス者|開発者/.test(meText),meText.slice(0,50));
 rec('⑤ できることも文字で出す',/切断/.test(meText),meText.slice(0,80));

 // ---- ②③④ 一般ユーザー（切断できない）--------------------------------
 fake=FAKE('一般ユーザー',false);
 await openPresence();await idle();
 let v=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('#pzList .pz-row:not(.pz-headrow)')];
  return {n:rows.length,
   btns:document.querySelectorAll('#pzList [data-pz-cut]').length,
   whys:document.querySelectorAll('#pzList .pz-why').length,
   whyText:[...document.querySelectorAll('#pzList .pz-why')].map(x=>x.textContent.trim()),
   cells:rows.map(r=>[...r.querySelectorAll('span')].map(s=>s.textContent.trim()))};
 });
 rec('② 端末が行として並ぶ',v.n===4,String(v.n));
 rec('② ログインID・PC名・画面が出る',
   v.cells.some(c=>c.includes('u1')&&c.includes('PC-A')&&c.includes('作業スケジュール')),
   JSON.stringify(v.cells[1]||[]));
 rec('③ 切断できないときはボタンを出さない',v.btns===0,String(v.btns));
 rec('④ 押せない行には理由が文字で出る',v.whys>=3&&v.whyText.some(t=>/権限/.test(t)),
   JSON.stringify(v.whyText).slice(0,110));

 // ---- ③⑥ メンテナンス者（一般だけ切れる）------------------------------
 fake=FAKE('メンテナンス者',true);
 await openPresence();await idle();
 v=await page.evaluate(()=>({
  cut:[...document.querySelectorAll('#pzList [data-pz-cut]')].map(x=>x.dataset.pzCut),
  allow:[...document.querySelectorAll('#pzList [data-pz-allow]')].map(x=>x.dataset.pzAllow),
  cutBadge:!!document.querySelector('#pzList .pz-badge.is-cut'),
  devWhy:[...document.querySelectorAll('#pzList .pz-row')]
    .find(r=>r.textContent.includes('PC-B'))?.querySelector('.pz-why')?.textContent||'',
 }));
 /* **サーバーの答えだけで決まること。** 画面が区分を見て決めていたら、
    開発者(PC-B)にもボタンが出るか、一般(PC-A)に出ないかのどちらかになる。 */
 rec('③ 切断できる行にだけボタンが出る',v.cut.length===1&&v.cut[0]==='PC-A@u1',
   JSON.stringify(v.cut));
 rec('③ 開発者の行にはボタンを出さない',!v.cut.includes('PC-B@u2'),JSON.stringify(v.cut));
 rec('④ 出さない理由をその場に書く',/切断できません/.test(v.devWhy),v.devWhy.slice(0,50));
 rec('⑥ 切断中の端末は「切断中」と出る',v.cutBadge);
 rec('⑥ 取り消しが同じ場所にある',v.allow.length===1&&v.allow[0]==='PC-C@u3',
   JSON.stringify(v.allow));

 // ---- ⑥ 自分が切断されているときは帯を出す -----------------------------
 fake=Object.assign(FAKE('一般ユーザー',false),
   {revoked:{by:'boss',byPc:'PC-BOSS',reason:'点検',remainingSec:240}});
 await openPresence();await idle();
 const ban=await page.evaluate(()=>{
  const el=document.getElementById('pzRevoked');
  return el?{t:el.textContent.replace(/\s+/g,' ').trim(),shown:!!el.offsetParent}:null;
 });
 rec('自分が切断されていたら帯を出す',!!ban&&ban.shown,ban?ban.t.slice(0,40):'(無し)');
 rec('誰が・なぜ・あと何分かを書く',
   !!ban&&/boss/.test(ban.t)&&/点検/.test(ban.t)&&/分/.test(ban.t),ban?ban.t.slice(0,110):'');
 rec('「書き込みだけ」が止まると書く（画面は消えないこと）',
   !!ban&&/書き込みだけ/.test(ban.t),ban?ban.t.slice(40,110):'');

 // ---- 共有でないときは「この端末しか出ません」と書く --------------------
 fake=Object.assign(FAKE('開発者',true),{shared:false,source:'local'});
 await openPresence();await idle();
 const scope=await page.evaluate(()=>document.querySelector('.pz-me')?.textContent||'');
 rec('共有でなければ、そう書く（1件を「他に誰も居ない」と読ませない）',
   /この端末しか出ません/.test(scope),scope.slice(0,60));

 // ---- ⑦ 版と接続の記録（§9.513） --------------------------------------
 fake=FAKE('メンテナンス者',true);
 await openPresence();await idle();
 const fl=await page.evaluate(()=>{
  const me=[...document.querySelectorAll('#pzList .pz-row')].find(r=>r.textContent.includes('PC-ME'));
  const cell=c=>(me&&me.querySelector(c)||{}).textContent||'';
  return {latest:document.getElementById('pzLatest')?.textContent||'',
   old:document.getElementById('pzOldCount')?.textContent||'',
   oldCell:document.querySelector('.pz-sum-cell.is-old')?.textContent.replace(/\s+/g,' ')||'',
   ver:cell('.pz-c-ver'),since:cell('.pz-c-since'),dur:cell('.pz-c-dur'),
   aVer:([...document.querySelectorAll('#pzList .pz-row')].find(r=>r.textContent.includes('PC-A'))?.querySelector('.pz-c-ver')||{}).textContent||'',
   head:[...document.querySelectorAll('#pzTerms th')].map(x=>x.textContent),
   rows:[...document.querySelectorAll('#pzTerms tbody tr')].map(r=>r.textContent.replace(/\s+/g,' ')),
   forget:[...document.querySelectorAll('[data-pz-forget]')].map(b=>b.dataset.pzForget),
   /* 時間の書き方は端末の「表示」に従う（§9.341）ので、期待も同じ口から作る */
   want62:WL.duration.text(62),want90:WL.duration.text(90)};
 });
 rec('⑦ 運用中の最新版を出す',/VER2\.400\.0/.test(fl.latest),fl.latest);
 rec('⑦ 最新でない端末の数と、うち接続中を字で言う（配る相手）',
   /^2/.test(fl.old)&&/うち接続中 1台/.test(fl.oldCell),fl.oldCell.slice(0,60));
 rec('⑦ 接続中の端末に版・接続した時刻・接続時間が出る',
   /最新/.test(fl.ver)&&/VER2\.400\.0/.test(fl.ver)&&fl.since==='09-26 09:00'&&fl.dur===fl.want62,
   JSON.stringify([fl.ver,fl.since,fl.dur]));
 rec('⑦ 版を書かない古い版の端末は「要更新」と「VER…より前」で言う',
   /要更新/.test(fl.aVer)&&/より前/.test(fl.aVer),fl.aVer);
 rec('⑦ 記録の表は最新でない端末が上・累計接続回数と時間が出る',
   fl.head.includes('累計接続回数')&&fl.head.includes('累計接続時間')&&/要更新/.test(fl.rows[0]||'')
   &&fl.rows.some(r=>/4回/.test(r)&&r.includes(fl.want90)),JSON.stringify(fl.rows).slice(0,140));
 rec('⑦ 記録を消せるのは接続していない端末だけ（権限のある人に）',
   JSON.stringify(fl.forget)==='["PC-OLD@u1"]',JSON.stringify(fl.forget));
 await page.click('#pzOnlyOld');
 const onlyOld=await page.evaluate(()=>document.querySelectorAll('#pzTerms tbody tr').length);
 rec('⑦ 「最新でない版だけ」で絞れる',onlyOld===2,String(onlyOld));
 await page.click('[data-pz-by="users"]');
 const users=await page.evaluate(()=>({head:[...document.querySelectorAll('#pzTerms th')].map(x=>x.textContent),
   rows:[...document.querySelectorAll('#pzTerms tbody tr')].map(r=>r.textContent.replace(/\s+/g,' '))}));
 rec('⑦ 利用者ごとの合計に切り替えられる（使った端末・累計接続回数）',
   users.head.includes('使った端末')&&users.rows.length===1&&/u1/.test(users.rows[0])&&/2台/.test(users.rows[0]),
   JSON.stringify(users.rows));
 const copied=await page.evaluate(async()=>{
  const box={got:''};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:t=>{box.got=t;return Promise.resolve()}}});
  document.getElementById('pzCopy').click();
  for(let i=0;i<20&&!box.got;i++)await new Promise(r=>setTimeout(r,50));
  return box.got;
 });
 rec('⑦ 表をコピーすると、見えている表のまま（見出し＋絞った行・タブ区切り）',
   copied.split('\n').length===2&&/^版の状態\tログインID\t使った端末/.test(copied),copied.slice(0,80));
 await page.click('[data-pz-by="terminals"]');
 await page.click('#pzOnlyOld');

}, {viewport:{width:1600,height:1000}});
