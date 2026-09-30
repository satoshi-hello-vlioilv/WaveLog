/* test_bladepick.js: 刃選択マスタの盤（§9.380、利用者の指示）。

   「条件テーブルをGUIで組む盤を実装してほしいです。条件は視覚的に直感的に
     扱えるようにしてください。」

   固定するのは5つ:
    ① 決まりは**文として読める**（「板厚 ≧ 1.6 → 専用の刃 A を使う」）
    ② **試し欄**に値を入れると、どの決まりが当たるかがその場で出る
       ——書いた本人が確かめられることが要件（§9.117）
    ③ 試し欄に値があるときは**条件1つずつに○×**が付く（落ちた場所が見える）
    ④ **打ちかけの字を消さない**——窓を作り直して値を捨てない（§9.361・§9.227）
    ⑤ **断るべきものは断る**（名前なし・組なし・条件なしでは保存させない）

   後片付けは finally。途中で落ちると `db/master.sqlite3` に決まりが残り、
   次の実行が丸ごと引き継ぐ（§9.284）。**初期セットで入れた部材も消す**
   ——決まりだけ消しても、刃・スペーサー・ゴムリング・フィンガーが残る
   （実測でゴムリング+50・スペーサー+26・フィンガー+14・刃+6を置き去りにし、
   ランナーの「汚した本」に名指しされた）。

   土台は `tests/lib/harness.js`（§9.347）。**起動を書き写さない**——写しが
   増えると、横断の変更が本の数だけの問題になる。 */
const H = require('./lib/harness.js');
const W = require('./lib/wait.js');
const B = H.B;
const EQ='テスト設備A';
const api=(p,o)=>fetch(B+p,o).then(r=>r.json());
const post=(p,body)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},
                            body:JSON.stringify(body)});

H.run('test_bladepick: 刃選択マスタの盤（§9.380）',
 async({page,rec,errs})=>{
  let made=[];
  /* この設備の刃組マスタを空にしてから始める（test_bladeui と同じ作法）。 */
  const wipe=async()=>{
   const c=await api('/api/bladeset/context?equipment='+encodeURIComponent(EQ));
   for(const [path,list] of [['blade',c.blades],['spacer',c.spacers],
                             ['ring',c.rings],['finger',c.fingers]]){
    for(const x of (list||[]))await post(`/api/bladeset-${path}-master/delete`,{id:x.id});
   }
   for(const x of (c.picks||[]))await post('/api/bladeset/blade-pick/delete',{id:x.id});
  };
  await wipe();
  try{
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await W.booted(page);
  /* 保存には更新者IDが要る（§CLAUDE「誰が直したか」）。取れるまで待つ
     ——待たずに押すと「IDが分かりません」で止まり、盤のせいに見える。 */
  await W.until(page,()=>!!(window.currentUserId&&currentUserId()),null,
                {ms:15000,what:'更新者IDが決まる'});
  /* 部材が無いと刃の組の候補が作れないので、先に初期セットを入れる。 */
  const seeded=await post('/api/bladeset/seed',{equipment:EQ});
  rec('初期セットが入る（刃の組の候補のもと）',!!(seeded&&seeded.ok));

  await page.evaluate(()=>WL.mm.openMasterMaint());
  await W.until(page,()=>!!document.querySelector('#masterMaintNav'),null,
                {ms:15000,what:'マスタ管理が開く'});
  const hasTab=await page.evaluate(()=>{
   const t=[...document.querySelectorAll('#masterMaintNav button,[data-def]')]
     .find(x=>/刃選択/.test(x.textContent||''));
   if(t){t.click();return true}
   return false;
  });
  rec('刃組の群に「刃選択」のタブがある',hasTab);
  await page.waitForSelector('#bpAdd',{timeout:15000});
  await W.until(page,()=>!!document.querySelector('.bp-try'),null,
                {ms:10000,what:'試し欄が出る'});

  /* ---- 決まりが無いときは「通常刃が選ばれる」と言う（空の器を黙って出さない・§9.526で呼び名を改めた） ---- */
  const empty=await page.evaluate(()=>(document.querySelector('#masterMaintList').textContent||''));
  rec('決まりが無いときは「通常刃が選ばれる」と書く',
      /通常刃/.test(empty)&&/決まりがありません/.test(empty),empty.replace(/\s+/g,' ').slice(0,70));

  /* ---- ⑤ 断るべきものは断る ---- */
  const modalText=async()=>{
   await W.until(page,()=>!!document.querySelector('.confirm-modal-message'),null,
                 {ms:8000,what:'断りの窓'});
   const t=await page.evaluate(()=>document.querySelector('.confirm-modal-message').textContent||'');
   await page.keyboard.press('Escape');
   await W.until(page,()=>!document.querySelector('.confirm-modal-message'),null,
                 {ms:5000,what:'断りの窓が閉じる'});
   return t;
  };
  await page.click('#bpAdd');
  await page.waitForSelector('#bpName',{timeout:8000});
  await page.click('[data-act="save"]');
  rec('名前が無ければ保存させない',/名前/.test(await modalText()));
  await page.fill('#bpName','厚板は専用');
  await page.click('[data-act="save"]');
  rec('刃の組が未選択なら保存させない',/組/.test(await modalText()));

  /* ---- ④ 打ちかけの字を消さない ----
     条件の値は欄から出る前（`change`の前）にも拾えること。**窓を作り直すと
     ここが空のまま保存される**——実際にそうなり、値と組が空で飛んだ。 */
  await page.click('[data-act="addcond"]');
  await page.waitForSelector('.bp-row',{timeout:8000});
  await page.selectOption('.bp-row .bp-f','thickness');
  await page.selectOption('.bp-row .bp-o','ge');
  await page.fill('.bp-row .bp-v','1.6');
  const groups=await page.evaluate(()=>[...document.querySelectorAll('#bpGroup option')].map(o=>o.value).filter(Boolean));
  rec('刃の組の候補が出る',groups.length>0,groups.join('/'));
  await page.selectOption('#bpGroup',groups[0]);
  const held=await page.evaluate(()=>{
   const s=WL.bladePick.state,r=s.rules[s.editing];
   return {v:(r.conditions[0]||{}).value,g:r.group,n:r.name};
  });
  rec('欄から出る前の値も拾える（打ちかけの字を捨てない）',
      held.v==='1.6'&&held.g===groups[0]&&held.n==='厚板は専用',JSON.stringify(held));

  await page.click('[data-act="save"]');
  await W.until(page,()=>WL.bladePick.state.editing===null,null,
                {ms:10000,what:'保存して窓が閉じる'});
  const saved=await api('/api/bladeset/blade-pick?equipment='+encodeURIComponent(EQ));
  made=(saved.items||[]).map(x=>x.id);
  rec('保存がサーバーまで届く',made.length===1,JSON.stringify(saved.items||[]));

  /* ---- ① 文として読める ---- */
  const card=await page.evaluate(()=>((document.querySelector('.bp-card')||{}).textContent||'').replace(/\s+/g,' ').trim());
  rec('決まりが文として読める（項目・比べ方・値・使う組）',
      /厚板は専用/.test(card)&&/板厚/.test(card)&&/1\.6/.test(card)&&/専用刃/.test(card),
      card.slice(0,80));

  /* ---- ②③ 試し欄で当たりが出る／条件ごとに○× ---- */
  const ans=()=>page.evaluate(()=>((document.querySelector('.bp-ans')||{}).textContent||'').trim());
  const marks=()=>page.evaluate(()=>[...document.querySelectorAll('.bp-cond')]
    .map(c=>c.className.includes('is-ok')?'○':(c.className.includes('is-ng')?'×':'-')).join(''));
  rec('値を入れる前は「値を入れると出ます」と案内する',/値を入れる/.test(await ans()),await ans());
  await page.fill('[data-p="thickness"]','1.8');
  await W.until(page,()=>/当たる/.test(document.querySelector('.bp-ans').textContent||''),null,
                {ms:8000,what:'当たりが出る'});
  rec('当たると「どの決まりで・どの組か」を出す',
      /厚板は専用/.test(await ans())&&/専用刃/.test(await ans()),await ans());
  rec('当たった条件に○が付く',(await marks())==='○',await marks());
  rec('当たった決まりのカードが目印を持つ',
      await page.evaluate(()=>!!document.querySelector('.bp-card.is-won')));
  await page.fill('[data-p="thickness"]','1.0');
  await W.until(page,()=>/通常刃/.test(document.querySelector('.bp-ans').textContent||''),null,
                {ms:8000,what:'通常刃へ戻る'});
  rec('当たらなければ「通常刃」と言う',/通常刃/.test(await ans()),await ans());
  rec('落ちた条件に×が付く（どこで落ちたかが見える）',(await marks())==='×',await marks());
  rec('当たっていないときは目印を出さない',
      await page.evaluate(()=>!document.querySelector('.bp-card.is-won')));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }finally{
  /* 後片付け。**消えたことまで確かめる**（§9.362）。決まり（この網が作った物）は空へ戻し、
     **部材は初期セットへ戻す**（test_bladeui と同じ作法・§9.441）。頭の`wipe()`はフィクスチャに
     元から在る部材まで消すので、空のまま終えると通しで「ゴムリングマスタ -51 / スペーサーマスタ -26 /
     フィンガーマスタ -14 / 刃マスタ -6」と名指しされた（以前は「部材も空へ戻る」を網が確かめており、
     間違った片付けを固定していた）。`seed`は足し算にならない（§9.377）。 */
  try{
   await wipe();
   await post('/api/bladeset/seed',{equipment:EQ});
   const c=await api('/api/bladeset/context?equipment='+encodeURIComponent(EQ));
   const parts=[c.blades,c.spacers,c.rings,c.fingers].map(x=>(x||[]).length);
   rec('後始末で刃選択の決まりは空へ、部材は初期セットへ戻る',
       (c.picks||[]).length===0&&parts.every(n=>n>0),
       `決まり${(c.picks||[]).length}/刃${parts[0]}/ス${parts[1]}/輪${parts[2]}/指${parts[3]}`);
  }catch(e){rec('後始末',false,String(e))}
 }
 },{mode:'edit',viewport:{width:1600,height:1000}});
