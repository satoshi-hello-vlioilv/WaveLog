/* test_stoprulemaster.js: 設備停止マスタの挿入条件の盤（§9.588 → §9.590 で作り直した）
   ============================================================
   §9.588「判定条件は設備停止マスタの設備停止ごとに持たせ、…その設備停止の挿入数、挿入すべきそれぞれの時間と
    自動挿入か、警告のみか選べるようにします」
   §9.590「設備停止マスタを作り変えて適切に階層化してください。設備停止挿入条件が作りにくく使いにくいです。
    一覧表にある表示列の『この列の作り方』のような条件入力ができるとやりやすい」
   置き場は7案→組合せ7案から H1: 左＝分類 → 停止内容の木、右＝段（基本・内訳・挿入の条件）。
   挿入の条件は決まりの札（文で読める）＋押した札の中で「組み立てる｜式を書く」＋右に試した結果。

   固定すること:
    1. 段の札がいまの値を言う（挿入の条件「条件 2・自動1」）。木の停止内容にも同じ札
    2. 前の版のセルの条件は、開くと同じ意味の文（組み立て）で出る（製造材質 が変わる・製造板幅 の差…が 100 以上）
    3. 札を押すとその場で開き、「組み立てる｜式を書く」の2つの札と答えの欄（本数・時間・入れ方）
    4. 組み立てで列・見方を選ぶと式が書き換わり、札の文も同じ答えを言う
    5. 式を書く: 前.／後. 以外の名前は「使えない」と字で言い、保存の前に止める（止めた札が開く）
    6. 答えを直して保存すると、サーバーに式・組み立て・本数・時間・入れ方が残る（セルの条件は持たない）
    7. 保存していない変更があるまま別の停止内容・段へ移ると、捨てる前に聞く
    8. 右に「いまの予定の境目で試す」（境目の数を言う）
   材料（停止内容と表）は自分で作り、自分で消す。
   ============================================================ */
'use strict';
const H=require('./lib/harness.js');
const {run}=H;
/* 停止内容の削除は論理削除（行が残る）。触る前の行を控え、増えた行を消す（§9.362 ⑤）。 */
const SNAP_TABLES=['設備停止マスタ'];
const EQ='テスト設備A';
const TAG='RTM'+process.pid;

run('test_stoprulemaster: 設備停止の挿入条件の盤（§9.590）', async ({page,rec,B,W,idle,errs})=>{
 const snapM=await H.masterSnapshot(SNAP_TABLES);
 const made=[];
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-stoprulemaster'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const rules=async id=>((await page.evaluate(async e=>(await (await fetch('/api/schedule/stop-reason-master?equipment='
   +encodeURIComponent(e))).json()).items||[],EQ)).find(x=>x.id===id)||{}).insertRule;
 const card=i=>`#ssbRules .srb-rule[data-r="${i}"]`;
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementUserId','tester'));
  await post('/api/access-mode',{mode:'edit'});
  for(const n of ['段取り','清掃']){
   const r=await post('/api/schedule/stop-reason-master',{equipment:EQ,name:TAG+n,category:'段取り',standardMinutes:30});
   if(r.body.id)made.push(r.body.id);
  }
  const [s1,s2]=made;
  /* 前の版（§9.588）の形＝セルの条件で入れておく。開くと文（組み立て）で出ることを見る。 */
  await post('/api/schedule/stop-rule',{stopId:s1,cols:['chg.製造材質','diff.製造板幅'],rows:[
   {conditions:[{field:'chg.製造材質',op:'eq',value:'変わる'}],count:1,minutes:[45],action:'auto',note:'材質替え'},
   {conditions:[{field:'diff.製造板幅',op:'ge',value:'100'}],count:2,minutes:[30,15],action:'warn'},
   {conditions:[],count:0,minutes:[],action:'warn'}]});
  rec('材料: 停止内容2つと表を作った',made.length===2,JSON.stringify(made));

  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
  await page.evaluate(()=>{const t=[...document.querySelectorAll('#masterMaintNav [data-master]')].find(x=>x.textContent.trim().endsWith('設備停止'));t&&t.click()});
  await page.waitForSelector('.ssb-edit',{timeout:15000});
  await page.click(`[data-ssb-pick="${s1}"]`);
  await W.until(page,id=>!!document.querySelector(`[data-ssb-pick="${id}"].is-on`),s1,{ms:8000,what:'停止内容を選ぶ'});
  // ---- 1 ----
  const tabNow=await page.evaluate(id=>({tab:((document.querySelector('[data-ssb-tab="rules"] .ssb-tab-now')||{}).textContent||''),
   chip:((document.querySelector(`[data-ssb-pick="${id}"] .ssb-stop-rule`)||{}).textContent||'')}),s1);
  rec('1: 段の札と木の停止内容が「条件 2・自動1」と言う',tabNow.tab==='条件 2・自動1'&&tabNow.chip==='条件 2・自動1',JSON.stringify(tabNow));
  await page.click('[data-ssb-tab="rules"]');
  await page.waitForSelector('#ssbRules .srb-list',{timeout:15000});
  await idle();
  // ---- 2 ----
  const says=await page.evaluate(()=>[...document.querySelectorAll('#ssbRules .srb-rule .srb-say')].map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  rec('2: 前の版のセルの条件は同じ意味の文で出る',/製造材質 が変わる/.test(says[0]||'')&&/製造板幅 の差（後ろ−前）が 100 以上/.test(says[1]||'')
      &&/どれにも当てはまらない/.test(says[2]||''),says.join(' | '));
  // ---- 3 ----
  const open0=await page.evaluate(c=>{const li=document.querySelector(c);return {on:!!li&&li.classList.contains('is-on'),
   tabs:[...li.querySelectorAll('.srb-tabs button')].map(b=>b.textContent.trim()),
   ans:[...li.querySelectorAll('.srb-answer [data-ak]')].map(x=>x.dataset.ak),builder:!!li.querySelector('.fxb-sentence')}},card(0));
  rec('3: 1番の札が開いていて「組み立てる｜式を書く」と答えの欄（本数・入れ方・覚え書き）',
      open0.on&&open0.tabs.join('|')==='組み立てる|式を書く'&&open0.ans.join(',')==='count,action,note'&&open0.builder,JSON.stringify(open0));
  // ---- 4 ----
  await page.selectOption(`${card(0)} .fxb-sel[data-k="how"]`,'same');
  await idle();
  const four=await page.evaluate(c=>({code:(document.querySelector(`${c} .fxb-code`)||{}).textContent||'',
   say:(document.querySelector(`${c} .srb-say`)||{}).textContent.replace(/\s+/g,' ').trim()}),card(0));
  rec('4: 見方を選ぶと式が書き換わり、札の文も同じ答え',four.code==='[前.製造材質] = [後.製造材質]'&&/製造材質 が同じ/.test(four.say),JSON.stringify(four));
  await page.selectOption(`${card(0)} .fxb-sel[data-k="how"]`,'chg');
  await idle();
  // ---- 5 ----
  await page.click(`${card(1)} .srb-head`);
  await W.until(page,c=>!!document.querySelector(c+'.is-on'),card(1),{ms:5000,what:'2番の札が開く'});
  await page.click(`${card(1)} .srb-tabs button[data-tab="text"]`);
  await page.waitForSelector(`${card(1)} textarea[data-formula]`,{timeout:5000});
  await page.fill(`${card(1)} textarea[data-formula]`,'[製造板幅] > 100');
  await idle();
  const chk=await page.evaluate(c=>(document.querySelector(`${c} [data-check]`)||{}).textContent||'',card(1));
  rec('5: 前.／後. 以外の名前は使えないと字で言う',/前\.」か「後\./.test(chk),chk);
  await page.click(`${card(0)} .srb-head`);
  await page.click('#ssbRules [data-save]');
  await W.until(page,c=>!!document.querySelector(c+'.is-on'),card(1),{ms:5000,what:'使えない札が開き直る'});
  const stopped=await page.evaluate(()=>(document.querySelector('#ssbRules .srb-state')||{}).textContent||'');
  rec('5: 保存の前に止め、使えない札を開いて理由を言う',/2番の条件/.test(stopped),stopped);
  await page.fill(`${card(1)} textarea[data-formula]`,'num([後.製造板幅]) - num([前.製造板幅]) >= 50');
  await idle();
  // ---- 6 ----
  await page.selectOption(`${card(1)} select[data-ak="count"]`,'3');
  await idle();
  const mins=await page.$$(`${card(1)} input[data-min]`);
  /* 前は2本（30, 15）。3本にすると欄が3つ、1本目と3本目を直す（2本目の15は残る）。 */
  rec('6: 本数を3にすると時間の欄が3つ',mins.length===3,String(mins.length));
  await page.fill(`${card(1)} input[data-min="0"]`,'20');await page.dispatchEvent(`${card(1)} input[data-min="0"]`,'change');
  await page.fill(`${card(1)} input[data-min="2"]`,'5');await page.dispatchEvent(`${card(1)} input[data-min="2"]`,'change');
  await page.selectOption(`${card(1)} select[data-ak="action"]`,'auto');
  await idle();
  // ---- 7 ----
  await page.click(`[data-ssb-pick="${s2}"]`);
  await W.until(page,()=>{const x=document.getElementById('appConfirmModal');return !!x&&!x.hidden},null,{ms:8000,what:'捨てる前の確認'});
  const ask=await page.evaluate(()=>document.getElementById('appConfirmTitle').textContent);
  rec('7: 保存していない変更があるまま別の停止内容を選ぶと、捨てる前に聞く',/保存していない/.test(ask),ask);
  await page.click('#appConfirmCancel');
  await page.click('#ssbRules [data-save]');
  const saved=await W.poll(()=>rules(s1),r=>!!r&&!!r.rows[1]&&r.rows[1].count===3,15000);
  const r0=saved&&saved.rows[0],r1=saved&&saved.rows[1];
  rec('6: 保存すると式・組み立て・本数・時間・入れ方が残り、セルの条件は持たない',
      !!r0&&r0.formula==='[前.製造材質] <> [後.製造材質]'&&!!r0.build&&r0.conditions.length===0
      &&!!r1&&r1.formula==='num([後.製造板幅]) - num([前.製造板幅]) >= 50'&&r1.build===null
      &&r1.minutes.join()==='20,15,5'&&r1.action==='auto',JSON.stringify(saved&&saved.rows.slice(0,2)));
  // ---- 8 ----
  await page.waitForSelector('#ssbRules .srb-try',{timeout:8000});
  await W.until(page,()=>!/読んでいます/.test((document.querySelector('#ssbRules .srb-try')||{}).textContent||''),null,{ms:15000,what:'予定を読む'});
  const tr=await page.evaluate(()=>((document.querySelector('#ssbRules .srb-try')||{}).textContent||'').replace(/\s+/g,' '));
  rec('8: 右に「いまの予定の境目で試す」と境目の数',/いまの予定の境目で試す/.test(tr)&&/(境目 \d+ のうち|境目がまだありません)/.test(tr),tr.slice(0,120));
  rec('JSエラーが出ていない',!errs.length,errs.slice(0,2).join(' / '));
 }finally{
  for(const id of made){
   await post('/api/schedule/stop-rule',{stopId:id,reset:true});
   await post('/api/schedule/stop-reason-master/delete',{id});
  }
  await H.dropNewMasterRows(snapM).catch(e=>console.log('後片付けに失敗: '+e));
 }
},{viewport:{width:1728,height:1152}});
