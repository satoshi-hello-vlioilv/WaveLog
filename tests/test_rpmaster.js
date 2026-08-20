/* test_rpmaster.js: 既定の帳票ブロックもマスタに載せる（§9.219 ②）
   ============================================================
   利用者の指示:
     「既定の帳票ブロックについても編集ができるように、マスタに登録されて
      いる状態に汎用化してください」

   境界は`操業データ項目マスタ`の組み込み行と同じ引き方（§9.216 ②）——
   **中身の作り方はコードのまま**で、マスタが持つのは名前・幅・行数・並び・
   出す/出さない・対象設備。ただし「ラベルと値の出どころを並べただけ」の
   塊は`[内容]`もマスタが持つ。

   ここで固定するのは6点。
     1. コードの既定の塊が**1つ残らず**マスタに載っている（キーが食い違わない）
     2. 既定の塊は**消せない**（消えたように見えて出続けるほうが分かりにくい）
     3. 幅・行数をマスタで変えると**紙の既定**にも出る
     4. 「有効」を外すと`builtinOff`で名指しされ、**紙から消える**
     5. 内容を書き換えると紙に出て、**空にすると画面がもともと持つ形へ戻る**
     6. 中身がコードの塊は`contentEditable:false`（書いても効かないと分かる）

   後片付けは finally で必ず行う。**マスタは実行をまたいで生き延びる**
   （§9.121）ので、戻し忘れると次の実行が引き継ぐ。
   ============================================================ */
const { chromium } = require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const B='http://127.0.0.1:5029';
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EQ='テスト設備A';
const TAG='rpm-'+process.pid;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const get=p=>fetch(B+p).then(r=>r.json());
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
let b=null;
/* 触った行は控えて必ず戻す（この設定は実行をまたいで生き延びる・§9.121）。 */
const touched=[];
const restore=async()=>{
 for(const r of touched){
  try{await post('/api/report-block-master/update',
    {id:r.id,equipment:r.equipment,name:r.name,order:r.order,span:r.span,rows:r.rows,
     content:r.content,note:r.note,enabled:r.enabled,cols:r.cols,user_id:TAG})}catch(e){}
 }
};
const openReport=async page=>{
 await page.evaluate(()=>{if(typeof exitReportView==='function')exitReportView()});
 await page.evaluate(()=>openRecordsSafe('編集中'));
 await page.waitForSelector('.record-list-row',{timeout:25000});
 await page.click('.record-list-row .report');
 await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
 await settle(page);
};
const blocks=page=>page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));

(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1700,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:30000});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});

  /* ---- 1) コードの既定の塊が1つ残らずマスタに載っている ---- */
  const all=await get('/api/report-block-master');
  const master=new Set((all.items||[]).map(x=>x.builtin).filter(Boolean));
  const code=await page.evaluate(()=>WL.reportBlocks.keys());
  const missing=code.filter(k=>!master.has(k));
  const extra=[...master].filter(k=>!code.includes(k));
  rec('コードの既定の塊が1つ残らずマスタに載っている',
      code.length>0&&missing.length===0&&extra.length===0,
      JSON.stringify({コード:code.length,マスタ:master.size,足りない:missing,余分:extra}));
  rec('サーバーが「中身を書き換えてよい塊」を名指しで返す',
      Array.isArray(all.contentEditable)&&all.contentEditable.includes('基本情報')
      &&!all.contentEditable.includes('異常位置判定'),
      JSON.stringify(all.contentEditable));
  const basic=(all.items||[]).find(x=>x.builtin==='基本情報');
  const defect=(all.items||[]).find(x=>x.builtin==='異常位置判定');
  rec('前提: 基本情報と異常位置判定の行がある',!!basic&&!!defect,
      JSON.stringify({基本情報:!!basic,異常位置判定:!!defect}));
  if(!basic||!defect)throw Error('種が入っていない');
  touched.push({...basic},{...defect});
  rec('中身がコードの塊は「書き換えられない」と分かる',
      basic.contentEditable===true&&defect.contentEditable===false,
      JSON.stringify({基本情報:basic.contentEditable,異常位置判定:defect.contentEditable}));
  rec('既定の塊は中身の並びを持っている（ラベル＝出どころ）',
      (basic.fields||[]).some(f=>f.label==='ロット番号'&&f.path==='basic.lotNo'),
      JSON.stringify((basic.fields||[]).slice(0,2)));

  /* ---- 2) 既定の塊は消せない ---- */
  const del=await post('/api/report-block-master/delete',{id:basic.id,user_id:TAG});
  const delj=await del.json();
  rec('既定の塊は消せない（理由と打つ手を書く）',
      !!delj.error&&/有効/.test(delj.error),String(delj.error||delj.ok).slice(0,90));

  /* ---- 3) 幅・行数をマスタで変えると紙の既定に出る ---- */
  await openReport(page);
  const before=await page.evaluate(()=>{
   const e=document.querySelector('[data-rp-block="基本情報"]');
   return e?{span:e.style.gridColumn,row:e.style.gridRow}:null;
  });
  rec('前提: 紙に基本情報が出ている',!!before,JSON.stringify(before));
  await post('/api/report-block-master/update',
    {id:basic.id,equipment:basic.equipment,name:basic.name,order:basic.order,
     span:4,rows:6,content:basic.content,note:basic.note,enabled:true,cols:basic.cols,user_id:TAG});
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);
  const after=await page.evaluate(()=>{
   const e=document.querySelector('[data-rp-block="基本情報"]');
   return e?{span:e.style.gridColumn,row:e.style.gridRow,
             h:Math.round(e.getBoundingClientRect().height)}:null;
  });
  rec('マスタで変えた幅が紙の既定になる',
      !!after&&/span 4/.test(after.span),JSON.stringify(after));
  rec('マスタで変えた行数が紙の既定になる',
      !!after&&/span 6/.test(after.row||''),JSON.stringify(after));

  /* ---- 4) 「有効」を外すと紙から消える ---- */
  await post('/api/report-block-master/update',
    {id:basic.id,equipment:basic.equipment,name:basic.name,order:basic.order,
     span:basic.span,rows:basic.rows,content:basic.content,note:basic.note,
     enabled:false,cols:basic.cols,user_id:TAG});
  const off=await get('/api/report-block-master?equipment='+encodeURIComponent(EQ));
  rec('「出さない」にした既定の塊は名指しで返る（画面が消せるように）',
      (off.builtinOff||[]).includes('基本情報'),JSON.stringify(off.builtinOff));
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);
  const gone=await blocks(page);
  rec('「出さない」にすると紙から消える',!gone.includes('基本情報'),
      JSON.stringify(gone.slice(0,6)));

  /* ---- 5) 内容を書き換えると紙に出る／空にすると元へ戻る ---- */
  await post('/api/report-block-master/update',
    {id:basic.id,equipment:basic.equipment,name:basic.name,order:basic.order,
     span:basic.span,rows:basic.rows,note:basic.note,enabled:true,cols:basic.cols,
     content:'ロット番号=basic.lotNo\n'+TAG+'=basic.customer',user_id:TAG});
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);
  const labels=await page.evaluate(()=>[...document.querySelectorAll(
    '[data-rp-block="基本情報"] .rp-field-label')].map(e=>e.textContent));
  rec('内容を書き換えると紙に出る',
      labels.includes(TAG)&&labels.length===2,JSON.stringify(labels));
  await post('/api/report-block-master/update',
    {id:basic.id,equipment:basic.equipment,name:basic.name,order:basic.order,
     span:basic.span,rows:basic.rows,note:basic.note,enabled:true,cols:basic.cols,
     content:'',user_id:TAG});
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);
  const back=await page.evaluate(()=>[...document.querySelectorAll(
    '[data-rp-block="基本情報"] .rp-field-label')].map(e=>e.textContent));
  rec('内容を空にすると画面がもともと持つ形へ戻る',
      back.length>2&&back.includes('ロット番号')&&!back.includes(TAG),
      JSON.stringify(back.slice(0,4))+` /${back.length}件`);

  /* ---- 6) 改名は**紙の見出しまで**変わる（§9.219 ②／§CLAUDE 8） ----
     組み換えの帯・パレット・ゴーストだけが新しい名前になり、紙の見出しは
     コードの題のまま、では**同じ塊に2つの名前**が出る。中身の作り方が
     コードの塊（品質等級）でも、題は文字なので揃えられる。 */
  const grade=(all.items||[]).find(x=>x.builtin==='品質等級');
  rec('前提: 品質等級の行がある（中身はコードの塊）',
      !!grade&&grade.contentEditable===false,JSON.stringify(grade&&{n:grade.name,ce:grade.contentEditable}));
  if(grade){
   touched.push({...grade});
   await post('/api/report-block-master/update',
     {id:grade.id,equipment:grade.equipment,name:TAG+'等級',order:grade.order,
      span:grade.span,rows:grade.rows,content:grade.content,note:grade.note,
      enabled:true,cols:grade.cols,user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
   await openReport(page);
   const named=await page.evaluate(()=>{
    const e=document.querySelector('[data-rp-block="品質等級"]');
    const h=e?e.querySelector('.rp-section>h3'):null;
    return {題:h?h.textContent:'(無い)',
      /* 組み換え中の呼び名も同じであること（2つの名前を出さない）。 */
      在る:!!e};
   });
   rec('改名すると紙の見出しも変わる（呼び名を2つ出さない）',
       named.在る&&named.題===TAG+'等級',JSON.stringify(named));
  }

  /* ---- 7) 導出のある値も「道」で引ける（calc.*） ---- */
  const wt=(all.items||[]).find(x=>x.builtin==='作業時間');
  rec('導出のある値は calc.◯◯ の道で書いてある（実働時間・状態）',
      !!wt&&(wt.fields||[]).some(f=>f.path==='calc.workDuration'),
      JSON.stringify((wt||{}).fields));

  rec('コンソールに例外を出さない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){rec('FATAL',false,e.message)}
 finally{
  await restore();
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
