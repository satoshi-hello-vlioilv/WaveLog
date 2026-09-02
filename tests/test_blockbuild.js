/* test_blockbuild.js: 帳票の塊を「選んで組み立てる」（§9.226 ⑥）
   ============================================================
   利用者の指示:
     「帳票ブロックを新規登録が難しすぎて作成できない。入力データ(汎用入力
      データも含む)の中から選んで組み合わせたり配置する方式で、直感的に
      組み合わせてデータブロックを作ることができるようにしてほしい。」

   以前は`[内容]`に`ラベル=basic.lotNo`と**手で書かせて**いた。道の綴りを
   知らないと1行も書けないので、実際には誰も作れない（§4の裏返しで、
   「できると書いてあるのにできない」状態だった）。

   ここで固定すること:
    - **手で道を書く欄が無い**（候補から選ぶ）
    - 候補が**出どころごとに分かれている**（仕掛／準備／操業データ／…）
    - **操業データの項目が候補に出る**（現場が足せば増える＝汎用入力データ）
    - 押すと右へ増え、**もう一度押すと外れる**（押した結果が必ず変わる）
    - **保存の形は`ラベル=出どころ`のまま**（既に登録してある塊が読める）
    - 掴んで並べ替えると**その順で保存される**
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='fb-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());

let b=null,page=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 page=await b.newPage({viewport:{width:1760,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message));
 page.on('dialog',d=>d.accept());
 const made=[];
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
  await page.evaluate(v=>{try{localStorage.setItem('AccessMeasurementUserId',v)}catch(e){}},'tests');
  await page.click('#masterMaintNav [data-master="reportBlock"]');
  await page.waitForFunction(()=>{
   const l=document.querySelector('#masterMaintList');
   return !!l&&(l.offsetParent===null||l.children.length>0);
  },null,{timeout:20000});
  await page.waitForTimeout(400);

  /* ---------- 段（タブ）を開く（§9.250 ④） ----------
     決めることは4つの段に分かれた（縦に積むと窓に入らない・実測227px）。
     組み立ての盤は「② 何を載せるか」の段にあるので、**その段を開いてから**
     触る。**番号ではなく見出しの言葉で探すこと**——段が1つ増えただけで
     番号がずれる網は、直していないのに落ちる。 */
  const tab=async name=>{
   await page.waitForSelector('.mm-tab',{timeout:10000});
   await page.evaluate(n=>{
    const t=[...document.querySelectorAll('.mm-tab')]
      .find(x=>x.textContent.indexOf(n)>=0);
    if(t)t.click();
   },name);
   await page.waitForTimeout(200);
  };

  /* ---- 1) 窓を開くと組み立ての盤が出る ---- */
  await page.click('#masterMaintAdd');
  await tab('何を載せるか');
  await page.waitForSelector('[data-fb]',{timeout:10000});
  await page.waitForFunction(()=>document.querySelectorAll('.fb-cat').length>0,null,{timeout:10000});
  await page.waitForTimeout(300);
  const board=await page.evaluate(()=>({
   /* **手で道を書く欄は無い**（`textarea`で書かせていたのをやめた）。 */
   手書き:!!document.querySelector('[data-fb] textarea'),
   出どころ:[...document.querySelectorAll('.fb-cat')].map(x=>x.dataset.fbCat),
   /* 保存の形は隠し欄が持つ（`data-field`の約束は変えない）。 */
   隠し欄:!!document.querySelector('[data-fb] input[data-field="content"]'),
   /* 盤があるときは窓を広く取る（候補と載せる項目を見比べられること）。 */
   広い:Math.round((document.querySelector('.mm-editor-dialog')||{}).getBoundingClientRect?.().width||0),
  }));
  rec('内容は手で書かせない（候補から選ぶ盤が出る）',
      board.手書き===false&&board.隠し欄===true,JSON.stringify(board));
  rec('候補は出どころごとに分かれている',
      board.出どころ.length>=4&&board.出どころ.some(x=>/仕掛/.test(x))
      &&board.出どころ.some(x=>/計算/.test(x)),JSON.stringify(board.出どころ));
  rec('盤を持つ窓は候補と載せる項目を並べて見られる幅がある',
      board.広い>=900,String(board.広い));

  /* ---- 2) 操業データ（現場が足した項目）が候補に出る ---- */
  const opCat=board.出どころ.find(x=>/操業データ/.test(x));
  rec('操業データの項目が候補に出る（汎用入力データ）',!!opCat,JSON.stringify(board.出どころ));
  if(opCat){
   await page.click(`[data-fb-cat="${opCat}"]`);
   await page.waitForTimeout(300);
   const ops=await page.$$eval('.fb-item',es=>es.slice(0,3).map(e=>e.dataset.fbAdd));
   rec('操業データの候補は settings.opData の道で並ぶ',
       ops.length>0&&ops.every(p=>String(p).indexOf('settings.opData.')===0),
       JSON.stringify(ops));
  }

  /* ---- 3) 押すと増える／もう一度押すと外れる ---- */
  await page.click(`[data-fb-cat="${board.出どころ[0]}"]`);
  await page.waitForTimeout(250);
  const picks=await page.$$eval('.fb-item',es=>es.slice(0,3).map(e=>e.dataset.fbAdd));
  for(const p of picks){await page.click(`[data-fb-add="${p}"]`);await page.waitForTimeout(120)}
  const added=await page.evaluate(()=>({
   行:document.querySelectorAll('.fb-row').length,
   値:document.querySelector('[data-fb] input[data-field="content"]').value,
   /* **載せているものは押した結果が分かる**（§3。文字でも言う）。 */
   印:document.querySelectorAll('.fb-item.is-used').length,
   文字:!!document.querySelector('.fb-used')}));
  rec('候補を押すと載せる項目が増える',added.行===3&&added.印===3,JSON.stringify(added));
  rec('載せているものは色だけでなく文字でも言う',added.文字===true,String(added.文字));
  /* 保存の形は`ラベル=出どころ`（既に登録してある塊が読める形のまま）。 */
  rec('保存の形は「ラベル=出どころ」の並びのまま',
      added.値.split('\n').length===3&&added.値.split('\n').every(l=>/^[^=]+=[^=|]+$/.test(l)),
      JSON.stringify(added.値));
  /* **1マスの項目に`|1`を足さない**（§9.245）——足すと、何も変えていない
     塊まで保存のたびに形が変わる。 */
  rec('1マスの項目は今までどおりの1行（|を足さない）',
      added.値.indexOf('|')<0,JSON.stringify(added.値));
  await page.click(`[data-fb-add="${picks[1]}"]`);
  await page.waitForTimeout(200);
  const removed=await page.evaluate(()=>({
   行:document.querySelectorAll('.fb-row').length,
   値:document.querySelector('[data-fb] input[data-field="content"]').value}));
  rec('もう一度押すと外れる（押した結果が必ず変わる）',
      removed.行===2&&removed.値.indexOf(picks[1])<0,JSON.stringify(removed));

  /* ---- 4) ラベルはその場で直せる ---- */
  await page.fill('.fb-row:first-child .fb-label',TAG+'ラベル');
  await page.waitForTimeout(200);
  const labelled=await page.evaluate(()=>
    document.querySelector('[data-fb] input[data-field="content"]').value);
  rec('ラベルはその場で直せる（保存の形にも入る）',
      labelled.indexOf(TAG+'ラベル=')===0,JSON.stringify(labelled.split('\n')[0]));

  /* ---- 5) 保存すると読み直せる（塊が作れる） ---- */
  /* 名前と対象設備は「① これは何の塊か」の段（§9.250 ④）。 */
  await tab('これは何の塊か');
  await page.fill('[data-field="name"]',TAG+'塊');
  await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all]');
   if(all&&!all.checked){all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.click('#maintEditorSave');
  await page.waitForTimeout(1500);
  const saved=await get('/api/report-block-master');
  const row=(saved.items||[]).find(x=>x.name===TAG+'塊');
  if(row&&row.id)made.push(row.id);
  rec('組み立てた塊が保存できる',
      !!row&&String(row.content||'').indexOf(TAG+'ラベル=')===0,
      JSON.stringify(row&&row.content));
  /* サーバーが読み解いた形（`fields`）まで届いていること——ここが空だと、
     保存できても紙には1行も出ない。 */
  rec('保存した内容がサーバーで項目として読める',
      !!row&&Array.isArray(row.fields)&&row.fields.length===2,
      JSON.stringify(row&&row.fields));

  /* ==========================================================
     6) マトリクス配置（§9.245、利用者の指示）
     ----------------------------------------------------------
       「ブロックごとにデータの配置をどのようなマトリクスに並べるか
        視覚的に調整できる機能が欲しいです」

     **枠が紙のこの塊そのもの**であること（列数がそのまま効く）と、
     マス数・空きマスが保存の形へ入って読み戻せることを見る。
     ========================================================== */
  /* **保存すると窓は閉じる**（§9.222 ⑦）ので、ここから新しく開き直す。 */
  await page.click('#masterMaintAdd');
  await tab('何を載せるか');
  await page.waitForSelector('[data-fb]',{timeout:10000});
  await page.waitForFunction(()=>document.querySelectorAll('.fb-cat').length>0,null,{timeout:10000});
  await page.waitForTimeout(300);
  await page.click(`[data-fb-cat="${board.出どころ[0]}"]`);
  await page.waitForTimeout(250);
  for(const p of picks.slice(0,2)){await page.click(`[data-fb-add="${p}"]`);await page.waitForTimeout(120)}
  const grid=await page.evaluate(()=>{
   const w=document.querySelector('.fb-rows');
   return {格子:getComputedStyle(w).display,
     列:getComputedStyle(w).gridTemplateColumns.split(' ').length,
     つまみ:document.querySelectorAll('.fb-row .fb-step').length,
     列ボタン:document.querySelectorAll('.fb-cols [data-fb-cols-step]').length,
     列数:parseInt((document.querySelector('.fb-cols-val')||{}).textContent||'0',10)||0};
  });
  rec('「紙での並び」はマトリクスで出る',grid.格子==='grid',grid.格子);
  rec('各マスに「横／縦に何マス使うか」のつまみが付く',grid.つまみ>0,String(grid.つまみ));
  /* §9.255 ②／§9.277 列数はサーバーが受ける上限まで。**盤で選べない列数を
     紙が受け入れる状態を作らない**（片方だけ直すとそうなる）——数を書き写さず
     サーバーの答え（`contentColsMax`）と突き合わせる（§9.163）。
     下限を12に取ってあるのは**紙（`reportSection`）が12まで受ける**からで、
     盤がそれ未満だと「表に組む」で組んだ形が黙って丸められる（§9.277）。 */
  const colsMax=await page.evaluate(async()=>{
   const d=await api('/api/report-block-master?equipment=');return d.contentColsMax});
  /* §9.311 E 札を並べるのをやめたので、**押して行ける上限**で見る
     （ボタンの数を数える網は、畳んだ瞬間に「上限が2になった」と読む）。 */
  const colsTop=await page.evaluate(async()=>{
   const val=()=>parseInt((document.querySelector('.fb-cols-val')||{}).textContent||'0',10)||0;
   for(let i=0;i<40;i++){
    const b=document.querySelector('.fb-cols [data-fb-cols-step="1"]');
    if(!b||b.disabled)break;
    b.click();await new Promise(r=>setTimeout(r,40));
   }
   return val();
  });
  rec('列数はサーバーが受ける上限まで選べる（盤と紙で同じ数）',
      colsTop===colsMax&&colsMax>=12,colsTop+' / '+colsMax);
  rec('§9.311 E 列数のボタンは「− ＋」の2つだけ（数は1つ出る）',
      grid.列ボタン===2&&grid.列数>0,JSON.stringify({ボタン:grid.列ボタン,数:grid.列数}));
  /* 列数を変えると**枠のほうも変わる**（設定と見た目が別々に動かない）。 */
  /* §9.311 E 列数は「− 数 ＋」の1つになった（利用者の指示「決めた数値1つが
     見えればよい」）。3列になるまで押す。 */
  for(let i=0;i<12;i++){
   const now=await page.evaluate(()=>parseInt((document.querySelector('.fb-cols-val')||{}).textContent||'0',10)||0);
   if(now===3)break;
   const ok=await page.evaluate(d=>{
    const b=document.querySelector(`.fb-cols [data-fb-cols-step="${d}"]`);
    if(!b||b.disabled)return false;b.click();return true;
   },now<3?'1':'-1');
   if(!ok)break;
   await page.waitForTimeout(120);
  }
  await page.waitForTimeout(200);
  const c3=await page.evaluate(()=>({
   列:getComputedStyle(document.querySelector('.fb-rows')).gridTemplateColumns.split(' ').length,
   欄:document.querySelector('[data-field="cols"]').value,
   /* §9.311 D 札を並べるのをやめたので、**押して行ける上限**で見る
      （ボタンの数を数える網は、畳んだ瞬間に「選べるのは2つ」と読む）。
      横は`data-fb-span`、縦は`data-fb-rows`で見分ける（混ぜない）。 */
   つまみ:0,縦つまみ:0}));
  const topOf=async(kind,attr)=>await page.evaluate(async([k,a])=>{
   const val=()=>{const e=document.querySelector(
     `.fb-row:first-child .fb-step[data-fb-step-kind="${k}"] .fb-step-val`);
    return e?(parseInt(e.textContent,10)||0):0};
   for(let i=0;i<20;i++){
    const bs=document.querySelectorAll(
      `.fb-row:first-child .fb-step[data-fb-step-kind="${k}"] [data-fb-${a}]`);
    const b=bs[1];                       /* [0]=− / [1]=＋ */
    if(!b||b.disabled)break;
    b.click();await new Promise(r=>setTimeout(r,60));
   }
   return val();
  },[kind,attr]);
  /* **測ったら戻すこと**——上限まで押した状態を残すと、以降の節が
     「縦4マス」から始まって`|2`の確認が`|2x4`になる（置き土産・§9.121）。 */
  const stepTo=async(kind,attr,want)=>{
   await page.evaluate(async([k,a,w])=>{
    for(let i=0;i<24;i++){
     const e=document.querySelector(
       `.fb-row:first-child .fb-step[data-fb-step-kind="${k}"] .fb-step-val`);
     const v=e?(parseInt(e.textContent,10)||0):0;
     if(v===w)return;
     const bs=document.querySelectorAll(
       `.fb-row:first-child .fb-step[data-fb-step-kind="${k}"] [data-fb-${a}]`);
     const b=bs[v<w?1:0];                /* [0]=− / [1]=＋ */
     if(!b||b.disabled)return;
     b.click();await new Promise(r=>setTimeout(r,60));
    }
   },[kind,attr,want]);
   await page.waitForTimeout(150);
  };
  c3.つまみ=await topOf('span','span');
  c3.縦つまみ=await topOf('rows','rows');
  await stepTo('rows','rows',1);
  rec('列数を変えると枠も変わる',c3.列===3,String(c3.列));
  /* **同じ数を2箇所に持たない**（§CLAUDE 8）——「内訳の列数」の欄が持ち主。 */
  rec('列数は「内訳の列数」の欄が持つ',c3.欄==='3',JSON.stringify(c3.欄));
  rec('横のマス数は列数まで増やせる',c3.つまみ===3,String(c3.つまみ));
  /* ---- §9.311 D/E 盤のボタンも「− 数 ＋」の1つへ（利用者の指示
     「各項目のサイズを決めるボタンは小さくなった時に見切れる」「列数を指定
      する部分もボタンでたくさんあるので…決めた数値1つが見えればよい」）。
     **数える対象は「押せるボタンの数」**——以前は列数12枚＋横12枚＋縦4枚を
     1マスの下段に並べており、列を増やすと折り返して下のマスへ重なっていた。 */
  const compact=await page.evaluate(()=>{
   const row=document.querySelector('.fb-row:first-child');
   const num=sel=>{const e=document.querySelector(sel);
     return e?(parseInt(e.textContent,10)||0):-1};
   return {
    列ボタン:document.querySelectorAll('.fb-cols button').length,
    列数字:num('.fb-cols-val'),
    マスボタン:row?row.querySelectorAll('.fb-step button').length:-1,
    横数字:num('.fb-row:first-child .fb-step[data-fb-step-kind="span"] .fb-step-val'),
    縦数字:num('.fb-row:first-child .fb-step[data-fb-step-kind="rows"] .fb-step-val'),
    /* 端では押せなくして理由を書く（§4）。いま横は上限なので＋が止まる。 */
    上端:(()=>{const bs=document.querySelectorAll(
      '.fb-row:first-child .fb-step[data-fb-step-kind="span"] [data-fb-span]');
      const b=bs[1];return {止:!!(b&&b.disabled),理由:(b&&b.title)||''}})()};
  });
  rec('§9.311 D 列数は「− 数 ＋」の3つだけ（12枚並べない）',
      compact.列ボタン===2&&compact.列数字===3,JSON.stringify(compact));
  rec('§9.311 D マス数も横・縦それぞれ「− 数 ＋」だけ（16枚並べない）',
      compact.マスボタン===4&&compact.横数字===3&&compact.縦数字===1,
      JSON.stringify(compact));
  rec('§9.311 D 端では押せなくして理由を書く（§4）',
      compact.上端.止&&/これ以上/.test(compact.上端.理由),
      JSON.stringify(compact.上端));
  rec('縦のマス数も増やせる（§9.255 ②）',c3.縦つまみ>=2,String(c3.縦つまみ));
  /* 1つ目の項目を「横2マス」にする。 */
  /* 押せない（上限）ことがあるので`evaluate`で押す。上限まで押したあとなので
     まず1つ戻して2マスにする。 */
  await stepTo('span','span',2);
  const spanned=await page.evaluate(()=>({
   値:document.querySelector('[data-fb] input[data-field="content"]').value,
   幅:document.querySelector('.fb-row:first-child').style.gridColumn}));
  rec('マス数が保存の形へ入る（|2）',/\|2$/.test(spanned.値.split('\n')[0]),
      JSON.stringify(spanned.値.split('\n')[0]));
  rec('掴む枠のほうも2マスぶんになる',/span 2/.test(spanned.幅),spanned.幅);
  /* ---- 縦のマス数（§9.255 ②、利用者の指示） ----
     「『紙での並び』の部分は単純に何列何行だけでなく、データ内もグリッドに
      対応する形で細かく調整できるようにしてください」
     **「つまみが在る」だけを見ない**——保存の形と枠の両方が変わることまで。 */
  /* 縦は2回押して3マスへ（1回で1つ進む）。 */
  await stepTo('rows','rows',3);
  const tall=await page.evaluate(()=>({
   値:document.querySelector('[data-fb] input[data-field="content"]').value.split('\n')[0],
   幅:document.querySelector('.fb-row:first-child').style.gridColumn,
   高:document.querySelector('.fb-row:first-child').style.gridRow,
   詰め:getComputedStyle(document.querySelector('.fb-rows')).gridAutoFlow}));
  rec('縦のマス数が保存の形へ入る（|2x3）',/\|2x3$/.test(tall.値),JSON.stringify(tall.値));
  rec('掴む枠も縦3マスぶんになる',/span 3/.test(tall.高),JSON.stringify(tall));
  rec('横のマス数は残る（片方を触っても消えない）',/span 2/.test(tall.幅),tall.幅);
  rec('空いたマスは後ろの項目で詰める（紙と同じdense）',
      /dense/.test(tall.詰め),tall.詰め);
  /* 縦1へ戻したら`x`も消える（触っていない塊まで形が変わらないように）。 */
  await stepTo('rows','rows',1);
  const back=await page.evaluate(()=>
   document.querySelector('[data-fb] input[data-field="content"]').value.split('\n')[0]);
  rec('縦1へ戻すと「x」は書かない（|2のまま）',/\|2$/.test(back),JSON.stringify(back));
  /* 空きマス（何も出さずに場所だけ取る）。 */
  const before=await page.evaluate(()=>document.querySelectorAll('.fb-row').length);
  await page.click('.fb-blank');
  await page.waitForTimeout(200);
  const blanked=await page.evaluate(()=>({
   行:document.querySelectorAll('.fb-row').length,
   空:document.querySelectorAll('.fb-row-blank').length,
   値:document.querySelector('[data-fb] input[data-field="content"]').value}));
  rec('空きマスを足せる',blanked.行===before+1&&blanked.空===1,JSON.stringify(blanked.行));
  rec('空きマスは道もラベルも持たない行で書く',
      blanked.値.split('\n').some(l=>/^\|\d+$/.test(l)),
      JSON.stringify(blanked.値.split('\n')));
  /* **サーバーが同じ読み方をすること**——2通りあると設定と紙が食い違う。 */
  await tab('これは何の塊か');
  await page.fill('[data-field="name"]',TAG+'マトリクス');
  /* **対象設備は必須**（新しく開いた窓なので入れ直す）。 */
  await page.evaluate(()=>{
   const all=document.querySelector('[data-equipment-all]');
   if(all&&!all.checked){all.checked=true;all.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.click('#maintEditorSave');
  await page.waitForTimeout(1500);
  const saved2=await get('/api/report-block-master');
  const row2=(saved2.items||[]).find(x=>x.name===TAG+'マトリクス');
  if(row2&&row2.id)made.push(row2.id);
  const f2=(row2&&row2.fields)||[];
  rec('サーバーもマス数を読む',
      f2.length>0&&f2[0].span===2,JSON.stringify(f2[0]));
  rec('サーバーも空きマスを落とさない',
      f2.some(f=>f.blank===true),JSON.stringify(f2.map(f=>f.blank)));
  rec('列数も保存される',String((row2||{}).cols)==='3',JSON.stringify((row2||{}).cols));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。db/master.sqlite3は実行をまたいで生き延びる。 */
  for(const id of made){
   try{await post('/api/report-block-master/delete',{id,user_id:'tests'})}catch(e){}
  }
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
