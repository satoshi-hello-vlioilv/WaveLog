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

   ③④⑥は`/api/presence`を差し替えて確かめる。**実データに他の端末が居る
   保証は無い**ので、「無ければ素通り」の書き方だと直す前でも通る。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const setMode=async m=>{await fetch(B+'/api/access-mode',{method:'POST',
 headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})})};
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
let b=null;

/* 差し替える答え。**行ごとに canDisconnect を変える**ので、画面が自分で
   区分を見て決めていたら必ず食い違う。 */
const FAKE=(role,canDisc)=>({ok:true,
 items:[
  {key:'PC-ME@me',login:'me',pc:'PC-ME',role:role,mode:'edit',view:'master',at:'',idleSec:2,
   revoked:null,isMe:true,canDisconnect:false},
  {key:'PC-A@u1',login:'u1',pc:'PC-A',role:'一般ユーザー',mode:'edit',view:'schedule',at:'',idleSec:8,
   revoked:null,isMe:false,canDisconnect:canDisc},
  {key:'PC-B@u2',login:'u2',pc:'PC-B',role:'開発者',mode:'view',view:'records',at:'',idleSec:40,
   revoked:null,isMe:false,canDisconnect:false},
  {key:'PC-C@u3',login:'u3',pc:'PC-C',role:'一般ユーザー',mode:'edit',view:'list',at:'',idleSec:5,
   revoked:{by:'boss',byPc:'PC-BOSS',reason:'点検',remainingSec:240},isMe:false,canDisconnect:canDisc},
 ],
 readable:true,shared:true,source:'master',dir:'\\\\srv\\share\\presence',
 me:{login:'me',pc:'PC-ME',key:'PC-ME@me',role:role,mode:'edit'},
 can:{role:role,canView:true,canDisconnect:canDisc,canDisconnectDeveloper:role==='開発者'},
 roles:['開発者','メンテナンス者','一般ユーザー'],ttlSec:75,cooldownSec:300,revoked:null});

(async()=>{
 await setMode('edit');
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,140)));

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
 await page.click('#openMasterMaint');await page.waitForTimeout(1200);

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
 await openPresence();await page.waitForTimeout(300);
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
 await openPresence();await page.waitForTimeout(300);
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
 await openPresence();await page.waitForTimeout(300);
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
 await openPresence();await page.waitForTimeout(300);
 const scope=await page.evaluate(()=>document.querySelector('.pz-scope')?.textContent||'');
 rec('共有でなければ、そう書く（1件を「他に誰も居ない」と読ませない）',
   /この端末しか出ません/.test(scope),scope.slice(0,60));

 await b.close();b=null;
 const ng=R.filter(x=>!x.ok);
 console.log('\n=== SUMMARY ===');console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.log('FATAL:',e.message);
 try{if(b)await b.close()}catch(_){}
 process.exit(1);
});
