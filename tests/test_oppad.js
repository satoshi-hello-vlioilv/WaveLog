/* test_oppad.js: 角丸ベースの意匠・設定窓の揺れ・空き（ダミー）の群（§9.227）
   ============================================================
   利用者の指示:
     ①「実際の適用されるデザインがやりすぎで、画像のようにシンプルな感じが
        良いです」「角丸をベースデザインにしてほしい…『角』と『丸』は使わない
        方向でよいです。形というところの変更は角丸をベースにしたバリエーション
        を希望しています」「角丸をベースデザインというのは、『選ばせ方』
        すべてのUIのデザインについての話にも適用したい」
       「選ぶたびに左側のイメージが変わるが、見切れているし、そのサイズの
        変化に合わせて右側の選択パネルの並びや位置が変化するのはやめてほしい」
     ②「マスタでまとまりをダミーで作って何も枠もない空間をつくれるように
        してください。(区切りの良い並びに整列させるためのダミーカード)」

   ここで固定すること:
    - **選ばせ方を変えても右のパネルが1pxも動かない**（実測で30px動いていた）
    - **左の見本が器からはみ出さない**（実測で455px切れていた）
    - 選ばせ方の面は**どれも角丸**（ピル＝高さの半分以上の丸みが無い）
    - 形の軸は`控えめ/標準/大きめ`で、**廃止した`角`/`丸`は寄せる**
    - 空きの群は測定画面で**枠も見出しも文字も持たず**、幅ぶんのマスを取る
    - 空きの群の行は**「記録した値」の分母に入らない**
   ============================================================ */
const {chromium}=require(process.env.WAVELOG_PLAYWRIGHT||'/opt/node22/lib/node_modules/playwright');
const EXE=process.env.WAVELOG_CHROMIUM||'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B='http://127.0.0.1:5029';
const TAG='pad-'+Date.now().toString(36);
const post=(p,x)=>fetch(B+p,{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(x)});
const get=p=>fetch(B+p).then(r=>r.json());
const EQ='テスト設備A';

let b=null;
(async()=>{
 b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
 const page=await b.newPage({viewport:{width:1920,height:1080}});
 const R=[];const rec=(n,ok,d)=>{R.push({n,ok,d});console.log((ok?'PASS':'FAIL')+': '+n+(d?' -- '+d:''))};
 const errs=[];
 page.on('pageerror',e=>errs.push(e.message.slice(0,140)));
 page.on('dialog',d=>d.accept());
 const madeGroups=[];
 try{
  await post('/api/access-mode',{mode:'edit'});
  await page.goto(B+'/',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openMasterMaint',{timeout:30000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:30000});
  await page.click('#openMasterMaint');
  await page.waitForSelector('#masterMaintNav [data-master="opItem"]',{timeout:20000});
  await page.evaluate(()=>{
   const el=document.querySelector('#masterUserId');
   if(el&&!el.value){el.value='tests';el.dispatchEvent(new Event('change',{bubbles:true}))}
  });
  await page.click('#masterMaintNav [data-master="opItem"]');
  await page.waitForSelector('.op-board',{timeout:20000});
  await page.waitForTimeout(900);

  /* ==========================================================
     1) 設定窓: 選ばせ方を変えても右が動かない／見本が見切れない
     ========================================================== */
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.op-tile')].find(e=>/選択/.test(e.textContent))
     ||document.querySelector('.op-tile');
   if(t)t.click();
  });
  await page.waitForFunction(()=>{
   const m=document.getElementById('opItemModal');return !!m&&!m.hidden;
  },null,{timeout:10000});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
   const t=[...document.querySelectorAll('.op-tab')].find(x=>/見せ/.test(x.textContent));
   if(t)t.click();
  });
  await page.waitForTimeout(600);
  const kinds=await page.$$eval('[data-op-widget]',es=>es.map(e=>e.dataset.opWidget));
  rec('前提: 選ばせ方が2つ以上ある（切り替えて比べられる）',kinds.length>=5,String(kinds.length));
  /* **測るのは「動かないこと」なので、素通りしないよう先に前提を固定する**
     ——選ばせ方が1つしか無い／窓が開いていなければ、当然どこも動かない。 */
  /* **丸めの検査は選ばせ方ごとに行う**——最後に選んだ1つだけを見ると、
     その形にチップが無ければ**何も測らずに通る**（ピルへ戻す欠陥を注入して
     実際に素通りした）。 */
  const pills=()=>page.evaluate(()=>{
   const out=[];
   document.querySelectorAll('.op-prev-field .opf-widget, .op-prev-field .opf-widget *')
    .forEach(el=>{
     const r=el.getBoundingClientRect();
     if(r.width<6||r.height<6)return;
     const cls=String(el.className||'');
     /* 丸めきり（ピル）＝角丸が高さの半分以上。**帯とつまみと丸ぽちは除く**
        ——形そのものが意味を持つ部品。 */
     if(/opf-(switch-track|switch-knob|meter-bar|meter-fill|dot)/.test(cls))return;
     const rad=parseFloat(getComputedStyle(el).borderTopLeftRadius)||0;
     if(rad>=r.height/2-0.5)out.push((cls||el.tagName)+'='+Math.round(rad)+'/'+Math.round(r.height));
    });
   return out;
  });
  const geo=()=>page.evaluate(()=>{
   const lab=s=>[...document.querySelectorAll('.op-form-label')].find(e=>e.textContent.trim()===s);
   const y=s=>{const l=lab(s);return l?Math.round(l.getBoundingClientRect().y):-1};
   const g=document.querySelector('.op-widget-grid');
   const first=document.querySelector('.op-widget-tile');
   const pane=document.querySelector('.op-modal-preview');
   const card=document.querySelector('.op-prev-card');
   return {色:y('色'),形:y('形'),大きさ:y('大きさ'),見せ方:y('見せ方'),
     列:g?getComputedStyle(g).gridTemplateColumns.split(' ').length:0,
     タイルx:first?Math.round(first.getBoundingClientRect().x):0,
     はみ出し:(card&&pane)?Math.round(card.getBoundingClientRect().width-pane.clientWidth):0};
  });
  const seen=[];const pillHits=[];let measured=0;
  for(const k of kinds){
   await page.click(`[data-op-widget="${k}"]`).catch(()=>{});
   await page.waitForTimeout(320);
   seen.push({k,...(await geo())});
   const n=await page.evaluate(()=>document.querySelectorAll(
     '.op-prev-field .opf-widget, .op-prev-field .opf-widget *').length);
   measured+=n;
   (await pills()).forEach(x=>pillHits.push(k+':'+x));
  }
  const uniq=f=>[...new Set(seen.map(x=>x[f]))];
  rec('選ばせ方を変えても「色」の行が動かない',uniq('色').length===1,
      JSON.stringify(uniq('色')));
  rec('選ばせ方を変えても「形」「大きさ」「見せ方」の行が動かない',
      uniq('形').length===1&&uniq('大きさ').length===1&&uniq('見せ方').length===1,
      JSON.stringify({形:uniq('形'),大きさ:uniq('大きさ'),見せ方:uniq('見せ方')}));
  rec('選ばせ方のタイルの並び（列数と左端）が変わらない',
      uniq('列').length===1&&uniq('タイルx').length===1,
      JSON.stringify({列:uniq('列'),x:uniq('タイルx')}));
  rec('左の見本が器からはみ出さない',
      seen.every(x=>x.はみ出し<=0),
      JSON.stringify(seen.map(x=>`${x.k}:${x.はみ出し}`).slice(0,4)));

  /* ---- 角丸ベース: どの選ばせ方にもピルが無い ----
     **「何も測っていないのに通る」を塞ぐ**（§CLAUDE「素通り」）ので、
     測った部品の総数を先に固定する。 */
  rec('前提: 選ばせ方ごとに見本の部品を測れている',measured>=kinds.length,
      `${measured}個 / ${kinds.length}形`);
  rec('どの選ばせ方の面にもピル（丸めきり）が無い＝角丸ベース',pillHits.length===0,
      JSON.stringify(pillHits.slice(0,4)));
  const shapes=await page.$$eval('[data-op-look="shape"]',es=>es.map(e=>e.dataset.opVal));
  rec('形の軸は角丸のバリエーション（角・丸は無い）',
      shapes.length===3&&!shapes.includes('角')&&!shapes.includes('丸')
      &&shapes.includes('標準'),JSON.stringify(shapes));
  await page.evaluate(()=>{const c=document.getElementById('opModalClose');if(c)c.click()});
  await page.waitForTimeout(300);

  /* ==========================================================
     2) 空き（ダミー）の群
     ========================================================== */
  const padName=TAG+'空き';
  await page.evaluate(n=>{window.prompt=()=>n},padName);
  await page.click('#opAddPad');
  await page.waitForFunction(n=>[...document.querySelectorAll('.op-band')]
    .some(b=>b.dataset.opBand===n),padName,{timeout:15000});
  madeGroups.push(padName);
  await page.waitForTimeout(500);
  const band=await page.evaluate(n=>{
   const b=[...document.querySelectorAll('.op-band')].find(x=>x.dataset.opBand===n);
   if(!b)return null;
   return {ダミー:b.classList.contains('is-dummy'),
           文字:b.textContent.replace(/\s+/g,''),
           幅ボタン:b.querySelectorAll('[data-op-gspan]').length,
           戻す:b.querySelectorAll('[data-op-undummy]').length,
           畳む:b.querySelectorAll('[data-op-fold]').length};
  },padName);
  rec('空きの群が盤に出る（ダミーとして）',!!band&&band.ダミー===true,JSON.stringify(band));
  /* **色だけで伝えない**（§3）。斜線の地に加えて文字でも言うこと。 */
  rec('空きであることを文字でも言う',!!band&&/ダミー（空き）/.test(band.文字),
      band&&band.文字.slice(0,60));
  /* **要らない道具は出さない**（§4）。中身が無いので「畳む」は効かない。 */
  rec('空きの帯は幅と「ふつうの群へ」を持ち、畳むは持たない',
      !!band&&band.幅ボタン>0&&band.戻す===1&&band.畳む===0,JSON.stringify(band));

  /* サーバーに印が残っていること（次に開いても空きのまま）。 */
  const srv=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const padRows=(srv.items||[]).filter(i=>(i.group||'')===padName);
  rec('空きの印がサーバーに残る',padRows.length>0&&padRows.every(i=>i.dummy===true),
      JSON.stringify(padRows.map(i=>({n:i.name,d:i.dummy}))));
  /* **「出さない」にしていないこと**——無効にすると測定画面が読まず、
     空きが1マスも空かない（実際に踏んだ罠）。 */
  rec('空きの行は有効なまま（無効にすると測定画面に届かない）',
      padRows.every(i=>i.enabled!==false),
      JSON.stringify(padRows.map(i=>i.enabled)));

  /* ---- 測定画面: 枠も見出しも無い空白になる ---- */
  await page.evaluate(()=>{const m=document.getElementById('masterMaintModal');if(m)m.hidden=true});
  await page.evaluate(e=>localStorage.setItem('AccessMeasurementConfiguredEquipment',e),EQ);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('#openSchedule',{timeout:25000});
  await page.waitForFunction(()=>!document.getElementById('appBoot'),null,{timeout:25000});
  await page.click('#openSchedule');
  await page.waitForSelector('.sc-row-line',{timeout:25000});
  const started=await page.evaluate(()=>{
   const r=[...document.querySelectorAll('.sc-row-line')].find(x=>x.querySelector('.sc-row-start'));
   if(r){r.querySelector('.sc-row-start').click();return true}return false;
  });
  if(!started)throw Error('開始できる行が無い');
  await page.waitForFunction(()=>!document.querySelector('#measureModal')?.hidden,null,{timeout:25000});
  await page.waitForFunction(()=>typeof S!=='undefined'&&!!S.measure,null,{timeout:25000});
  await page.waitForTimeout(1500);
  const pad=await page.evaluate(n=>{
   const el=document.querySelector(`.selectors>[data-oppad="1"][data-opgroup="${CSS.escape(n)}"]`);
   if(!el)return {あり:false};
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   /* 見出しが出ていないこと（同じ群名の`.prep-head`が無い）。 */
   const head=[...document.querySelectorAll('.selectors>.prep-head')]
     .some(h=>h.dataset.opgroup===n);
   return {あり:true,見出し:head,
     文字:el.textContent.trim(),
     枠:cs.borderTopWidth,地:cs.backgroundColor,
     幅:Math.round(r.width),高さ:Math.round(r.height),
     列:el.style.gridColumn};
  },padName);
  rec('測定画面に空きのマスが置かれる',pad.あり===true,JSON.stringify(pad));
  rec('空きは見出しを出さない',pad.あり&&pad.見出し===false,JSON.stringify(pad));
  /* **枠も地も文字も持たない**——見えたら「空き」の用を成さない。 */
  rec('空きは枠も文字も持たない',
      pad.あり&&pad.文字===''&&(pad.枠==='0px'||pad.枠===''),JSON.stringify(pad));
  rec('空きは地を塗らない（透明）',
      pad.あり&&/rgba\(0, 0, 0, 0\)|transparent/.test(String(pad.地)),String(pad.地));
  /* **記録した値の分母に入らない**（数えると永久に埋まらない1件が残る）。 */
  const cnt=await page.evaluate(n=>{
   const f=(window.WL&&WL.opData&&WL.opData.filled)?WL.opData.filled():null;
   const defs=(window.WL&&WL.opData&&WL.opData.defs)?WL.opData.defs():[];
   return {f,dummy:defs.filter(d=>d.dummy).length,
           自由:defs.filter(d=>!d.builtin).length};
  },padName);
  rec('前提: 空きの行は測定画面まで届いている',cnt.dummy>0,JSON.stringify(cnt));
  rec('空きの行は「記録した値」の分母に入らない',
      !!cnt.f&&cnt.f.total===cnt.自由-cnt.dummy,JSON.stringify(cnt));

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。db/master.sqlite3は実行をまたいで生き延びる。 */
  for(const g of madeGroups){
   try{
    const r=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
    for(const it of (r.items||[]).filter(i=>(i.group||'')===g)){
     await post('/api/operation-item-master/delete',{id:it.id,user_id:'tests'});
    }
   }catch(e){}
  }
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
