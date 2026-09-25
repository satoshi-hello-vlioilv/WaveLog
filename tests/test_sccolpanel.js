/* test_sccolpanel.js: 作業スケジュールの表示列の設定——列が欠けない・重くない（§9.501、利用者の報告）
   ------------------------------------------------------------
   「作業スケジュール一覧の『残仕掛設備ｺｰｽ』という列がなぜか作業スケジュールの表示列からは消えていて
    使えなくなっており、他の仕掛一覧などの表示列では列がしっかりあるので、不具合です。列が知らない間に
    使えなくなっていないか、不具合解消をお願いします。」
   「作業スケジュール一覧の表示列の編集画面はかなりもっさりとした動作で遅く使いづらいです。」

   物差し:
    A. 欠け … 仕掛一覧の列のうち、作業スケジュールの表示列の候補に**名前でも元の名前でも見つからない列の数**（0が正）
    B. 重さ … 候補が約300列（利用者の環境: 仕掛256列・候補299列）のとき、パネルを開く／列を1つ選ぶ／
              表示の入切（2回）／絞り込みに1文字 の時間（ms）。直す前は 開く11.7秒・選ぶ5.9秒・入切8.9秒
              （列1本の分類のたびに候補を作り直す＝列の数の2乗）。 */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';

run('test_sccolpanel: 作業スケジュールの表示列——欠けない・重くない（§9.501）',async({page,rec,B,W,idle,errs})=>{
 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page);
 /* 物差しの基準は**サーバーが答える仕掛の全列**（画面の状態`S.columns`に頼らない——それ自体が疑わしい）。 */
 const wipCols=await page.evaluate(async()=>{
  const db=WL.dataSource.workKey();
  const t=await api('/api/tables?db='+encodeURIComponent(db));
  const table=(t.tables||t||[])[0];const name=typeof table==='string'?table:(table&&(table.name||table.table));
  const d=await api('/api/table?'+new URLSearchParams({db,table:name,page:1,page_size:1}));
  return d.columns||[];
 });
 const openPanel=async()=>{
  const t0=Date.now();
  await page.evaluate(()=>WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop());
  await page.click('#scContentModalBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden]) #lcList .lc-item',{timeout:15000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  return Date.now()-t0;
 };
 /* 仕掛の列が候補に**キーでも名前でも別名でも**見つからない数。 */
 const missingOf=()=>page.evaluate(wip=>{
  const items=[...document.querySelectorAll('#lcList .lc-item')].map(el=>({key:el.dataset.key,name:((el.querySelector('.lc-name')||el).textContent||'').trim()}));
  const have=new Set();items.forEach(i=>{have.add(i.key);have.add(i.name);(WL.base.aliases[i.key]||[]).forEach(a=>have.add(a))});
  return {items:items.length,sCols:(S.columns||[]).length,db:S.db,missing:wip.filter(c=>!have.has(c))};
 },wipCols);
 const closePanel=()=>page.evaluate(()=>WL.listColumns&&WL.listColumns.close&&WL.listColumns.close());
 /* 場面1: 起動してすぐ作業スケジュールを開く。 */
 await W.openSchedule(page,EQ);
 await idle();
 await openPanel();
 const m1=await missingOf();
 const counts=[m1.items];
 console.log('#PROBE1 '+JSON.stringify({wip:wipCols.length,...m1,missing:m1.missing.slice(0,10),n:m1.missing.length}));
 rec('A1: 仕掛の列はどれも作業スケジュールの表示列の候補に見つかる（開いてすぐ・§9.501）',wipCols.length>0&&m1.missing.length===0,
     `欠け${m1.missing.length}件 ${JSON.stringify(m1.missing.slice(0,8))}（仕掛${wipCols.length}列・候補${m1.items}列）`);
 await closePanel();
 /* 場面2: **別の一覧（品質データ）を開いてから**作業スケジュールへ戻る。 */
 const other=await page.evaluate(()=>{
  const w=WL.dataSource.workKey();const q=WL.dataSource.qualityKey();
  return q&&q!==w?q:((S.catalog||[]).map(x=>x.key).find(k=>k&&k!==w)||'');
 });
 if(other){
  await page.evaluate(k=>WL.list.selectDb(k),other);
  await W.until(page,k=>S.db===k&&Array.isArray(S.columns)&&S.columns.length>0,other,{ms:20000,what:'直前の一覧が読めた'});
  await idle();
  await W.openSchedule(page,EQ);
  await idle();
  await openPanel();
  const m2=await missingOf();counts.push(m2.items);
  console.log('#PROBE2 '+JSON.stringify({other,...m2,missing:m2.missing.slice(0,10),n:m2.missing.length}));
  rec('A2: 別の一覧を開いたあとでも、仕掛の列は候補から消えない（§9.501）',m2.missing.length===0,
      `欠け${m2.missing.length}件 ${JSON.stringify(m2.missing.slice(0,8))}（直前の一覧 ${other}・S.columns ${m2.sCols}列 db=${m2.db}）`);
 }else rec('A2: 別の一覧を開いたあとでも、仕掛の列は候補から消えない（§9.501）',false,'前提: 仕掛以外の元データがフィクスチャに無い');
  await closePanel();
 /* 場面3: 「スケジュールだけ」（仕掛一覧を畳んでいる）で、直前に**別の元データ**を開いていた。
    畳んでいる間は仕掛一覧を読まない（§9.182）ので、`S.columns`は直前の表のまま。 */
 {
  const other3=await page.evaluate(()=>{const w=WL.dataSource.workKey();return (S.catalog||[]).map(x=>x.key).filter(k=>k&&k!==w)});
  console.log('#CATALOG '+JSON.stringify(other3));
  await page.evaluate(()=>localStorage.setItem('scSplitListCollapsedV1','1'));
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  const pick3=other3.find(k=>/ACT/i.test(k))||other3[0];
  await page.evaluate(k=>WL.list.selectDb(k),pick3);
  await W.until(page,k=>S.db===k&&Array.isArray(S.columns)&&S.columns.length>0,pick3,{ms:20000,what:'直前の一覧が読めた'});
  await idle();
  await W.openSchedule(page,EQ);
  await idle();
  await openPanel();
  const m3=await missingOf();counts.push(m3.items);
  console.log('#PROBE3 '+JSON.stringify({other:pick3,...m3,missing:m3.missing.slice(0,12),n:m3.missing.length}));
  rec('A3: 仕掛一覧を畳み、直前に別の元データを開いていても仕掛の列は候補から消えない（§9.501）',m3.missing.length===0,
      `欠け${m3.missing.length}件 ${JSON.stringify(m3.missing.slice(0,8))}（直前 ${pick3}・S.columns ${m3.sCols}列 db=${m3.db}）`);
  await page.evaluate(()=>localStorage.removeItem('scSplitListCollapsedV1'));
 }
 /* 開いた順番で候補の顔ぶれが変わらない（§9.501）。変わるなら、どこかの場面で画面の状態に頼っている。 */
 rec('A4: 候補の数はどの場面でも同じ（開いた順番に左右されない・§9.501）',counts.length===3&&counts.every(n=>n===counts[0]),
     JSON.stringify(counts));
 await page.evaluate(()=>WL.listColumns&&WL.listColumns.close&&WL.listColumns.close());
 /* B: 重さ——**サーバーの答えの段階で**列を約300本に増やす（画面の控えを書き換えると、控えが
    正しく古いまま使われて測れない）。仕掛の列名と、予定が持つ仕掛データの写しの両方へ足す。 */
 {
  const names=Array.from({length:250},(_,j)=>'試験列'+String(j).padStart(3,'0'));
  await page.route(/\/api\/table-columns/,async route=>{
   const r=await route.fetch();const j=await r.json();
   j.columns=[...(j.columns||[]),...names];await route.fulfill({response:r,json:j});
  });
  await page.route(/\/api\/schedule\/plan/,async route=>{
   const r=await route.fetch();const j=await r.json();
   (j.entries||[]).forEach((e,i)=>{if(e&&e.detail)names.forEach((n,k)=>{e.detail[n]=String((i*7+k)%97)})});
   await route.fulfill({response:r,json:j});
  });
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  await idle();
  const tOpen=await openPanel();
  const act=js=>page.evaluate(async js=>{
   const t0=performance.now();(new Function(js))();
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   return Math.round(performance.now()-t0);
  },js);
  const items=await page.evaluate(()=>document.querySelectorAll('#lcList .lc-item').length);
  const t={open:tOpen,items,
   pick:await act("const it=[...document.querySelectorAll('#lcList .lc-item')][5];(it.querySelector('.lc-name')||it).click()"),
   vis:await act("document.querySelectorAll('#lcList .lc-item')[6].querySelector('.lc-vis input').click()"),
   vis2:await act("document.querySelectorAll('#lcList .lc-item')[6].querySelector('.lc-vis input').click()"),
   type:await act("const inp=document.getElementById('lcFilter');inp.value='残';inp.dispatchEvent(new Event('input',{bubbles:true}))")};
  console.log('#TIME '+JSON.stringify(t));
  /* 境目は直す前（秒の桁）と桁で離す: 開く1.5秒・操作300ms（直した後の実測は 356／109／116／35ms）。 */
  rec('B: 約300列でも表示列の設定は重くない（開く1.5秒以内・選ぶ／入切／1文字 各300ms以内）（§9.501）',
      items>=250&&t.open<=1500&&Math.max(t.pick,t.vis,t.vis2,t.type)<=300,JSON.stringify(t));
  await page.unroute(/\/api\/table-columns/);await page.unroute(/\/api\/schedule\/plan/);
  await closePanel();
 }
 /* C: 列名を取りに行っているあいだに段を移ったら、設定パネルを**開かない**（§9.501の追補）。
    控えが無い最初の1回だけ往復があるので、読み込み直して答えを遅らせる。前は移った先の段の上に開いていた。 */
 {
  let served=false,done;
  const servedP=new Promise(ok=>{done=ok});
  await page.route(/\/api\/table-columns/,async route=>{
   await new Promise(ok=>setTimeout(ok,1500));
   await route.continue().catch(()=>{/* 待つあいだに外した道 */});served=true;done();
  });
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  /* **静まるのを待たない**——画面を開いたときに列名の取得が始まっており、静まるまで待つと控えができて
     往復が無くなる（競りが起きない）。取得の途中で「表示列」→ 段「履歴」の順に押す。押すのは要素の
     click()（開いたパネルが段の札に重なっても、押した事実は同じ）。 */
  const pending=!served;
  await page.evaluate(()=>{WL.scheduleView.openViewPop&&WL.scheduleView.openViewPop();
   document.getElementById('scContentModalBtn').click();document.getElementById('scModeHistory').click()});
  await servedP;   // 遅らせた答えが届くまで（条件で待つ）
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const open=await page.evaluate(()=>{const p=document.getElementById('listColumnPanel');return !!p&&!p.hidden});
  console.log('#MEASURE '+JSON.stringify({panelOpenAfterLeaving:open}));
  rec('C: 列名を待つあいだに段を移ったら、表示列の設定を開かない（§9.501の追補）',pending&&served&&!open,JSON.stringify({pending,served,open}));
  await page.unroute(/\/api\/table-columns/);
  await closePanel();
 }
 rec('画面の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
},{mode:'schedule',viewport:{width:1700,height:1000}});
