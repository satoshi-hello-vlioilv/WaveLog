/* test_stopsubui.js: 設備停止マスタの画面（§9.389 → §9.397で1枚へ統合）
   ------------------------------------------------------------
   §9.389「刃組待ちだったら、ゴムリングとフィンガーと刃出しの3種類があります。
    そのような種類の違いも後でわかるようにしたいが**同じ刃組というグループ
    には入れておきたい**」
   §9.389「時間のマスタは全体で共通…**あくまで選択肢を作るマスタ**」
   §9.397「設備停止分類と内訳と設備停止名の登録をシームレスにマスタ連携
    できていないので…『設備停止マスタ』としてマスタ統合してほしいです」
   §9.397「内訳は1つしかない場合はそれを既定に。2つ以上あっても既定のものを
    設定して登録できるように」

   固定すること:
    1. **3階層が1枚で見える**——左＝分類 → 停止内容の木／右＝選んだ停止内容の段（基本・内訳・挿入の条件。§9.590）
       （分類・内訳の独立したタブは無い）
    2. 分類はこの画面で足せる（タブを移らずに階層を作れる）
    3. 内訳を足せて、**別の停止に同じ名前の内訳**も足せる（親で割れている）
    4. 内訳の分の欄に**親の標準所要分**が出ている（空欄にすると何分かが読める）
    5. 木の停止内容を押し替えても**木のスクロール位置が飛ばない**（右だけ差し替える）
    6. 停止内容の行に内訳の件数が出て、**0件は「内訳なし」**（0のままにしない）
    7. **既定の内訳**を印で決められる（1件しか無い段では押せなくして理由を書く）
    8. 時間の画面は札＋スライダーの見本で、**範囲は選択肢の最小〜最大**
    9. どちらの画面も**横にはみ出さない**（文字が切れない・器に収まる）
   10. §9.598 1g: 追加は頭の主の操作・**基本はその場で直す**（足元・聞いてから移る・キャンセル・保存）・消すは ⋯・
       分の棒は同じ目盛り・新しい停止内容も右の基本で作る・内訳の追加は表の最後の行  */
const H=require('./lib/harness.js');
const TAG='SSB'+Date.now().toString().slice(-6);
const EQ='テスト設備A';
/* 分類は**設備停止の登録で自動的に増える**（未登録の分類を書くと分類マスタへも
   入る・§5.3.1）。控える表に入れておかないと、この本が「置き土産」を残す。 */
const SNAP=['設備停止マスタ','設備停止サブカテゴリマスタ','設備停止時間マスタ','設備停止分類マスタ'];

H.run('test_stopsubui: 設備停止マスタの画面（§9.397）',
 async({page,rec,B,W,idle})=>{
 const snap=await H.masterSnapshot(SNAP);
 /* 後片付けは`finally`（§9.598 1j で踏んだ: 途中で落ちた2回が分類を4行残し、次の撮影の左の一覧に出ていた）。 */
 try{
 const post=(path,body)=>page.evaluate(async a=>{
  const r=await fetch(a.path,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify(Object.assign({user_id:'test-stopsubui'},a.body))});
  let j={};try{j=await r.json()}catch(e){j={}}
  return {status:r.status,body:j};
 },{path,body});

 await page.goto(B+'/',{waitUntil:'domcontentloaded'});
 await W.booted(page); await idle();

 /* 材料は自分で注ぐ（§9.351）。**2つの停止**を作る——1つだけだと
    「親で割れている」ことを確かめられない。 */
 const a=await post('/api/schedule/stop-reason-master',
   {equipment:EQ,name:TAG+'刃組待ち',category:TAG+'待ち',standardMinutes:60});
 const b=await post('/api/schedule/stop-reason-master',
   {equipment:EQ,name:TAG+'段取り待ち',category:TAG+'待ち',standardMinutes:30});
 rec('材料の設備停止を2件作れた',a.status===200&&b.status===200,`${a.status}/${b.status}`);
 const idA=a.body.id,idB=b.body.id;

 const openTab=async key=>{
  const open=await page.$('#openMasterMaint');
  if(open&&await page.evaluate(()=>!document.getElementById('masterMaintForm')))await open.click();
  else if(!await page.$('#masterMaintForm'))await page.click('#openMasterMaint');
  /* 器は在ればよい（§9.598 1b から、道具の無い画面は`#masterMaintForm`を伏せる——見えるまで待つと成り立たない）。 */
  await page.waitForSelector('#masterMaintForm',{state:'attached',timeout:10000});
  await page.evaluate(k=>{const el=document.querySelector(`[data-master="${k}"]`);if(el)el.click()},key);
 };

 // ---- ① 3階層が1枚で見える（§9.397で統合） ---------------------------
 /* **分類・内訳の独立したタブは無い**（§9.397）。同じ階層を3枚に割ると、
    1つ作るのにタブ往復が2回要る（利用者の指摘「シームレスに連携できていない」）。 */
 await openTab('stopReason');
 await page.waitForSelector('.ssb-edit',{timeout:15000});
 await idle();
 /* **左のナビを見るのは画面を開いてから**——開く前は`.mm-nav-group`がまだ
    無いので、顔ぶれを数えると必ず空になる（「タブが無い」がいつでも真に
    なって、統合を戻しても気づけない）。 */
 const tabs=await page.evaluate(()=>{
  const grp=document.querySelector('.mm-nav-group[data-nav-group="schedule"]');
  return grp?[...grp.querySelectorAll('[data-master]')].map(b=>b.dataset.master):[];
 });
 rec('分類・内訳の独立したタブが無い（設備停止マスタ1枚へ統合した）',
     tabs.includes('stopReason')&&!tabs.includes('stopCategory')&&!tabs.includes('stopSub'),
     tabs.join(','));
 const shape=await page.evaluate(t=>{
  const cats=[...document.querySelectorAll('.ssb-cat-row b')].map(x=>x.textContent.trim());
  const stops=[...document.querySelectorAll('[data-ssb-pick]')].map(x=>x.querySelector('b').textContent.trim());
  return {cats,stops,mine:stops.filter(s=>s.startsWith(t)).length,
          hasCat:cats.includes(t+'待ち'),
          cols:[...document.querySelectorAll('.ssb-edit>div')].map(x=>x.className.split(' ')[0]),
          tabs:[...document.querySelectorAll('[data-ssb-tab]')].map(x=>x.dataset.ssbTab)};
 },TAG);
 rec('左の木に分類が並ぶ（3階層の1段目）',shape.hasCat,shape.cats.slice(0,6).join('/'));
 rec('木に作った停止内容が2件並ぶ',shape.mine===2,`${shape.mine}件`);
 /* §9.590（7案→組合せ7案から H1）: 左＝分類 → 停止内容の木／右＝選んだ停止内容の段（基本・内訳・挿入の条件）。 */
 rec('左＝分類 → 停止内容の木／右＝選んだ停止内容の段（基本・内訳・挿入の条件）',
     shape.cols.join('/')==='ssb-cats/ssb-detail'&&shape.tabs.join('/')==='basic/subs/rules',shape.cols.join('/')+' '+shape.tabs.join('/'));

 // ---- ①b 分類はこの画面で足せる（タブを移らない・§9.397） --------------
 const CAT=TAG+'新分類';
 await page.fill('#ssbNewCat',CAT);
 await page.click('#ssbAddCat');
 await page.waitForFunction(n=>[...document.querySelectorAll('.ssb-cat-row b')]
   .some(b=>b.textContent.trim()===n),CAT,{timeout:10000});
 const catAdded=await page.evaluate(async n=>{
  const j=await (await fetch('/api/schedule/stop-category-master')).json();
  return (j.items||[]).some(x=>String(x.name||'').trim()===n);
 },CAT);
 rec('分類をこの画面から足せる（分類マスタへ入る）',catAdded,CAT);
 /* 足した分類は0件。**件数（0）が言う**——「まだありません」の字を分類ごとに並べない（§9.598 1g）。足す道はその行の ＋。 */
 const emptyCat=await page.evaluate(n=>{
  const g=[...document.querySelectorAll('[data-ssb-group]')].find(x=>x.dataset.ssbGroup===n);
  return g?{n:(g.querySelector('.ssb-cat-n')||{}).textContent,msg:!!g.querySelector('.mm-empty'),add:!!g.querySelector('[data-ssb-add-in]')}:null;
 },CAT);
 rec('空の分類は件数（0）が言い、字を並べない・その行に「＋」がある',
     !!emptyCat&&emptyCat.n==='0'&&!emptyCat.msg&&emptyCat.add,JSON.stringify(emptyCat));
 await page.evaluate(()=>{const b=document.querySelector('[data-ssb-cat="*"]');if(b)b.click()});
 await page.waitForFunction(()=>document.querySelectorAll('[data-ssb-pick]').length>0,null,{timeout:8000});

 // ---- ② 内訳を足す。別の親に同じ名前も足せる --------------------------
 const pick=async id=>{
  await page.evaluate(i=>{const el=document.querySelector(`[data-ssb-pick="${i}"]`);if(el)el.click()},id);
  await page.waitForFunction(i=>{
   const on=document.querySelector('[data-ssb-pick].is-on');
   return on&&Number(on.dataset.ssbPick)===Number(i);
  },id,{timeout:8000});
 };
 const addSub=async(name,min)=>{
  await page.fill('#ssbNewName',name);
  await page.fill('#ssbNewMin',min==null?'':String(min));
  await page.click('#ssbAdd');
  await page.waitForFunction(n=>[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="name"]')]
    .some(i=>i.value===n),name,{timeout:10000});
 };
 await pick(idA);
 await addSub('ゴムリング',null);
 await addSub('刃出し',90);
 await pick(idB);
 await addSub('刃出し',null);
 const subs=await page.evaluate(()=>({
  rows:[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="name"]')].map(i=>i.value),
  minPh:[...document.querySelectorAll('.ssb-row[data-ssb-id] input[data-ssb-k="min"]')].map(i=>i.placeholder),
 }));
 rec('別の停止にも同じ名前（刃出し）の内訳を足せる',subs.rows.length===1&&subs.rows[0]==='刃出し',
     subs.rows.join('/'));
 /* **数えるのは自分が作った親のぶんだけ**（§9.284）。全体の件数で見ると、
    前の実行の置き土産や他の本の行まで数えてしまう（実測で11件を数えた）。 */
 const srv=await page.evaluate(async ids=>{
  const r=await fetch('/api/schedule/stop-sub-master');const j=await r.json();
  return (j.items||[]).filter(x=>ids.includes(Number(x.stopReasonId)))
    .map(x=>`${x.stopReasonId}:${x.name}`);
 },[idA,idB]);
 rec('この2つの親のもとに3件（同名2件は親が違う）',
     srv.length===3&&srv.filter(x=>x.endsWith(':刃出し')).length===2
     &&srv.filter(x=>x.endsWith(':ゴムリング')).length===1,
     srv.join(' / '));

 // ---- ②b もう1階層（§9.390） ------------------------------------------
 await pick(idA);
 const under=async name=>page.evaluate(n=>{
  const row=[...document.querySelectorAll('.ssb-row[data-ssb-id]')]
    .find(r=>(r.querySelector('input[data-ssb-k="name"]')||{}).value===n);
  const b=row&&row.querySelector('[data-ssb-under]');
  if(b)b.click();
  return !!b;
 },name);
 rec('1段目の行に「＋ 下へ」がある',await under('ゴムリング'));
 await page.waitForSelector('#ssbUnderClear',{timeout:8000});
 const where=await page.textContent('.ssb-add-where');
 rec('足す先が字で出る（どこへ足すか推測させない）',
     /ゴムリング/.test(where||''),(where||'').replace(/\s+/g,' ').trim());
 await addSub('交換',null);
 await page.evaluate(()=>{const b=document.getElementById('ssbUnderClear');if(b)b.click()});
 await page.waitForFunction(()=>!document.querySelector('.ssb-add-where'),null,{timeout:8000});
 const tree=await page.evaluate(()=>[...document.querySelectorAll('.ssb-row[data-ssb-id]')]
   .map(r=>`${r.dataset.ssbDepth}:${(r.querySelector('input[data-ssb-k="name"]')||{}).value}`));
 rec('2段目が親の直後へ字下げで並ぶ',
     tree.join('/')==='1:ゴムリング/2:交換/1:刃出し',tree.join('/'));
 const srv2=await page.evaluate(async i=>{
  const j=await (await fetch('/api/schedule/stop-sub-master')).json();
  return (j.items||[]).filter(x=>Number(x.stopReasonId)===Number(i))
    .map(x=>`${x.depth}:${x.name}:${x.parentSubId}`);
 },idA);
 rec('サーバーも段と親を返す',srv2.some(x=>/^2:交換:/.test(x)),srv2.join(' / '));

 // ---- ③ 親の標準所要分が画面に出ている（出どころ・§CLAUDE 6） ---------
 /* §9.598 1g: 標準所要分は「基本」の札の1か所（内訳の段の頭に同じ値を重ねない）。 */
 await pick(idB);
 const baseTxt=await page.textContent('[data-ssb-tab="basic"] .ssb-tab-now');
 rec('基本の札に親の標準所要分が出る',/30/.test(baseTxt||''),(baseTxt||'').trim().slice(0,60));
 rec('分の欄のプレースホルダが「空欄ならこの時間」を言う',
     subs.minPh.length===1&&/30/.test(subs.minPh[0]||''),subs.minPh.join('/'));

 // ---- ④ 左を押し替えても左のスクロール位置が飛ばない -------------------
 const keep=await page.evaluate(async ids=>{
  const list=document.querySelector('.ssb-stop-list');
  list.scrollTop=list.scrollHeight;            // いちばん下まで送る
  const before=list.scrollTop;
  document.querySelector(`[data-ssb-pick="${ids[0]}"]`).click();
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const after=document.querySelector('.ssb-stop-list').scrollTop;
  return {before,after,same:document.querySelector('.ssb-stop-list')===list};
 },[idA]);
 rec('中のDOMを作り直していない（位置が飛ばない）',keep.same&&keep.after===keep.before,
     `${keep.before}→${keep.after} same=${keep.same}`);
 /* 選んだ行が濃く見えることを**実測する**（§9.386）——クラスは付くのに
    規則の置き場がずれていて1pxも変わらない、が実際に起きた。 */
 const tint=await page.evaluate(()=>{
  const on=document.querySelector('.ssb-stop.is-on');
  const off=[...document.querySelectorAll('.ssb-stop')].find(x=>!x.classList.contains('is-on'));
  const g=el=>el?getComputedStyle(el).backgroundColor:'';
  return {on:g(on),off:g(off)};
 });
 rec('選んだ停止内容は、選んでいない行と色が違う（印が効いている）',
     !!tint.on&&tint.on!==tint.off,`${tint.on} / ${tint.off}`);

 // ---- ⑤ 停止内容の行に内訳の件数が出る（§9.397） ------------------------
 const counts=await page.evaluate(t=>[...document.querySelectorAll('[data-ssb-pick]')]
   .filter(x=>x.querySelector('b').textContent.trim().startsWith(t))
   .map(x=>`${x.querySelector('b').textContent.trim()}|${(x.querySelector('.ssb-stop-n')||{}).textContent||''}`),TAG);
 rec('停止内容の行に内訳の件数が出る（0件は「内訳なし」と字で言う）',
     counts.some(c=>/内訳2件/.test(c))&&counts.some(c=>/内訳1件/.test(c)),counts.join(' / '));

 // ---- ⑤b 既定の内訳（§9.397、利用者の指示） ----------------------------
 await pick(idA);
 await page.waitForFunction(()=>document.querySelectorAll('[data-ssb-def]').length>=2,null,{timeout:8000});
 const defBefore=await page.evaluate(()=>[...document.querySelectorAll('[data-ssb-def]')]
   .map(b=>`${b.textContent.trim()}:${b.disabled?'off':'on'}`));
 rec('内訳が2件以上ある段では「既定にする」を押せる',
     defBefore.filter(x=>/既定にする:on/.test(x)).length>=2,defBefore.join(' / '));
 await page.evaluate(()=>{
  const row=[...document.querySelectorAll('.ssb-row[data-ssb-id]')]
    .find(r=>(r.querySelector('input[data-ssb-k="name"]')||{}).value==='刃出し');
  const b=row&&row.querySelector('[data-ssb-def]');
  if(b)b.click();
 });
 /* **押した行の札**が「既定」になるまで待つ（§9.522 の追補）。以前は「どれかの札が既定」で待っており、
    兄弟が1件だけの2段目（交換）の押せない札が**押す前から**「既定」と出ているので待ちが素通りし、
    保存の往復が終わる前にサーバーを読んで落ちることがあった（早い者勝ち）。 */
 await page.waitForFunction(()=>{
  const row=[...document.querySelectorAll('.ssb-row[data-ssb-id]')]
    .find(r=>(r.querySelector('input[data-ssb-k="name"]')||{}).value==='刃出し');
  const btn=row&&row.querySelector('[data-ssb-def]');
  return !!btn&&btn.textContent.trim()==='既定';
 },null,{timeout:10000});
 const defSrv=await page.evaluate(async i=>{
  const j=await (await fetch('/api/schedule/stop-sub-master')).json();
  const mine=(j.items||[]).filter(x=>Number(x.stopReasonId)===Number(i));
  return {flags:mine.map(x=>`${x.name}:${x.isDefault?1:0}`),
          answer:(j.defaults||{})[i+':0']||0,
          hit:(mine.find(x=>x.name==='刃出し')||{}).id||0};
 },idA);
 rec('既定はサーバーに1つだけ立つ（兄弟は降りる）',
     defSrv.flags.filter(x=>/:1$/.test(x)).length===1&&/刃出し:1/.test(defSrv.flags.join(' ')),
     defSrv.flags.join(' / '));
 rec('「最初から選ばれる内訳」はサーバーが答える（§9.163）',
     Number(defSrv.answer)===Number(defSrv.hit),`${defSrv.answer} / ${defSrv.hit}`);
 /* 1件しか無い段では、印を付けなくても最初から選ばれる（§9.397）
    ——押せるのに効かない物を置かない（§CLAUDE 4）。 */
 await pick(idB);
 await page.waitForFunction(()=>document.querySelectorAll('[data-ssb-def]').length===1,null,{timeout:8000});
 const only=await page.evaluate(()=>{
  const b=document.querySelector('[data-ssb-def]');
  return {txt:b.textContent.trim(),off:!!b.disabled,why:b.getAttribute('title')||''};
 });
 rec('内訳が1件だけの段では「既定にする」を押せなくして理由を書く',
     only.off&&/1つだけ/.test(only.why),JSON.stringify(only).slice(0,120));

 // ---- ⑤d §9.598 1j: 内訳も打った値は足元の「保存」で書く（欄を離れても保存しない）・消すは行の ⋯ ----
 await pick(idA);
 await page.waitForFunction(()=>!!document.querySelector('#ssbSubSave'),null,{timeout:8000});
 const f0=await page.evaluate(()=>({txt:document.querySelector('#ssbState').textContent,save:document.querySelector('#ssbSubSave').disabled,
  cancel:document.querySelector('#ssbSubCancel').disabled,x:document.querySelectorAll('.ssb-row[data-ssb-id] .danger').length,
  more:document.querySelectorAll('.ssb-row[data-ssb-id] .ssb-row-more').length,rows:document.querySelectorAll('.ssb-row[data-ssb-id]').length}));
 rec('1j: 内訳の足元はキャンセル＋保存（開いただけでは「変更なし」で押せない）・行の × は無く ⋯ が1つずつ',
   /^変更なし/.test(f0.txt)&&f0.save&&f0.cancel&&f0.x===0&&f0.more===f0.rows&&f0.rows>0,JSON.stringify(f0));
 const rowMin=async n=>page.evaluate(n=>{const r=[...document.querySelectorAll('.ssb-row[data-ssb-id]')]
   .find(x=>(x.querySelector('input[data-ssb-k="name"]')||{}).value===n);return r?r.querySelector('input[data-ssb-k="min"]').value:null},n);
 const minOf=n=>`.ssb-row[data-ssb-id]:has(input[data-ssb-k="name"][value="${n}"]) input[data-ssb-k="min"]`;
 const origMin=await rowMin('刃出し');
 await page.fill(minOf('刃出し'),'25');
 await page.locator(minOf('刃出し')).blur();
 await W.until(page,()=>/^変更 1件/.test(document.querySelector('#ssbState').textContent)&&!document.querySelector('#ssbSubSave').disabled,null,{ms:4000,what:'打つと「変更 1件」'});
 const srvMid=await page.evaluate(async i=>{const j=await (await fetch('/api/schedule/stop-sub-master')).json();
  return ((j.items||[]).find(x=>Number(x.stopReasonId)===Number(i)&&x.name==='刃出し')||{}).standardMinutes??null},idA);
 rec('1j: 欄を離れても保存しない（打った値はまだサーバーに無い）',Number(srvMid)!==25,String(srvMid));
 await page.click('#ssbSubCancel');
 await W.until(page,()=>/^変更なし/.test(document.querySelector('#ssbState').textContent),null,{ms:4000,what:'キャンセルで元へ'});
 rec('1j: キャンセルで描いたときの値へ戻る',(await rowMin('刃出し'))!=='25',String(await rowMin('刃出し')));
 await page.fill(minOf('刃出し'),'25');
 await page.click('#ssbSubSave');
 await W.until(page,()=>/保存しました/.test(document.querySelector('#ssbState').textContent),null,{ms:8000,what:'保存の字'});
 const srvAfter=await page.evaluate(async i=>{const j=await (await fetch('/api/schedule/stop-sub-master')).json();
  return ((j.items||[]).find(x=>Number(x.stopReasonId)===Number(i)&&x.name==='刃出し')||{}).standardMinutes??null},idA);
 rec('1j: 「保存」で打った値がサーバーへ入る',Number(srvAfter)===25,String(srvAfter));
 /* 消すのは ⋯ のメニュー（赤の字）。開くだけで消さない（Esc で閉じる）。 */
 await page.locator('.ssb-row[data-ssb-id] .ssb-row-more').first().click();
 await W.until(page,()=>{const m=document.querySelector('#mmActMenu');return !!m&&!m.hidden&&!!m.querySelector('[data-ssb-sub-act="delete"]')},null,{ms:4000,what:'内訳の ⋯ に「消す」'});
 const subDel=await page.evaluate(()=>{const b=document.querySelector('#mmActMenu [data-ssb-sub-act="delete"]');return {danger:b.classList.contains('is-danger'),text:b.textContent}});
 rec('1j: 内訳を消すのは行の ⋯ のメニュー（赤の字）',subDel.danger&&/消す/.test(subDel.text),JSON.stringify(subDel));
 await page.keyboard.press('Escape');
 await W.until(page,()=>document.querySelector('#mmActMenu')?.hidden===true,null,{ms:4000,what:'Esc でメニューが閉じる'});
 /* 元の分へ戻し、前の節の終わり（idB を選んだ状態）へ戻す——次の節はその状態から読む。 */
 await page.fill(minOf('刃出し'),origMin||'');
 if(!(await page.$eval('#ssbSubSave',b=>b.disabled))){
  await page.click('#ssbSubSave');
  await W.until(page,()=>/^変更なし|保存しました/.test(document.querySelector('#ssbState').textContent)&&document.querySelector('#ssbSubSave').disabled,null,{ms:8000,what:'元の分へ戻す'});
 }
 await pick(idB);

 // ---- ⑤c §9.598 1g: 頭の追加・基本をその場で直す・足元・⋯・分の棒・新しい停止内容 ----
 const head=await page.evaluate(()=>{
  const t=document.querySelector('.ssb-table'),g=e=>e?getComputedStyle(e).gridTemplateColumns:'';
  return {add:!!document.querySelector('#masterMaintActs #ssbAddStop'),bar:!!document.querySelector('#masterMaintForm .op-bar'),
   edit:!!document.querySelector('[data-ssb-edit]'),foot:(document.querySelector('#ssbState')||{}).textContent||'',
   addLast:!!t&&t.lastElementChild.classList.contains('is-add'),
   addCols:g(document.querySelector('.ssb-row.is-add'))===g(document.querySelector('.ssb-row.is-head'))};
 });
 rec('1g: 追加は頭の主の操作・一覧の上の説明の帯と「基本を直す…」は無い',head.add&&!head.bar&&!head.edit,JSON.stringify(head));
 rec('1g: 内訳の追加は表の最後の行で列にそろう・足元が状態を言う（§9.598 1j で保存のボタンへ）',
     head.addLast&&head.addCols&&/^(変更なし|「刃出し」を保存しました)/.test(head.foot),JSON.stringify(head));
 const bars=await page.evaluate(ids=>ids.map(i=>{const x=document.querySelector(`[data-ssb-pick="${i}"] .mm-val-bar>i`);return x?parseFloat(x.style.width):-1}),[idA,idB]);
 rec('1g: 木の分の棒は同じ目盛り（60分は30分の2倍）',bars[1]>0&&Math.abs(bars[0]/bars[1]-2)<0.01,bars.join(' / '));
 await page.click('[data-ssb-tab="basic"]');
 await W.until(page,()=>document.querySelectorAll('#ssbBasicForm .mm-field').length>0
   &&/^変更なし/.test((document.querySelector('#ssbBasicState')||{}).textContent||''),null,{ms:8000,what:'基本の段がその場の欄で開く'});
 const basic=await page.evaluate(()=>({
  fields:document.querySelectorAll('#ssbBasicForm .mm-field').length,
  want:((WL.mm.MASTER_DEFS||[]).find(x=>x.key==='stopReason')||{fields:[]}).fields.length,
  modal:!document.querySelector('#maintEditorModal')||document.querySelector('#maintEditorModal').hidden,
  save:document.querySelector('#ssbBasicSave').disabled,cancel:document.querySelector('#ssbBasicCancel').disabled,
  meta:!!document.querySelector('.ssb-detail .mm-dhead-meta'),chip:!!document.querySelector('[data-ssb-tab="basic"] .ssb-tab-now'),
  link:document.querySelectorAll('#ssbBasicForm [data-card="linkKey"]').length}));
 rec('1g: 基本はその場の欄（定義どおりの欄・窓は開かない）・開いただけでは変更なしで保存・キャンセルを押せない',
     basic.want>0&&basic.fields===basic.want&&basic.modal&&basic.save&&basic.cancel,JSON.stringify(basic));
 rec('1g: 基本の段では名前の横の添え字と札の値を出さない（欄が同じ値を持つ）・連携機能の札が読める',
     !basic.meta&&!basic.chip&&basic.link>=1,JSON.stringify(basic));
 const barW=()=>page.evaluate(()=>parseFloat(((document.querySelector('#ssbBasicForm .mm-val-bar.is-live>i')||{}).style||{}).width)||0);
 const w30=await barW();
 await page.fill('#ssbBasicForm [data-field="standardMinutes"]','60');
 await W.until(page,()=>/^変更あり/.test(document.querySelector('#ssbBasicState').textContent)&&!document.querySelector('#ssbBasicSave').disabled,
   null,{ms:4000,what:'打つと「変更あり」'});
 const w60=await barW();
 rec('1g: 分を打つと隣の棒がその場で伸びる（30→60分で2倍）',w30>0&&Math.abs(w60/w30-2)<0.01,`${w30} → ${w60}`);
 await page.evaluate(i=>document.querySelector(`[data-ssb-pick="${i}"]`).click(),idA);
 await W.until(page,()=>{const x=document.getElementById('appConfirmModal');return !!x&&!x.hidden},null,{ms:4000,what:'変更を捨てる前に聞く'});
 await page.click('#appConfirmCancel');
 await W.until(page,()=>document.getElementById('appConfirmModal').hidden,null,{ms:4000,what:'聞く窓が閉じる'});
 rec('1g: 変更があるまま別の停止内容を押すと聞き、「戻って続ける」で留まる',
     await page.evaluate(i=>Number(((document.querySelector('[data-ssb-pick].is-on')||{}).dataset||{}).ssbPick)===i,idB));
 await page.click('#ssbBasicCancel');
 await W.until(page,()=>document.querySelector('#ssbBasicForm [data-field="standardMinutes"]').value==='30'
   &&/^変更なし/.test(document.querySelector('#ssbBasicState').textContent),null,{ms:4000,what:'キャンセルで元の値へ'});
 rec('1g: キャンセルで開いたときの値へ戻る（閉じない）',await page.evaluate(()=>!!document.querySelector('#ssbBasicForm .mm-field')));
 await page.fill('#ssbBasicForm [data-field="standardMinutes"]','35');
 await W.until(page,()=>!document.querySelector('#ssbBasicSave').disabled,null,{ms:4000,what:'保存を押せる'});
 await page.click('#ssbBasicSave');
 await W.until(page,i=>{const r=document.querySelector(`[data-ssb-pick="${i}"] .ssb-stop-min`);
   return !!r&&/35/.test(r.textContent)&&/^変更なし/.test((document.querySelector('#ssbBasicState')||{}).textContent||'')},idB,{ms:10000,what:'保存して木の分が変わる'});
 const srvMin=await page.evaluate(async i=>{const j=await (await fetch('/api/schedule/stop-reason-master')).json();
  return ((j.items||[]).find(x=>Number(x.id)===i)||{}).standardMinutes},idB);
 rec('1g: 基本をその場で保存できる（サーバー・木・足元が同じ答え）',Number(srvMin)===35,String(srvMin));
 await page.click('#ssbStopMore');
 await W.until(page,()=>{const m=document.querySelector('#mmActMenu');return !!m&&!m.hidden&&!!m.querySelector('[data-ssb-stop-act="delete"]')},null,{ms:4000,what:'⋯ に消すが出る'});
 const sdel=await page.evaluate(()=>document.querySelector('#mmActMenu [data-ssb-stop-act="delete"]').classList.contains('is-danger'));
 await page.keyboard.press('Escape');
 await W.until(page,()=>document.querySelector('#mmActMenu').hidden,null,{ms:4000,what:'Esc でメニューが閉じる'});
 /* 分類の ⋯ は**本物のマウスで乗せて押す**（testing.md「触れて開く物は本物のマウス移動で辿る」）。乗せる前は薄い。 */
 const catSel=`[data-ssb-group="${CAT}"]`;
 const opOf=()=>page.evaluate(sel=>{const b=document.querySelector(sel+' [data-ssb-cat-more]');return b?getComputedStyle(b).opacity:'none'},catSel);
 const op0=await opOf();
 await page.hover(catSel+' .ssb-cat-row');
 const op1=await opOf();
 await page.click(catSel+' [data-ssb-cat-more]');
 await W.until(page,()=>{const m=document.querySelector('#mmActMenu');return !!m&&!m.hidden&&!!m.querySelector('[data-ssb-cat-act="delete"]')},null,{ms:4000,what:'分類の ⋯ に消すが出る'});
 const catOp={op0,op1,menu:true,danger:await page.evaluate(()=>document.querySelector('#mmActMenu [data-ssb-cat-act="delete"]').classList.contains('is-danger'))};
 await page.keyboard.press('Escape');
 await W.until(page,()=>document.querySelector('#mmActMenu').hidden,null,{ms:4000,what:'Esc でメニューが閉じる'});
 rec('1g: 消すは ⋯ のメニューの赤の字（停止内容・分類とも）・分類の ⋯ は乗せるまで薄い',
     sdel&&catOp.menu&&catOp.danger&&catOp.op0==='0'&&catOp.op1==='1',JSON.stringify({sdel,...catOp}));
 await page.click('#ssbAddStop');
 await W.until(page,()=>document.querySelector('.ssb-detail .ssb-title')?.textContent==='新しい停止内容'
   &&/^まだ入力がありません/.test((document.querySelector('#ssbBasicState')||{}).textContent||''),null,{ms:8000,what:'右の「基本」で新しい停止内容を作る'});
 const nw=await page.evaluate(()=>({save:document.querySelector('#ssbBasicSave').textContent,off:document.querySelector('#ssbBasicSave').disabled,
  tabsOff:[...document.querySelectorAll('[data-ssb-tab]')].filter(b=>b.disabled).map(b=>b.dataset.ssbTab).join(','),
  cat:(document.querySelector('#ssbBasicForm [data-field="category"]')||{}).value||'',
  picked:document.querySelectorAll('[data-ssb-pick].is-on').length,
  focus:((document.activeElement||{}).dataset||{}).field||''}));
 rec('1g: 新しい停止内容は右の基本で作る（分類を連れて行く・最初の焦点は名称・入力するまで「追加」を押せない・内訳と条件は保存の後）',
     nw.save==='追加'&&nw.off&&nw.tabsOff==='subs,rules'&&nw.cat===TAG+'待ち'&&nw.picked===0&&nw.focus==='name',JSON.stringify(nw));
 await pick(idA);

 // ---- ⑥ 時間の画面（札＋スライダーの見本） ------------------------------
 await openTab('stopMinutes');
 await page.waitForSelector('.smn-wrap',{timeout:15000});
 await idle();
 await page.fill('#smnNew','7');
 await page.click('#smnAdd');
 await page.waitForFunction(()=>[...document.querySelectorAll('.smn-chip b')].some(b=>/7/.test(b.textContent)),
   null,{timeout:10000});
 const mn=await page.evaluate(()=>{
  const chips=[...document.querySelectorAll('.smn-chip b')].map(b=>b.textContent.trim());
  const r=document.querySelector('.smn-range input[type=range]');
  return {chips,min:r&&+r.min,max:r&&+r.max,step:r&&+r.step,disabled:!!(r&&r.disabled)};
 });
 const vals=await page.evaluate(async()=>{
  const j=await (await fetch('/api/schedule/stop-minutes-master')).json();
  return (j.items||[]).map(x=>Number(x.minutes));
 });
 rec('選択肢を足せる（札が増える）',mn.chips.length===vals.length&&vals.includes(7),
     `${mn.chips.length}札 / ${vals.length}件`);
 rec('スライダーの範囲は選択肢の最小〜最大',
     mn.min===Math.min(...vals)&&mn.max===Math.max(...vals),`${mn.min}〜${mn.max} / ${vals.join(',')}`);
 rec('見本のスライダーは動かせない（押せるのに効かない物を置かない）',mn.disabled);

 // ---- ⑦ どちらの画面も横にはみ出さない ---------------------------------
 const fitM=await page.evaluate(()=>{
  const l=document.getElementById('masterMaintList');
  return {over:l.scrollWidth-l.clientWidth,w:l.clientWidth};
 });
 rec('時間の画面が器からはみ出さない',fitM.over<=1,`はみ出し${fitM.over}px（器${fitM.w}px）`);
 await openTab('stopReason');
 await page.waitForSelector('.ssb-edit',{timeout:15000});
 await idle();
 const fitS=await page.evaluate(()=>{
  const l=document.getElementById('masterMaintList');
  const cut=[...document.querySelectorAll('.ssb-add input,.ssb-row input')]
    .filter(i=>i.scrollWidth>i.clientWidth+2).length;
  return {over:l.scrollWidth-l.clientWidth,w:l.clientWidth,cut};
 });
 rec('設備停止マスタの画面が器からはみ出さない',fitS.over<=1,`はみ出し${fitS.over}px（器${fitS.w}px）`);
 rec('入力欄の中の字が切れていない',fitS.cut===0,`${fitS.cut}件`);

 }finally{
 // ---- 後片付け（この実行で増えた行だけ・§9.362 ⑤）。落ちても必ず通る ---------------------
 const dropped=await H.dropNewMasterRows(snap);
 rec('後片付けで増やした行を消した',dropped>0,`${dropped}行`);
 const left=await H.masterSnapshot(SNAP);
 let rest=0;
 for(const [t,ids] of left)rest+=[...ids].filter(i=>!snap.get(t).has(i)).length;
 rec('触る前の状態へ戻っている',rest===0,`${rest}行残り`);
 }
},{mode:'edit',viewport:{width:1700,height:1000}});
