/* test_doneflowui.js: 作業スケジュールの行の「開始」「終了」と実績時刻の列（§9.611、利用者の指示）
   ============================================================
   「このアプリで作業ロットを開始して終了まで時間登録した場合、次の項目が設備停止の時は、設備停止が開始されたことに…
    途中でその開始されている設備停止を終了時間を打つか、次のロットの開始をする、または次の設備停止の開始を行うと
    設備停止実績が入るように」「作業スケジュール上にも登録した実績の時刻(時間)や取り込んだ実績の時刻(時間)が同じ
    実績時刻のところに出せる(ONOFF可能)」。判定（いつ始まり・いつ終わるか）は test_doneflow.py が固定する。

   ここで固定すること:
    1. 予定の設備停止の行に「開始」、始まった行に「終了」（どちらも操作の列・押した時刻で書く）
    2. 停止に「終了」を押すと、その停止は完了（時刻が入る）・次の停止が始まる（「終了」に替わる）
    3. 実績時刻の列は既定では出さない・「表示列」で出すと、実績の時刻と出どころの字（手入力・自動…）が出る
    4. 済んだ行は予定の行より前（完了側）に並ぶ
   材料（停止内容・予定）は自分で足して、自分で消す（§9.351）。
   ============================================================ */
'use strict';
const H=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='RTF'+process.pid;
const TARGET='timeline:'+EQ;

H.run('test_doneflowui: 行の「開始」「終了」と実績時刻の列（§9.611）',async({page,rec,W,idle,B})=>{
 const made=[];
 let rid=null;
 const post=(p,body)=>page.evaluate(async a=>{
  const t0=Date.now();let last=null;
  while(Date.now()-t0<20000){
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-doneflowui'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   last={status:r.status,body:j};
   if(r.status!==423)return last;
   await new Promise(z=>setTimeout(z,400));   // 共有の書込ロックが空くのを待つ（§4.2）
  }
  return last;
 },{p,b:body||{}});
 const row=id=>`.sc-row-line[data-id="${id}"]`;
 const look=id=>page.evaluate(sel=>{
  const r=document.querySelector(sel);if(!r)return null;
  const b=r.querySelector('.sc-row-progress');
  return {btn:b?b.textContent.trim():'',ok:!!b&&!b.disabled,cat:(r.querySelector('[data-col="__cat__"]')||{}).textContent||'',
   act:(r.querySelector('[data-col="__acttime__"]')||{}).textContent||null,time:(r.querySelector('[data-col="__time__"]')||{}).textContent||'',src:(r.querySelector('[data-act-src]')||{dataset:{}}).dataset.actSrc||''};
 },row(id));
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});await W.booted(page);
  await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                          localStorage.setItem('AccessMeasurementUserId','tester')},EQ);
  await post('/api/access-mode',{mode:'schedule'});
  const reason=await post('/api/schedule/stop-reason-master',{equipment:EQ,name:TAG+'停止',category:'段取り',standardMinutes:30});
  rid=reason.body.id;
  const addStop=async name=>{const r=await post('/api/schedule/plan/add',{equipment:EQ,kind:'設備停止',
    title:TAG+name,stopReasonId:rid,estimateMinutes:30,position:'start'});if(r.body.id)made.push(r.body.id);return r.body.id};
  /* 先頭へ足す（逆の順で足して S1→S2→S3 の並び）——予定の停止の「開始」も表の上で見える。 */
  const s3=await addStop('S3'),s2=await addStop('S2'),s1=await addStop('S1');
  rec('材料を足せた（停止3件）',!!(s1&&s2&&s3),JSON.stringify([s1,s2,s3]));
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
  await W.openSchedule(page,EQ);
  await page.waitForSelector(row(s1),{timeout:20000});await idle();

  /* ---- 1: 予定の設備停止に「開始」 ---- */
  const a0=await look(s1);
  rec('1: 予定の設備停止の行に「開始」（押せる）',!!a0&&a0.btn==='開始'&&a0.ok,JSON.stringify(a0));
  await page.click(row(s1)+' .sc-row-progress');
  await W.until(page,sel=>(document.querySelector(sel+' .sc-row-progress')||{}).textContent==='終了',row(s1),{ms:20000,what:'始まった停止に「終了」'});
  const a1=await look(s1);
  rec('1: 押すと始まり（区分が作業中）、ボタンが「終了」に替わる',!!a1&&a1.btn==='終了'&&/作業中/.test(a1.cat),JSON.stringify(a1));

  /* ---- 2: 「終了」で完了・次の停止が始まる ---- */
  await page.click(row(s1)+' .sc-row-progress');
  await W.until(page,sel=>(document.querySelector(sel+' .sc-row-progress')||{}).textContent==='終了',row(s2),{ms:20000,what:'次の停止が始まる'});
  const a2=await look(s1),b2=await look(s2);
  rec('2: 「終了」でその停止は完了（ボタンが消える）・次の停止が始まる（「終了」）',
   !!a2&&!a2.btn&&/完了/.test(a2.cat)&&!!b2&&b2.btn==='終了',JSON.stringify({a2,b2}));

  /* ---- 3: 実績時刻の列（既定は出さない → 表示列で出す） ---- */
  const hidden=await page.evaluate(()=>document.querySelectorAll('[data-col="__acttime__"]').length);
  rec('3: 実績時刻の列は既定では出さない',hidden===0,String(hidden));
  const cols=await page.evaluate(()=>WL.scheduleView.columnKeysForTest());
  rec('3: 実績時刻は「選べる列」の並びに載っている（表示列で出し入れできる）',cols.all.includes('__acttime__'),JSON.stringify(cols.all));
  await post('/api/column-layout-master',{target:TARGET,clear:true,order:['__cat__','__time__','__acttime__','__actions__'],hidden:[],widths:{},
   names:{},formats:{},rules:{},formulas:{},locks:[],sorts:{}});
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);
  await W.openSchedule(page,EQ);
  await page.waitForFunction(()=>document.querySelectorAll('[data-col="__acttime__"]').length>0,null,{timeout:20000});
  const a3=await look(s1),b3=await look(s2);
  rec('3: 終えた停止は実績の開始〜終了と出どころ「手入力」（押した時刻）',!!a3&&/\d\d:\d\d〜\d\d:\d\d/.test(a3.act||'')&&a3.src==='manual'&&/手入力/.test(a3.act),JSON.stringify(a3));
  rec('3: 始まった停止は終わりを空けた「HH:MM〜」と出どころ「手入力」（終了で始まった）',!!b3&&/\d\d:\d\d〜$/.test(b3.act||'')&&b3.src==='manual',JSON.stringify(b3));
  /* 同じ時刻を2列に並べない: 実績時刻を出しているあいだ、済んだ行の「時刻」は —・作業中の停止は終わる見込みだけ。 */
  rec('3: 実績時刻を出すと「時刻」は実績を繰り返さない（済んだ行は —・作業中の停止は「〜HH:MM 見込」）',
   !!a3&&a3.time.trim()==='—'&&!!b3&&/^〜\d\d:\d\d ?見込$/.test(b3.time.trim()),JSON.stringify({a:a3&&a3.time,b:b3&&b3.time}));
  const c3=await look(s3);
  /* 開始の札が増えても操作の列からあふれない（「外す」が切れて押せる物に見えなくなった・§9.611の採点）。 */
  const fit=await page.evaluate(sel=>{const c=document.querySelector(sel+' [data-col="__actions__"]');
   if(!c)return null;const box=c.getBoundingClientRect();
   const out=[...c.querySelectorAll('button')].filter(b=>b.getBoundingClientRect().right>box.right+0.5).map(b=>b.textContent.trim());
   return {w:Math.round(box.width),need:Math.round(c.scrollWidth),out}},row(s3));
  rec('3: 予定の停止の行（開始・固定・▾・外す）が操作の列に入りきる',!!fit&&!fit.out.length,JSON.stringify(fit));
  rec('3: 次の予定の停止には「開始」（押せる）',!!c3&&c3.btn==='開始'&&c3.ok,JSON.stringify(c3));

  /* 撮る（`WAVELOG_SHOT`のときだけ）。案（`WAVELOG_PROPOSALS`）は css と apply（画面のセル・ボタンを書き換える関数の字）を持つ。 */
  if(process.env.WAVELOG_SHOT){
   const shot=n=>page.screenshot({path:require('path').join(process.env.WAVELOG_SHOT,`flow-${n}.png`)});
   const props=process.env.WAVELOG_PROPOSALS?require(process.env.WAVELOG_PROPOSALS):[{key:'now',css:'',apply:''}];
   for(const p of props){
    for(const [w,h] of [[1728,1152],[1536,864]]){
     await page.setViewportSize({width:w,height:h});
     await page.evaluate(()=>WL.refreshScheduleIfOpen());await idle();
     await page.evaluate(([css,fn])=>{let t=document.getElementById('pxStyle');if(!t){t=document.createElement('style');t.id='pxStyle';document.head.appendChild(t)}
      t.textContent=css;if(fn)(new Function('return '+fn))()()},[p.css,p.apply]);
     await idle();await shot(`${p.key}-${w}`);
    }
   }
   await page.setViewportSize({width:1728,height:1152});
   await page.evaluate(()=>{const t=document.getElementById('pxStyle');if(t)t.remove()});
  }

  /* ---- 4: 済んだ行は予定の行より前 ---- */
  const order=await page.evaluate(ids=>{const all=[...document.querySelectorAll('.sc-row-line[data-id]')].map(r=>r.dataset.id);
   return {done:all.indexOf(String(ids[0])),run:all.indexOf(String(ids[1])),
    planned:[...document.querySelectorAll('.sc-row-line[data-id]')].filter(r=>/予定/.test((r.querySelector('[data-col="__cat__"]')||{}).textContent||'')).map(r=>all.indexOf(r.dataset.id))}},[s1,s2]);
  rec('4: 済んだ行は作業中・予定の行より前（完了側）',order.done>=0&&order.done<order.run&&order.planned.every(i=>i>order.done),JSON.stringify(order));
 }finally{
  for(const id of made)await post('/api/schedule/plan/delete',{equipment:EQ,id});
  if(rid)await post('/api/schedule/stop-reason-master/delete',{id:rid});
  await post('/api/access-mode',{mode:'edit'});
  await H.clearLayout(TARGET,'test-doneflowui');
 }
},{viewport:{width:1728,height:1152}});
