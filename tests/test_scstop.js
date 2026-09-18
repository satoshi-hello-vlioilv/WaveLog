/* test_scstop.js: 設備停止を入れる／その場で登録する(§9.181)
   ============================================================
   利用者の指摘は「設備停止モーダルが使いにくい・見栄えも改善して」
   「スケジュール作成時の設備停止入力の部分からも設備停止の登録ができるように
   （メンテナンスしながら登録しやすい形）」。
   ここで固定するのは次の点。
    1. **どこへ入るのか**が先に書いてある（設備名と入る位置）
    2. 分類は**分類マスタの名前**で出る（固定の5つへ丸めない）
    3. 追加できないもの（突発停止）は**理由を文字で**分けて出す
    4. 絞り込みが効き、**入力欄のフォーカスが飛ばない**
    5. その場で登録でき、登録したものがすぐ押せる（印が付く）
    6. モーダルと側パネルの**どちらでも同じもの**が出る（実装は1つ）
    7. 押しても**一覧は消えない**（§9.397で左右2ペインへ組み直した）
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const NEW='点検（自動テスト）';
let b=null;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const reasons=()=>fetch(B+'/api/schedule/stop-reason-master?equipment='+encodeURIComponent(EQ)).then(r=>r.json());
const planEntries=async()=>(await (await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))).json()).entries||[];
/* 待ちは「時間」でなく「条件」で置く（§9.324 R5、tests/lib/wait.js）。 */
const W=require('./lib/wait');
const SEED=[['保全','定期メンテナンス',120],['保全','刃物交換',30],['段取り','段取り替え',45],
            ['突発','突発停止',0],['','清掃',15]];
/* ---------- 後片付け ----------
   製品の「削除」は**論理削除**（`有効=0`）なので、**行そのものは残る**。
   `NEW`やSEEDは同じ(設備,名称)を登録し直すと元の行が戻る（`stop_reason_upsert`）
   ので行数は増えないが、§9.400で足した**「（写し）」は新しい名前＝新しい行**
   なので、論理削除だけでは**1行ずつ積み上がる**（実測: ランナーが
   「設備停止マスタ +1」と報告した）。**素の表から本当に消す**こと。

   **素の表の書込はeditモードだけ**（§9.389）——scheduleのまま消しにいくと
   403で黙って弾かれる。 */
async function cleanup(){
 try{
  const r=await reasons();
  for(const x of (r.items||[]))
   if(x.name===NEW||x.name===NEW+'（写し）'||SEED.some(s=>s[1]===x.name))
    await post('/api/schedule/stop-reason-master/delete',{id:x.id});
 }catch(e){}
 try{
  await post('/api/access-mode',{mode:'edit'});
  const j=await fetch(B+'/api/master-table/'+encodeURIComponent('設備停止マスタ')+'?limit=2000')
    .then(x=>x.json()).catch(()=>({}));
  for(const row of (j.items||[]))
   if(String(row['名称']||'').trim()===NEW+'（写し）')
    await post('/api/master-table/'+encodeURIComponent('設備停止マスタ')+'/delete',{id:row.id});
 }catch(e){}
}
(async()=>{
 b=await chromium.launch({executablePath:(process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome')});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];page.on('pageerror',e=>errs.push(e.message));
 try{
  await cleanup();
  for(const [category,name,standardMinutes] of SEED)
   await post('/api/schedule/stop-reason-master',{equipment:EQ,category,name,standardMinutes,user_id:'test'});
  await post('/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await W.booted(page);
  await W.openSchedule(page,EQ);
  await page.click('#scStopModalBtn');
  await page.waitForSelector('#scStopModal:not([hidden])',{timeout:8000});
  await page.waitForTimeout(800);

  /* ---- 1) どこへ入るのか（§9.400で**帯の中**へ移した） ----
     専用の帯を上に1段持つのはやめた（§CLAUDE 8「同じ情報を2箇所に出さない」）
     ——入る先は**追加ボタンの字**と帯の案内の1行が言う。 */
  const where=await page.evaluate(()=>document.querySelector('.sc-sb')?.textContent.replace(/\s+/g,' ').trim()||'');
  rec('どこへ入るのかが帯に書いてある',where.includes(EQ)&&/いちばん後ろ/.test(where),where.slice(0,80));

  /* ---- 2) 分類は分類マスタの名前で ---- */
  const groups=await page.evaluate(()=>[...document.querySelectorAll('.sc-stop-group-title')]
    .map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  rec('分類ごとにまとまって件数も出る',groups.some(g=>/保全/.test(g)&&/2件/.test(g)),JSON.stringify(groups));
  rec('分類なしは「分類なし」と書く',groups.some(g=>/分類なし/.test(g)),JSON.stringify(groups));

  /* ---- 3) 追加できないものは理由を文字で ---- */
  const locked=await page.evaluate(()=>{
   const box=document.querySelector('.sc-stop-locked');
   return {txt:box?box.textContent.replace(/\s+/g,' ').trim():'',
    btn:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent)};
  });
  rec('追加できないものは押せるボタンにしない',!locked.btn.includes('突発停止'),JSON.stringify(locked.btn));
  rec('追加できない理由を文字で書く',/突発停止/.test(locked.txt)&&/連絡/.test(locked.txt),locked.txt.slice(0,70));

  /* ---- 4) 絞り込み ---- */
  await page.click('#scStopSearch');
  await page.type('#scStopSearch','刃物',{delay:40});
  await page.waitForTimeout(500);
  const filt=await page.evaluate(()=>({names:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent),
    more:document.querySelector('.sc-stop-more')?.textContent.trim()||'',
    focus:document.activeElement?.id||'',value:document.getElementById('scStopSearch').value}));
  rec('絞り込みが効く',filt.names.length===1&&filt.names[0]==='刃物交換',JSON.stringify(filt.names));
  rec('絞り込み中は何件中何件かを言う',/1 \/ \d+件/.test(filt.more),filt.more);
  /* **入力中に一覧だけを描き直す**(§9.117)。入力欄を作り直すと1文字ごとに
     カーソルが飛び、2文字目が打てない。 */
  rec('絞り込みの入力欄からフォーカスが飛ばない',
      filt.focus==='scStopSearch'&&filt.value==='刃物',JSON.stringify(filt));
  await page.fill('#scStopSearch','ないない');
  await page.waitForTimeout(400);
  const none=await page.evaluate(()=>document.querySelector('#scStopList')?.textContent.replace(/\s+/g,' ').trim()||'');
  rec('当たらないときは0件だと書く',/0件/.test(none),none.slice(0,60));
  await page.fill('#scStopSearch','');
  await page.waitForTimeout(400);

  /* ---- 5) その場で登録 ---- */
  await page.click('#scStopNewToggle');
  await page.waitForTimeout(400);
  const cats=await page.evaluate(()=>[...document.querySelectorAll('#scStopNewCat option')].map(o=>o.value));
  rec('分類はマスタの選択肢から選べる',cats.includes('保全')&&cats.includes(''),JSON.stringify(cats));
  const note=await page.evaluate(()=>document.querySelector('#scStopNewNote')?.textContent||'');
  rec('どこへ登録されるかを書く',note.includes(EQ),note.slice(0,60));
  await page.fill('#scStopNewName',NEW);
  await page.selectOption('#scStopNewCat','保全');
  await page.fill('#scStopNewMin','25');
  await page.click('#scStopNewSave');
  await W.until(page,n=>[...document.querySelectorAll('.sc-stop-button b')].some(x=>x.textContent===n),NEW);
  const saved=await page.evaluate(n=>({names:[...document.querySelectorAll('.sc-stop-button b')].map(x=>x.textContent),
    isNew:[...document.querySelectorAll('.sc-stop-button.is-new b')].map(x=>x.textContent),
    formHidden:document.getElementById('scStopNewForm')?.hidden}),NEW);
  rec('登録したものがすぐ押せる',saved.names.includes(NEW),JSON.stringify(saved.names));
  rec('登録したものに印が付く（探し直させない）',saved.isNew.includes(NEW),JSON.stringify(saved.isNew));
  rec('登録したら入力欄は畳む',saved.formHidden===true,String(saved.formHidden));
  const master=await reasons();
  const hit=(master.items||[]).find(x=>x.name===NEW);
  rec('マスタへ入っている',!!hit&&String(hit.category||'')==='保全'&&Number(hit.standardMinutes)===25,
      JSON.stringify(hit&&{c:hit.category,m:hit.standardMinutes}));

  /* 押すと予定へ入る（この設備の予定として） */
  const before=(await (await fetch(B+'/api/schedule/plan?equipment='+encodeURIComponent(EQ))).json()).entries||[];
  /* **本物のクリックで押すこと**（§9.220 2②）。`el.click()`では
     **ボタンにフォーカスが移らない**ので、IMEが切れる筋道を一度も通らず、
     直す前でも「打つ場所が残っている」が通ってしまう（実際に素通りした）。
     日本語を打っている最中を再現するため、先に絞り込み欄へ入っておく。 */
  await page.click('#scStopSearch');
  await page.click(`.sc-stop-button[data-id="${hit.id}"]`);
  /* 押すと**右のペイン**が開く（§9.389 → §9.397で左右2ペインへ組み直した）。
     **一覧は消えない**——1つの作業を2画面に割らないため（利用者の指摘
     「ステップが多い印象」）。内訳を持たない停止なので決めるのは時間だけで、
     標準所要分が最初から選ばれている。 */
  await page.waitForSelector('.sc-sb:not(.is-empty)',{timeout:10000});
  const step=await page.evaluate(()=>({
   title:(document.querySelector('.sc-sb-what')||{}).textContent||'',
   sels:document.querySelectorAll('.sc-sb-sel').length,
   min:(document.getElementById('scSbMinutes')||{}).value,
   go:(document.querySelector('#scSpGo')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
   listKept:!!document.querySelector('.sc-stop-button'),
   on:[...document.querySelectorAll('.sc-stop-button.is-on b')].map(x=>x.textContent.trim()),
   clear:!!document.querySelector('#scSpBack'),
  }));
  rec('押すと足元の帯が開き、一覧は消えない（戻る道を覚えなくてよい）',
      step.listKept&&step.clear&&step.title.includes(NEW),JSON.stringify(step).slice(0,180));
  rec('いま設定しているものが一覧でも印で分かる',
      step.on.includes(NEW),JSON.stringify(step.on));
  rec('内訳を持たない停止では決めるのは「時間」だけ（内訳の選択肢は出ない）',
      step.sels===0&&step.min!=='',`選択肢${step.sels} / 分${step.min}`);
  rec('標準所要分（25分）が最初から選ばれている',/25分/.test(step.go),step.go);
  rec('内訳が要らないので、そのまま追加できる',!step.goOff&&step.go.includes('追加'),step.go);
  await page.click('#scSpGo');
  /* 予定へ入ったことは**サーバーの答え**で待つ（時間で待たない）。 */
  const after=await W.poll(planEntries,es=>es.some(e=>e.kind==='設備停止'&&e.title===NEW));
  const added=after.find(e=>e.kind==='設備停止'&&e.title===NEW);
  rec('登録したものを押すと予定へ入る',!!added,`${before.length} → ${after.length}`);

  /* ---- 5.5) §9.220 2②: 押したあとも日本語を打つ場所が残っている ----
     利用者の報告「停止項目入れ次を入れようとすると文字変換がローマ字入力に
     変わってしまう」。**フォーカスが`<body>`やボタンに残るとIMEが切れる**
     ので、押した操作の中で絞り込み欄へ返している。 */
  const focus=await page.evaluate(()=>{
   const a=document.activeElement;
   return {tag:a?a.tagName:'',id:a?a.id:'',type:a?(a.type||''):''};
  });
  rec('設備停止を入れたあとも打つ場所にフォーカスが残る（IMEが切れない）',
      focus.id==='scStopSearch',JSON.stringify(focus));
  /* **`type=number`を置かないこと**（ChromeはあれでIMEを切る）。 */
  const numFields=await page.evaluate(()=>
    [...document.querySelectorAll('#scStopButtons input')].map(i=>i.id+':'+i.type));
  rec('停止パネルに type=number の欄が無い',
      !numFields.some(t=>t.endsWith(':number')),JSON.stringify(numFields));

  /* ---- 5.6) §9.220 2③: 表記に絵文字を使わない ---- */
  const EMOJI=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
  const panelText=await page.evaluate(()=>
    (document.querySelector('#scStopButtons')||{}).textContent||'');
  rec('設備停止パネルの表記に絵文字が無い',!EMOJI.test(panelText),
      (panelText.match(EMOJI)||[]).join('')||'なし');
  const rowText=await page.evaluate(()=>
    [...document.querySelectorAll('.sc-row-line')].map(r=>r.textContent).join(''));
  rec('予定の行の表記に絵文字が無い',!EMOJI.test(rowText),
      (rowText.match(EMOJI)||[]).join('')||'なし');

  /* ---- 5.7) §9.220 2①: 入れた設備停止を直せる ----
     利用者の指示「停止項目入れると変更できないので、右クリックやダブル
     クリックで編集・変更できるようにしたい」。 */
  if(added){
   const menu=await page.evaluate(id=>{
    const row=[...document.querySelectorAll('.sc-row-line')]
      .find(r=>String(r.dataset.id)===String(id));
    if(!row)return {行が無い:true};
    row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
    const m=document.querySelector('.sc-row-menu');
    return {項目:[...(m?m.querySelectorAll('button'):[])].map(b=>b.textContent.trim())};
   },added.id);
   rec('右クリックに「停止の内容を変える」がある',
       (menu.項目||[]).some(t=>/停止の内容を変える/.test(t)),JSON.stringify(menu.項目));
   /* ---- §9.399: 群で束ねて読む／複製できる ----
      利用者の指示「右クリックメニューを改良し、最新の内容に合わせて
      より分かりやすく、見やすく表示内容・機能を再構成してください」
      「追加の機能として、停止内容の複製追加といった複製機能を実装して
       ください」 */
   const grouped=await page.evaluate(()=>{
    const m=document.querySelector('.sc-row-menu');
    const kids=[...(m?m.children:[])];
    return {群:kids.filter(k=>k.classList.contains('chm-group')).map(k=>k.textContent.trim()),
      /* **中身の無い群を出さない**——見出しだけが残ると「この下に何か
         あるはず」と探させる（§CLAUDE 4）。 */
      空の群:kids.filter((k,i)=>k.classList.contains('chm-group')
        &&(!kids[i+1]||kids[i+1].classList.contains('chm-group'))).map(k=>k.textContent.trim()),
      鍵:[...(m?m.querySelectorAll('.chm-key'):[])].map(k=>k.textContent.trim()),
      複製:[...(m?m.querySelectorAll('button'):[])]
        .filter(b=>/もう1件足す/.test(b.textContent)).map(b=>b.disabled?'off':'on')};
   });
   rec('右クリックは群で束ねて読める（平らな1本の並びにしない）',
       grouped.群.length>=3,grouped.群.join('/'));
   rec('中身の無い群は出さない',grouped.空の群.length===0,grouped.空の群.join('/'));
   /* **鍵盤でできることはその場に書く**（§CLAUDE 2「思い出させない」）。 */
   rec('「予定から外す」にDeleteの札が付く',grouped.鍵.includes('Delete'),grouped.鍵.join('/'));
   rec('設備停止の行には「もう1件足す」がある（押せる）',
       grouped.複製.join('')==='on',JSON.stringify(grouped.複製));
   /* 本当に1件増えて、**内訳も見積も同じ**まま入ること。 */
   const dupBefore=(await planEntries()).filter(e=>e.title===NEW).length;
   await page.evaluate(()=>{
    const b=[...document.querySelectorAll('.sc-row-menu button')]
      .find(x=>/もう1件足す/.test(x.textContent));
    if(b)b.click();
   });
   const dupAfter=await W.poll(planEntries,es=>es.filter(e=>e.title===NEW).length>dupBefore,20000);
   const dups=dupAfter.filter(e=>e.title===NEW);
   rec('複製すると同じ内容の行が1件増える',dups.length===dupBefore+1,
       `${dupBefore} → ${dups.length}`);
   rec('複製は見積も写す',dups.length>1
       &&String(dups[0].estimateMinutes||'')===String(dups[1].estimateMinutes||''),
       JSON.stringify(dups.map(x=>x.estimateMinutes)));
   /* **すぐ下へ入る**——探させない（§CLAUDE 2）。 */
   const order=dupAfter.filter(e=>e.kind==='設備停止'&&e.title===NEW).map(e=>String(e.id));
   const all=dupAfter.map(e=>String(e.id));
   rec('複製はその行のすぐ下へ入る',
       order.length===2&&all.indexOf(order[1])===all.indexOf(order[0])+1,
       `${all.indexOf(order[0])} → ${all.indexOf(order[1])}`);
   /* 片付け: 増やした1件はここで外す（この本の後始末は元の1件だけを見る）。 */
   const extra=dups.find(e=>String(e.id)!==String(added.id));
   if(extra)await post('/api/schedule/plan/delete',{id:extra.id,user_id:'test'});
   await W.poll(planEntries,es=>es.filter(e=>e.title===NEW).length===dupBefore,15000);
   await page.evaluate(id=>{
    const row=[...document.querySelectorAll('.sc-row-line')]
      .find(r=>String(r.dataset.id)===String(id));
    if(row)row.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));
   },added.id);
   const menuEmoji=(menu.項目||[]).join('');
   rec('右クリックの項目に絵文字が無い',!EMOJI.test(menuEmoji),
       (menuEmoji.match(EMOJI)||[]).join('')||'なし');
   await page.keyboard.press('Escape');
   await page.waitForTimeout(200);
   /* ダブルクリックでも同じ窓が開く（入口は2つ・実装は1つ）。 */
   await page.evaluate(id=>{
    const row=[...document.querySelectorAll('.sc-row-line')]
      .find(r=>String(r.dataset.id)===String(id));
    row&&row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
   },added.id);
   await page.waitForTimeout(500);
   const opened=await page.evaluate(()=>({
    出た:!!document.getElementById('scStopEditName'),
    名称:(document.getElementById('scStopEditName')||{}).value||'',
    見積:/いま効いている見積/.test((document.getElementById('appConfirmBody')||{}).textContent||''),
   }));
   rec('ダブルクリックで直す窓が開き、いまの名称が入っている',
       opened.出た&&opened.名称===NEW,JSON.stringify(opened));
   rec('いま効いている見積と出どころを窓に出す',opened.見積===true,String(opened.見積));
   await page.fill('#scStopEditName',NEW+'改');
   await page.fill('#scStopEditMin','45');
   await page.click('#appConfirmOk');
   const after2=await W.poll(planEntries,es=>es.some(e=>String(e.id)===String(added.id)&&e.title===NEW+'改'));
   const ed=after2.find(e=>String(e.id)===String(added.id));
   rec('名称と所要分がマスタ（共有スケジュール）へ入る',
       !!ed&&ed.title===NEW+'改'&&Number(ed.estimateMinutes)===45,
       JSON.stringify(ed&&{t:ed.title,m:ed.estimateMinutes}));
   /* **名称は空にできない**（サーバーが断る）。画面だけで守らない。 */
   const blank=await (await post('/api/schedule/plan/update',{id:added.id,title:'  '})).json();
   rec('設備停止の名称を空にはできない（サーバーが断る）',
       !!blank.error&&/名称/.test(blank.error),JSON.stringify(blank).slice(0,90));
   /* 作業の行の名称は書き換えられない（ロットが辿れなくなる）。 */
   const work=after2.find(e=>e.kind==='作業');
   if(work){
    const w=await (await post('/api/schedule/plan/update',{id:work.id,title:'書き換え'})).json();
    rec('作業の行の名称は書き換えられない',!!w.error,JSON.stringify(w).slice(0,90));
   }else rec('作業の行の名称は書き換えられない',true,'作業の行が無いので省略');
  }
  if(added)await post('/api/schedule/plan/delete',{id:added.id});

  /* ---- 5.9) §9.400: 分類チップ・2列の一覧・停止内容の複製 ----
     利用者の指示「もっとすっきり使いやすいデザインでUIUX検討してください」
     （案B＝上＝一覧の2列／下＝決める帯）と、
     「設備停止内容複製機能の追加／右クリックメニューにないので追加して
      ください」「停止内容(マスタから引っ張ってくるもの)を複製したいです」。 */
  const look=await page.evaluate(()=>{
   const btns=[...document.querySelectorAll('.sc-stop-button')];
   const tops=[...new Set(btns.map(b=>Math.round(b.getBoundingClientRect().top)))];
   return {cats:[...document.querySelectorAll('.sc-stop-cat')].map(x=>x.textContent.trim()),
    /* **2列**は「同じ高さに2枚ある行がある」ことで見る（`grid-template-columns`
       を読むと、CSSの書き方を変えただけで落ちる網になる）。 */
    列:Math.max(...tops.map(t=>btns.filter(b=>Math.round(b.getBoundingClientRect().top)===t).length)),
    帯:!!document.querySelector('.sc-stop-bar'),
    古い右ペイン:!!document.querySelector('.sc-stop-detail')};
  });
  rec('分類はチップで絞れる（「すべて」＋分類ごと）',
      look.cats.length>=3&&/すべて/.test(look.cats[0]),JSON.stringify(look.cats));
  rec('一覧は2列（窓いっぱいを使う）',look.列===2,`同じ高さに最大${look.列}枚`);
  rec('決めるのは足元の1本の帯（左右2ペインはやめた）',
      look.帯&&!look.古い右ペイン,JSON.stringify(look));
  /* 分類チップを押すと、その分類だけになる。 */
  const filt2=await page.evaluate(()=>{
   const c=[...document.querySelectorAll('.sc-stop-cat')].find(x=>/保全/.test(x.textContent));
   if(c)c.click();
   return [...document.querySelectorAll('.sc-stop-group-title')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
  });
  rec('分類チップを押すとその分類だけになる',
      filt2.length===1&&/保全/.test(filt2[0]),JSON.stringify(filt2));
  await page.evaluate(()=>{
   const c=[...document.querySelectorAll('.sc-stop-cat')].find(x=>/すべて/.test(x.textContent));
   if(c)c.click();
  });
  /* **停止内容そのものの複製**（右クリック）。予定の行の複製とは別物。 */
  const dupTarget=await page.evaluate(n=>{
   const b=[...document.querySelectorAll('.sc-stop-button')].find(x=>x.textContent.includes(n));
   return b?b.dataset.id:'';
  },NEW);
  if(dupTarget){
   await page.click(`.sc-stop-button[data-id="${dupTarget}"]`,{button:'right'});
   await page.waitForSelector('.sc-row-menu',{timeout:8000});
   const menu=await page.evaluate(()=>({
    txt:document.querySelector('.sc-row-menu').textContent.replace(/\s+/g,' ').trim(),
    off:[...document.querySelectorAll('.sc-row-menu button')].map(b=>b.disabled)}));
   rec('停止内容の右クリックに「複製」があり、押せる',
       /複製/.test(menu.txt)&&menu.off.every(x=>!x),menu.txt.slice(0,110));
   await page.evaluate(()=>{
    const b=[...document.querySelectorAll('.sc-row-menu button')].find(x=>/複製/.test(x.textContent));
    if(b)b.click();
   });
   /* サーバーが名前を決める（`名称（写し）`）。**一覧に出るまで待つ**——
      押した直後は取り直しの往復がある（時間で待たない）。 */
   await page.waitForFunction(n=>[...document.querySelectorAll('.sc-stop-button b')]
     .some(x=>x.textContent.trim()===n+'（写し）'),NEW,{timeout:15000})
     .catch(e=>{throw new Error('複製した行が一覧に出ない: '+e.message.slice(0,60))});
   const copies=await reasons();
   const copy=(copies.items||[]).find(x=>String(x.name||'').trim()===NEW+'（写し）');
   rec('複製すると「（写し）」がマスタへ1行増える',!!copy,copy&&copy.name);
   /* **中身も写る**——分類・標準所要分（内訳はこの停止内容には無い）。
      写さないと「同じ名前なのに空の行」ができる。 */
   rec('複製は分類と標準所要分ごと写す',
       !!copy&&String(copy.category||'')==='保全'&&Number(copy.standardMinutes)===25,
       JSON.stringify(copy&&{c:copy.category,m:copy.standardMinutes}));
   if(copy)await post('/api/schedule/stop-reason-master/delete',{id:copy.id});
  }else rec('停止内容の右クリックに「複製」があり、押せる',false,'複製元が一覧に無い');

  /* ---- 6) 側パネルでも同じもの ---- */
  await page.click('#scStopModalClose');
  await page.waitForTimeout(600);
  const side=await page.evaluate(()=>{
   const tab=document.querySelector('#scSideToggle');if(tab)tab.click();
   const t=document.querySelector('#scStopSectionToggle');if(t)t.click();
   return true;
  });
  await page.waitForTimeout(700);
  const inSide=await page.evaluate(()=>({box:!!document.querySelector('#scSide #scStopButtons'),
    search:!!document.querySelector('#scSide #scStopSearch'),
    add:!!document.querySelector('#scSide #scStopNewToggle'),
    where:!!document.querySelector('#scSide .sc-stop-bar')}));
  rec('側パネルでも同じ道具が出る（実装は1つ）',
      inSide.box&&inSide.search&&inSide.add&&inSide.where,JSON.stringify(inSide));

  rec('JSエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){console.log('FATAL: '+e.message);R.push({n:'FATAL',ok:false,d:e.message})}
 finally{
  await cleanup().catch(()=>{});
  await b.close();
  const ok=R.filter(x=>x.ok).length;
  console.log(`\n=== SUMMARY ===\n${ok}/${R.length} passed`);
  process.exit(ok===R.length?0:1);
 }
})();
