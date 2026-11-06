/* test_rptree.js: 帳票の左の一覧を「日付 →（直）→ ロット」の木にする（§9.642）
   ============================================================
   利用者の指摘「帳票の表示画面の左側の対象リストが、数が増えたときに見えないくらい細く潰れてカード表示されるので
   わからないので使えない」「ツリービューで日付（太陽暦と現場歴の切り替え、現場歴の場合は直の階層も追加）と
   ロット情報を階層構造にして、検索しやすい・探しやすいリストに」。

   物差し（評価関数）: 測った記録を N=80 件（10日×3直にばらす）端末に置き、帳票を開く。
    F1. ロットの行がどれも字の高さより低く潰れない（最も低い行 ≥ 24px）
    F2. 行の中身が切れない（scrollHeight ≤ clientHeight の行が全部）
    F3. 日付の節がある（太陽暦の既定）。10日ぶんの記録で節は11（最後の日の夜明け前は暦の翌日）・件数の合計＝80
    F4. 現場歴へ切り替えると「日付 → 直 → ロット」（直の節がある・直の名前は勤務形態マスタの名前）
    F5. 3直の夜明け前（0:00〜7:00）の記録は、現場歴では前の日の節に入る（太陽暦では当日）
    F6. 検索すると当たるロットの節だけが残り、開いて見える（探す手間 0 回）
    F7. 節のチェックで、その節のロットをまとめて選べる（一括印刷の数＝節の件数）
    F8. 行を押すとその帳票が出る（右上の題がそのロット）
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029',EQ='テスト設備A';
run('test_rptree: 帳票の一覧を日付・直・ロットの木にする（§9.642）', async ({page,rec,W,idle,setMode})=>{
 const stamp=Date.now().toString(36).toUpperCase().slice(-5);
 const ids=[];
 try{
  await setMode('edit');
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);await idle();
  /* 10日 × 1日8件（8:00〜翌5:00 の3時間おき＝3直にまたがる）＝80件 */
  const recs=[];const base=new Date();base.setHours(0,0,0,0);base.setDate(base.getDate()-12);
  for(let d=0;d<10;d++)for(let k=0;k<8;k++){
   const t=new Date(base.getTime()+d*864e5+(8+k*3)*36e5);
   const lot=`T${stamp}${String(d*8+k).padStart(2,'0')}`.slice(0,9);
   const id=`RPT-${stamp}-${d}-${k}`;ids.push(id);
   recs.push({id,status:k%3?'完了':'編集中',updatedAt:t.toISOString(),registeredEquipment:EQ,
    basic:{lotNo:lot,inspectionNo:'K'+k,castingNo:'C'},settings:{operator:'網',registeredEquipment:EQ},
    workTime:{startAt:t.toISOString(),endAt:new Date(t.getTime()+40*6e4).toISOString()},measurements:{},
    syncState:{status:'synced',lastAttempt:t.toISOString(),lastError:'',attempts:1}});
  }
  await page.evaluate(async rs=>{for(const r of rs)await WL.records.reliablePut(WL.measureView.ensureMeasureShape(r))},recs);
  await page.evaluate(id=>window.openReportForRecord(id),ids[0]);
  await page.waitForFunction(()=>document.querySelectorAll('#reportLotList .rp-lot-row').length>0||document.querySelector('#reportLotList .rp-tree'),null,{timeout:20000});
  await idle();
  /* 自分の80件だけにして全部見える状態で測る（前の作りは一覧そのまま・木は探すと当たった節が全部開く） */
  if(await page.$('#reportSearch')){await page.fill('#reportSearch',`T${stamp}`);await idle()}
  const rows=await page.evaluate(()=>[...document.querySelectorAll('#reportLotList .rp-lot-row')].map(r=>({h:r.getBoundingClientRect().height,clip:r.scrollHeight>r.clientHeight+1})));
  const shown=rows.filter(r=>r.h>0);
  const minH=shown.length?Math.min(...shown.map(r=>r.h)):0;
  rec('F1. 見えているロットの行がどれも潰れない（最も低い行 ≥ 24px）',minH>=24,`最も低い行 ${minH.toFixed(1)}px・見えている行 ${shown.length}／${rows.length}`);
  if(process.env.WAVELOG_SHOT)await page.screenshot({path:`${process.env.WAVELOG_SHOT}/rptree-${page.viewportSize().width}.png`});
  rec('F2. 行の中身が切れない',shown.length>0&&shown.every(r=>!r.clip),`切れている行 ${shown.filter(r=>r.clip).length}`);
  await page.fill('#reportSearch','');await idle();
  /* F3: 太陽暦（既定）の日の節 */
  const tree=()=>page.evaluate(()=>[...document.querySelectorAll('#reportLotList .rp-tn--d0')].map(n=>({
   label:n.querySelector(':scope>.rp-tn-head .rp-tn-label')?.textContent||'',
   count:+((n.querySelector(':scope>.rp-tn-head .rp-tn-count')?.textContent||'').replace(/\D/g,''))||0,
   open:n.getAttribute('aria-expanded')==='true',
   shifts:[...n.querySelectorAll(':scope>.rp-tn-kids>.rp-tn--d1')].map(c=>({label:c.querySelector('.rp-tn-label')?.textContent||'',count:+((c.querySelector('.rp-tn-count')?.textContent||'').replace(/\D/g,''))||0})),
   lots:[...n.querySelectorAll('.rp-lot-row b')].map(b=>b.textContent)})));
  const setBasis=async k=>{await page.click(`#reportBasis [data-basis="${k}"]`);
   await page.waitForFunction(k=>document.querySelector(`#reportBasis [data-basis="${k}"]`)?.classList.contains('is-on')
     &&!/引いています/.test(document.querySelector('#reportLotList')?.textContent||''),k,{timeout:15000});await idle()};
  await setBasis('cal');
  await page.fill('#reportSearch',`T${stamp}`);await idle();
  const mineTree=await tree();
  const calSum=mineTree.reduce((a,n)=>a+n.count,0);
  rec('F3. 太陽暦の日の節がある（自分の80件で: 節 11＝10日＋最後の日の夜明け前ぶん・件数の合計 80）',mineTree.length===11&&calSum===80,`日の節 ${mineTree.length}・件数の合計 ${calSum}`);
  await page.fill('#reportSearch','');await idle();
  /* F5 の材料: 太陽暦で、ある日の 2:00 と 5:00 の記録（k=6,7 → 8+18=26時=翌2時, 29時=翌5時）がどの日に居るか */
  const dayOf=(t,lot)=>(t.find(n=>n.lots.includes(lot))||{}).label||'';
  /* 閉じた節の中身は描かないので、探して開く */
  const find=async q=>{await page.fill('#reportSearch',q);await idle()};
  const lotOf=(d,k)=>`T${stamp}${String(d*8+k).padStart(2,'0')}`.slice(0,9);
  await find(lotOf(3,6));const calNight=dayOf(await tree(),lotOf(3,6));
  await find(lotOf(3,0));const calDay=dayOf(await tree(),lotOf(3,0));
  await find('');
  /* F4: 現場歴 */
  await setBasis('work');
  const work=await tree();
  const shiftNames=await page.evaluate(async()=>{const r=await fetch('/api/schedule/shift-pattern-master?scope=all').then(r=>r.json()).catch(()=>({}));
   return JSON.stringify(r).match(/"名称":"[^"]+"|"name":"[^"]+"/g)||[]});
  const opened=work.find(n=>n.open)||{shifts:[]};
  rec('F4. 現場歴は「日付 → 直 → ロット」（開いた日の下に直の節・直の名前は勤務形態マスタの名前）',
   opened.shifts.length>=2&&opened.shifts.every(s=>s.label==='直なし'||shiftNames.some(n=>n.includes(`"${s.label}"`))),
   `開いた日 ${opened.label||'-'} の直: ${opened.shifts.map(s=>`${s.label}(${s.count})`).join('・')||'なし'}／マスタの名前 ${shiftNames.length}件`);
  await find(lotOf(3,6));const workNight=dayOf(await tree(),lotOf(3,6));
  rec('F5. 夜明け前の記録は太陽暦では翌日・現場歴では前の日（始まった直の日）',
   !!calNight&&!!calDay&&calNight!==calDay&&workNight===calDay,`太陽暦: 昼 ${calDay}・夜明け前 ${calNight}／現場歴: 夜明け前 ${workNight}`);
  /* F6: 探すと当たった節だけ・開いて見える */
  const q=lotOf(5,2);await find(q);
  const hit=await tree();
  const vis=await page.evaluate(q=>[...document.querySelectorAll('#reportLotList .rp-lot-row')].filter(r=>r.textContent.includes(q)&&r.getClientRects().length).length,q);
  rec('F6. 探すと当たる節だけが残り、そのロットが開いて見える（開く操作 0 回）',hit.length===1&&vis===1,`節 ${hit.length}・見えている当たり ${vis}`);
  await find('');
  /* F7: 節のチェックで節のロットをまとめて選ぶ */
  await setBasis('cal');
  const firstOpen=(await tree()).find(n=>n.open);
  await page.click('#reportLotList .rp-tn--d0[aria-expanded="true"] > .rp-tn-head .rp-tn-check');
  const picked=await page.evaluate(()=>+((document.querySelector('#reportBulkCount')||{}).textContent||0));
  rec('F7. 節のチェックで、その節のロットをまとめて一括印刷に選べる',!!firstOpen&&picked===firstOpen.count,`節 ${firstOpen?.count}件・選んだ ${picked}件`);
  await page.click('#reportLotList .rp-tn--d0[aria-expanded="true"] > .rp-tn-head .rp-tn-check');
  /* F8: 行を押すとその帳票 */
  const target=lotOf(7,4);await find(target);
  await page.click(`#reportLotList .rp-lot-row .rp-lot-main-btn:has-text("${target}")`);
  await page.waitForFunction(t=>(document.querySelector('#reportSelectedTitle')?.textContent||'').includes(t),target,{timeout:15000}).catch(()=>{});
  const title=await page.evaluate(()=>document.querySelector('#reportSelectedTitle')?.textContent||'');
  rec('F8. 行を押すとその帳票が出る（右上の題がそのロット）',title.includes(target),`題「${title}」`);
  /* 撮るのは指定があるときだけ（§9.432）。案の見た目は WAVELOG_SHOT_VARIANTS（{名前: CSS}の JSON ファイル）で当てる。 */
  if(process.env.WAVELOG_SHOT&&process.env.WAVELOG_SHOT_VARIANTS){
   const vs=JSON.parse(require('fs').readFileSync(process.env.WAVELOG_SHOT_VARIANTS,'utf8'));
   for(const [name,css] of Object.entries(vs)){
    await page.evaluate(css=>{let st=document.getElementById('shotv');if(!st){st=document.createElement('style');st.id='shotv';document.head.append(st)}st.textContent=css},css);
    for(const [w,h] of [[1728,1152],[1536,864]]){
     await page.setViewportSize({width:w,height:h});
     await find('');await setBasis('work');await idle();
     await page.screenshot({path:`${process.env.WAVELOG_SHOT}/${name}-work-${w}.png`});
     if(w===1728){await find(`T${stamp}0`);await page.screenshot({path:`${process.env.WAVELOG_SHOT}/${name}-search-${w}.png`});
      await find('');await setBasis('cal');await page.screenshot({path:`${process.env.WAVELOG_SHOT}/${name}-cal-${w}.png`})}
    }
   }
   await page.setViewportSize({width:1728,height:1152});
  }
 }finally{
  await page.evaluate(async ids=>{for(const id of ids)await WL.records.reliableDelete(id).catch(()=>{})},ids).catch(()=>{});
 }
},{viewport:{width:1728,height:1152}});
