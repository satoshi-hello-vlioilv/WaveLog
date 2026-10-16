/* test_releaseui.js: 推奨の更新の札と、使っている人への控えめな知らせ（§9.609・利用者の指示）
   ------------------------------------------------------------
   利用者の言葉:「配布する版に推奨アップデートの札を付けられるようにして、そのアップデートの版が配布されたら、
   表示を邪魔しない程度に使用中ユーザーにアップデートを促す通知を出すようにしてください。アップデートの版の
   管理するUIをLotScopeのようなUIにしてほしいです。」

   物差し（直す前に測り、直した後も同じ物差しで測る）:
    R1. 版の表で、配る版に「推奨の更新」の札を付けられる（押す口がある・札が字で出る）
    R2. 配る版が推奨で、この PC がそれより古い版で動いているとき、知らせが出る（ハートビートの答えに載る）
    R3. 知らせは本文を覆わない（面積・本文の要素との重なり 0・場所を動かさない）
    R4. 知らせから更新まで: 押す回数（開き直す口が知らせの中にある）
    R5. 推奨でない・この PC が配る版と同じ・開発者の端末では知らせを出さない

   **サーバーの答えは差し替える**（共有の置き場は網に無い）。確かめるのは「答えが画面にどう出るか」。
   答えの中身（札の保存・読み方）は`tests/test_appupdate.py`が見る。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const V=(version,placedAt,bytes)=>({version,placedAt,placedBy:'tester',source:'WaveLog-main.zip',commit:'71b375c',files:188,bytes});
const STATUS={dir:'\\\\srv\\share\\WaveLog',reachable:true,why:'',local:'2.441.0',
 release:{version:'2.442.0',setAt:'2026-10-04 22:46',setBy:'tester',previous:'2.441.0'},
 versions:[V('2.443.0','2026-10-06 09:12',16148480),
  {...V('2.442.0','2026-10-04 22:46',15204352),recommend:{note:'測定表の公差の図のずれを直しました',setAt:'2026-10-04 22:50',setBy:'tester'}},
  V('2.441.0','2026-10-02 18:03',15833088)],

 pending:true,payload:['backend','static','templates','program','README.md'],publishing:false,
 entry:{path:'\\\\srv\\share\\WaveLog\\WaveLog.exe',exists:true,seed:{master_db_path:'\\\\srv\\Records\\master.sqlite3'}},
 role:'開発者',canRelease:true};

run('test_releaseui: 推奨の更新の札と控えめな知らせ（§9.609）',async({page,rec,W,idle})=>{
 await fetch(B+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 const shot=async n=>{if(process.env.WAVELOG_SHOT)await page.screenshot({path:require('path').join(process.env.WAVELOG_SHOT,`release-${n}.png`)})};
 let status=STATUS;
 await page.route('**/api/app/update',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(status)}));
 await page.route('**/api/presence/release-spread**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({spread:{behind:3,total:5}})}));
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);await idle();
  /* ---- R2・R3・R4・R5: 使っている画面への知らせ（ハートビートの答えを差し替える） ---- */
  let update={release:'2.442.0',mine:'2.441.0',note:'測定表の公差の図のずれを直しました',setAt:'2026-10-04 22:50',direction:'up'};
  await page.route('**/api/heartbeat**',async r=>{
   const res=await r.fetch();const body=await res.json().catch(()=>({}));
   body.update=update;body.version={latestVersion:'2.442.0',myVersion:'2.441.0',outdated:true};
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const restarts=[];
  await page.route('**/__desktop/restart',async r=>{restarts.push(1);await r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  const main0=await page.evaluate(()=>{const m=document.querySelector('.layout>main');return m?JSON.stringify(m.getBoundingClientRect()):''});
  const mode0=await page.evaluate(()=>JSON.stringify(document.getElementById('accessModeBadge').getBoundingClientRect().top));
  /* ハートビートは15秒ごと（`HEARTBEAT_INTERVAL_MS`）。次の1回で答えが届く。 */
  const notice=await W.until(page,()=>!document.querySelector('#updateNotice')?.hidden,null,{ms:20000,what:'推奨の更新の知らせ'});
  const n=await page.evaluate(()=>{const e=document.querySelector('[data-update-notice]');if(!e||e.hidden)return null;
   const r=e.getBoundingClientRect(),main=document.querySelector('.layout>main');
   const hits=[...(main?main.querySelectorAll('button,input,select,table,.card'):[])].filter(x=>{const q=x.getBoundingClientRect();
    return q.width&&q.height&&r.left<q.right&&q.left<r.right&&r.top<q.bottom&&q.top<r.bottom&&!e.contains(x)&&!x.closest('header')}).length;
   const vb=document.querySelector('.ver-behind');
   return{面積:Math.round(r.width*r.height),重なり:hits,字:e.textContent.replace(/\s+/g,' ').trim(),題:e.title,
    新しい版ありを伏せた:!vb||vb.hidden}});
  const main1=await page.evaluate(()=>{const m=document.querySelector('.layout>main');return m?JSON.stringify(m.getBoundingClientRect()):''});
  rec('R2. 配る版が推奨でこの PC が古いとき、ヘッダーに札が出る（版・推奨を字で・なぜは title）',
   notice&&!!n&&/推奨/.test(n.字)&&/2\.442\.0/.test(n.字)&&/公差の図/.test(n.題),JSON.stringify(n));
  rec('R3. 札は本文の部品を覆わず（重なり0）、本文の場所を動かさない（閉じた形）',!!n&&n.重なり===0&&main0===main1,JSON.stringify({n,動いた:main0!==main1}));
  rec('R3. 札が出ている間は「新しい版あり」を伏せる（同じことを2箇所で言わない）',!!n&&n.新しい版ありを伏せた,JSON.stringify(n));
  await shot('notice-1728');
  /* 押した面: なぜ・この PC→新しい版・あとで｜開き直して更新（窓の中のときだけ押せる形・網では窓の中だと言い張る） */
  await page.evaluate(()=>{WL.base.inDesktopShell=()=>true});
  await page.click('#updateNotice');
  await W.until(page,()=>!!document.querySelector('.wl-menu.update-pop'),null,{ms:5000,what:'推奨の更新の面'});
  const pop=await page.evaluate(()=>{const e=document.querySelector('.wl-menu.update-pop');const r=e.getBoundingClientRect();
   return{字:e.textContent.replace(/\s+/g,' ').trim(),開き直す:!!e.querySelector('[data-up-restart]'),あとで:!!e.querySelector('[data-up-later]'),
    中:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}});
  rec('R4. 押した面に なぜ・この PC→新しい版・あとで・開き直して更新 がそろい、画面に収まる',
   /公差の図/.test(pop.字)&&/2\.441\.0.*2\.442\.0/.test(pop.字)&&pop.開き直す&&pop.あとで&&pop.中,JSON.stringify(pop));
  await shot('open-1728');
  await page.click('.wl-menu.update-pop [data-up-restart]');
  await W.until(page,()=>!document.querySelector('.wl-menu.update-pop'),null,{ms:5000,what:'面が閉じる'});
  await W.poll(()=>restarts.length,k=>k>0,5000);   /* 窓へ開き直しを頼むまで */
  rec('R4. 「開き直して更新」は1手で窓へ頼む（/__desktop/restart）',restarts.length===1,String(restarts.length));
  /* R5: 推奨が外れた・この PC が配る版と同じ（サーバーが null を返す）→ 札を伏せる */
  update=null;
  const gone=await W.until(page,()=>document.querySelector('#updateNotice')?.hidden===true,null,{ms:20000,what:'札が消える'});
  rec('R5. 知らせの答えが無くなったら札を伏せる',gone,'');
  rec('R3. 札の出し入れでヘッダーの札の場所が動かない（モードの札の高さが同じ）',
   mode0===await page.evaluate(()=>JSON.stringify(document.getElementById('accessModeBadge').getBoundingClientRect().top)),'');
  await page.unroute('**/api/heartbeat**');await page.unroute('**/__desktop/restart');

  /* ---- R1: 版の管理の画面 ---- */
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});await idle();
  await page.evaluate(()=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes('共通設定'));t&&t.click()});
  await idle(400,10000);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintForm [role=tab],#masterMaintForm button')].find(x=>x.textContent.trim().startsWith('アプリの更新'));b&&b.click()});
  await page.waitForSelector('#appUpdate #auZip',{state:'attached',timeout:10000});await idle();
  const row=v=>page.evaluate(v=>{const t=[...document.querySelectorAll('#appUpdate .au-table tbody tr')].find(r=>r.querySelector('.au-ver').textContent===v);
   return t?{札:[...t.querySelectorAll('.au-chip')].map(c=>c.textContent),操作:[...t.querySelectorAll('.au-act button')].map(b=>b.textContent.trim())}:null},v);
  const r442=await row('2.442.0'),r443=await row('2.443.0'),r441=await row('2.441.0');
  rec('R1. 推奨の札は字で読める（配っている＋★ 推奨の更新）・配っている行で外せる（1手）',
   !!r442&&r442.札.join()==='配っている,★ 推奨の更新'&&r442.操作.join()==='推奨を外す',JSON.stringify(r442));
  rec('R1. 新しい版は「この版を配る ▾」・古い版は「この版に戻す ▾」（LotScope と同じ言い分け）',
   !!r443&&r443.操作.join()==='この版を配る,▾'&&!!r441&&r441.操作.join()==='この版に戻す,▾'&&r441.札.join()==='前に配った,この PC',JSON.stringify({r443,r441}));
  const flow=await page.evaluate(()=>[...document.querySelectorAll('#appUpdate .au-step')].map(x=>x.className.replace('au-step','').trim()+':'+x.textContent.replace(/\s+/g,' ').trim()));
  rec('R1. 流れは上の線で状態を言い（済み／決めた／待ち）、③が古い版の PC の台数を言う',
   /^is-done/.test(flow[0])&&/^is-set/.test(flow[1])&&/^is-pending/.test(flow[2])&&/古い版の PC 3台/.test(flow[2]),JSON.stringify(flow));
  for(const [w,h] of [[1728,1152],[1536,864]]){
   await page.setViewportSize({width:w,height:h});await idle();
   const cut=await page.evaluate(()=>[...document.querySelectorAll('#appUpdate td,#appUpdate .au-step>*,.mm-tab *')].filter(e=>e.children.length===0&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible').map(e=>e.textContent.trim().slice(0,20)));
   rec(`R1. ${w}px で版の表・流れ・段の名前が切れない`,cut.length===0,JSON.stringify(cut));
   await shot(`manage-${w}`);
  }
  /* ▾ で「推奨の更新として配る」: 一言を聞いて、配る版を決めてから札を付ける（2つの口を順に） */
  const sent=[];
  await page.route('**/api/app/update/release',async r=>{sent.push(['release',JSON.parse(r.request().postData()||'{}')]);await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,version:'2.443.0',notes:[]})})});
  await page.route('**/api/app/update/recommend',async r=>{sent.push(['recommend',JSON.parse(r.request().postData()||'{}')]);await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})})});
  await page.click('#appUpdate tr:first-child [data-au-more]');
  await W.until(page,()=>!!document.querySelector('.wl-menu.au-menu'),null,{ms:5000,what:'配り方の面'});
  await shot('menu-1536');
  await page.click('.wl-menu.au-menu [data-au-pick="rec"]');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:5000});
  await page.fill('#appPromptInput','公差の図のずれを直しました');
  await page.click('#appConfirmOk');
  await W.poll(()=>sent.length,k=>k>=2,5000);   /* 配る→札を付ける まで */
  rec('R1. 「推奨の更新として配る」は配る版を決めてから札を付ける（一言つき）',
   JSON.stringify(sent)===JSON.stringify([['release',{version:'2.443.0'}],['recommend',{version:'2.443.0',on:true,note:'公差の図のずれを直しました'}]]),JSON.stringify(sent));
  await page.unroute('**/api/app/update/release');await page.unroute('**/api/app/update/recommend');

  /* 案を実画面に当てて撮る（`WAVELOG_PROPOSALS=<案の定義.js>` と `WAVELOG_SHOT` を付けたときだけ・§9.597 の E の手順）。
     案の定義は manage(st)＝#appUpdate の中身・notice(n)＝使っている画面へ足す知らせ・css。 */
  if(process.env.WAVELOG_PROPOSALS&&process.env.WAVELOG_SHOT){
   const props=require(process.env.WAVELOG_PROPOSALS);
   const st={...STATUS,recommended:{'2.442.0':true},note:'測定表の公差の図のずれを直しました'};
   const nv={release:'2.442.0',mine:'2.441.0',note:'測定表の公差の図のずれを直しました'};
   for(const p of props){
    for(const [w,h] of [[1728,1152],[1536,864]]){
     await page.setViewportSize({width:w,height:h});await idle();
     await page.evaluate(([css,fn,st])=>{let t=document.getElementById('pxStyle');if(!t){t=document.createElement('style');t.id='pxStyle';document.head.appendChild(t)}
      t.textContent=css;document.getElementById('appUpdate').innerHTML=(new Function('return '+fn))()(st)},[p.css,p.manage,st]);
     await idle();
     await shot(`${p.key}-manage-${w}`);
    }
   }
   for(const p of props){
    for(const [w,h] of [[1728,1152],[1536,864]]){
     await page.setViewportSize({width:w,height:h});
     await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);await idle();
     await page.evaluate(([css,fn,n])=>{const t=document.createElement('style');t.textContent=css;document.head.appendChild(t);(new Function('return '+fn))()(n)},[p.css,p.notice,nv]);
     await idle();
     await shot(`${p.key}-notice-${w}`);
     if(p.open&&p.open.trim()){   /* 札を押して面を開いた形（閉じた形とは別に撮る） */
      await page.evaluate(([fn,n])=>(new Function('return '+fn))()(n),[p.open,nv]);await idle();
      await shot(`${p.key}-open-${w}`);
     }
    }
   }
  }
 }finally{
  for(const u of ['**/api/app/update','**/api/presence/release-spread**','**/api/heartbeat**','**/__desktop/restart','**/api/app/update/release','**/api/app/update/recommend'])await page.unroute(u).catch(()=>{/* 既に外れていれば何もしない（後片付け） */});
 }
},{viewport:{width:1728,height:1152}});
