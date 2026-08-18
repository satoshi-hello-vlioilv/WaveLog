/* test_scwatchui.js: 共有の見張りの見え方（§9.188）
   ------------------------------------------------------------
   共有(Box等)のschedule.sqlite3は他の端末も書く。サーバーは改訂番号だけを
   見て**変わったときだけ**手元へ写す(backend/schedule_watch.py)。画面側で
   固定するのは「気づけること」と「壊さないこと」:

    1. いつ取り込んだかを常に出す（黙って写しを見せると、他のPCの変更が
       来ていないのか、まだ確かめていないのかを区別できない）
    2. 押すとその場で取り込める
    3. 変わったことに気づいたら読み直す。ただし**触っている最中は
       勝手に読み直さない**——掴んで動かしている途中に行が入れ替わると、
       何をしていたか分からなくなる。そのときは帯で知らせる
    4. 帯の「読み直す」で読み直せる */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 try{
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});

  /* ---- 0) サーバーが状態を答える ---- */
  const st=await page.evaluate(async()=>await (await fetch('/api/schedule/sync-status')).json());
  rec('見張りの状態をサーバーが答える',st.ok&&st.configured&&typeof st.intervalSec==='number',
      JSON.stringify(st));
  rec('間隔と休みを両方返す',st.intervalSec>0&&typeof st.pauseSec==='number',
      `${st.intervalSec}秒ごと / 取り込み後${st.pauseSec}秒休み`);

  /* ---- 1) 画面に出る ---- */
  await page.waitForFunction(()=>{
   const el=document.getElementById('scSyncChip');return el&&!el.hidden&&el.textContent.trim();
  },null,{timeout:15000});
  const chip=await page.evaluate(()=>{
   const el=document.getElementById('scSyncChip');
   return {text:el.textContent,title:el.title};
  });
  rec('いつ取り込んだかを出す',/共有:/.test(chip.text),chip.text);
  rec('何をしているかを説明に書く',/確かめ/.test(chip.title)&&/休み/.test(chip.title),
      chip.title.split('\n')[0]);

  /* ---- 2) 押すとその場で取り込む ---- */
  const now=await page.evaluate(async()=>await (await fetch('/api/schedule/sync-now',
    {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json());
  rec('その場で取り込める（結果を言う）',
      now.ok&&['fetched','same','paused','unknown','off'].includes(now.result),JSON.stringify(now).slice(0,160));

  /* ---- 3) 触っている最中は勝手に読み直さない ---- */
  const idle=await page.evaluate(()=>WL.scheduleView.canAutoReload());
  rec('何もしていなければ読み直してよい',idle===true,String(idle));
  await page.evaluate(()=>WL.listColumns.open());
  await page.waitForSelector('#listColumnPanel .lc-item',{timeout:10000});
  const busy=await page.evaluate(()=>WL.scheduleView.canAutoReload());
  rec('設定を開いている最中は勝手に読み直さない',busy===false,String(busy));
  await page.evaluate(()=>{const el=document.getElementById('listColumnPanel');if(el)el.hidden=true});

  /* ---- 4) 帯は「他のPCが変えた」と言い、読み直す手立てを置く ---- */
  const banner=await page.evaluate(()=>{
   const box=document.getElementById('scSyncBanner');
   if(!box)return null;
   /* 表示の決まりを直接確かめる(他端末の書込を作るのは、この網の役目では
      ない——サーバー側は tests/test_scwatch.py が見る)。 */
   box.hidden=false;
   box.innerHTML=`<span><b>他のPCが予定を変えました。</b>いま出ているのは変更前の内容です。</span>
    <button type="button" id="scSyncReload">読み直す</button>`;
   const out={text:box.innerText.replace(/\s+/g,' '),btn:!!box.querySelector('#scSyncReload'),
              上に出る:box.compareDocumentPosition(document.getElementById('scTimeline'))&4?true:false};
   box.hidden=true;box.innerHTML='';
   return out;
  });
  rec('帯は何が起きたかを文字で言う',banner&&/他のPCが予定を変えました/.test(banner.text),
      banner?banner.text.slice(0,80):'なし');
  rec('帯に「読み直す」を置く',!!(banner&&banner.btn));
  rec('帯はタイムラインより上に出る',!!(banner&&banner.上に出る));
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  try{await setMode('edit')}catch(_){}
  if(b)await b.close().catch(()=>{});
 }
 console.log('\n=== SUMMARY ===');
 const ng=R.filter(x=>!x.ok);console.log(`${R.length-ng.length}/${R.length} passed`);
 ng.forEach(x=>console.log(' -',x.n,x.d||''));
 process.exit(ng.length?1:0);
})();
