/* test_mmfold.js: マスタ一覧の「束ねた見出しの開閉」(§9.241 ①、利用者の指示)
   ============================================================
   「ロールマスタについて、設備名毎に折りたためるようにしてください。」

   ここで固定するのは次の点。
    1. 設備ごとの見出しを押すと**その群の行が消え、見出しと件数は残る**
       （押した群だけ。隣の群は開いたまま）
    2. **状態は色だけで伝えない**（§CLAUDE 3）——`aria-expanded`と
       「畳んでいます」の文字が出る
    3. **この端末に覚える**——画面を開き直しても畳んだまま
    4. 【§9.556で撤回】絞り込み中は畳まない——マスタ管理の絞り込みそのものを外した
       （利用者の指示「最上部の絞り込みの検索バーもあまり意味がないので基本的に削除」）
    5. すべて開く／すべて畳む が効く
    6. **保存した行の群は開く**——畳んだ設備へ足したのに一覧へ出ないのは
       「消えた」と読まれる

   **材料は自分で注ぎ込むこと**——検証用フィクスチャにロールは1本も無く、
   群が1つも無い一覧を見ても「畳めない」と「壊れている」を見分けられない
   （test_roll.js と同じ注意）。2つの設備へ分けて入れる。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const TAG='MF'+process.pid;
const EQ='テスト設備A',EQ2='テスト設備B';
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const getj=async p=>(await fetch(B+p)).json();
const made=[];

/* 盤の状態を1つの形で読む。**行は「作らない」ので数える**（§9.104）——
   `display:none`で隠す実装に戻ったらここが気づく。 */
const SNAP=`(()=>{
 const heads=[...document.querySelectorAll('#masterMaintList .mm-group-head')];
 const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
 return {
  群:heads.map(h=>({名:h.dataset.mmGroup,
                    開:h.getAttribute('aria-expanded')==='true',
                    文:h.textContent.trim(),
                    押せる:h.getAttribute('role')==='button'})),
  行:rows.length,
  行文:rows.map(r=>r.textContent).join(' | '),
  帯:(()=>{const t=document.getElementById('masterMaintFold');
      return t&&!t.hidden?{文:t.textContent.trim(),
        すべて畳む押せる:!(t.querySelector('[data-mm-fold="close"]')||{}).disabled,
        すべて開く押せる:!(t.querySelector('[data-mm-fold="open"]')||{}).disabled}:null})(),
 };
})()`;

run('test_mmfold: マスタ一覧の「束ねた見出しの開閉」(§9.241 ①、利用者の指示)', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  await post('/api/access-mode',{mode:'edit'});
  const mk=async body=>{
   const r=await (await post('/api/roll-master',{user_id:'test',...body})).json();
   if(r.id)made.push(r.id);
   return r;
  };
  /* 設備Aに3本・設備Bに2本。**片方だけ畳んでも他方が残る**ことを見るため。 */
  for(const n of ['A1','A2','A3'])await mk({equipment:EQ,name:TAG+n,diaMax:200});
  for(const n of ['B1','B2'])await mk({equipment:EQ2,name:TAG+n,diaMax:300});


  /* 一覧を開く。**畳みはこの端末の覚え**なので、他の実行の置き土産を
     先に捨てる（残っていると「既定は開く」を確かめられない）。 */
  const openRollTab=async()=>{
   await page.waitForSelector('#openMasterMaint',{timeout:20000});
   await page.click('#openMasterMaint');
   await page.waitForSelector('#masterMaintPanel',{state:'visible',timeout:10000});
   /* 更新者IDは打ち込む欄ではなくなった（§9.276 ③）。端末の覚え（localStorage）へ入れる。 */
   await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tester');
   /* **ナビが出るまで待ってから押す**（§9.102。押す前に待たないと、
      速い実行では効いて遅い実行では空振りする——実際に通しで踏んだ）。 */
   await page.waitForSelector('#masterMaintNav [data-master="roll"]',{timeout:20000});
   await page.click('#masterMaintNav [data-master="roll"]');
   await page.waitForFunction(()=>{
    const nav=document.querySelector('#masterMaintNav [data-master="roll"]');
    return !!(nav&&nav.classList.contains('active'))
        && !!document.querySelector('#masterMaintList .mm-group-head');
   },null,{timeout:20000});
  };
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  /* 起動の取得が静まってから書き換え・読み込み直す（すぐ reload すると初期化の取得が
     打ち切られ、アプリが「初期化エラー」を console へ出す・§9.451）。 */
  await W.booted(page); await idle();
  await page.evaluate(()=>{try{localStorage.removeItem('MasterListFoldV1')}catch(e){}});
  await page.reload({waitUntil:'domcontentloaded'});
  await openRollTab();

  const head=async name=>page.evaluate(n=>{
   const h=[...document.querySelectorAll('#masterMaintList .mm-group-head')]
     .find(x=>x.dataset.mmGroup===n);
   if(!h)return false;
   h.click();return true;
  },name);
  const snap=()=>page.evaluate(SNAP);
  /* **描き直しは同期**（クリックの中で`renderMaintList()`まで走る）が、
     待ちは条件で置く（§9.102）——固定待ちにすると速い端末でも遅い端末でも
     別のものを測る。 */
  const settle=async()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

  const s0=await snap();
  rec('設備ごとの見出しが出ていて、どれも開いている',
      s0.群.length>=2&&s0.群.every(g=>g.開)&&s0.行>=5,JSON.stringify(s0.群));
  rec('見出しが押せる（role=button）',s0.群.every(g=>g.押せる),JSON.stringify(s0.群.map(g=>g.押せる)));
  rec('開閉の帯が出ている',!!s0.帯&&/開\s*\d/.test(s0.帯.文),JSON.stringify(s0.帯));
  const rowsA=s0.行文.split('|').filter(t=>t.includes(TAG+'A')).length;

  /* ---- 1) 押した群だけ畳む ---- */
  rec('前提: 設備Aの行が一覧にある',rowsA>=3,String(rowsA));
  await head(EQ);await settle();
  const s1=await snap();
  const gA=s1.群.find(g=>g.名===EQ),gB=s1.群.find(g=>g.名===EQ2);
  rec('押した群は畳まれる（行が消える・見出しは残る）',
      !!gA&&!gA.開&&!s1.行文.includes(TAG+'A'),JSON.stringify({gA,行文:s1.行文.slice(0,120)}));
  rec('件数は畳んでも残る',!!gA&&/件/.test(gA.文),gA&&gA.文);
  rec('畳んだことを文字でも言う（§3）',!!gA&&/畳んでいます/.test(gA.文),gA&&gA.文);
  rec('隣の群は開いたまま（押した群だけ畳む）',
      !!gB&&gB.開&&s1.行文.includes(TAG+'B'),JSON.stringify(gB));

  /* ---- 2) この端末に覚える ---- */
  await page.reload({waitUntil:'domcontentloaded'});
  await openRollTab();
  const s2=await snap();
  const gA2=s2.群.find(g=>g.名===EQ);
  rec('開き直しても畳んだまま（この端末に覚える）',
      !!gA2&&!gA2.開&&!s2.行文.includes(TAG+'A'),JSON.stringify(gA2));

  /* ---- 4) すべて開く／すべて畳む ---- */
  await page.click('#masterMaintFold [data-mm-fold="open"]');await settle();
  const s5=await snap();
  rec('「すべて開く」で全部の群が開く',s5.群.every(g=>g.開)&&s5.行>=5,JSON.stringify(s5.群));
  await page.click('#masterMaintFold [data-mm-fold="close"]');await settle();
  const s6=await snap();
  rec('「すべて畳む」で行が1つも無くなる（見出しは残る）',
      s6.行===0&&s6.群.length>=2&&s6.群.every(g=>!g.開),JSON.stringify({行:s6.行,群:s6.群.length}));

  /* ---- 5) 保存した行の群は開く ---- */
  await page.click('#masterMaintAdd');
  await page.waitForSelector('#maintEditorForm [data-field="name"]',{timeout:10000});
  await page.selectOption('#maintEditorForm [data-field="equipment"]',EQ);
  await page.fill('#maintEditorForm [data-field="name"]',TAG+'NEW');
  await page.fill('#maintEditorForm [data-field="diaMax"]','123');
  await page.click('#maintEditorSave');
  await page.waitForFunction(t=>{
   const rows=[...document.querySelectorAll('#masterMaintList .mm-row:not(.head)')];
   return rows.some(r=>r.textContent.includes(t));
  },TAG+'NEW',{timeout:15000}).catch(()=>{});
  const s7=await snap();
  rec('畳んだ設備へ足しても、その群が開いて行が出る',
      s7.行文.includes(TAG+'NEW')&&!!s7.群.find(g=>g.名===EQ&&g.開),
      JSON.stringify({行文:s7.行文.slice(0,140),群:s7.群}));
  rec('足していない群は畳んだまま（巻き添えにしない）',
      !!s7.群.find(g=>g.名===EQ2&&!g.開),JSON.stringify(s7.群));

  rec('画面の例外が出ていない',errs.length===0,errs.join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }finally{
  /* **後片付け**（§9.121）。ロールマスタは実行をまたいで残る。 */
  for(const id of made){try{await post('/api/roll-master/delete',{user_id:'test',id})}catch(_){}}
  try{
   const left=((await getj('/api/roll-master')).items||[]).filter(x=>x.name&&x.name.startsWith(TAG));
   for(const x of left){try{await post('/api/roll-master/delete',{user_id:'test',id:x.id})}catch(_){}}
  }catch(_){}
 }
}, {viewport:{width:1600,height:1000}});
