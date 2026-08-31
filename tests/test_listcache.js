/* 仕掛一覧/品質データの切替高速化(§9.46)の検証:
   画面を戻したときに /api/table を叩き直さない・鮮度表示・再読込での強制取得 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const ctx=await b.newContext({viewport:{width:1600,height:1000}});
 await ctx.addInitScript(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
 const page=await ctx.newPage();
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',e.message));

 // API呼び出しを数える(体感速度の正体は往復回数。ローカルSSDの実時間は当てにしない)
 const calls=[];
 page.on('request',r=>{const u=r.url();if(u.includes('/api/table?'))calls.push('table');
   else if(u.includes('/api/tables?'))calls.push('tables')});
 const since=()=>{const n=calls.length;return ()=>calls.slice(n)};

 await page.goto('http://127.0.0.1:5029/',{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-db-key="SIKALOTNOW"]',{timeout:15000});
 await page.waitForFunction(()=>document.querySelectorAll('#grid table tbody tr').length>0,{timeout:20000});
 rec('起動時に仕掛一覧が表示される',true,'初期の取得 '+calls.length+'回');

 // --- 1. 品質データへ切り替えて仕掛へ戻す ---
 let mark=since();
 await page.click('[data-db-key="SIKALOTDEF"]');
 await page.waitForTimeout(2500);
 const toDef=mark();
 rec('品質データへの初回切替では取得が発生する',toDef.filter(x=>x==='table').length>=1,JSON.stringify(toDef));

 mark=since();
 await page.click('[data-db-key="SIKALOTNOW"]');
 await page.waitForTimeout(2000);
 const backNow=mark();
 rec('仕掛一覧へ戻るときは再取得しない(/api/table 0回)',
   backNow.filter(x=>x==='table').length===0,JSON.stringify(backNow));
 rec('テーブル構成(/api/tables)も再取得しない',
   backNow.filter(x=>x==='tables').length===0,JSON.stringify(backNow));

 mark=since();
 await page.click('[data-db-key="SIKALOTDEF"]');
 await page.waitForTimeout(2000);
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
 await page.waitForTimeout(2500);
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

 // --- 4. 検索語やページを変えたら別内容なので取り直す ---
 mark=since();
 await page.fill('#search','L00');
 await page.waitForTimeout(2500);
 const searched=mark();
 rec('検索条件を変えたときは取り直す',searched.filter(x=>x==='table').length>=1,JSON.stringify(searched));

 // --- 5. TTL(3分)を過ぎたキャッシュは使わない ---
 const stale=await page.evaluate(()=>{
  const key='__ttl_probe__';
  tableCacheSet(key,{columns:[],rows:[],count:0});
  const fresh=!!tableCacheGet(key);
  // 4分前に取得したことにする
  tableCache.get(key).at=Date.now()-240000;
  return {fresh,expired:tableCacheGet(key)===null};
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
  await page.click('[data-db-key="SIKALOTDEF"]');await page.waitForTimeout(1500);
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

 await b.close();
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 // 落ちてもブラウザは必ず閉じる。閉じ忘れると開いたままの画面が設備の
 // 編集セッションを掴み続け、後続のスケジュール系テストが「編集中です」で
 // 連鎖的に落ちる(実際に1本のFATALから8本が落ちた)。
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
