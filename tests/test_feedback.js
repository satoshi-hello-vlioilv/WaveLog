/* test_feedback.js: 失敗を「開発へ報告できる形」で残す（§9.373）
   ============================================================
   利用者の指示:
    「何か失敗した時に通知するだけでなく、開発へフィードバックができるように
      解析しやすい情報を組み込んだ開発フィードバック用ログを残せるようにして、
      使用者からコピーボタンひとつでデータを報告できる仕組みを追加して」

   ここで固定すること:
    1. 失敗すると**報告が1件残る**（端末にも残り、画面を開き直しても読める）
    2. 報告には**解析に要るものが入っている**——何をしようとしたか／理由／
       HTTPの返事／そのときの画面の状態／直前の足あと／版・端末
    3. **機械で読む1行**（`WLFB1 {...}`）が末尾に付く
    4. 失敗の知らせに**「報告用にコピー」が出て、1手でコピーできる**
    5. **あとからでも同じ1通を出せる**（ログ・診断の「開発へ報告」）
    6. 文脈は**画面が名乗る**（土台に画面の知識を書かない）

   待ちは条件で置く（§9.347）。骨組みは`tests/lib/harness.js`。
   ============================================================ */
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';

run('test_feedback: 失敗を開発へ報告できる形で残す（§9.373）',
 async({page,rec,B,idle,W})=>{
  const made=[];
  const post=(p,body)=>page.evaluate(async a=>{
   const r=await fetch(a.p,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({user_id:'test-feedback'},a.b))});
   let j={};try{j=await r.json()}catch(e){j={parseError:String(e)}}
   return {status:r.status,body:j};
  },{p,b:body||{}});
  try{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.evaluate(e=>{localStorage.setItem('AccessMeasurementConfiguredEquipment',e);
                           localStorage.setItem('AccessMeasurementUserId','tester');
                           localStorage.removeItem('wlFeedbackLogV1')},EQ);
   await post('/api/access-mode',{mode:'schedule'});
   await page.reload({waitUntil:'domcontentloaded'});
   await W.booted(page);
   await page.waitForSelector('#openSchedule',{timeout:25000});

   /* ---- 6. 土台の口が在る ---- */
   const api=await page.evaluate(()=>Object.keys(window.WL&&WL.feedback||{}).sort());
   rec('WL.feedback の口が在る',
       ['note','provide','copyReport','openReport','reportText','log'].every(k=>api.includes(k)),
       api.join(','));

   await page.click('#openSchedule');
   await page.waitForSelector('.sc-board-row',{timeout:25000});
   await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
     .find(x=>x.dataset.equipment===e);if(r)r.click()},EQ);
   await page.waitForSelector('.sc-row-line',{timeout:30000});
   await idle(400,20000);

   /* ---- 材料は自分で用意する（§9.351） ---- */
   const lot='FB'+process.pid;
   const add=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot});
   const id=String((add.body&&add.body.id)||'');
   made.push(id);
   await page.evaluate(()=>WL.refreshScheduleIfOpen());
   await page.waitForSelector(`.sc-row-line[data-id="${id}"]`,{timeout:20000});
   await idle(300,15000);

   /* ---- 1・4. 失敗させて、報告が残り・コピーの1手が出る ---- */
   await page.route('**/api/schedule/plan/delete',r=>r.fulfill({status:423,
     contentType:'application/json',body:JSON.stringify({error:'テスト設備Aは other@PC-B が編集中です。'})}));
   await page.route('**/api/schedule/plan/batch',r=>r.fulfill({status:423,
     contentType:'application/json',body:JSON.stringify({error:'テスト設備Aは other@PC-B が編集中です。'})}));
   await page.click(`.sc-row-line[data-id="${id}"] .sc-row-delete`);
   await page.waitForSelector('#appConfirmOk',{state:'visible',timeout:8000});
   await page.click('#appConfirmOk');
   const gotBtn=await page.waitForSelector('#toastArea .toast-act',{timeout:20000})
     .then(()=>true,()=>false);
   rec('失敗の知らせに「その場で押せる1手」が出る',gotBtn);
   const label=await page.evaluate(()=>{
    const b=document.querySelector('#toastArea .toast-act');return b?b.textContent.trim():''});
   rec('その1手は「報告用にコピー」',label==='報告用にコピー',label);

   const n=await page.evaluate(()=>WL.feedback.log().length);
   rec('失敗が報告として1件残る',n>=1,`${n}件`);

   /* ---- 2・3. 報告の中身 ---- */
   const text=await page.evaluate(()=>{
    const l=WL.feedback.log();return WL.feedback.reportText(l[l.length-1])});
   const has=w=>text.includes(w);
   rec('何をしようとしたかが入っている',has('何をしようとしたか')&&has('予定から外せませんでした'),
       text.split('\n').slice(0,4).join(' / ').slice(0,120));
   rec('理由とHTTPの返事が入っている',has('編集中')&&has('HTTP 423'),
       (text.match(/サーバーの返事.*/)||[''])[0]);
   rec('そのときの画面の状態が入っている（画面が名乗ったぶん）',
       has('[作業スケジュール]')&&has('設備')&&has('編集権'),'');
   rec('この端末のことが入っている（版・端末・ブラウザ）',
       has('[この端末]')&&has('版')&&has('ブラウザ'),'');
   /* **版は解析の要**——「読めません」のままでは、どの版の話か分からない。 */
   const ver=(text.match(/版: (.*)/)||['',''])[1].trim();
   rec('版が実際に入っている（空でも「読めません」でもない）',
       /^VER\d/.test(ver),ver||'（空）');
   rec('直前の足あとが入っている',has('直前の足あと'),'');
   rec('機械で読む1行が末尾に付く',/\nWLFB1 \{/.test(text),
       (text.match(/WLFB1 .{0,40}/)||[''])[0]);
   rec('機械で読む1行はJSONとして読める',await page.evaluate(()=>{
    const l=WL.feedback.log();const t=WL.feedback.reportText(l[l.length-1]);
    const m=t.match(/\nWLFB1 (\{[\s\S]*)$/);
    if(!m)return false;
    try{const o=JSON.parse(m[1]);return !!o.what&&!!o.ctx}catch(e){return String(e)}
   })===true);

   await page.unroute('**/api/schedule/plan/delete');
   await page.unroute('**/api/schedule/plan/batch');

   /* ---- 1（続き）. 端末に残る＝開き直しても読める ---- */
   const kept=await page.evaluate(()=>{
    try{return (JSON.parse(localStorage.getItem('wlFeedbackLogV1')||'[]')||[]).length}
    catch(e){return 'ERR '+e.message}
   });
   rec('報告は端末に残る（開き直しても読める）',kept>=1,String(kept));

   /* ---- 5. あとからでも同じ1通を出せる ----
      **実際に開いて確かめる**——器はパネルを組み立てたときに作られるので、
      開かずに`getElementById`しても`null`で、素通りしてしまう（一度そう書いた）。 */
   await page.evaluate(()=>WL.logView&&WL.logView.open&&WL.logView.open());
   const gotEntry=await page.waitForSelector('#lgFeedback',{timeout:15000})
     .then(()=>true,()=>false);
   rec('ログ・診断に「開発へ報告」の入口がある（知らせは消えるので）',gotEntry);
   const title=await page.evaluate(()=>{
    const b=document.getElementById('lgFeedback');return b?b.textContent.trim():''});
   rec('入口の題は「開発へ報告」',title==='開発へ報告',title);
   /* 押したら窓が出て、中に同じ1通が入っている（コピーの手前まで見る）。 */
   await page.click('#lgFeedback');
   const opened=await page.waitForSelector('.fb-text',{timeout:10000}).then(()=>true,()=>false);
   rec('押すと報告の窓が出る',opened);
   const inWin=await page.evaluate(()=>{
    const t=document.querySelector('.fb-text');return t?t.value.slice(0,2000):''});
   rec('窓の中身は同じ1通（機械で読む1行まで入っている）',
       inWin.includes('WaveLog 不具合報告')&&inWin.includes('WLFB1 {'),inWin.slice(0,80));
   const ok=await page.$('#appConfirmOk');if(ok)await ok.click();
  }finally{
   for(const id of made)if(id)await post('/api/schedule/plan/delete',{equipment:EQ,id});
   const left=await page.evaluate(async e=>{
    const r=await fetch('/api/schedule/plan?equipment='+encodeURIComponent(e)+'&history_hours=8');
    const j=await r.json();
    return (j.entries||[]).filter(x=>String(x.lotNo||'').startsWith('FB')).length;
   },EQ).catch(e=>{console.log('後始末の確認に失敗: '+e.message);return -1});
   rec('後片付け: 置いた予定が消えている',left===0,`残り${left}件`);
   await page.evaluate(()=>{try{localStorage.removeItem('wlFeedbackLogV1')}
     catch(e){console.log('報告ログを消せない: '+e.message)}}).catch(e=>console.log(String(e)));
  }
 },{mode:'schedule'});
