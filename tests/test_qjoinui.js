/* test_qjoinui.js: クエリ結合の画面（§9.193）
   ============================================================
   固定するのは4つ:
     1. データ接続の一覧が**行で並び、見出しと同じ列定義を共有する**
        （カード形式では項目の左端が行ごとにずれて列として追えなかった）
     2. クエリ結合のタブから、**登録済みのデータ接続の組み合わせだけ**で
        結合を作れること（保存する前に当ててみられること）
     3. 一覧の帯が**結合の名前と件数を文字で**言い、列の設定パネルが
        足された列を「結合」に分類すること（色だけで伝えない）
     4. スケジュール表の内容欄で、結合で足した列を**選べて・値が出る**こと

   **後始末は必ず行う**——マスタDBは実行をまたいで生き延びるので（§9.121）、
   落ちても finally で消す。ブラウザも必ず閉じる。 */
'use strict';
const {run}=require('./lib/harness.js');
const B='http://127.0.0.1:5029';
const NAME='テスト結合UI';
const EQ='テスト設備A';
let joinId=null,contentTouched=false,builtinTouched=false;

async function call(method,path,body){
 const r=await fetch(B+path,{method,headers:{'Content-Type':'application/json'},
   body:body?JSON.stringify(body):undefined});
 let j={};try{j=await r.json()}catch(_){}
 return {status:r.status,body:j};
}
const raf2=page=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));

run('test_qjoinui: クエリ結合の画面（§9.193）', async ({page,rec,B,W,idle,paint,errs,browser})=>{
 try{
  const cat=(await call('GET','/api/catalog')).body;
  const WORK=cat.workKey;   // 品質のキーは使わなくなった（候補はサーバーに聞く・§9.364）

  /* ---- 1) データ接続の一覧は「行」で、見出しと同じ列定義 ---- */
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.evaluate(()=>localStorage.setItem('AccessMeasurementConfiguredEquipment','テスト設備A'));
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="dataSource"]',{timeout:20000});
  /* 更新者IDはマスタ更新の必須項目（requireMaintUser）。入れずに保存すると
     トーストが出るだけで**何も起きない**ので、先に入れておく。 */
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'test-qjoin');
  await page.click('#masterMaintNav [data-master="dataSource"]');
  await page.waitForSelector('#masterMaintList .ds-rows .ds-row:not(.ds-row-head)',{timeout:20000});
  await raf2(page);
  const dsRows=await page.evaluate(()=>{
   const head=document.querySelector('#masterMaintList .ds-row-head');
   const rows=[...document.querySelectorAll('#masterMaintList .ds-row:not(.ds-row-head)')];
   const cs=el=>getComputedStyle(el).gridTemplateColumns;
   return {count:rows.length,headCols:cs(head),
           all:[...new Set([cs(head),...rows.map(cs)])],
           same:rows.every(r=>cs(r)===cs(head)),
           listed:rows.map(r=>r.querySelector('.ds-listed')?.textContent.trim()||''),
           heights:rows.map(r=>Math.round(r.getBoundingClientRect().height))};
  });
  rec('データ接続は1行＝1データソースで並ぶ',dsRows.count>=2,dsRows.count+'行');
  rec('見出しと本文が同じ列定義を共有する（左端がそろう）',dsRows.same,dsRows.all.join(' | '));
  rec('「一覧に出す/出さない」が行に出ている',
      dsRows.listed.every(t=>t==='出す'||t==='出さない'),JSON.stringify(dsRows.listed));
  /* 高密度＝1行が2行ぶんの高さに膨らんでいないこと。行の高さは文字サイズから
     決まるので、絶対値ではなく**見出し行との比**で見る（表示サイズに追随する）。 */
  const headH=await page.$eval('#masterMaintList .ds-row-head',n=>Math.round(n.getBoundingClientRect().height));
  rec('1行が見出し行の2倍を超えない（高密度）',
      dsRows.heights.every(h=>h<=headH*2.4),`見出し${headH}px 行${JSON.stringify(dsRows.heights)}`);

  /* ---- 2) クエリ結合のタブ ---- */
  rec('クエリ結合のタブがある',
      await page.$('#masterMaintNav [data-master="queryJoin"]')!==null);
  await page.click('#masterMaintNav [data-master="queryJoin"]');
  await page.waitForSelector('#qjAddBtn',{timeout:20000});
  const sources=await page.evaluate(()=>{
   const b=document.querySelector('#qjAddBtn');b.click();
   return new Promise(r=>setTimeout(()=>{
    const sel=document.querySelector('[data-qj-field="right"]');
    r([...(sel?sel.options:[])].map(o=>o.value).filter(Boolean));
   },400));
  });
  /* **「登録済み」はサーバーに聞く**（§9.364で役割「実績」が増えたときに
     この網が落ちた）。手で並べた一覧を正にすると、データソースを1件足す
     たびに**製品ではなく網が落ちる**——見たいのは「登録されていないキーが
     混ざらない」ことであって、キーの顔ぶれそのものではない。 */
  const registered=await page.evaluate(async()=>{
   const r=await fetch('/api/data-source-master').then(x=>x.json()).catch(()=>({}));
   return (r.items||[]).map(x=>x.key);
  });
  rec('相手はデータ接続に登録済みのものだけから選ぶ',
      sources.length>0&&registered.length>0&&sources.every(k=>registered.includes(k)),
      JSON.stringify({出た:sources,登録済み:registered}));
  /* ---- 2a) 突合キーは**両側の列を並べて結ぶ**（§9.197、利用者の指示） ----
     列の一覧が両側とも入るまで待つ（/api/table-columns の往復）。 */
  await page.waitForFunction(()=>{
   const l=document.querySelectorAll('[data-qj-list="left"] .qj-field').length;
   const r=document.querySelectorAll('[data-qj-list="right"] .qj-field').length;
   return l>2&&r>2;
  },{timeout:20000});
  const panes=await page.evaluate(()=>{
   const one=side=>{
    const p=document.querySelector(`[data-qj-pane="${side}"]`);
    const f=[...document.querySelectorAll(`[data-qj-list="${side}"] .qj-field`)];
    return {n:f.length,
      tag:p?.querySelector('.qj-pane-tag')?.textContent.trim()||'',
      meta:p?.querySelector('.qj-pane-meta')?.textContent.replace(/\s+/g,' ').trim()||'',
      /* 実データの例が添えられているか（形が違えば当たらないと分かる）。 */
      eg:f.filter(x=>/^[^\s]/.test(x.querySelector('.qj-fld-eg')?.textContent||'')).length,
      search:!!p?.querySelector('[data-qj-search]'),
      draggable:f.every(x=>x.draggable)};
   };
   return {left:one('left'),right:one('right')};
  });
  rec('突合キーの候補は実際の列を並べて選ぶ',
      panes.left.n>2&&panes.right.n>2,JSON.stringify({左:panes.left.n,右:panes.right.n}));
  rec('どのデータのどの表を見ているのかが画面に出る',
      /列/.test(panes.left.meta)&&/表/.test(panes.left.meta)&&/列/.test(panes.right.meta),
      JSON.stringify({左:panes.left.meta,右:panes.right.meta}));
  rec('どちら側かが文字で書いてある',
      panes.left.tag.includes('この一覧')&&panes.right.tag.includes('相手'),
      JSON.stringify([panes.left.tag,panes.right.tag]));
  rec('列は絞り込めて、ドラッグでも掴める',
      panes.left.search&&panes.right.search&&panes.left.draggable&&panes.right.draggable,
      JSON.stringify(panes));
  rec('列に実データの例が添えられる',panes.left.eg>0&&panes.right.eg>0,
      JSON.stringify({左:panes.left.eg,右:panes.right.eg}));
  /* 列名で絞り込むと**一覧だけ**が変わる（入力欄が作り替わるとカーソルが
     飛ぶので、そこは触らない。§9.117）。 */
  await page.click('[data-qj-search="left"]');
  await page.type('[data-qj-search="left"]','ロット');
  await paint();   // 絞り込みは input の中で同期に描き直す
  const filtered=await page.evaluate(()=>({
   n:document.querySelectorAll('[data-qj-list="left"] .qj-field').length,
   names:[...document.querySelectorAll('[data-qj-list="left"] .qj-fld-name')].map(x=>x.textContent.trim()),
   value:document.querySelector('[data-qj-search="left"]').value,
   focused:document.activeElement===document.querySelector('[data-qj-search="left"]')}));
  rec('列名で絞り込める（打っている最中に欄が作り替わらない）',
      filtered.n>0&&filtered.n<panes.left.n&&filtered.value==='ロット'&&filtered.focused,
      JSON.stringify(filtered).slice(0,160));
  /* **押して結ぶ**：この一覧の列 → 相手の列。1つ目を押した時点で
     「次に何を押すか」が帯に出る。 */
  const clickField=(side,col)=>page.evaluate(([s,c])=>{
   const el=[...document.querySelectorAll(`[data-qj-list="${s}"] .qj-field`)]
     .find(x=>x.dataset.col===c);
   if(el)el.click();
   return !!el;
  },[side,col]);
  await clickField('left','ロット番号');
  await paint();
  const midPick=await page.evaluate(()=>({
   picked:[...document.querySelectorAll('.qj-field.is-pick')].map(x=>x.dataset.col),
   status:document.querySelector('.qj-merge-status')?.textContent.replace(/\s+/g,' ').trim()||''}));
  rec('1つ目を押すと、次にすることが1つだけ書かれる',
      midPick.picked.length===1&&/次に相手の列を押す/.test(midPick.status),JSON.stringify(midPick));
  await clickField('right','ロット番号');
  await idle();
  const paired=await page.evaluate(()=>({
   pairs:[...document.querySelectorAll('.qj-pair')].map(x=>x.textContent.replace(/\s+/g,' ').trim()),
   keyMarks:[...document.querySelectorAll('.qj-fld-key')].map(x=>x.textContent.trim()),
   picked:document.querySelectorAll('.qj-field.is-pick').length}));
  rec('左右を1つずつ押すと組になる',paired.pairs.length===1&&/ロット番号/.test(paired.pairs[0]),
      JSON.stringify(paired.pairs));
  rec('結ばれた列は両側に同じ印が付く',
      paired.keyMarks.filter(t=>t==='鍵1').length===2&&paired.picked===0,
      JSON.stringify(paired.keyMarks));
  /* **ドラッグでも同じことが起きる**（片方だけ効くと壊れて見える）。
     **絞り込みを先に消すこと**——絞ったままだと相手の列が一覧に無く、
     「見つからないので飛ばす」で**何も確かめないまま通る**（実際に通った）。 */
  await page.evaluate(()=>{const el=document.querySelector('[data-qj-search="left"]');
   el.value='';el.dispatchEvent(new Event('input',{bubbles:true}))});
   await paint();
  const dragged=await page.evaluate(()=>{
   const l=[...document.querySelectorAll('[data-qj-list="left"] .qj-field')]
     .find(x=>x.dataset.col==='鋳造番号');
   const r=[...document.querySelectorAll('[data-qj-list="right"] .qj-field')]
     .find(x=>x.dataset.col==='鋳造番号');
   if(!l||!r)return {skip:true,left:!!l,right:!!r};
   const dt=new DataTransfer();
   l.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));
   r.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));
   r.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));
   l.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));
   return {skip:false};
   });
   await idle();
  const afterDrag=await page.evaluate(()=>[...document.querySelectorAll('.qj-pair')]
    .map(x=>x.textContent.replace(/\s+/g,' ').trim()));
  rec('ドラッグして重ねても組になる',
      !dragged.skip&&afterDrag.length===2,JSON.stringify({dragged,afterDrag}));
  /* 組は×で外せる（外す手立てが組の隣にある）。 */
  await page.evaluate(()=>{const b=[...document.querySelectorAll('.qj-pair-del')].pop();if(b)b.click()});
  await idle();
  const afterDel=await page.evaluate(()=>document.querySelectorAll('.qj-pair').length);
  rec('組は×で外せる',afterDel===1,String(afterDel));
  // 名前・接頭辞を入れて下見が出ることを見る
  await page.evaluate(n=>{
   const set=(sel,v)=>{const el=document.querySelector(sel);el.value=v;
     el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};
   set('[data-qj-field="name"]',n);
   set('[data-qj-field="prefix"]','UI_');
  },NAME);
  /* **下見が入れ替わるのを待つこと**。`.qj-probe-ok`があることだけを待つと、
     キーを結んだ時点の（接頭辞を入れる前の）下見がもう出ているので、
     待ちが即座に通って**古い文字を読む**（実際に読んだ）。 */
  await page.waitForFunction(()=>/UI_/.test(document.querySelector('#qjProbeBox')?.textContent||''),
    {timeout:20000});
  const probe=await page.$eval('#qjProbeBox',n=>n.textContent.replace(/\s+/g,' ').trim());
  rec('保存する前に「何件に当たるか」が文字で出る',/行に当たりました/.test(probe),probe.slice(0,90));
  rec('足す列の名前も出る（何が増えるか分かる）',/UI_/.test(probe),probe.slice(0,140));

  /* ---- 2b) 結合の仕方は図・説明・見本の表で選ぶ（§9.194） ---- */
  const kinds=await page.evaluate(()=>{
   const cards=[...document.querySelectorAll('.qj-kinds .qj-kind')];
   return {n:cards.length,
     venn:cards.filter(c=>c.querySelector('svg.qj-venn')).length,
     /* **塗り分けが図ごとに違うこと。** 6枚が同じ絵だと、図があっても
        何も伝えていない（塗る円の数と種類で見分ける）。 */
     shapes:[...new Set(cards.map(c=>[...c.querySelectorAll('svg.qj-venn .on')]
       .map(x=>((x.getAttribute('mask')||x.getAttribute('clip-path')||'').match(/-(ml|mr|c)\)?$/)||[null,'?'])[1])
       .sort().join('')))].length,
     /* 色だけで伝えない: 名前・一行説明・行の増減が文字で出ていること。 */
     labels:cards.map(c=>c.querySelector('b')?.textContent.trim()||''),
     rows:cards.every(c=>(c.querySelector('.qj-kind-rows')?.textContent||'').trim()!==''),
     sample:!!document.querySelector('.qj-kind-detail .qj-sample-t.is-result')};
  });
  rec('結合の仕方を6通りから選べる',kinds.n===6,JSON.stringify(kinds.labels));
  rec('6通りとも図が出て、塗り分けが違う',kinds.venn===6&&kinds.shapes===6,
      `図${kinds.venn}枚 塗り分け${kinds.shapes}種`);
  rec('図だけで伝えず、行がどう増減するかを文字で書く',kinds.rows);
  rec('見本の表で結果が分かる',kinds.sample);
  // 「内部結合」を選ぶと、見本も下見も**行が減ること**を言う。
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('.qj-kinds input[name="qjKind"]')].find(x=>x.value==='inner');
   if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.waitForFunction(()=>{
   const n=document.querySelector('.qj-kind-now');return n&&n.textContent.includes('内部')},{timeout:20000});
  const innerSample=await page.evaluate(()=>({
   now:document.querySelector('.qj-kind-now')?.textContent.trim()||'',
   rows:[...document.querySelectorAll('.qj-sample-t.is-result tbody tr')].length}));
  rec('選び直すと見本もその場で変わる',innerSample.now.includes('内部')&&innerSample.rows===1,
      JSON.stringify(innerSample));
  // 「この一覧にしかない行」は列を足さないので、⑥の選択肢ごと出さない(§4)。
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('.qj-kinds input[name="qjKind"]')].find(x=>x.value==='leftOnly');
   if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.waitForFunction(()=>!document.querySelector('[name="qjPick"]'),{timeout:20000});
  rec('列を足さない結合では「何を足すか」を出さない（押せるのに効かない欄を残さない）',
      await page.$('[name="qjPick"]')===null);
  // 既定（左外部）へ戻してから保存する。
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('.qj-kinds input[name="qjKind"]')].find(x=>x.value==='left');
   if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.waitForFunction(()=>document.querySelector('#qjProbeBox .qj-probe-ok'),{timeout:20000});
  /* **窓の中身が切れていないこと**(§9.197、利用者の指摘「モーダル内で表示が
     一部切れている」)。以前は`.is-wide`の本体が`overflow:hidden`で、
     ⑤結果の節が丸ごと画面の外だった。 */
  const fit=await page.evaluate(()=>{
   const body=document.querySelector('#maintEditorModal .mm-editor-body');
   const last=document.querySelector('#maintEditorModal .qj-sec-result');
   if(!body||!last)return {missing:true};
   last.scrollIntoView({block:'end'});
   const b=body.getBoundingClientRect(),l=last.getBoundingClientRect();
   return {scrollable:body.scrollHeight>body.clientHeight+1,
           overflowY:getComputedStyle(body).overflowY,
           reachable:l.bottom<=b.bottom+2&&l.height>0,
           probe:!!document.querySelector('#qjProbeBox')};
  });
  rec('窓の中身が切れない（下の節までたどり着ける）',
      !fit.missing&&fit.reachable&&fit.probe&&fit.overflowY!=='hidden',JSON.stringify(fit));
  await page.click('#maintEditorSave');
  await page.waitForFunction(n=>[...document.querySelectorAll('#masterMaintList .qj-c-name')]
    .some(el=>el.textContent.includes(n)),NAME,{timeout:20000});
  const listed=await page.$$eval('#masterMaintList .qj-row:not(.ds-row-head) .qj-c-name',
    ns=>ns.map(n=>n.textContent.trim()));
  rec('登録した結合が一覧に並ぶ',listed.some(t=>t.includes(NAME)),JSON.stringify(listed));
  const saved=(await call('GET','/api/query-join-master')).body;
  joinId=((saved.items||[]).find(x=>x.name===NAME)||{}).id||null;
  rec('保存された定義に突合キーと接頭辞が入っている',
      !!joinId&&((saved.items||[]).find(x=>x.id===joinId)||{}).prefix==='UI_',
      JSON.stringify((saved.items||[]).find(x=>x.id===joinId)||{}));

  /* ---- 3) 一覧の帯と、列の設定パネルの分類 ---- */
  await page.evaluate(()=>window.exitMasterMaint&&window.exitMasterMaint());
  await page.click(`[data-db-key="${WORK}"]`);
  /* **行が出たことでは待てない。** マスタ管理から戻ると前の描画がDOMに
     残っているので、行数を見る待ちは即座に通る（結合前の写しを見て
     「帯が出ていない」と誤診断する）。結合した列が入るまで待つ。 */
  await page.waitForFunction(()=>typeof S!=='undefined'&&Array.isArray(S.columns)
    &&S.columns.some(c=>c.startsWith('UI_')),{timeout:30000});
  await raf2(page);
  const chip=await page.evaluate(()=>{
   const c=document.querySelector('#listJoinChip');
   return c&&!c.hidden?{text:c.textContent.trim(),title:c.title}:null;
  });
  rec('一覧の帯が結合の名前と件数を文字で言う',
      !!chip&&chip.text.includes(NAME)&&/行/.test(chip.text),JSON.stringify(chip));
  /* `S`は`const`宣言のグローバルなので**`window.S`では引けない**（bareな
     識別子としてだけ見える）。ここを間違えると、列があるのに空で返る。 */
  const joined=await page.evaluate(()=>{
   const info=(typeof S!=='undefined')?S.joinQuality:null;
   const cols=(typeof S!=='undefined'&&Array.isArray(S.columns))?S.columns:[];
   return {added:(info&&info.addedColumnNames)||[],inGrid:cols.filter(c=>c.startsWith('UI_'))};
  });
  rec('足した列が一覧の列に入る',joined.inGrid.length>0,JSON.stringify(joined.inGrid.slice(0,4)));
  await W.listView(page);await page.click('#listColumnBtn');
  await page.waitForSelector('#listColumnPanel:not([hidden])',{timeout:20000});
  await raf2(page);
  const origin=await page.evaluate(()=>{
   const rows=[...document.querySelectorAll('#listColumnPanel .lc-item')];
   const hit=rows.find(r=>String(r.dataset.key||'').startsWith('UI_'));
   return hit?{key:hit.dataset.key,origin:hit.dataset.origin}:null;
  });
  rec('列の設定パネルが足された列を「結合」に分類する',
      !!origin&&origin.origin==='join',JSON.stringify(origin));
  await page.keyboard.press('Escape');

  /* ---- 4) スケジュール表の内容欄で使える ---- */
  const keys=(await call('GET','/api/query-join/keys?db='+encodeURIComponent(WORK))).body;
  rec('突合に要る列だけを先に聞く（200列を送らない）',
      Array.isArray(keys.keys)&&keys.keys.length>0&&keys.keys.length<=4,
      JSON.stringify(keys.keys));
  const sample=(await call('GET',`/api/table?db=${encodeURIComponent(WORK)}&table=%E4%BB%95%E6%8E%9B&page_size=5&join=1`)).body;
  const lot=((sample.rows||[])[0]||{})['ロット番号'];
  const res=(await call('POST','/api/query-join/resolve',{db:WORK,rows:[{'ロット番号':lot}]})).body;
  rec('予定の行（鍵の値だけ）から、足す列の値を引ける',
      (res.columns||[]).some(c=>c.startsWith('UI_'))
      &&Object.keys((res.values||[{}])[0]||{}).some(c=>c.startsWith('UI_')),
      JSON.stringify(res.values&&res.values[0]).slice(0,120));
  /* ---- 4b) スケジュール表の内容欄に、結合で足した列を出す ---- */
  await call('POST','/api/access-mode',{mode:'schedule'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(eq=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===eq);if(r)r.click()},EQ);
  await page.waitForSelector('.sc-row-line',{timeout:30000});
  const st=await page.waitForFunction(()=>window.WL&&WL.scheduleJoinState
    &&WL.scheduleJoinState().columns.length>0,{timeout:30000})
    .then(()=>page.evaluate(()=>WL.scheduleJoinState())).catch(()=>null);
  rec('スケジュール表でも同じ結合が当たる',
      !!st&&st.columns.some(c=>c.startsWith('UI_'))&&st.resolved>0,
      JSON.stringify(st));
  // 内容欄へ出す項目として選ぶ（保存先はスケジュール内容表示マスタ）。
  contentTouched=true;
  await call('POST','/api/schedule-content-master',
    {equipment:EQ,items:['lotNo','UI_検査結果'],user_id:'test-qjoin'});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:20000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-board-row',{timeout:20000});
  await page.evaluate(eq=>{const r=[...document.querySelectorAll('.sc-board-row')]
    .find(x=>x.dataset.equipment===eq);if(r)r.click()},EQ);
  /* **見出しを数えないこと。** `.sc-row-head`にも同じ`data-content-col`が
     付くので、器を絞らないと見出しだけで待ちが通り、まだ値の入っていない
     セルを読んで「出ていない」と誤診断する（実際に踏んだ）。 */
  const cell=await page.waitForFunction(()=>[...document.querySelectorAll('.sc-row-line [data-content-col="UI_検査結果"]')]
    .some(n=>n.textContent.trim()!==''),{timeout:30000})
    .then(()=>page.evaluate(()=>{
      const n=[...document.querySelectorAll('.sc-row-line [data-content-col="UI_検査結果"]')]
        .find(x=>x.textContent.trim()!=='');
      return n?n.textContent.trim():''})).catch(()=>'');
  rec('内容欄に結合で足した列の値が出る',!!cell,cell||'(空)');
  const head=await page.evaluate(()=>{
   const n=document.querySelector('.sc-row-head [data-col="UI_検査結果"]');
   return n?n.textContent.replace(/\s+/g,'').trim():'';
  });
  rec('見出しにも項目名が出る（生のキーのままにしない）',head.includes('UI_検査結果'),head);

  /* ---- 5) 既定の品質データ結合を解除できる（§9.194、利用者の指示） ---- */
  await page.evaluate(()=>window.exitMasterMaint&&window.exitMasterMaint());
  await call('POST','/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:20000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="queryJoin"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'test-qjoin');
  await page.click('#masterMaintNav [data-master="queryJoin"]');
  await page.waitForSelector('#qjBuiltinToggle',{timeout:20000});
  builtinTouched=true;
  /* 確認は素の`confirm()`ではなくなった（§9.342）。 */
  await page.click('#qjBuiltinToggle');
  await require('./lib/wait.js').answerConfirm(page);
  await page.waitForFunction(()=>{const n=document.querySelector('.qj-row.is-builtin .ds-listed');
    return n&&n.textContent.trim()==='解除中'},{timeout:20000});
  const offState=(await call('GET','/api/query-join-master')).body;
  rec('既定の品質データ結合を画面から解除できる',offState.builtinEnabled===false,
      String(offState.builtinEnabled));
  rec('解除しても既定の内容は見えたまま（真似できることが値打ち）',
      !!offState.builtin&&(offState.builtin.keys||[]).length>0,
      JSON.stringify((offState.builtin||{}).keys||[]));
  const offTable=(await call('GET',`/api/table?db=${encodeURIComponent(WORK)}&table=%E4%BB%95%E6%8E%9B&page_size=5&join_quality=1`));
  rec('解除中でも一覧はエラーなく開ける（列が出ないだけ）',
      offTable.status===200&&(offTable.body.rows||[]).length>0&&offTable.body.joinQuality===null,
      `${offTable.status} ${(offTable.body.rows||[]).length}行`);
  await page.click('#qjBuiltinToggle');
  await page.waitForFunction(()=>{const n=document.querySelector('.qj-row.is-builtin .ds-listed');
    return n&&n.textContent.trim()==='既定'},{timeout:20000});
  const onState=(await call('GET','/api/query-join-master')).body;
  rec('既定に戻せる',onState.builtinEnabled===true,String(onState.builtinEnabled));
  builtinTouched=false;

  /* ---- 5) 用途と完了突合（§9.365、利用者の指示） ----
     「クエリ結合のようなスタイルで…汎用スタイルにしてほしい」。
     **用途を切り替えると節の意味が変わる**ことを画面で固定する。 */
  await page.evaluate(()=>{const b=document.querySelector('#qjAddBtn');if(b)b.click()});
  await page.waitForSelector('.qj-purposes .qj-purpose',{timeout:20000});
  const pur=await page.evaluate(()=>({
   n:document.querySelectorAll('.qj-purposes .qj-purpose').length,
   labels:[...document.querySelectorAll('.qj-purposes .qj-purpose b')].map(x=>x.textContent.trim()),
   on:document.querySelector('.qj-purposes .qj-purpose.is-on b')?.textContent.trim()||'',
   sched:!!document.querySelector('[data-qj-sched]'),
   schedOn:!!document.querySelector('[data-qj-sched]')?.checked,
   kinds:document.querySelectorAll('.qj-kinds .qj-kind').length,
   finish:!!document.querySelector('[data-qj-field="finishColumn"]'),
  }));
  rec('用途は2つ（一覧に列を足す／完了突合）で、既定は「一覧に列を足す」',
      pur.n===2&&pur.on.includes('一覧'),JSON.stringify(pur.labels)+' / on='+pur.on);
  rec('一覧の結合には「作業スケジュールでも使う」があり、既定は使う',
      pur.sched&&pur.schedOn,JSON.stringify({有:pur.sched,入:pur.schedOn}));
  rec('一覧の結合では結合の仕方を選べる（完了時刻の欄は出さない）',
      pur.kinds>=6&&!pur.finish,JSON.stringify({札:pur.kinds,完了時刻:pur.finish}));
  await page.evaluate(()=>{
   const el=[...document.querySelectorAll('[name="qjPurpose"]')].find(x=>x.value==='完了突合');
   if(el){el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.waitForFunction(()=>!document.querySelector('.qj-kinds'),{timeout:20000});
  const fin=await page.evaluate(()=>({
   secs:[...document.querySelectorAll('.qj-sec .mm-fieldgroup')].map(x=>x.textContent.trim()),
   kinds:document.querySelectorAll('.qj-kinds .qj-kind').length,
   sched:!!document.querySelector('[data-qj-sched]'),
   finish:!!document.querySelector('[data-qj-field="finishColumn"]'),
   /* 「選ばない」を含めた候補が出ていること（相手の列から選ぶ）。 */
   opts:[...(document.querySelector('[data-qj-field="finishColumn"]')||{options:[]}).options].length,
  }));
  rec('完了突合では結合の仕方を出さない（押せるのに効かない設定を残さない）',
      fin.kinds===0&&fin.secs.some(t=>t.includes('当たったらどうなるか')),
      JSON.stringify(fin.secs));
  rec('完了突合では④が「何を持ち帰るか」になる',
      fin.secs.some(t=>t.includes('何を持ち帰るか')),JSON.stringify(fin.secs));
  rec('完了突合では「完了時刻にする列」を相手の列から選べる',
      fin.finish&&fin.opts>1,JSON.stringify({欄:fin.finish,候補:fin.opts}));
  rec('完了突合には「作業スケジュールでも使う」を出さない（予定のための設定なので常に効く）',
      !fin.sched,String(fin.sched));
  await page.click('#maintEditorCancel');
  await page.waitForFunction(()=>document.querySelector('#maintEditorModal')?.hidden,{timeout:20000});
  /* 一覧に用途の列と、既定の完了突合の行が出ている。 */
  await page.waitForSelector('#masterMaintList .qj-row',{timeout:20000});
  const listPurpose=await page.evaluate(()=>({
   head:[...document.querySelectorAll('#masterMaintList .ds-row-head .ds-h')].map(x=>x.textContent.trim()),
   tags:[...document.querySelectorAll('#masterMaintList .qj-c-purpose .ds-role')].map(x=>x.textContent.trim()),
  }));
  rec('一覧に「用途」の列がある',listPurpose.head.includes('用途'),JSON.stringify(listPurpose.head));
  /* §9.367: 旧い突合キーは一度きりの移行で**普通の1行**になっている。
     「複製してからしか直せない」行を残さないこと——完了突合の行にも
     ふつうに「編集」「削除」が出る（利用者の指摘）。 */
  const finRow=await page.evaluate(()=>{
   const row=[...document.querySelectorAll('#masterMaintList .qj-row')]
     .find(r=>(r.querySelector('.qj-c-purpose')||{}).textContent?.includes('完了突合'));
   if(!row)return null;
   return {edit:!!row.querySelector('[data-qj-edit]'),del:!!row.querySelector('[data-qj-del]'),
           builtin:row.classList.contains('is-builtin'),
           name:(row.querySelector('.ds-name')||{}).textContent||''};
  });
  rec('完了突合の行が一覧に出る（登録していないのに完了になる、を探させない）',
      !!finRow&&listPurpose.tags.includes('完了突合'),JSON.stringify(listPurpose.tags));
  rec('完了突合の行は普通に編集・削除できる（複製しないと直せない行を残さない）',
      !!finRow&&finRow.edit&&finRow.del&&!finRow.builtin,JSON.stringify(finRow));

  /* ---- 結合に失敗したとき・0行のとき（利用者の報告「VER2.348.0において、仕掛一覧が
     出なくなってしまいました」「オーダー情報と結合できませんと出たとしても、仕掛一覧の
     データがあるのであれば表示すべき」「必須データがない場合もエラーが出ないのは問題」）。
     サーバーの応答を差し替えて見る。写し（tableCache）から描かないよう force で読み直す。 ---- */
  await page.click(`aside [data-db-key="${WORK}"]`);
  await W.until(page,()=>document.querySelectorAll('#grid tbody tr').length>0,null,{ms:20000,what:'仕掛一覧が出る'});
  await idle();
  const REASON='相手の表「オーダー」にデータが1行もありません（オーダー情報のデータが届いていないか、置き場が違います）。';
  const jqFail={applied:false,count:1,failed:1,failedNames:['オーダー情報'],failedReasons:[REASON],
    matched:0,addedColumns:0,addedColumnNames:[],names:[]};
  const withResponse=async(edit)=>{
   const h=async route=>{
    if(!route.request().url().includes('join=1'))return route.continue();
    const r=await route.fetch();const b=await r.json();edit(b);
    await route.fulfill({response:r,json:b});
   };
   await page.route('**/api/table?**',h);
   try{await page.evaluate(()=>WL.list.load(true));await idle()}
   finally{await page.unroute('**/api/table?**',h)}
   return page.evaluate(()=>({rows:document.querySelectorAll('#grid tbody tr').length,
     chip:(document.querySelector('#listJoinChip')||{}).textContent||'',
     err:(document.querySelector('#grid .load-error')||{}).textContent||'',
     note:(document.querySelector('#grid .record-empty')||{}).textContent||''}));
  };
  const jf=await withResponse(b=>{b.joinQuality=jqFail});
  rec('結合に失敗しても仕掛の行は出す',jf.rows>0,jf.rows+'行');
  rec('札は「どの結合が・なぜ」を字で言う（マウスを乗せなくても読める）',
      jf.chip==='結合できません: オーダー情報（相手の表「オーダー」にデータが1行もありません）',jf.chip);
  const z=await withResponse(b=>{b.rows=[];b.count=0;b.joinQuality=jqFail});
  rec('元データが0行なら、表の中にエラーとして理由と確かめる先を出す',
      /データが1行もありません/.test(z.err)&&/データ接続/.test(z.err)&&!z.note,z.err.slice(0,90));
  rec('結合に失敗した理由も同じ枠に添える',/結合できなかったもの: オーダー情報/.test(z.err),z.err.slice(0,160));
  await page.evaluate(()=>WL.list.load(true));await idle();
  await page.fill('#search','QJ存在しないロット');
  await W.until(page,()=>!!document.querySelector('#grid .record-empty'),null,{ms:10000,what:'検索で0行の案内'});
  const sf=await page.evaluate(()=>({note:(document.querySelector('#grid .record-empty')||{}).textContent||'',
    err:!!document.querySelector('#grid .load-error')}));
  rec('検索で0行なら「絞り込みに当たらない」と言う（エラーにしない）',
      /検索・絞り込みに当たる行がありません/.test(sf.note)&&!sf.err,sf.note.slice(0,60));
  await page.fill('#search','');
  await W.until(page,()=>document.querySelectorAll('#grid tbody tr').length>0,null,{ms:15000,what:'一覧が戻る'});

  rec('画面側の例外が出ていない',errs.length===0,errs.slice(0,2).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* 後始末（落ちても必ず通る）。**ブラウザも必ず閉じる**——開いたままだと
     設備の編集セッションを掴み続け、後続のスケジュール系が連鎖的に落ちる。 */
  /* **内容欄の設定はマスタDBに残り、実行をまたいで生き延びる**（§9.121）。
     戻し忘れると、関係の無いテストが「実績がスケジュールに出ない」で落ちる。 */
  try{if(contentTouched)await call('POST','/api/schedule-content-master',
    {equipment:EQ,items:[],user_id:'test-qjoin'})}catch(_){}
  try{await call('POST','/api/access-mode',{mode:'edit'})}catch(_){}
  /* **既定の結合の印はマスタDBに残る**（§9.121）。解除したまま終わると、
     次の実行では品質の列が出ず、関係の無いテストが「列が消えた」で落ちる。 */
  try{if(builtinTouched)await call('POST','/api/query-join-master/builtin',
    {enabled:true,user_id:'test-qjoin'})}catch(_){}
  try{if(joinId)await call('POST','/api/query-join-master/delete',{id:joinId,user_id:'test-qjoin'})}catch(_){}
  try{const all=(await call('GET','/api/query-join-master')).body;
      for(const x of (all.items||[]))if(String(x.name||'').startsWith('テスト結合'))
        await call('POST','/api/query-join-master/delete',{id:x.id,user_id:'test-qjoin'});}catch(_){}
 }
}, {viewport:{width:1600,height:1000}});
