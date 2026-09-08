/* test_rptext.js: 帳票の文字サイズ・半自動の塊のカスタム・ピッチ判定の幅（§9.320-D/E/F）

   ============================================================
   利用者の指示
   ------------------------------------------------------------
   ①「測定データ、丈別データの文字が少し小さいように思えるので**十分に
      表示エリアが確保できている場合は**通常のサイズを他のベースの文字
      サイズと合わせられるようにしてください」
   ②「帳票ブロックの『基本情報』を含む、半自動登録内容の項目は内部データ
      修正してもほぼ修正が効きません。列の変更、表組み、ラベルの位置変更
      など様々なカスタム機能があるのに使えないので使えるように」
   ③「ピッチ判定ブロックは横幅を狭くしてもきれいに収まるようにしてほしい」

   **測るのは刷り上がりの寸法**（§9.289）——「札が在る」「クラスが付いた」
   だけを見る網は、絵が1pxも変わっていない実装でも通る。
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const {clearLayout}=require('./lib/harness.js');   // 後片付け（§9.360）
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const EQ='テスト設備A';
const get=async u=>(await fetch(B+u)).json();
const post=async(u,body)=>{const r=await fetch(B+u,{method:'POST',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.json().catch(()=>({}))};
/* 既定セルを持つ塊（§9.285 ②）。**顔ぶれはサーバーが答える**ので、
   ここに綴りを書き写さない（増えたら網も自動で見る）。 */
let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox','--disable-dev-shm-usage']});
 const page=await b.newPage({viewport:{width:1600,height:1000}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 page.on('pageerror',e=>console.log('[pageerror]',String(e&&e.message||e).slice(0,140)));
 const undo=[];
 try{
  const master=await get('/api/report-block-master');
  const cellKeys=Object.keys(master.defaultCells||{});
  rec('既定セルを持つ塊をサーバーが答える',cellKeys.length>0,cellKeys.join('／'));
  /* **起動時に自動で種をまく塊だけ**で②の網を張る（`品質情報（仕掛）`は
     除く）。`品質情報（仕掛）`は`.rp-info-box`のカードいっぱいに広がる
     枠（§9.242 ⑧）を持つので、自動では汎用のマスへ切り替えない
     ——切り替えると枠が中身なりへ縮む（実測。既存の網が検出した）。
     **顔ぶれはサーバーが答える**ので、ここへ塊名を書き写さない。 */
  const autoKeys=Array.isArray(master.autoSeededCells)?master.autoSeededCells:[];
  rec('自動で種をまく塊をサーバーが答える',
      autoKeys.length>0&&autoKeys.length<cellKeys.length,
      JSON.stringify({自動:autoKeys,既定セル持ち:cellKeys}));

  await page.addInitScript(eq=>{try{localStorage.setItem('AccessMeasurementConfiguredEquipment',eq)}catch(e){}},EQ);
  const openSample=async()=>{
   await page.goto(B+'/',{waitUntil:'domcontentloaded'});
   await page.waitForSelector('#openMasterMaint',{timeout:25000});
   await page.click('#openMasterMaint');
   await page.waitForSelector('#masterMaintNav [data-master="reportBlock"]',{timeout:20000});
   await page.click('#masterMaintNav [data-master="reportBlock"]');
   await page.waitForSelector('#mmSampleView',{timeout:15000});
   await page.click('#mmSampleView');
   await page.waitForFunction(()=>document.body.classList.contains('rp-mode'),null,{timeout:20000});
   await page.waitForFunction(()=>{const c=document.getElementById('reportContent');
     return c&&c.textContent.length>500},null,{timeout:20000});
   await page.waitForTimeout(1800);
  };
  await openSample();

  /* ---- ① 表の文字も本文と同じ大きさ（§9.320-D） ---- */
  const fs=await page.evaluate(()=>{
   const px=s=>{const e=document.querySelector('#reportContent '+s);
     return e?parseFloat(getComputedStyle(e).fontSize):null};
   const cut=s=>[...document.querySelectorAll('#reportContent '+s)]
     .filter(c=>c.scrollWidth>c.clientWidth+1).length;
   const fit=()=>[...document.querySelectorAll('#reportContent .rp-block-fit')]
     .map(e=>getComputedStyle(e).getPropertyValue('--rp-fit').trim()).filter(Boolean);
   return {本文:px('.rp-field'),統計:px('.rp-dim-table td'),
     測定:px('.rp-wide-table td'),丈別:px('.rp-product-table td'),
     測定で切れ:cut('.rp-wide-table td'),丈別で切れ:cut('.rp-product-table td'),
     縮めた塊:fit()};
  });
  /* **地の大きさは本文とぴったり同じ**（許容を持たせない・§9.319-C）。
     器に余りがあるロットでは`--rp-fit`が掛からないので、解決値が
     そのまま地の大きさになる。 */
  rec('測定データの文字が本文と同じ大きさ',fs.測定===fs.本文,JSON.stringify(fs));
  rec('丈別データの文字が本文と同じ大きさ',fs.丈別===fs.本文,JSON.stringify(fs));
  rec('統計の表とも同じ（紙の中に読める大きさが2通り無い）',
      fs.統計===fs.本文,JSON.stringify({統計:fs.統計,本文:fs.本文}));
  /* **広げても横は切れない**（§9.320-Dの根拠。実測で7.5pxでも8.5pxでも0件）。 */
  rec('広げても横に切れるセルは出ない',fs.測定で切れ===0&&fs.丈別で切れ===0,
      JSON.stringify({測定:fs.測定で切れ,丈別:fs.丈別で切れ}));

  /* ---- ② 半自動の塊もカスタムが効く（§9.320-E） ----
     **`--rp-cols`が出ていること**が「マスタの並びを通った」印
     ——コードの既定の描き手はそれぞれ自分の列数で`reportSection()`を
     呼ぶので、マスタの数を変えても動かない。 */
  const before=await page.evaluate(ks=>{
   const o={};ks.forEach(k=>{
    const g=document.querySelector(`#reportContent [data-rp-block="${k}"] .rp-grid`);
    o[k]=g?getComputedStyle(g).getPropertyValue('--rp-cols').trim():null;});
   return o;},autoKeys);
  rec('半自動の塊がマスタの並びで組まれている',
      autoKeys.length>0&&autoKeys.every(k=>before[k]&&before[k]!=='0'),JSON.stringify(before));

  /* 列数を変えて**紙が実際に変わる**ことまで見る。 */
  const rows=(await get('/api/report-block-master')).items||[];
  const target=rows.find(x=>x.builtin===autoKeys[0]);
  if(target){
   const want=String(Number(before[autoKeys[0]])===3?2:3);
   undo.push({id:target.id,name:target.name,cols:target.cols});
   await post('/api/report-block-master/update',
     {user_id:'tests',id:target.id,name:target.name,cols:Number(want)});
   await openSample();
   const after=await page.evaluate(k=>{
    const g=document.querySelector(`#reportContent [data-rp-block="${k}"] .rp-grid`);
    return g?{cols:getComputedStyle(g).getPropertyValue('--rp-cols').trim(),
      軌道:getComputedStyle(g).gridTemplateColumns.split(' ').length}:null;
   },autoKeys[0]);
   rec('列数を変えると紙の列が実際に変わる',
       !!after&&after.cols===want&&after.軌道===Number(want),
       JSON.stringify({塊:autoKeys[0],前:before[autoKeys[0]],指定:want,後:after}));
   /* **`[内容]`が消えないこと**——部分更新（列数だけ）で内容が飛ぶと、
      その塊はコードの既定へ落ちてカスタムが二度と効かない（§9.320-Eの本体）。 */
   const kept=((await get('/api/report-block-master')).items||[])
     .find(x=>x.builtin===autoKeys[0]);
   rec('列数だけ送っても載せる項目は消えない',
       !!kept&&(kept.fields||[]).length>0,
       JSON.stringify({fields:kept?(kept.fields||[]).length:null}));
  }else rec('列数を変えると紙の列が実際に変わる',false,'対象の行が無い');

  /* ---- ③ ピッチ判定は狭くても収まる（§9.320-F） ---- */
  const at=async span=>{
   await page.evaluate(async n=>{await WL.reportLayout.setSpan('テスト設備A','ピッチ判定',n)},span);
   await page.waitForTimeout(1600);
   return page.evaluate(()=>{
    const blk=document.querySelector('#reportContent [data-rp-block="ピッチ判定"]');
    if(!blk)return null;
    const sec=blk.querySelector('.rp-defect-roll');
    const facts=blk.querySelector('.rp-defect-roll-facts');
    const cells=[...blk.querySelectorAll('.rp-defect-fact')];
    return {器幅:sec?Math.round(sec.clientWidth):null,
      欄の列:facts?getComputedStyle(facts).gridTemplateColumns.split(' ').length:null,
      ラベル上下:cells.length
        ?getComputedStyle(cells[0]).gridTemplateColumns.split(' ').length===1:null,
      欄で切れ:cells.filter(c=>{const x=c.querySelector('b');
        return x&&x.scrollWidth>x.clientWidth+1}).length,
      溢れ横:blk.scrollWidth>blk.clientWidth+1};
   });
  };
  const wide=await at(6),mid=await at(4),narrow=await at(3);
  /* **広い紙は1pxも変えない**（§9.132）——2列・ラベルは左のまま。 */
  rec('広いままなら今までどおり2列・ラベルは左',
      !!wide&&wide.欄の列===2&&wide.ラベル上下===false,JSON.stringify(wide));
  /* **狭いと1列へ**（値に幅を渡す）。 */
  rec('狭くすると欄が1列になる',!!mid&&mid.欄の列===1,JSON.stringify(mid));
  /* **もっと狭いとラベルが上・値が下**（＝「ラベル上下」）。 */
  rec('もっと狭いとラベルが上・値が下になる',
      !!narrow&&narrow.ラベル上下===true,JSON.stringify(narrow));
  /* **どの幅でも切れない・溢れない**（これが「きれいに収まる」の物差し）。 */
  const bad=[['広い',wide],['狭い',mid],['もっと狭い',narrow]]
    .filter(([,v])=>!v||v.欄で切れ>0||v.溢れ横);
  rec('どの幅でも欄が切れず横へ溢れない',bad.length===0,
      JSON.stringify(bad.map(([k,v])=>[k,v])));
  await page.evaluate(async()=>{await WL.reportLayout.setSpan('テスト設備A','ピッチ判定',6)});
 }catch(e){
  rec('FATAL',false,String(e&&e.message||e));
 }
 await b.close();
 /* 後片付け（§9.121）。列レイアウトと帳票ブロックは実行をまたいで残る。 */
 for(const u of undo){
  try{await post('/api/report-block-master/update',
    {user_id:'tests',id:u.id,name:u.name,cols:u.cols})}catch(e){}
 }
 /* **後片付け**（§9.360）: 画面を触るとその帳票・一覧の列レイアウトが
    保存される。**触った網は自分で消す**——残すと単独で回したとき自分の
    DBを汚し、通しでは報告がうるさくなって本物の置き土産が埋もれる。 */
 try{await clearLayout('report:テスト設備A')}catch(e){console.log('!! 後片付けに失敗（残った設定が次の実行へ渡る）: '+(e&&e.message||e))}
 const ng=R.filter(x=>!x.ok);
 console.log('\n== '+(R.length-ng.length)+'/'+R.length+' PASS ==');
 process.exit(ng.length?1:0);
})().catch(async e=>{
 console.error('FATAL',e);
 if(b)await b.close().catch(()=>{});
 process.exit(2);
});
