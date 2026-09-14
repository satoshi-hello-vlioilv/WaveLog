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
   次の実行が丸ごと引き継ぐ（§9.284）。 */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const W = require('./lib/wait.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
const api=(p,o)=>fetch(B+p,o).then(r=>r.json());
const post=(p,body)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},
                            body:JSON.stringify(body)});

(async()=>{
 let b=null,made=[];
 try{
  b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
  const page=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[];
  page.on('pageerror',e=>errs.push(e.message));
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

  /* ---- 決まりが無いときは「一般が選ばれる」と言う（空の器を黙って出さない） ---- */
  const empty=await page.evaluate(()=>(document.querySelector('#masterMaintList').textContent||''));
  rec('決まりが無いときは「一般の刃が選ばれる」と書く',
      /一般/.test(empty)&&/決まりがありません/.test(empty),empty.replace(/\s+/g,' ').slice(0,70));

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
      /厚板は専用/.test(card)&&/板厚/.test(card)&&/1\.6/.test(card)&&/専用の刃/.test(card),
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
      /厚板は専用/.test(await ans())&&/専用の刃/.test(await ans()),await ans());
  rec('当たった条件に○が付く',(await marks())==='○',await marks());
  rec('当たった決まりのカードが目印を持つ',
      await page.evaluate(()=>!!document.querySelector('.bp-card.is-won')));
  await page.fill('[data-p="thickness"]','1.0');
  await W.until(page,()=>/一般/.test(document.querySelector('.bp-ans').textContent||''),null,
                {ms:8000,what:'一般へ戻る'});
  rec('当たらなければ「一般の刃」と言う',/一般の刃/.test(await ans()),await ans());
  rec('落ちた条件に×が付く（どこで落ちたかが見える）',(await marks())==='×',await marks());
  rec('当たっていないときは目印を出さない',
      await page.evaluate(()=>!document.querySelector('.bp-card.is-won')));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  rec('FATAL',false,String(e&&e.message?e.message:e));
 }finally{
  /* 後片付け。**消えたことまで確かめる**（§9.362）。 */
  try{
   const left=await api('/api/bladeset/blade-pick?equipment='+encodeURIComponent(EQ));
   for(const x of (left.items||[]))await post('/api/bladeset/blade-pick/delete',{id:x.id});
   const after=await api('/api/bladeset/blade-pick?equipment='+encodeURIComponent(EQ));
   rec('後始末で刃選択マスタが空へ戻る',(after.items||[]).length===0,
       JSON.stringify((after.items||[]).map(x=>x.name)));
  }catch(e){rec('後始末',false,String(e))}
  if(b)await b.close();
 }
 const ng=R.filter(x=>!x.ok);
 console.log(`\n== ${R.length-ng.length}/${R.length} PASS ==`);
 process.exit(ng.length?1:0);
})();
