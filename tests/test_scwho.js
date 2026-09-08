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

   **§9.291 ③で「止める役」をやめた**（利用者との確認「書き込みの主導権は
   最初のユーザーにして、依頼を受けて編集権を持つものが代理で書き込む形と
   いう意味では READONLY である必要はない」）。データの整合は
   ①書く役を1台に絞る（§9.192）②ロック→取り直し→適用→改訂番号（§4.2）
   ③並べ替えは顔ぶれの一致を要求＋土台の並びを突き合わせる（§9.291 ③）
   の3枚が守っており、READONLYが防いでいたのは人の意図の衝突だけだった。

   なので**両方を見る**——`schedule_session_block`が
    ・`off`（**既定**）… 主担当は文字で出るが**操作は止まらない**
    ・`on`            … 今までどおり読み取り専用（下の1〜5はこちら）

   ここで固定すること:
    1. 自分が編集権を持っているとき、タイトル帯に「編集中／自分」と**文字で**出る
    2. 他端末が持っているとき「読み取り専用」と**誰が**を文字で出し、
       **奪うボタン**が同じ場所に出る（`on`のとき）
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
 /* 編集セッションで操作を止めるか（§9.291 ③）。**既定は`off`＝止めない**ので、
    今までどおりの読み取り専用を確かめるところだけ`on`にする。
    **必ず`finally`で戻すこと**——パス設定マスタは実行をまたいで残る（§9.121）。 */
 const setSessionBlock=async v=>{
  /* **送るのはこの1つだけ**——`/api/path-config-master`は「送られてきた項目
     だけを書く」（§9.212 ②と同じ作法）ので、丸ごと送り返すと他の欄の検証で
     落ちて**1つも保存されない**（実際に踏んだ）。 */
  /* **パス設定マスタの保存はeditモードだけ**（書込ガード）。この節は
     scheduleモードで走るので、**保存の間だけeditへ寄せて必ず戻す**。 */
  const r=await page.evaluate(async val=>{
   const cur=await (await fetch('/api/access-mode')).json().catch(()=>({}));
   const was=String(cur.mode||'edit');
   const setM=async m=>fetch('/api/access-mode',{method:'POST',
     headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})});
   if(was!=='edit')await setM('edit');
   const res=await fetch('/api/path-config-master',{method:'POST',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({schedule_session_block:val,user_id:'tests'})});
   const out={st:res.status,body:await res.json().catch(()=>({})),was};
   if(was!=='edit')await setM(was);
   return out;
  },v);
  if(r.st!==200)console.log('[setSessionBlock]',v,JSON.stringify(r).slice(0,200));
  return r;
 };
 const who=()=>page.evaluate(()=>{
  const el=document.getElementById('scWho');
  const panel=document.getElementById('schedulePanel');
  if(!el)return{無い:true};
  const r=el.getBoundingClientRect();
  return{見える:!el.hidden&&r.width>0,cls:el.className,
    文:(el.textContent||'').trim(),title:el.title||'',
    奪うボタン:!!el.querySelector('#scWhoTake'),
    帯の中:!!document.querySelector('.hd-context')?.contains(el),
    操作列の中:!!document.getElementById('headerViewBar')?.contains(el),
    操作列の行数:(()=>{const h=document.getElementById('scHead');if(!h)return null;
      const r=h.getBoundingClientRect(),k=h.firstElementChild;
      return k?Math.round(r.height/Math.max(1,k.getBoundingClientRect().height)):null})(),
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
  /* 置き場は**タイトル帯**（§9.211 ③、利用者の指示「作業スケジュールの
     タイトル帯の空白エリアを利用してください」）。操作列(#scHead)には
     別の指示「上部メニューバーは1行で収まるように」(§9.199)が掛かって
     おり、実測で余りは92pxしか無い——150pxのチップを置いたため、
     **書込中の印が出た瞬間だけ2行へ折り返して表全体が38px跳ねていた**。 */
  rec('置き場はタイトル帯（画面名の隣の空き）',mine.帯の中===true,String(mine.帯の中));
  rec('操作列には置かない（1行で収まらなくなる）',mine.操作列の中===false,String(mine.操作列の中));
  /* **書込中の印と同時に出しても1行のまま**であること。ここが2行になると
     表全体が1行ぶん跳ね、掴もうとした行が逃げる（実測38px）。
     印の文字は**現場にありそうな長さ**で測る——この端末のログインIDは空で
     「書込中: ?@vm」と短く、そのまま測ると入って当たり前になる。
     **チップを操作列へ戻すと2行になること**まで見る（この網が効いている
     ことの確認。片方だけだと、器が広い画面では何も確かめないまま通る）。 */
  const oneLine=await page.evaluate(()=>{
   const badge=document.getElementById('scLockBadge');
   const head=document.getElementById('scHead');
   const who=document.getElementById('scWho');
   const left=document.querySelector('.sc-head-left');
   if(!badge||!head||!who||!left)return null;
   const hid=badge.hidden,html=badge.innerHTML;
   badge.hidden=false;badge.textContent='書込中: yamada@SLIT-PC1';
   const 帯へ置いたまま=Math.round(head.getBoundingClientRect().height);
   /* 同じ条件で操作列へ戻してみる（すぐ戻す）。 */
   const home=who.parentNode,next=who.nextSibling;
   left.appendChild(who);
   const 操作列へ戻すと=Math.round(head.getBoundingClientRect().height);
   home.insertBefore(who,next);
   badge.hidden=hid;badge.innerHTML=html;
   return {帯へ置いたまま,操作列へ戻すと};
  });
  rec('書込中の印が出ても操作列は1行のまま（表が跳ねない）',
      !!oneLine&&oneLine.帯へ置いたまま<=36,JSON.stringify(oneLine));
  rec('この網は効いている（操作列へ戻すと2行になる）',
      !!oneLine&&oneLine.操作列へ戻すと>oneLine.帯へ置いたまま,JSON.stringify(oneLine));
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
  /* ---- 2a) **既定（止めない）では読み取り専用にならない**（§9.291 ③） ---- */
  await page.waitForFunction(()=>{
   const el=document.getElementById('scWho');
   return el&&/主担当/.test(el.textContent||'');
  },null,{timeout:20000}).catch(()=>{});
  const advisory=await who();
  const advOps=await page.evaluate(()=>({
   書ける:WL.scheduleView.sessionBlocked()===false,
   掴める:[...document.querySelectorAll('.sc-row-line')]
      .some(r=>r.getAttribute('draggable')==='true'),
  }));
  rec('既定では「読み取り専用」と出さない（主担当を名乗るだけ）',
      /主担当/.test(advisory.文)&&!/読み取り専用/.test(advisory.文),JSON.stringify(advisory.文));
  rec('既定では誰が主担当かは文字で出る',
      advisory.文.includes(OTHER.login)&&advisory.文.includes(OTHER.pc),advisory.文);
  rec('既定では書く操作が止まらない（並べ替え・作業開始ができる）',
      advOps.書ける===true&&advOps.掴める===true,JSON.stringify(advOps));
  rec('既定では読み取り専用の印を付けない',advisory.ロック===false,String(advisory.ロック));

  /* ---- 2b) `on`にすると今までどおり読み取り専用（1〜5はこちら） ---- */
  await setSessionBlock('on');
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
   /* **読むための操作**（帳票・詳細）と**書く操作**（固定・外す・開始）を
      分けて見る。以前は `.sc-row-report,.sc-row-detail,.sc-row-btn` と
      書いており、①`.sc-row-detail`というクラスは無く（正しくは
      `.sc-row-detail-toggle`）、②`.sc-row-btn`は全ボタンに付くので、
      **行の最初のボタン＝「死んでいて正しい」書く操作**を掴んでいた。
      通っていたのは、たまたま帳票が先に並んでいた回だけ（§9.362 ⑧）。 */
   const read=row.querySelector('.sc-row-report,.sc-row-detail-toggle');
   const write=[...row.querySelectorAll('.sc-row-lock,.sc-row-delete,.sc-row-start')];
   return{行のpe:cs.pointerEvents,行の濃さ:cs.opacity,cls:row.className,
     読む操作:read?read.className.replace('sc-row-btn ','')+':'+getComputedStyle(read).pointerEvents:'(無し)',
     書く操作:write.map(x=>x.className.replace('sc-row-btn ','')+':'+getComputedStyle(x).pointerEvents)};
  });
  /* **読む操作が実在すること**まで見る（無ければ素通りする網は、直す前でも
     通ってしまう）。書く操作が死んでいることは下でまとめて見る。 */
  rec('読み取り専用でも行そのものは押せる（読むための操作は残る）',
      rowAlive.行のpe!=='none'&&/:auto$/.test(rowAlive.読む操作||''),JSON.stringify(rowAlive));
  rec('読み取り専用では書く操作だけが止まる（読む操作と取り違えない）',
      (rowAlive.書く操作||[]).length>0&&(rowAlive.書く操作||[]).every(x=>/:none$/.test(x)),
      JSON.stringify(rowAlive.書く操作));
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

  /* ---- 3b) 読み取り専用でも「まだできること」の見た目は残す ----
     着手中の行は読み取り専用でもダブルクリックで測定を再開できる
     （`canResume`は`sessionBlocked()`を見ない＝測定は予定の編集ではない）。
     `.sc-panel.sc-session-locked .sc-row-line{cursor:default}`と一律に書くと
     **できるのにできなさそうに見える**ので、除外できているかを見る。 */
  /* **検証用データに着手中の行があるとは限らない**ので、印を自分で付けて
     確かめる（見たいのはCSSの詳細度＝`:not(.sc-row-resumable)`が効いているか
     の1点で、行がどう生まれたかではない）。無ければ素通りする書き方だと、
     除外を外しても通ってしまう＝網にならない。 */
  const resumable=await page.evaluate(()=>{
   const row=document.querySelector('.sc-row-line');
   if(!row)return{無い:true};
   const had=row.classList.contains('sc-row-resumable');
   if(!had)row.classList.add('sc-row-resumable');
   const cs=getComputedStyle(row);
   const out={cursor:cs.cursor,pe:cs.pointerEvents,
              ロック中:!!document.getElementById('schedulePanel')
                         ?.classList.contains('sc-session-locked')};
   if(!had)row.classList.remove('sc-row-resumable');
   return out;
  });
  rec('読み取り専用でも再開できる行は押せる見た目のまま',
      !resumable.無い&&resumable.ロック中===true
      &&resumable.cursor==='pointer'&&resumable.pe!=='none',
      JSON.stringify(resumable));

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

  /* ---- 6) 相手が抜けたら、待たずに編集権へ戻る（§9.211 ②） ----
     利用者の指示「抜けているのに残っていて編集権が映らないのも困る」。
     在席の巡回（10秒）で「誰も持っていない」と分かった時点で、いま信じて
     いる状態を捨てて取りに行く。**ハートビート（25秒）を待たない**
     ——待つと、空いているのに最大25秒READONLYのままになる。 */
  holdAsOther();
  await page.evaluate(()=>WL.scheduleView.refreshSession());
  await page.waitForFunction(()=>/読み取り専用/.test(
    (document.getElementById('scWho')||{}).textContent||''),null,{timeout:20000}).catch(()=>{});
  const beforeLeave=await who();
  rec('（前提）もう一度、他端末が持っている状態にできる',
      /読み取り専用/.test(beforeLeave.文),beforeLeave.文);
  clearSession();                       // 相手が抜けた（解放／TTL切れ）
  await page.evaluate(()=>WL.scheduleView.refreshSession());
  await page.waitForFunction(()=>{
   const t=(document.getElementById('scWho')||{}).textContent||'';
   return /編集中/.test(t)&&!/読み取り専用/.test(t);
  },null,{timeout:20000}).catch(()=>{});
  const afterLeave=await who();
  rec('相手が抜けたら読み取り専用のまま留まらない',
      !/読み取り専用/.test(afterLeave.文),afterLeave.文);
  rec('抜けたあとは自分が編集権を持ち直す',
      /編集中/.test(afterLeave.文)&&afterLeave.ロック===false,JSON.stringify(afterLeave));
  rec('持ち直した結果は共有の在席ファイルにも入る',
      !!(readSessions()[EQ]||{}).pc,JSON.stringify(readSessions()[EQ]||{}));


  /* ---- 6) 閲覧モードへ移ったら編集権を本当に返す（幽霊の持ち主を残さない） ----
     `switchAccessMode()`は**先にサーバーのモードを変えてから**画面を開き直す
     ので、解放は**切り替えた後のモード**で評価される。解放がそのモードで
     403になると、本人は読み取り専用の画面に居るのに、他の端末からは
     TTL（90秒）のあいだ「その端末が編集中」と見え続ける
     ——利用者の言う「抜けているのに残っていて編集権が映らない」そのもの。
     ここまでで奪って自分が持ち主になっているので、その状態から移る。 */
  const heldBefore=readSessions()[EQ]||null;
  await setMode('view');
  await page.evaluate(()=>{window.accessMode.mode='view';window.accessMode.canEdit=false;
                           window.accessMode.canSchedule=false});
  /* `refreshOpenViewsForMode()`が実際に呼ぶのと同じ入口を通す。 */
  await page.evaluate(()=>window.openScheduleView&&window.openScheduleView());
  /* 解放は応答を待たない（sendBeacon）ので、共有側から消えるまで待つ。 */
  let gone=false;
  for(let i=0;i<20;i++){
   if(!readSessions()[EQ]){gone=true;break}
   await page.waitForTimeout(250);
  }
  rec('編集権を持ったまま閲覧モードへ移ったら、その場で返す（TTLを待たせない）',
      !!heldBefore&&gone,
      `移る前=${JSON.stringify(heldBefore&&{login:heldBefore.login,pc:heldBefore.pc})} / `
      +`移った後=${JSON.stringify(readSessions()[EQ]||null)}`);

 }catch(e){rec('FATAL',false,e.message)}
 finally{
  /* **設定を戻す**（§9.121。パス設定マスタは実行をまたいで残るので、
     `on`のままにすると後続のスケジュール系が全部読み取り専用で落ちる）。 */
  try{await setSessionBlock('')}catch(e){}
  /* **掴んだまま終わらない**（§CLAUDE。残すと後続が全部「編集中です」で落ちる）。 */
  try{await page.evaluate(async e=>{await fetch('/api/schedule/session/release',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({equipment:e})})},EQ)}catch(e){}
  clearSession();
  /* **モードを戻してから終わる**（この節のテストは自分でモードを決めるが、
     戻さないと次のテストが閲覧モードで走り出す）。 */
  try{await page.evaluate(async()=>{await fetch('/api/access-mode',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'edit'})})})}catch(e){}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok).length;
 console.log(`\n${R.length-ng} PASS / ${ng} FAIL`);
 process.exit(ng?1:0);
})();
