/* test_schistui.js: 作業スケジュールの過去履歴——段「履歴」（§9.502、利用者の指示・案A）
   ------------------------------------------------------------
   「過去履歴については、Aで対応し、設備停止も含んだ形で記録のすべてを残し、フィルタなども
    検索しやすいように実装してわかりやすく使いやすい形でUIUX設計をお願いします。」

   物差し:
    1. 予定から**外した作業・外した設備停止・申し送り**が、区分の字つきで履歴に出る（前は0件）
    2. 区分の札の件数が表の行の数と合う／札を押すとその区分だけ隠れて戻る
    3. 探す: この期間で当たる・当たらなければ「全期間から探す」が次の1手として出る
    4. 期間を送ると見出しが変わり、記録の無い日は「記録のある近くの日」へ1手で戻れる
    5. 見るだけ: 予定を直す道具（設備停止・申し送り・枠・印刷）を出さない／「個別へ戻る」で戻れる
    6. 1段目（送り・単位・探す）は1行、画面は横にはみ出さない
   材料は自分で作る（予定を足して外す）。後片付けは土台の`reseed`と、足した停止理由の削除。 */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
const TAG='HIST'+String(process.pid).slice(-4);

run('test_schistui: 作業スケジュールの過去履歴（段「履歴」・§9.502）',async({page,rec,B,W,idle,errs})=>{
 const post=(p,body)=>page.evaluate(async a=>{
  const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-schist'},a.b))});
  let j={};try{j=await r.json()}catch(e){}
  return {status:r.status,body:j};
 },{p,b:body||{}});
 let seededStopId=null;
 const shot=async n=>{if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/schist-${n}.png`})};
 try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  /* ---- 材料: 作業1件・設備停止1件を足して外す／申し送りを1件 ---- */
  const stops=await page.evaluate(async e=>((await (await fetch('/api/schedule/stop-reason-master?equipment='+encodeURIComponent(e))).json()).items||[]),EQ);
  let stopId=stops[0]&&stops[0].id;
  if(!stopId){
   const r=await post('/api/schedule/stop-reason-master',{equipment:EQ,category:'その他',name:TAG+'停止',standardMinutes:15});
   seededStopId=stopId=r.body&&r.body.id;
  }
  await post('/api/schedule/session/acquire',{equipment:EQ});
  const w=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:TAG+'W1',title:TAG+'W1',detail:{lotNo:TAG+'W1'}});
  const s=await post('/api/schedule/plan/add',{equipment:EQ,kind:'設備停止',stopReasonId:stopId,estimateMinutes:25});
  const cm=await post('/api/schedule/plan/add',{equipment:EQ,kind:'コメント',title:TAG+' 次は幅狭から'});
  const d1=await post('/api/schedule/plan/delete',{id:w.body.id});
  const d2=await post('/api/schedule/plan/delete',{id:s.body.id});
  rec('前提: 作業・設備停止・申し送りを入れて、作業と設備停止を外せた',
      [w,s,cm,d1,d2].every(r=>r.status===200),[w,s,cm,d1,d2].map(r=>r.status).join(','));

  await W.openSchedule(page,EQ);
  await idle();
  await page.click('#scModeHistory');
  await W.until(page,()=>{const s=WL.scheduleHistory&&WL.scheduleHistory.state();return s&&!s.loading&&s.count>0},null,{ms:20000,what:'履歴が読めた'});
  await idle();
  await shot('1-today');

  /* 1. 区分の字つきで出る */
  const rows=()=>page.evaluate(()=>[...document.querySelectorAll('#scHistBody .sh-row')].map(r=>({
   cat:r.dataset.cat,tag:(r.querySelector('.sh-tag')||{}).textContent||'',text:r.textContent.replace(/\s+/g,' ')})));
  let rs=await rows();
  const mine=rs.filter(r=>r.text.includes(TAG));
  const has=(cat,label)=>rs.some(r=>r.cat===cat&&r.tag===label&&(cat==='stop'||r.text.includes(TAG)));
  rec('1: 外した作業が「外した作業」の字つきで出る',has('removed','外した作業'),JSON.stringify(mine.map(r=>r.cat)));
  rec('1: 外した設備停止が「設備停止」の字つきで出る（見積の分と、入れた→外したの時刻）',
      rs.some(r=>r.cat==='stop'&&r.tag==='設備停止'&&/見積/.test(r.text)&&/→/.test(r.text)),
      JSON.stringify(rs.filter(r=>r.cat==='stop').map(r=>r.text.slice(0,80))));
  rec('1: 申し送りが「申し送り」の字つきで出る',has('comment','申し送り'),'');
  const vis=await page.evaluate(()=>({single:!document.getElementById('scSingleBody').hidden,
   hist:!document.getElementById('scHistBody').hidden,
   active:document.getElementById('scModeHistory').classList.contains('active')}));
  rec('1: 段「履歴」が選ばれ、個別の表とは入れ替わる',vis.hist&&!vis.single&&vis.active,JSON.stringify(vis));

  /* 2. 札の件数＝行の数・押すと隠れて戻る */
  const chips=()=>page.evaluate(()=>[...document.querySelectorAll('#shCats [data-cat]')].map(b=>({
   cat:b.dataset.cat,n:+(b.querySelector('b')||{}).textContent,on:b.classList.contains('is-on')})));
  let cs=await chips();
  const bad=cs.filter(c=>c.on&&c.n!==rs.filter(r=>r.cat===c.cat).length);
  rec('2: 区分の札の件数が表の行の数と合う',cs.length===6&&!bad.length,JSON.stringify(cs));
  await page.click('#shCats [data-cat="stop"]');
  rs=await rows();cs=await chips();
  const stopChip=cs.find(c=>c.cat==='stop');
  rec('2: 設備停止の札を押すと設備停止の行だけ隠れ、札は件数を持ったまま「隠している」になる',
      !rs.some(r=>r.cat==='stop')&&rs.some(r=>r.cat==='removed')&&stopChip&&!stopChip.on&&stopChip.n>=1,JSON.stringify(stopChip));
  await page.click('#shCats [data-cat="stop"]');
  rs=await rows();
  rec('2: もう1回押すと戻る',rs.some(r=>r.cat==='stop'),'');

  /* 3. 探す */
  const search=async q=>{await page.fill('#shQuery',q);
   await W.until(page,q=>{const s=WL.scheduleHistory.state();return s.q===q&&!s.loading},q,{ms:10000,what:'探し終えた'});
   await W.until(page,()=>!WL.scheduleHistory.state().loading,null,{ms:10000,what:'読み終えた'})};
  await search(TAG+'W1');
  rs=await rows();
  rec('3: ロット番号で探すとその記録だけになる',rs.length===1&&rs[0].cat==='removed',JSON.stringify(rs.map(r=>r.cat)));
  await search(TAG+'存在しない語');
  const empty=await page.evaluate(()=>{const b=document.querySelector('#shScroll [data-empty="all"]');return {text:(document.querySelector('#shScroll .sh-empty')||{}).textContent||'',btn:b?b.textContent:''}});
  rec('3: 当たらなければ理由と「全期間から探す」の1手を出す',/ありません/.test(empty.text)&&empty.btn==='全期間から探す',JSON.stringify(empty));
  await search('');

  /* 4. 送り */
  const label0=await page.textContent('#shPeriod');
  await page.click('#shPrev');
  await W.until(page,()=>!WL.scheduleHistory.state().loading,null,{ms:10000,what:'前の日を読めた'});
  await page.click('#shPrev');
  await W.until(page,()=>!WL.scheduleHistory.state().loading,null,{ms:10000,what:'前の日を読めた'});
  const label1=await page.textContent('#shPeriod');
  const near=await page.evaluate(()=>{const b=document.querySelector('#shScroll [data-empty="day"]');return b?b.textContent:''});
  rec('4: 前へ送ると期間の見出しが変わる',label0!==label1,`${label0} → ${label1}`);
  rec('4: 記録の無い日は「記録のある近くの日」へ1手で戻れる',/記録のある近くの日/.test(near),near);
  if(near){
   await page.click('#shScroll [data-empty="day"]');
   await W.until(page,()=>!WL.scheduleHistory.state().loading&&WL.scheduleHistory.state().count>0,null,{ms:10000,what:'近くの日を読めた'});
  }
  await page.click('#shUnits [data-unit="week"]');
  await W.until(page,()=>{const s=WL.scheduleHistory.state();return s.unit==='week'&&!s.loading},null,{ms:10000,what:'週で読めた'});
  const wk=await page.evaluate(()=>WL.scheduleHistory.state().period);
  const days=(new Date(wk[1])-new Date(wk[0]))/86400000+1;
  rec('4: 単位を「週」にすると月曜〜日曜の7日になる',days===7&&new Date(wk[0]+'T00:00').getDay()===1,JSON.stringify(wk));
  await shot('2-week');
  await page.click('#shUnits [data-unit="day"]');
  await page.click('#shToday');
  await W.until(page,()=>!WL.scheduleHistory.state().loading,null,{ms:10000,what:'今日を読めた'});

  /* 5. 見るだけ */
  const tools=await page.evaluate(()=>['#scStopModalBtn','#scCommentBtn','#scFrameBtn','#scPrintBtn'].map(s=>{
   const e=document.querySelector(s);return e?{s,shown:!e.hidden&&e.getClientRects().length>0}:{s,shown:false}}));
  rec('5: 予定を直す道具（設備停止・申し送り・枠・印刷）を出さない',tools.every(t=>!t.shown),JSON.stringify(tools.filter(t=>t.shown)));
  const ro=await page.evaluate(()=>(document.querySelector('#shSide .sh-ro')||{}).textContent||'');
  rec('5: 見るだけだと画面が言う',/見るだけ/.test(ro),ro);

  /* 6. 1段目は1行・はみ出さない */
  const geo=await page.evaluate(()=>{
   const bar=document.getElementById('shBar');
   /* 高さの無い物（間を空けるだけの`.sh-grow`）は行を持たないので数えない。 */
   const kids=[...bar.children].filter(e=>e.getBoundingClientRect().height>0);
   const tops=new Set(kids.map(e=>Math.round(e.getBoundingClientRect().top/4)));
   return {rows:tops.size,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
  });
  rec('6: 1段目（送り・単位・探す）は1行に収まり、画面は横にはみ出さない',geo.rows===1&&geo.overflow<=0,JSON.stringify(geo));

  await page.click('#shToSingle');
  const back=await page.evaluate(()=>!document.getElementById('scSingleBody').hidden&&document.getElementById('scHistBody').hidden);
  rec('5: 「個別へ戻る」で個別の表へ戻る',back,'');
  rec('画面の例外が出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }finally{
  if(seededStopId)await post('/api/schedule/stop-reason-master/delete',{id:seededStopId});
 }
},{mode:'schedule',viewport:{width:1700,height:1000}});
