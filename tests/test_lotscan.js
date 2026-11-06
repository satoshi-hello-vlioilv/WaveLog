/* test_lotscan.js: バーコードで読んだロットを作業スケジュールの先頭へ（§9.642）
   ============================================================
   利用者の指示「バーコードリーダーで読んだ7桁のロット番号を、すでに組まれている作業スケジュール内から読み込んで
   先頭に持って来る」「無ければ使用設備（対象設備）の仕掛ロットから探して、有れば、組み込む権限がない場合は変更無し・
   権限が無いことを通知、権限がある場合は『仕掛から強制スケジュールします』とメッセージを出し組み込む」。

   物差し（評価関数）:
    S1. 予定の中ほどのロットを読むと、動かせる行の先頭になる（読む前の位置 → 1番目）。並びはサーバーにも残る
    S2. もう先頭のロットを読んでも書かない（改訂番号が動かない）・「もう先頭」と字で言う
    S3. 7桁の英数字でない字は何もせず理由を言う
    S4. 予定にも仕掛にも無いロットは「見つかりません」と言い、予定は変わらない
    S5. 予定に無く仕掛にあるロットは、組み込める端末（スケジュールモード）なら「仕掛から強制スケジュールします」と言い、
        予定の先頭へ入る
    S6. 組み込めない端末（編集モード＝現場の端末）では、仕掛にあっても予定を変えず「組み込む権限が無い」と言う
    S7. 判定（`decide()`）は作業中・固定の行を動かさない（作業中／固定と字で言う）
    S8. 7桁そろった時点で動く（Enter を待たない）
   材料（予定の行）は自分で入れて自分で消す。7桁の仕掛ロットはフィクスチャに無い（5桁）ので、仕掛の行を1件写して
   ロット番号だけ変えた行を`WL.split.lotRow`の答えにする（予定へ入れる道はサーバーの関門まで本物）。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const EQ='テスト設備A';
run('test_lotscan: バーコードで読んだロットを先頭へ（§9.642）', async ({page,rec,B,W,idle,setMode})=>{
 const post=(p,b)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({user_id:'test-scan'},b))})
  .then(async r=>({status:r.status,j:await r.json().catch(()=>({}))}));
 const plan=async()=>((await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json())).entries||[]);
 const movable=es=>es.filter(e=>e.reorderable&&!e.fixedStart&&!e.parentId);
 const tag=('XXXX'+Date.now().toString(36).toUpperCase()).slice(-4);
 const lots=['A','B','C'].map(c=>`S${tag}${c}0`.slice(0,7));
 const WIPLOT=`W${tag}Q1`.slice(0,7),NONE=`N${tag}Z9`.slice(0,7);
 const made=[];

 /* 帯（操作の列）が1行に入るか: 器の右端より右へはみ出した押す物の数と、はみ出した幅（px）。 */
 const barFit=()=>page.evaluate(()=>{const bar=document.querySelector('.hd-viewbar')||document.querySelector('#scHead');
  const box=bar.getBoundingClientRect();const kids=[...bar.querySelectorAll('button,.sc-sync-chip,.sc-tools-label')].filter(b=>b.getClientRects().length&&!b.closest('[hidden]'));
  const over=kids.map(b=>b.getBoundingClientRect()).filter(r=>r.right>box.right+1||r.top>box.top+box.height);
  /* 重なり: 同じ段の隣どうしで左右が食い込む */
  const rs=kids.map(b=>b.getBoundingClientRect()).filter(r=>r.width>0).sort((a,b)=>a.left-b.left);
  let overlap=0;for(let i=1;i<rs.length;i++)if(Math.abs(rs[i].top-rs[i-1].top)<4&&rs[i].left<rs[i-1].right-1)overlap++;
  /* 箱が縮んで字だけが外へはみ出す形（箱どうしは重ならないので上では数えられない） */
  const spill=kids.filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>(b.id||b.className||'').slice(0,24));
  return {over:over.length,overlap,spill,em:+(box.width/parseFloat(getComputedStyle(bar).fontSize)).toFixed(1)}});
 const scan=async v=>{
  if(!await page.$('#scScanBar:not([hidden])'))await page.click('#scScanBtn');
  await page.waitForSelector('.sc-scan-input');
  await page.fill('.sc-scan-input','');
  await page.type('.sc-scan-input',v);
  if(!/^[0-9A-Z]{7}$/.test(v))await page.press('.sc-scan-input','Enter');
  await page.waitForFunction(()=>{const k=WL.lotScan.last()?.kind;return k&&k!=='wip'},null,{timeout:20000});
  await idle();
  return page.evaluate(()=>({kind:WL.lotScan.last().kind,say:document.querySelector('.sc-scan-say')?.textContent||''}));
 };
 try{
  await setMode('schedule');
  for(const lot of lots){const a=await post('/api/schedule/plan/add',{equipment:EQ,kind:'作業',lotNo:lot,detail:{lotNo:lot},position:'end'});if(a.j.id)made.push(a.j.id)}
  rec('材料: 7桁のロットを予定の末尾へ3件',made.length===3,JSON.stringify(made));
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await W.booted(page);await idle();
  await page.evaluate(eq=>WL.scheduleView.open({mode:'single'}).then(()=>{const s=document.querySelector('#scEquipmentSelect');if(s&&s.value!==eq){s.value=eq;s.dispatchEvent(new Event('change'))}}),EQ);
  await page.waitForFunction(lot=>[...document.querySelectorAll('#scTimeline .sc-row-line')].some(r=>r.textContent.includes(lot)),lots[2],{timeout:25000});
  await idle();
  const vis=await page.evaluate(()=>!document.querySelector('#scScanBtn').hidden);
  rec('帯に「読んで先頭へ」が出る（スケジュールモード）',vis,'');
  for(const [w,h] of [[1728,1152],[1536,864]]){await page.setViewportSize({width:w,height:h});await idle();
   const f=await barFit();rec(`S9 帯が1行に収まり重ならない（スケジュールモード・${w}px）`,f.over===0&&f.overlap===0&&!f.spill.length,JSON.stringify(f))}
  await page.setViewportSize({width:1728,height:1152});await idle();
  /* S1 */
  const before=movable(await plan()).map(e=>e.lotNo);
  const r1=await scan(lots[1]);
  await page.waitForFunction(()=>!document.querySelector('#scLockBadge:not([hidden])'),null,{timeout:20000}).catch(()=>{});
  let after=[];for(let i=0;i<30;i++){after=movable(await plan()).map(e=>e.lotNo);if(after[0]===lots[1])break;await new Promise(z=>setTimeout(z,300))}   // 書込の列が共有へ届くのを待つ（理由: 列は裏で流れる）
  rec('S1 中ほどのロットを読むと先頭へ（サーバーの並びも）',r1.kind==='move'&&after[0]===lots[1]&&after.length===before.length,
   `前 ${before.indexOf(lots[1])+1}番目 → 後 ${after.indexOf(lots[1])+1}番目・「${r1.say}」`);
  /* S2 */
  const rev0=(await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json())).revision;
  const r2=await scan(lots[1]);
  const rev1=(await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ)).then(r=>r.json())).revision;
  if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/lotscan-move-1728.png`});
  rec('S2 もう先頭のロットは書かない・字で言う',r2.kind==='top'&&/もう先頭/.test(r2.say)&&rev0===rev1,`「${r2.say}」改訂 ${rev0}→${rev1}`);
  /* S3 */
  const r3=await scan('12AB');
  rec('S3 7桁の英数字でない字は理由を言う',r3.kind==='bad'&&/7桁/.test(r3.say),`「${r3.say}」`);
  /* S4 */
  const n0=(await plan()).length;
  const r4=await scan(NONE);
  rec('S4 予定にも仕掛にも無いロットは「見つかりません」・予定は変わらない',r4.kind==='none'&&/見つかりません/.test(r4.say)&&(await plan()).length===n0,`「${r4.say}」`);
  /* S5: 仕掛の行を1件写してロット番号だけ変える */
  await page.evaluate(lot=>{const real=WL.split.lotRow;window.__realLotRow=real;
   WL.split.lotRow=async q=>{if(q!==lot)return real(q);const r=await real('L0001');if(!r)return null;const c=Object.assign({},r);
    for(const k of Object.keys(c))if(String(c[k])==='L0001')c[k]=lot;return c}},WIPLOT);
  /* 写した行は本物の仕掛に無いので、入ったあとサーバーが「仕掛から消えた＝完了」（§9.514）にする。だから位置は
     **送った位置**（先頭の行の前）で見る（位置の答え方そのものは test_scinsertpos が見ている）。 */
  const head5=movable(await plan())[0];
  const sent=[];const onReq=r=>{if(/\/api\/schedule\/plan\/(add|batch)/.test(r.url())&&r.method()==='POST')sent.push(r.postData()||'')};
  page.on('request',onReq);
  const r5=await scan(WIPLOT);
  let added=null;for(let i=0;i<30;i++){added=(await plan()).find(e=>e.lotNo===WIPLOT);if(added)break;await new Promise(z=>setTimeout(z,300))}   // 書込の列を待つ
  page.off('request',onReq);
  if(added)made.push(added.id);
  const pos=sent.map(t=>{try{const j=JSON.parse(t);return j.position||((j.ops||[])[0]||{}).position||''}catch(e){return ''}}).filter(Boolean);
  rec('S5 仕掛にあるロットは「仕掛から強制スケジュールします」と言い、予定の先頭の行の前へ入れる',
   r5.kind==='add'&&/強制スケジュール/.test(r5.say)&&!!added&&pos.includes(`before:${head5.id}`),
   `「${r5.say}」送った位置 ${pos.join(',')}／先頭の行 ${head5.id}（${head5.lotNo}）・できた行 ${added?added.id:'なし'}`);
  /* S8: 7桁で動いた（scan() は7桁なら Enter を押していない）*/
  rec('S8 7桁そろった時点で動く（Enter を待たない）',r1.kind==='move'&&r5.kind==='add','');
  /* S7: 判定だけ（作業中・固定） */
  const d7=await page.evaluate(()=>{const ctx={equipment:'X',canReorder:true,canAdd:true,blocked:false,entries:[
   {id:1,kind:'作業',lotNo:'AAA0001',state:'着手',reorderable:false},
   {id:2,kind:'作業',lotNo:'AAA0002',state:'予定',reorderable:true},
   {id:3,kind:'作業',lotNo:'AAA0003',state:'予定',reorderable:true,fixedStart:'2026-01-01T00:00'},
   {id:4,kind:'作業',lotNo:'AAA0004',state:'予定',reorderable:true},
   {id:5,kind:'作業',lotNo:'AAA0005',state:'予定',reorderable:false,parentId:4}]};
   return ['aaa0001','AAA0003','AAA-0004','ＡＡＡ0005'].map(v=>WL.lotScan.decide(v,ctx).kind)});
  rec('S7 作業中は動かさない・固定は動かさない・字のゆれ（小文字・ハイフン・全角）を読む・子ロットは親を動かす',
   d7.join(',')==='state,locked,move,move',d7.join(','));
  /* S6: 現場の端末（編集モード）では組み込まない */
  await page.evaluate(()=>{WL.split.lotRow=window.__realLotRow});
  await setMode('edit');
  await page.reload({waitUntil:'domcontentloaded'});await W.booted(page);await idle();
  await page.evaluate(()=>WL.scheduleView.open({mode:'single'}));
  await page.waitForSelector('#scTimeline .sc-row-line',{timeout:25000});await idle();
  const canSee=await page.evaluate(()=>!document.querySelector('#scScanBtn').hidden);
  for(const [w,h] of [[1728,1152],[1536,864]]){await page.setViewportSize({width:w,height:h});await idle();
   const f=await barFit();rec(`S9 帯が1行に収まり重ならない（編集モード・${w}px）`,f.over===0&&f.overlap===0&&!f.spill.length,JSON.stringify(f))}
  await page.setViewportSize({width:1728,height:1152});await idle();
  if(canSee){
   await page.evaluate(lot=>{const real=WL.split.lotRow;WL.split.lotRow=async q=>{if(q!==lot)return real(q);const r=await real('L0001');const c=Object.assign({},r);for(const k of Object.keys(c))if(String(c[k])==='L0001')c[k]=lot;return c}},NONE);
   const n6=(await plan()).length;
   const r6=await scan(NONE);
   if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/lotscan-deny-1728.png`});
   /* 撮るのは指定があるときだけ（§9.432）。読み取りの面の案は WAVELOG_SHOT_VARIANTS（{名前: CSS}）で当てる。 */
   if(process.env.WAVELOG_SHOT&&process.env.WAVELOG_SHOT_VARIANTS){
    const vs=JSON.parse(require('fs').readFileSync(process.env.WAVELOG_SHOT_VARIANTS,'utf8'));
    for(const [name,css] of Object.entries(vs)){
     await page.evaluate(css=>{let st=document.getElementById('shotv');if(!st){st=document.createElement('style');st.id='shotv';document.head.append(st)}st.textContent=css},css);
     for(const [w,h] of [[1728,1152],[1536,864]]){await page.setViewportSize({width:w,height:h});
      await idle();
      await scan(NONE);await page.screenshot({path:`${process.env.WAVELOG_SHOT}/${name}-deny-${w}.png`});
      if(w===1728){await scan(lots[1]);await page.screenshot({path:`${process.env.WAVELOG_SHOT}/${name}-top-${w}.png`})}}
    }
    await page.setViewportSize({width:1728,height:1152});
   }
   rec('S6 組み込めない端末は予定を変えず「組み込む権限が無い」と言う',r6.kind==='deny-add'&&/権限がありません/.test(r6.say)&&/変更していません/.test(r6.say)&&(await plan()).length===n6,`「${r6.say}」`);
  }else{
   const ctx=await page.evaluate(()=>{const c=WL.scheduleView.scanContext();return {r:c.canReorder,a:c.canAdd}});
   rec('S6 並べ替えも組み込みもできない端末にはボタンを出さない',!ctx.r&&!ctx.a,JSON.stringify(ctx));
  }
 }finally{
  await setMode('schedule').catch(()=>{});
  for(const id of made)await post('/api/schedule/plan/delete',{id}).catch(()=>{});
 }
},{viewport:{width:1728,height:1152}});
