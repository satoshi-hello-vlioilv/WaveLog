/* test_sccolpanel.js: 作業スケジュールの表示列の設定——列が欠けない・重くない（§9.501、利用者の報告）
   ------------------------------------------------------------
   「作業スケジュール一覧の『残仕掛設備ｺｰｽ』という列がなぜか作業スケジュールの表示列からは消えていて
    使えなくなっており、他の仕掛一覧などの表示列では列がしっかりあるので、不具合です。列が知らない間に
    使えなくなっていないか、不具合解消をお願いします。」
   「作業スケジュール一覧の表示列の編集画面はかなりもっさりとした動作で遅く使いづらいです。」

   物差し:
    A. 欠け … 仕掛一覧の列のうち、作業スケジュールの表示列の候補に**名前でも元の名前でも見つからない列の数**（0が正）
    B. 重さ … パネルを開く／列を1つ選ぶ／表示の入切／絞り込みに1文字 の時間（ms） */
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
 const tOpen=await openPanel();
 const m1=await missingOf();
 console.log('#PROBE1 '+JSON.stringify({wip:wipCols.length,...m1,missing:m1.missing.slice(0,10),n:m1.missing.length}));
 rec('A1: 仕掛の列はどれも作業スケジュールの表示列の候補に見つかる（開いてすぐ・§9.501）',wipCols.length>0&&m1.missing.length===0,
     `欠け${m1.missing.length}件 ${JSON.stringify(m1.missing.slice(0,8))}（仕掛${wipCols.length}列・候補${m1.items}列）`);
 // B: 重さ（候補のいちばん多い場面1で測る）
 const pickT=await page.evaluate(async()=>{
  const it=[...document.querySelectorAll('#lcList .lc-item')][5];
  const t0=performance.now();(it.querySelector('.lc-name')||it).click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return Math.round(performance.now()-t0);
 });
 const visT=await page.evaluate(async()=>{
  const it=[...document.querySelectorAll('#lcList .lc-item')][6];const cb=it&&it.querySelector('.lc-vis input');
  const t0=performance.now();if(cb)cb.click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const t=Math.round(performance.now()-t0);if(cb)cb.click();return t;
 });
 const typeT=await page.evaluate(async()=>{
  const inp=document.getElementById('lcFilter')||document.querySelector('#listColumnPanel input[type="search"],#listColumnPanel input[placeholder*="絞り込み"]');
  if(!inp)return -1;
  const t0=performance.now();inp.value='残';inp.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const t=Math.round(performance.now()-t0);inp.value='';inp.dispatchEvent(new Event('input',{bubbles:true}));return t;
 });
 console.log('#TIME '+JSON.stringify({open:tOpen,pick:pickT,vis:visT,type:typeT}));
 rec('B: 表示列の設定の操作は速い（開く1秒以内・選ぶ／入切／1文字 各150ms以内）（§9.501）',
     tOpen<=1000&&pickT<=150&&visT<=150&&typeT>=0&&typeT<=150,JSON.stringify({open:tOpen,pick:pickT,vis:visT,type:typeT}));
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
  const m2=await missingOf();
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
  const m3=await missingOf();
  console.log('#PROBE3 '+JSON.stringify({other:pick3,...m3,missing:m3.missing.slice(0,12),n:m3.missing.length}));
  rec('A3: 仕掛一覧を畳み、直前に別の元データを開いていても仕掛の列は候補から消えない（§9.501）',m3.missing.length===0,
      `欠け${m3.missing.length}件 ${JSON.stringify(m3.missing.slice(0,8))}（直前 ${pick3}・S.columns ${m3.sCols}列 db=${m3.db}）`);
  await page.evaluate(()=>localStorage.removeItem('scSplitListCollapsedV1'));
 }
 await page.evaluate(()=>WL.listColumns&&WL.listColumns.close&&WL.listColumns.close());
 rec('画面の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
},{mode:'schedule',viewport:{width:1700,height:1000}});
