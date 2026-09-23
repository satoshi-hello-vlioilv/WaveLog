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
     6. `contentEditable`は「既定の中身をマスタに持っているか」の印
        （**書けばどの塊でも紙に出る**・§9.278）

   後片付けは finally で必ず行う。**マスタは実行をまたいで生き延びる**
   （§9.121）ので、戻し忘れると次の実行が引き継ぐ。
   ============================================================ */
'use strict';
const {run}=require('./lib/harness.js');
/* 材料は自分で注ぎ込む（§9.351・§9.362 ⑥）。この網は「記録が1件ある」
   ことを前提にするが、**フィクスチャに記録は無い**——今まで見えていたのは
   前の実行の置き土産で、ランナーが実績を1本ごとに空へ戻すようになった
   （§9.362 ①）とたんに`.record-list-row`の待ちが25秒 timeout した。
   置いたものは`clearRecords()`が片付ける。 */
const {seedRecord}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const TAG='rpm-'+process.pid;
const post=(p,body)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const get=p=>fetch(B+p).then(r=>r.json());
const settle=async page=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
/* 触った行は控えて必ず戻す（この設定は実行をまたいで生き延びる・§9.121）。 */
const touched=[];
const restore=async()=>{
 for(const r of touched){
  try{await post('/api/report-block-master/update',
    {id:r.id,equipment:r.equipment,name:r.name,order:r.order,span:r.span,rows:r.rows,
     content:r.content,note:r.note,enabled:r.enabled,cols:r.cols,user_id:TAG})}catch(e){}
 }
};
/* **「中身の作り方がコードの塊」を1つ選ぶ**（§9.285 ②）。編集可能になった
   塊を選ぶと、この節が確かめたい「盤で組めるのに紙はコードのまま」という
   道を一度も通らない。**紙に出ている塊であること**も要る（§9.248 ②）。 */
const CODE_BLOCK='丈別データ';
const openReport=async page=>{
 await page.evaluate(()=>{if(typeof exitReportView==='function')exitReportView()});
 await seedRecord();
 await page.evaluate(()=>WL.records.openRecordsSafe('編集中'));
 await page.waitForSelector('.record-list-row',{timeout:25000});
 await page.click('.record-list-row .report');
 await page.waitForSelector('#reportContent .rp-blocks',{timeout:25000});
 await settle(page);
};
const blocks=page=>page.evaluate(()=>[...document.querySelectorAll('[data-rp-block]')].map(e=>e.dataset.rpBlock));

run('test_rpmaster: 既定の帳票ブロックもマスタに載せる（§9.219 ②）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
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
  /* `contentEditable`は「**既定の中身をマスタに持っているか**」の印（§9.278）。
     **「書いても効かない」という意味ではない**——書けばどの塊でも紙に出る
     （5bで確かめる）。ここが効くのは、開いたときに既定の並びが入っているか
     どうかだけ。 */
  rec('既定の中身を持つ塊と、持たない塊を見分けられる',
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
  /* **数そのものではなく「紙に占める割合」で見る**（§9.222 ②）。マスタの
     `span`/`rows`は12マス・12段で書かれた既定で、画面はいまの割り
     （既定24マス×48段）へ割り付け直す。数を直に書くと、割りを変えた
     瞬間に落ちる（＝直っていても落ちる網になる）。 */
  const after=await page.evaluate(()=>{
   const e=document.querySelector('[data-rp-block="基本情報"]');
   const g=document.querySelector('.rp-page .rp-blocks');
   const cs=g?getComputedStyle(g):null;
   return e?{span:e.style.gridColumn,row:e.style.gridRow,
             h:Math.round(e.getBoundingClientRect().height),
             cols:Number(cs&&cs.getPropertyValue('--rp-grid'))||0,
             prows:Number(cs&&cs.getPropertyValue('--rp-page-rows'))||0}:null;
  });
  const num=(v,re)=>Number((re.exec(String(v||''))||[])[1]||0);
  rec('マスタで変えた幅が紙の既定になる',
      !!after&&num(after.span,/span (\d+)/)===Math.round(4*after.cols/12),
      JSON.stringify(after)+` 期待=span ${after?Math.round(4*after.cols/12):'?'}`);
  rec('マスタで変えた行数が紙の既定になる',
      !!after&&num(after.row,/span (\d+)/)===Math.round(6*after.prows/12),
      JSON.stringify(after)+` 期待=span ${after?Math.round(6*after.prows/12):'?'}`);

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

  /* ---- 5b) **中身がコードの塊でも、マスの並びを書けば紙に出る**
     （§9.278、利用者の報告「帳票レイアウトの紙の表示では、組んだ通りの表で
      ないだけでなく、指定してもいない項目も板丈として出ており…今までの表示と
      変わらない」）

     以前は`contentEditable`（＝既定の中身をマスタに持っているか）でも絞って
     いたので、**盤では組めるのに紙はコードの既定のまま**という塊があった。
     `測定値の統計`がまさにそれで、ピボットに組んでも紙は今までの横一列の表が
     出ていた（押せるのに何も起きない・§4）。
     **確かめるのは`contentEditable:false`の塊で**——`基本情報`（true）で試す
     網は直す前でも通る。 */
  /* **紙に出ている塊で試すこと**——`測定値の統計`は分割の無いロットでは
     既定で隠れる（§9.248 ②）ので、そこで試すと「出ない」としか分からない。
     **編集できるようになった塊は使えない**（§9.285 ②で`品質等級`・
     `寸法（オーダー／製造）`・`品質情報（仕掛）`・`母材実績／カード指示`の
     4つが`contentEditable:true`になった）——ここで見たいのは「中身がコードの
     塊でも紙はマスの並びを正とするか」なので、**選ぶのは`false`の側**。 */
  const stat=(all.items||[]).find(x=>x.builtin===CODE_BLOCK);
  rec(`前提: ${CODE_BLOCK}は「中身がコードの塊」（contentEditable:false）`,
      !!stat&&stat.contentEditable===false,
      JSON.stringify(stat&&{n:stat.name,ce:stat.contentEditable}));
  if(stat){
   touched.push({...stat});
   const before=await page.evaluate(K=>{
    const s=document.querySelector(`[data-rp-block="${K}"]`);
    return {あり:!!s,表:!!(s&&s.querySelector('table')),
      格子:!!(s&&s.querySelector('.rp-grid')),
      ラベル:[...(s?s.querySelectorAll('.rp-field-label'):[])].length};
   },CODE_BLOCK);
   rec('前提: いまはコードが作る中身で出ている',
       before.あり&&before.ラベル===0,JSON.stringify(before));
   await post('/api/report-block-master/update',
     {id:stat.id,equipment:stat.equipment,name:stat.name,order:stat.order,
      span:stat.span,rows:stat.rows,note:stat.note,enabled:true,cols:2,
      content:TAG+'幅MIN=stat.width.min\n'+TAG+'幅MAX=stat.width.max',user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
   await openReport(page);
   const now=await page.evaluate(K=>{
    const s=document.querySelector(`[data-rp-block="${K}"]`);
    return {表:!!(s&&s.querySelector('table')),
      ラベル:[...(s?s.querySelectorAll('.rp-field-label'):[])].map(e=>e.textContent)};
   },CODE_BLOCK);
   rec('中身がコードの塊でも、マスの並びを書けば紙に出る',
       now.ラベル.filter(t=>t.indexOf(TAG)===0).length===2,
       JSON.stringify(now));
   await post('/api/report-block-master/update',
     {id:stat.id,equipment:stat.equipment,name:stat.name,order:stat.order,
      span:stat.span,rows:stat.rows,note:stat.note,enabled:true,cols:stat.cols,
      content:'',user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
   await openReport(page);
   const back2=await page.evaluate(K=>{
    const s=document.querySelector(`[data-rp-block="${K}"]`);
    return {あり:!!s,ラベル:[...(s?s.querySelectorAll('.rp-field-label'):[])].length};
   },CODE_BLOCK);
   /* **もう片側**——空にしたら今までどおりコードの中身へ戻る（`[内容]`を
      触っていない現場の紙は1マスも変わらない）。 */
   rec('空にすればコードの中身へ戻る（触っていない現場の紙は変わらない）',
       back2.あり&&back2.ラベル===0,JSON.stringify(back2));

   /* ---- 5c) **内訳の列数が空でも、表に組んだ形のまま紙に出る**
      （§9.280、利用者の報告「VER2.158.2でもまだ直っていません。
       帳票レイアウト(プレビュー)が２列で変わっていない」）

      盤の「表に組む」は列数を欄へ書き込むが、**欄が空のまま保存されている
      塊**（既定の塊は0で始まる）では紙が2列へ落ち、見出しと値が総崩れに
      なっていた。§9.279で当てるようにしたが「左上の空きマスの縦が2以上」の
      ときだけで、**列の軸が1本の形**——`行＝項目／列＝集計`という
      いちばん多い形——は当てられないままだった。
      **サーバーからの往復で確かめる**こと（`WL.reportSectionHtml`を直に
      呼ぶ網は、保存の道もマスの読み直しも一度も通らない）。 */
   const cell=(o)=>Object.assign({label:'',path:'',span:1,rows:1,kind:'value',
     showLabel:true,align:'',format:null,lot:false},o);
   /* 行＝項目（板厚・板幅）／列＝集計（MIN・MAX）＝3列 */
   const pivot=[cell({kind:'blank'}),
     cell({kind:'head',label:'MIN'}),cell({kind:'head',label:'MAX'}),
     cell({kind:'head',label:'板厚',align:'left'}),
     cell({label:'板厚 MIN',path:'stat.thickness.min',showLabel:false,align:'right'}),
     cell({label:'板厚 MAX',path:'stat.thickness.max',showLabel:false,align:'right'}),
     cell({kind:'head',label:'板幅',align:'left'}),
     cell({label:'板幅 MIN',path:'stat.width.min',showLabel:false,align:'right'}),
     cell({label:'板幅 MAX',path:'stat.width.max',showLabel:false,align:'right'})];
   await post('/api/report-block-master/update',
     {id:stat.id,equipment:stat.equipment,name:stat.name,order:stat.order,
      span:stat.span,rows:stat.rows,note:stat.note,enabled:true,cols:0,
      content:JSON.stringify(pivot),user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
   await openReport(page);
   const piv=await page.evaluate(K=>{
    const g=document.querySelector(`[data-rp-block="${K}"] .rp-grid`);
    return g?{列:getComputedStyle(g).getPropertyValue('--rp-cols').trim(),
      見出し:[...g.querySelectorAll('.rp-field-head')].map(e=>e.textContent.trim())}
      :{列:'(格子なし)',見出し:[]};
   },CODE_BLOCK);
   rec('§9.280 内訳の列数が空でも、表に組んだ形の列数のまま紙に出る',
       piv.列==='3',JSON.stringify(piv));
   rec('§9.280 見出しのマスもそのまま紙に出る',
       piv.見出し.join(',')==='MIN,MAX,板厚,板幅',JSON.stringify(piv.見出し));

   /* ---- 5d) **「中の並べ方」で表を壊さない**（§9.282、利用者の報告
      「帳票ブロックマスタでは正しく再現して表示もするのに、紙の帳票
       レイアウトだと、全然違う表を持ってくる」）

      `流:`（この紙だけの設定）は塊に`rp-flow-*`を貼り、CSSが
      `display:block; column-count:2`でグリッドそのものを解いていた
      ——`grid-column:span N`も`--rp-cols`も一度に無効になり、軸のマスが
      ばらけて縦に流れる（＝「入りきらない別の表」）。しかもこの印は
      **紙だけ**なので、盤の「中身の見本」には原理的に当たらない
      ＝「見本は正しいのに紙だけ別物」がそのまま作れる。
      守りは2枚——①表には当てない（保存済みの設定でも壊れない）
      ②窓では押せなくして理由を書く（§4）。 */
   const flowed=await page.evaluate(K=>{
    const e=document.querySelector(`[data-rp-block="${K}"]`);
    const g=e&&e.querySelector('.rp-grid');
    if(!g)return {格子なし:true};
    const read=()=>({disp:getComputedStyle(g).display,
      列:getComputedStyle(g).gridTemplateColumns.split(' ').length,
      段組:getComputedStyle(g).columnCount});
    const 前=read();
    const out={};
    for(const c of ['rp-flow-col','rp-flow-fit','rp-flow-tall']){
     e.classList.add(c);out[c]=read();e.classList.remove(c);
    }
    return {前,...out};
   },CODE_BLOCK);
   rec('§9.282 「中の並べ方」を当てても表のグリッドは解けない',
       !flowed.格子なし&&['rp-flow-col','rp-flow-fit','rp-flow-tall']
         .every(c=>flowed[c].disp==='grid'&&flowed[c].列===flowed.前.列),
       JSON.stringify(flowed));

   await page.click('#reportArrange');
   await W.until(page,()=>document.body.classList.contains('rp-arranging'),null,{ms:8000,what:'組み換えに入る'});
   await idle();
   const flowUi=await page.evaluate(K=>{
    const pb=document.querySelector(`[data-rp-block="${K}"] .rp-block-paper`);
    if(!pb)return {入口なし:true};
    pb.click();
    const rows=[...document.querySelectorAll('#rpBlockForm .rp-form-row')];
    const row=rows.find(r=>(r.querySelector('.rp-form-label')||{}).textContent==='中の並べ方');
    if(!row)return {欄なし:true};
    const bs=[...row.querySelectorAll('button[data-e-flow]')];
    return {既定:bs.filter(b=>!b.dataset.eFlow).every(b=>!b.disabled),
      他:bs.filter(b=>b.dataset.eFlow).map(b=>b.disabled),
      文:(row.querySelector('.rp-form-note')||{}).textContent||''};
   },CODE_BLOCK);
   rec('§9.282 表に組んだ塊では「中の並べ方」を押せなくする（§4）',
       !flowUi.入口なし&&!flowUi.欄なし&&flowUi.既定===true
       &&flowUi.他.length>0&&flowUi.他.every(Boolean),JSON.stringify(flowUi.他));
   rec('§9.282 押せない理由を文字で書く',
       !!flowUi.文&&flowUi.文.indexOf('表（マトリクス）に組んである')>=0,
       String(flowUi.文).slice(0,60));
   await page.evaluate(()=>{const m=document.getElementById('rpBlockModal');if(m)m.hidden=true});
   await page.click('#reportArrange');
   await W.until(page,()=>!document.body.classList.contains('rp-arranging'),null,{ms:8000,what:'組み換えを抜ける'});
   await idle();
   await post('/api/report-block-master/update',
     {id:stat.id,equipment:stat.equipment,name:stat.name,order:stat.order,
      span:stat.span,rows:stat.rows,note:stat.note,enabled:true,cols:stat.cols,
      content:'',user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
  }

  /* ---- 5e) **古い版が作った「同じ名前の行」でも紙は既定の塊を出す**
     （§9.282）。入口（`block_upsert`）で断るようにしたので新しくは作れないが、
     **既に作ってしまったマスタが現場にある**。塊は名前が鍵なので、同じ名前が
     2つあると紙はどちらを出すか決められず、実測では**既定の塊が紙から消えた**
     （＝「盤では出るのに紙に無い／別物が出る」）。応答を差し替えて、その状態を
     わざと作って確かめる。 */
  await page.route('**/api/report-block-master*',async route=>{
   const res=await route.fetch();
   let body;try{body=await res.json()}catch(e){return route.fulfill({response:res})}
   if(body&&Array.isArray(body.items)){
    const seed=body.items.find(x=>x.builtin===CODE_BLOCK);
    if(seed)body.items.push(Object.assign({},seed,
      {id:987654,builtin:'',equipment:'*',name:CODE_BLOCK,
       content:'[{"kind":"value","path":"basic.lotNo","label":"にせもの","span":1,"rows":1,"showLabel":true,"align":"","format":null,"lot":false}]',
       cols:1,fields:[{label:'にせもの',path:'basic.lotNo'}],contentEditable:true}));
   }
   return route.fulfill({json:body});
  });
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);
  const dup=await page.evaluate(K=>{
   const es=[...document.querySelectorAll(`[data-rp-block="${K}"]`)];
   return {枚数:es.length,
     にせもの:es.some(e=>e.textContent.indexOf('にせもの')>=0)};
  },CODE_BLOCK);
  rec('§9.282 同じ名前の行がマスタに残っていても、紙から既定の塊が消えない',
      dup.枚数===1,JSON.stringify(dup));
  rec('§9.282 同じ名前の行の中身は紙に出さない（どちらを出すか決められないため）',
      dup.にせもの===false,JSON.stringify(dup));
  await page.unroute('**/api/report-block-master*');
  await page.evaluate(()=>WL.reportBlocks.forget());
  await openReport(page);

  /* ---- 6) 改名は**紙の見出しまで**変わる（§9.219 ②／§CLAUDE 8） ----
     組み換えの帯・パレット・ゴーストだけが新しい名前になり、紙の見出しは
     コードの題のまま、では**同じ塊に2つの名前**が出る。中身の作り方が
     コードの塊でも、題は文字なので揃えられる。**編集できるようになった塊は
     使わない**（§9.285 ②。`CODE_BLOCK`の説明を参照）。 */
  const grade=(all.items||[]).find(x=>x.builtin===CODE_BLOCK);
  rec(`前提: ${CODE_BLOCK}の行がある（中身はコードの塊）`,
      !!grade&&grade.contentEditable===false,JSON.stringify(grade&&{n:grade.name,ce:grade.contentEditable}));
  if(grade){
   touched.push({...grade});
   await post('/api/report-block-master/update',
     {id:grade.id,equipment:grade.equipment,name:TAG+'改名',order:grade.order,
      span:grade.span,rows:grade.rows,content:grade.content,note:grade.note,
      enabled:true,cols:grade.cols,user_id:TAG});
   await page.evaluate(()=>WL.reportBlocks.forget());
   await openReport(page);
   const named=await page.evaluate(K=>{
    const e=document.querySelector(`[data-rp-block="${K}"]`);
    const h=e?e.querySelector('.rp-section>h3'):null;
    return {題:h?h.textContent:'(無い)',
      /* 組み換え中の呼び名も同じであること（2つの名前を出さない）。 */
      在る:!!e};
   },CODE_BLOCK);
   rec('改名すると紙の見出しも変わる（呼び名を2つ出さない）',
       named.在る&&named.題===TAG+'改名',JSON.stringify(named));
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
  /* 置いた実績は自分で消す（§9.351・§9.362）。 */
  try{await require('./lib/harness.js').clearRecords()}catch(e){console.log('!! 実績の後片付けに失敗: '+(e&&e.message||e))}
 }
}, {viewport:{width:1700,height:1000}});
