/* test_scwho.js: 編集権の在席表示・READONLY・強制奪取（§9.211 ②）
   ------------------------------------------------------------
   利用者の指示:
    「どちらに制御権があるか明確にして、動かせないことも明示してほしい」
    「スケジュール編集者が1名になるまでは後から入った人は編集権を持たず、
     READONLYとなるように一時的に他の編集者が抜けるのを待つしかない」
    「抜けているのに残っていて編集権が映らないのも困るので、READONLYで
     読み取り、だれが入っているか表示（作業スケジュールのタイトル帯の
     空白エリアを利用してください）、かつ強制的に編集権を奪うように
     切り替える機能も実装してください」

   ここで固定すること:
    1. 自分が編集権を持っているとき、タイトル帯に「編集中／自分」と**文字で**出る
    2. 他端末が持っているとき「読み取り専用」と**誰が**を文字で出し、
       **奪うボタン**が同じ場所に出る
    3. 読み取り専用の間は書く操作が止まる（`sc-session-locked`）が、
       **読むための操作は死なない**（行が丸ごと`pointer-events:none`に
       ならない。§9.211 ②で直した罠）
    4. 奪うと自分が持ち主になり、共有の在席ファイルもそう変わる
    5. **奪うときは確認を出す**（危ない操作。§5）

   他端末は共有の`schedule.sessions.json`へ直接書いて作る——サーバーは
   素性を自分で名乗るので、HTTPからは別人になれない。
   **専用の設備名は使えない**（在席表示は「いま開いている設備」の話なので
   テスト設備Aで作る）。**finallyで必ず消すこと**——掴んだまま終わると、
   後続のスケジュール系テストが全部「編集中です」で落ちる（§CLAUDE）。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs=require('fs'),path=require('path');
const API='http://127.0.0.1:5029';
const EQ='テスト設備A';
const OTHER={login:'other_user',pc:'OTHER-PC'};

/* 在席ファイルは共有スケジュールDBと同じ場所（backend/schedule_sync.py の
   `_sessions_path()`）。作業コピーの場所はランナーが環境変数で渡す。 */
const SHARE=process.env.WAVELOG_FIXTURE_SHARE||'';
const SESSIONS=SHARE?path.join(path.dirname(SHARE),'schedule.sessions.json'):'';

function readSessions(){
 try{return JSON.parse(fs.readFileSync(SESSIONS,'utf8'))}catch(e){return {}}
}
function writeSessions(obj){fs.writeFileSync(SESSIONS,JSON.stringify(obj),'utf8')}
/* サーバーは**素の地方時**で書く（`datetime.now().isoformat()`＝タイムゾーン
   なし）。ここでUTCの`...Z`を書くと、`_prune_expired`の
   `fromisoformat(...) > datetime.now()`が aware と naive の比較になって
   **例外→期限切れ扱いで黙って消える**（在席が1件も無いことになる）。
   同じ書式で書くこと。 */
function localIso(ms){
 return new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().replace('Z','');
}
function holdAsOther(){
 const now=Date.now();
 const s=readSessions();
 s[EQ]={login:OTHER.login,pc:OTHER.pc,token:'test-token',
        acquired_at:localIso(now),expires_at:localIso(now+300000)};
 writeSessions(s);
}
function clearSession(){
 try{const s=readSessions();delete s[EQ];writeSessions(s)}catch(e){}
}

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 page.on('pageerror',e=>console.log('[pageerror]',e.message));
 const setMode=m=>page.evaluate(async mm=>{await fetch('/api/access-mode',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mm})})},m);
 const who=()=>page.evaluate(()=>{
  const el=document.getElementById('scWho');
  const panel=document.getElementById('schedulePanel');
  if(!el)return{無い:true};
  const r=el.getBoundingClientRect();
  return{見える:!el.hidden&&r.width>0,cls:el.className,
    文:(el.textContent||'').trim(),title:el.title||'',
    奪うボタン:!!el.querySelector('#scWhoTake'),
    帯の中:!!document.getElementById('headerViewBar')?.contains(el),
    ロック:!!panel&&panel.classList.contains('sc-session-locked')};
 });
 const openSchedule=async()=>{
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:30000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  await page.waitForTimeout(1500);
 };

 try{
  if(!SESSIONS){
   rec('在席ファイルの置き場が分かる（WAVELOG_FIXTURE_SHARE）',false,'環境変数が空です');
   throw Error('共有の置き場が分かりません');
  }
  clearSession();
  await page.goto(API+'/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
    localStorage.setItem('AccessMeasurementUserId','tester');
    localStorage.setItem('scLayoutPrefsV1',JSON.stringify({swap:false,open:'schedule'}))},EQ);
  await setMode('schedule');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await openSchedule();

  /* ---- 1) 自分が持っているときは「編集中／自分」 ---- */
  await page.waitForFunction(()=>{
   const el=document.getElementById('scWho');
   return el&&!el.hidden&&/編集中/.test(el.textContent||'');
  },null,{timeout:20000}).catch(()=>{});
  const mine=await who();
  rec('自分が編集権を持つと帯に「編集中」と出る',
      mine.見える===true&&/編集中/.test(mine.文),JSON.stringify(mine));
  rec('「自分」と分かる書き方になっている（誰の権利かを推測させない）',
      /自分/.test(mine.文),mine.文);
  rec('置き場はタイトル帯（ヘッダーの操作列）',mine.帯の中===true,String(mine.帯の中));
  rec('自分が持っているときは読み取り専用にしない',mine.ロック===false,String(mine.ロック));
  rec('自分が持っているときは奪うボタンを出さない（意味の無いボタンを置かない）',
      mine.奪うボタン===false,String(mine.奪うボタン));

  /* 読み取り専用にする**前**の行の見え方を控える（下の3で突き合わせる）。
     **絶対値で見ないこと**——行の濃さは区分・状態（完了・着手中・反映待ち）
     でも変わるので、その日のデータ次第で0.6にも1にもなる（通しで実行すると
     前のテストが入れた実績が残っていて実際に落ちた）。見たいのは
     「読み取り専用にしたことで死んだか」なので、**同じ行の前後**を比べる。 */
  const rowBefore=await page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');
   if(!row)return{無い:true};
   const cs=getComputedStyle(row);
   return{pe:cs.pointerEvents,opacity:cs.opacity,cls:row.className};
  });

  /* ---- 2) 他端末が持っている＝READONLY ----
     共有の在席ファイルへ**別人の行**を書き、ハートビートを1回叩いて
     423を受け取らせる（25秒待たない）。 */
  holdAsOther();
  await page.evaluate(()=>WL.scheduleView.refreshSession());
  await page.waitForFunction(()=>{
   const el=document.getElementById('scWho');
   return el&&/読み取り専用/.test(el.textContent||'');
  },null,{timeout:20000}).catch(()=>{});
  const blocked=await who();
  rec('他端末が持っていると「読み取り専用」と出る',
      /読み取り専用/.test(blocked.文),JSON.stringify(blocked));
  rec('誰が編集中かを文字で出す',
      blocked.文.includes(OTHER.login)&&blocked.文.includes(OTHER.pc),blocked.文);
  rec('同じ場所に「編集権を奪う」を置く',blocked.奪うボタン===true,String(blocked.奪うボタン));
  rec('読み取り専用の印が画面にも付く',blocked.ロック===true,String(blocked.ロック));

  /* ---- 3) 読むための操作は死なない（§9.211 ②で直した罠） ----
     以前は `.sc-row-line[draggable]{pointer-events:none}` が**全ての行**に
     当たっており（`draggable="false"`でも属性は付く）、帳票・詳細・右クリック
     まで死んで行が45%に沈んでいた。 */
  const rowAlive=await page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');
   if(!row)return{無い:true};
   const cs=getComputedStyle(row);
   const btn=row.querySelector('.sc-row-report,.sc-row-detail,.sc-row-btn');
   return{行のpe:cs.pointerEvents,行の濃さ:cs.opacity,cls:row.className,
     ボタンのpe:btn?getComputedStyle(btn).pointerEvents:'(無し)'};
  });
  rec('読み取り専用でも行そのものは押せる（読むための操作は残る）',
      rowAlive.行のpe!=='none'&&rowAlive.ボタンのpe!=='none',JSON.stringify(rowAlive));
  /* **同じ行**の濃さが読み取り専用にしたことで変わっていないこと。
     以前の`.sc-row-line[draggable]{opacity:.45}`はここで0.45へ落ちていた。 */
  rec('読み取り専用にしても行の濃さが変わらない（行ごと沈めない）',
      !rowBefore.無い&&!rowAlive.無い
      &&Math.abs(Number(rowAlive.行の濃さ||1)-Number(rowBefore.opacity||1))<0.02
      &&rowBefore.cls===rowAlive.cls,
      `前 ${rowBefore.opacity} / 後 ${rowAlive.行の濃さ}`);

  /* 書く操作は止まっていること（判定は1箇所＝`sessionBlocked()`）。 */
  const stopped=await page.evaluate(()=>({
   書けない:WL.scheduleView.sessionBlocked()===true,
   掴めない:[...document.querySelectorAll('.sc-row-line')]
      .every(r=>r.getAttribute('draggable')!=='true'),
  }));
  rec('読み取り専用の間は並べ替えられない',stopped.掴めない===true,JSON.stringify(stopped));
  rec('書けない判定は1箇所（sessionBlocked）が答える',
      stopped.書けない===true,JSON.stringify(stopped));

  /* ---- 5) 奪うときは確認を出す ---- */
  let asked=null;
  await page.click('#scWhoTake');
  await page.waitForSelector('#appConfirmModal:not([hidden])',{timeout:8000});
  asked=await page.evaluate(()=>({
   本文:(document.getElementById('appConfirmBody')||{}).textContent||'',
   確定:(document.getElementById('appConfirmOk')||{}).textContent||'',
   危険:(document.getElementById('appConfirmOk')||{}).className||''}));
  rec('奪う前に確認を出す',/取り上げ|奪/.test(asked.本文),asked.本文.slice(0,60));
  rec('確認文に相手の名前が入っている（誰から奪うのかを推測させない）',
      asked.本文.includes(OTHER.login),asked.本文.slice(0,80));
  rec('危ない操作として見せる',/danger/.test(asked.危険),asked.危険);

  /* ---- 4) 奪うと自分が持ち主になる ---- */
  await page.click('#appConfirmOk');
  await page.waitForFunction(()=>{
   const el=document.getElementById('scWho');
   return el&&/編集中/.test(el.textContent||'')&&!/読み取り専用/.test(el.textContent||'');
  },null,{timeout:20000}).catch(()=>{});
  const took=await who();
  rec('奪うと「編集中／自分」へ戻る',
      /編集中/.test(took.文)&&!/読み取り専用/.test(took.文),JSON.stringify(took));
  rec('奪ったあとは読み取り専用の印も消える',took.ロック===false,String(took.ロック));
  const file=readSessions()[EQ]||{};
  /* **「持ち主が誰か」を空文字で判定しないこと**——ログインIDを名乗れない
     端末では自分のIDが空になる（`?@vm`）。「相手ではない」で見る。 */
  rec('共有の在席ファイルも持ち主が入れ替わる',
      !!file.pc&&!(file.login===OTHER.login&&file.pc===OTHER.pc),JSON.stringify(file));
  rec('誰から奪ったかが残る（黙って入れ替えない）',
      (file.taken_from||{}).login===OTHER.login,JSON.stringify(file.taken_from));

 }catch(e){rec('FATAL',false,e.message)}
 finally{
  /* **掴んだまま終わらない**（§CLAUDE。残すと後続が全部「編集中です」で落ちる）。 */
  try{await page.evaluate(async e=>{await fetch('/api/schedule/session/release',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:e})})},EQ)}catch(e){}
  clearSession();
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})();
