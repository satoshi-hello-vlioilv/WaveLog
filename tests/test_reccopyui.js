/* test_reccopyui.js: 共通設定の「置き場」が、測定データのファイルごとの読み方と写せない理由を言う（§9.619）
   ============================================================
   利用者の指示「マスタ『測定データの保存』は削除、必要な設定は共通へ統合」。前は「測定データの保存」の図が
   「写し1本 / この端末が書く1本 / まだ写せていない1本」と**本数だけ**を言い、どの設備のファイルがなぜ写せないかは
   どこにも出ていなかった（写せないファイルの記録は一覧に入らない＝他の PC から完了が見えない元）。

   物差し（評価関数）: 共通設定 → 置き場 の「測定データ（共有）」の行を開いた**そのまま**（⋯ を押さずに）数える。
    U1. まだ写せていないファイルの設備名と理由が画面に見えている（2本中）
    U2. 写しを読むファイル・この端末が書くファイルも、設備ごとに読み方が字で出る（色だけにしない）
    U3. 「写し直す」が1つあり、押すと答えの行で描き直す（押した結果がその場で出る）
    U4. 「測定データの保存」のマスタは一覧に無い
    U5. 行の字が切れない・はみ出さない（1728×1152 と 1536×864）
   置き場の答えはこの網だけ差し替える（共有の置き場の設定は再起動が要るため。答えの中身はサーバーの網
   test_reccopyreason が見る）。WAVELOG_SHOT=<dir> で撮る。WAVELOG_PROPOSALS=<案の js> で案を当てて撮る（E の手順）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const path=require('path');
const B='http://127.0.0.1:5029';
const SHOT=process.env.WAVELOG_SHOT||'';
const PROPS=process.env.WAVELOG_PROPOSALS||'';
const REASON_J='書き手が公開している途中のため、写すのを見送りました（records.sqlite3-journal）。少し空けて写し直します';
const REASON_U='共有の元ファイルへ到達できず、写しもまだありません（records.sqlite3: [WinError 5] アクセスが拒否されました。）。60秒ごとに確かめています';
const AT=Date.now()/1000-90;
const WHY_J={kind:'busy',say:'ほかの PC が書いている途中です',act:'自動で写し直します',auto:true,hint:'',detail:REASON_J};
const WHY_U={kind:'denied',say:'共有のファイルを読む権限がありません',act:'要対応: 読む権限',auto:false,
 hint:'読み取り権限を、この PC の Windows アカウントに付けてもらってください。',detail:REASON_U};
const FILES=[
 {equipment:'LS1',path:'\\\\fs01\\wavelog\\records\\LS1\\records.sqlite3',state:'mine',reason:'',why:null,note:'',at:AT},
 {equipment:'LS4',path:'\\\\fs01\\wavelog\\records\\LS4\\records.sqlite3',state:'copied',reason:'',why:null,note:'',at:AT},
 {equipment:'LS7',path:'\\\\fs01\\wavelog\\records\\LS7\\records.sqlite3',state:'waiting',reason:REASON_J,why:WHY_J,note:'',at:AT},
 {equipment:'スリッター2',path:'\\\\fs01\\wavelog\\records\\スリッター2\\records.sqlite3',state:'waiting',reason:REASON_U,why:WHY_U,note:'',at:AT},
];
const AFTER=FILES.map(f=>f.equipment==='LS7'?Object.assign({},f,{state:'copied',reason:'',why:null,at:Date.now()/1000}):Object.assign({},f,{at:Date.now()/1000}));

run('test_reccopyui: 置き場の行が測定データのファイルごとの読み方と理由を言う（§9.619）', async ({page,rec,W,idle,setMode})=>{
 await setMode('edit');
 let recopied=0;
 await page.route('**/api/storage-layout',async route=>{
  const res=await route.fetch();const j=await res.json();
  const row=(j.items||[]).find(x=>x.key==='recordsShare');
  if(row){row.path=row.path||'\\\\fs01\\wavelog\\records';row.exists=true;row.kind='network';row.files=recopied?AFTER:FILES}
  await route.fulfill({response:res,json:j});
 });
 await page.route('**/api/measurement/records/recopy',async route=>{recopied++;
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,updated:1,files:AFTER})})});
 const shots={};
 for(const [w,h] of [[1728,1152],[1536,864]]){
  recopied=0;
  await page.setViewportSize({width:w,height:h});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  await page.click('#openMasterMaint');
  await W.until(page,()=>document.body.classList.contains('mm-mode'),null,{what:'マスタ管理が開く'});
  await idle();
  const navKeys=await page.evaluate(()=>[...document.querySelectorAll('#masterMaintNav [data-master]')].map(x=>x.dataset.master));
  if(w===1728)rec('U4. 「測定データの保存」のマスタは一覧に無い',!navKeys.includes('measStorage'),String(navKeys.length)+'件');
  await page.evaluate(()=>[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.dataset.master==='pathConfig').click());
  await idle();
  await page.evaluate(()=>{const t=[...document.querySelectorAll('.mm-tabbar.is-page .mm-tab')].find(x=>/置き場/.test(x.textContent));if(t)t.click()});
  await W.until(page,()=>!!document.querySelector('.pc-store-row[data-store-key="recordsShare"]'),null,{what:'測定データ（共有）の行'});
  await idle();
  await page.evaluate(()=>document.querySelector('.pc-store-row[data-store-key="recordsShare"]').scrollIntoView({block:'center'}));
  const measure=(list)=>page.evaluate(files=>{
   const row=document.querySelector('.pc-store-row[data-store-key="recordsShare"]');
   const box=row.closest('table')||row;
   /* 見えている字だけ（閉じた ⋯ の中・伏せた物は数えない）。 */
   const seen=[...box.querySelectorAll('*')].filter(e=>{const r=e.getBoundingClientRect(),cs=getComputedStyle(e);
    return r.width>0&&r.height>0&&cs.visibility!=='hidden'&&!e.closest('[hidden],.pc-store-more')}).map(e=>
    [...e.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('')).join('\n');
   const words={mine:/この端末が書く|この端末/,copied:/写し/,waiting:/まだ写せていない|写せていません|写せません/};
   const per=files.map(f=>{const lines=seen.split('\n').filter(l=>l.includes(f.equipment));
    return {eq:f.equipment,state:f.state,shown:lines.length>0,word:words[f.state].test(seen),
     reason:!f.why||seen.includes(f.why.say)}});
   const cut=[...box.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible'
    &&!/INPUT|SELECT|TEXTAREA/.test(e.tagName)&&e.clientWidth>0&&!e.closest('.mm-path')).map(e=>e.className||e.tagName).slice(0,5);
   const rb=box.getBoundingClientRect(),pane=document.querySelector('#masterMaintForm').getBoundingClientRect();
   return {per,cut,over:rb.right>pane.right+1,btn:!!box.querySelector('[data-pc-recopy]')};
  },list||FILES);
  if(PROPS){
   const P=require(path.resolve(PROPS));
   for(const v of P.variants){
    await page.evaluate(([css,fn,files])=>{let st=document.getElementById('propCss');if(!st){st=document.createElement('style');st.id='propCss';document.head.appendChild(st)}
     st.textContent=css;document.querySelectorAll('.prop-x').forEach(e=>e.remove());
     document.querySelectorAll('.prop-hide').forEach(e=>e.classList.remove('prop-hide'));
     (new Function('files',fn))(files)},[P.css,v.fn,FILES]);
    await idle();
    await page.evaluate(()=>document.querySelector('.pc-store-row[data-store-key="recordsShare"]').scrollIntoView({block:'center'}));
    await page.screenshot({path:path.join(SHOT||'.',`prop_${v.name}_${w}.png`)});
   }
   continue;
  }
  const m=await measure();
  const waiting=m.per.filter(x=>x.state==='waiting');
  rec(`U1. ${w}: まだ写せていないファイルの設備名と理由が見えている`,waiting.every(x=>x.shown&&x.reason),
   `${waiting.filter(x=>x.shown&&x.reason).length}/${waiting.length} `+JSON.stringify(waiting));
  rec(`U2. ${w}: 写し・この端末が書くファイルも設備ごとに字で出る`,m.per.filter(x=>x.state!=='waiting').every(x=>x.shown&&x.word),JSON.stringify(m.per));
  rec(`U5. ${w}: 行の字が切れない・はみ出さない`,!m.cut.length&&!m.over,JSON.stringify({cut:m.cut,over:m.over}));
  if (process.env.WAVELOG_SHOT) shots[w]=await page.screenshot({path:path.join(SHOT,`now_${w}.png`)});
  if(m.btn){
   await page.click('[data-pc-recopy]');
   await W.until(page,()=>{const r=document.querySelector('.pc-store-row[data-store-key="recordsShare"]');
    const t=(r.closest('table')||r).textContent;return /LS7/.test(t)&&!/書いている途中/.test(t)},null,{ms:8000,what:'写し直したあとの描き直し'}).catch(()=>{});
   const left=await page.evaluate(()=>[...document.querySelectorAll('.pc-files [data-file-eq]')].map(r=>r.dataset.fileEq));
   const okText=await page.evaluate(()=>(document.querySelector('.pc-files-ok')||{}).textContent||'');
   rec(`U3. ${w}: 「写し直す」を押すと答えの行で描き直す（写せた LS7 は読めている側へ・残りは帯に）`,
    recopied===1&&left.join(',')==='スリッター2'&&/LS7（写し）/.test(okText),JSON.stringify({recopied,left,okText}));
   if(SHOT)await page.screenshot({path:path.join(SHOT,`after_recopy_${w}.png`)});
  }else rec(`U3. ${w}: 「写し直す」が1つある`,false,'ボタンが無い');
 }
},{viewport:{width:1728,height:1152}});
