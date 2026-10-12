/* test_stoprulemaster.js: 設備停止マスタの挿入条件の盤（§9.588、利用者の指示）
   ============================================================
   「判定条件は設備停止マスタの設備停止ごとに持たせ」「条件は列のデータを組み合わせて条件テーブルを
    判定条件とし、その設備停止の挿入数、挿入すべきそれぞれの時間と自動挿入か、警告のみか選べるように」
   置き場は7案から M3（3つのペインの下に全幅の節・停止内容の行に「条件 N行」）。

   固定すること:
    1. 停止内容を選ぶと、その表が3つのペインの下に全幅で出る（3つのペインと重ならない）
    2. 列の見出しが「どのロットの値か」を言う（製造材質（変わったか）・製造板幅の差）
    3. 答えの欄は3つ（入れる本数・それぞれの時間・入れ方）。「試す」の変わったかは「変わる／同じ」から選ぶ
    4. 停止内容の行に「条件 N行・自動N」の札
    5. 答えを直して保存すると、サーバーの表に残る（挿入数・時間・入れ方）
    6. 保存していない変更があるまま別の停止内容を選ぶと、捨てる前に聞く
   材料（停止内容と表）は自分で作り、自分で消す。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='RTM'+process.pid;

run('test_stoprulemaster: 設備停止の挿入条件の盤（§9.588）', async ({page,rec,B,W,idle,errs})=>{
 const made=[];
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-stoprulemaster'},a.b))});
  let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 const rules=async id=>((await page.evaluate(async e=>(await (await fetch('/api/schedule/stop-reason-master?equipment='
   +encodeURIComponent(e))).json()).items||[],EQ)).find(x=>x.id===id)||{}).insertRule;
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
  await page.waitForSelector('#ssbRules .rt-table',{timeout:15000});
  await idle();

  // ---- 1・2・3・4 ----
  const m=await page.evaluate(id=>{
   const r=x=>{const b=x.getBoundingClientRect();return {l:b.left,t:b.top,r:b.right,b:b.bottom,w:b.width}};
   const sec=document.getElementById('ssbRules'),panes=[...document.querySelectorAll('.ssb-edit > :not(#ssbRules)')].map(r);
   const sb=r(sec);
   return {below:panes.every(p=>p.b<=sb.t+1),full:Math.abs(sb.l-Math.min(...panes.map(p=>p.l)))<2&&Math.abs(sb.r-Math.max(...panes.map(p=>p.r)))<2,
    heads:[...sec.querySelectorAll('thead tr:first-child th.rt-col b')].map(x=>x.textContent),
    ans:[...sec.querySelectorAll('thead tr:first-child th.rt-out')].map(x=>x.textContent.replace(/\s+/g,'')),
    probe:[...(sec.querySelector('select.rt-p[data-p="chg.製造材質"]')||{options:[]}).options].map(o=>o.textContent),
    chip:(document.querySelector(`[data-ssb-pick="${id}"] .ssb-stop-rule`)||{}).textContent||''};
  },s1);
  rec('1: 表は3つのペインの下に全幅で出る（重ならない）',m.below&&m.full,JSON.stringify(m).slice(0,200));
  rec('2: 列の見出しが「どのロットの値か」を言う',m.heads.join('|')==='製造材質（変わったか）|製造板幅の差',m.heads.join('|'));
  rec('3: 答えの欄は3つ（入れる本数・それぞれの時間・入れ方）',m.ans.join('|')==='→入れる本数|それぞれの時間（分）|入れ方',m.ans.join('|'));
  rec('3: 「試す」の変わったかは「変わる／同じ」から選ぶ',m.probe.join('|')==='（問わない）|変わる|同じ',m.probe.join('|'));
  rec('4: 停止内容の行に「条件 N行・自動N」の札',m.chip==='条件 2行・自動1',m.chip);
  const read=await page.evaluate(()=>{const s=document.querySelector('#ssbRules select.rt-p[data-p="chg.製造材質"]');
   s.value='変わる';s.dispatchEvent(new Event('change',{bubbles:true}));return true});
  await idle();
  const won=await page.evaluate(()=>[...document.querySelectorAll('#ssbRules .rt-row.is-won')].map(x=>x.dataset.r).join(','));
  rec('3: 「試す」で当たる行が光る（変わる → 1行目）',read&&won==='0',won);

  // ---- 5. 答えを直して保存 ----
  await page.selectOption('#ssbRules .rt-row[data-r="1"] select.rt-ansel[data-ak="count"]','3');
  await page.fill('#ssbRules .rt-row[data-r="1"] input.rt-ansel[data-ak="minutes"]','20, 10, 5');
  await page.dispatchEvent('#ssbRules .rt-row[data-r="1"] input.rt-ansel[data-ak="minutes"]','change');
  await page.selectOption('#ssbRules .rt-row[data-r="1"] select.rt-ansel[data-ak="action"]','auto');
  await idle();

  // ---- 6. 保存していない変更があるまま別の停止内容を選ぶと聞く ----
  await page.click(`[data-ssb-pick="${s2}"]`);
  await W.until(page,()=>{const x=document.getElementById('appConfirmModal');return !!x&&!x.hidden},null,{ms:8000,what:'捨てる前の確認'});
  const ask=await page.evaluate(()=>document.getElementById('appConfirmTitle').textContent);
  rec('6: 保存していない変更があるまま別の停止内容を選ぶと、捨てる前に聞く',/保存していない/.test(ask),ask);
  await page.click('#appConfirmCancel');
  await page.click('#ssbRules [data-rt="save"]');
  /* 保存は「送る → 読み直す」。サーバーへ聞き直して待つ（`poll()`・述語に Promise を返させない）。 */
  const saved=await W.poll(()=>rules(s1),r=>!!r&&!!r.rows[1]&&r.rows[1].count===3,15000);
  const row=saved&&saved.rows[1];
  rec('5: 答え（本数3・時間20,10,5・自動で入れる）が保存される',!!row&&row.count===3&&row.minutes.join()==='20,10,5'&&row.action==='auto',
      JSON.stringify(row));
  rec('JSエラーが出ていない',!errs.length,errs.slice(0,2).join(' / '));
 }finally{
  for(const id of made){
   await post('/api/schedule/stop-rule',{stopId:id,reset:true});
   await post('/api/schedule/stop-reason-master/delete',{id});
  }
 }
},{viewport:{width:1728,height:1152}});
