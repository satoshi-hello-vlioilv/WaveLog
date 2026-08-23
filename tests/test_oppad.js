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
 const madeIds=[];let renamed=null;
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
     2) 空き（ダミー）は**カード1枚**（§9.228 ②、利用者の指示
        「ダミーのカードだけ追加したいがダミー群ごとしか追加できないのも
         修正してほしい」「実際の画面にも『空き』という形でしっかり表示
         されている…実装したかったダミーで余白を作りたかった意味と全く違う」）
     ========================================================== */
  const before=await page.$$eval('.op-tile',es=>es.length);
  await page.click('#opAddPad');
  await page.waitForFunction(n=>document.querySelectorAll('.op-tile').length>n,
    before,{timeout:15000});
  await page.waitForTimeout(500);
  const tile=await page.evaluate(()=>{
   const t=document.querySelector('.op-tile.is-pad');
   if(!t)return null;
   const band=t.closest('.op-board-grid')
     ?[...document.querySelectorAll('.op-band')].map(b=>b.dataset.opBand):[];
   return {文字:t.textContent.replace(/\s+/g,''),
           群の帯:band.length,
           掴める:t.getAttribute('draggable')==='true'};
  });
  rec('「空きカードを追加」でカードが1枚増える（群は作らない）',
      !!tile,JSON.stringify(tile));
  /* **群ごと作らないこと**——利用者の指示。既存の群の中へ入る。 */
  rec('空きは既存の群の中に入る（新しい群を作らない）',
      !!tile&&tile.群の帯>0,JSON.stringify(tile));
  rec('空きのカードは掴んで動かせる',!!tile&&tile.掴める===true,JSON.stringify(tile));

  /* 名前を聞かない＝プロンプトを出さない（決めることを増やさない）。 */
  const srv=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
  const pads=(srv.items||[]).filter(i=>i.dummy);
  rec('空きの印がサーバーに残る',pads.length>0,JSON.stringify(pads.map(i=>i.name)));
  rec('空きの行は有効なまま（無効にすると測定画面に届かない）',
      pads.every(i=>i.enabled!==false),JSON.stringify(pads.map(i=>i.enabled)));
  pads.forEach(i=>madeIds.push(i.id));

  /* ---- 右クリックメニュー（§9.228 ⑤） ---- */
  await page.click('.op-tile.is-pad',{button:'right'});
  await page.waitForSelector('.op-menu',{timeout:8000});
  const menu=await page.evaluate(()=>{
   const m=document.querySelector('.op-menu');
   return {幅:m.querySelectorAll('[data-opm-span]').length,
           削除:m.querySelectorAll('[data-opm-del]').length,
           項目へ:m.querySelectorAll('[data-opm-pad="0"]').length,
           /* **絞る**のが要件（利用者の指示）。ボタンを増やしすぎない。 */
           総数:m.querySelectorAll('button').length};
  });
  rec('右クリックで幅と削除のメニューが出る',
      menu.幅>=4&&menu.削除===1&&menu.項目へ===1,JSON.stringify(menu));
  rec('メニューは「よく使うものに絞る」（多すぎない）',menu.総数<=12,String(menu.総数));
  /* **閉じられること**を見る（§9.222 ①。開いたことだけ見る網は素通りする）。 */
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  rec('メニューはEscで閉じる',
      await page.evaluate(()=>!document.querySelector('.op-menu')));
  await page.click('.op-tile.is-pad',{button:'right'});
  await page.waitForSelector('.op-menu',{timeout:8000});
  await page.mouse.click(5,5);
  await page.waitForTimeout(300);
  rec('メニューは外側クリックで閉じる',
      await page.evaluate(()=>!document.querySelector('.op-menu')));

  /* ---- 測定画面: 「空き」の文字がどこにも出ない ---- */
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
  const pad=await page.evaluate(()=>{
   const el=document.querySelector('.selectors>[data-oppad="1"]');
   /* **「空き」という文字が測定画面に出ていないこと**（利用者の指摘）。 */
   const hits=[...document.querySelectorAll('.selectors>*')]
     .filter(e=>/空き/.test(e.textContent||''))
     .map(e=>({cls:e.className,t:(e.textContent||'').trim().slice(0,20)}));
   if(!el)return {あり:false,空きの文字:hits};
   const cs=getComputedStyle(el),r=el.getBoundingClientRect();
   return {あり:true,空きの文字:hits,文字:el.textContent.trim(),
     枠:cs.borderTopWidth,地:cs.backgroundColor,
     幅:Math.round(r.width),列:el.style.gridColumn};
  });
  rec('測定画面に空きのマスが置かれる',pad.あり===true,JSON.stringify(pad).slice(0,180));
  rec('測定画面に「空き」の文字はどこにも出ない',
      (pad.空きの文字||[]).length===0,JSON.stringify(pad.空きの文字));
  rec('空きは枠も文字も持たない',
      pad.あり&&pad.文字===''&&(pad.枠==='0px'||pad.枠===''),JSON.stringify(pad).slice(0,140));
  rec('空きは地を塗らない（透明）',
      pad.あり&&/rgba\(0, 0, 0, 0\)|transparent/.test(String(pad.地)),String(pad.地));
  rec('空きは幅ぶんのマスを取る',pad.あり&&pad.幅>40,String(pad.幅));
  const cnt=await page.evaluate(()=>{
   const f=(window.WL&&WL.opData&&WL.opData.filled)?WL.opData.filled():null;
   const defs=(window.WL&&WL.opData&&WL.opData.defs)?WL.opData.defs():[];
   return {f,dummy:defs.filter(d=>d.dummy).length,自由:defs.filter(d=>!d.builtin).length};
  });
  rec('前提: 空きの行は測定画面まで届いている',cnt.dummy>0,JSON.stringify(cnt));
  rec('空きの行は「記録した値」の分母に入らない',
      !!cnt.f&&cnt.f.total===cnt.自由-cnt.dummy,JSON.stringify(cnt));

  /* ==========================================================
     3) 組み込みの欄も名前はマスタが決める（§9.228 ①）
     ========================================================== */
  const before2=await page.evaluate(()=>{
   const l=document.querySelector('.selectors>[data-f="coilStop"]');
   return l?l.textContent.trim().slice(0,20):'(無い)';
  });
  const coil=(srv.items||[]).find(x=>x.builtin==='coilStop');
  rec('前提: コイル止めは組み込みの欄として居る',!!coil,JSON.stringify(coil&&coil.name));
  if(coil){
   await post('/api/operation-item-master/update',
     {...coil,id:coil.id,name:TAG+'止め',user_id:'tests'});
   renamed=coil;
   /* 名前はマスタから読み直して**割り付けを通したとき**に効く（実際の
      画面では測定を開き直したときに通る道）。 */
   await page.evaluate(async()=>{
    WL.opData.forget();
    await WL.opData.load(true);
    WL.opData.layout();
   });
   await page.waitForTimeout(900);
   const after=await page.evaluate(()=>{
    const l=document.querySelector('.selectors>[data-f="coilStop"]');
    return l?{文字:l.textContent.trim(),欄:!!l.querySelector('select')}:null;
   });
   rec('組み込みの欄も名前を変えると測定画面に効く',
       !!after&&after.文字.indexOf(TAG+'止め')===0,
       JSON.stringify({前:before2,後:after&&after.文字.slice(0,24)}));
   /* **入力欄を消さないこと**——`textContent`ごと差し替えると`<select>`が消える。 */
   rec('名前を書き換えても入力欄は残る',!!after&&after.欄===true,JSON.stringify(after));
  }

  rec('画面のエラーが出ていない',errs.length===0,errs.slice(0,3).join(' / '));
 }catch(e){
  rec('FATAL',false,e.message);
 }finally{
  /* **後始末**（§9.121）。db/master.sqlite3は実行をまたいで生き延びる。
     **改名した組み込みの欄も必ず戻す**——戻さないと次の実行が引き継ぐ。 */
  try{
   if(renamed)await post('/api/operation-item-master/update',
     {...renamed,id:renamed.id,name:renamed.name,user_id:'tests'});
  }catch(e){}
  try{
   const r=await get('/api/operation-item-master?equipment='+encodeURIComponent(EQ));
   for(const it of (r.items||[]).filter(i=>i.dummy||madeIds.indexOf(i.id)>=0)){
    await post('/api/operation-item-master/delete',{id:it.id,user_id:'tests'});
   }
  }catch(e){}
  if(b)await b.close();
 }
 const ok=R.filter(x=>x.ok).length;
 console.log(`\n== ${ok}/${R.length} PASS ==`);
 process.exit(ok===R.length?0:1);
})();
