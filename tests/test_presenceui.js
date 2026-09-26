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

    ⑧ **古い版の端末への知らせ**（§9.515、利用者の指示「控えめな感じで邪魔にならないように」）:
       ハートビートの応答に版の知らせが載る／左メニューの版のバッジの隣に字1つ・場所を動かさない・
       面を持たない／押すと更新履歴の窓が「最新版・この端末の版・すること」を言う／
       まだ分からない（null）で消さない／再起動待ちの間と最新のときは出さない／測定画面のレールには置かない

    ⑨ **最新版の判定から開発者を除く**（§9.516）: 出どころ（「開発者の端末を除く」）・開発者の端末は
       「対象外」（理由は title）・「最新でない版だけ」に入らない

   ③④⑥⑦⑨は`/api/presence`を差し替えて確かめる。**実データに他の端末が居る
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

 // ---- ⑨ 最新版の判定から開発者を除く（§9.516） ---------------------------
 // 答えはサーバー（counted・excludedRoles）。画面は「対象外」と出どころを字で言うだけ。
 fake=JSON.parse(JSON.stringify(FAKE('メンテナンス者',true)));
 fake.fleet.excludedRoles=['開発者'];
 fake.items.push({key:'PC-DEV@dev',login:'dev',pc:'PC-DEV',role:'開発者',mode:'edit',view:'master',at:'',idleSec:3,
  version:'9.9.9',since:'2026-09-26T09:30:00',durationSec:600,outdated:false,counted:false,
  revoked:null,isMe:false,canDisconnect:false});
 fake.fleet.terminals.push({key:'PC-DEV@dev',login:'dev',pc:'PC-DEV',version:'9.9.9',online:false,outdated:false,counted:false,
  role:'開発者',sessions:2,totalSec:600,lastAt:'2026-09-25T09:00:00',firstAt:'2026-09-20T08:00:00',versions:{}});
 await openPresence();await idle();
 const dv=await page.evaluate(()=>{
  const row=[...document.querySelectorAll('#pzList .pz-row')].find(r=>r.textContent.includes('PC-DEV'));
  const tr=[...document.querySelectorAll('#pzTerms tbody tr')].find(r=>r.textContent.includes('PC-DEV'));
  const st=tr&&tr.querySelector('.pz-vst');
  return {note:document.getElementById('pzLatestNote')?.textContent||'',
   rowVer:(row&&row.querySelector('.pz-c-ver')||{}).textContent||'',
   trState:st?st.textContent:'',trWhy:st?st.title:'',trOld:!!(tr&&tr.classList.contains('is-old'))};
 });
 rec('⑨ 運用中の最新版がどの区分を除いて数えたかを字で言う（出どころ）',/開発者の端末を除く/.test(dv.note),dv.note);
 rec('⑨ 開発者の端末は「要更新」でも「最新」でもなく「対象外」と言う（接続中の表も記録の表も）',
   /対象外/.test(dv.rowVer)&&!/要更新|最新/.test(dv.rowVer)&&dv.trState==='対象外'&&!dv.trOld,JSON.stringify(dv));
 rec('⑨ なぜ対象外かは title が言う',/開発者/.test(dv.trWhy)&&/数えません/.test(dv.trWhy),dv.trWhy);
 await page.click('#pzOnlyOld');
 const devInOld=await page.evaluate(()=>[...document.querySelectorAll('#pzTerms tbody tr')].some(r=>r.textContent.includes('PC-DEV')));
 rec('⑨ 「最新でない版だけ」に開発者の端末は入らない（配る相手ではない）',!devInOld);
 await page.click('#pzOnlyOld');
 fake.fleet.latestVersion='';
 await openPresence();await idle();
 const emptyNote=await page.evaluate(()=>document.getElementById('pzLatestNote')?.textContent||'');
 rec('⑨ 開発者を除くと数える端末が無いときは、そう言う（「—」だけにしない）',
   /開発者の端末を除くと、まだ接続の記録がありません/.test(emptyNote),emptyNote);

 // ---- ⑧ 古い版の端末への知らせ（§9.515） ------------------------------
 // 本物の応答: ハートビートに版の知らせが載る（区分を問わない道）
 const hbReal=await page.evaluate(async()=>{
  const r=await fetch('/api/heartbeat?tab=t-ui515',{method:'POST'});const j=await r.json();
  await fetch('/api/heartbeat/close?tab=t-ui515',{method:'POST'});return j;
 });
 const mine=(await page.evaluate(()=>fetch('/api/build').then(r=>r.json()))).version||'';
 /* 検証用フィクスチャのこの端末は「開発者」で、記録もこの端末だけ——開発者を除くと数える端末が無く、
    知らせは「まだ無い（null）」が正しい答え（§9.516）。中身の判定は test_presence.py 10・11 が見る。 */
 rec('⑧ ハートビートの応答に版の知らせの席がある（まだ無ければ null・あれば最新版と古いか）',
   hbReal.ok===true&&!!mine&&'version' in hbReal
   &&(hbReal.version===null||(hbReal.version.myVersion===mine&&typeof hbReal.version.outdated==='boolean')),JSON.stringify(hbReal));
 // 以降はハートビートの答えを差し替える（15秒ごとの本物が、差し込んだ状態を上書きしないように）
 const hb={version:{latestVersion:'99.0.0',myVersion:mine,outdated:true}};
 await page.route('**/api/heartbeat?**',route=>route.fulfill({status:200,contentType:'application/json',
   body:JSON.stringify({ok:true,version:hb.version})}));
 const geo=()=>page.evaluate(()=>{
  const r=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};
  const badge=document.querySelector('.layout>aside .brand .build-badge');
  const mark=document.querySelector('.layout>aside .brand .ver-behind');
  const vis=mark&&!mark.hidden&&mark.getBoundingClientRect().width>0;
  const cs=vis?getComputedStyle(mark):null;
  return {brand:r(document.querySelector('.layout>aside .brand')),nav:r(document.querySelector('#nav')),
   badge:r(badge),mark:vis?r(mark):null,text:vis?mark.textContent.trim():'',title:mark?mark.title:'',
   bg:cs?cs.backgroundColor:'',border:cs?cs.borderTopWidth:'',fs:cs?parseFloat(cs.fontSize):0,
   badgeFs:parseFloat(getComputedStyle(badge).fontSize),
   railMarks:document.querySelectorAll('.action-rail .ver-behind').length};
 });
 const g0=await geo();
 await page.evaluate(v=>WL.versionNotice.apply(v),hb.version);
 const g1=await geo();
 rec('⑧ 古い版の端末では版のバッジの隣に「新しい版あり」の字が出る',
   !!g1.mark&&g1.text==='新しい版あり'&&Math.abs(g1.mark.y+g1.mark.h/2-(g1.badge.y+g1.badge.h/2))<=2,JSON.stringify(g1.mark));
 rec('⑧ 出ても場所を動かさない（左メニューの題・メニューの位置が0px）',
   g0.brand.h===g1.brand.h&&g0.nav.y===g1.nav.y,JSON.stringify([g0.brand.h,g1.brand.h,g0.nav.y,g1.nav.y]));
 rec('⑧ 控えめ: 面も縁も持たず、字はバッジより大きくしない',
   /rgba\(0, 0, 0, 0\)|transparent/.test(g1.bg)&&parseFloat(g1.border)===0&&g1.fs<=g1.badgeFs,
   JSON.stringify([g1.bg,g1.border,g1.fs,g1.badgeFs]));
 rec('⑧ 字に載らない事実（最新版・この端末の版）は title が言う',
   g1.title.includes('VER99.0.0')&&g1.title.includes('VER'+mine),g1.title);
 rec('⑧ 測定画面のレールには置かない（測っている最中に中身を押し下げない）',g1.railMarks===0,String(g1.railMarks));
 await page.evaluate(()=>WL.versionNotice.apply(null));
 rec('⑧ まだ分からない（null）で知らせを消さない',!!(await geo()).mark);
 await page.click('.layout>aside .brand .ver-behind');
 await page.waitForSelector('#changelogModal:not([hidden])');
 const sub=await page.evaluate(()=>{const e=document.getElementById('changelogSub');return {t:e.textContent,on:e.classList.contains('is-behind')}});
 rec('⑧ 押すと更新履歴の窓が「最新版・この端末の版・すること（update.bat）」を言う',
   sub.on&&sub.t.includes('VER99.0.0')&&sub.t.includes('VER'+mine)&&/update\.bat/.test(sub.t)&&/配布の担当者/.test(sub.t),sub.t);
 await page.click('#closeChangelog');
 const hideWhenRestart=await page.evaluate(()=>{
  const box=document.getElementById('restartNeeded');const was=box.hidden;
  box.hidden=false;WL.versionNotice.paint();
  const m=document.querySelector('.layout>aside .brand .ver-behind');const hidden=!m||m.hidden;
  box.hidden=was;WL.versionNotice.paint();return hidden;
 });
 rec('⑧ 再起動待ちの帯が出ている間は伏せる（同じ一手を2箇所で言わない）',hideWhenRestart);
 hb.version={latestVersion:mine,myVersion:mine,outdated:false};
 await page.evaluate(v=>WL.versionNotice.apply(v),hb.version);
 const g2=await geo();
 await page.evaluate(()=>document.querySelector('.layout>aside .build-badge').click());
 await page.waitForSelector('#changelogModal:not([hidden])');
 const sub2=await page.evaluate(()=>{const e=document.getElementById('changelogSub');return {t:e.textContent,on:e.classList.contains('is-behind')}});
 await page.click('#closeChangelog');
 rec('⑧ 最新の端末では出さない（窓の1行もふだんの言い方へ戻る）',
   !g2.mark&&!sub2.on&&!/update\.bat/.test(sub2.t),JSON.stringify([g2.text,sub2.t]));
 await page.unroute('**/api/heartbeat?**');

}, {viewport:{width:1600,height:1000}});
