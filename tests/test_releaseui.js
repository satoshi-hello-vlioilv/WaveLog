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
 versions:[V('2.443.0','2026-10-06 09:12',16148480),V('2.442.0','2026-10-04 22:46',15204352),V('2.441.0','2026-10-02 18:03',15833088)],
 pending:true,payload:['backend','static','templates','program','README.md'],publishing:false,
 entry:{path:'\\\\srv\\share\\WaveLog\\WaveLog.exe',exists:true,seed:{master_db_path:'\\\\srv\\Records\\master.sqlite3'}},
 role:'開発者',canRelease:true};

run('test_releaseui: 推奨の更新の札と控えめな知らせ（§9.609）',async({page,rec,W,idle})=>{
 await fetch(B+'/api/access-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})});
 const shot=async n=>{if(process.env.WAVELOG_SHOT)await page.screenshot({path:require('path').join(process.env.WAVELOG_SHOT,`release-${n}.png`)})};
 let status=STATUS;
 await page.route('**/api/app/update',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(status)}));
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);await idle();
  /* ---- R2・R3・R4: 使っている画面への知らせ（ハートビートの答えを差し替える） ---- */
  await page.route('**/api/heartbeat',async r=>{
   const res=await r.fetch();const body=await res.json().catch(()=>({}));
   body.update={release:'2.442.0',recommended:true,note:'測定表の公差の図のずれを直しました',mine:'2.441.0',pending:true,setAt:'2026-10-04 22:46'};
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  const main0=await page.evaluate(()=>{const m=document.querySelector('.layout>main')||document.querySelector('main');return m?JSON.stringify(m.getBoundingClientRect()):''});
  /* ハートビートは15秒ごと（`HEARTBEAT_INTERVAL_MS`）。次の1回で答えが届く。 */
  const notice=await W.until(page,()=>!!document.querySelector('[data-update-notice]'),null,{ms:20000,what:'推奨の更新の知らせ'});
  const n=await page.evaluate(()=>{const e=document.querySelector('[data-update-notice]');if(!e)return null;
   const r=e.getBoundingClientRect(),main=document.querySelector('.layout>main')||document.querySelector('main');
   const hits=[...(main?main.querySelectorAll('button,input,select,table,.card'):[])].filter(x=>{const q=x.getBoundingClientRect();
    return q.width&&q.height&&r.left<q.right&&q.left<r.right&&r.top<q.bottom&&q.top<r.bottom&&!e.contains(x)}).length;
   return{面積:Math.round(r.width*r.height),重なり:hits,字:e.textContent.replace(/\s+/g,' ').trim(),開き直す:!!e.querySelector('[data-update-restart]')}});
  const main1=await page.evaluate(()=>{const m=document.querySelector('.layout>main')||document.querySelector('main');return m?JSON.stringify(m.getBoundingClientRect()):''});
  rec('R2. 配る版が推奨でこの PC が古いとき、知らせが出る',notice&&!!n&&/推奨/.test(n.字)&&/2\.442\.0/.test(n.字),JSON.stringify(n));
  rec('R3. 知らせは本文の部品を覆わず（重なり0）、本文の場所を動かさない',!!n&&n.重なり===0&&main0===main1,JSON.stringify({n,動いた:main0!==main1}));
  rec('R4. 知らせの中に「開き直して更新」の口がある（押す回数 1）',!!n&&n.開き直す,JSON.stringify(n));
  await shot('notice-1728');
  await page.unroute('**/api/heartbeat');

  /* ---- R1: 版の管理の画面 ---- */
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});await idle();
  await page.evaluate(()=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.includes('共通設定'));t&&t.click()});
  await idle(400,10000);
  await page.evaluate(()=>{const b=[...document.querySelectorAll('#masterMaintForm [role=tab],#masterMaintForm button')].find(x=>x.textContent.trim().startsWith('アプリの更新'));b&&b.click()});
  await page.waitForSelector('#appUpdate #auZip',{state:'attached',timeout:10000});await idle();
  const r1=await page.evaluate(()=>({口:document.querySelectorAll('#appUpdate [data-au-recommend]').length,
   札:[...document.querySelectorAll('#appUpdate .au-table tr')].map(t=>t.textContent.replace(/\s+/g,' ').trim()).filter(t=>/推奨/.test(t)).length}));
  rec('R1. 版の表で推奨の更新の札を付けられる（押す口がある）',r1.口>0,JSON.stringify(r1));
  await shot('manage-1728');
  await page.setViewportSize({width:1536,height:864});await idle();
  await shot('manage-1536');

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
  for(const u of ['**/api/app/update','**/api/heartbeat'])await page.unroute(u).catch(()=>{/* 既に外れていれば何もしない（後片付け） */});
 }
},{viewport:{width:1728,height:1152}});
