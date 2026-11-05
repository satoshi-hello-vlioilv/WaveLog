/* test_lotequip.js: 使用設備の予定に、ほかの設備のロットを入れない（§9.637）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   「スケジュールされたデータが使用設備のデータになっているか完全にチェックできていないので、
    使用設備のスケジュールを組むときに使用設備外の対象のデータが組み込まれないように
    エラー対策を実装してください」

   物差し（**直す前にも同じ物差しで測った**・前の値は §9.637 の決定記録）:
    M1. 予定へ入る道（1件の追加・まとめ書込の追加・子ロット）のうち、設計設備の違うロットが通る道の数
    M2. 断るとき、どのロットが・どの設備のものか・どこへ入れるべきかを字で言うか
    M3. 画面が明細の設備を偽っても（または書かなくても）仕掛の行で見抜くか
    M4. 設計設備が分からないロット（仕掛に無い・列が空）は止めない（判定できないことを止める理由にしない）
    M5. すでに予定に入っているほかの設備のロットは、予定を開くと注意で名指しされる
    M6. 画面は送る前に除き、どのロットがなぜ入らないかを字で言う（一度入ったように見せない）
   検証用の仕掛は L0041〜L0046 だけが「テスト設備B」・ほかは「テスト設備A」。**テスト設備Bの予定へ
   Aのロットを入れる**ことで「ほかの設備のロット」を作る。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const OTHER='テスト設備B',LOT='L0011',LOT2='L0012',KID='L0013',UNKNOWN='ZZ_LOTEQUIP_NONE';

run('test_lotequip: 使用設備の予定にほかの設備のロットを入れない（§9.637）', async ({page,rec,B,W,setMode})=>{
 const post=(path,body)=>fetch(B+path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(body)}).then(async r=>({status:r.status,j:await r.json().catch(()=>({}))}));
 const made=[];   // 通ってしまった行（後片付け）
 const add=(lot,detail,extra={})=>post('/api/schedule/plan/add',{equipment:OTHER,kind:'作業',lotNo:lot,
   detail:Object.assign({lotNo:lot},detail),...extra});
 try{
  await setMode('schedule');
  /* M1・M3: 明細に設備を書かない／偽る（仕掛の行は テスト設備A） */
  const a=await add(LOT,{});
  if(a.j.id)made.push(a.j.id);
  rec('M1 1件の追加: 明細に設備が無くても仕掛の行で見抜いて断る',a.status===400&&!a.j.id,JSON.stringify(a));
  const b=await add(LOT,{equipment:OTHER,'BOX設計_設備名':OTHER});
  if(b.j.id)made.push(b.j.id);
  rec('M3 明細の設備を偽っても仕掛の行で見抜いて断る',b.status===400&&!b.j.id,JSON.stringify(b));
  rec('M2 断りの字がロット・設計設備・入れようとした設備を言う',
      /L0011/.test(a.j.error||'')&&/テスト設備A/.test(a.j.error||'')&&/テスト設備B/.test(a.j.error||''),a.j.error||'');
  /* M1: まとめ書込の追加 */
  const c=await post('/api/schedule/plan/batch',{ops:[{op:'add',equipment:OTHER,kind:'作業',lotNo:LOT2,detail:{lotNo:LOT2}}]});
  const cr=(c.j.results||[])[0]||{};
  if(cr.id)made.push(cr.id);
  rec('M1 まとめ書込の追加も断る（その1件の失敗として返す）',c.status===200&&cr.ok===false&&/テスト設備A/.test(cr.error||''),JSON.stringify(c));
  /* M1: 子ロットだけがほかの設備（親は設計設備が分からない） */
  const d=await add(UNKNOWN,{},{children:[{lotNo:KID,detail:{lotNo:KID}}]});
  if(d.j.id)made.push(d.j.id);
  rec('M1 子ロットがほかの設備のものなら親ごと断る',d.status===400&&/L0013/.test(d.j.error||''),JSON.stringify(d));
  /* M4: 設計設備が分からないロットは止めない */
  const e=await add(UNKNOWN,{});
  if(e.j.id)made.push(e.j.id);
  rec('M4 設計設備が分からないロットは止めない',e.status===200&&!!e.j.id,JSON.stringify(e));
  /* 設備停止・申し送りはロットを持たないので関門に掛からない（巻き添えにしない） */
  const f=await post('/api/schedule/plan/add',{equipment:OTHER,kind:'コメント',title:'関門の試し'});
  if(f.j.id)made.push(f.j.id);
  rec('ロットを持たない行（申し送り）は関門に掛からない',f.status===200&&!!f.j.id,JSON.stringify(f));
  /* M5: すでに入っているほかの設備のロット（前の版で入った物）を予定の応答が名指しする。
     関門を通さずに入れる道は無いので、仕掛に無いロットの明細を書き換えて「入れたときの写しが
     ほかの設備を言っている」形を作る（仕掛に無いときは明細の写しで読む）。 */
  if(e.j.id){
   await post('/api/schedule/plan/update',{id:e.j.id,detail:{'BOX設計_設備名':'テスト設備A'}});
  }
  const lst=await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(OTHER)).then(r=>r.json());
  const warn=(lst.warnings||[]).find(w=>/ほかの設備/.test(w))||'';
  const ent=(lst.entries||[]).find(x=>String(x.id)===String(e.j.id))||{};
  rec('M5 入っているほかの設備のロットを予定の応答が注意で名指しする',/テスト設備A/.test(warn),warn||JSON.stringify(lst.warnings));
  rec('M5 その行は理由を持つ（行の印の材料）',/テスト設備A/.test(ent.equipmentIssue||''),JSON.stringify(ent.equipmentIssue||null));

  /* M6: 画面の先回り——テスト設備Aの予定画面へ、仕掛でテスト設備Bのロット（L0041・フィクスチャの種）を入れようと
     すると、送らずに理由を言う（楽観描画の行も出さない）。 */
  const sent=[];
  page.on('request',r=>{if(/\/api\/schedule\/plan\/(add|batch)/.test(r.url()))sent.push(r.postData()||'')});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),'テスト設備A');
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:25000});
  await page.evaluate(e=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===e);if(r)r.click()},'テスト設備A');
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  const ui=await page.evaluate(async lot=>{
   const r=await fetch('/api/table?'+new URLSearchParams({db:'SIKALOTNOW',table:'仕掛',page:1,page_size:5,
     filters:JSON.stringify([{column:'ロット番号',op:'eq',value:lot}])}));
   const row=((await r.json()).rows||[])[0];
   if(!row)return {row:false};
   const before=document.querySelectorAll('.sc-row-line').length;
   window.scAddSelectedRows([row]);
   const toast=[...document.querySelectorAll('#toastArea .toast')].map(x=>x.textContent).join(' ');
   return {row:true,before,after:document.querySelectorAll('.sc-row-line').length,toast};
  },'L0041');
  rec('M6 画面はほかの設備のロットを送らずに、理由を字で言う',ui.row&&ui.before===ui.after&&sent.length===0
      &&/ほかの設備/.test(ui.toast)&&/L0041/.test(ui.toast),JSON.stringify({...ui,sent:sent.length}));
 }finally{
  for(const id of made)await post('/api/schedule/plan/delete',{id}).catch(()=>{});
  await setMode('edit');
 }
});
