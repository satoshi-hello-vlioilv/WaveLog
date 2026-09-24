/* 仕掛一覧/品質データの切替高速化(§9.46)の検証:
   画面を戻したときに /api/table を叩き直さない・鮮度表示・再読込での強制取得 */
/* 待ちは「時間」ではなく「条件」（§9.102・3-15 ③・§9.347）。骨組み
   （起動・rec・pageerror・素のダイアログ・集計・閉じる）は tests/lib/harness.js。
   置き換え前後で全PASS行（測った値ごと）を突き合わせてある。 */
const {run}=require('./lib/harness.js');
run('test_listcache: 一覧の写しと鮮度・再読込',async({page,rec,W,idle,paint})=>{

 // API呼び出しを数える(体感速度の正体は往復回数。ローカルSSDの実時間は当てにしない)
 const calls=[];
 page.on('request',r=>{const u=r.url();if(u.includes('/api/table?'))calls.push('table');
   else if(u.includes('/api/tables?'))calls.push('tables')});
 const since=()=>{const n=calls.length;return ()=>calls.slice(n)};
 /* 写し直しの頼み方（§9.463）。本文を控えて`force`／`wait`を見る。 */
 const mirrorPosts=[];
 page.on('request',r=>{if(r.url().includes('/api/db-mirror/refresh')){
  try{mirrorPosts.push(JSON.parse(r.postData()||'{}'))}catch(e){mirrorPosts.push({})}}});

 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-db-key="SIKALOTNOW"]',{timeout:15000});
 await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
 rec('起動時に仕掛一覧が表示される',true,'初期の取得 '+calls.length+'回');

 // --- 1. 品質データへ切り替えて仕掛へ戻す ---
 let mark=since();
 await page.click('[data-db-key="SIKALOTDEF"]');
 await idle();
 const toDef=mark();
 rec('品質データへの初回切替では取得が発生する',toDef.filter(x=>x==='table').length>=1,JSON.stringify(toDef));

 mark=since();
 await page.click('[data-db-key="SIKALOTNOW"]');
 await idle();
 const backNow=mark();
 rec('仕掛一覧へ戻るときは再取得しない(/api/table 0回)',
   backNow.filter(x=>x==='table').length===0,JSON.stringify(backNow));
 rec('テーブル構成(/api/tables)も再取得しない',
   backNow.filter(x=>x==='tables').length===0,JSON.stringify(backNow));

 mark=since();
 await page.click('[data-db-key="SIKALOTDEF"]');
 await idle();
 const backDef=mark();
 rec('品質データへ戻るときも再取得しない',backDef.length===0,JSON.stringify(backDef));

 /* --- 2. いま見ているのがいつのデータかを必ず出す（§9.286 ④） ---
    以前は**この端末の写しの古さ**を、キャッシュから描いたときだけ出して
    いた（取り立てのときは何も出ない＝元データの時刻はどこにも無い）。
    いまは**元データの更新時刻**を常に出し、写しの話は`title`へ落とす。 */
 const fresh=await page.evaluate(()=>{const e=document.querySelector('#listFreshness');
   return {hidden:e?.hidden,text:(e?.textContent||'').trim(),title:e?.title||''}});
 rec('いつのデータかが一覧の上に常に出ている',
   fresh.hidden===false&&/元データ/.test(fresh.text),JSON.stringify(fresh));
 rec('写しから描いていることは説明で読める',
   /読み込んだ内容です|元データの/.test(fresh.title),fresh.title.slice(0,80));

 // --- 3. 再読込は必ずサーバーへ取りに行き、鮮度表示を消す ---
 // 「再読込」は読み直し方を選ばせるポップオーバーになった(§9.78)。
 // 単に取り直すのは、その中の「一覧を再読込」。
 mark=since();
 await page.click('#listFreshness');
 await page.waitForSelector('#reloadMenu [data-reload-action="list"]',{timeout:5000});
 await page.click('#reloadMenu [data-reload-action="list"]');
 await idle();
 const reloaded=mark();
 rec('「再読込」は必ずサーバーから取り直す',
   reloaded.filter(x=>x==='table').length>=1,JSON.stringify(reloaded));
 /* 取り直しても**消さない**——消すと「元データがいつのものか」が読めなく
    なる（それがこの改良の目的）。消えるのは「画面の写しは◯分前」の一行だけ。 */
 const fresh2=await page.evaluate(()=>{const e=document.querySelector('#listFreshness');
   return {hidden:e?.hidden,title:e?.title||''}});
 rec('取り直しても元データの時刻は出たまま',fresh2.hidden===false,JSON.stringify(fresh2));
 rec('取り立てのときは「画面の写しは◯前」を言わない',
   !/画面に出ているのは/.test(fresh2.title),fresh2.title.slice(0,80));
 /* §9.463（利用者の報告「再読み込み押しても任意に取りに行った感じがなく最新版化
    されません。行ったのであれば動き(反応)が欲しい」）。**必ず写し直し**（`force`）、
    **結果を字で返す**（写した／最新だった／写せなかった）。 */
 rec('「再読込」は共有から必ず写し直す（force・待って結果を受け取る）',
   mirrorPosts.some(b=>b.force===true&&b.wait===true),JSON.stringify(mirrorPosts));
 const toast=await page.evaluate(()=>[...document.querySelectorAll('#toastArea .toast')].map(t=>t.textContent).join(' | '));
 rec('取り込み直した結果を字で返す（元データの時刻つき）',
   /元データ|一覧を読み直しました/.test(toast),toast.slice(0,160));

 /* --- 3.5 読み込みの秒数は「遅いときだけ」出す（§9.340、REVIEW 4-1 ④） ---
    作業スケジュールは§9.198で既にそうしていたのに、一覧だけ**常に出して**
    いた（「0.2秒」が全画面でずっと居座る）。
    **「速いときに消える」と「遅いときに出る」の両方を見る**——片方だけの網は、
    常に出す実装（＝直す前）も、二度と出ない実装も通してしまう。
    遅い側は**応答をわざと遅らせて**作る（§9.312。数を書き換えて作った
    「遅いことにした状態」では、本当に出るかを一度も通らない）。 */
 const chip=()=>page.evaluate(()=>{const e=document.querySelector('#listLoadChip');
   return {ある:!!e,出ている:!!e&&!e.hidden,字:(e?.textContent||'').trim()}});
 const fast=await chip();
 rec('速い読み込みでは秒数のチップを出さない',fast.ある&&!fast.出ている,JSON.stringify(fast));
 /* 内訳の入口は**チップが消えていても**残っている（§4）。速いときは
    再読込メニューが唯一の道——チップと一緒に入口ごと消さない。 */
 await page.click('#listFreshness');
 await page.waitForSelector('#reloadMenu',{timeout:5000});
 const note=await page.evaluate(()=>{
   const n=document.querySelector('#reloadMenu .reload-menu-note');
   return {ある:!!n,字:(n?.textContent||'').replace(/\s+/g,' ').slice(0,90)}});
 rec('チップが出ていなくても再読込メニューから内訳を読める',
   note.ある&&/読み込み/.test(note.字),JSON.stringify(note));
 await page.evaluate(()=>document.getElementById('reloadMenu')?.remove());
 // 「遅い」の答えは1箇所（§9.163）。網が数を書き写すと、直したとき網だけ古くなる。
 const slowMs=await page.evaluate(()=>window.WL&&WL.slowLoadMs);
 rec('「遅い」の答えが1箇所にある（WL.slowLoadMs）',
   typeof slowMs==='number'&&slowMs>0,String(slowMs));
 // 応答を しきい値+600ms 遅らせて取り直す
 const delay=(Number(slowMs)||1200)+600;
 await page.route('**/api/table*',async r=>{
   await new Promise(s=>setTimeout(s,delay)); await r.continue();
 });
 await page.click('#listFreshness');
 await page.waitForSelector('#reloadMenu [data-reload-action="list"]',{timeout:5000});
 await page.click('#reloadMenu [data-reload-action="list"]');
 await page.waitForFunction(()=>{const e=document.querySelector('#listLoadChip');
   return !!e&&!e.hidden},{timeout:delay+15000}).catch(()=>{});
 const slow=await chip();
 await page.unroute('**/api/table*');
 rec('遅い読み込みでは秒数のチップが出る',slow.出ている&&/秒$/.test(slow.字),JSON.stringify(slow));
 rec('出たチップは遅いことも色で言う（is-slow）',
   await page.evaluate(()=>document.querySelector('#listLoadChip')?.classList.contains('is-slow')));
 // 速い読み込みへ戻したら、また消える（出しっぱなしにしない）
 await page.click('#listFreshness');
 await page.waitForSelector('#reloadMenu [data-reload-action="list"]',{timeout:5000});
 await page.click('#reloadMenu [data-reload-action="list"]');
 await idle();
 const back=await chip();
 rec('速い読み込みへ戻ると、また消える',!back.出ている,JSON.stringify(back));

 // --- 4. 検索語やページを変えたら別内容なので取り直す ---
 mark=since();
 await page.fill('#search','L00');
 await idle(600);
 const searched=mark();
 rec('検索条件を変えたときは取り直す',searched.filter(x=>x==='table').length>=1,JSON.stringify(searched));

 // --- 5. TTL(3分)を過ぎたキャッシュは使わない ---
 const stale=await page.evaluate(()=>{
  const key='__ttl_probe__';
  WL.list.tableCacheSet(key,{columns:[],rows:[],count:0});
  const fresh=!!WL.list.tableCacheGet(key);
  // 4分前に取得したことにする（内部の Map ではなく `at` を渡す・§9.355）
  WL.list.tableCacheSet(key,{columns:[],rows:[],count:0},Date.now()-240000);
  return {fresh,expired:WL.list.tableCacheGet(key)===null};
 });
 rec('3分を過ぎたキャッシュは破棄して取り直す',stale.fresh&&stale.expired,JSON.stringify(stale));

 // --- 6. キャッシュ命中の切替では待機オーバーレイを一度も出さない ---
 //     (一瞬で消える点滅は「速くなったのに遅く見える」原因になる)
 //
 //     オーバーレイはwithWaitingが350msを超えたときだけ出す。つまりこの検証は
 //     実時間のしきい値に依存し、**通しで回して負荷が高いときだけ落ちる**
 //     (実際に465msで一度落ちた。単体では11/11で通る)。実行のたびに結果が
 //     変わるのでは安全網にならないので、最大3回まで測り直して「しきい値内で
 //     完了し、かつ点滅しない切替ができる」ことを見る。本当に取得が走る
 //     回帰なら毎回350msを超えるので3回とも落ちる。
 const measure=async()=>{
  await page.click('[data-db-key="SIKALOTDEF"]');await idle();
  return page.evaluate(async()=>{
    const ov=document.querySelector('#saveOverlay');
    let seen=false;
    const mo=new MutationObserver(()=>{if(!ov.hidden)seen=true});
    mo.observe(ov,{attributes:true,attributeFilter:['hidden']});
    const btn=document.querySelector('[data-db-key="SIKALOTNOW"]');
    const s=performance.now();btn.click();
    // グリッドが実際に描き変わるまで待つ
    await new Promise(r=>{const t=setInterval(()=>{
      if(document.querySelector('#grid table tbody tr')){clearInterval(t);r()}},5)});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    mo.disconnect();
   return {ms:Math.round(performance.now()-s),seen};
  });
 };
 const samples=[];
 let flash=null;
 for(let i=0;i<3;i++){
  const r=await measure();samples.push(r);
  if(!r.seen){flash=r;break}
 }
 rec('キャッシュ命中の切替では待機オーバーレイが一度も出ない',
  !!flash,JSON.stringify(samples));
 console.log('  (参考) キャッシュ命中時の切替~描画完了 '+samples.map(x=>x.ms+'ms').join(' / '));

},{viewport:{width:1600,height:1000},
   init:()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A')});
