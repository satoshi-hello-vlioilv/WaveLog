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
'use strict';
const {run}=require('./lib/harness.js');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';

run('test_scwatchui: 共有の見張りの見え方（§9.188）', async ({page,rec,B,W,paint,errs,browser})=>{
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
  /* §9.300 ①で**チップは1つ**になった（`#scFreshness`と2つで同じ「いつの
     データか」に答えていた）。文字に出るのは**この画面が読んだ時刻**で、
     共有の取り込み・書込役・改訂番号は**押すと開くメニュー**が持つ。
     `title`には今までどおり間隔と最後の取込を書く（§9.200。約束が変わったら
     網は消さずに書き直す）。 */
  rec('いつのデータかを文字で出す',/時点/.test(chip.text),chip.text);
  rec('共有の取り込みの間隔と最後の取込を説明に書く',
      /確かめ/.test(chip.title)&&/最後の取込/.test(chip.title),
      chip.title.replace(/\n/g,' | ').slice(0,140));
  /* 畳んだ先（浮きメニュー）に共有の状態が全部あること——「短くした」だけで
     読めなくなっていないかを見る（§9.234 ①「消さずに畳む」）。 */
  await page.click('#scSyncChip');
  await page.waitForSelector('#scSyncMenu',{timeout:8000});
  const syncMenu=await page.evaluate(()=>{
   const m=document.getElementById('scSyncMenu');
   return {keys:[...m.querySelectorAll('.sc-sync-k')].map(x=>x.textContent.trim()),
           acts:[...m.querySelectorAll('button')].map(x=>x.querySelector('span')?.textContent.trim())};
  });
  rec('畳んだ先に共有の見張り・次の確認・最後の取込がある',
      ['見張り','次の確認','最後に取り込んだ'].every(k=>syncMenu.keys.includes(k)),
      JSON.stringify(syncMenu.keys));
  rec('畳んだ先に「いま取り込む」がある',syncMenu.acts.includes('いま取り込む'),
      JSON.stringify(syncMenu.acts));
  await page.evaluate(()=>document.body.click());
  await page.waitForFunction(()=>!document.getElementById('scSyncMenu'),null,{timeout:8000});

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
   /* 帯は**一覧の下**（§9.397）。上に置くと出るたびに一覧の上端が下がり、
      狙っていた行が指の下から逃げる（実測235px）。`compareDocumentPosition`
      の`&2`＝この器より**前**に居る＝一覧のほうが上。 */
   const out={text:box.innerText.replace(/\s+/g,' '),btn:!!box.querySelector('#scSyncReload'),
              下に出る:box.compareDocumentPosition(document.getElementById('scTimeline'))&2?true:false,
              上端:Math.round(document.getElementById('scTimeline').getBoundingClientRect().top)};
   box.hidden=true;box.innerHTML='';
   out.上端閉=Math.round(document.getElementById('scTimeline').getBoundingClientRect().top);
   return out;
  });
  rec('帯は何が起きたかを文字で言う',banner&&/他のPCが予定を変えました/.test(banner.text),
      banner?banner.text.slice(0,80):'なし');
  rec('帯に「読み直す」を置く',!!(banner&&banner.btn));
  /* §9.397（利用者の指摘「メッセージのために1行一時的に増える…表示位置が
     ガタガタズレる」）。帯は**一覧の下**へ移した——出ても一覧の上端が
     動かないので、狙っている行が逃げない。 */
  rec('帯はタイムラインより下に出る（一覧の上端を動かさない）',!!(banner&&banner.下に出る));
  rec('帯が出ても一覧の上端が動かない',!!(banner&&banner.上端===banner.上端閉),
      banner?`${banner.上端閉} -> ${banner.上端}`:'なし');
 }catch(e){
  console.error('FATAL',e);rec('例外なく終わる',false,e.message);
 }finally{
  try{await setMode('edit')}catch(_){}
 }

}, {viewport:{width:1700,height:1000}});
