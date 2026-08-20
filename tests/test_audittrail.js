/* test_audittrail.js: 誰が・どの端末で(§9.180)
   ============================================================
   利用者の指示は「どのPC、どのIDから編集をされたデータなのか。スケジュール
   データ→スケジュールを組み込んだIDとPC名、測定データ→測定データを入力
   開始したIDとPC名をデータに追加する」。
   ここで固定するのは次の点。
    1. 予定を入れると[登録者ID]と[登録端末名]が残り、APIが返す
    2. 予定を動かしても**入れた人・端末は変わらない**（更新側だけ変わる）
    3. 測定データのバックアップに入力開始者・端末が残る
    4. 別のPCで続きを保存しても**入力開始者・端末は上書きされない**
    5. スケジュール表の行の詳細に「誰が・どの端末で」が必ず出る
    6. 監査の列は**既定では出さない**（保存済みの並びがあるときだけ出る）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TARGET='timeline:'+EQ;
const REC='AUDIT_TEST_REC';
const AUDIT_COLS=['__by__','__pc__','__upby__','__uppc__'];
let b=null,madeId=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getJson=p=>fetch(B+p).then(r=>r.json());
const planOf=async()=>((await getJson('/api/schedule/plan?equipment='+encodeURIComponent(EQ))).entries||[]);
async function cleanup(){
 try{if(madeId)await post('/api/schedule/plan/delete',{id:madeId})}catch(e){}
 try{await post('/api/measurement/backup/delete',{id:REC})}catch(e){}
 try{await post('/api/column-layout-master',{target:TARGET,clear:true,order:[],widths:{},hidden:[],names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'})}catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await cleanup();
  /* ---- 1-2) 測定データ: 入力開始者・端末 ----
     **測定データの保存は編集モードだけに開いている**(書込ガード)。予定の
     確認より先に済ませる——モードを戻すために画面を読み直す必要が無い順に
     並べる。 */
  await post('/api/access-mode',{mode:'edit'});
  await post('/api/measurement/backup',{id:REC,lotNo:'L_AUDIT',payload:'{}',
    created_by:'op_start',created_pc:'PC-LINE1',created_at:'2026-08-17T10:00:00',user_id:'op_start'});
  const row1=(await getJson('/api/measurement/backup/summary')).items.find(x=>x.id===REC)||{};
  rec('測定データに入力開始者が残る',row1.created_by==='op_start',JSON.stringify(row1.created_by));
  rec('測定データに入力開始端末が残る',row1.created_pc==='PC-LINE1',JSON.stringify(row1.created_pc));
  // 別のPC(別の人)が続きを保存する。§9.91のPC引き継ぎ。
  await post('/api/measurement/backup',{id:REC,lotNo:'L_AUDIT',payload:'{}',user_id:'op_next'});
  const row2=(await getJson('/api/measurement/backup/summary')).items.find(x=>x.id===REC)||{};
  rec('続きを別のPCで保存しても入力開始者は上書きされない',
      row2.created_by==='op_start'&&row2.created_pc==='PC-LINE1',
      JSON.stringify({by:row2.created_by,pc:row2.created_pc}));
  rec('最後に保存した人・端末は別に残る',
      row2.updated_by==='op_next'&&!!String(row2.updated_pc||'').trim(),
      JSON.stringify({by:row2.updated_by,pc:row2.updated_pc}));


  await post('/api/access-mode',{mode:'schedule'});
  await post('/api/schedule/session/acquire',{equipment:EQ});

  /* ---- 1) 予定を入れると誰が・どの端末かが残る ---- */
  const add=await (await fetch(B+'/api/schedule/plan/add',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({equipment:EQ,kind:'作業',lotNo:'AUDITLOT',user_id:'tester_add'})})).json();
  madeId=add.id;
  const mine=()=>planOf().then(list=>list.find(e=>String(e.id)===String(madeId))||{});
  const a=await mine();
  rec('予定を入れた利用者IDが残る',a.createdBy==='tester_add',JSON.stringify(a.createdBy));
  rec('予定を入れた端末名が残る',!!String(a.createdPc||'').trim(),JSON.stringify(a.createdPc));
  rec('入れた日時も残る',!!String(a.createdAt||'').trim(),JSON.stringify(a.createdAt));

  /* ---- 2) 動かしても「入れた人・端末」は変わらない ---- */
  await post('/api/schedule/plan/update',{id:madeId,remark:'監査の確認',user_id:'tester_edit'});
  const c=await mine();
  rec('動かしても入れた人は変わらない',c.createdBy==='tester_add',
      JSON.stringify({created:c.createdBy,updated:c.updatedBy}));
  rec('最後に動かした人は更新側に残る',c.updatedBy==='tester_edit',JSON.stringify(c.updatedBy));
  rec('最後に動かした端末も残る',!!String(c.updatedPc||'').trim(),JSON.stringify(c.updatedPc));

  /* ---- 5-6) 画面 ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
   localStorage.removeItem('scLayoutPrefsV1')},EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForTimeout(2200);
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);
  const heads=await page.evaluate(()=>[...document.querySelectorAll('.sc-row-head [data-col]')].map(h=>h.dataset.col));
  rec('監査の列は既定では出さない',AUDIT_COLS.every(k=>!heads.includes(k)),JSON.stringify(heads.slice(-6)));
  const detail=await page.evaluate(id=>{
   const row=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   if(!row)return {err:'行がありません'};
   const t=row.querySelector('.sc-row-detail-toggle');
   if(!t)return {err:'詳細のボタンがありません'};
   t.click();
   const d=row.nextElementSibling;
   return {txt:d?d.textContent.replace(/\s+/g,' ').trim():'',rows:d?d.querySelectorAll('.sc-audit-row').length:0};
  },madeId);
  rec('行の詳細に「誰が・どの端末で」が出る',
      !detail.err&&/誰が・どの端末で/.test(detail.txt)&&detail.txt.includes('tester_add'),
      detail.err||detail.txt.slice(-90));
  rec('入れた人と動かした人を並べて書く',detail.rows===2,String(detail.rows));

  /* 保存済みの並びがあれば列としても出せる */
  const all=await page.evaluate(()=>{
   const keys=[...document.querySelectorAll('.sc-row-head [data-col]')].map(h=>h.dataset.col);
   return keys;
  });
  const withAudit=[...all.filter(k=>k!=='__actions__'),...AUDIT_COLS,'__actions__'];
  await post('/api/column-layout-master',{target:TARGET,order:withAudit,widths:{},hidden:[],
    names:{},formats:{},rules:{},formulas:{},locks:[],user_id:'test'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.waitForTimeout(1200);
  await page.click('#openSchedule');
  await page.waitForTimeout(2200);
  await page.evaluate(e=>{const r=document.querySelector(`[data-equipment="${e}"]`);r&&r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  await page.waitForTimeout(1500);
  const shown=await page.evaluate(id=>{
   const keys=[...document.querySelectorAll('.sc-row-head [data-col]')].map(h=>h.dataset.col);
   const row=document.querySelector(`.sc-row-line[data-id="${id}"]`);
   const cell=k=>{const c=row&&row.querySelector(`[data-col="${k}"]`);return c?c.textContent.trim():null};
   return {keys,by:cell('__by__'),pc:cell('__pc__')};
  },madeId);
  rec('保存した並びに入れれば列として出せる',AUDIT_COLS.every(k=>shown.keys.includes(k)),
      JSON.stringify(shown.keys.slice(-6)));
  rec('列のセルにも同じ値が出る',shown.by==='tester_add'&&!!shown.pc,
      JSON.stringify({by:shown.by,pc:shown.pc}));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
