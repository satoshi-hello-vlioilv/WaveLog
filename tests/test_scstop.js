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
async function cleanup(){
 try{
  const r=await reasons();
  for(const x of (r.items||[]))
   if(x.name===NEW||SEED.some(s=>s[1]===x.name))await post('/api/schedule/stop-reason-master/delete',{id:x.id});
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

  /* ---- 1) どこへ入るのか ---- */
  const where=await page.evaluate(()=>document.querySelector('#scStopWhere')?.textContent.replace(/\s+/g,' ').trim()||'');
  rec('どこへ入るのかが先に書いてある',where.includes(EQ)&&/いちばん後ろ/.test(where),where.slice(0,80));

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
  /* 押すと**手順**が開く（§9.389、利用者の指示「設備停止内容を選択し、
     その後時間を選択して登録する」）。内訳を持たない停止なので段は
     「時間を選ぶ」の1つだけで、標準所要分が最初から選ばれている。 */
  await page.waitForSelector('.sc-sp',{timeout:10000});
  const step=await page.evaluate(()=>({
   title:(document.querySelector('.sc-sp-title')||{}).textContent||'',
   steps:[...document.querySelectorAll('.sc-sp-t')].map(x=>x.textContent.trim()),
   pick:(document.querySelector('.sc-sp-pick')||{}).textContent||'',
   go:(document.querySelector('#scSpGo')||{}).textContent||'',
   goOff:!!(document.querySelector('#scSpGo')||{}).disabled,
   listGone:!document.querySelector('.sc-stop-button'),
   back:!!document.querySelector('#scSpBack'),
  }));
  rec('押すと手順が開く（一覧と入れ替わる・戻る道がある）',
      step.listGone&&step.back&&step.title.includes(NEW),JSON.stringify(step).slice(0,160));
  rec('内訳を持たない停止では段は「時間を選ぶ」だけ',
      step.steps.length===1&&step.steps[0]==='時間を選ぶ',step.steps.join('/'));
  rec('標準所要分（25分）が最初から選ばれている',/25/.test(step.pick),step.pick);
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
    where:!!document.querySelector('#scSide #scStopWhere')}));
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
